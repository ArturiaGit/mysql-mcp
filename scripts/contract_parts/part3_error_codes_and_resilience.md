## 第三章：全局标准错误码与交互自愈矩阵

### 3.1 统一错误响应数据结构 (`StandardErrorResponse`)

管控面所有 HTTP 异常响应必须严格遵循单根数据模型，杜绝异构字段：

```typescript
// packages/shared-types/src/errors.ts

/** 字段级校验错误结构 */
export interface ValidationErrorItem {
  /** 发生校验错误的字段路径 (例如: "password", "tls_config.ca_cert") */
  field: string;
  /** 面向用户的具体字段错误描述 */
  message: string;
  /** 触发的验证规则标识 (例如: "min_length", "regex_mismatch", "invalid_enum") */
  rule: string;
}

export interface StandardErrorResponse {
  /** 架构基线标准错误码 (大写下划线语义串) */
  code: string;
  /** 面向开发者/管理员的可读错误描述 */
  message: string;
  /** 服务端产生异常的 UTC 毫秒时间戳 (ISO 8601) */
  timestamp: string;
  /** 前端 UI 直接呈现给操作者的精准自愈与行动指引 (Action Guidance) */
  action_guidance: string;
  /** 限流或防爆破场景下的冷却重试等待秒数 (对齐 Retry-After Header) */
  retry_after_sec?: number;
  /** 密码登录失败时下发的剩余重试尝试次数 */
  remaining_attempts?: number;
  /** 结构化上下文字典 (校验失败时固定包含 validation_errors: ValidationErrorItem[]) */
  details?: {
    validation_errors?: ValidationErrorItem[];
    [key: string]: unknown;
  };
}
```

### 3.2 HTTP 状态码映射规则

系统不滥用 HTTP 状态码，严格遵守以下 10 种标准语义映射：

| 状态码 | 协议语义 | 业务判定范围 |
| :---: | :--- | :--- |
| **`200 OK`** | 请求成功 | 查询数据返回、非幂等指令执行确认、单条或批量更新成功 |
| **`400 Bad Request`** | 客户端请求无效 | 缺少必填字段、数据类型错误、自残防护拦截、密码策略不符、原密码输入错误、凭据重新录入约束 |
| **`401 Unauthorized`** | 身份未认证 | 会话 Cookie 不存在或已过期、PAT 签名验证失败、登录身份凭据无效 |
| **`403 Forbidden`** | 权限拒绝 / 状态限制 | CSRF 校验失败、账号处于待审/驳回/停用、密码超期或改密锁定、RBAC 角色权限不足、SSRF 私网拦截 |
| **`404 Not Found`** | 实体不存在 | 请求的 URL 路由不存在、指定的 ID 实体在数据库中不存在 |
| **`409 Conflict`** | 资源状态冲突 | 乐观锁版本不一致 (409 CAS)、注册用户名已存在、重名数据源、审批工单状态已被他人流转 |
| **`429 Too Many Requests`** | 触发频控限流 | 登录 IP/账号防爆破锁定、用户 QPM 桶满、Profile 资源桶满、Agent 死循环熔断 |
| **`499 Client Closed`** | 客户端主动取消 | 客户端显式掐断 HTTP 连接或 MCP 客户端发送取消通知 |
| **`500 Internal Error`** | 服务端内部未捕获故障 | 内部断言失败、意外文件 I/O 崩溃、加密密钥环严重故障 |
| **`503 Service Unavailable`** | 下游资源不可用 | 数据库连接池排队超时、生产连接池彻底耗尽、停机维护中 |

### 3.3 全量标准错误码自愈交互大表 (Error Code Matrix)

全系统 44 项核心错误码详尽归一化定义如下，前端 HTTP 拦截器与业务表单必须以此表驱动视觉交互：

| 错误编码 (`code`) | HTTP 状态 | 触发模块 | 触发业务场景与判断逻辑 | 默认错误提示 (`message`) | 前端交互自愈指引 (`action_guidance`) | 附加字段 |
| :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| `ERR_AUTH_UNAUTHORIZED` | 401 | 认证网关 | 未携带有效 Session Cookie 访问受保护接口 | 访问未授权，请先登录系统。 | 请前往登录页输入账号密码完成身份认证。 | 无 |
| `ERR_AUTH_FAILED` | 401 | 认证中心 | 登录用户名不存在或密码错误 | 账号或密码错误。 | 请检查大小写及输入，密码错误超限将被临时锁定。 | `remaining_attempts` |
| `ERR_OLD_PASSWORD_INVALID` | 400 | 认证中心 | 修改密码时原密码输入错误 | 当前原密码输入错误，请重新输入。 | 原密码不匹配，请核对后重试。注意：保持当前登录态，请勿退出。 | 无 |
| `ERR_AUTH_USERNAME_EXISTS` | 409 | 用户注册 | 用户自助注册时提交了已存在的用户名 | 该用户名已被注册占用。 | 该登录用户名已存在，请更换一个全新的用户名后重试。 | 无 |
| `ERR_AUTH_ACCOUNT_LOCKED` | 429 | 防爆破限流 | 连续 5 次登录失败，账号被锁定 15 分钟 | 账号因连续登录失败已被临时锁定。 | 密码防爆破保护中，请等待冷却倒计时结束后重试。 | `retry_after_sec` |
| `ERR_AUTH_ACCOUNT_PENDING` | 403 | 账号状态守卫 | 账号处于 PENDING 待审批状态，访问非放行接口 | 您的账号正处于待审批排队阶段。 | 请耐心等待超级管理员审批，或联系管理员加急处理。 | 无 |
| `ERR_AUTH_ACCOUNT_REJECTED` | 403 | 账号状态守卫 | 账号处于 REJECTED 状态，访问受保护接口 | 您的注册申请已被管理员驳回。 | 您可以查看驳回理由并补充信息后重新提交申请。 | 无 |
| `ERR_AUTH_ACCOUNT_DISABLED` | 403 | 账号状态守卫 | 账号处于 DISABLED 停用/冻结状态 | 您的账号已被系统管理员停用。 | 账号访问已被安全冻结，如需解冻请联系系统管理员。 | 无 |
| `ERR_APPROVAL_STATE_CONFLICT`| 409 | 审批中心 | 工单已被其他管理员审批或账号已非待审状态 | 该审批工单状态已发生变更或已被处理。 | 该工单已被其他管理员抢先审批或撤销，请刷新待审列表。 | 无 |
| `ERR_INVALID_STATUS_TRANSITION` | 400 | 用户管理 | 尝试对待审(PENDING)或驳回(REJECTED)账号直接执行启停流转 | 非法账号状态流转。 | 待审或已驳回账号必须通过审批工单流程流转，禁止直接通过启停接口变更状态。 | `details.current_status` |
| `ERR_MUST_CHANGE_PASSWORD` | 403 | 密码守卫 | 激活用户密码已超期失效或被管理员标记重置 | 密码已超期失效或需要重置，请修改密码后继续使用。 | 密码安全策略拦截中，请在改密对话框中设置符合复杂度要求的新密码。 | `details.reason` |
| `ERR_CSRF_INVALID` | 403 | CSRF 拦截器 | 未携带 x-csrf-token 或 Token 签名不匹配 | CSRF 令牌校验失败或已过期。 | 前端正在自动刷新安全凭据并重试，请稍候。 | 无 |
| `ERR_RBAC_FORBIDDEN` | 403 | RBAC 守卫 | 当前用户角色无权访问目标路由或执行该动作 | 权限不足：当前角色无权执行此操作。 | 如需开通此管理权限，请联系超级管理员分配相应角色。 | `details.requiredRoles` |
| `ERR_PASSWORD_POLICY_VIOLATED` | 400 | 密码校验器 | 密码长度小于 8 位或未包含大小写/数字/特殊字符 | 密码不符合系统安全复杂度策略。 | 密码长度须为 8~64 位，且须混合包含大小写字母、数字及特殊符号。 | 无 |
| `ERR_SAME_AS_OLD_PASSWORD` | 400 | 密码校验器 | 新密码与当前历史旧密码完全相同 | 新密码不能与当前旧密码相同。 | 请设置一个与历史密码不同的全新安全密码。 | 无 |
| `ERR_SELF_ACTION_PROHIBITED` | 400 | 自保护拦截 | 超管尝试在用户列表中删除自身或冻结自身 | 禁止对自己执行停用或删除操作。 | 系统防自残机制保护中，您不能对自己执行降级、停用或删除。 | 无 |
| `ERR_LAST_SUPER_ADMIN` | 400 | 防自残事务锁 | 尝试停用、删除或降级系统中仅存的最后 1 名超管 | 操作已被阻止：系统必须保留至少 1 名活跃超级管理员。 | 请先激活或指派其他超级管理员账号，再对当前账号执行变更。 | 无 |
| `ERR_CONCURRENCY_CONFLICT` | 409 | 乐观锁校验器 | PUT 提交的 version 小于当前元数据库内版本 | 配置已被其他管理员更新，产生并发冲突。 | 检测到版本冲突，已保留您的修改草稿。请比对差异后重新提交。 | `details.current_version` |
| `ERR_DUPLICATE_NAME` | 409 | 资源校验器 | 数据源或角色英文标识已被占用 | 资源英文唯一标识重复。 | 该唯一名称已被占用，请输入一个未使用的英文名称。 | 无 |
| `ERR_CREDENTIAL_REENTRY_REQUIRED` | 400 | 数据源服务 | 修改了 host/port/user 但未录入新密码/私钥 | 修改连接目标后，必须重新输入密码或私钥。 | 为防凭据被恶意复用探测未授权内网主机，修改端点必须重新录入凭据。 | 无 |
| `ERR_PROFILE_IMMUTABLE_FIELD` | 400 | 数据源服务 | 尝试修改 Profile 的 name 或 environment 等不可变字段 | 数据源基础标识禁止修改。 | 数据源唯一标识与环境属性创建后不可变更，请保持原值。 | `details.immutable_fields` |
| `ERR_ROLE_IMMUTABLE_FIELD` | 400 | 策略管理 | 尝试修改角色的唯一英文标识 role_name | 角色唯一英文标识禁止修改。 | 角色唯一英文标识创建后不可变更，请保持原值。 | `details.immutable_fields` |
| `ERR_SSRF_PROHIBITED` | 403 | SSRF 防火墙 | 连通性测试或通知 Webhook 命中私网/保留 IP | 目标主机命中出站安全防御规则 (SSRF)。 | 若该主机为合法内部节点，请联系管理员将其加入出站白名单。 | `details.resolved_ip` |
| `ERR_PROFILE_IN_USE` | 400 | 数据源服务 | 尝试删除仍被角色权限绑定的数据源 Profile | 无法删除：该数据源已被一个或多个角色绑定。 | 请先前往策略管理页面解绑关联角色，然后再删除该数据源。 | `details.role_names` |
| `ERR_BUILTIN_ROLE_PROTECTED` | 400 | 策略管理 | 尝试修改或删除系统内置预设角色 | 系统内置基准角色受保护，禁止删除。 | 内置角色（如 SUPER_ADMIN、DEVELOPER）为系统保留，不可删除。 | 无 |
| `ERR_ROLE_IN_USE` | 400 | 策略管理 | 尝试删除仍分配给有效用户的自定义角色 | 无法删除：该角色已被分配给一个或多个用户。 | 请先在用户列表中回收该角色分配，然后再执行删除。 | `details.user_count` |
| `ERR_RATE_LIMIT_USER` | 429 | 限流引擎 | 用户 QPM 令牌桶耗尽 | 个人查询频次已达到配额上限。 | 请降低 Agent 查询速率，或联系管理员申请提升用户专属配额。 | `retry_after_sec` |
| `ERR_RATE_LIMIT_PROFILE` | 429 | 限流引擎 | 目标数据源整体 QPM 超过负载保护上限 | 数据源并发吞吐过高，已触发网关流控保护。 | 目标数据库当前压力过大，网关正在排队保护，请稍后重试。 | `retry_after_sec` |
| `ERR_AGENT_LOOP_DETECTED` | 429 | 死循环熔断器 | Agent 在窗口时间内连续触发相同报错达到阈值 | 检测到大模型 Agent 异常死循环，已触发主动熔断。 | Agent 可能陷入无效重试死循环，请检查模型提示词或查询语法。 | `retry_after_sec` |
| `ERR_CONCURRENCY_LIMIT` | 429 | 并发控制器 | 单用户在途并发或单数据源全局在途连接达到硬上限 | 在途并发查询数已达上限。 | 请等待先前发起的查询执行完毕后再提交新请求。 | `details.current_inflight` |
| `ERR_POOL_QUEUE_TIMEOUT` | 503 | 连接池治理 | 客户端等待空闲数据库连接超时 (3000ms) | 连接池等待排队超时，暂无可用连接。 | 数据源当前负载繁忙，连接排队超时，请检查慢查询或稍后重试。 | 无 |
| `ERR_POOL_EXHAUSTED` | 503 | 连接池治理 | 数据源连接池已满且等待队列达到上限 | 数据库连接池已彻底耗尽。 | 网关与目标库物理连接资源枯竭，请 DBA 检查目标库健康状态。 | 无 |
| `ERR_RESULT_PAYLOAD_TOO_LARGE` | 400 | 流式安全防护 | 结果集传输累计内存超过 5MB 预算 | 查询结果集总字节数超过 5MB 安全阈值。 | 查询数据量过大，请在 SQL 中增加更精确的过滤条件或减小 LIMIT。 | 无 |
| `ERR_ROW_PAYLOAD_TOO_LARGE` | 400 | 流式安全防护 | 单行单字段体积超过 64KB (已截断) | 结果集单字段长度超限，内容已被安全截断。 | 命中长文本截断保护，如需查看完整大对象请联系 DBA。 | 无 |
| `ERR_AST_FORBIDDEN_SYNTAX` | 403 | SQL 防火墙 | SQL 包含 UPDATE/DELETE/DROP/锁表等写语法 | 只读安全网关禁止执行写操作或锁表语法。 | 网关仅放行安全只读查询，请移除写操作、DDL 或 LOCK 语句。 | `details.prohibited_token` |
| `ERR_AST_TABLE_DENIED` | 403 | SQL 防火墙 | 访问未授权的表或命中了角色黑名单规则 | 您无权访问目标表或该表处于黑名单保护中。 | 目标表已被安全策略拦截，请联系管理员为您开通表访问白名单。 | `details.denied_table` |
| `ERR_AST_LIMIT_FAIL_CLOSED` | 400 | SQL 防火墙 | 复杂集合/复合查询无法安全自动重写 LIMIT | 复杂 SQL 结构无法安全推断，已触发安全闭门拦截。 | 请在最外层查询中显式书写 LIMIT 子句（如 LIMIT 50）。 | 无 |
| `ERR_NOTIFICATION_FAILED` | 400 | 系统通知服务 | 测试发送 Webhook 通知失败或远端平台鉴权错误 | 测试通知推送失败。 | 请检查 Webhook 地址是否有效、机器人是否被停用以及 Secret 签名是否正确。 | `details.upstream_error` |
| `ERR_INVALID_TICKET` | 403 | 审计导出下载 | 下载 Ticket 签名校验失败或伪造 | 审计导出下载凭证无效或已损坏。 | 导出凭据签名无效，请重新在控制台发起导出申请。 | 无 |
| `ERR_TICKET_EXPIRED` | 403 | 审计导出下载 | 下载 Ticket 超过 5 分钟有效时限 | 审计导出凭证已过期 (有效时限为 5 分钟)。 | 导出链接已自然过期失效，请重新生成导出任务后立即下载。 | 无 |
| `ERR_TICKET_ALREADY_USED` | 403 | 审计导出下载 | 下载 Ticket 已被消费（单次使用原则） | 审计导出凭证已被使用，不可重复下载。 | 为防导出文件二次泄露，下载凭据仅限使用一次，请重新发起导出。 | 无 |
| `ERR_NOT_FOUND` | 404 | 路由/资源层 | 指定的主键 ID 不存在或请求的 URL 未定义 | 请求的资源不存在。 | 请核对目标资源标识是否存在，或检查访问路径是否正确。 | 无 |
| `ERR_VALIDATION_FAILED` | 400 | 请求校验器 | 请求体 JSON Schema 验证不通过 | 请求入参格式校验失败。 | 请根据标红字段提示检查输入参数格式、长度及合法性。 | `details.validation_errors` |
| `ERR_INTERNAL_SERVER_ERROR` | 500 | 异常兜底 | 服务端未预期的底层异常 | 服务器内部发生故障，请联系系统管理员。 | 网关内部捕获意外异常，技术团队已收到告警并介入排查。 | 无 |