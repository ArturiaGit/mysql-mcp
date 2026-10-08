# 接口与通信协议

> 状态：全部接口为未实现草案。模型以[数据模型](./DATA_MODELS.md)为准，安全以[约束](./PROJECT_CONSTRAINTS.md)为准。

## 1. 通用契约

HTTP 拟用 `/api/v1`；监听 `127.0.0.1`，端口待实现确定。JSON 字段 snake_case，拒绝未知敏感控制字段，限定请求体大小和字符串长度。所有成功响应为 `{ "ok": true, "data": ... }`，失败为 `{ "ok": false, "error": { "code": "...", "message": "脱敏说明" } }`。状态查询成功与 SQL 成功不同：HTTP 200 可以承载 state=UNKNOWN。

列表采用 `{ items, next_cursor }`，next_cursor 为 null 表示当前列表遍历结束；这与 SQL 返回截断不混用。分页上限实施时锁定。浏览器接口禁止缓存敏感响应，不返回 credential_ref、密码、内部令牌或原生挑战。

### 2. MCP 受限读取与元数据工具契约（Phase 3 落地实现）

在 Phase 3 (TASK-APP-005) 中，系统落地了 5 个核心受限读取与元数据探查 MCP 工具，具备严格的参数 Schema 校验、逐请求目标隔离与结果封装：

| 工具名 | 严格参数规范 | data 响应载荷 | 副作用与权限边界 |
|---|---|---|---|
| `list_connections` | `{}`（参数可选或为空对象，无必填） | `{ items: ConnectionView[], next_cursor: null }`（上限 256 项） | 纯内存/文件视图读取，**绝不建立数据库连接**，绝对剔除密码与凭据引用 |
| `list_databases` | `connection_id: string` (36 字符 UUID v4) | `{ items: string[], next_cursor: null }` | 独立只读会话执行 `SHOW DATABASES`，仅列出当前账号实际可见数据库 |
| `list_tables` | `connection_id: string`<br>`database: string` (1..64 字符 ASCII 标识符) | `{ items: { name: string, type: 'table' \| 'view' }[], next_cursor: null }` | 查询 `information_schema.TABLES`，返回指定库的基表与视图列表 |
| `describe_table` | `connection_id: string`<br>`database: string`<br>`table: string` (1..64 字符) | `{ columns: ColumnInfo[], indexes: IndexInfo[] }` | 查询 `information_schema.COLUMNS` 与 `STATISTICS`，目标不存在返回 NOT_FOUND |
| `query` | `connection_id: string`<br>`database: string`<br>`sql: string` (1..65536 字符) | `QueryResult`（最多 1000 行，128 列，受控截断） | **严格仅限 AST L0 SELECT**，禁写操作、禁多语句、禁用户变量、禁跨库访问 |
| `request_change` | `connection_id: string` (UUID v4)<br>`database: string` (1..64 字符)<br>`sql: string` (1..65536 字符)<br>`reason?: string` (1..2048 字符) | `{ request_id, state: 'PENDING', confirmation_channel: 'web' \| 'native', management_url, risk_codes, expires_at }` | **DML/DDL 变更排队**；进行 AST L1/L2 策略与目标一致性校验，生成指纹与单次 Nonce，无自动批准入口 |
| `get_change_status` | `request_id: string` (36 字符 UUID v4) | `{ request_id, state, updated_at, result?, error_code?, effect_note? }` | **仅查当前 MCP 会话请求状态**；返回十状态与执行回执或脱敏错误，**绝不自动重试 SQL** |

### 2.1 参数校验与模式强化
- **严格 JSON Schema 与无额外属性**：所有工具 Schema 显式声明 `additionalProperties: false`；工具分发器前置拦截任何额外属性（严禁传入 `password`、`credential_ref`、`confirmed`、`max_rows` 等未声明字段）；
- **参数合法性防线**：拒绝非法 UTF-8 编码、控制字符（`[\x00-\x1f\x7f]`）、空字符串或纯空白；`database` 强制校验正则 `^[A-Za-z_][A-Za-z0-9_]{0,63}$`；
- **显式目标绑定**：除 `list_connections`（无需目标）和 `list_databases`（仅需 `connection_id`）外，所有数据库调用必须显式提供 `connection_id` 与 `database`，严禁隐式继承默认库；
- **工具注解**：5 个只读工具标注 `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }`；`request_change` 标注 `{ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }`；`get_change_status` 标注 `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`。

### 2.2 响应格式与错误包装
MCP 工具响应在 `CallToolResult` 的 `content` 中承载序列化 JSON 文本帧：
- **成功响应** (`isError: false`)：
  ```json
  {
    "content": [{ "type": "text", "text": "{\"ok\":true,\"data\":{...}}" }],
    "isError": false
  }
  ```
- **业务受控错误** (`isError: true`)：
  ```json
  {
    "content": [{ "type": "text", "text": "{\"ok\":false,\"error\":{\"code\":\"SQL_NOT_ALLOWED\",\"message\":\"SQL is outside the supported policy.\"}}" }],
    "isError": true
  }
  ```
- **未知工具调用**：若客户端调用未注册工具，服务端直接抛出 JSON-RPC 级 `McpError(ErrorCode.MethodNotFound, 'Tool is not available.')`，**严禁回显客户端传入的工具名或参数内容**，杜绝参数夹带的敏感信息在报错中反弹。

## 3. 浏览器管理 HTTP 契约（Phase 2-A & Phase 4-A 落地实现）

除建立会话的受控接口外，所有业务管理接口均需有效浏览器会话。所有变更型请求强制验证 CSRF、Origin、Host；页面认证不能被 MCP 内部令牌替代。所有路由拒绝任何 query 参数。

### 3.1 路由契约列表

| 方法与路径 | 必填 Header | 请求体 | 响应状态与数据结构 | 说明 |
|---|---|---|---|---|
| `POST /api/v1/session` | 无 | `{ local_code: string }` | 200 `{ ok: true, data: { csrf_token: string } }`<br>Set-Cookie: HttpOnly; Path=/; SameSite=Strict | 一次性高熵本地码（32字节HEX）换取会话；单次消费，限速每分钟最多10次；不返回会话秘密 |
| `DELETE /api/v1/session` | Cookie, x-csrf-token | 无（或空对象） | 200 `{ ok: true, data: { logged_out: true } }`<br>Set-Cookie 清空 | 注销并清理服务端内存会话与 CSRF Token |
| `GET /api/v1/connections` | Cookie | 无（拒绝任何 query 参数） | 200 `{ ok: true, data: { items: ConnectionView[], next_cursor: null } }` | 脱敏连接列表，至多256项，next_cursor 固定为 null（本阶段不分页）；列表项**绝不含密码或 credential_ref** |
| `POST /api/v1/connections` | Cookie, x-csrf-token | `{ name, host, port, username, default_database, password }` | 201 `{ ok: true, data: ConnectionView }` | 创建连接；输入严格校验；密码存入 Windows Keyring（服务名为 `mysql-mcp:<id>`）；分配稳定 UUID，version=1；返回脱敏资料 |
| `PATCH /api/v1/connections/:connection_id` | Cookie, x-csrf-token | `{ expected_version, name?, host?, port?, username?, default_database?, password? }` | 200 `{ ok: true, data: ConnectionView }`<br>版本冲突 409 STATE_CONFLICT<br>使用中 409 STATE_CONFLICT | 更新连接；校验 expected_version；留空/省略 password 保持原密码；替换密码分配新 UUID 引用以防回滚丢失；成功后 version 自增；触发旧待批请求 INVALIDATED |
| `DELETE /api/v1/connections/:connection_id` | Cookie, x-csrf-token | `{ expected_version }` | 200 `{ ok: true, data: { id: string, deleted: true } }`<br>版本冲突 409 STATE_CONFLICT<br>使用中 409 STATE_CONFLICT | 删除连接；校验 expected_version；同步清理 Windows Keyring 中凭据；返回删除摘要；触发旧待批请求 INVALIDATED |
| `POST /api/v1/connections/test` | Cookie, x-csrf-token | 草稿连接字段及 password | 200 `{ ok: true, data: { connected: boolean, simulated: boolean, duration_ms: number } }` | 测试草稿连接；只测试不保存，草稿数据不入库且不写 Keyring；默认模拟器返回 `{ connected: false, simulated: true }`，不宣称真实连通 |
| `POST /api/v1/connections/:connection_id/test` | Cookie, x-csrf-token | `{ expected_version }` | 200 `{ ok: true, data: { connected: boolean, simulated: boolean, duration_ms: number } }` | 测试已保存连接；从 Keyring 读取凭据进行测试，响应不回传凭据；测试期间持有读/使用锁，防止并发编辑或删除 |
| `GET /api/v1/changes` | Cookie | 无（拒绝任何 query 参数） | 200 `{ ok: true, data: ChangeSummary[] }` | 变更请求摘要列表；包含 ID、目标连接/库、操作、风险码、状态与过期时间；**列表项绝不包含原始 SQL 或审批 Nonce** |
| `GET /api/v1/changes/:request_id` | Cookie | 无（拒绝任何 query 参数） | 200 `{ ok: true, data: ChangeDetail }` | 获取指定变更详情；仅在内存活动时包含完整原始 SQL、reason 及绑定当前认证浏览器会话的单次 32 字节高熵 `approval_nonce` |
| `POST /api/v1/changes/:request_id/decision` | Cookie, x-csrf-token | `{ decision, approval_nonce, sql_fingerprint, connection_version }` | 200 `{ ok: true, data: { state, updated_at, result?, error_code?, effect_note? } }`<br>409 STATE_CONFLICT<br>409 APPROVAL_EXPIRED<br>409 CONNECTION_CHANGED | 提交审批决策（approve/reject/cancel）；严格核验单次 Nonce、SQL 指纹与连接版本；单次消费 Nonce；终态不重试；返回确定的执行状态与不可撤销说明 |


### 3.2 数据结构定义：ConnectionView
接口返回的脱敏连接视图定义如下：
```typescript
interface ConnectionView {
  id: string;                 // 稳定 UUID v4
  name: string;               // 连接名称 (1..64 字符)
  host: string;               // 数据库主机名 (1..255 字符)
  port: number;               // 端口号 (1..65535)
  username: string;           // 用户名 (1..128 字符)
  default_database: string | null; // 默认数据库 (可选, 1..64 字符)
  version: number;            // 乐观并发控制版本号 (自增整数)
}
```
**安全红线**：
1. `password` 仅在新增连接或明确修改密码的请求体中接收，绝对不出现在任何 GET/POST/PATCH 响应体中；
2. 服务端内部持久化使用的 `credential_ref` 属于系统内部敏感标识，绝对不对外暴露；
3. 编辑连接时省略或留空 `password` 表示保持原密码；
4. 测试已保存连接期间对该连接施加使用锁，若在测试中发起 PATCH 或 DELETE 操作，服务端返回 `409 STATE_CONFLICT` 明确阻断。

## 4. 内部桥接接口草案

拟置于独立 `/internal/v1` 命名空间，使用独立认证与会话授权，不接受浏览器 Cookie，不开放 CORS，不公开通用代理路由。

| 接口 | 责任 |
|---|---|
| POST /sessions | 验证内部身份并登记客户端版本、声明能力，返回内部 session_id |
| POST /operations | 严格枚举第 2 节工具与参数，绑定当前内部会话 |
| GET /challenges/:challenge_id | 获取仅属于当前会话且未消费的原生挑战 |
| POST /challenges/:challenge_id/response | 提交对应 elicitation 的 accept/decline/cancel 响应 |

原生 challenge_id 必须单次、不可预测，绑定 request_id、SQL、目标、连接版本和会话；服务端需检查原生资格。桥接的响应依据真实客户端协议回执，不从模型工具参数构造。此通道仍信任本地客户端，不宣称具备不可伪造的人类身份认证。

## 5. 原生确认与后备

- 客户端声明 elicitation 支持且对应版本/权限模式实测通过后，才使用 native 通道；否则创建 web 请求。
- 确认展示完整 SQL、目标、原因和风险，不允许只展示泛化“允许使用数据库工具”。
- accept 必须同时满足准确请求绑定和明确人工选择；decline → REJECTED，cancel → CANCELLED。
- 原生不可用可网页后备；原生拒绝不后备。已发挑战故障的切换须先撤销旧挑战，禁止两个通道并存。
- 网页返回的 management_url 是无秘密的本机页面地址；用户仍需登录，不携带自动批准参数。

## 6. 错误码与执行状态

| code | HTTP 建议 | 含义 |
|---|---|---|
| INVALID_ARGUMENT | 400 | 参数结构或值非法 |
| UNAUTHENTICATED | 401 | 未建立有效会话 |
| FORBIDDEN | 403 | 身份或接口权限不足 |
| NOT_FOUND | 404 | 对象不存在或对该会话不可见 |
| SQL_NOT_ALLOWED | 422 | 不支持、无法分类或被策略拒绝 |
| TARGET_MISMATCH | 422 | SQL 与显式数据库目标不一致 |
| CONNECTION_CHANGED | 409 | 连接版本变化，旧请求失效 |
| STATE_CONFLICT | 409 | 状态不允许此操作 |
| APPROVAL_EXPIRED | 409 | 审批有效期已过 |
| DB_ACCESS_DENIED | 403 | MySQL 返回权限不足 |
| DB_ERROR | 502 | 数据库确定返回错误，已脱敏 |
| EXECUTION_TIMEOUT | 504 | 执行超过预算；结合状态解释效果 |
| RESOURCE_LIMIT | 429 | 并发、队列或资源额度不足 |
| CREDENTIAL_STORE_UNAVAILABLE | 503 | 无法安全访问凭据存储 |
| SERVICE_UNAVAILABLE | 503 | 管理服务或执行依赖不可用 |
| INTERNAL_ERROR | 500 | 未分类内部错误，不返回堆栈秘密 |

PENDING/APPROVED/EXECUTING 是非终态；其余见模型。UNKNOWN 是执行结果状态，不当成可重试网络错误。FAILED 也不保证回滚。超时后只查询原 request_id，不能重新执行以“验证是否成功”。

## 7. 契约验收

须覆盖参数额外字段、会话越权、错误脱敏、stdio 噪声、确认回执绑定、重复响应、超时、取消、重启、精度和结果截断。原生 UI 与 MCP 实测结果分开记录；目前没有接口可调用，兼容矩阵见[部署指南](./DEPLOYMENT_GUIDE.md)。

---

## 8. MCP Server 服务架构与执行实现 (`createMcpServer` / `startStdioServer` / `ReadToolService` / `ChangeToolService`)

在 Phase 3 与 Phase 4-A 中，MCP Server 演进为具备读写分离、依赖注入、动态限额与主动取消的生产就绪服务架构：

- **工具暴露与服务分发 (`ReadToolService` & `ChangeToolService`)**：
  - `createMcpServer(options?: McpServerOptions)`：基于 `@modelcontextprotocol/sdk` 创建 Server 实例，挂载全部 7 个受限数据库工具（5 个只读工具与 2 个受控变更工具 `request_change`、`get_change_status`）；
  - **依赖注入契约**：接受可选参数 `{ connections?: ReadConnections; sessionFactory?: ReadSessionFactory; timeoutMs?: number; changes?: ChangeManager; nativeApproval?: NativeApprovalOptions }`；
  - **直接 stdio 模式防线**：若直接执行 `node mysql-mcp/dist/mcp/server.js` 或调用未注入依赖的 `startStdioServer()`，`tools/list` 正常列出 7 个工具定义，但调用任何数据库工具均安全返回 `{ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Read/change service is unavailable.' } }`，**坚决不自行猜测或扫描磁盘配置路径**；
  - **未知工具调用安全**：`tools/call` 请求若未匹配已知 7 个工具，抛出 `McpError(ErrorCode.MethodNotFound, 'Tool is not available.')`，**严禁回显客户端传入的工具名或参数对象**，杜绝参数泄密。
- **传输层预算守卫 (`BudgetTransport`)**：
  - 包装底层 `Transport`，在派发 SDK 与回传响应全链路施加硬上限校验；
  - **JSON-RPC 请求 ID 限制**：请求 ID 的 JSON 序列化字节数不得超过 256 字节；
  - **完整帧预算限制**：单条完整 JSON-RPC 消息（含协议包装）的 JSON 序列化字节数不得超过 1MiB (`1,048,576` 字节)；
  - **超限安全熔断**：一旦请求 ID 或整帧超过预算，触发错误并在 stderr 记录固定诊断，立即主动关闭传输通道，**坚决不回显超限 ID 或超大载荷**。
- **并发控制、超时与生命周期**：
  - **严格并发上限**：读取最多允许 4 项工具并发执行（`READ_LIMITS.max_concurrent = 4`），写入最多允许 4 项并发派发（`CHANGE_LIMITS.max_concurrent = 4`），超限拒绝并返回 `RESOURCE_LIMIT`；
  - **执行超时预算**：只读工具超时为 15 秒（`READ_LIMITS.timeout_ms = 15000`）；写入执行硬时限为 30 秒（`CHANGE_LIMITS.execution_timeout_ms = 30000`）；
  - **主动结算与资源销毁**：底层通过 `AbortController` 联动 SDK `extra.signal` 与内部超时定时器；取消或超时触发时立即销毁 MySQL 会话（`connection.destroy()`）、中断网络流、结算并归还租约与并发插槽；
  - **优雅关闭**：`server.close()` 与进程信号（EOF / SIGINT / SIGTERM）联动调用 `tools.close()` 与 `changes.close()`，中断所有活动中的 AbortController，确保无悬挂网络套接字；
  - **stdio 输出洁净**：stdout 仅输出合规的 JSON-RPC 协议帧，所有非致命协议异常仅向 stderr 输出固定脱敏诊断（`'MCP protocol error.\n'`）。

---

## 9. 同进程双通道集成契约 (`createLocalServer`)

在 Phase 4-A 中，Fastify 回环服务与 MCP 服务通过 `createLocalServer` 实现了显式同进程架构组装：
- **单一审批权威 (Single Authority)**：Fastify 路由挂载的 `ChangeManager` 与 MCP Server 绑定的 `ChangeManager` 为同一单例实例；
- **状态无缝互通**：MCP 工具 `request_change` 生成的变更请求即刻进入该实例内存并持久化日志，Web 管理控制台可通过 `/api/v1/changes` 实时查看并决策；决策后派发执行，MCP 客户端通过 `get_change_status` 可即时读取状态变迁；
- **数据精度保持**：执行结果计数 `WriteResult`（如 `affected_rows`、`last_insert_id`）支持安全整数或十进制数字符串，安全覆盖 uint64 边界（最大 `18,446,744,073,709,551,615`），杜绝 JS 浮点溢出精度截断。

