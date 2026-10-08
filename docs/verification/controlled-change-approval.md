# Phase 4-A 受控写入审批与状态机后端实现验证记录

任务 TASK-APP-006；功能 F12, F13, F14, F15, F16, F17, F18, F19, F20, F21；分支 `feat/controlled-change-approval`；基线 `817a701eda4e149890be4f2bf1bd4781d706ab7f`。实施范围见[计划](../plans/controlled-change-approval.md)，接口见[协议](../API_AND_PROTOCOLS.md)，数据模型见[模型](../DATA_MODELS.md)，策略见[SQL 矩阵](../SQL_POLICY_MATRIX.md)，分工见[全栈分工规范](../FULLSTACK_DIVISION_SPECIFICATION.md)。

## 1. 执行记录与可复核来源

完整检查以 `governance/handoffs/TASK-APP-006.json` 历史链条为准：
- **E1 ~ E2 (Planning)**：Antigravity 初始化任务，锁定功能 F12~F21 范围，制定 Phase 4-A 实施计划与安全契约，在 `governance/collaboration.json` 授权后端测试文件，生成 planning handoff（E2，SHA256: `218fbc7c9e1aaa4dd06536323f134b32b6a51cccf53e1aac3eab304416d817a6`）；
- **E3 (Receipt)**：PI-Desktop 在 `mode: "code"` 下作为后端执行者，显式核验接受 E2（E3，SHA256: `fc2909435b8fc6a978d38e2141525a1b3296068305f63d6b63ca04bf37dc323c`）；
- **E4 (Begin Implementation)**：PI-Desktop 启动 implementation 阶段（E4，SHA256: `13c9597f7fa20325fbf5eb2e482252a12aa91bb64c39f28c50c05feec08d1f7c`），专职在 `mysql-mcp/src/` 与 `mysql-mcp/tests/` 落地受控写入审批状态机、Fastify 路由、MCP 变更工具与自动化测试；
- **E5 (Implementation Handoff)**：完成 2 个变更 MCP 工具（`request_change`、`get_change_status`）、10 状态生命周期引擎、`changes.json` 脱敏意图日志持久化、Fastify 审批与单次 Nonce 挑战路由、客户端原生确认探针与分级策略、DML/DDL 策略矩阵支持及回环未池化写执行器；运行 builds 与隔离快照 `run.mjs` 全绿通过，生成 implementation handoff（E5，SHA256: `115b9e5c6a76995201b5f6984f57b0c0a0109040f86e4e5a5e956b35dd8a7ee6`）；
- **E6 ~ E7 (Documentation Delivery)**：Antigravity 显式核验接受 E5（E6，SHA256: `784d1c447bc9fe28d70df81e69623e1f74dd7e7caef8cfb274c43ba7eb904f46`），启动 documentation_delivery 阶段（E7，SHA256: `63a9008686864146d2d23f1893781e305c5f16af4932ef90e93483a4499e28b1`），同步变更记录、架构规范、验证证据并准备最终 Git 交付。

## 2. 真实检查与测试覆盖

在隔离快照中实际执行以下全部检查，所有命令均以 exit code 0 退出，零失败/跳过/取消/超时：
- **治理套件 (governance-tests)**：`node --test --test-reporter=tap tests/governance/governance.test.mjs`，通过 89/89；
- **协作套件 (collaboration-tests)**：`node --test --test-reporter=tap tests/governance/collaboration.test.mjs tests/governance/collaboration-git.test.mjs`，通过 113/113；
- **应用构建契约 (app-build)**：`node mysql-mcp/scripts/build.mjs`，清理 `dist/`，编译产物并执行全部 7 个测试套件共 603 项应用断言全部通过：
  1. `smoke.test.mjs`：脚手架冒烟测试（6/6 pass）；
  2. `keyring.test.mjs`：Windows 系统凭据 CRUD 实测（5/5 pass）；
  3. `sql-policy.test.mjs`：L0~L3 策略矩阵与 DML/DDL AST 分析测试（296/296 pass）；
  4. `mcp.test.mjs`：MCP 协议交互与 BudgetTransport 测试（13/13 pass）；
  5. `server.test.mjs`：Fastify 接口路由与会话/存储测试（64/64 pass）；
  6. `tools.test.mjs`：受限读取 5 工具严格 Schema、截断与脱敏测试（106/106 pass）；
  7. `changes.test.mjs`：变更引擎 10 状态机、Nonce 挑战、意图持久化与恢复测试（113/113 pass）；
- **应用编译契约 (app-compile)**：`node mysql-mcp/scripts/compile.mjs`，严格 `tsc --noEmit` 检查通过，exit code 0；
- **全量测试合计**：治理 89 + 协作 113 + 应用 603 = 805 项测试，无一失败。

## 3. 安全与执行核心落地

1. **两项变更 MCP 工具严格参数 Schema 与脱敏契约**：
   - `request_change` 与 `get_change_status` 严格声明 `additionalProperties: false`；
   - 原始 SQL 仅在内存中的未终态申请详情与原生审查中可见，MCP 状态轮询响应、列表路由及持久化存储中仅保留 `sql_sha256` 与 AST 影响摘要；
2. **10 状态确定性生命周期与 5 分钟超时销毁**：
   - 覆盖 `PENDING`、`APPROVED`、`EXECUTING`、`SUCCEEDED`、`FAILED`、`UNKNOWN`、`REJECTED`、`CANCELLED`、`EXPIRED`、`INVALIDATED`；
   - 待审批申请 300 秒无决策自动标记为 `EXPIRED`；终态记录保留 300 秒摘要后从内存清理；
   - 连接配置变更（`PATCH` / `DELETE`）立即级联失效该连接下的所有待审批申请（`INVALIDATED`）；
3. **单次 Nonce 挑战与双重版本防护**：
   - 查看变更详情时签发绑定认证浏览器会话的 32 字节 Hex `nonce`；
   - 决策接口比对消费后立即作废，重复提交返回 `409 STATE_CONFLICT`；
   - 决策校验审查时的 SQL SHA-256 摘要与连接版本，确保无审查漂移；
4. **客户端原生确认探针与受控分级策略**：
   - 仅在客户端版本声明与权限模式受信、且通过无副作用探针（`accept` / `decline` / `cancel`）实机核验后，方开放 L1 DML 原生确认；
   - L2 DDL 及高危 DML 强制要求 Web 管理控制台二次确认；原生拒绝或取消坚决不进行 Web 自动后备；
5. **意图原子落盘与 UNKNOWN 绝对非重试机制**：
   - 物理网络写包派发前，意图先落盘至 `changes.json`（`schema_version: 1`）为 `EXECUTING`；
   - 崩溃重启加载日志时，未决意图直接恢复为 `UNKNOWN` 终态，并返回非重试 `effect_note`，坚决不重放执行；
6. **独占写租约与回环未池化会话**：
   - 写操作占用连接独占租约，期间阻断并发读写与配置变更（`409 STATE_CONFLICT`）；
   - 回环目标执行，逐请求独立会话，显式 `autocommit: true`，禁用多语句与本地文件，30 秒超时熔断；
   - 派发前对无法证明的视图、触发器或外键级联采取 fail-closed 拦截。

## 4. 证据边界与未验收限制

- **诊断声明限制**：本地执行产生的 `run.json` 与嵌入 TAP 日志仅为本地诊断证据，必须以 GitHub Actions 独立 CI 与用户人工验收为最终基准。
- **真实外部 MySQL / 桌面客户端限制 (F12–F21)**：当前测试基于纯内存驱动沙箱与官方 SDK stdio 协议测试，尚未连接真实外部 MySQL 数据库，尚未在实际桌面客户端（Codex / PI-Desktop / WorkBuddy）中完成人工场景核验。因此 F12–F21 功能状态在台账中保持未验收（`planned`）。
- **Phase 4-B Web 审批界面限制**：本任务仅覆盖 Fastify 服务端审批路由与 MCP 工具链，Web 页面端控制台审批界面尚未实现，将由 Antigravity 在 Phase 4-B（TASK-APP-007）中落地。
- **进程硬内存上限与网络断连边界说明**：应用层受控截断不等于 `mysql2` 底层接收单包或数据库扫描的进程硬内存上限；超时销毁套接字不证明远端 MySQL 事务未被提交；UNKNOWN 状态绝对禁止自动化重试。
