# [TASK-APP-006] Phase 4-A 受控写入审批与状态机后端实现

- 变更日期：2026-10-08
- 关联任务：TASK-APP-006
- 关联 PR：待交付确认
- 关联 Commit：待提交
- 责任执行方：Antigravity (Planning & Documentation Delivery) × PI-Desktop (Implementation)
- 关联功能/需求：F12, F13, F14, F15, F16, F17, F18, F19, F20, F21 / R09, R10, R11, R12, R13, R14, R15, R16, R17

---

## 📢 发版说明（Release Notes / 面向用户与下游）

### 变更分类与追溯条目
- **🚀 Added**：
  - 在 `mysql-mcp/src/mcp/change-tools.ts` 落地 2 个核心变更管理 MCP 工具（`request_change`、`get_change_status`），工具总数由 5 个扩充至 7 个：
    - `request_change`：提交 DML/DDL 变更申请，执行 AST 策略判定、安全等级分级（L1 MODERATE_RISK / L2 HIGH_RISK）与结构指纹提取，入队生成全局唯一 `request_id`，返回待审批状态与无秘密的管理控制台审批定位契约 `management_url`；
    - `get_change_status`：按 `request_id` 探查变更状态与执行回执（仅限同一 MCP 会话或已认证管理会话），严格限制单次探查；
  - 在 `mysql-mcp/src/changes/` 落地完整的 10 状态变更生命周期引擎 (`ChangeManager`)：
    - 覆盖 `PENDING`、`APPROVED`、`EXECUTING`、`SUCCEEDED`、`FAILED`、`UNKNOWN`、`REJECTED`、`CANCELLED`、`EXPIRED`、`INVALIDATED` 十大确定性生命周期状态；
    - 内存预算守护：最多 256 个并发请求、最多 16 个活跃 MCP 会话上下文、最多 64 个状态队列、最多 4 个并发写入槽位，单个 SQL/原因字符串预算硬限制 1MiB；
    - 5 分钟超时清理：待审批申请超时 300 秒自动流转为 `EXPIRED`，终态记录在内存摘要中保留 300 秒供客户端探查后受控销毁；
    - 连接版本联动：连接发生任何 `PATCH` 编辑或 `DELETE` 删除时，该连接绑定的所有 `PENDING`/`APPROVED` 变更立即失效，自动流转为 `INVALIDATED`；
  - 在 `mysql-mcp/src/server/changes.ts` 落地 Fastify 受保护的审批与决策 HTTP 路由：
    - `GET /api/v1/changes`：列出当前活跃与未过期的变更申请脱敏摘要列表；
    - `GET /api/v1/changes/:request_id`：获取变更详情审查视图，签发单次有效、绑定认证浏览器会话的 32 字节 Hex `nonce` 挑战；
    - `POST /api/v1/changes/:request_id/decision`：提交人工决策（`action: 'approve' | 'reject'`），验证会话有效性、单次 Nonce 挑战与连接/SQL 版本指纹，一次性消费 Nonce 防重放；终态重复提交返回 `409 STATE_CONFLICT`；
  - 在 `mysql-mcp/src/mcp/native.ts` 落地客户端原生确认探针与受控分级策略（F20）：
    - 仅在受信客户端版本声明与权限模式记录完备、且经过无副作用探针（`accept` / `decline` / `cancel`）验证时，方允许为 L1 DML 启用原生确认；
    - L2 DDL/高危 DML 强制要求打开 Web 管理控制台进行全量结构指纹比对与人工二次确认；
    - 原生确认一旦收到拒绝或取消，直接流转为 `REJECTED`/`CANCELLED` 终态，坚决不进行 Web 自动后备；
  - 在 `mysql-mcp/src/changes/journal.ts` 落地意图持久化日志（`changes.json`，`schema_version: 1`）：
    - 采用原子单写者文件存储，仅记录最小脱敏状态元数据（`request_id`、`connection_id`、`state`、`sql_sha256`、`effect_summary`、时间戳与回执），绝对不持久化明文原始 SQL；
    - 在向 MySQL 发送物理网络写包前，意图必须先原子落盘为 `EXECUTING`；
    - 进程崩溃重启时，对日志中未收到执行回执的未决记录直接标记为 `UNKNOWN` 终态，坚决不自动重试或重放写入；
  - 在 `mysql-mcp/src/sql/write-driver.ts` 落地独立回环写执行器：
    - 仅限回环目标（`127.0.0.1`、`localhost`、`::1`），逐请求创建独立未池化 MySQL 会话；
    - 显式 `autocommit: true`，硬性禁用多语句（`multipleStatements: false`）与本地文件（`local_infile: false`）；
    - 写入超时预算 30 秒，派发前对无法静态证明的视图、触发器与跨库外键级联采取 fail-closed 策略拒绝派发；
  - 在 `mysql-mcp/src/sql/policy.ts` 扩充 DML/DDL 策略矩阵支持（F12~F18）：
    - 支持单表 `INSERT VALUES`、单表 `UPDATE`、单表 `DELETE`，无 `WHERE` 子句明确标记为 L2 HIGH_RISK；
    - 支持白名单有界子集：`CREATE TABLE`（列定义与主键索引）、`ALTER TABLE`（`ADD`/`DROP`/`MODIFY COLUMN`）、`DROP TABLE`、`TRUNCATE TABLE`、`CREATE DATABASE`、`DROP DATABASE`、`ALTER DATABASE`（字符集与排序规则适配）；
    - 目标库表不匹配拒绝并返回 `TARGET_MISMATCH`，任何未知或不安全语法严格阻断。
- **🔒 Security**：
  - **凭据与敏感数据零泄露**：明文 SQL 仅在有效内存审批详情与原生审查探针中可见，列表路由、MCP 状态探查与持久化日志完全剔除 SQL 文本；
  - **单次 Nonce 挑战防重放**：决策接口强制消费 32 字节 Hex Nonce，重复提交或过期提交返回 `409 STATE_CONFLICT`；
  - **UNKNOWN 终态绝对非重试**：网络断开、执行超时或未知异常统一置为 `UNKNOWN`，向客户端返回明确的非重试 `effect_note`，严禁任何自动化重试；
  - **写租约与单写者互斥**：写操作执行前必须获取连接独占租约，期间对该连接发起的并发只读查询、并发写申请、`PATCH` 修改或 `DELETE` 删除一律拒绝（`409 STATE_CONFLICT`）；
  - **无模型批准入口**：MCP 协议仅提供申请与探查接口，不存在任何可供大模型直接调用执行写操作的私有或隐藏接口，人工授权是执行的前提。
- **🔄 Changed**：
  - 更新 `mysql-mcp/src/index.ts` 导出 `ChangeManager`、`CHANGE_LIMITS`、`changeTools`、`createWriteSession` 等模块；
  - 全量应用测试套件扩充至 7 个（新增 `changes.test.mjs` 113 项，扩充 `sql-policy.test.mjs` 至 296 项），测试用例总数由 307 项扩展至 603 项全绿通过。

### 发版亮点摘要 (Highlights)
Phase 4-A 标志着 MySQL MCP 正式构建了业界领先的零信任受控写入审批与状态机架构！通过 10 状态生命周期引擎、单次 Nonce 挑战、AST 结构指纹比对、执行前意图落盘及网络断连 UNKNOWN 绝不重试机制，从根本上杜绝了 AI 误写、重写与越权写入风险。全量应用测试扩充至 603 项，全仓治理/协作/应用累计 805 项测试全部通过。

---

## 🛠️ Agent 工程上下文与架构演进（面向开发者与后续 Agent）

### 1. 架构与设计决策 (Why & Design)
- **10 状态确定性状态机与意图持久化日志 (`changes.json`)**：
  写操作（DML/DDL）具有不可逆性和副作用，非幂等性决定了状态机必须具备崩溃恢复确定性。在向 MySQL 派发物理写包前，意图必须原子落盘为 `EXECUTING`。若系统在执行阶段发生崩溃或掉电，重启加载日志时，无法证明底层数据库是否已提交该事务，因此坚决不能将其视作失败重跑，而必须置为 `UNKNOWN` 终态，并生成非重试诊断，交由 DBA 或人工排查。
- **原始 SQL 仅内存保留与敏感信息脱敏**：
  SQL 语句中可能包含敏感业务数据（如身份证号、手机号或明文初始密码）。为防止敏感信息在静态存储或工具流转中泄漏，明文 SQL 仅在内存中的未终态申请详情中保留；`changes.json` 日志、`GET /api/v1/changes` 列表与 MCP `get_change_status` 工具中仅包含 `sql_sha256` 摘要与 AST 提取的影响概述（`effect_summary`）。
- **单次 Nonce 挑战与双重版本防护**：
  为抵御 CSRF、点击劫持与并发重放攻击，Fastify 决策接口设计了基于会话的 32 字节 Hex Nonce 机制。在 Web 控制台拉取变更详情时签发 Nonce，并在提交决策时比对消费，消费后立即销毁。同时，决策请求必须携带当时审查的 SQL SHA-256 摘要与连接版本号，若在审查期间底层连接发生变动或 SQL 被篡改，状态机立即拒绝并置为 `INVALIDATED`。
- **客户端原生确认探针与安全降级红线**：
  MCP 规范中原生确认极易受客户端能力实现差异影响。为保证安全，系统要求客户端必须具备受信版本模式记录，并通过无副作用探针（`accept` / `decline` / `cancel`）实机核验。更重要的是，原生确认仅限 L1 中低危 DML；凡涉及无 WHERE 更新或 DDL 结构变更的 L2 高危操作，一律强制要求打开 Web 管理控制台进行全量结构指纹比对与人工二次确认；原生拒绝或取消坚决不进行 Web 自动后备。

### 2. 实际改动文件与逻辑清单 (What)
- **变更状态机与持久化日志 (`mysql-mcp/src/changes/`)**：
  - `types.ts`：定义 10 状态枚举、`ChangeRequest`、`WebDecision`、`CHANGE_LIMITS` 预算及相关类型；
  - `journal.ts`：实现脱敏最小状态日志持久化（`changes.json`，`schema_version: 1`），执行前落盘，重启对未决意图安全恢复为 `UNKNOWN`；
  - `manager.ts`：实现 `ChangeManager`，管理并发限制、内存预算、5 分钟超时清理、连接变动联动失效及独占写租约；
- **Fastify 审批与决策服务 (`mysql-mcp/src/server/`)**：
  - `changes.ts`：实现 `GET /api/v1/changes`、`GET /api/v1/changes/:id`、`POST /api/v1/changes/:id/decision`，集成 Nonce 挑战与认证 Cookie 校验；
  - `app.ts`：挂载 changes 路由并注入 `ChangeManager`；
  - `connections.ts`：扩展连接独占写租约 `withWriteConnection`，在写执行期间互斥阻断并发读写与配置变更；
  - `errors.ts`：完善 HTTP 错误码映射（如 409 `STATE_CONFLICT`）；
- **MCP 协议与变更工具层 (`mysql-mcp/src/mcp/`)**：
  - `change-tools.ts`：定义 `request_change` 与 `get_change_status` 工具 Schema 与处理器；
  - `native.ts`：实现客户端原生确认探针与受信分级策略；
  - `server.ts`：集成 7 个工具（5 读 + 2 写），并在独立启动时为未注入服务提供安全的 `SERVICE_UNAVAILABLE` 兜底；
- **SQL 策略与回环写驱动 (`mysql-mcp/src/sql/`)**：
  - `policy.ts` 与 `ast.ts`：扩充 DML/DDL 策略矩阵（F12~F18）、结构指纹计算与白名单约束；
  - `write-driver.ts`：实现回环未池化写执行器，显式 `autocommit`，禁用多语句/本地文件，超时 30 秒主动熔断；
- **自动化测试套件 (`mysql-mcp/tests/`)**：
  - `changes.test.mjs`：新增 113 项变更引擎、状态流转、Nonce 挑战与持久化恢复测试；
  - `sql-policy.test.mjs`：扩充至 296 项 DML/DDL 语法树策略判定测试；
  - `mcp.test.mjs`、`server.test.mjs`、`tools.test.mjs`：同步调整与回归测试，全量应用测试达 603 项。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **避坑警示 1（UNKNOWN 绝对禁止自动重试）**：
  在网络中断、套接字超时或异常终止时，状态机将变更置为 `UNKNOWN`。后续 Agent 在处理此状态时，绝对不能编写任何自动化轮询或重试重放逻辑。因为 MySQL 服务端可能已经成功提交了写入，再次执行将导致灾难性重复数据或语法错误。
- **避坑警示 2（Phase 4-B 前端尚未落地）**：
  本任务仅完成 Fastify 服务端审批路由与 MCP 工具链，Web 页面端（`mysql-mcp/web/`）的前端审批界面尚未实现，将由 Antigravity 在随后的 Phase 4-B（TASK-APP-007）中落地。当前接口返回的 `management_url` 仅为定位契约，不可误认为前端已经就绪。
- **避坑警示 3（外部并发 DDL 与不可证明的元数据）**：
  本地独占写租约只能管理本进程内的并发冲突，无法锁定外部 DBA 或其他客户端对 MySQL 的并发操作。若数据库缺少对视图、触发器或外键元数据的可证明查询权限，执行器将采取 fail-closed 策略拒绝派发，不可盲目修改策略放行。
