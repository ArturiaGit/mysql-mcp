# M2：开发者个人中心与 PAT 自服务闭环

- **主进度索引**：[`../TODO.md`](../TODO.md)
- **状态**：`[~] 进行中（已补充 Git 全链路中文规范，Step 1 共享类型与后端开发已派发）`
- **对应接口数**：4 项 | **对应前端视图**：2 个

---

## 1. 必读依据（轻量分片直读）

- **后端分片**：`scripts/be_parts/part5_control_plane_security.md`、`scripts/be_parts/part9_security_ssrf_crypto.md`
- **接口契约分片**：`scripts/contract_parts/part7_apis_users_and_pats.md`（§6.4）、`scripts/contract_parts/part8_apis_profiles_and_roles_acls.md`（§6.5.2 `my-options`）
- **前端分片**：`scripts/fe_parts/part4_security_state_machines.md`（§4.5）、`scripts/fe_parts/part5_layout_paradigms.md`（§5.5）、`scripts/fe_parts/part7_rbac_matrix.md`、`scripts/fe_parts/part8_api_dto_mapping.md`
- **原型局部参考**：`ui-showcase.html`（仅 `#patDialog`、`#revokeDialog` 与客户端配置代码段）；`admin-console-demo.html`（仅 `tokens` 页模板）
---

## 2. 后端交付清单（4 项接口）

> **Owner 拍板执行口径（已确认）**：
> - **PAT 签发审计**：遵循 `docs/DATABASE_DESIGN_SPEC.md` §L620 现行字典，同事务写入 `sys_user_approvals`：`action = 'CONFIG_UPDATE'`、`target_type = 'PAT'`、`target_id = patId`、`details = { operation: 'PAT_CREATE', name, tokenPrefix, expiresAt }`（仅脱敏摘要，严禁明文/哈希）；吊销沿用 `action = 'PAT_REVOKE'`。
> - **`SERVER_PEPPER` 配置（方案 2A）**：`apps/admin-api` 引入独立必填环境变量 `SERVER_PEPPER`（`Buffer.byteLength >= 32`），缺失或不足时对齐 M1 `ADMIN_API_SECRET` 的 Fail-Closed Ready 模式（`/health/live = 200`、`/health/ready = 503` 且拒绝挂载 `/api/v1/*` 业务路由）；专门用于 `HMAC-SHA-256(SERVER_PEPPER, rawToken)`；PAT 原文遵循 `DATABASE_DESIGN_SPEC.md` §L734 固定 `^mcp_pat_[0-9a-f]{64}$`（`token_prefix` 取前 16 位）；同步补齐 E2E（`m0-lab` / `m1-auth`）与 CI 环境变量注入。
> - **PAT 吊销分阶段验收（方案 1A）**：M2 验收真实 MySQL `revoked_at` 原子写入 + 同事务 `PAT_REVOKE` 审计 + 强类型可注入的事务提交后失效回调契约（`markPatRevokedSync` / `cancelQueriesByPat`，实测仅在事务提交成功后触发、回滚不触发）；真实网关数据面内存失效与在途 SQL 物理 `KILL` 断流归属 M6 门禁（已登记至 `todos/M6-mcp-data-plane.md`）。

- [x] `GET /api/v1/pats`（仅返回 `token_prefix` 与脱敏摘要，永不回传可恢复明文）
- [x] `POST /api/v1/pats`（256-bit CSPRNG + `HMAC-SHA-256(SERVER_PEPPER, rawToken)` 落库 `sys_pats`，仅创建响应返回一次 `rawToken`，同事务写审计）
- [x] `POST /api/v1/pats/:id/revoke`（受 L3 密码有效守卫约束；仅允许本人或超管吊销，原子更新 `revoked_at` + 同事务写审计 + 提交后触发可测试失效回调）
- [x] `GET /api/v1/profiles/my-options`（仅返回当前用户有访问权的 `{ id, name, displayName }` 轻量选项，不泄露底层 Host/Port/SSH 配置）

---

## 3. 前端交付清单（2 个视图 + 2 个领域组件）

- [ ] 落地 `src/components/domain/pat-modal/`（严格还原 `ui-showcase.html` `#patDialog` 三态防呆）：
  - 输入态（名称必填、有效期、加载防重入）
  - 揭示态（红色警示横幅、等宽明文、一键复制、`我已妥善保存` 勾选解锁关闭按钮）
  - 退出拦截态（未勾选点击关闭或 `Esc` 原地展开挽留确认；真正关闭立即清空内存明文）
- [ ] 落地 `src/components/domain/client-snippet/`（Claude Desktop / Codex / 通用 cURL 三态切换，默认安全占位 `<YOUR_SAVED_PAT_TOKEN>`，支持仅内存临时装填，绝不持久化）
- [ ] 实现 `/developer/pats`（`MyTokensView.tsx`，含危险确认输入撤销弹窗）
- [ ] 实现 `/developer/config`（`ClientConfigView.tsx`，调用 `GET /api/v1/profiles/my-options`）

---

## 4. 模块联调验收剧本

- [ ] 前端真实签发 PAT → 未勾选保存按 `Esc` 被拦截并弹出挽留区 → 复制并勾选后关闭 → 刷新列表确认明文永不再现且 `sys_pats` 仅存哈希
- [ ] 普通激活用户打开 `/developer/config`，验证只能看到自己有权的 Profile 选项且网络响应无运维敏感字段
- [ ] 在 `/developer/pats` 执行撤销弹窗确认后，真实吊销该 PAT 并更新数据库与界面状态
