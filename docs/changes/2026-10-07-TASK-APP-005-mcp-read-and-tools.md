# [TASK-APP-005] Phase 3 受限读取与 MCP 工具协议骨架实现

- 变更日期：2026-10-07
- 关联任务：TASK-APP-005
- 关联 PR：[#15](https://github.com/ArturiaGit/mysql-mcp/pull/15)
- 关联 Commit：[`bcf7866`](https://github.com/ArturiaGit/mysql-mcp/commit/bcf7866cd838109f14ffb7d03cf9e05654f03fbb)
- 责任执行方：Antigravity (Planning & Documentation Delivery) × PI-Desktop (Implementation)
- 关联功能/需求：F07, F08, F09, F10, F11 / R04, R05, R06, R08, R16, R17

---

## 📢 发版说明（Release Notes / 面向用户与下游）

### 变更分类与追溯条目
- **🚀 Added**：
  - 在 `mysql-mcp/src/mcp/` 落地 5 个核心受限读取与元数据探查 MCP 工具（`list_connections`、`list_databases`、`list_tables`、`describe_table`、`query`）：
    - 严格 JSON Schema 参数定义（`additionalProperties: false`），工具分发器（`argumentsFor`）前置拦截任何未声明属性（如 `password`、`credential_ref`、`confirmed`、`max_rows` 等），强校验 UTF-8 编码与不可见控制字符；
    - `list_connections`：输出脱敏连接视图列表（至多 256 项），绝不建立数据库物理连接，绝不外泄密码与凭据引用；
    - `list_databases`：以受限账号实际可见性为准列出数据库（`SHOW DATABASES`）；
    - `list_tables`：列出指定数据库的表与视图列表（`information_schema.TABLES`）；
    - `describe_table`：获取指定表的字段声明（名称、类型、是否可空、主键、列序号）与索引信息（名称、列名、唯一性、序号）；
    - `query`：执行受限只读 SQL 查询，强限制 AST L0 SELECT，禁止写入与副作用操作；
  - 在 `mysql-mcp/src/mcp/transport.ts` 建立 `BudgetTransport` 传输预算守卫：
    - JSON-RPC 请求 ID 限制在 256 字节以内；
    - 完整 JSON-RPC 消息帧（含协议包装）限制在 1MiB (`1,048,576` 字节) 以内；
    - 超过预算立即主动熔断并关闭传输通道，向 stderr 输出固定脱敏诊断，坚决不回显超限 ID 或超大载荷；
  - 在 `mysql-mcp/src/mcp/tools.ts` 建立 `ReadToolService` 独立服务类：
    - 支持 `ConnectionService` 与 `ReadSessionFactory` 依赖注入；
    - 最大并发数限制为 4，单次执行超时硬时限为 15 秒；
    - 联动 `AbortController`，在客户端取消或超时时主动中断查询并释放系统资源；
  - 在 `mysql-mcp/src/sql/readonly.ts` 建立只读 SQL 预处理引擎 (`prepareReadonlySql`)：
    - 静态校验必须满足 AST L0 SELECT（拒绝 L1 写入、L2/L3 语句及 SHOW/EXPLAIN）；
    - 语法树尾节点注入 `LIMIT 1001` 哨兵，现有 LIMIT 收敛至至多 1001；
    - 重新序列化后二次送入 `evaluateSql` 执行完整 AST 策略判定，杜绝序列化注入风险；
  - 在 `mysql-mcp/src/sql/driver.ts` 建立逐请求独立只读会话工厂 (`mysqlReadSession`)：
    - 逐请求独立创建未池化 MySQL 连接，设置 `SET SESSION MAX_EXECUTION_TIME = 15000` 与 `START TRANSACTION READ ONLY`；
    - 固定元数据 SQL 占位绑定采用 SQL mode 无关的 UTF-8 16进制转换（`CONVERT(X'...' USING utf8mb4)`）；
    - 流式逐行拉取（`highWaterMark: 1`），查询结束后无论成功异常均立即主动销毁连接（`connection.destroy()`）；
  - 在 `mysql-mcp/src/sql/results.ts` 建立流式结果收集与输出截断器 (`collectRows`)：
    - 最大行数 1000 行（超限标记 `truncation_reason: 'row_limit'`）；
    - 最大列数 128 列、最大单字段 64KiB、最大编码后 MCP 文本帧 1MiB（超限标记 `truncation_reason: 'byte_limit'`）；
    - `BIGINT` 与 `DECIMAL` 强制转换为高精度字符串，避免 JavaScript 浮点截断；
    - 日期保持原始文本格式，二进制与 BIT 字段编码为标准 `base64` 文本；
  - 在 `mysql-mcp/src/server/connections.ts` 扩展 `withReadConnection` 多读者并发只读租约：
    - 基于内存计数 Map 支持同连接多读并发复用配置；
    - 活跃读租约持有期间，对该连接发起的 `PATCH` 编辑或 `DELETE` 删除操作一律返回 `409 STATE_CONFLICT` 坚决阻断；
  - 在 `mysql-mcp/tests/tools.test.mjs` 落地 108 项 MCP 工具测试套件，`mcp.test.mjs` 扩充至 12 项，全量应用测试扩充至 307 项全绿通过。
- **🔒 Security**：
  - **凭据零泄露**：所有 MCP 响应完全剔除 `password` 与 `credential_ref`，仅暴露脱敏后的 `ConnectionView`；
  - **只读 AST 强过滤**：所有用户输入 SQL 必须先通过 AST 静态分类，非 L0 SELECT 语句在派发前直接拦截，绝不接触底层数据库网络驱动；
  - **LIMIT 哨兵与防全表拉取**：强制注入 `LIMIT 1001` 哨兵，结果集在 1000 行处受控截断，杜绝无意或恶意拉取百万行撑爆客户端；
  - **传输预算与防 DoS 熔断**：请求 ID 超过 256 字节或整帧超过 1MiB 立即断开传输，不回显任何可能包含秘密的输入数据；
  - **回环地址硬性隔离**：默认执行器仅允许连接 `127.0.0.1`、`localhost`、`::1`，远程目标在 TLS 策略冻结前返回 `SERVICE_UNAVAILABLE`；
  - **未池化独立连接**：每个只读请求使用全新独立 MySQL 会话，杜绝连接池复用造成的临时表、用户变量或会话状态串用。
- **🔄 Changed**：
  - 更新 `mysql-mcp/src/index.ts` 导出 `ReadToolService`、`readTools`、`READ_LIMITS`、`collectRows`、`mysqlReadSession` 等核心类与函数；
  - 全面同步 8 份架构规约文档，记录 Phase 3 受限读取实现事实与安全边界。

### 发版亮点摘要 (Highlights)
Phase 3 标志着 MySQL MCP 正式具备了生产级受限读取与 MCP 工具执行能力！在 `@modelcontextprotocol/sdk` Stdio 传输基础上，落地了 5 个核心只读工具；首创“AST L0 校验 + LIMIT 1001 哨兵改写 + 二次 AST 复验”三重防线，结合 1000 行/128 列/64KiB 字段/1MiB 整帧多重截断与传输层预算守卫。应用自动化测试由 190 项扩展至 307 项，全仓治理/协作/应用累计 509 项测试全绿通过。

---

## 🛠️ Agent 工程上下文与架构演进（面向开发者与后续 Agent）

### 1. 架构与设计决策 (Why & Design)
- **逐请求独立会话而非长连接池**：
  长连接池在多租户或多目标场景下极易发生隐式会话污染（如未清理的用户变量 `@var`、临时表、SQL mode 漂移等）。为贯彻零信任安全原则，Phase 3 受限读取采用逐请求独立未池化会话，每次调用独立握手并显式执行 `SET SESSION MAX_EXECUTION_TIME` 与 `START TRANSACTION READ ONLY`，并在查询结束或异常时立即调用 `connection.destroy()` 彻底销毁套接字。
- **LIMIT 1001 哨兵注入与二次 AST 复验**：
  即便经过静态 AST 校验为 SELECT，用户 SQL 若未指定 LIMIT 或包含超大 LIMIT（如 `LIMIT 1000000`），仍可能导致数据库大规模扫描。通过语法树注入 `LIMIT 1001` 哨兵，可以在数据库层面将返回结果限制在 1001 行内（刚好用于判断是否超过 1000 行上限触发 `row_limit` 截断）。为防止语法树序列化（`sqlify`）可能存在的转义漏洞，改写后的 SQL 必须经过二次 `evaluateSql` 复验，确保其依然为纯粹的 L0 SELECT。
- **固定元数据语句的 UTF-8 16进制转换绑定**：
  探查库表结构的元数据语句（如 `information_schema.TABLES` 与 `COLUMNS`）需要传入数据库名或表名。由于 MySQL 标识符与字符集可能受到客户端连接或 SQL mode（如 `ANSI_QUOTES`）影响，直接拼接或普通转义容易引入歧义。通过将动态值转换为 `CONVERT(X'...' USING utf8mb4)`，实现了与 SQL mode 完全无关的确定性安全绑定。
- **多读者读租约与并发状态保护**：
  在 Fastify 管理控制台与 MCP 工具并发运行的场景下，若用户在 MCP 工具正在读取某连接时通过 Web 页面修改密码或删除连接，会导致凭据失效或状态错乱。通过在 `ConnectionService` 中引入 `withReadConnection` 读租约（计数 Map），在读取期间为连接增加活跃读者计数；此时任何 `PATCH` 或 `DELETE` 操作均返回 `409 STATE_CONFLICT` 拒绝执行，保障了读取事务的完整性。

### 2. 实际改动文件与逻辑清单 (What)
- **MCP 协议与工具层 (`mysql-mcp/src/mcp/`)**：
  - `tools.ts`：定义 5 个读取工具 Schema，实现参数边界校验器 `argumentsFor` 与服务分发器 `ReadToolService`；
  - `transport.ts`：实现 `BudgetTransport`，拦截超长请求 ID（>256B）与超大 JSON-RPC 消息帧（>1MiB）；
  - `server.ts`：扩展 `createMcpServer` 与 `startStdioServer`，支持注入 `ReadConnections` 与自定义选项；
- **SQL 执行与只读驱动层 (`mysql-mcp/src/sql/`)**：
  - `readonly.ts`：实现 `prepareReadonlySql`，执行 AST L0 校验、LIMIT 1001 哨兵改写与二次复验；
  - `results.ts`：定义 `READ_LIMITS`，实现 `collectRows` 流式结果收集、字段与行数截断及类型序列化；
  - `driver.ts`：实现 `mysqlReadSession`，提供逐请求独立会话、只读事务、超时限制与流式查询；
  - `read-errors.ts`：定义 `ReadError`、安全错误代码枚举与脱敏映射白名单；
- **连接管理与主入口 (`mysql-mcp/src/`)**：
  - `server/connections.ts`：实现 `withReadConnection` 多读者并发读租约；
  - `index.ts`：聚合导出 Phase 3 新增类与函数；
- **测试套件与构建配置 (`mysql-mcp/tests/` & `scripts/`)**：
  - `tests/tools.test.mjs`：新增 108 项受限读取与截断自动化测试；
  - `tests/mcp.test.mjs`：扩充至 12 项 MCP Stdio 与 BudgetTransport 测试；
  - `scripts/build.mjs`：联动运行全部 6 个测试套件（307 项测试全部通过）。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **避坑警示 1（输出受控截断不等于物理硬内存上限）**：
  应用层施加的 1000 行、128 列、64KiB 字段及 1MiB 整帧预算属于输出保护，`mysql2` 驱动接收单个底层网络包依然先在内部解码。切勿在架构文档或宣称中将应用层截断当成进程物理硬内存上限。
- **避坑警示 2（直接 stdio 模式与显式依赖注入）**：
  若直接作为独立子进程启动 `node mysql-mcp/dist/mcp/server.js`，由于未通过代码注入 `ConnectionService`，调用任何数据库工具均安全返回 `SERVICE_UNAVAILABLE`。服务端坚决不自行猜测或遍历本地配置路径。集成 MCP 时务必使用代码方式通过 `createMcpServer({ connections })` 显式注入连接服务。
- **避坑警示 3（默认适配器仅限回环目标）**：
  当前默认 MySQL 适配器（`mysqlReadSession`）硬性限制主机仅允许 `127.0.0.1`、`localhost`、`::1`。连接远程主机返回 `SERVICE_UNAVAILABLE`。后续若开放远程数据库，必须先在规划阶段冻结 TLS 证书校验策略。
- **避坑警示 4（query 工具仅限 L0 SELECT）**：
  `query` 工具仅接受纯 SELECT 语句。任何 SHOW、DESCRIBE、EXPLAIN 语句均不在 `query` 允许范围内（探查元数据必须使用 `list_databases`、`list_tables`、`describe_table` 专用工具）。
- **避坑警示 5（contractHash 冻结与基线保护）**：
  在 `documentation_delivery` 阶段，严禁修改 planning 已冻结的 `docs/plans/`、`governance/features.json`、`governance/checks.json`、`docs/REQUIREMENTS.md`、`docs/ACCEPTANCE.md`、`docs/PROJECT_CONSTRAINTS.md` 等合同文件，否则会导致 `contractHash` 不匹配触发 `plan/code drift` 交付拦截。

### 4. 验证证据 (Verification)
- `node mysql-mcp/scripts/build.mjs`：307/307 pass（smoke 6, keyring 5, sql-policy 113, mcp 12, server 63, tools 108），exit 0；
- `node mysql-mcp/scripts/compile.mjs`：严格 `tsc --noEmit` exit 0；
- `node scripts/governance/check.mjs`：静态治理检查通过；
- 治理套件：89/89 pass；
- 协作套件：113/113 pass；
- 最终隔离快照合计 509 项测试无失败/跳过/取消。
