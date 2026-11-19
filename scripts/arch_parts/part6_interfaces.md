## 第六章：标准接口契约与协议规范

### 6.1 MCP 11 项 Tools 显式传参契约与紧凑二维出参

所有工具均支持显式传入 `profile` 与 `database`，避免请求隐式依赖不可信的传输级 Session。

| 工具序号 | 工具标识 (Tool Name) | 入参签名 (Input Schema) | 核心功能与返回契约 | 安全约束与行为 |
| :---: | :--- | :--- | :--- | :--- |
| **01** | `list_profiles` | *(无参数)* | 返回当前用户被授权访问的数据源 Profile 清单：`{ profiles: [{ name, displayName, environment, defaultDatabase }] }` | 仅返回脱敏元数据，严格过滤未授权项，隐藏密码与私钥 |
| **02** | `switch_profile` | `profile_name: string` | 动态设置当前上下文的工作数据源（向后兼容便利工具） | 校验目标 Profile 授权；核心查询仍推荐直接显式传参 |
| **03** | `get_current_context` | *(无参数)* | 获取当前请求上下文快照：`{ username, activeRoles, activeProfile, activeDatabase, host }` | 辅助 Agent 随时校准当前所处环境与工作库 |
| **04** | `list_databases` | `profile?: string` | 列出指定或默认 Profile 连接池中有权访问的数据库清单 | 经 Database ACL 过滤，隐藏未授权库与 MySQL 内部系统库 |
| **05** | `use_database` | `database_name: string, profile?: string` | 切换默认操作数据库 | 检查目标数据库是否符合 Database ACL 策略 |
| **06** | `list_tables` | `pattern?: string, database?: string, profile?: string` | 列出目标库中的所有数据表名及业务注释：`{ tables: [{ name, comment, type }] }` | 严格应用 Table ACL Default Deny，被阻断表完全不可见 |
| **07** | `describe_table` | `table_name: string, database?: string, profile?: string` | 查询目标表的完整列定义、主外键、索引及字段注释 (`COLUMN_COMMENT`) | 校验表级 ACL 访问权限，若无权限返回标准 403 错误 |
| **08** | `sample_table_data` | `table_name: string, database?: string, profile?: string, limit?: number, columns?: string[]` | 抽取 3~5 行典型样本记录，格式化为二维紧凑数组 | limit 硬限制不超过 10 行；敏感字段自动执行动态脱敏掩码 |
| **09** | `get_column_distinct_values` | `table_name: string, column_name: string, database?: string, profile?: string, max_distinct?: number` | 统计枚举字段值域分布与频次 | max_distinct 硬上限 200；受全链路并发与超时限制，不被视为轻量查询 |
| **10** | `execute_query` | `sql: string, params?: any[], profile?: string, database?: string` | 执行只读 SQL 查询，返回紧凑二维结果集与性能指标 | 必须依次通过三层防御、在途并发、死循环熔断、AST只读、Table ACL 与 Fail-Closed LIMIT 改写 |
| **11** | `explain_query` | `sql: string, profile?: string, database?: string` | 执行 EXPLAIN 分析执行计划瓶颈 (全表扫描 ALL、预估扫描行数、filesort 告警) | 仅允许分析只读 SELECT 语句，受 Table ACL 约束 |

#### `execute_query` 紧凑序列化返回与截断标记
```json
{
  "columns": ["user_id", "username", "department", "created_at"],
  "rows": [
    [1001, "zhangsan", "Data Science", "2026-11-01 10:20:00"],
    [1002, "lisi", "Security Ops", "2026-11-02 14:15:30"]
  ],
  "row_count": 2,
  "execution_time_ms": 7.8,
  "payload_bytes": 1420,
  "truncated": false
}
```

---

### 6.2 管控面 RESTful API 清单与定义

管控面基于 `/api/v1` 前缀暴露 RESTful 规范接口。认证采用 HttpOnly 强安全 Cookie，后端全局挂载**强制改密守卫** (`forceChangePasswordGuard`)。

```
┌────────────────────────────────────────────────────────────────────────┐
│                        管控面核心 RESTful API 路由清单                 │
├────────┬────────────────────────────────┬──────────────────────────────┤
│ 模块   │ 路径 (Route)                   │ 请求方法与职责说明 (后端防护)│
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 认证   │ /api/v1/auth/csrf              │ GET  - 获取 CSRF 令牌 (公开) │
│        │ /api/v1/auth/register          │ POST - 用户自主申请注册      │
│        │ /api/v1/auth/login             │ POST - 账号密码登录 (带防爆破)│
│        │ /api/v1/auth/logout            │ POST - 登出并清理会话 Cookie │
│        │ /api/v1/auth/change-password   │ POST - 修改密码 (解除改密限制)│
│        │ /api/v1/auth/me                │ GET  - 获取当前登录人信息与角色│
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 审批   │ /api/v1/approvals/pending      │ GET  - 获取待审批申请人列表  │
│        │ /api/v1/approvals/:id/approve  │ POST - 审批通过并赋予角色    │
│        │ /api/v1/approvals/:id/reject   │ POST - 驳回申请并记录驳回理由│
│        │ /api/v1/approvals/resubmit     │ POST - 被驳回用户重新提交申请│
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 用户   │ /api/v1/users                  │ GET  - 分页查询所有用户列表  │
│        │ /api/v1/users/:id/status       │ PUT  - 冻结/解冻账号 (超管自锁)│
│        │ /api/v1/users/:id/roles        │ PUT  - 变更用户角色 (超管自锁)│
│        │ /api/v1/users/:id              │ DELETE - 删除用户 (超管自锁) │
├────────┼────────────────────────────────┼──────────────────────────────┤
│ PAT    │ /api/v1/pats                   │ GET  - 查看个人名下 PAT 列表 │
│        │ /api/v1/pats                   │ POST - 签发新 PAT (未改密拦截)│
│        │ /api/v1/pats/:id/revoke        │ POST - 主动吊销 PAT (即时失效)│
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 数据源 │ /api/v1/profiles               │ GET/POST - 查询 / 新增数据源 │
│        │ /api/v1/profiles/my-options    │ GET  - 研发端轻量数据源选项  │
│        │ /api/v1/profiles/:id           │ PUT/DELETE - 更新 / 删除数据源│
│        │ /api/v1/profiles/test-db       │ POST - 测试 MySQL 连通(SSRF) │
│        │ /api/v1/profiles/test-ssh      │ POST - 测试 SSH 连通(SSRF)   │
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 策略   │ /api/v1/roles                  │ GET/POST/PUT - RBAC 角色策略 │
│        │ /api/v1/roles/:id/table-acls   │ GET/POST/PUT - 表级黑白名单  │
│        │ /api/v1/roles/:id/db-acls      │ GET/POST/PUT - 数据库级 ACL  │
│        │ /api/v1/rate-limits/global     │ GET/PUT - 全局与熔断限流配置 │
│        │ /api/v1/rate-limits/users/:id  │ GET/PUT - 用户专属限流配额   │
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 审计   │ /api/v1/audits                 │ GET  - 分级 SQL 审计流水检索 │
│        │ /api/v1/audits/stats           │ GET  - 审计高危与耗时大盘指标│
│        │ /api/v1/audits/export          │ POST - 脱敏审计日志导出      │
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 系统   │ /api/v1/settings/notifications │ GET/PUT - Webhook/邮件通知配置│
│        │ /api/v1/settings/test-notify   │ POST - 发送测试通知 (带 SSRF)│
└────────┴────────────────────────────────┴──────────────────────────────┘
```

---

### 6.3 统一错误码与异常响应矩阵 (Error Code Matrix)

```json
{
  "code": "ERR_AST_FORBIDDEN_SYNTAX",
  "message": "Write operation 'UPDATE' is strictly prohibited by Read-Only Policy.",
  "timestamp": "2026-11-07T12:00:00.123Z",
  "action_guidance": "Please convert your query into a read-only SELECT statement."
}
```

| 错误编码 (Code) | HTTP 状态码 | 触发场景说明 | 客户端自愈 / 纠正指引 (Guidance) |
| :--- | :---: | :--- | :--- |
| `ERR_AUTH_UNAUTHORIZED` | 401 | 未携带 PAT 令牌或 Header 格式错误 | 请在请求头中配置 `Authorization: Bearer <mcp_pat_xxx>` |
| `ERR_AUTH_INVALID_PAT` | 401 | PAT 签名错误、已过期或已被主动注销 | 令牌无效或已撤销，请前往 Web 控制台重新签发 |
| `ERR_AUTH_ACCOUNT_PENDING` | 403 | 用户已注册但尚未通过管理员审批 | 账号待审批，请联系系统管理员通过审批后再试 |
| `ERR_AUTH_ACCOUNT_DISABLED`| 403 | 用户账号已被管理员冻结/停用 | 账号已被停用，请联系管理员解冻恢复 |
| `ERR_MUST_CHANGE_PASSWORD` | 403 | 账号初次登录或需要强制改密 | 请先访问修改密码接口完成密码重置，才能进行其他操作 |
| `ERR_CONCURRENCY_LIMIT` | 429 | 用户在途并发或 Profile 在途并发达到硬上限 | "Concurrency quota exceeded. Please wait for previous queries to complete." |
| `ERR_RATE_LIMIT_USER` | 429 | 用户个人 QPM 令牌桶耗尽 | "User rate limit exceeded. Please slow down." |
| `ERR_RATE_LIMIT_PROFILE` | 429 | 目标 Profile 资源池瞬时已满载 | "Database resource pool is currently busy. Please retry later." |
| `ERR_AGENT_LOOP_DETECTED` | 429 | 30 秒内连续 3 次相同报错 SQL 熔断 | "Loop detected: Identical failed query executed multiple times. Please re-read the schema." |
| `ERR_AST_FORBIDDEN_SYNTAX` | 403 | 包含 DML/DDL/锁表(FOR UPDATE)/延时注入 | 严格只读模式禁止写操作、锁表或延时函数 |
| `ERR_AST_TABLE_DENIED` | 403 | 涉及物理表命中黑名单或未在白名单中 (Default Deny) | "Access denied for table in query: [table_name]" |
| `ERR_AST_LIMIT_FAIL_CLOSED`| 400 | 复杂复合 SQL 无法 100% 确保安全改写 LIMIT | "Unable to safely inject LIMIT into complex SQL structure. Please explicitly specify a LIMIT clause." |
| `ERR_AST_COMPLEXITY` | 400 | SQL 长度超 16KB 或 AST 深度/节点数超标 | "SQL query complexity exceeds gateway safety threshold." |
| `ERR_RESULT_PAYLOAD_TOO_LARGE`| 400 | 查询结果集总字节数超过 5MB 硬上限 | "Result payload exceeds max threshold. Please add more specific WHERE filters." |
| `ERR_POOL_QUEUE_TIMEOUT` | 503 | 并发排队等待空闲连接超时 (超过 3000ms) | "Database connection pool is currently busy. Please retry in a few seconds." |
| `ERR_SSRF_PROHIBITED` | 403 | 连通性测试目标命中私网/环回/云元数据 IP | 目标主机命中 SSRF 安全拦截规则，禁止访问内部或保留地址 |
| `ERR_LAST_SUPER_ADMIN` | 400 | 尝试禁用、删除或降级系统中最后 1 名活跃超管 | 至少需保留 1 名活跃超级管理员，禁止自残操作 |

