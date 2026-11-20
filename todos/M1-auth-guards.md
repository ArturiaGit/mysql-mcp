# M1：系统自举、认证会话与四级守卫闭环

- **主进度索引**：[`../TODO.md`](../TODO.md)
- **状态**：`[~] 进行中（后端真实 MySQL 验收通过，待前端联调与 QA 验收）`
- **对应接口数**：9 项 | **对应前端视图**：6 个（Auth / 状态页）

---

## 1. 必读依据（轻量分片直读）

- **后端分片**：`scripts/be_parts/part4_database_and_dal.md`、`scripts/be_parts/part5_control_plane_security.md`
- **接口契约分片**：`scripts/contract_parts/part2_transport_and_protocols.md`、`scripts/contract_parts/part3_error_codes_and_resilience.md`、`scripts/contract_parts/part4_guards_and_lifecycle.md`、`scripts/contract_parts/part6_apis_auth_and_approvals.md`；字段约束：`docs/contracts/request-fields.json`
- **前端分片**：`scripts/fe_parts/part4_security_state_machines.md`（§4.1~4.3）、`scripts/fe_parts/part7_rbac_matrix.md`、`scripts/fe_parts/part8_api_dto_mapping.md`、`scripts/fe_parts/part9_errors_and_tokens.md`
- **视觉规范**：`docs/UI_DESIGN_SPEC.md`
---

## 2. 后端交付清单（9 项接口 + 自举核心）

- [x] 实现 `BootstrapService`：仅在 `bootstrap_state = 'PENDING'` 且 14 张业务表为空时，同事务创建内置角色、全局配置、首个 `SUPER_ADMIN`、管理审计并置为 `READY`；异常库/非空 `PENDING` 拒绝 ready；密码不写普通日志
- [x] 实现 `Argon2id` 哈希与进程级 `Argon2Semaphore`、HttpOnly Cookie 会话（含 Session Regeneration）、`preValidation` 无副作用 CSRF 校验
- [x] 实现并注册以下 9 项接口（ID 全量序列化为 `string`，`email` 允许 `null`）：
  - [x] `GET /api/v1/auth/csrf`
  - [x] `POST /api/v1/auth/register`
  - [x] `POST /api/v1/auth/login`
  - [x] `POST /api/v1/auth/logout`
  - [x] `POST /api/v1/auth/change-password`
  - [x] `GET /api/v1/auth/me`（受限状态 `PENDING/REJECTED/DISABLED` 有效 Cookie 也返回 `200` 最小状态）
  - [x] `GET /api/v1/auth/password-policy`
  - [x] `PUT /api/v1/auth/password-policy`
  - [x] `POST /api/v1/approvals/resubmit`（`REJECTED` 用户修改资料重新申请）

---

## 3. 前端交付清单（6 个视图 + 请求/守卫基座）

- [ ] 实现 `src/api/client.ts`：单飞 CSRF 刷新与 `ERR_CSRF_INVALID` 一次重试、401 重定向、`sanitizeReturnUrl`（拦截反斜杠与 `//` 协议相对 URL）
- [ ] 实现 `src/api/session-request.ts`：`SessionRequestManager.abortAndRotate()`（登出先断业务流再发 `/auth/logout`）
- [ ] 实现 `src/api/schemas/auth.schema.ts`（`email: nullable`、`id: string`）及 `expectTypeOf` 双向静态等价测试
- [ ] 实现四级路由守卫管道：`AuthGuard -> StatusGuard -> MustChangePwdGuard（仅 ACTIVE） -> RoleGuard`
- [ ] 实现 6 个认证与状态视图：
  - [ ] `/login` (`LoginView.tsx`)
  - [ ] `/register` (`RegisterView.tsx`)
  - [ ] `/change-password` (`ChangePasswordView.tsx`，含密码轮换策略编辑与高危关闭确认)
  - [ ] `/approvals/wait` (`PendingApprovalView.tsx`)
  - [ ] `/approvals/re` (`ResubmitApprovalView.tsx`，展示 `reject_reason` 并对接重提接口)
  - [ ] `/forbidden` (`AccountDisabledView.tsx`)

---

## 4. 模块联调验收剧本

- [ ] **真实库首次自举与强制改密**：Docker 空库启动生成唯一超管 → 登录自动进 `/change-password` → 手动跳转 `/audits` 被硬拦截 → 完成改密解锁进入 `/dashboard` 并轮换 CSRF
- [ ] **生命周期守卫闭环**：注册账号（`PENDING`）访问受保护路由被 L2 `StatusGuard` 拦到 `/approvals/wait`（**绝不触发 `MustChangePwdGuard`**）；构造 `REJECTED` 账号在 `/approvals/re` 重提回到 `PENDING`；`DISABLED` 账号进入 `/forbidden`
- [ ] **安全单测与后端基线**：`sanitizeReturnUrl` 边界测试全绿；防爆破次数提示正确；登出断流测试与 `TC-BE-16` 通过
