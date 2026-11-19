## 第二章：全局网络与传输协议规范

### 2.1 协议基础、Base URL 与敏感响应缓存策略

- **通信协议**：HTTPS (生产环境强校验 TLS 1.3 / TLS 1.2)；HTTP/1.1 与 HTTP/2 双协议自适应；
- **统一服务前缀 (Base URL)**：所有管控端点挂载在 `/api/v1` 前缀下，例如：`https://gateway.example.com/api/v1/auth/me`；
- **字符编码与媒体类型 (MIME Type)**：
  - 常规 RESTful 接口请求与响应：`Content-Type: application/json; charset=utf-8`；
  - 审计日志文件下载：`Content-Type: text/csv; charset=utf-8`；
- **跨域资源共享 (CORS)**：
  - 生产环境默认前后端同源部署（由网关反向代理分发静态资源与 API）；
  - 独立开发模式下，服务端限制 `Access-Control-Allow-Origin` 为白名单前端地址，`Access-Control-Allow-Credentials: true`，禁止通配符 `*`；
- **敏感响应统一缓存控制策略 (OWASP Cache-Control Policy)**：
  为防止浏览器磁盘缓存、代理服务器或共享终端泄露用户身份凭据与会话信息，针对以下所有敏感端点，服务端**强制返回以下 HTTP 响应头**：
  ```http
  Cache-Control: no-store, no-cache, must-revalidate, private
  Pragma: no-cache
  Expires: 0
  ```
  **强制应用端点清单**：
  1. 认证与会话相关：`GET /api/v1/auth/csrf`、`GET /api/v1/auth/me`、`POST /api/v1/auth/login`、`GET/PUT /api/v1/auth/password-policy`；
  2. 凭据展示与重置：`POST /api/v1/pats` (返回 rawToken)、`POST /api/v1/users/:id/reset-password` (返回临时密码)；
  3. 数据源管理拓扑：`GET /api/v1/profiles`、`GET /api/v1/profiles/my-options`；
  4. 审计日志与下载：`POST /api/v1/audits/export`、`GET /api/v1/audits/export/download`。

### 2.2 会话凭据与 HttpOnly Cookie 规范

Web 控制台基于高强度安全会话管理，杜绝将 Session 暴露给 JavaScript 内存或 LocalStorage：

- **主会话 Cookie 规范**：
  ```http
  Set-Cookie: mcp_admin_sid=<SESSION_UUID>; Path=/api/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=28800
  ```
  - `Path=/api/v1`：限制 Cookie 仅向后端 API 发送，前端其他静态资源路径不透传；
  - `HttpOnly`：完全禁止客户端通过 `document.cookie` 访问，从根源免疫 XSS 会话劫持；
  - `Secure`：生产环境强制仅通过 HTTPS 通道传输；
  - `SameSite=Strict`：杜绝任何跨站请求携带该 Cookie，提供第一道 CSRF 隔离防线；
  - `Max-Age=28800`：固定会话生存期为 8 小时 (28,800 秒)，超时自动失效；
- **会话重新生成 (Session Regeneration)**：
  - 用户执行 `POST /api/v1/auth/login` 认证成功瞬间，服务端立即注销旧匿名会话，签发全新 `mcp_admin_sid`；
  - 用户执行 `POST /api/v1/auth/change-password` 成功后，除当前客户端签发新 Session ID 外，服务端主动物理注销该用户的所有其他在途会话。

### 2.3 零副作用 CSRF 令牌交换协议与生命周期

为防范高危管理操作遭受跨站伪造请求攻击，系统建立 **“HttpOnly 会话种子 + Header 动态令牌”** 的双重校验契约：

```
[前端 Web 控制台]                                   [后端 admin-api 网关]
       │                                                      │
       │─── 1. GET /api/v1/auth/csrf (公开无门槛端点) ───────────▶│
       │◀── 2. 返回 { csrfToken: "a8f3c..." } (无副作用) ─────────│ (若无种子同时下发 mcp_csrf_seed Cookie)
       │                                                      │
       │─── 3. POST /api/v1/users/101/status (状态写操作) ─────▶│
       │       Headers: [x-csrf-token: "a8f3c..."]            │ Fastify 生命周期:
       │       Cookie:  [mcp_admin_sid=...; mcp_csrf_seed=...] │ onRequest ➔ preParsing ➔ Parsing (解析Body)
       │                                                      │ ➔ preValidation 钩子校验 CSRF (HMAC常量时间比对)
       │                                                      │
       │◀── 4. 200 OK / 403 ERR_CSRF_INVALID ─────────────────│ 校验通过 ➔ preHandler 守卫 ➔ Controller
                                                                 校验失败立即抛错, 零业务/数据副作用
```

- **协议规则与 Header 命名**：
  - 客户端在发起任何非幂等写操作（`POST`, `PUT`, `DELETE`, `PATCH`）时，**必须在 HTTP Header 中携带 `x-csrf-token`**；
  - 安全读取方法（`GET`, `HEAD`, `OPTIONS`）不强制校验 `x-csrf-token`；
- **生命周期事实与零业务副作用界定 (Fastify Lifecycle Compliance)**：
  - 依照 Fastify 标准生命周期规范，`preValidation` 钩子在请求体完成 JSON Parsing 解析之后、进入任何守卫鉴权（`preHandler`）与业务控制器（`Handler`）之前执行；
  - 若 CSRF 校验失败，服务端直接中断请求链并抛出 `403 ERR_CSRF_INVALID`。**此时密码哈希验证、数据库事务、外部网络调用等业务代码完全未被触及**，确保业务状态与数据层面的绝对零副作用；
  - 前端 HTTP 拦截器捕获 `ERR_CSRF_INVALID` 后，启动单飞 Promise（合并并发请求，只请求一次 `/api/v1/auth/csrf`），拉取新 Token 后自动无感重试原始业务请求一次。

### 2.4 64 位大整型字符串化与类型字典

- **大整型风险定义**：
  - IEEE 754 双精度浮点数能够精确表达的最大整型为 $2^{53}-1$ (9,007,199,254,740,991)；
  - MySQL `BIGINT UNSIGNED` 最大值为 $2^{64}-1$ (18,446,744,073,709,551,615)。当自增 ID 或雪花 ID 超过 16 位时，浏览器原生 `JSON.parse()` 会发生静默四舍五入，引发雪崩级的误删、误查安全事故；
- **全链路强制字符串契约 (`EntityId = string`)**：
  - **后端输出保证**：所有实体 ID（用户 ID、角色 ID、数据源 ID、审批记录 ID、审计日志 ID、限流规则 ID）在 JSON 序列化器阶段强制格式化为纯字符串；
  - **前端交互与输入**：前端向后端提交路径参数（`:id`）、查询参数（`?query_instance_id=xxx`）或请求负载（如 `roleIds`）时，统一传 `string`；
- **通用实体类型契约字典 (TypeScript 规范)**：
  ```typescript
  // packages/shared-types/src/contracts.ts
  export type EntityId = string; // 全局唯一实体主键标识

  export type UserAccountStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';

  export type AuditStatus = 
    | 'SUCCESS' 
    | 'BLOCKED_AST' 
    | 'BLOCKED_ACL' 
    | 'BLOCKED_CONCURRENCY' 
    | 'BLOCKED_RATE' 
    | 'CANCELED' 
    | 'FAILED_MYSQL' 
    | 'TIMEOUT';

  export type AclEffect = 'ALLOW' | 'DENY';
  export type TableRuleType = 'BLACKLIST' | 'WHITELIST';
  export type RateLimitScope = 'GLOBAL' | 'USER';
  export type NotificationChannelType = 'WECHAT' | 'DINGTALK' | 'FEISHU';

  /** 结构化 TLS 配置 (强安全基线：严格验真且身份与 host 强制绑定) */
  export interface TlsConfig {
    enabled: boolean;
    ca_cert?: string | null;       // 自定义 PEM 格式 CA 证书文本；为 null 或缺省时使用系统标准根 CA
  }
  ```

- **ACL 全局规则通用约定**：
  在库级 ACL（`DbAclRuleDTO`）与表级 ACL（`TableAclRuleDTO`）中，字段 `profile_id` 统一使用字符串 **`"0"`** 代表对当前角色所拥有的**所有数据源生效的全局通用规则**。

### 2.5 ISO 8601 UTC 时间与时区契约

- **时间传输标准**：全量接口所有时间字段（如 `created_at`, `updated_at`, `expires_at`, `last_used_at`, `locked_until`, `password_updated_at`, `password_expires_at`）必须采用严格的 **ISO 8601 UTC** 扩展格式，携带毫秒与 `Z` 零时区标识：
  ```
  YYYY-MM-DDTHH:mm:ss.sssZ  (例如: 2026-11-08T06:30:15.123Z)
  ```
- **时区呈现规范**：服务端一律以 UTC 存储与传输；前端负责解析 UTC 时间串，并根据控制台管理员浏览器的本地时区（例如 `Asia/Shanghai (UTC+8)`）进行排版渲染。

### 2.6 标准统一分页模型 (`Paginated<T>`)

全量分页列表查询端点（用户列表、待审申请列表、审计流水检索等）严格遵循统一的请求与响应包装模型：

- **分页查询入参规范 (Query Parameters)**：
  | 参数名 | 类型 | 必填 | 默认值 | 约束限制 | 说明 |
  | :--- | :---: | :---: | :---: | :--- | :--- |
  | `page` | `number` | 否 | `1` | 整数，`>= 1` | 当前请求页码 |
  | `pageSize` | `number` | 否 | `20` | 整数，`1 <= pageSize <= 100` | 每页记录数，硬上限 100 |

- **分页返回体通用 JSON Schema (`Paginated<T>`)**：
  ```json
  {
    "items": [
      { "id": "1001", "name": "sample_record" }
    ],
    "total": 142,
    "page": 1,
    "pageSize": 20,
    "totalPages": 8
  }
  ```
  - `total`：满足过滤条件的全量记录数（64 位安全数字，前端用以计算总页数与分页器控件）；
  - `totalPages`：服务端计算结果：`Math.ceil(total / pageSize)`。

### 2.7 统一成功响应与统一标准错误响应结构

系统采用确定性的响应报文包络协议，消灭歧义：

#### 1. 纯指令操作成功响应 (Pure Command Ack)
对于无实体回传的操作（如删除、状态流转、提交审批、测试通知等）：
```json
{
  "success": true
}
```

#### 2. 带乐观锁变更的操作成功响应 (Versioned Command Ack)
对于带乐观锁版本的实体修改（如更新角色、更新 ACL、更新限流、更新用户角色）：
```json
{
  "success": true,
  "version": 3
}
```

#### 3. 实体创建成功响应 (Entity Creation Ack)
对于新增数据源、新建角色等：
```json
{
  "id": "105",
  "version": 1
}
```

#### 4. 全局统一标准错误响应结构 (`StandardErrorResponse`)
当 HTTP 状态码为 `4xx` 或 `5xx` 时，响应体**必须 100% 满足**以下 JSON 规范：
```json
{
  "code": "ERR_CONCURRENCY_CONFLICT",
  "message": "当前配置已被其他管理员更新，请重新加载最新版本。",
  "timestamp": "2026-11-08T06:30:15.123Z",
  "action_guidance": "检测到版本号冲突，已保留您的修改草稿。请比对差异后重新提交。",
  "retry_after_sec": 30,
  "remaining_attempts": 2,
  "details": {
    "current_version": 3,
    "submitted_version": 2
  }
}
```
- `code` (string, 必填)：架构基线标准机读错误码；
- `message` (string, 必填)：开发者/运维可读的人类语言错误描述；
- `timestamp` (string, 必填)：服务端生成错误的精确 UTC 毫秒时间戳；
- `action_guidance` (string, 必填约定)：服务端在所有 4xx/5xx 错误中必须包含此自愈指引字段，供前端直接在 Toast 或 Form 报错栏展示给操作人员；
- `retry_after_sec` (number, 可选)：限流或熔断触发时的冷却倒计时（秒），对应 HTTP `Retry-After` Header；
- `remaining_attempts` (number, 可选)：登录密码防爆破场景下的剩余尝试次数；
- `details` (Record<string, unknown>, 可选)：结构化异常详情。当参数校验失败时，固定包含 `validation_errors: ValidationErrorItem[]`。