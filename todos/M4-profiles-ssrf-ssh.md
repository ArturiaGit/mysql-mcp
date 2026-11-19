# M4：数据源 Profile 与 SSRF / SSH 三模式连通性测试

- **主进度索引**：[`../TODO.md`](../TODO.md)
- **状态**：`[ ] 未开始`
- **对应接口数**：6 项 | **对应前端视图**：1 个

---

## 1. 必读依据（轻量分片直读）

- **后端分片**：`scripts/be_parts/part8_core_engine_pool.md`（SSH 隧道小节）、`scripts/be_parts/part9_security_ssrf_crypto.md`
- **接口契约分片**：`scripts/contract_parts/part5_concurrency_and_security.md`、`scripts/contract_parts/part8_apis_profiles_and_roles_acls.md`（§6.5）；契约产物：`docs/contracts/readiness.types.ts`、`docs/contracts/readiness.fixtures.json`、`docs/contracts/request-fields.json`
- **前端分片**：`scripts/fe_parts/part4_security_state_machines.md`（§4.6~4.8）、`scripts/fe_parts/part8_api_dto_mapping.md`（含 `profileToEditForm`）
- **原型局部参考**：`ui-showcase.html`（仅连接配置表单与 SSH 开关）；`admin-console-demo.html`（仅 `profiles` 页模板）
---

## 2. 后端交付清单（6 项接口 + 安全内核）

- [ ] 落地 `packages/security` 的 `CryptoKeyring`（AES-256-GCM 密文存储密码与 SSH 私钥）与 `ssrf-guard`（Post-DNS 校验 + 私网/保留 CIDR 阻断 + `ALLOWED_OUTBOUND_IPS`）
- [ ] 落地 `packages/core-engine` 的 `ssh-tunnel`（`ssh2@1.16.0` + `ssh_host_fingerprint_sha256` 校验）
- [ ] 实现并挂载以下 6 项接口：
  - [ ] `GET /api/v1/profiles`（返回 `ProfileReadDTO` 含 `username`、`queue_timeout_ms`、`version`，绝不返回明文密码/私钥）
  - [ ] `POST /api/v1/profiles`
  - [ ] `PUT /api/v1/profiles/:id`（校验 `version` 乐观锁；修改主机/用户/TLS/SSH 信任边界字段时按契约强制要求重新输入对应凭据）
  - [ ] `DELETE /api/v1/profiles/:id`（依赖检查阻断）
  - [ ] `POST /api/v1/profiles/test-db`（支持已存 / 草稿 / 新增三模式）
  - [ ] `POST /api/v1/profiles/test-ssh`（支持已存 / 草稿 / 新增三模式）

---

## 3. 前端交付清单（1 个视图 + 领域组件）

- [ ] 实现 `src/api/schemas/profile.schema.ts`（对齐 `readiness.types.ts` 与 `request-fields.json`）及 `profileToEditForm()` 显式映射（`username -> user`，**严禁展开 GET DTO 提交 PUT**，修改信任边界重输凭据校验）
- [ ] 实现 `src/components/domain/ssrf-tester/`（支持已存/草稿/新增三模式连通性测试，捕获 `ERR_SSRF_PROHIBITED` 后高亮引导 `ALLOWED_OUTBOUND_IPS`）
- [ ] 实现 `/profiles`（`ProfilesView.tsx`：38px Profile 表、新增/编辑表单、TLS/SSH 条件字段、409 冲突保留草稿）

---

## 4. 模块联调验收剧本

- [ ] 新增指向本地测试 MySQL 的 Profile → 核查数据库 `sys_profiles` 密码已 AES-256-GCM 加密 → 使用“新增/草稿/已存”三模式测试连通性均通过
- [ ] 填写 `127.0.0.1` 或保留网段点击测试 → 后端返回 `403 ERR_SSRF_PROHIBITED` → 前端展示出站白名单自愈指引
- [ ] 模拟双端同时编辑同一 Profile → 第二端提交触发 `409 ERR_CONCURRENCY_CONFLICT`，表单保留当前草稿不被清空
