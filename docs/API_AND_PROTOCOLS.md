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

## 3. 浏览器管理 HTTP 草案

除建立会话的受控接口外，下表均需有效浏览器会话。所有变更型请求验证 CSRF、Origin、Host；页面认证不能被 MCP 内部令牌替代。

| 方法与路径 | 请求 | 响应/行为 |
|---|---|---|
| POST /session | local_code | 一次性本地码换 HttpOnly 会话，限速；不返回会话秘密 |
| DELETE /session | 无 | 注销并清理会话 |
| GET /connections | cursor? | 脱敏列表 |
| POST /connections | name, host, port, username, default_database, password | 创建；201，脱敏资料 |
| PATCH /connections/:connection_id | expected_version 及待修改字段，password 可省略 | 版本冲突 409；200 |
| DELETE /connections/:connection_id | expected_version | 执行中拒绝；200 删除摘要 |
| POST /connections/test | 草稿连接字段及 password | 只测试不保存；200 测试摘要 |
| POST /connections/:connection_id/test | expected_version | 测试已保存连接；不回传凭据 |
| GET /changes | cursor? | 认证管理用户可查看请求摘要 |
| GET /changes/:request_id | 无 | 待审批详情包含准确 SQL 和有效期；仅内存尚存时可见 |
| POST /changes/:request_id/decision | decision, approval_nonce, sql_fingerprint, connection_version | approve/reject/cancel；只接受当前网页挑战 |

新增连接 password 是仅浏览器接收字段，绝不复制到 MCP。编辑 UI 留空表示保持原密码，客户端应省略 password 字段；首期不提供“留空清除密码”的含糊行为。测试草稿不要提前持久化。成功保存不等于测试成功，二者单独展示。

审批详情中服务端生成 approval_nonce，禁止进入 URL。批准时复核绑定和期限；重复点击返回现有状态或状态冲突，不再次派发。浏览器请求仅能批准 web 通道，不能抢占等待原生响应的请求。

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

