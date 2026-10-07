# [TASK-APP-003] Phase 2-A 回环服务与连接管理后端实现

- 变更日期：2026-10-06
- 关联任务：TASK-APP-003
- 关联 PR：待交付
- 关联 Commit：待提交
- 责任执行方：Antigravity (Planning & Documentation Delivery) × PI-Desktop (Implementation)
- 关联功能/需求：F25, F01, F02, F03, F04, F05 / R01, R02, R03, R14, R15, R16, R17

---

## 📢 发版说明（Release Notes / 面向用户与下游）

### 变更分类与追溯条目
- **🚀 Added**：
  - 在 `mysql-mcp/src/server/` 实现 Fastify 5.x 本地回环 HTTP 管理服务（`createLocalServer` 惰性工厂），严格且仅监听 `127.0.0.1`，绑定安全错误白名单，杜绝任何外部网络跨域访问与堆栈外泄 by @PI-Desktop
  - 在 `mysql-mcp/src/server/auth.ts` 建立安全本地认证与防 CSRF 机制：采用 32 字节高熵随机 HEX 本地码（`local_code`）换取 HttpOnly、SameSite=Strict 会话 Cookie，单次消费，限速每分钟最多 10 次；内存会话上限 16 个，TTL 30 分钟；所有状态变更接口强制校验 `x-csrf-token` by @PI-Desktop
  - 在 `mysql-mcp/src/server/connections.ts` 建立单写者原子元数据持久化存储 `JsonMetadataStorage`（独占排他创建 `.lock` 租约，结合临时文件与 `file.sync()` 进行原子重命名覆盖），限制连接容量至多 256 项，元数据大小上限 1MiB by @PI-Desktop
  - 联动 `WindowsKeyringProvider` 实现四阶段凭据生命周期补偿机制（记账队列 -> 写入凭据 -> 提交配置 -> 清理旧凭据），替换密码时分配新 UUID 引用以防回滚丢失，失败保留非秘密 tombstone 供后续重试 by @PI-Desktop
  - 建立有界连接测试模拟服务（`testDraft` 与 `testSaved`），草稿测试绝不落盘与写入 Keyring，已保存连接读取凭据进行模拟测试（默认返回 `connected: false, simulated: true`，不宣称真实数据库连通）；测试期间持有连接使用锁，未结束前编辑或删除连接确定性返回 `409 STATE_CONFLICT` 阻断 by @PI-Desktop
  - 在 `mysql-mcp/src/server/routes.ts` 完整注册 `/api/v1/session` 与 `/api/v1/connections` 全部 REST 路由，统一响应格式 `{ ok: true, data: ... }` by @PI-Desktop
  - 在 `mysql-mcp/tests/server.test.mjs` 编写 63 项接口自动化测试套件，联动 `scripts/build.mjs` 使应用自动化测试扩展至 190 项全绿通过 by @PI-Desktop
- **🔒 Security**：
  - 接口响应 100% 剔除密码与内部 `credential_ref`：无论是连接列表（`GET /api/v1/connections`）还是单个连接响应，客户端仅能获取脱敏后的 `ConnectionView`；
  - 强校验 `Host`（仅允许 `127.0.0.1:<port>` 或 `localhost:<port>`）与 `Origin`（强制同源），跨域来源一律返回 `403 Forbidden`；
  - 严格限制请求体大小上限为 16KiB，请求与连接超时为 10 秒，串行队列上限为 64 项，测试并发额度上限为 4 项；
  - 单写者 `.lock` 租约故障关闭（fail-closed）：服务异常崩溃遗留锁坚决不自动猜测进程存活或强制抢锁，需用户确认无活动进程后人工清理；
  - 目录权限创建模式为 `0700`，文件创建模式为 `0600`。
- **🔄 Changed**：
  - 更新 `mysql-mcp/src/index.ts` 聚合导出 `createLocalServer` 及相关类型；
  - 同步 8 份规约与架构文档（`API_AND_PROTOCOLS.md`、`DATA_MODELS.md`、`PROJECT_CONSTRAINTS.md`、`ARCHITECTURE.md`、`DEPLOYMENT_GUIDE.md`、`TECH_STACK.md`、`CODE_REVIEW.md`、`ENGINEERING_TOOLCHAIN.md`、`ROADMAP.md`），如实记录 Phase 2-A 后端服务实现事实与安全边界 by @Antigravity

### 发版亮点摘要 (Highlights)
完整落地了 Phase 2-A 后端核心服务：仅监听 `127.0.0.1` 的 Fastify 回环服务、单次高熵代码会话与严格 CSRF 防御、单写者原子文件存储、联动 Windows Keyring 的四阶段凭据补偿事务、以及连接测试并发使用锁保护。应用自动化测试由 127 项扩充至 190 项全绿，零新增第三方依赖，前端物理隔离边界完整守住。

---

## 🛠️ Agent 工程上下文与架构演进（面向开发者与后续 Agent）

### 1. 架构与设计决策 (Why & Design)
- **单写者独占锁与崩溃恢复机制**：
  为杜绝多个 Fastify 进程并发写入造成 `connections.json` 损坏，`JsonMetadataStorage` 采用 `wx` 独占排他标志创建 `connections.json.lock`。正常退出（`server.close()`）时自动删除锁文件。若进程因断电或异常崩溃留下孤儿锁，服务端坚决不通过 PID 猜测或超时抢锁（因为同 PID 可能被操作系统重新分配给其他无关进程），保持安全 fail-closed，必须由用户人工确认无活动进程后删除锁文件。
- **四阶段凭据补偿事务**：
  由于本地文件存储与操作系统 Windows Keyring 无法组成跨系统的单一 ACID 事务，因此引入四阶段补偿队列设计：修改密码时，先分配新 UUID `ref`，将废弃引用写入 `cleanup_refs` 队列并落盘；随后向 Keyring 写入新密码；再更新 `items` 提交新引用；最后清理废弃凭据。若 Keyring 写入失败，旧配置与旧凭据依然有效；若清理旧凭据失败，引用保留在 `cleanup_refs` 中，后续任何修改操作将自动重试清理。
- **测试期间的使用锁与状态冲突**：
  当用户对已保存连接触发测试时，底层网络探测需要耗费数秒时间。为防止用户在测试期间同时编辑连接或删除连接导致凭据被提前销毁或配置错乱，连接服务在测试期间增加读取/使用计数锁。若在测试中发起 `PATCH` 或 `DELETE`，服务端直接返回 `409 STATE_CONFLICT` 拒绝冲突。

### 2. 实际改动文件与逻辑清单 (What)
- **应用源码 (`mysql-mcp/src/`)**：
  - `server/app.ts`：Fastify 实例工厂 `createLocalServer`，中间件注册与错误脱敏。
  - `server/auth.ts`：本地代码换会话、限速器、Session 存储与 CSRF 校验。
  - `server/connections.ts`：单写者文件存储 `JsonMetadataStorage`、连接 CRUD、事务补偿与模拟测试。
  - `server/errors.ts`：服务端错误类与安全消息映射白名单。
  - `server/routes.ts`：注册所有 `/api/v1/*` REST 路由。
  - `index.ts`：聚合导出 `createLocalServer`。
- **测试套件 (`mysql-mcp/tests/`)**：
  - `tests/server.test.mjs`：编写 63 项 Fastify 接口自动化测试。
  - `scripts/build.mjs`：联动运行全部 5 个测试套件（190 项）。
- **规约与台账文档 (`docs/` & `governance/`)**：
  - 全面同步接口契约、数据模型、约束、部署、架构与技术栈文档。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **避坑警示 1（遗留锁 fail-closed 人工处理）**：
  `connections.json.lock` 采用独占排他创建，正常退出会清理。若测试或异常崩溃遗留 `.lock` 文件，服务端启动会抛出 `SERVICE_UNAVAILABLE`；切勿在代码中擅自添加自动强删锁逻辑，需提醒用户确认无其他进程后手动清理。
- **避坑警示 2（脱敏连接视图无密码）**：
  `ConnectionView` 只有 `{ id, name, host, port, username, default_database, version }`。前端（Antigravity 在 Phase 2-B 开发页面）绝对不能假设接口会返回 `password` 或 `credential_ref`。编辑连接时，若用户未输入新密码，前端应留空该字段，服务端会自动保持原密码。
- **避坑警示 3（F05 连接测试目前为模拟服务）**：
  默认测试器返回 `{ connected: false, simulated: true, duration_ms: ... }`。本阶段未连接真实 MySQL 数据库，绝对不得在 Release Notes 或报告中宣称真实 MySQL 已连通。
- **避坑警示 4（使用中连接编辑/删除会被拒绝）**：
  连接处于正在测试或执行中时，持有活跃使用锁；此时对该连接调用 PATCH 或 DELETE 会返回 `409 STATE_CONFLICT`。前端在发起编辑或删除前需确保无正在运行的测试任务。
- **避坑警示 5（Windows 历史 CRLF 与检查规范）**：
  全仓执行治理检查时需注意使用进程级 `core.autocrlf=true` 归一化，严禁擅自修改全局/仓库 Git 配置。

### 4. 验证证据 (Verification)
- `npm test --prefix mysql-mcp`：190/190 pass（smoke 6, keyring 5, sql-policy 113, mcp 3, server 63）；
- `node mysql-mcp/scripts/compile.mjs`：严格 `tsc --noEmit` exit 0；
- `node scripts/governance/check.mjs`：静态治理检查通过；
- 治理测试：89/89 pass；
- 协作测试：80/80 pass；
- 最终隔离快照合计 359 项测试无失败/跳过/取消。
