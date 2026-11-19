# M3：审批工单中心与用户全生命周期（超管防自残）

- **主进度索引**：[`../TODO.md`](../TODO.md)
- **状态**：`[ ] 未开始`
- **对应接口数**：8 项 | **对应前端视图**：2 个

---

## 1. 必读依据（轻量分片直读）

- **后端分片**：`scripts/be_parts/part4_database_and_dal.md`、`scripts/be_parts/part5_control_plane_security.md`、`scripts/be_parts/part11_api_matrix_and_testing.md`（§11.4 `TC-BE-17`）；并发锁序补充查 `docs/DATABASE_DESIGN_SPEC.md` §7
- **接口契约分片**：`scripts/contract_parts/part5_concurrency_and_security.md`、`scripts/contract_parts/part6_apis_auth_and_approvals.md`（§6.2）、`scripts/contract_parts/part7_apis_users_and_pats.md`（§6.3）；形状类型：`docs/contracts/readiness.types.ts`（`ResetPasswordPayload`）
- **前端分片**：`scripts/fe_parts/part4_security_state_machines.md`（§4.4）、`scripts/fe_parts/part5_layout_paradigms.md`（§5.3）、`scripts/fe_parts/part7_rbac_matrix.md`、`scripts/fe_parts/part8_api_dto_mapping.md`
- **原型局部参考**：`ui-showcase.html`（仅权限护栏演示块）；`admin-console-demo.html`（仅 `users` 页与 `#reviewDialog`，**不实现虚构的 `inviteUser` 按钮与演示角色名**）
---

## 2. 后端交付清单（8 项接口）

- [ ] 严格落实 **`SUPER_ADMIN` 角色锁 → 按 ID 锁用户 → 锁绑定当前读** 并发锁序与同事务管理审计，并实现以下 8 项接口：
  - [ ] `GET /api/v1/approvals/pending`
  - [ ] `POST /api/v1/approvals/:id/approve`（赋予角色、同步失效关联状态）
  - [ ] `POST /api/v1/approvals/:id/reject`（强制校验非空 `reason`）
  - [ ] `GET /api/v1/users`（返回 `is_last_super_admin` 标记，过滤/脱敏敏感列）
  - [ ] `PUT /api/v1/users/:id/status`（`DISABLED` / `ACTIVE` + `version` 乐观锁 + 本人/最后超管保护）
  - [ ] `PUT /api/v1/users/:id/roles`（防自残、防越权提权、`version` 乐观锁）
  - [ ] `DELETE /api/v1/users/:id`（本人与最后超管保护）
  - [ ] `POST /api/v1/users/:id/reset-password`（仅 `SUPER_ADMIN`，返回一次性临时密码，`409` 乐观锁校验）

---

## 3. 前端交付清单（2 个视图）

- [ ] 实现 `/approvals`（`ApprovalsView.tsx`：38px 高密度待审表 + 批准分配角色 / 驳回填写理由弹窗，严格等待 HTTP 200 后刷新列表）
- [ ] 实现 `/users`（`UsersView.tsx`：38px 用户列表、超管与本人操作保护——禁用冻结/降权/删除按钮 + 锁图标 + `Tooltip`、重设密码一次性展示弹窗与 `409` 草稿保留）

---

## 4. 模块联调验收剧本

- [ ] **完整入驻闭环**：匿名注册 → 管理员 `/approvals` 驳回（空理由拦截） → 用户 `/approvals/re` 重提 → 管理员批准并赋权 → 新用户登录成功进入控制台
- [ ] **防自残与并发锁序验收**：
  - 登录超管在 `/users` 查看自己行与唯一超管行，确认冻结/删除按钮处于 `disabled` 并展示明确 Tooltip 解释；
  - 模拟双超管并发互冻 / 试图绕过前端直调 `PUT /users/:id/status` 或 `DELETE /users/:id`，验证 `ERR_LAST_SUPER_ADMIN` 拦截与管理审计失败回滚（`TC-BE-17`）
