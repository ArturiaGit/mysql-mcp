# Phase 3 受限读取与 MCP 工具执行证据索引

任务 TASK-APP-005；功能 F07, F08, F09, F10, F11；分支 `feat/mcp-read-and-tools`；基线 `e94b44660a7c5a720e74c02cc419111db244b066`。实施范围见[计划](../plans/mcp-read-and-tools.md)，接口见[协议](../API_AND_PROTOCOLS.md)，数据模型见[模型](../DATA_MODELS.md)，策略见[SQL 矩阵](../SQL_POLICY_MATRIX.md)，分工见[全栈分工规范](../FULLSTACK_DIVISION_SPECIFICATION.md)。

## 1. 执行记录与可复核来源

完整检查以 `governance/handoffs/TASK-APP-005.json` 历史链条为准：
- **E1 ~ E2 (Planning)**：Antigravity 初始化任务，锁定功能 F07/F08/F09/F10/F11 范围，制定实施计划与安全契约，生成 planning handoff（E2，SHA256: `b6dc4f9e31af13da8a129c3d5e83443779366209bbf0240366583b7811b6b43e`）；
- **E3 (Receipt)**：PI-Desktop 在 `mode: "code"` 下作为后端执行者，显式核验接受 E2（E3，SHA256: `0d66aa1a3d11839b3af4abc2cbc27c9554e33c59e0f9b8c8c5e90df3226ce2be`）；
- **E4 (Begin Implementation)**：PI-Desktop 启动 implementation 阶段（E4，SHA256: `a0ed7421d60236b0e3a75d3125d1419ad7d4cac791568db184a82ee365949d08`），专职在 `mysql-mcp/src/` 与 `mysql-mcp/tests/` 落地受限读取 MCP 工具、执行器驱动与测试套件；
- **E5 (Implementation Handoff)**：完成 5 个受限读取工具（`list_connections`、`list_databases`、`list_tables`、`describe_table`、`query`）、`BudgetTransport` 帧预算守卫、`ReadToolService` 依赖注入、AST 只读策略与 LIMIT 哨兵改写、流式行收集截断与未池化连接适配；运行 builds 与隔离快照 `run.mjs` 全绿通过，生成 implementation handoff（E5，SHA256: `711cb0c4def7af09b415923b74d68642f1952986134ddfc0dde4db0b79c20738`）；
- **E6 ~ E7 (Documentation Delivery)**：Antigravity 显式核验接受 E5（E6，SHA256: `deaa30f9a0a5a4fb3c37fce4169c8eaa3c4d13710b769e01c1b743134bc9ed76`），启动 documentation_delivery 阶段（E7，SHA256: `5c7155465160c3b3c489e85e3d2051548272ce02b5678ec8cf979bd5e49bb518`），同步变更记录、架构规范、验证证据并准备最终 Git 交付。

## 2. 真实检查与测试覆盖

在隔离快照中实际执行以下全部检查，所有命令均以 exit code 0 退出，零失败/跳过/取消/超时：
- **治理套件 (governance-tests)**：`node --test --test-reporter=tap tests/governance/governance.test.mjs`，通过 89/89；
- **协作套件 (collaboration-tests)**：`node --test --test-reporter=tap tests/governance/collaboration.test.mjs tests/governance/collaboration-git.test.mjs`，通过 113/113；
- **应用构建契约 (app-build)**：`node mysql-mcp/scripts/build.mjs`，清理 `dist/`，编译产物并执行全部 6 个测试套件共 307 项应用断言全部通过：
  1. `smoke.test.mjs`：脚手架冒烟测试（6/6 pass）；
  2. `keyring.test.mjs`：Windows 系统凭据 CRUD 实测（5/5 pass）；
  3. `sql-policy.test.mjs`：L0~L3 策略矩阵与 AST 分析测试（113/113 pass）；
  4. `mcp.test.mjs`：MCP 协议交互与 BudgetTransport 测试（12/12 pass）；
  5. `server.test.mjs`：Fastify 接口路由与会话/存储测试（63/63 pass）；
  6. `tools.test.mjs`：受限读取 5 工具严格 Schema、截断、脱敏与驱动测试（108/108 pass）；
- **应用编译契约 (app-compile)**：`node mysql-mcp/scripts/compile.mjs`，严格 `tsc --noEmit` 检查通过，exit code 0；
- **全量测试合计**：治理 89 + 协作 113 + 应用 307 = 509 项测试，无一失败。

## 3. 安全与执行核心落地

1. **五工具严格参数 Schema 与白名单校验**：
   - 显式声明 `additionalProperties: false`，拦截任何额外参数输入（如 `password`、`credential_ref`、`confirmed`、`max_rows`）；
   - 严格类型检查、UTF-8 完整性校验、不可见控制字符拦截及标识符正则约束；
2. **AST 只读强制策略与 LIMIT 哨兵改写**：
   - `query` 工具硬性拦截非 L0 SELECT 语句（不接受 L1 写入、L2/L3 语句或 SHOW/EXPLAIN）；
   - 语法树尾节点注入 `LIMIT 1001` 哨兵，现有 LIMIT 收敛至至多 1001；
   - 经 `sqlify` 重新序列化后，必须二次送入 `evaluateSql` 执行完整策略判定，杜绝注入风险；
3. **固定元数据 SQL 占位绑定**：
   - 探查元数据语句采用固定模板，动态参数使用 SQL mode 无关的 UTF-8 16进制转换（`CONVERT(X'...' USING utf8mb4)`），消除转义歧义；
4. **输出规模与传输层预算硬上限**：
   - 最大行数 1000 行（超限标记 `truncation_reason: 'row_limit'`）；
   - 最大列数 128 列、最大单字段 64KiB、最大编码后响应整帧 1MiB（超限标记 `truncation_reason: 'byte_limit'`）；
   - `BudgetTransport` 严格限制 JSON-RPC 请求 ID 序列化 <= 256 字节，整帧 <= 1MiB，超限主动熔断关闭传输且不回显载荷；
5. **并发隔离与主动结算**：
   - 并发上限 4，超时预算 15 秒；
   - 超时或取消通过 `AbortController` 触发底层 `connection.destroy()`，主动释放读租约与并发插槽；
   - `ConnectionService` 读租约（`withReadConnection`）在执行期间锁定连接，阻断并发 `PATCH` 与 `DELETE`（`409 STATE_CONFLICT`）。

## 4. 证据边界与未验收限制

- **诊断声明限制**：本地执行产生的 `run.json` 与嵌入 TAP 日志仅为本地诊断证据，必须以 GitHub Actions 独立 CI 与用户人工验收为最终基准。
- **真实 MySQL / 桌面客户端限制 (F07–F11)**：当前测试基于纯内存驱动沙箱与官方 SDK stdio 协议测试，尚未连接真实外部 MySQL 数据库，尚未在实际桌面客户端（Codex / PI-Desktop / WorkBuddy）中完成人工场景核验。因此 F07–F11 功能状态在台账中保持未验收（`planned`）。
- **进程硬内存上限边界说明**：应用层受控截断不等于 `mysql2` 底层接收单包或数据库扫描的进程硬内存上限；超时销毁套接字不证明远端 MySQL 执行已立刻中止。
- **回环目标限制**：默认适配器当前仅允许连接 `127.0.0.1`、`localhost`、`::1`；远程 TLS 证书契约未冻结前拒绝远程连接。
