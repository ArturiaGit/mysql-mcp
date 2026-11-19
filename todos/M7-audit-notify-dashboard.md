# M7：审计排查、导出、系统通知与 Bento 大盘（全链路收口）

> **前置确认 gate**：进入本模块前，请确认 `RD-08` 中关于 DST 1440 分钟日桶口径及大盘/密码提示文案的最终口径。

- **主进度索引**：[`../TODO.md`](../TODO.md)
- **状态**：`[ ] 未开始`
- **对应接口数**：7 项 | **对应前端视图**：3 个

---

## 1. 必读依据（轻量分片直读）

- **后端分片**：`scripts/be_parts/part9_security_ssrf_crypto.md`（通知推送）、`scripts/be_parts/part10_audit_and_stats.md`
- **接口契约分片**：`scripts/contract_parts/part9_apis_rate_limits_and_audits.md`（§6.8）、`scripts/contract_parts/part10_apis_settings_and_mock_matrix.md`（§6.9 与第 7 章联调矩阵）；形状类型：`docs/contracts/readiness.types.ts`（`ExportAuditPayload` / `DownloadQuery`）
- **前端分片**：`scripts/fe_parts/part5_layout_paradigms.md`（§5.2~5.3）、`scripts/fe_parts/part6_state_management.md`（§6.2 URL SSOT）、`scripts/fe_parts/part8_api_dto_mapping.md`、`scripts/fe_parts/part10_testing_acceptance.md`
- **原型局部参考**：`admin-console-demo.html`（仅 `dashboardPage`、`audit`、`#inspectSheet` 排版，**严禁复制虚构 EXPLAIN/AST/吊销 PAT 按钮**）；`ui-showcase.html`（仅 `#data` 审计表排版）
---

## 2. 后端交付清单（7 项接口）

- [ ] `GET /api/v1/audits`（经 `MetadataQueryExecutor`，支持筛选分页及 `query_instance_id` 精确单条回补，严禁退回裸 `Pool.query`）
- [ ] `GET /api/v1/audits/stats`（管理员返回全网关聚合；普通研发严格裁剪为个人授权 Profile 与真实有效 `user_quota_qpm`）
- [ ] `POST /api/v1/audits/export`（生成脱敏导出 Ticket）
- [ ] `GET /api/v1/audits/export/download`（`?ticket=` 内存 Ticket 先 CAS 原子消费后流式响应 `text/csv`，同源 Cookie 校验）
- [ ] `GET /api/v1/settings/notifications`
- [ ] `PUT /api/v1/settings/notifications`（企微/钉钉/飞书 Webhook + `version` 乐观锁）
- [ ] `POST /api/v1/settings/test-notify`（SSRF 校验防重绑定）

---

## 3. 前端交付清单（3 个视图 + 排查抽屉收口）

- [ ] 实现 `/audits`（`AuditsView.tsx`：TanStack Table v8 + Virtual、38px 行高、状态与 `SLOW: xxx ms` 双轨标签、URL SSOT 筛选/分页、CSV 导出下载）
- [ ] 完善 `src/layouts/InspectSheet.tsx`（仅渲染 `sys_audit_logs` 真实字段 + CodeMirror 6 脱敏 SQL + `?eventId=` 深链直达与单条回补 + 404 友好提示；**无虚构字段、无吊销 PAT 按钮**）
- [ ] 实现 `/settings/notifications`（`SettingsView.tsx`：通知渠道配置、SSRF 自愈引导、409 草稿保留）
- [ ] 实现 `/dashboard`（`DashboardView.tsx`：12 列 Bento Grid、10s 短轮询、Profile 维度对齐的 QPM vs `profile_capacity_qpm` 双折线、近期拦截事件点击跳转 `?eventId=`、普通研发数据隔离）

---

## 4. 全链路总验收剧本（Playwright E2E + 构建预算）

- [ ] 跑通 `FRONTEND_ARCHITECTURE_SPEC.md` §10.2 全部 **6 条 Playwright E2E 核心链路**（含 `1500px -> 600px` / `1200px -> 540px` 抽屉断点、URL `?eventId=` 跨标签页深链打开）
- [ ] **真实端到端全链路闭环**：MCP 客户端发 SQL（1 条放行 + 1 条高危拦截）→ `/dashboard` 实时更新统计与拦截流 → 点击拦截记录跳转 `/audits?eventId=...` 在 `InspectSheet` 查看真实脱敏 SQL 与报错 → 导出脱敏 CSV 下载成功
- [ ] **生产包体门禁**：`vendors <= 140KB`、`admin-ui-core <= 40KB`、单路由 Chunk `<= 60KB`（gzip）
- [ ] **GitHub CI/CD 与安全审计收口**：`ci.yml`、CodeQL SAST、`pnpm audit --audit-level=high` 与 Secret Scanning 全部绿灯，按 SemVer 打出对应里程碑 Tag（`v0.x.y` 或 `RD-08` 签署冻结后 `v1.0.0`）
