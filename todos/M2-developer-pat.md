# M2：开发者个人中心与 PAT 自服务闭环

- **主进度索引**：[`../TODO.md`](../TODO.md)
- **状态**：`[ ] 未开始`
- **对应接口数**：4 项 | **对应前端视图**：2 个

---

## 1. 必读依据（轻量分片直读）

- **后端分片**：`scripts/be_parts/part5_control_plane_security.md`、`scripts/be_parts/part9_security_ssrf_crypto.md`
- **接口契约分片**：`scripts/contract_parts/part7_apis_users_and_pats.md`（§6.4）、`scripts/contract_parts/part8_apis_profiles_and_roles_acls.md`（§6.5.2 `my-options`）
- **前端分片**：`scripts/fe_parts/part4_security_state_machines.md`（§4.5）、`scripts/fe_parts/part5_layout_paradigms.md`（§5.5）、`scripts/fe_parts/part7_rbac_matrix.md`、`scripts/fe_parts/part8_api_dto_mapping.md`
- **原型局部参考**：`ui-showcase.html`（仅 `#patDialog`、`#revokeDialog` 与客户端配置代码段）；`admin-console-demo.html`（仅 `tokens` 页模板）
---

## 2. 后端交付清单（4 项接口）

- [ ] `GET /api/v1/pats`（仅返回 `token_prefix` 与脱敏摘要，永不回传可恢复明文）
- [ ] `POST /api/v1/pats`（256-bit CSPRNG + `HMAC-SHA-256(SERVER_PEPPER, rawToken)` 落库 `sys_pats`，仅创建响应返回一次 `rawToken`，同事务写审计）
- [ ] `POST /api/v1/pats/:id/revoke`（仅允许本人或授权主体吊销，同步写审计）
- [ ] `GET /api/v1/profiles/my-options`（仅返回当前用户有访问权的 `{ id, name, displayName }` 轻量选项，不泄露底层 Host/Port/SSH 配置）

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
