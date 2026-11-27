# M3：审批工单中心与用户全生命周期（超管防自残）

- **主进度索引**：[`../TODO.md`](../TODO.md)
- **状态**：`[ ] 进行中（阶段 1 后端、阶段 2 前端真实联调均已通过，阶段 3 独立 QA 验收中）`
- **对应接口数**：8 项 | **对应前端视图**：2 个
- **失效 Hook 分阶段验收（对齐 M2 方案 1A）**：M3 验证独立 `main.ts` 在 `NODE_ENV=production` 时 Fail-Fast、`createServer` 缺少任一生产 Hook 时 readiness Fail-Closed 且不挂载业务路由，以及事务提交后的同步墓碑先于异步取消、墓碑故障注入后的 Fail-Closed 与 best-effort 断流；真实数据面 `RegistryHub` + `QueryLifecycleCoordinator` 单进程宿主接线及在途查询断流归属 M6 门禁。

---

## 1. 必读依据（轻量分片直读）

- **后端分片**：`scripts/be_parts/part4_database_and_dal.md`、`scripts/be_parts/part5_control_plane_security.md`、`scripts/be_parts/part11_api_matrix_and_testing.md`（§11.4 `TC-BE-17`）；并发锁序补充查 `docs/DATABASE_DESIGN_SPEC.md` §7
- **接口契约分片**：`scripts/contract_parts/part5_concurrency_and_security.md`、`scripts/contract_parts/part6_apis_auth_and_approvals.md`（§6.2）、`scripts/contract_parts/part7_apis_users_and_pats.md`（§6.3）；形状类型：`docs/contracts/readiness.types.ts`（`ResetPasswordPayload`）
- **前端分片**：`scripts/fe_parts/part4_security_state_machines.md`（§4.4）、`scripts/fe_parts/part5_layout_paradigms.md`（§5.3）、`scripts/fe_parts/part7_rbac_matrix.md`、`scripts/fe_parts/part8_api_dto_mapping.md`
- **原型局部参考**：`ui-showcase.html`（仅权限护栏演示块）；`admin-console-demo.html`（仅 `users` 页与 `#reviewDialog`，**不实现虚构的 `inviteUser` 按钮与演示角色名**）
---

## 2. 后端交付清单（8 项接口 + 1 项只读角色目录前置）

> **Owner 拍板执行口径（已确认）**：
> - **重置密码（方案 1A）**：以 `API_CONTRACT_SPEC.md` §6.3.5 与 `DATABASE_DESIGN_SPEC.md` §7.6 正文为准——`POST /api/v1/users/:id/reset-password` 保留该用户名下的 PAT 与 `USER` 限流规则，提交后仅执行全用户 Web Session 清退、授权快照失效与取消在途 SQL（`PASSWORD_RESET`）；删除 PAT 与 `USER` 限流规则仅归属 `DELETE /api/v1/users/:id`（`DATABASE_DESIGN_SPEC.md` §13.1 同组文案为模块级汇总描述）。
> - **停用账号取消原因（方案 2A）**：`PUT /api/v1/users/:id/status` 置 `DISABLED` 时，统一采用 `ACCOUNT_DISABLED`（已同步修正 `scripts/be_parts/part4_database_and_dal.md` 并重新合成 `docs/BACKEND_ARCHITECTURE_SPEC.md`）；其余取消原因统一为 `USER_ROLES_CHANGED`（改角色）、`PASSWORD_RESET`（管理员重置密码）、`USER_DELETED`（删除用户）。
> - **前置只读角色目录（对齐 `API_CONTRACT_SPEC.md` §6.6.1）**：在 M3 提前实现只读 `GET /api/v1/roles`（守卫 `L4 SUPER_ADMIN / SECURITY_ADMIN`），供 `/approvals` 与 `/users` 从数据库读取真实角色列表，严禁前端硬编码内置角色 ID；角色写操作与 ACL 仍在 M5 交付。

- [x] 严格落实 **`SUPER_ADMIN` 角色锁 → 按 ID 锁用户 → 锁绑定当前读** 并发锁序与同事务管理审计，并实现以下 8 项接口（及前置只读 `GET /api/v1/roles`）：
  - [x] `GET /api/v1/roles`（前置只读，对齐 §6.6.1，供审批赋权与用户角色编辑读取真实角色列表）
  - [x] `GET /api/v1/approvals/pending`
  - [x] `POST /api/v1/approvals/:id/approve`（赋予角色、同步失效关联状态）
  - [x] `POST /api/v1/approvals/:id/reject`（强制校验非空 `reason`）
  - [x] `GET /api/v1/users`（返回 `is_last_super_admin` 标记，过滤/脱敏敏感列）
  - [x] `PUT /api/v1/users/:id/status`（`DISABLED` / `ACTIVE` + `version` 乐观锁 + 本人/最后超管保护）
  - [x] `PUT /api/v1/users/:id/roles`（防自残、防越权提权、`version` 乐观锁）
  - [x] `DELETE /api/v1/users/:id`（本人与最后超管保护）
  - [x] `POST /api/v1/users/:id/reset-password`（仅 `SUPER_ADMIN`，返回一次性临时密码，`409` 乐观锁校验）

---

## 3. 前端交付清单（2 个视图）

- [x] 实现 `/approvals`（`ApprovalsView.tsx`：38px 高密度待审表 + 批准分配角色 / 驳回填写理由弹窗，严格等待 HTTP 200 后刷新列表）
- [x] 实现 `/users`（`UsersView.tsx`：38px 用户列表、超管与本人操作保护——禁用冻结/降权/删除按钮 + 锁图标 + `Tooltip`、重设密码一次性展示弹窗与 `409` 草稿保留）

---

## 4. 模块联调验收剧本

- [ ] **完整入驻闭环**：匿名注册 → 管理员 `/approvals` 驳回（空理由拦截） → 用户 `/approvals/re` 重提 → 管理员批准并赋权 → 新用户登录成功进入控制台
- [ ] **防自残与并发锁序验收**：
  - 登录超管在 `/users` 查看自己行与唯一超管行，确认冻结/删除按钮处于 `disabled` 并展示明确 Tooltip 解释；
  - 模拟双超管并发互冻 / 试图绕过前端直调 `PUT /users/:id/status` 或 `DELETE /users/:id`，验证 `ERR_LAST_SUPER_ADMIN` 拦截与管理审计失败回滚（`TC-BE-17`）
