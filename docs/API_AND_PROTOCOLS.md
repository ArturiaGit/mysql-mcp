# 接口与通信协议

> 状态：全部接口为未实现草案。模型以[数据模型](./DATA_MODELS.md)为准，安全以[约束](./PROJECT_CONSTRAINTS.md)为准。

## 1. 通用契约

HTTP 拟用 `/api/v1`；监听 `127.0.0.1`，端口待实现确定。JSON 字段 snake_case，拒绝未知敏感控制字段，限定请求体大小和字符串长度。所有成功响应为 `{ "ok": true, "data": ... }`，失败为 `{ "ok": false, "error": { "code": "...", "message": "脱敏说明" } }`。状态查询成功与 SQL 成功不同：HTTP 200 可以承载 state=UNKNOWN。

列表采用 `{ items, next_cursor }`，next_cursor 为 null 表示当前列表遍历结束；这与 SQL 返回截断不混用。分页上限实施时锁定。浏览器接口禁止缓存敏感响应，不返回 credential_ref、密码、内部令牌或原生挑战。

## 2. MCP 工具草案

| 工具 | 必填参数 | data 输出 | 副作用 |
|---|---|---|---|
| list_connections | 无 | items: connection_id/name/host/port/username/default_database | 无数据库写入 |
| list_databases | connection_id | items: 数据库名称 | 只读，以账号可见性为准 |
| list_tables | connection_id, database | items: 表名称及类型 | 只读 |
| describe_table | connection_id, database, table | columns、indexes 的结构化元数据 | 只读 |
| query | connection_id, database, sql | QueryResult | 仅允许受限读取 |
| request_change | connection_id, database, sql, reason | ChangeResult 加 expires_at、confirmation_channel，网页时含 management_url | 创建请求，确认前不写数据库 |
| get_change_status | request_id | ChangeResult | 仅查当前会话请求 |

connection_id 不接受名称猜测；database 必须明确，不从默认库省略推断。list_connections/list_databases 是元数据例外，无需人为填写 database。建库/删库虽可能没有可选默认库，仍需填写准确目标 database。reason 用于解释用户需求，不能充当审批。

MCP 工具不提供 password、confirmed、approval_token 参数，也不提供 approve_change 工具。JSON Schema 应禁止额外属性。重复 request_change 视为新意图，不能自动重试调用；已拿到 request_id 后只查询状态。同一请求的桥接层重传使用服务端会话内去重标识，不创建第二个执行机会。

MCP 基于协商版本的 JSON-RPC/stdio，stdout 只输出协议，日志到 stderr。工具业务失败以 MCP isError 标识并承载同一 code/message；协议格式错误走 JSON-RPC 错误。SDK structuredContent 是否可用须按协商能力处理；文本与结构化结果保持同义，不输出两份矛盾状态。

虚构、非执行示例：

```json
{
  "tool": "request_change",
  "arguments": {
    "connection_id": "conn_example",
    "database": "demo_sandbox",
    "sql": "INSERT INTO demo_notes (title) VALUES ('example')",
    "reason": "用户明确要求在隔离示例库添加记录"
  }
}
```

这不是现有库表或可直接执行命令，返回 PENDING 也不表示已经插入。

## 3. 浏览器管理 HTTP 契约（Phase 2-A 落地实现）

除建立会话的受控接口外，所有业务管理接口均需有效浏览器会话。所有变更型请求强制验证 CSRF、Origin、Host；页面认证不能被 MCP 内部令牌替代。

### 3.1 路由契约列表

| 方法与路径 | 必填 Header | 请求体 | 响应状态与数据结构 | 说明 |
|---|---|---|---|---|
| `POST /api/v1/session` | 无 | `{ local_code: string }` | 200 `{ ok: true, data: { csrf_token: string } }`<br>Set-Cookie: HttpOnly; Path=/; SameSite=Strict | 一次性高熵本地码（32字节HEX）换取会话；单次消费，限速每分钟最多10次；不返回会话秘密 |
| `DELETE /api/v1/session` | Cookie, x-csrf-token | 无（或空对象） | 200 `{ ok: true, data: { logged_out: true } }`<br>Set-Cookie 清空 | 注销并清理服务端内存会话与 CSRF Token |
| `GET /api/v1/connections` | Cookie | 无（拒绝任何 query 参数） | 200 `{ ok: true, data: { items: ConnectionView[], next_cursor: null } }` | 脱敏连接列表，至多256项，next_cursor 固定为 null（本阶段不分页）；列表项**绝不含密码或 credential_ref** |
| `POST /api/v1/connections` | Cookie, x-csrf-token | `{ name, host, port, username, default_database, password }` | 201 `{ ok: true, data: ConnectionView }` | 创建连接；输入严格校验；密码存入 Windows Keyring（服务名为 `mysql-mcp:<id>`）；分配稳定 UUID，version=1；返回脱敏资料 |
| `PATCH /api/v1/connections/:connection_id` | Cookie, x-csrf-token | `{ expected_version, name?, host?, port?, username?, default_database?, password? }` | 200 `{ ok: true, data: ConnectionView }`<br>版本冲突 409 STATE_CONFLICT<br>使用中 409 STATE_CONFLICT | 更新连接；校验 expected_version；留空/省略 password 保持原密码；替换密码分配新 UUID 引用以防回滚丢失；成功后 version 自增 |
| `DELETE /api/v1/connections/:connection_id` | Cookie, x-csrf-token | `{ expected_version }` | 200 `{ ok: true, data: { id: string, deleted: true } }`<br>版本冲突 409 STATE_CONFLICT<br>使用中 409 STATE_CONFLICT | 删除连接；校验 expected_version；同步清理 Windows Keyring 中凭据；返回删除摘要 |
| `POST /api/v1/connections/test` | Cookie, x-csrf-token | 草稿连接字段及 password | 200 `{ ok: true, data: { connected: boolean, simulated: boolean, duration_ms: number } }` | 测试草稿连接；只测试不保存，草稿数据不入库且不写 Keyring；默认模拟器返回 `{ connected: false, simulated: true }`，不宣称真实连通 |
| `POST /api/v1/connections/:connection_id/test` | Cookie, x-csrf-token | `{ expected_version }` | 200 `{ ok: true, data: { connected: boolean, simulated: boolean, duration_ms: number } }` | 测试已保存连接；从 Keyring 读取凭据进行测试，响应不回传凭据；测试期间持有读/使用锁，防止并发编辑或删除 |
| `GET /api/v1/changes` | Cookie | cursor? | 待审批列表（Phase 4 实现） | 认证管理用户可查看变更请求摘要 |
| `GET /api/v1/changes/:request_id` | Cookie | 无 | 待审批详情（Phase 4 实现） | 待审批详情包含准确 SQL 和有效期；仅内存尚存时可见 |
| `POST /api/v1/changes/:request_id/decision` | Cookie, x-csrf-token | `{ decision, approval_nonce, sql_fingerprint, connection_version }` | 审批决策（Phase 4 实现） | approve/reject/cancel；只接受当前网页挑战 |

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

## 8. MCP Server 原型实现契约 (`createMcpServer` / `startStdioServer`)

- **惰性工厂模式**：
  - `createMcpServer()`：基于 `@modelcontextprotocol/sdk` 创建独立的 Server 实例，声明 `{ capabilities: { tools: {} } }`；
  - `tools/list` 响应返回空数组 `{ tools: [] }`，暂未挂载具体数据库工具；
  - `tools/call` 请求一律抛出 `McpError(ErrorCode.MethodNotFound, 'Tool is not available.')`，**严禁回显客户端传入的工具名或参数对象**，防止参数中夹带的密码或敏感 SQL 泄露到错误回显中。
- **stdio 协议传输生命周期**：
  - `startStdioServer()`：基于 `StdioServerTransport` 建立标准 I/O 监听；
  - 自动注册 `stdin` EOF（`end` 事件）及操作系统的 `SIGINT`、`SIGTERM` 监听，接收到退出信号时触发优雅关闭；
  - `stdout` 仅允许输出合规的 JSON-RPC 协议帧，严禁混入任何调试文本或堆栈日志。
- **启动隔离**：
  - 支持作为独立子进程执行：`node mysql-mcp/dist/mcp/server.js`；
  - 从主入口 `import { createApplication } from 'mysql-mcp'` 或直接导入聚合包时保持完全惰性，绝不自发启动 HTTP 端口或 stdio 传输通道。

