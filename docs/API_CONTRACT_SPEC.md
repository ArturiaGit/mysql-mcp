# MySQL MCP 企业级网关与管控平台 - 前后端接口契约规范说明书 (API Contract Specification)

| 文档版本 | 发布日期 | 状态 | 适用范围 | 密级 |
| :--- | :--- | :--- | :--- | :--- |
| **v1.5.2** | 2026-11-12 | **数据库评审修订版；待联调验收** | **前端工程、后端工程、接口联调、自动化测试与安全验收** | **内部公开** |

## 开发准入整改（v1.5.2 / 2026-11-12）

核验并修订 RD-01/02/03/04/05/06/07/09：持久限流版本、UTC连接、单一DDL、读写DTO、请求字段、47项接口追踪、超管锁序与首次自举标记。
RD-08 产品/接口签署仍待确认；新库burst暂按数据库既有值10，库级ACL按既有v1.0精确名，不代表新增产品批准。
验证范围及未完成的真实MySQL/HTTP/浏览器门禁见 `docs/reviews/COMPREHENSIVE_DESIGN_READINESS_REMEDIATION_20261112.md`。

## 数据库评审修订（v1.5.1 / 2026-11-12）

DB-R1-02：显式修订外部行为描述，移除覆盖后按角色/全局策略计算；不改变既有执行优先级或 DTO 结构。 本次为文档与可执行片段修复，不代表应用或真实数据库已验收；接口/产品签署与联调门禁见数据库设计 §15.1。

---

## 修订说明 (Revision Preface - v1.5.0 深度收口终审发布)

本版本在前期四轮评审演进基础上，全面吸收并闭环了最新独立安全评审指出的 **3 项 P1 级与 8 项 P2 级问题**：

1. **凭据防外泄铁律全面覆盖“连接路径与信任边界变化” (P1 #1)**：
   - 彻底修复边界盲区：不仅在修改数据库 `host/port/user` 时强制重录密码，当修改 `use_ssh` 隧道状态（启用/关闭）、修改跳板机主机/用户/端口/指纹、或修改 TLS 加密安全级别时，**同样无条件强制重新录入数据库密码**，严禁在网络转发边界发生转移时自动复用存量密码；
2. **SSRF 地址过滤策略完整覆盖 IPv6 与特殊用途地址 (P1 #2)**：
   - 完善 Post-DNS 防御模型：全面封堵 IPv6 ULA (`fc00::/7`)、IPv4-mapped IPv6 (`::ffff:0:0/96`)、组播 (`224.0.0.0/4`, `ff00::/8`)、未指定地址 (`0.0.0.0/8`, `::/128`) 与 CGNAT (`100.64.0.0/10`)；确立双栈 (A/AAAA) 全部解析结果严格校验与 IP Pinning 绑定机制；
3. **用户启停状态流转矩阵与防审批绕过 (P1 #3)**：
   - 确立 `PUT /api/v1/users/:id/status` 严格的前置状态流转矩阵：仅允许 `ACTIVE ➔ DISABLED` 与 `DISABLED ➔ ACTIVE`；严禁对 `PENDING` 或 `REJECTED` 账号直接调用启停接口，违者拦截并返回 `400 ERR_INVALID_STATUS_TRANSITION`，杜绝绕过审批工单与初始授权；
4. **用户限流删除重建与并发 ABA 彻底根治 (P2 #4)**：
   - 废除基于易失业务表计算 MAX(revision) 的脆弱逻辑，确立元数据库独立的**持久化代际计数器 (`sys_rate_limit_revisions`)**，绝不随业务行删除而重置；
   - 恢复继承仅删除业务行，当下一次重新自定义时，持久化计数器原子自增分配新代际（如从 1 变为 2）；结合 `DELETE ?revision=N`，彻底免疫旧版本 1 在删除重建后的 ABA 静默覆盖与误删；
5. **审计导出 Ticket CAS 原子消费与进程重启确定性语义 (P2 #5)**：
   - 严格规定在发送响应头或 CSV 数据流之前，通过原子 CAS 将 Ticket 状态置为 `CONSUMING`，并发重复请求立即返回 `403 ERR_TICKET_ALREADY_USED`；明确单节点重启后内存凭证失效的自愈机制；
6. **大盘统一支持客户端时区与指标统计口径固化 (P2 #6)**：
   - `GET /api/v1/audits/stats` 增设 `timezone` 参数（默认 `Asia/Shanghai`），严格定义 `today`、`7d`、`30d` 的日界线、桶宽、空桶补零以及增长率在分母为 0 时的计算公式；
7. **嵌套规则与通知写 Payload 完整 Schema 约束 (P2 #7)**：
   - 区分读 DTO 与写 Payload，为表级 ACL、库级 ACL、通知渠道定义数组容量上限、查重规则、空数组清空语义以及未知字段严格校验规则；
8. **增设管理员强制改密/重置密码端点 (P2 #8)**：
   - 正式补齐管理端重置密码能力：`POST /api/v1/users/:id/reset-password`，支持为用户设置临时密码并置位 `must_change_password=1`，同事务清退会话与在途 SQL；
9. **修复 JSON 示例换行转义与 PAT 规范一致性 (P2 #9 ~ #11)**：
   - 全量转义私钥与证书示例中的换行符（`\n`），实现 72 段 JSON 示例 100% 可解析；将 PAT 规范形式化锁定为 256-bit 随机数、64 位十六进制小写编码、总长度严格为 **72 字符**；统一修订说明与正文规则。

---

## 目录索引 (Table of Contents)

1. [第一章：规范概述与契约原则](#第一章规范概述与契约原则)
   - 1.1 系统定位与契约边界
   - 1.2 契约六大闭环原则
   - 1.3 契约演进与版本冻结声明
2. [第二章：全局网络与传输协议规范](#第二章全局网络与传输协议规范)
   - 2.1 协议基础、Base URL 与敏感响应缓存策略
   - 2.2 会话凭据与 HttpOnly Cookie 规范
   - 2.3 零副作用 CSRF 令牌交换协议与生命周期
   - 2.4 64 位大整型字符串化与类型字典
   - 2.5 ISO 8601 UTC 时间与时区契约
   - 2.6 标准统一分页模型 (`Paginated<T>`)
   - 2.7 统一成功响应与统一标准错误响应结构
3. [第三章：全局标准错误码与交互自愈矩阵](#第三章全局标准错误码与交互自愈矩阵)
   - 3.1 统一错误响应数据结构 (`StandardErrorResponse` 与 `ValidationErrorItem`)
   - 3.2 HTTP 状态码映射规则
   - 3.3 全量标准错误码自愈交互大表 (44 项全量登记)
4. [第四章：认证架构、四级守卫管道与账号生命周期](#第四章认证架构四级守卫管道与账号生命周期)
   - 4.1 四级分层守卫流水线 (L0~L4)
   - 4.2 账号全生命周期状态机与路由分流 (`PENDING`, `ACTIVE`, `REJECTED`, `DISABLED`)
   - 4.3 `/auth/me` 全状态 200 返回与前端会话引导
   - 4.4 密码生命周期：强密码基线、可配置轮换、安全风险提示与 DDL 迁移
5. [第五章：并发控制与安全防护契约](#第五章并发控制与安全防护契约)
   - 5.1 乐观并发控制规范 (Optimistic Locking & Versioning)
   - 5.2 连接路径与信任边界变更防外泄铁律 (全链路覆盖)
   - 5.3 全场景 SSRF 深度防御与双栈地址过滤策略
   - 5.4 超管防自残保护与排他事务自锁控制 (`ERR_LAST_SUPER_ADMIN`)
   - 5.5 PAT 个人访问令牌生命周期、72字符规范与单次明文契约
6. [第六章：管控面 RESTful API 全量接口契约详述](#第六章管控面-restful-api-全量接口契约详述)
   - 6.1 认证模块接口契约 (`/api/v1/auth/*`)
   - 6.2 注册与审批流模块接口契约 (`/api/v1/approvals/*`)
   - 6.3 用户管理模块接口契约 (`/api/v1/users/*`，含重置密码)
   - 6.4 个人访问令牌模块接口契约 (`/api/v1/pats/*`)
   - 6.5 数据源配置模块接口契约 (`/api/v1/profiles/*`)
   - 6.6 角色策略与库表 ACL 模块接口契约 (`/api/v1/roles/*`)
   - 6.7 动态限流与防熔断模块接口契约 (`/api/v1/rate-limits/*`)
   - 6.8 审计检索与运维大盘模块接口契约 (`/api/v1/audits/*`)
   - 6.9 系统设置与通知渠道模块接口契约 (`/api/v1/settings/*`)
7. [第七章：前后端联调测试矩阵与边界用例基线](#第七章前后端联调测试矩阵与边界用例基线)
   - 7.1 核心成功路径测试矩阵 (`TC-INT-01` ~ `TC-INT-12`)
   - 7.2 安全与异常边界测试矩阵 (`TC-INT-13` ~ `TC-INT-30`)
   - 7.3 前端 Mock 数据适配基线
8. [第八章：附录与设计基线索引](#第八章附录与设计基线索引)

---

## 第一章：规范概述与契约原则

### 1.1 系统定位与契约边界

本规范定义了 **MySQL MCP 企业级安全网关与管控平台（Enterprise MySQL-MCP Gateway & Portal）** 中，**Web 控制台前端（`apps/admin-ui`）** 与 **管理服务端 API（`apps/admin-api`）** 之间的全量 RESTful HTTP/JSON 通信协议。

- **管控面契约边界 (Control Plane)**：本规范详尽覆盖控制台运行所需的一切用户认证、工单审批、数据源纳管、策略配置、限流治理、审计查询、安全告警等 API。所有端点均位于 `/api/v1` 路径前缀下；
- **数据面契约边界 (Data Plane - Out of Scope for REST)**：大模型 Agent 通过标准 MCP (Model Context Protocol 2026) 协议调用网关 11 项 Tools（如 `execute_query`、`list_tables` 等）属于 JSON-RPC 2.0 / Stdio / SSE 传输通道，由数据面核心引擎承载，其传参契约遵循《系统架构设计说明书》§6.1，不属于本 RESTful 契约文档直接描述范围。

### 1.2 契约六大闭环原则

为保证系统在单节点高并发、零信任网络和多管理员协同环境下的健壮性，本契约严格遵循以下六大工程原则：

1. **强类型字符串大整型（BigInt Stringification）**：
   所有数据库映射到前端的主键与外键 ID（如 `user_id`、`profile_id`、`role_id`、`audit_log_id`），在 HTTP 负载中均被严格视为 `string` 类型，禁止后端返回原始 64 位整型数字；
2. **零信任分层守卫（Defense-in-Depth Guards）**：
   每个 API 路由显式声明守卫等级（L0~L4）。未登录用户、待审用户、被停用用户、被驳回用户以及未改密用户均有明确的拦截界限与状态下发规范，杜绝前端越权与死锁环；
3. **乐观并发版本控制（Strict Optimistic Locking）**：
   所有支持在线编辑的元数据实体（包含用户角色分配、状态流转与限流覆盖）统一挂载 `version` 字段。前端在更新时必须回传原版本号，服务端执行 CAS 校验，409 冲突下发时严格保护本地用户草稿；
4. **信任边界变更凭据防外泄铁律（Trust Boundary & Zero-Leakage Re-entry）**：
   数据库密码、SSH 私钥等敏感信息在 GET 查询中一律脱敏（固定回显 `"******"`）。测试和保存接口全链路统一防外泄铁律：只要修改了连接主机、端口、用户、跳板机隧道、指纹或 TLS 级别，必须重新输入密码，严禁将旧凭据用于新端点；PAT 明文仅在生成成功时单次下发；
5. **自愈型交互错误响应（Action-Guided Error Response）**：
   所有业务异常统一返回 `StandardErrorResponse` 结构，包含明确的机读 `code`、人读 `message`、精确时间戳 `timestamp` 以及前端直接渲染的 `action_guidance` 自愈指引；
6. **无副作用安全重试（Side-Effect-Free Retry）**：
   CSRF 校验在进入任何业务 Handler（数据库写操作、密码验证等）之前由 `preValidation` 钩子独立完成。CSRF 失效返回 `403 ERR_CSRF_INVALID` 保证不产生任何后端业务与数据副作用，前端拦截器可安全单飞刷新后自动重试一次。

### 1.3 契约演进与版本冻结声明

- **本规范为工程实施与联调基准 v1.5.0**。前后端开发人员在编写代码、接口契约校验（Zod / TypeBox / Fastify Schema）以及单元/集成测试时，均以本规范列出的字段名、类型、状态码、错误码和错误提示为唯一验收标准；
- **接口变更控制**：任何路由的增删、字段名变更、字段类型收窄或必填性调整，必须发起架构评审修订单并同步更新本说明书，禁止任何单方面实现变更。

---

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

---

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
| **`409 Conflict`** | 资源状态冲突 | 乐观锁版本不一致 (409 CAS)、注册用户名已存在、重名数据源、同用户未吊销 PAT 重名、审批工单状态已被他人流转 |
| **`429 Too Many Requests`** | 触发频控限流 | 登录 IP/账号防爆破锁定、用户 QPM 桶满、Profile 资源桶满、Agent 死循环熔断 |
| **`499 Client Closed`** | 客户端主动取消 | 客户端显式掐断 HTTP 连接或 MCP 客户端发送取消通知 |
| **`500 Internal Error`** | 服务端内部未捕获故障 | 内部断言失败、意外文件 I/O 崩溃、加密密钥环严重故障 |
| **`503 Service Unavailable`** | 下游资源不可用 | 数据库连接池排队超时、生产连接池彻底耗尽、停机维护中 |

### 3.3 全量标准错误码自愈交互大表 (Error Code Matrix)

全系统 45 项核心错误码详尽归一化定义如下，前端 HTTP 拦截器与业务表单必须以此表驱动视觉交互：

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
| `ERR_PAT_NAME_EXISTS` | 409 | 令牌中心 | 当前用户已存在同名的未吊销个人访问令牌 | 该令牌名称已被占用，请更换其他名称。 | 同一账号下有效令牌名称不可重复；吊销旧令牌后方可复用同名。 | 无 |
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

---

## 第四章：认证架构、四级守卫管道与账号生命周期

### 4.1 四级分层守卫流水线 (L0~L4)

为消除控制台前端在权限校验中因守卫顺序错乱而引发的“死锁环”（如待审用户被错误踢出或未审用户直接陷入重定向），后端网关在 Fastify 中严格确立并物理固化了 **五层自顶向下的守卫拦截流水线 (Guards Pipeline)**：

```
                    ┌────────────────────────┐
                    │   HTTP Request Inbound │
                    └───────────┬────────────┘
                                │
                                ▼
         [L0 Public] 是否属于公开端点放行白名单？
         ( /auth/csrf, /auth/register, /auth/login )
                                │
                      否 ───────┴─────── 是 ───────▶ 放行至 Controller
                                │
                                ▼
         [L1 SessionGuard] 会话 Cookie (mcp_admin_sid) 是否有效？
                                │
                      否 ───────┴─────── 是 ───────▶ 注入 req.currentUser
                      │                                 │
                      ▼                                 ▼
             抛 401 UNAUTHORIZED        [L2 StatusGuard] 账号状态是否为 ACTIVE？
                                                        │
                              ┌─────────────────────────┴────────────────────────┐
                              ▼                                                  ▼
                        状态 != ACTIVE                                      状态 == ACTIVE
                              │                                                  │
                 当前路由是否允许受限访问？                                                ▼
         (例如: /auth/me, /auth/logout, /approvals/resubmit)           [L3 MustChangePwdGuard]
                              │                                       must_change_password || is_expired？
                     是 ──────┴────── 否                                         │
                     │                 │                                是 ──────┴────── 否
                     ▼                 ▼                                │                 │
               放行 Controller    抛 403 (分流拦截:                    当前路由是否在改密白名单？    ▼
                                 PENDING/REJECTED/DISABLED)   (/auth/change-password, /auth/me, [L4 RoleGuard]
                                                               /auth/password-policy)     是否具备目标角色？
                                                                        │                       │
                                                               是 ──────┴────── 否        是 ┴ 否
                                                               │                 │        │    │
                                                               ▼                 ▼        ▼    ▼
                                                          放行 Controller  抛 403 锁定   放行  抛 403
```

- **L0 公开端点 (Public Routes)**：
  - 白名单包括：`GET /api/v1/auth/csrf`、`POST /api/v1/auth/register`、`POST /api/v1/auth/login`；
  - 允许匿名访问，不挂载任何 Session 检验；
- **L1 会话有效级 (SessionGuard)**：
  - 校验 `mcp_admin_sid` 会话 Cookie 是否在服务端 Session 注册表中且未超时；
  - 失败直接返回 `401 ERR_AUTH_UNAUTHORIZED`；成功则将当前用户基础模型 `req.currentUser` 挂载到请求上下文；
- **L2 账号状态级 (StatusGuard)**：
  - 检查 `req.currentUser.status`；
  - 若为 `PENDING`，除放行特权名单（`/auth/me`, `/auth/logout`）外，其余接口一律返回 `403 ERR_AUTH_ACCOUNT_PENDING`；
  - 若为 `REJECTED`，除放行特权名单（`/auth/me`, `/auth/logout`, `POST /approvals/resubmit`）外，其余返回 `403 ERR_AUTH_ACCOUNT_REJECTED`；
  - 若为 `DISABLED`，除放行特权名单（`/auth/me`, `/auth/logout`）外，其余返回 `403 ERR_AUTH_ACCOUNT_DISABLED`；
- **L3 密码有效期与改密守卫 (MustChangePwdGuard)**：
  - **前置条件：仅对状态已处于 `ACTIVE` 的用户生效**；
  - **拦截触发条件**：
    1. `currentUser.must_change_password === true`（例如超管手动在后台重置了该账号密码）；
    2. 或当前时间超过了密码过期点（`is_password_expired === true`，即 `password_expires_days !== null && now > password_expires_at`）；
  - **改密放行白名单与方法级精准控制**：命中拦截后，除放行改密与会话必需端点（`POST /api/v1/auth/change-password`、`GET /api/v1/auth/me`、`POST /api/v1/auth/logout`、`GET /api/v1/auth/csrf`）以及**特权只读端点 `GET /api/v1/auth/password-policy`**（仅允许 GET 读取策略，**严禁豁免 `PUT /api/v1/auth/password-policy`**，防止超期用户在改密前关闭或篡改过期策略）外，访问系统内任何其他业务端点均返回 `403 ERR_MUST_CHANGE_PASSWORD`；
- **L4 RBAC 细粒度角色级 (RoleGuard)**：
  - 校验 `req.currentUser.roles` 是否包含目标路由声明的所需角色（如 `SUPER_ADMIN`、`SECURITY_ADMIN`、`DBA` 等）；
  - 校验失败立即返回 `403 ERR_RBAC_FORBIDDEN`。

### 4.2 账号全生命周期状态机与路由分流

系统严格管理账号自注册至停用的完整闭环状态机。**用户自主注册时即须填写强密码，审批通过后账号直接激活可用，无需首次登录强制重置**：

```
                    ┌─────────────────────────┐
                    │  自主注册申请 (强密码)   │
                    └────────────┬────────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │   PENDING (待审批)    │◀──────────────────┐
                     └───────────┬───────────┘                   │
                                 │                               │
                 ┌───────────────┴───────────────┐               │
                 ▼                               ▼               │
      ┌─────────────────────┐        ┌───────────────────────┐   │
      │  ACTIVE (直接激活)  │        │  REJECTED (已驳回)    │   │
      │ (可直接使用原密码)  │        └───────────┬───────────┘   │
      └──────────┬──────────┘                    │               │
                 │                               └────── 重新提交 ┘
        ┌────────┴────────────────────┐
        ▼                             ▼
┌──────────────────────────┐   ┌──────────────┐
│ 超期失效或管理员重置      │   │   DISABLED   │
│ (触发改密弹窗锁定)       │   │   (已停用)   │
└──────────────────────────┘   └──────────────┘
```

#### 前端路由分流与状态映射表
| 用户账号状态 | 密码有效状态 | 前端路由行为 | 允许访问的控制台视图 |
| :--- | :---: | :--- | :--- |
| **未登录** | - | 强制重定向至 `/login` | 登录页 (`/login`)、注册页 (`/register`) |
| **`PENDING`** | 正常 | 全局路由拦截，重定向至审批等待页 | 待审批专属状态页 (`/approvals/wait`) |
| **`REJECTED`** | 正常 | 全局路由拦截，重定向至驳回详情页 | 驳回重提专属页 (`/approvals/rejected`) |
| **`DISABLED`** | - | 全局路由拦截，重定向至停用告示页 | 停用告知专属页 (`/disabled`) |
| **`ACTIVE`** | **已过期或被重置** | 全局弹窗模态锁定，不可关闭 | 强制改密模态对话框 (`/change-password`) |
| **`ACTIVE`** | **正常有效** | 正常加载控制台，进入大盘与功能页 | 根据角色分配进入对应功能模块 (`/dashboard`, `/profiles` 等) |

### 4.3 `/auth/me` 全状态 200 返回与前端会话引导

- **契约定义**：只要调用方携带合法的 `mcp_admin_sid` 会话 Cookie，**无论该用户当前处于 `PENDING`、`ACTIVE`、`REJECTED` 还是 `DISABLED`，`GET /api/v1/auth/me` 一律稳定返回 HTTP 200 OK**；
- **解决的痛点**：杜绝后端在用户待审或停用时直接在 `/auth/me` 抛 403 导致前端 `AuthGuard` 无法获取用户信息从而陷入死循环；
- **返回模型 (`UserProfileDTO`)**：
  ```json
  {
    "id": "1001",
    "username": "zhangsan",
    "email": "zhangsan@example.com",
    "department": "AI平台研发部",
    "status": "ACTIVE",
    "must_change_password": false,
    "password_updated_at": "2026-11-08T06:00:00.000Z",
    "password_expires_days": 90,
    "password_expires_at": "2027-02-06T06:00:00.000Z",
    "is_password_expired": false,
    "version": 1,
    "roles": ["DEVELOPER"],
    "reject_reason": null,
    "created_at": "2026-11-08T06:00:00.000Z"
  }
  ```
  - 当且仅当 `status === 'REJECTED'` 时，下发 `reject_reason` 字段；其余状态下该字段为 `null`；
  - `password_expires_days`：当前密码有效期天数，默认 90 天；若用户或管理员选择关闭定期重置，该字段返回 `null`，`password_expires_at` 同步返回 `null`，`is_password_expired` 恒为 `false`；
  - `version`：当前用户主记录的乐观锁版本号，用于更新角色与状态时的并发冲突校验。

### 4.4 密码生命周期：强密码基线、可配置轮换、安全风险提示与 DDL 迁移

系统确立了“注册即强口令、审批直接激活、可配置周期轮换、关闭强风险提醒”的完整密码治理闭环：

1. **注册强口令基线**：
   - 用户在 `POST /api/v1/auth/register` 提交时即进行强密码语法校验（8~64 位字符，必须混合包含大写字母、小写字母、数字及特殊符号）；
   - 注册成功且通过管理员审批激活后，`must_change_password` 保持为 `false`，**无需首次登录强制修改，用户可直接使用注册密码登录**；
2. **密码有效期与可配置轮换策略 (30~180 天，默认 90 天)**：
   - **默认时限**：系统默认密码有效期为 **90 天**（自注册或最后一次修改密码的时间 `password_updated_at` 起算）；
   - **用户可配置区间**：用户可在个人设置中自行调整密码轮换周期，允许配置的合法阈值区间为 **30 ~ 180 天**；
   - **允许关闭与高风险提示铁律 (Security Risk Warning)**：
     - 允许用户或管理员选择“关闭定期重置”（即永不过期，`passwordExpiresDays: null`）；
     - **前端交互约束**：当用户在界面勾选或选择“关闭定期更换”时，**前端必须弹出醒目的高风险安全确认对话框**：
       > “⚠️ **安全风险警示**：关闭密码定期轮换将使得账号密码永不过期，可能显著增加凭据被泄露、撞库或长期未察觉被盗用的安全风险。建议保持 90 天定期更换周期。确认要关闭定期轮换吗？”
     - 仅当用户主动勾选“我已知晓安全风险”并点击确认后，前端才允许发起提交；
     - **后端审计追踪**：服务端将“关闭密码定期轮换”标记为高危安全行为，在 `sys_user_approvals` 或管理审计表中记录审计流水；
3. **元数据库 DDL 增量迁移规范 (Database Migration Baseline)**：
   为正式落地上述密码生命周期管理能力，系统对 `sys_users` 表执行如下标准 DDL 升级：
   ```sql
   -- 步骤 1：增加版本列与密码字段 (允许 NULL 以支持存量平滑回填)
   ALTER TABLE `sys_users` 
     ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',
     ADD COLUMN `password_updated_at` DATETIME DEFAULT NULL COMMENT '密码最后修改时间',
     ADD COLUMN `password_expires_days` INT DEFAULT 90 COMMENT '密码有效期天数 (30-180，NULL表示永不过期)';

   -- 步骤 2：存量历史数据平滑回填，起算点设定为用户创建时间 created_at
   UPDATE `sys_users` 
   SET `password_updated_at` = `created_at`, `password_expires_days` = 90 
   WHERE `password_updated_at` IS NULL;

   -- 步骤 3：收紧非空约束与自动默认值
   ALTER TABLE `sys_users` 
     MODIFY COLUMN `password_updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '密码最后修改时间';
   ```
4. **过期主动拦截与改密在途销毁联动**：
   - 当密码到期（`now > password_expires_at`），L3 守卫拦截后续业务请求，返回 `403 ERR_MUST_CHANGE_PASSWORD`（附带自愈指引：“密码已超过有效期（90天），请修改密码后继续使用”）；
   - 用户调用 `POST /api/v1/auth/change-password` 成功后：
     - 同事务更新 `password_hash`、置 `must_change_password = 0`、刷新 `password_updated_at = UTC_TIMESTAMP(3)`、递增 **`auth_version = auth_version + 1`**、递增 **`version = version + 1`**；
     - 同步调用 `lifecycleCoordinator.cancelQueriesByUser(userId, 'PASSWORD_CHANGED')` 掐断在途 SQL；
     - 轮换 Session ID，并在下一周期重新开始计算 90 天（或用户自定义天数）倒计时。

---

## 第五章：并发控制与安全防护契约

### 5.1 乐观并发控制规范 (Optimistic Locking & Versioning)

在控制台多管理员并发治理环境下，为避免后提交者静默覆盖前者的配置变更，系统在所有核心业务实体上实施**强校验乐观并发控制 (CAS)**：

#### 1. 纳管实体与版本来源
| 业务实体 | 对应数据表 | 版本来源字段 | 最小自增步长 | 说明 |
| :--- | :--- | :--- | :---: | :--- |
| **数据源配置** | `sys_profiles` | `version` (INT UNSIGNED) | +1 | 每次更新连接参数或热重载连接池时自增 |
| **角色策略模版** | `sys_roles` | `version` (INT UNSIGNED) | +1 | 每次修改默认 LIMIT、配额或超时时间时自增 |
| **表级 ACL 规则集** | `sys_roles` / `sys_role_table_acls` | 共享父记录 `sys_roles.version` | +1 | 全量替换表级 ACL 规则时原子校验并递增父角色版本 |
| **库级 ACL 规则集** | `sys_roles` / `sys_role_database_acls` | 共享父记录 `sys_roles.version` | +1 | 全量替换库级 ACL 规则时原子校验并递增父角色版本 |
| **用户角色与状态** | `sys_users` | `version` (INT UNSIGNED) | +1 | 分配角色与启停账号时原子 CAS 校验，防止并发覆盖 |
| **全局限流规则** | `sys_rate_limits` | `version` (INT UNSIGNED) | +1 | `scope_type = 'GLOBAL'` 的系统基线限流 |
| **用户专属限流** | `sys_rate_limits` | `version` (INT UNSIGNED) | +1 | `scope_type = 'USER'` 的用户专属配额 (继承态 version=0) |
| **系统通知设置** | `sys_system_settings` | `version` (INT UNSIGNED) | +1 | Webhook 渠道启用与告警事件更新时自增 |

#### 2. 交互协议与 CAS 执行规则
- **GET 查询回显**：实体详情或列表中显式返回整数 `version`；
- **PUT 请求携带**：客户端在发起更新时，**必须在请求体根节点原样包含读取到的 `version`**；
- **服务端原子校验**：
  ```sql
  UPDATE sys_profiles 
  SET display_name = ?, host = ?, port = ?, ..., version = version + 1 
  WHERE id = ? AND version = ?;
  ```
  若影响行数 (`affectedRows`) 为 0，表明数据已被他人抢先更新，立即回滚事务并返回：
  ```http
  HTTP/1.1 409 Conflict
  Content-Type: application/json; charset=utf-8

  {
    "code": "ERR_CONCURRENCY_CONFLICT",
    "message": "当前配置已被其他管理员更新，请重新加载最新版本。",
    "timestamp": "2026-11-08T06:30:15.123Z",
    "action_guidance": "检测到版本号冲突，已保留您的修改草稿。请比对差异后重新提交。",
    "details": {
      "current_version": 3,
      "submitted_version": 2
    }
  }
  ```
- **前端草稿保护铁律**：前端接收到 409 状态码后，**严禁清空用户的当前表单**，必须保持用户的本地输入草稿，弹出冲突差异提示条，允许管理员查看远端变更并手动合并提交。

### 5.2 连接路径与信任边界变更防外泄铁律 (端点适用范围精准界定)

为防止存量凭据在网络转发路径变更时被恶意复用探测未授权内网或受到中间人劫持，系统针对**不同端点所使用的实际凭据**实施精确界定的防外泄防御模型：

#### 1. 数据库端点保存 (`PUT /profiles/:id`) 与数据库测试 (`POST /profiles/test-db`)
当管理员在编辑已有数据源或执行数据库连通性测试时，**只要发生以下任一信任边界与连接端点变动，必须重新输入数据库密码（若启用 SSH，同时必须重新录入私钥与指纹）**：
1. **数据库端点与认证身份变更**：修改了 `host`、`port` 或 `user`；
2. **网络转发隧道与信任边界变更**：
   - 切换 `use_ssh` 状态（由关闭切为开启，或由开启切为关闭）；
   - 或修改了跳板机连接参数：`ssh_host`、`ssh_port`、`ssh_user`、`ssh_host_fingerprint_sha256`；
3. **传输层加密信任级别变更**：
   - 切换 `tls_config.enabled`（由关闭切为开启，或由开启切为关闭）；
   - 或修改了自定义 CA 证书文本 `tls_config.ca_cert`。

若发生上述任一变动而请求体中 `password` 为空、缺省或为 `"******"`，服务端**无条件阻断，统一返回 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`**；
只有在数据库端点、SSH 转发隧道、跳板机指纹与 TLS 配置**全链路拓扑完全未变**的前提下（例如仅修改展示名、连接池大小、QPM配额、排队超时），才允许密码留空以沿用库内旧密文。

#### 2. SSH 堡垒机独立连通性测试 (`POST /profiles/test-ssh`)
- **适用凭据精确限定**：`test-ssh` 仅测试从网关到堡垒机的 SSH 传输层连通性与公钥认证，**绝不建立 MySQL 连接，请求结构无需也绝不要求提供数据库密码**；
- **SSH 独立防外泄约束**：若在测试已存配置草稿时修改了 `ssh_host`、`ssh_port` 或 `ssh_user`，必须在请求体中提供新 `privateKey` 与 `hostFingerprintSha256`；若未填新私钥则抛出 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`；若跳板机参数未变且携带 `profile_id`，允许复用库内已解密私钥测通。

### 5.3 全场景 SSRF 深度防御与双栈地址过滤策略 (`ERR_SSRF_PROHIBITED`)

数据源连通性测试、Profile 保存后连接池构建以及系统通知 Webhook 推送属于主动发起外部出站请求的高危链路，必须严格通过 SSRF 深度防御流水线：

#### 1. 规范化与地址类型全面归一
- **IPv4-Mapped IPv6 规范化**：解析或输入若包含 `::ffff:0:0/96`（例如 `::ffff:127.0.0.1`、`::ffff:10.0.8.21`），在匹配过滤规则前必须强制解包规范化还原为原生 IPv4 地址进行判定；
- **IPv6 统一小写全展开**：所有 IPv6 地址进行标准化展开比对，杜绝利用双冒号压缩混淆绕过。

#### 2. 全量受限地址段黑名单 (Comprehensive IP Deny-List)
系统默认禁止向下列所有非公网单播与特殊用途 IP 发起出站 TCP 连接：
| 协议类型 | 地址类别 | 拦截 CIDR 范围 | 安全风险与防范说明 |
| :--- | :--- | :--- | :--- |
| **IPv4** | 本地环回 (Loopback) | `127.0.0.0/8` | 防止探测本地宿主机未授权服务 |
| | 本地网络 (This host) | `0.0.0.0/8` | 未指定源地址 |
| | 私有内网 (RFC 1918) | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | 除非在 `ALLOWED_OUTBOUND_IPS` 白名单中，默认禁止探测内网 |
| | 链路本地 / 云元数据 | `169.254.0.0/16` (含 `169.254.169.254`) | 严格阻断云厂商 Metadata 凭据外泄 (AWS, GCP, Aliyun) |
| | 运营级 NAT (CGNAT) | `100.64.0.0/10` | 运营商级共享内网 |
| | 组播与保留地址 | `224.0.0.0/4`, `240.0.0.0/4`, `255.255.255.255/32` | 广播组播滥用 |
| | 文档保留地址 | `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | 测试文档保留网段 |
| **IPv6** | 节点环回 (Loopback) | `::1/128` | 本机环回访问拦截 |
| | 未指定地址 | `::/128` | 未指定目标 |
| | 唯一本地地址 (ULA) | `fc00::/7` (RFC 4193) | IPv6 内部私有局域网，除非白名单显式放行 |
| | 链路本地地址 | `fe80::/10` | 邻居发现与链路内部保留 |
| | 组播地址 | `ff00::/8` | IPv6 组播 |
| | 文档保留地址 | `2001:db8::/32` | IPv6 示例保留网段 |
| | IPv4 映射地址 | `::ffff:0:0/96` | 统一解包按 IPv4 黑名单处理 |

#### 3. 双栈 (Dual-Stack) DNS 解析与 Fail-Closed 判定规则
- **A 与 AAAA 记录并发解析**：提取域名执行 DNS 解析时，必须同时查询所有 A 与 AAAA 记录；
- **全量无死角校验 (Fail-Closed)**：解析出的**所有物理 IP 地址必须逐一通过上述黑名单核验**；若其中任意一个 IP 命中受限网段，**整个请求必须立即 Fail-Closed 阻断拒绝**，返回 `403 ERR_SSRF_PROHIBITED`，防止轮询 DNS (DNS Round-Robin) 穿透内网；
- **IP Pinning 连接锁定**：校验通过后，后续实际网络 Socket 必须直接连向已通过安全核验的 `pinnedIp`，并严格复用该 IP，彻底免疫二次 DNS 重绑定 (Time-of-Check to Time-of-Use, TOCTOU) 攻击；
- **TLS 证书域名绑定**：底层 TCP 连向 `pinnedIp`，而 TLS 握手 SNI 与服务端证书核验的主机名（`servername` / `checkServerIdentity`）严格绑定为原始域名 `host`。

### 5.4 超管防自残保护与排他事务自锁控制 (`ERR_LAST_SUPER_ADMIN`)

超级管理员具备系统最高治理权限，为杜绝由于误操作或并发竞争导致系统中“无任何可用超级管理员”的系统性瘫痪（自残），系统在数据库事务级建立刚性保护：

1. **本人操作防护 (`ERR_SELF_ACTION_PROHIBITED`)**：
   - 超管用户不可在用户列表中调用接口将自己的账号设为 `DISABLED`；
   - 超管用户不可调用接口删除自己的用户账号；
   - 超管用户不可在分配角色时将自己的 `SUPER_ADMIN` 角色移除；
   - 违反者一律拦截返回 `400 ERR_SELF_ACTION_PROHIBITED`；
2. **并发排他判定与“仅存最后一名超管”自锁保护 (`ERR_LAST_SUPER_ADMIN`)**：
   当管理员尝试停用、删除或降级其他超级管理员账号时，后端必须在事务内加排他锁判定操作后的剩余超管数：
   ```sql
   -- 所有授予/撤销、启停、删除、审批授予都先锁永久角色行。
   SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE;
   SELECT id, status FROM sys_users ORDER BY id FOR UPDATE;
   SELECT user_id FROM sys_user_roles WHERE role_id = ? ORDER BY user_id FOR UPDATE;
   -- 用当前读集合计算本次操作后的ACTIVE超管数量（仅实际减少集合时检查）。
   ```
   若计算出的 `active_super_admins < 1`，事务立即自动回滚，并抛出：
   ```http
   HTTP/1.1 400 Bad Request
   Content-Type: application/json; charset=utf-8

   {
     "code": "ERR_LAST_SUPER_ADMIN",
     "message": "操作已被阻止：系统必须保留至少 1 名活跃超级管理员。",
     "timestamp": "2026-11-08T06:30:15.123Z",
     "action_guidance": "当前目标用户为系统仅存的最后一名活跃超级管理员。请先激活或指派其他超级管理员账号，再对当前账号执行变更。"
   }
   ```

### 5.5 PAT 个人访问令牌生命周期与“单次明文展示”契约

个人访问令牌（PAT）用于大模型 Agent 接入数据面网关时进行身份凭证鉴权：

1. **高强度单向安全存储与 72 字符规范**：
   - 生成：256-bit CSPRNG 安全随机数（32 字节原始熵），采用 64 位十六进制小写编码，固定携带 `mcp_pat_` 前缀，Token 完整总长度固定为 **72 位字符**（格式匹配 `^mcp_pat_[0-9a-f]{64}$`）；
   - 展示脱敏：控制台仅暴露前 16 位脱敏前缀（`token_prefix`，如 `mcp_pat_8f3a9e2d...`）；
   - 存储：数据库仅持久化其 HMAC-SHA-256 不可逆哈希摘要（`token_hash`，64 位十六进制字符）。
2. **单次明文返回契约 (Single-Viewing Secret Contract)**：
   - 完整的 Token 明文（`rawToken`）**仅在调用 `POST /api/v1/pats` 成功的单次响应体中返回**；
   - 随后的所有 `GET /api/v1/pats` 列表接口中，绝不返回明文，仅展示 `token_prefix` 与脱敏占位符；
3. **前端防呆确认模态框 (`PatModal`)**：
   - 创建成功后，前端展示全屏遮罩的凭证防呆弹窗，包含：
     - 明文复制按钮与显隐切换开关；
     - 显式警告文案：“该令牌密钥仅显示一次，离开页面后将无法找回。请立即复制并妥善保管”；
     - 三态配置片段一键生成器：实时生成 Cursor、Claude Desktop、LibreChat 的 `mcpServers` JSON 配置模板。

---

## 第六章：管控面 RESTful API 全量接口契约详述

### 6.1 认证模块接口契约 (`/api/v1/auth/*`)

#### 6.1.1 获取 CSRF 安全令牌
- **接口路径**：`GET /api/v1/auth/csrf`
- **守卫级别**：`L0 公开端点`
- **功能说明**：公开无门槛获取当前会话的 CSRF 安全令牌。若当前客户端未分配种子，服务端在响应头中同时下发 `mcp_csrf_seed` Cookie。前端在单飞刷新时统一调用此接口。
- **请求头**：无特殊要求（可携带已有 Cookie）。
- **请求入参**：*(无入参)*
- **成功响应**：`200 OK`
  ```json
  {
    "csrfToken": "a8f3c7b2e1d045899c34f0e7d6a5b1c8e9f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0"
  }
  ```

---

#### 6.1.2 用户自主申请注册 (强密码录入)
- **接口路径**：`POST /api/v1/auth/register`
- **守卫级别**：`L0 公开端点` (挂载 IP 级频控与 Argon2 并发信号量)
- **功能说明**：外部研发人员自助提交账号注册申请。**用户提交时即须设置高强度正式密码**。初始账号状态设为 `PENDING`，`must_change_password=0`，密码默认有效期设为 90 天，记录至审批表等待管理员审批。管理员审核通过激活后，**用户可直接使用此密码登录，无需首次强制改密**。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `username` | `string` | 是 | 长度 3~64 字符，仅限 `^[a-zA-Z0-9_-]+$` | 注册登录账号名 (全局唯一) |
  | `password` | `string` | 是 | 长度 8~64 字符，须混合大小写字母、数字及特殊符号 | 用户设置的正式强密码 (HTTPS加密传输，后端Argon2id加盐存储) |
  | `email` | `string` | 否 | 合法 Email 格式，最大 128 字符 | 用户工作邮箱 |
  | `department` | `string` | 否 | 最大 128 字符 | 所属部门或业务线 |
  | `reason` | `string` | 否 | 最大 512 字符 | 申请账号的使用背景与理由 |
- **请求示例**：
  ```json
  {
    "username": "zhangsan",
    "password": "Password123#",
    "email": "zhangsan@example.com",
    "department": "AI平台研发部",
    "reason": "用于接入智能客服数据分析 Agent，需访问生产从库订单表。"
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "message": "注册申请已成功提交，请等待系统管理员审批。"
  }
  ```
- **错误分支**：
  - `400 ERR_PASSWORD_POLICY_VIOLATED`：密码不满足复杂度要求（须含大小写字母、数字及特殊字符）；
  - `400 ERR_VALIDATION_FAILED`：参数格式校验不通过；
  - `409 ERR_AUTH_USERNAME_EXISTS`：用户名已被占用；
  - `429 ERR_RATE_LIMIT_USER`：注册 IP 触发防刷频控保护。

---

#### 6.1.3 账号密码登录
- **接口路径**：`POST /api/v1/auth/login`
- **守卫级别**：`L0 公开端点` (挂载 IP+账号双维防爆破与 Argon2 信号量)
- **功能说明**：验证用户名与密码。登录成功后轮换会话并下发 `mcp_admin_sid` HttpOnly Cookie。返回用户信息及密码有效期与到期状态。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `username` | `string` | 是 | 登录用户名 |
  | `password` | `string` | 是 | 登录密码 |
- **请求示例**：
  ```json
  {
    "username": "admin",
    "password": "InitialAdminPassword123#"
  }
  ```
- **成功响应**：`200 OK`
  - **响应头**：`Set-Cookie: mcp_admin_sid=sess_9f8a...; Path=/api/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`
  - **响应体**：
    ```json
    {
      "user": {
        "id": "1",
        "username": "admin",
        "email": "admin@example.com",
        "department": "安全运维部",
        "status": "ACTIVE",
        "must_change_password": false,
        "password_updated_at": "2026-11-01T00:00:00.000Z",
        "password_expires_days": 90,
        "password_expires_at": "2027-01-30T00:00:00.000Z",
        "is_password_expired": false,
        "version": 1,
        "roles": ["SUPER_ADMIN"],
        "reject_reason": null,
        "created_at": "2026-11-01T00:00:00.000Z"
      }
    }
    ```
- **错误分支**：
  - `401 ERR_AUTH_FAILED`：账号或密码错误（携带 `remaining_attempts`）；
  - `429 ERR_AUTH_ACCOUNT_LOCKED`：连续 5 次密码错误，账号临时锁定 15 分钟（携带 `retry_after_sec`）；
  - `400 ERR_VALIDATION_FAILED`：入参缺失。

---

#### 6.1.4 账号登出
- **接口路径**：`POST /api/v1/auth/logout`
- **守卫级别**：`L1 会话有效级`
- **功能说明**：注销服务端 Session 记录，清除客户端 `mcp_admin_sid` Cookie。
- **请求头**：`x-csrf-token: <string>`
- **请求入参**：*(无入参)*
- **成功响应**：`200 OK`
  - **响应头**：`Set-Cookie: mcp_admin_sid=; Path=/api/v1; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
  - **响应体**：
    ```json
    {
      "success": true
    }
    ```

---

#### 6.1.5 修改登录密码 (常规改密 / 超期改密 / 重置改密)
- **接口路径**：`POST /api/v1/auth/change-password`
- **守卫级别**：`L2 账号状态级` (允许已登录且密码过期或 `must_change_password=1` 的 ACTIVE 账号访问)
- **功能说明**：更新用户登录密码。成功后重置 `must_change_password=0`，刷新 `password_updated_at = UTC_TIMESTAMP(3)`，自增 `version` 与 `auth_version`，物理中断该用户在途 SQL 查询并轮换会话。
- **防踢出契约**：旧密码输入错误返回 **`400 ERR_OLD_PASSWORD_INVALID`**，禁止返回 401，防止前端拦截器将用户误踢出登录态并清空改密表单。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 默认值 | 描述 |
  | :--- | :---: | :---: | :---: | :--- |
  | `oldPassword` | `string` | 是 | - | 当前旧密码 |
  | `newPassword` | `string` | 是 | - | 符合安全复杂度要求的新密码 (8~64位，含大小写字母、数字及特殊符号) |
  | `revokeAllPats` | `boolean` | 否 | `true` | 是否同时吊销历史签发的所有个人访问令牌 (PAT) |
- **请求示例**：
  ```json
  {
    "oldPassword": "OldPassword123#",
    "newPassword": "NewStrongSecret2026!#",
    "revokeAllPats": true
  }
  ```
- **成功响应**：`200 OK`
  - **响应头**：换发全新 `mcp_admin_sid` 会话 Cookie
  - **响应体**：
    ```json
    {
      "success": true
    }
    ```
- **错误分支**：
  - `400 ERR_OLD_PASSWORD_INVALID`：旧密码验证错误 (400 业务错误，保留会话不跳转)；
  - `400 ERR_PASSWORD_POLICY_VIOLATED`：新密码不符合复杂度策略；
  - `400 ERR_SAME_AS_OLD_PASSWORD`：新密码与当前旧密码相同。

---

#### 6.1.6 获取当前登录人会话信息
- **接口路径**：`GET /api/v1/auth/me`
- **守卫级别**：`L1 会话有效级` (全状态放行契约)
- **功能说明**：返回当前客户端会话对应的用户信息、所属角色、账号状态以及密码过期相关元数据。对于 `PENDING`、`REJECTED`、`DISABLED` 均稳定返回 HTTP 200，由前端分流守卫导流。
- **请求头**：依赖浏览器自动附带的 Cookie `mcp_admin_sid`。
- **请求入参**：*(无入参)*
- **成功响应**：`200 OK`
  ```json
  {
    "id": "1001",
    "username": "zhangsan",
    "email": "zhangsan@example.com",
    "department": "AI平台研发部",
    "status": "ACTIVE",
    "must_change_password": false,
    "password_updated_at": "2026-11-08T06:00:00.000Z",
    "password_expires_days": 90,
    "password_expires_at": "2027-02-06T06:00:00.000Z",
    "is_password_expired": false,
    "version": 1,
    "roles": ["DEVELOPER"],
    "reject_reason": null,
    "created_at": "2026-11-08T06:00:00.000Z"
  }
  ```
- **错误分支**：
  - `401 ERR_AUTH_UNAUTHORIZED`：Cookie 缺失、伪造或会话已过期。

---

#### 6.1.7 查询个人密码过期策略与剩余有效期
- **接口路径**：`GET /api/v1/auth/password-policy`
- **守卫级别**：`L2 账号状态级` (仅限 ACTIVE 用户，对密码已超期失效者豁免 L3)
- **功能说明**：查询当前登录用户的密码到期策略配置、当前剩余可用天数及系统支持的配置阈值。
- **成功响应**：`200 OK`
  ```json
  {
    "passwordExpiresDays": 90,
    "passwordExpiresAt": "2027-02-06T06:00:00.000Z",
    "isExpirationEnabled": true,
    "daysRemaining": 89,
    "isExpired": false,
    "minDays": 30,
    "maxDays": 180
  }
  ```
  - 当 `isExpirationEnabled === false` 时，`passwordExpiresDays` 与 `passwordExpiresAt` 返回 `null`，`daysRemaining` 返回 `-1`。

---

#### 6.1.8 更新个人密码过期与轮换策略 (带关闭风险提示)
- **接口路径**：`PUT /api/v1/auth/password-policy`
- **守卫级别**：`L4 角色守卫` (全体 `ACTIVE` 用户)
- **功能说明**：用户自定义其账号密码的定期更换周期。支持配置 30~180 天，或传入 `null` 关闭定期重置（永不过期）。
- **前端安全风险提示约束**：
  当用户在前端界面尝试关闭定期更换（即传入 `null`）时，**前端必须弹出醒目的高风险安全确认对话框**：
  > “⚠️ **安全风险警示**：关闭密码定期轮换将使得账号密码永不过期，可能显著增加凭据被泄露、撞库或长期未察觉被盗用的安全风险。建议保持 90 天定期更换周期。确认要关闭定期轮换吗？”
  用户显式确认后方可提交。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `passwordExpiresDays` | `number \| null` | 是 | 整数 `30 <= val <= 180`，或 `null` | 密码有效天数。传 `null` 表示关闭定期重置 |
- **请求示例 (调整为 60 天)**：
  ```json
  {
    "passwordExpiresDays": 60
  }
  ```
- **请求示例 (关闭定期重置)**：
  ```json
  {
    "passwordExpiresDays": null
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "passwordExpiresDays": 60,
    "passwordExpiresAt": "2027-01-07T06:00:00.000Z",
    "isExpirationEnabled": true
  }
  ```
- **错误分支**：
  - `400 ERR_VALIDATION_FAILED`：有效天数不在 30~180 天范围内；
  - `403 ERR_CSRF_INVALID`：CSRF 令牌无效。

---

### 6.2 注册与审批流模块接口契约 (`/api/v1/approvals/*`)

#### 6.2.1 获取待审批工单分页列表
- **接口路径**：`GET /api/v1/approvals/pending`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：分页拉取当前系统中所有处于 `PENDING` 待审状态的用户注册申请工单列表。
- **查询参数 (Query Parameters)**：
  | 参数名 | 类型 | 必填 | 默认值 | 描述 |
  | :--- | :---: | :---: | :---: | :--- |
  | `page` | `number` | 否 | `1` | 页码 (`>= 1`) |
  | `pageSize` | `number` | 否 | `20` | 每页数量 (`1 <= pageSize <= 100`) |
- **成功响应**：`200 OK`
  ```json
  {
    "items": [
      {
        "id": "5001",
        "user_id": "1002",
        "username": "lisi",
        "email": "lisi@example.com",
        "department": "风控数据组",
        "reason": "需要通过 Agent 定期审计数据表结构变动。",
        "created_at": "2026-11-08T07:15:30.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
  ```
  - `id`: 工单全局唯一标识 (`approval_id`)，后续通过/驳回接口的路径参数 `:id` 必须严格传入此 ID。

---

#### 6.2.2 审批通过并激活账号
- **接口路径**：`POST /api/v1/approvals/:id/approve`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (待审工单 ID，`string`，对应待审列表返回的 `items[].id`)
- **功能说明**：审核通过注册申请，赋予用户指定的初始角色并将用户状态置为 `ACTIVE`。**用户账号被直接激活，`must_change_password` 保持为 0，用户可立即使用其注册时填写的强密码登录进入控制台正常工作，无需首次登录强制重置**。
- **原子条件更新与防并发冲突**：
  服务端在事务内执行排他条件更新：
  ```sql
  UPDATE sys_user_approvals 
  SET action = 'APPROVE', operator_id = ? 
  WHERE id = ? AND action IN ('SUBMIT', 'RESUBMIT');
  ```
  同时原子更新用户状态 `UPDATE sys_users SET status = 'ACTIVE', version = version + 1 WHERE id = targetUserId AND status = 'PENDING';`。
若工单或用户更新的影响行数为 0，说明该工单已被其他管理员审批处理或状态已发生变动，事务立即回滚并返回 `409 ERR_APPROVAL_STATE_CONFLICT`。
- **安全约束**：`SECURITY_ADMIN` 无权授予 `SUPER_ADMIN` 角色（越权检查）。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `roleIds` | `string[]` | 是 | 赋予该用户的初始角色 ID 列表 (至少 1 项) |
- **请求示例**：
  ```json
  {
    "roleIds": ["2", "3"]
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `409 ERR_APPROVAL_STATE_CONFLICT`：工单已被其他管理员审批或账号已非待审状态；
  - `400 ERR_VALIDATION_FAILED`：角色 ID 列表为空或包含非法 ID；
  - `403 ERR_RBAC_FORBIDDEN`：当前操作管理员无权授予目标角色；
  - `404 ERR_NOT_FOUND`：目标待审工单不存在。

---

#### 6.2.3 驳回用户注册申请
- **接口路径**：`POST /api/v1/approvals/:id/reject`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (待审工单 ID，`string`，对应待审列表返回的 `items[].id`)
- **功能说明**：驳回用户注册申请，将用户状态流转为 `REJECTED`，必填驳回理由，同事务记录至审批流历史表。
- **原子状态检查与条件更新**：
  服务端在事务内原子更新：
  ```sql
  UPDATE sys_user_approvals 
  SET action = 'REJECT', reason = ?, operator_id = ? 
  WHERE id = ? AND action IN ('SUBMIT', 'RESUBMIT');
  ```
  同时原子更新用户状态为 `REJECTED`。若影响行数为 0，说明工单已被抢审，返回 `409 ERR_APPROVAL_STATE_CONFLICT`。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `reason` | `string` | 是 | 长度 1~512 字符 | 明确的驳回原因与修改指引 |
- **请求示例**：
  ```json
  {
    "reason": "请补充具体的业务主管审批单号，并明确写明 Agent 需要查询的数据表范围。"
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `409 ERR_APPROVAL_STATE_CONFLICT`：工单已被其他管理员处理；
  - `400 ERR_VALIDATION_FAILED`：驳回原因未填写；
  - `404 ERR_NOT_FOUND`：目标工单不存在。

---

#### 6.2.4 被驳回用户补充信息重新提交
- **接口路径**：`POST /api/v1/approvals/resubmit`
- **守卫级别**：`L1 会话有效级` (仅限当前状态处于 `REJECTED` 的用户调用)
- **功能说明**：被驳回用户补充申请理由、邮箱或部门后重新提交。状态原子回迁至 `PENDING`，同事务追加一条 `RESUBMIT` 审批流日志，生成新的审批工单轮次。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `email` | `string` | 否 | 更新后的联系邮箱 |
  | `department` | `string` | 否 | 更新后的部门信息 |
  | `reason` | `string` | 是 | 重新修改补充后的申请说明 (1~512 字符) |
- **请求示例**：
  ```json
  {
    "email": "lisi@example.com",
    "department": "风控数据组",
    "reason": "已补充业务审批单号 OA-20261108-091，仅需查询 order_summary 脱敏视图。"
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `403 ERR_AUTH_ACCOUNT_PENDING`：当前账号已处于 PENDING 态，不可重复提交；
  - `400 ERR_VALIDATION_FAILED`：缺少必填的补充理由。

---

### 6.3 用户管理模块接口契约 (`/api/v1/users/*`)

#### 6.3.1 分页查询用户全量列表
- **接口路径**：`GET /api/v1/users`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **功能说明**：超级管理员检索系统全部用户账号列表，支持按用户名模糊搜索、状态过滤以及角色筛选。
- **查询参数 (Query Parameters)**：
  | 参数名 | 类型 | 必填 | 默认值 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `page` | `number` | 否 | `1` | 请求页码 (`>= 1`) |
  | `pageSize` | `number` | 否 | `20` | 每页数量 (`1 <= pageSize <= 100`) |
  | `search` | `string` | 否 | - | 用户名或邮箱模糊搜索关键词 |
  | `status` | `string` | 否 | - | 状态过滤: `PENDING`, `ACTIVE`, `REJECTED`, `DISABLED` |
  | `role` | `string` | 否 | - | 角色英文标识过滤 (如 `SUPER_ADMIN`, `DBA`) |
- **成功响应**：`200 OK`
  ```json
  {
    "items": [
      {
        "id": "1",
        "username": "admin",
        "email": "admin@example.com",
        "department": "平台架构部",
        "status": "ACTIVE",
        "must_change_password": false,
        "password_expires_days": 90,
        "is_password_expired": false,
        "version": 1,
        "roles": [
          { "id": "1", "role_name": "SUPER_ADMIN", "display_name": "超级管理员" }
        ],
        "is_last_super_admin": true,
        "created_at": "2026-11-01T00:00:00.000Z",
        "updated_at": "2026-11-07T12:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
  ```
  - `is_last_super_admin`：服务端动态计算布尔值。若为 `true`，前端在操作列禁用针对该用户的【停用】、【删除】与【取消超管角色】按钮，并展示防自残气泡提示；
  - `version`：用户账号主记录的当前乐观锁版本号，供更新角色或启停状态时进行并发冲突校验。

---

#### 6.3.2 变更用户账号状态 (冻结 / 解冻与状态转换矩阵)
- **接口路径**：`PUT /api/v1/users/:id/status`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：超级管理员启用或停用用户账号。校验 `version` (409 CAS)，同事务加锁校验超管自残，同事务写管理审计，并立即断流。
- **状态流转矩阵约束 (防审批绕过铁律)**：
  本接口仅用于存量正常或停用账号的启停流转，**严禁绕过审批治理流程**：
  | 当前状态 (From) | 允许的目标状态 (To) | 业务行为说明 |
  | :--- | :--- | :--- |
  | `ACTIVE` | `DISABLED` | 允许停用，校验自残保护与最后超管保护 |
  | `DISABLED` | `ACTIVE` | 允许解冻恢复已停用账号 |
  | `PENDING` | `*` (任何目标状态) | **严格禁止**！必须通过工单审批流程 (`POST /approvals/:id/approve` 或 `reject`) 流转。违者抛 `400 ERR_INVALID_STATUS_TRANSITION` |
  | `REJECTED` | `*` (任何目标状态) | **严格禁止**！必须由申请人补充重提并经由管理员审批通过后激活。违者抛 `400 ERR_INVALID_STATUS_TRANSITION` |
- **安全防线联动**：
  - 若将账号置为 `DISABLED`：服务端同步向内存下发 `markUserInvalidatedSync(targetUserId)`，并调用 `cancelQueriesByUser(targetUserId, 'ACCOUNT_DISABLED')` 立即掐断该用户在途所有 SQL 连接；
  - 超管自锁防线：禁止冻结自身；当目标为仅存的最后 1 名活跃超管时抛 `400 ERR_LAST_SUPER_ADMIN`。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `status` | `string` | 是 | 目标流转状态: 仅限 `'ACTIVE'` 或 `'DISABLED'` |
  | `version` | `number` | 是 | 当前读取到的用户记录乐观锁版本号 |
- **请求示例**：
  ```json
  {
    "status": "DISABLED",
    "version": 1
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 2
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：用户状态已被其他管理员抢先修改；
  - `400 ERR_SELF_ACTION_PROHIBITED`：超管尝试停用自己的账号；
  - `400 ERR_LAST_SUPER_ADMIN`：尝试停用系统中仅存的最后 1 名活跃超管；
  - `404 ERR_NOT_FOUND`：目标用户不存在。

---

#### 6.3.3 更新用户分配的角色绑定
- **接口路径**：`PUT /api/v1/users/:id/roles`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：全量覆盖更新指定用户的角色分配关系。校验 `version` (409 CAS) 杜绝并发静默覆盖。同事务写审计，更新 `sys_users.auth_version` 与 `sys_users.version`，使排队中的旧快照失效。
- **安全防线联动**：
  - 超管自残防线：若目标用户拥有 `SUPER_ADMIN`，且传入的 `roleIds` 不包含超管角色，且系统中除该用户外无其他活跃超管，触发 `400 ERR_LAST_SUPER_ADMIN` 阻断降级。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `roleIds` | `string[]` | 是 | 赋予该用户的全量角色 ID 列表 (允许分配多个角色) |
  | `version` | `number` | 是 | 当前读取到的用户主记录乐观锁版本号 |
- **请求示例**：
  ```json
  {
    "roleIds": ["2", "4"],
    "version": 1
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 2
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：用户角色配置已被其他管理员抢先修改；
  - `400 ERR_LAST_SUPER_ADMIN`：降级操作会导致系统中无可用超管；
  - `400 ERR_VALIDATION_FAILED`：角色 ID 列表包含不存在的角色；
  - `404 ERR_NOT_FOUND`：目标用户不存在。

---

#### 6.3.4 删除用户账号
- **接口路径**：`DELETE /api/v1/users/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：物理级联删除用户账号及名下所有 PAT 和角色关联。同事务排他锁自残判定，并立即同步断流。
- **请求头**：`x-csrf-token: <string>`
- **请求入参**：*(无请求体)*
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `400 ERR_SELF_ACTION_PROHIBITED`：禁止删除当前登录的管理员自身账号；
  - `400 ERR_LAST_SUPER_ADMIN`：目标为最后一名超管，禁止删除；
  - `404 ERR_NOT_FOUND`：目标用户不存在。

---

#### 6.3.5 管理员重置指定用户密码 / 标记强制改密
- **接口路径**：`POST /api/v1/users/:id/reset-password`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：超级管理员重置指定用户的登录口令，或为用户分配新的临时密码并标记下次登录强制改密。
- **同事务联动与会话清退 (支持选择是否强制改密)**：
  在同一个元数据库事务内执行原子变更：
  ```sql
  UPDATE sys_users 
  SET password_hash = ?, 
      must_change_password = ?, -- 按请求参数动态写入: mustChangePassword === false ? 0 : 1 (默认 1)
      password_updated_at = UTC_TIMESTAMP(3),
      auth_version = auth_version + 1, 
      version = version + 1 
  WHERE id = ? AND version = ?;
  ```
  - 若 `mustChangePassword === true`（默认）：用户下次登录时必须修改密码；
  - 若管理员明确传入 `mustChangePassword === false`：用户下次登录可直接使用该临时密码进入控制台正常工作，无需强制改密；
  - 事务提交后立即下发内存失效墓碑、物理打断在途 SQL、销毁该用户全部在途 Web Session。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 默认值 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :---: | :--- | :--- |
  | `newTemporaryPassword` | `string` | 否 | 由服务端自动生成 | 8~64 字符，须含大小写字母、数字及特殊字符 | 指定临时密码；缺省时服务端生成 16 位强随机凭证 |
  | `mustChangePassword` | `boolean` | 否 | `true` | 布尔值 | 用户首次以此密码登录时是否强制重置密码 |
  | `version` | `number` | 是 | - | 当前读取到的用户主记录版本号 | 乐观锁版本号 |
- **请求示例**：
  ```json
  {
    "mustChangePassword": true,
    "version": 1
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "temporaryPassword": "TempPassword2026!#",
    "version": 2
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：用户已被其他管理员修改；
  - `400 ERR_PASSWORD_POLICY_VIOLATED`：手动指定的临时密码不符合强密码复杂度策略；
  - `404 ERR_NOT_FOUND`：目标用户不存在。

---

### 6.4 个人访问令牌模块接口契约 (`/api/v1/pats/*`)

#### 6.4.1 查询当前登录用户名下的 PAT 列表
- **接口路径**：`GET /api/v1/pats`
- **守卫级别**：`L4 角色守卫` (全体 `ACTIVE` 用户)
- **功能说明**：查看当前登录人名下所有未注销与历史有效的个人访问令牌概览。
- **安全说明**：严禁返回原始 Token 明文，仅暴露 `token_prefix`。
- **查询参数**：*(无入参，严格隔离在 `WHERE user_id = currentUser.id` 范围)*
- **成功响应**：`200 OK`
  ```json
  [
    {
      "id": "201",
      "name": "Cursor-Agent-Dev",
      "token_prefix": "mcp_pat_8f3a",
      "expires_at": "2027-02-08T06:00:00.000Z",
      "last_used_at": "2026-11-08T08:12:00.000Z",
      "created_at": "2026-11-08T06:00:00.000Z"
    }
  ]
  ```

---

#### 6.4.2 签发全新个人访问令牌 (单次明文返回)
- **接口路径**：`POST /api/v1/pats`
- **守卫级别**：`L4 角色守卫` (全体 `ACTIVE` 用户；若密码已超期失效由 L3 守卫拦截)
- **功能说明**：由系统生成 256 位安全令牌。此接口**有且仅有本次**在响应体中透出 `rawToken` 明文。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 默认值 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :---: | :--- | :--- |
  | `name` | `string` | 是 | - | 长度 1~64 字符；同一用户下未吊销有效令牌名称唯一（吊销后可复用） | 令牌业务用途或环境标识 |
  | `expiresDays` | `number` | 否 | `90` | 整数，`1 <= expiresDays <= 365` | 有效天数 (最长 365 天) |
- **请求示例**：
  ```json
  {
    "name": "Cursor-Agent-Dev",
    "expiresDays": 90
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "pat": {
      "id": "201",
      "name": "Cursor-Agent-Dev",
      "token_prefix": "mcp_pat_8f3a",
      "expires_at": "2027-02-06T06:00:00.000Z",
      "last_used_at": null,
      "created_at": "2026-11-08T06:00:00.000Z"
    },
    "rawToken": "mcp_pat_8f3a9e2d1c4b7a0f6e5d8c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a32"
  }
  ```
- **错误分支**：
  - `403 ERR_MUST_CHANGE_PASSWORD`：用户密码已过期或需要重置，禁止签发 PAT；
  - `409 ERR_PAT_NAME_EXISTS`：当前用户名下已存在同名的未吊销个人访问令牌（吊销旧令牌后可复用同名）；
  - `400 ERR_VALIDATION_FAILED`：参数格式或过期天数超限。

---

#### 6.4.3 吊销指定的个人访问令牌
- **接口路径**：`POST /api/v1/pats/:id/revoke`
- **守卫级别**：`L4 角色守卫` (全体 `ACTIVE` 用户)
- **路径参数**：`:id` (目标 PAT ID，`string`)
- **功能说明**：将指定 PAT 置为已吊销 (`revoked_at = UTC_TIMESTAMP(3)`)。非超管用户只能吊销自身名下的 PAT。
- **安全联动**：服务端立即同步执行 `markPatRevokedSync(patId)`，并向 MySQL 发起 `cancelQueriesByPat(patId, 'PAT_REVOKED')`，立即打断使用该 PAT 正在执行的查询。
- **请求头**：`x-csrf-token: <string>`
- **请求入参**：*(无请求体)*
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `403 ERR_RBAC_FORBIDDEN`：尝试越权吊销他人名下的 PAT；
  - `404 ERR_NOT_FOUND`：目标 PAT 不存在或已被注销。

---

### 6.5 数据源配置模块接口契约 (`/api/v1/profiles/*`)

#### 6.5.1 查询全量数据源列表 (管理视图)
- **接口路径**：`GET /api/v1/profiles`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **功能说明**：管理员或 DBA 查看全部数据源连接池的运维配置。
- **安全说明**：密码与私钥密文绝对脱敏，`password` 字段固定回显为 `"******"`，响应体包含 `version` 乐观锁版本。
- **成功响应**：`200 OK`
  ```json
  [
    {
      "id": "101",
      "name": "mysql_prod_primary",
      "display_name": "核心业务主库 (只读镜像)",
      "environment": "PROD",
      "host": "10.0.8.21",
      "port": 3306,
      "username": "mcp_readonly_user",
      "database": "trade_order",
      "max_pool_size": 15,
      "queue_timeout_ms": 3000,
      "profile_capacity_qpm": 600,
      "max_inflight_concurrency": 25,
      "use_ssh": true,
      "ssh_host": "10.0.8.5",
      "ssh_port": 22,
      "ssh_user": "bastion_proxy",
      "ssh_host_fingerprint_sha256": "SHA256:abcd1234efgh5678ijkl9012mnop3456qrst7890uvw",
      "tls_config": {
        "enabled": true,
        "ca_cert": null
      },
      "status": "ACTIVE",
      "version": 1,
      "created_at": "2026-11-05T00:00:00.000Z",
      "updated_at": "2026-11-07T08:00:00.000Z"
    }
  ]
  ```

---

#### 6.5.2 查询普通研发人员轻量级数据源选项
- **接口路径**：`GET /api/v1/profiles/my-options`
- **守卫级别**：`L4 角色守卫` (全体 `ACTIVE` 用户，含 `DEVELOPER` 与 `SECURITY_ADMIN`)
- **功能说明**：研发或安全官在客户端配置向导中拉取可选数据源下拉框。**仅返回当前登录人角色被授权访问的数据源，彻底隐藏主机 IP、端口、密码、私钥与连接池大小等敏感运维拓扑**。
- **成功响应**：`200 OK`
  ```json
  [
    {
      "id": "101",
      "name": "mysql_prod_primary",
      "displayName": "核心业务主库 (只读镜像)"
    }
  ]
  ```

---

#### 6.5.3 新增数据源 Profile
- **接口路径**：`POST /api/v1/profiles`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **功能说明**：纳管新 MySQL 数据源。密码与 SSH 私钥由 AES-256-GCM 密钥环加密存储。初始版本号 `version = 1`。
- **安全校验**：录入的主机执行 SSRF 拦截检查。若启用 SSH 必须提供可信主机指纹。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 默认值 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :---: | :--- | :--- |
  | `name` | `string` | 是 | - | 长度 1~64 字符，仅限 `^[a-zA-Z0-9_-]+$` | 唯一英文标识 (创建后不可变更) |
  | `display_name` | `string` | 是 | - | 长度 1~128 字符 | 中文展示名 |
  | `environment` | `string` | 否 | `"PROD"` | 枚举: `"PROD"`, `"STG"`, `"DEV"` | 部署环境 (创建后不可变更) |
  | `host` | `string` | 是 | - | 最大 255 字符，非空 | 目标 MySQL 主机域名或 IP |
  | `port` | `number` | 是 | `3306` | 整数，`1 <= port <= 65535` | 目标端口 |
  | `user` | `string` | 是 | - | 长度 1~64 字符 | 数据库登录用户 |
  | `password` | `string` | 是 | - | 长度 1~255 字符 | 数据库登录明文密码 |
  | `database` | `string` | 是 | - | 长度 1~64 字符 | 默认连接数据库名 |
  | `max_pool_size` | `number` | 否 | `10` | 整数，`1 <= val <= 50` | 生产连接池最大容量 |
  | `queue_timeout_ms`| `number` | 否 | `3000` | 整数，`500 <= val <= 30000` | 连接池借出排队超时 (ms) |
  | `profile_capacity_qpm` | `number` | 否 | `300` | 整数，`10 <= val <= 10000` | 数据源 QPM 保护上限 |
  | `max_inflight_concurrency` | `number` | 否 | `30` | 整数，`1 <= val <= 50` | 最大在途并发数 |
  | `use_ssh` | `boolean` | 否 | `false` | 布尔值 | 是否经由 SSH 堡垒机隧道转发 |
  | `ssh_host` | `string` | 否 | - | `use_ssh=true` 时必填 | 跳板机 IP 或域名 |
  | `ssh_port` | `number` | 否 | `22` | 整数，`1 <= val <= 65535` | 跳板机端口 |
  | `ssh_user` | `string` | 否 | - | `use_ssh=true` 时必填 | 跳板机用户名 |
  | `ssh_private_key`| `string` | 否 | - | `use_ssh=true` 时必填 | 跳板机 OpenSSH 格式私钥文本 |
  | `ssh_host_fingerprint_sha256` | `string` | 否 | - | `use_ssh=true` 时必填 (如 "SHA256:...") | 预期 SSH 主机密钥指纹 (Fail-Closed) |
  | `tls_config` | `TlsConfig \| null` | 否 | `null` | 结构化对象 | 数据库 TLS 加密连接配置 |
- **请求示例**：
  ```json
  {
    "name": "mysql_crm_read",
    "display_name": "CRM客户管理从库",
    "environment": "PROD",
    "host": "10.0.12.18",
    "port": 3306,
    "user": "mcp_agent_reader",
    "password": "DbSecretPassword123#",
    "database": "crm_db",
    "max_pool_size": 10,
    "queue_timeout_ms": 3000,
    "profile_capacity_qpm": 300,
    "use_ssh": true,
    "ssh_host": "10.0.8.5",
    "ssh_port": 22,
    "ssh_user": "bastion_proxy",
    "ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "ssh_host_fingerprint_sha256": "SHA256:abcd1234efgh5678ijkl9012mnop3456qrst7890uvw",
    "tls_config": {
      "enabled": true,
      "ca_cert": "-----BEGIN CERTIFICATE-----\n..."
    }
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "id": "102",
    "version": 1
  }
  ```
- **错误分支**：
  - `409 ERR_DUPLICATE_NAME`：数据源英文标识已被占用；
  - `403 ERR_SSRF_PROHIBITED`：数据库主机命中私网拦截规则且未在白名单中；
  - `400 ERR_VALIDATION_FAILED`：入参校验失败（如启用 SSH 但未提供指纹）。

---

#### 6.5.4 更新数据源 Profile 配置
- **接口路径**：`PUT /api/v1/profiles/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **路径参数**：`:id` (目标 Profile ID，`string`)
- **功能说明**：更新连接池参数。校验 `version` (409 CAS)。更新成功后递增 `generation`，热排空原连接池。
- **连接路径与信任边界变更防外泄铁律 (Trust Boundary Re-entry Iron Law)**：
  - **全链路信任边界受控**：若发生以下任一变动，请求体**必须传入新的 `password` 明文字符串**；若未提供，服务端**立即阻断并抛出 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`**：
    1. 数据库主机、端口或用户变动 (`host`, `port`, `user`)；
    2. 跳板机转发隧道状态切换 (`use_ssh` 启停)，或跳板机端点/指纹变动 (`ssh_host`, `ssh_port`, `ssh_user`, `ssh_host_fingerprint_sha256`)；
    3. TLS 传输安全级别变动 (`tls_config.enabled` 启停，或 `tls_config.ca_cert` 证书变更)；
  - **跳板机私钥同理**：若跳板机端点发生变动，必须传入新的 `ssh_private_key` 与指纹；
  - 只有在数据库端点、SSH 转发隧道、主机指纹与 TLS 信任级别**全链路拓扑完全未变**的前提下，才允许密码留空沿用库内旧密文。
- **不可变字段确定性规则**：`name` 与 `environment` 属于不可变属性。若请求体试图修改其值（即传入值与数据库已存值不一致），服务端**将严格阻断并返回 `400 ERR_PROFILE_IMMUTABLE_FIELD`**；若传入值与数据库已存值完全相同则放行。
- **缺省与增量更新语义规范**：更新采用**白名单字段增量合并更新 (Partial Patch on Allowed Fields)**。请求体中未提供的可选字段（缺省/未传）一律视为保留当前已存原值；传有效非空值表示更新覆盖；传 `null` 表示清空允许为空的字段；未知字段返回 `400 ERR_VALIDATION_FAILED`。
- **请求头**：`x-csrf-token: <string>`
- **请求体全量可写字段清单 (UpdateProfilePayload)**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `display_name` | `string` | 否 | 长度 1~128 字符 | 中文展示名 |
  | `host` | `string` | 否 | 最大 255 字符 (修改时必传password) | 目标 MySQL 主机 |
  | `port` | `number` | 否 | 整数 1~65535 (修改时必传password) | 目标端口 |
  | `user` | `string` | 否 | 长度 1~64 字符 (修改时必传password) | 数据库用户 |
  | `password` | `string` | 否 | 端点变更时必填；未变时留空沿用 | 数据库密码 |
  | `database` | `string` | 否 | 长度 1~64 字符 | 默认数据库名 |
  | `max_pool_size` | `number` | 否 | 整数 1~50 | 连接池容量 |
  | `queue_timeout_ms`| `number` | 否 | 整数 500~30000 | 排队超时 |
  | `profile_capacity_qpm` | `number` | 否 | 整数 10~10000 | QPM 保护上限 |
  | `max_inflight_concurrency` | `number` | 否 | 整数 1~50 | 最大在途并发数 |
  | `use_ssh` | `boolean` | 否 | 布尔值 | 是否启用跳板机 |
  | `ssh_host` | `string` | 否 | 修改时须提供新私钥与指纹 | 跳板机主机 |
  | `ssh_port` | `number` | 否 | 整数 1~65535 | 跳板机端口 |
  | `ssh_user` | `string` | 否 | 修改时须提供新私钥与指纹 | 跳板机用户 |
  | `ssh_private_key`| `string` | 否 | 端点变更时必填；未变时留空沿用 | 跳板机私钥 |
  | `ssh_host_fingerprint_sha256` | `string` | 否 | 预期主机密钥指纹 | SHA256 指纹文本 |
  | `tls_config` | `TlsConfig \| null` | 否 | 结构化对象 | TLS 加密配置 |
  | `version` | `number` | **是** | 必须等于当前读取到的版本号 | 乐观锁版本号 |
- **请求示例**：
  ```json
  {
    "display_name": "核心业务主库 (升级读写隔离)",
    "max_pool_size": 20,
    "profile_capacity_qpm": 800,
    "version": 1
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 2
  }
  ```
- **错误分支**：
  - `400 ERR_CREDENTIAL_REENTRY_REQUIRED`：修改了 host/port 等端点但未录入新密码；
  - `400 ERR_PROFILE_IMMUTABLE_FIELD`：试图变更 name 或 environment 不可变字段；
  - `409 ERR_CONCURRENCY_CONFLICT`：提交的版本号已被抢先更新（携带最新版本详情）；
  - `404 ERR_NOT_FOUND`：目标 Profile 不存在。

---

#### 6.5.5 删除数据源 Profile
- **接口路径**：`DELETE /api/v1/profiles/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **路径参数**：`:id` (目标 Profile ID，`string`)
- **功能说明**：删除数据源并销毁物理连接池。
- **安全检查**：检查 `sys_role_profiles`，若该 Profile 仍被角色策略关联，抛 `400 ERR_PROFILE_IN_USE` 阻断。
- **请求头**：`x-csrf-token: <string>`
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `400 ERR_PROFILE_IN_USE`：仍有角色绑定该数据源，禁止删除。

---

#### 6.5.6 测试 MySQL 数据库连通性
- **接口路径**：`POST /api/v1/profiles/test-db`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **功能说明**：以三大模式安全测试 MySQL 连接、握手与认证耗时。全链路加装 SSRF Post-DNS 防御与 IP Pinning。支持草稿模式传入临时 SSH 隧道与 TLS 参数。
- **防外泄铁律**：若修改了 host/port/user、TLS 信任链（开关或 CA 证书）或 SSH 隧道配置，必须提供新密码，否则抛 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `profile_id` | `string` | 否 | 已存 Profile ID (模式 1 或 模式 2 必传) |
  | `host` | `string` | 否 | 目标数据库主机 (模式 3 必传) |
  | `port` | `number` | 否 | 目标端口 (模式 3 必传) |
  | `user` | `string` | 否 | 数据库用户 (模式 3 必传) |
  | `password` | `string` | 否 | 数据库密码 (模式 3 必传；模式 2 修改主机后必传) |
  | `database` | `string` | 否 | 数据库名 |
  | `tls_config` | `TlsConfig \| null` | 否 | 结构化 TLS 配置 (测试端点同步支持) |
  | `use_ssh` | `boolean` | 否 | 是否启用跳板机转发测试 |
  | `ssh_host` | `string` | 否 | 跳板机主机 |
  | `ssh_port` | `number` | 否 | 跳板机端口 |
  | `ssh_user` | `string` | 否 | 跳板机用户名 |
  | `ssh_private_key` | `string` | 否 | 跳板机私钥文本 |
  | `ssh_host_fingerprint_sha256` | `string` | 否 | 预期跳板机指纹 |
- **请求示例 (模式 1：已存配置快速测通)**：
  ```json
  {
    "profile_id": "101"
  }
  ```
- **请求示例 (模式 3：带 TLS 与 SSH 的草稿新建测试)**：
  ```json
  {
    "host": "10.0.12.18",
    "port": 3306,
    "user": "reader",
    "password": "Password123#",
    "database": "crm_db",
    "tls_config": {
      "enabled": true,
      "ca_cert": null
    },
    "use_ssh": true,
    "ssh_host": "10.0.8.5",
    "ssh_port": 22,
    "ssh_user": "bastion_proxy",
    "ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "ssh_host_fingerprint_sha256": "SHA256:abcd1234efgh5678ijkl9012mnop3456qrst7890uvw"
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "reachable": true,
    "latencyMs": 18
  }
  ```
- **错误分支**：
  - `400 ERR_CREDENTIAL_REENTRY_REQUIRED`：修改了 host/port 但未重输密码；
  - `403 ERR_SSRF_PROHIBITED`：目标主机被 SSRF 出站白名单拦截；
  - `200 OK (业务不可达)`：`{ "reachable": false, "latencyMs": 2000, "error": "Access denied for user 'reader'@'10.0.8.21'" }`。

---

#### 6.5.7 测试 SSH 跳板机连通性
- **接口路径**：`POST /api/v1/profiles/test-ssh`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **功能说明**：仅测试网关到 SSH 堡垒机本身的连通性、HostKey 指纹比对及私钥认证。**本测试不建立 MySQL 数据库连接，无需也绝不要求输入数据库密码**。
- **SSH 独立防外泄铁律**：若测试已有数据源时修改了 `host` (跳板机)、`port` 或 `username`，必须输入新的 `privateKey` 与 `hostFingerprintSha256`；未输入抛 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`；参数未变时自动复用已解密存量私钥。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `profile_id` | `string` | 否 | 已存 Profile ID |
  | `host` | `string` | 否 | SSH 堡垒机主机 |
  | `port` | `number` | 否 | SSH 端口 (默认 22) |
  | `username` | `string` | 否 | SSH 登录用户 |
  | `privateKey` | `string` | 否 | OpenSSH 私钥文本 |
  | `hostFingerprintSha256` | `string` | 否 | 预期 SHA-256 主机公钥指纹 (防中间人) |
- **成功响应**：`200 OK`
  ```json
  {
    "reachable": true,
    "latencyMs": 35
  }
  ```

---

### 6.6 角色策略与库表 ACL 模块接口契约 (`/api/v1/roles/*`)

#### 6.6.1 查询角色模版与授权配置列表
- **接口路径**：`GET /api/v1/roles`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：获取系统全量角色模版定义，包含其绑定的数据源列表、默认 LIMIT、最大 LIMIT、超时时间、用户 QPM 与乐观锁版本号。
- **成功响应**：`200 OK`
  ```json
  [
    {
      "id": "2",
      "role_name": "DATA_ANALYST",
      "display_name": "数据分析师角色",
      "description": "允许查询只读库订单与报表视图，单次最大限制 200 行",
      "version": 2,
      "default_limit": 50,
      "max_limit": 200,
      "max_timeout_ms": 15000,
      "user_qpm_limit": 60,
      "max_inflight_concurrency": 5,
      "profileIds": ["101", "102"],
      "created_at": "2026-11-05T00:00:00.000Z",
      "updated_at": "2026-11-08T06:00:00.000Z"
    }
  ]
  ```

---

#### 6.6.2 创建自定义角色
- **接口路径**：`POST /api/v1/roles`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：创建新角色策略模版，初始版本 `version = 1`。
- **跨字段校验规则**：必须满足 **`default_limit <= max_limit`**，否则抛出 `400 ERR_VALIDATION_FAILED`。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 默认值 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :---: | :--- | :--- |
  | `role_name` | `string` | 是 | - | 长度 1~32 字符，仅限 `^[A-Z0-9_]+$` | 唯一英文标识 (创建后不可变更) |
  | `display_name` | `string` | 是 | - | 长度 1~64 字符 | 角色中文名 |
  | `description` | `string` | 否 | `null` | 最大 255 字符 | 角色职责与权限说明 |
  | `profileIds` | `string[]` | 是 | - | 至少包含 1 个有效 Profile ID | 允许访问的数据源 ID 列表 |
  | `default_limit` | `number` | 否 | `50` | 整数，`1 <= val <= 500` (须<=max_limit) | 默认注入 LIMIT |
  | `max_limit` | `number` | 否 | `500` | 整数，`1 <= val <= 5000` | 允许执行的最大 LIMIT |
  | `max_timeout_ms`| `number` | 否 | `15000` | 整数，`1000 <= val <= 60000` | 最大执行超时 (ms) |
  | `user_qpm_limit`| `number` | 否 | `60` | 整数，`-1` 或 `1 <= val <= 10000` | 用户基础 QPM (-1 为免限流) |
  | `max_inflight_concurrency`| `number` | 否 | `5` | 整数，`1 <= val <= 50` | 最大在途并发数 |
- **成功响应**：`200 OK`
  ```json
  {
    "id": "3",
    "version": 1
  }
  ```
- **错误分支**：
  - `409 ERR_DUPLICATE_NAME`：角色英文名称已被占用；
  - `400 ERR_VALIDATION_FAILED`：参数格式错误或 `default_limit > max_limit`。

---

#### 6.6.3 更新角色策略与资源配额
- **接口路径**：`PUT /api/v1/roles/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：全量更新角色策略参数。校验 `version` (409 CAS)。更新成功后递增系统 `globalPolicyVersion`，使排队快照在二次核验时触发策略重载。
- **不可变字段确定性规则**：`role_name` 属于不可变属性。若请求体试图变更其值（即传入值与数据库已存值不一致），服务端**将严格阻断并返回 `400 ERR_ROLE_IMMUTABLE_FIELD`**；若传入值与数据库已存值完全相同则放行。
- **缺省与增量更新语义规范**：更新采用**白名单字段增量合并更新 (Partial Patch on Allowed Fields)**。请求体中未提供的可选字段（缺省/未传）一律视为保留当前已存原值；传有效非空值表示更新覆盖；传 `null` 表示清空允许为空的字段（如 `description`）；未知字段返回 `400 ERR_VALIDATION_FAILED`。
- **跨字段校验规则**：更新后的参数必须满足 **`default_limit <= max_limit`**。
- **请求头**：`x-csrf-token: <string>`
- **请求体全量可写字段清单 (UpdateRolePayload)**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `display_name` | `string` | 否 | 长度 1~64 字符 | 角色中文名 |
  | `description` | `string \| null` | 否 | 最大 255 字符 | 角色说明 |
  | `profileIds` | `string[]` | 否 | 至少 1 项有效 Profile ID | 授权数据源列表 |
  | `default_limit` | `number` | 否 | 整数 1~500 (须 <= max_limit) | 默认注入 LIMIT |
  | `max_limit` | `number` | 否 | 整数 1~5000 | 最大允许 LIMIT |
  | `max_timeout_ms`| `number` | 否 | 整数 1000~60000 | 最大查询超时 |
  | `user_qpm_limit`| `number` | 否 | 整数 -1 或 1~10000 | 基础 QPM 配额 |
  | `max_inflight_concurrency`| `number` | 否 | 整数 1~50 | 最大在途并发数 |
  | `version` | `number` | **是** | 必须等于当前读取到的版本号 | 乐观锁版本号 |
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 3
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：版本冲突；
  - `400 ERR_VALIDATION_FAILED`：入参不合法或 `default_limit > max_limit`；
  - `404 ERR_NOT_FOUND`：目标角色不存在。

---

#### 6.6.4 删除自定义角色
- **接口路径**：`DELETE /api/v1/roles/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：物理删除自定义角色。
- **安全检查**：内置角色禁止删除 (`400 ERR_BUILTIN_ROLE_PROTECTED`)；若有用户仍分配此角色，抛 `400 ERR_ROLE_IN_USE` 阻断。
- **请求头**：`x-csrf-token: <string>`
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```

---

#### 6.6.5 获取角色的表级 ACL 规则列表
- **接口路径**：`GET /api/v1/roles/:id/table-acls`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：获取指定角色名下的表级黑白名单规则集及父角色当前乐观锁版本。
- **成功响应**：`200 OK`
  ```json
  {
    "rules": [
      {
        "id": "301",
        "profile_id": "0",
        "table_pattern": "salary_*",
        "rule_type": "BLACKLIST",
        "description": "薪酬敏感情报全全局黑名单禁止访问"
      },
      {
        "id": "302",
        "profile_id": "101",
        "table_pattern": "order_*",
        "rule_type": "WHITELIST",
        "description": "订单库只读开放订单表通配"
      }
    ],
    "version": 2
  }
  ```
  - `profile_id: "0"`：代表对该角色下绑定的所有数据源全局生效的通用规则。

---

#### 6.6.6 全量更新角色的表级 ACL 规则集
- **接口路径**：`PUT /api/v1/roles/:id/table-acls`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：全量原子替换该角色的表级 ACL 规则。校验并递增父记录 `sys_roles.version` (409 CAS)。同事务写管理审计。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `rules` | `TableAclRuleWriteItem[]` | 是 | 数组容量 0~200 条，禁止同模式重复 | 全量表级规则数组 (全量覆盖语义；传空数组表示清空自定义规则) |
  | `rules[].profile_id` | `string` | 是 | `"0"` 或角色已绑定的有效 Profile ID | 作用数据源标识 (`"0"` 为角色下全局规则) |
  | `rules[].table_pattern` | `string` | 是 | 长度 1~128 字符，支持通配如 `salary_*` | 表名匹配模式 |
  | `rules[].rule_type` | `string` | 是 | 枚举: `'BLACKLIST'` 或 `'WHITELIST'` | 规则类型 |
  | `rules[].description` | `string` | 否 | 最大 255 字符，可为 `null` | 规则备注说明 |
  | `version` | `number` | 是 | 必须等于当前读取到的父角色版本号 | 乐观锁版本前置条件 |
- **请求示例**：
  ```json
  {
    "rules": [
      {
        "profile_id": "0",
        "table_pattern": "salary_*",
        "rule_type": "BLACKLIST",
        "description": "薪资表黑名单"
      },
      {
        "profile_id": "101",
        "table_pattern": "order_*",
        "rule_type": "WHITELIST"
      }
    ],
    "version": 2
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 3
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：角色版本已变动；
  - `400 ERR_VALIDATION_FAILED`：规则匹配格式有误。

---

#### 6.6.7 获取角色的库级 ACL 规则列表
- **接口路径**：`GET /api/v1/roles/:id/db-acls`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：获取指定角色名下的结构化数据库级规则（`ALLOW` 或 `DENY`）。
- **成功响应**：`200 OK`
  ```json
  {
    "rules": [
      {
        "id": "401",
        "profile_id": "0",
        "database_name": "mysql",
        "effect": "DENY"
      },
      {
        "id": "402",
        "profile_id": "101",
        "database_name": "trade_order",
        "effect": "ALLOW"
      }
    ],
    "version": 2
  }
  ```

---

#### 6.6.8 全量更新角色的库级 ACL 规则集
- **接口路径**：`PUT /api/v1/roles/:id/db-acls`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：全量原子替换库级 ACL 规则。校验并递增父记录 `sys_roles.version` (409 CAS)。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `rules` | `DbAclRuleWriteItem[]` | 是 | 数组容量 0~100 条，禁止同库重复 | 库级规则数组 (全量覆盖语义；传空数组表示清空自定义规则) |
  | `rules[].profile_id` | `string` | 是 | `"0"` 或角色已绑定的有效 Profile ID | 作用数据源标识 (`"0"` 为角色下全局规则) |
  | `rules[].database_name`| `string` | 是 | 长度 1~64 字符；v1.0精确名，拒绝`*`模式 | 目标数据库名，不使用LIKE匹配 |
  | `rules[].effect` | `string` | 是 | 枚举: `'ALLOW'` 或 `'DENY'` | 明确允许或禁止 |
  | `version` | `number` | 是 | 必须等于当前读取到的父角色版本号 | 乐观锁版本前置条件 |
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 3
  }
  ```

库级 ACL 沿用数据库v1.0安全边界：写入含 `*` 的库级模式返回 `400 ERR_VALIDATION_FAILED`；`%`/`_` 按字面字符处理，不展开为LIKE通配。历史库级通配规则须人工迁移并核验授权范围，不能启动时静默扩大/缩小权限；表级 `table_pattern` 的既定 `*` 能力不受影响。

---

### 6.7 动态限流与防熔断模块接口契约 (`/api/v1/rate-limits/*`)

#### 6.7.1 获取系统全局基线限流与死循环熔断规则
- **接口路径**：`GET /api/v1/rate-limits/global`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：获取系统默认用户 QPM 基础配额、突发并发桶容量以及大模型 Agent 死循环自动熔断策略。
- **成功响应**：`200 OK`
  ```json
  {
    "defaultUserQuotaQpm": 60,
    "burstCapacity": 10,
    "agentLoopThreshold": 3,
    "agentLoopWindowSec": 30,
    "version": 1
  }
  ```
  - `agentLoopThreshold`: 窗口内连续触发相同语法/权限错误的重试次数上限（默认 3 次）；
  - `agentLoopWindowSec`: 死循环判定的滑动时间窗口（默认 30 秒）。

---

#### 6.7.2 更新系统全局基线限流与死循环熔断规则
- **接口路径**：`PUT /api/v1/rate-limits/global`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：更新全局限流基准。同事务原子校验并更新 `sys_rate_limits.version` (`scope_type = 'GLOBAL'`)。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `defaultUserQuotaQpm` | `number` | 是 | 整数，`1 <= val <= 10000` | 默认用户 QPM 限额 |
  | `burstCapacity` | `number` | 是 | 整数，`1 <= val <= 500` | 令牌桶突发容量 |
  | `agentLoopThreshold` | `number` | 是 | 整数，`2 <= val <= 10` | 死循环连续报错熔断阈值 |
  | `agentLoopWindowSec` | `number` | 是 | 整数，`10 <= val <= 300` | 死循环监测滑动窗口 (秒) |
  | `version` | `number` | 是 | 对应 GET 读取到的当前版本号 | 乐观锁版本号 |
- **请求示例**：
  ```json
  {
    "defaultUserQuotaQpm": 80,
    "burstCapacity": 15,
    "agentLoopThreshold": 3,
    "agentLoopWindowSec": 30,
    "version": 1
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 2
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：全局限流配置已被抢先更新；
  - `400 ERR_VALIDATION_FAILED`：阈值范围不合法。

---

#### 6.7.3 获取指定用户的专属限流配置
- **接口路径**：`GET /api/v1/rate-limits/users/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：获取指定用户的个性化配额覆盖配置与终身单调代际版本号。
- **配置与执行值边界（DB-R1-01/02）**：本接口仅回显已保存的覆盖值，不返回计算后的有效配额冒充配置。执行 QPM 按 `USER > ROLE > GLOBAL`，突发容量按 `USER > GLOBAL`；例如角色 QPM=60、无 USER 覆盖时，GLOBAL QPM 从 100 改为 20，有效 QPM 仍为 60。个人大盘 `user_quota_qpm` 必须取执行侧同一策略计算的有效值，不得用此接口的 null 或 GLOBAL 值替代。
- **继承态与版本语义 (防 ABA 核心设计)**：
  - **继承态**：若用户未配置个性化规则（无用户覆盖，按角色/全局策略计算）：返回 `isCustom: false`，`revision: 0`，`version: 0`，`userQuotaQpm: null`，`burstCapacity: null`；
  - **自定义态**：若已配置覆盖规则：返回 `isCustom: true`，`revision: N`（N >= 1，为用户名下终身单调递增的代际修订号），以及实际配置的配额数值。即使该记录被删除后重新创建，新记录的 `revision` 也严格从历史最大代际递增起步（例如从 1 变为 2、3），绝不重用旧代际，根治 ABA 冲突。
- **成功响应 (已配置自定义覆盖)**：`200 OK`
  ```json
  {
    "userId": "1001",
    "username": "zhangsan",
    "userQuotaQpm": 120,
    "burstCapacity": 20,
    "isCustom": true,
    "revision": 1,
    "version": 1
  }
  ```
- **成功响应 (无用户覆盖)**：`200 OK`
  ```json
  {
    "userId": "1002",
    "username": "lisi",
    "userQuotaQpm": null,
    "burstCapacity": null,
    "isCustom": false,
    "revision": 0,
    "version": 0
  }
  ```

---

#### 6.7.4 配置或更新指定用户的专属限流配额 (防 ABA 贯穿控制)
- **接口路径**：`PUT /api/v1/rate-limits/users/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：设置或更新用户的专属 QPM 和突发容量；省略 `burstCapacity` 时按默认 10 保存（创建和更新均如此），不是保留旧值。提交后同步失效快照，重新加载两项配置。
- **创建/更新共用持久计数器协议**：按数据库 §7.5，在同一显式事务中按用户→计数器→规则锁序执行。以下为 Repository 参数化步骤，分支判断不由 SQL 文本自动完成。
  ```sql
  BEGIN;
  SELECT id FROM sys_users WHERE id = ? FOR UPDATE;
  -- 用户不存在返回404并回滚；首次计数器从0开始，已存在不重置。
  INSERT INTO sys_rate_limit_revisions (scope_type, scope_id, last_revision)
  VALUES ('USER', ?, 0)
  ON DUPLICATE KEY UPDATE last_revision = last_revision;
  SELECT last_revision FROM sys_rate_limit_revisions
  WHERE scope_type = 'USER' AND scope_id = ? FOR UPDATE;
  SELECT revision, version FROM sys_rate_limits
  WHERE scope_type = 'USER' AND scope_id = ? FOR UPDATE;
  -- expected=0 只允许规则不存在；expected>0 要求存在且revision=expected，否则409整体回滚。
  -- 同传version与revision必须相等；分配前校验last_revision < 4294967295。
  -- 创建和更新都必须执行下面同一个分配步骤；禁止只增长业务行。
  UPDATE sys_rate_limit_revisions SET last_revision = last_revision + 1
  WHERE scope_type = 'USER' AND scope_id = ?;
  SELECT last_revision FROM sys_rate_limit_revisions
  WHERE scope_type = 'USER' AND scope_id = ?;
  -- 将读出的newRevision分别绑定到以下revision/version；两条分支只执行一条。
  -- 创建分支（expected=0）
  INSERT INTO sys_rate_limits (scope_type, scope_id, qpm_limit, burst_capacity, revision, version)
  VALUES ('USER', ?, ?, ?, ?, ?);
  -- 更新分支（expected>0），affectedRows必须为1，否则409整体回滚。
  UPDATE sys_rate_limits SET qpm_limit = ?, burst_capacity = ?, revision = ?, version = ?
  WHERE scope_type = 'USER' AND scope_id = ? AND revision = ?;
  -- 同事务写CONFIG_UPDATE管理审计（脱敏参数、目标及新旧版本）；失败必须ROLLBACK。
  COMMIT;
  ```
  提交后同步失效并重载 QPM/突发容量。创建1→更新2→更新3→删除3→重建4，持有1/2/3的旧更新与旧删除全部409。
  删除使用同样用户→计数器→规则锁序，正revision CAS、同事务审计，计数器保留不变。回滚不得消耗可见版本。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `userQuotaQpm` | `number` | 是 | 整数，`-1` 或 `1 <= val <= 10000` | 专属配额 (`-1` 为免限流) |
  | `burstCapacity` | `number` | 否 | 整数，`1 <= val <= 500` (默认 10) | 专属突发容量 |
  | `revision` | `number` | 是 | 继承态传 `0`，已有覆盖传当前 `revision` | 终身单调代际版本号 (防 ABA) |
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "revision": 2,
    "version": 2
  }
  ```

---

#### 6.7.5 移除指定用户覆盖，恢复角色/全局限流策略 (移除自定义覆盖与防 ABA 并发控制)
- **接口路径**：`DELETE /api/v1/rate-limits/users/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：删除指定用户的个性化配额覆盖记录，恢复为“无用户覆盖，按角色/全局策略计算”。QPM 按实际角色合并（任一角色为 -1 则不限主体 QPM，否则取最大值），仅无可用角色配额时才以 GLOBAL 兜底；无有效角色仍拒绝执行。突发容量改取 GLOBAL，角色没有突发容量字段。GLOBAL QPM 变更不会覆盖已有的角色配额；GLOBAL 突发容量变更会作用于无 USER 覆盖的用户。Profile 资源保护始终独立生效。
- **并发 CAS 校验与防 ABA 机制**：
  - 客户端删除时必须在 Query 参数中携带当前读取到的代际版本号：`?revision=N` (兼容 `?version=N`)；
  - 服务端执行条件删除：
    ```sql
    DELETE FROM sys_rate_limits 
    WHERE scope_type = 'USER' AND scope_id = ? AND revision = ?;
    ```
    若影响行数为 0，说明配置已被他人更新或已被提前删除，立即返回 `409 ERR_CONCURRENCY_CONFLICT`；
  - **持久化计数器彻底免疫 ABA**：删除操作仅清除 `sys_rate_limits` 业务行以恢复角色/全局策略，**持久化计数器 `sys_rate_limit_revisions` 的 `last_revision` 保持不变**。当下一次重新为该用户创建自定义配置时，系统原子分配 `last_revision + 1`（例如从 1 递增至 2），因此新记录的 `revision` 严格单调递增，持有旧版本 `1` 的任何迟到更新或删除请求均因 `WHERE revision = 1` 匹配 0 行而被安全阻断（409），彻底消灭 ABA 静默覆盖与误删漏洞。
- **请求头**：`x-csrf-token: <string>`
- **查询参数**：
  | 参数名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `revision` | `number` | 是 | 当前覆盖配置的单调代际版本号 (防并发误删与 ABA 覆盖) |
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "isCustom": false
  }
  ```

---

### 6.8 审计检索与运维大盘模块接口契约 (`/api/v1/audits/*`)

#### 6.8.1 多维高密度 SQL 审计流水检索 (含单条精准回补)
- **接口路径**：`GET /api/v1/audits`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：管理员与安全官检索 SQL 执行全链路审计明细。
- **协同项闭环 (#1)**：优先识别 `query_instance_id` 参数。当传入此参数时，后端直接命中二级索引 `idx_query_instance` 实现毫秒级精准拉取单条记录，用于控制台 URL 深度直达抽屉。
- **查询参数 (Query Parameters)**：
  | 参数名 | 类型 | 必填 | 默认值 | 描述 |
  | :--- | :---: | :---: | :---: | :--- |
  | `page` | `number` | 否 | `1` | 页码 (`>= 1`) |
  | `pageSize` | `number` | 否 | `20` | 每页数量 (`1 <= pageSize <= 100`) |
  | `query_instance_id` | `string` | 否 | - | 全局唯一查询实例 ID (精准单条回补) |
  | `status` | `string` | 否 | - | 状态过滤: `SUCCESS`, `BLOCKED_AST`, `BLOCKED_ACL`, `BLOCKED_CONCURRENCY`, `BLOCKED_RATE`, `CANCELED`, `FAILED_MYSQL`, `TIMEOUT` |
  | `profile_id` | `string` | 否 | - | 目标数据源 ID |
  | `username` | `string` | 否 | - | 执行人用户名 |
  | `is_high_risk` | `boolean` | 否 | - | 是否仅筛选高危触发记录 (1 或 0) |
  | `start_time` | `string` | 否 | - | 起始时间 (ISO 8601 UTC) |
  | `end_time` | `string` | 否 | - | 截止时间 (ISO 8601 UTC) |
- **成功响应**：`200 OK`
  ```json
  {
    "items": [
      {
        "id": "90001002003004005",
        "query_instance_id": "qry_8f3a9e2d_1c4b_4a0f_8e5d_8c3b2a1f0e9d",
        "session_id": "sess_agent_c8d2",
        "user_id": "1001",
        "username": "zhangsan",
        "profile_id": "101",
        "profile_name": "核心业务主库 (只读镜像)",
        "database_name": "trade_order",
        "sql_text": "SELECT id, order_no, buyer_id, create_time FROM t_orders WHERE status = 'PAID' LIMIT 50",
        "sql_type": "SELECT",
        "status": "SUCCESS",
        "error_message": null,
        "latency_ms": 24,
        "rows_affected": 50,
        "client_ip": "10.0.15.82",
        "is_high_risk": false,
        "created_at": "2026-11-08T08:15:30.123Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
  ```
  - `id`: 服务端强制以 `string` 输出，防止 64 位大整数在前端被截断；
  - `profile_name`: 若关联数据源已被删除，稳定返回 `null`，前端规范化呈现 `"(已解绑数据源)"`。

---

#### 6.8.2 态势大盘统计与时序指标聚合 (双角色视角自适应)
- **接口路径**：`GET /api/v1/audits/stats`
- **守卫级别**：`L4 角色守卫` (全体 `ACTIVE` 用户)
- **功能说明**：控制台态势大盘短轮询（10s）拉取聚合指标与吞吐量折线。
- **时间窗口与桶宽语义规范**：
  - `range = 'today'`：统计客户端本地自然日（00:00:00 至当前时间），桶宽固定为 **10 分钟**；空桶强制补零（`actual_qpm: 0`）；
  - `range = '7d'`：统计过去连续 7 个自然日，桶宽固定为 **1 小时**；空桶补零；
  - `range = '30d'`：统计过去连续 30 个自然日，桶宽固定为 **1 天**；空桶补零。
- **协同项闭环 (#5 角色自适应脱敏)**：
  - **管理端视角 (`SUPER_ADMIN / SECURITY_ADMIN / DBA`)**：返回 `AdminDashboardStatsDTO`，全量暴露底层物理连接数、待审批工单数及各数据源流量；
  - **普通研发视角 (`DEVELOPER` 等其他激活角色)**：服务端强制追加 `WHERE user_id = currentUser.id` 约束，返回 `DeveloperDashboardStatsDTO`，**严禁向普通研发透出全量服务器连接数与待审工单数**。
- **查询参数**：
  | 参数名 | 类型 | 必填 | 默认值 | 描述 |
  | :--- | :---: | :---: | :---: | :--- |
  | `profile_id` | `string` | 否 | - | 指定数据源过滤 (缺省为聚合所有授权数据源) |
  | `range` | `string` | 否 | `"today"` | 时间跨度: `"today"`, `"7d"`, `"30d"` |
  | `timezone` | `string` | 否 | `"Asia/Shanghai"` | 客户端 IANA 时区标识 (如 `Asia/Shanghai`, `UTC`)，确定日界线 |

- **指标统计口径与计算公式规范**：
  1. **日界线划分**：以传入的 `timezone`（缺省为租户默认时区 `Asia/Shanghai`）零点（`00:00:00.000`）为起止点计算自然日；
  2. **时序 QPM 速率含义与分母精确定义**：
     - **速率物理单位**：时序数组中的 `actual_qpm` 与 `personal_qpm` 严格统一表示为**归一化分均查询速率 (Normalized QPM, 次/分钟)**，禁止与调用总数混淆；
     - **已闭合历史桶的速率公式**：
       `actual_qpm = Math.round((total_calls_in_bucket / bucket_duration_minutes) * 10) / 10`
       - 对于 10 分钟桶 (`today`)：`actual_qpm = total_calls / 10`（例如桶内累计 120 次调用 ➔ 输出 `12.0` QPM；0 次调用强制补零输出 `0.0`）；
       - 对于 1 小时桶 (`7d`)：`actual_qpm = total_calls / 60`；
       - 对于 1 天桶 (`30d`)：`actual_qpm = total_calls / 1440`；
     - **正在流逝的未完成当前桶平滑折算公式 (In-progress Bucket Rate)**：
       为消除分桶开始前数十秒内由于分母极小引起的速率畸变：
       `elapsed_minutes = Math.max(1, Math.floor((now - bucket_start_time) / 60000))`；
       `current_bucket_qpm = Math.round((calls_in_current_bucket / elapsed_minutes) * 10) / 10`；
       示例：若当前 10 分钟桶刚流逝 30 秒内发生了 10 次调用，`elapsed_minutes` 兜底为 1 分钟，当前速率平滑输出为 `10.0` QPM，平滑反映当前业务吞吐。
  3. **实时 QPM (`current_qpm`)**：定义为最近 1 分钟滑动窗口 (`[now - 60s, now]`) 内执行的 SQL 查询总次数；
  4. **日同比调用增长率 (`total_calls_growth_pct`)**：
     公式：`((calls_today - calls_yesterday_same_period) / Math.max(1, calls_yesterday_same_period)) * 100`，保留 1 位小数。
     若昨日同时段调用量为 0，当 `calls_today > 0` 时恒定返回 `+100.0%`；若两者皆为 0 返回 `0.0%`。
- **成功响应 (管理员视角 - AdminDashboardStatsDTO)**：`200 OK`
  ```json
  {
    "total_calls_today": 12580,
    "total_calls_growth_pct": 14.2,
    "active_sessions_count": 42,
    "active_db_connections": 18,
    "high_risk_blocked_count": 6,
    "pending_approvals_count": 3,
    "profile_traffic": [
      {
        "profile_id": "101",
        "profile_name": "核心业务主库 (只读镜像)",
        "profile_capacity_qpm": 600,
        "current_qpm": 185,
        "time_series": [
          { "timestamp": "2026-11-08T08:00:00.000Z", "actual_qpm": 160, "limit_qpm": 600 },
          { "timestamp": "2026-11-08T08:10:00.000Z", "actual_qpm": 185, "limit_qpm": 600 }
        ]
      }
    ]
  }
  ```
- **成功响应 (普通研发视角 - DeveloperDashboardStatsDTO)**：`200 OK`
  ```json
  {
    "personal_calls_today": 320,
    "personal_calls_growth_pct": 5.8,
    "personal_blocked_count": 1,
    "authorized_profiles": [
      {
        "profile_id": "101",
        "profile_name": "核心业务主库 (只读镜像)",
        "user_quota_qpm": 60,
        "current_qpm": 12,
        "time_series": [
          { "timestamp": "2026-11-08T08:00:00.000Z", "personal_qpm": 8 },
          { "timestamp": "2026-11-08T08:10:00.000Z", "personal_qpm": 12 }
        ]
      }
    ]
  }
  ```

---

#### 6.8.3 申请脱敏审计日志安全导出 (生成 5 分钟单次有效 Ticket)
- **接口路径**：`POST /api/v1/audits/export`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：提交审计日志导出过滤条件。服务端统计满足条件的记录数，签发高强度 HMAC-SHA-256 数字签名 Ticket，有效期为 5 分钟，且严格遵守单次消费原则。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `range` | `string` | 是 | 时间范围: `"today"`, `"7d"`, `"30d"`, `"custom"` |
  | `startTime` | `string` | 否 | 自定义起始时间 (ISO 8601 UTC) |
  | `endTime` | `string` | 否 | 自定义截止时间 (ISO 8601 UTC) |
  | `profile_id` | `string` | 否 | 指定数据源 ID |
  | `status` | `string` | 否 | 指定审计状态过滤 |
  | `is_high_risk`| `boolean` | 否 | 是否仅导出高危事件 |
- **请求示例**：
  ```json
  {
    "range": "today",
    "profile_id": "101",
    "is_high_risk": false
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "ticket": "exp_ticket_a8f3c7b2e1d0_5m_valid_signature_token",
    "downloadUrl": "/api/v1/audits/export/download?ticket=exp_ticket_a8f3c7b2e1d0_5m_valid_signature_token",
    "count": 1250,
    "expiresAt": "2026-11-08T08:35:00.000Z"
  }
  ```

---

#### 6.8.4 流式安全下载审计日志 CSV
- **接口路径**：`GET /api/v1/audits/export/download`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`；验证 Ticket 签名)
- **功能说明**：通过一次性有效 Ticket 启动流式下载。服务端向响应通道逐块写入脱敏 CSV 数据，执行严格的 Excel 公式注入防御转义。
- **数据脱敏规范**：
  - `sql_text` 中的敏感数字与字符串常量字面量统一进行脱敏掩码（如身份证号、卡号、密码字面量替换为 `***`）；
  - 数据库账号明文密码、用户登录密码哈希、PAT Token 等机密数据绝不打入导出列中；
- **安全防线 (Excel Formula Injection Escaping)**：
  对所有单元格内容（尤其是 `sql_text`、`username`、`error_message`），若其首字符匹配 `=, +, -, @, \t, \r`，**强制在首字符前追加单引号 (`'`) 并在外层用双引号包裹**，彻底根除打开 CSV 触发恶意 DDE 代码执行攻击；
- **Ticket CAS 原子消费与防重放机制**：
  - **原子预占先于响应**：在服务端向 HTTP 连接发送任何响应头（200 OK）或写入首个 CSV 数据块之前，必须在内存原子比对并翻转状态：`CAS state from UNUSED to CONSUMING`；
  - 若 CAS 失败（Ticket 处于 `CONSUMING` 或 `CONSUMED`），服务端**绝不建立 CSV 流**，立即直接响应 `403 ERR_TICKET_ALREADY_USED`，从根源杜绝多线程并发重复拉取；流式发送完毕后状态置为 `CONSUMED`；
  - **单节点进程重启行为定义**：下载凭证为内存态 5 分钟短效 Ticket。若网关节点发生重启或故障转移，旧 Ticket 自动失效，客户端请求将收到 `403 ERR_INVALID_TICKET` 或 `403 ERR_TICKET_EXPIRED`，前端捕获后引导管理员重新点击【导出】生成全新凭证。
- **查询参数**：
  | 参数名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `ticket` | `string` | 是 | 导出申请时获取的 5 分钟签名 Ticket |
- **成功响应**：`200 OK`
  - **响应头**：
    ```http
    Content-Type: text/csv; charset=utf-8
    Content-Disposition: attachment; filename="mysql_mcp_audits_20261108_083000.csv"
    Cache-Control: no-cache, no-store, must-revalidate
    Pragma: no-cache
    ```
  - **响应流 (CSV Body Snippet)**：
    ```csv
    "id","query_instance_id","user_id","username","profile_name","database_name","sql_text","status","latency_ms","client_ip","created_at"
    "90001002003004005","qry_8f3a9e2d","1001","zhangsan","核心业务主库","trade_order","SELECT * FROM t_orders WHERE id = 101 LIMIT 50","SUCCESS","24","10.0.15.82","2026-11-08T08:15:30.123Z"
    ```
- **错误分支**：
  - `403 ERR_INVALID_TICKET`：Ticket 伪造或签名无效；
  - `403 ERR_TICKET_EXPIRED`：Ticket 超过 5 分钟自然过期；
  - `403 ERR_TICKET_ALREADY_USED`：Ticket 已经被使用过。

---

### 6.9 系统设置与通知渠道模块接口契约 (`/api/v1/settings/*`)

#### 6.9.1 获取系统通知渠道配置
- **接口路径**：`GET /api/v1/settings/notifications`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：获取企业微信、钉钉、飞书机器人 Webhook 告警渠道配置及订阅的高危安全事件。
- **安全说明**：Webhook URL 与签名密钥中敏感 Token 部分进行掩码处理 (`******`)，返回当前配置 `version`。
- **成功响应**：`200 OK`
  ```json
  {
    "channels": [
      {
        "channelType": "FEISHU",
        "enabled": true,
        "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/********-****-****-****-************",
        "secret": "******",
        "alertEvents": ["HIGH_RISK_AST", "AGENT_LOOP", "POOL_EXHAUSTED", "SECURITY_BRUTE_FORCE"]
      },
      {
        "channelType": "DINGTALK",
        "enabled": false,
        "webhookUrl": "",
        "secret": null,
        "alertEvents": []
      },
      {
        "channelType": "WECHAT",
        "enabled": false,
        "webhookUrl": "",
        "secret": null,
        "alertEvents": []
      }
    ],
    "version": 1
  }
  ```

---

#### 6.9.2 更新系统通知渠道与告警订阅
- **接口路径**：`PUT /api/v1/settings/notifications`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：更新通知渠道配置。校验 `version` (409 CAS)。同事务写管理审计。
- **脱敏字段保留与更新确定性语义**：
  - **`webhookUrl` 处理规则**：若请求体中该字段包含掩码字样（如包含 `********`）或为空/缺省，服务端判定为保留数据库内已存的完整明文 URL；若传入不含掩码的完整新 URL，服务端校验并更新；
  - **`secret` 处理规则**：若传入 `"******"`、`null` 或字段缺省，服务端保留已存加签密钥；若传入空字符串 `""`，服务端将其物理清空；若传入非掩码新字符串，服务端更新密钥；
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `channels` | `NotificationChannelWriteItem[]` | 是 | 数组容量 1~3 条，渠道类型禁止重复 | 增量合并更新的通知渠道列表 |
  | `channels[].channelType` | `string` | 是 | 枚举: `'FEISHU'`, `'DINGTALK'`, `'WECHAT'` | 通知渠道标识 |
  | `channels[].enabled` | `boolean` | 是 | 布尔值 | 是否启用该渠道告警推送 |
  | `channels[].webhookUrl` | `string` | **否** | 最大 512 字符；缺省或含掩码时保留已存原值 | 机器人 Webhook URL |
  | `channels[].secret` | `string \| null` | **否** | 传 `null` 或 `"******"` 保留原密钥；传 `""` 物理清空；传新值覆盖 | 机器人签名密钥 |
  | `channels[].alertEvents` | `string[]` | 是 | 有效事件枚举数组 | 订阅告警类别 (如 `HIGH_RISK_AST`) |
  | `version` | `number` | 是 | 必须等于当前读取到的全局设置版本号 | 乐观锁版本前置条件 |

- **未提交渠道的确定性增量合并语义**：
  更新采用**按 `channelType` 增量合并 (Partial Patch by channelType)**。客户端仅需提交发生配置变更的渠道；未在 `channels` 数组中提交的渠道类型，服务端**保持原配置与启用状态不变**；若提交全部 3 个渠道则全量覆盖。
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 2
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：配置已被其他管理员更新；
  - `400 ERR_VALIDATION_FAILED`：Webhook URL 格式非法。

---

#### 6.9.3 发送测试通知消息 (支持已存配置与新增草稿)
- **接口路径**：`POST /api/v1/settings/test-notify`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：向指定的企业微信/钉钉/飞书 Webhook 发送一条测试卡片。
- **两大工作模式**：
  - **模式 1：已存渠道测试**：仅需传递 `{ "channelType": "FEISHU" }`，无需重传 URL 与 Secret，服务端自动从密钥库中解密已保存的有效配置发起推送；
  - **模式 2：草稿/新增测试**：传递 `{ "channelType": "FEISHU", "webhookUrl": "https://...", "secret": "..." }`，对填入的全新参数执行连通性探测。
- **安全防线**：全链路执行 SSRF Post-DNS 解析核验，强制锁定 IP 发起请求，禁止 3xx 外部重定向跳转，加装 3000ms 硬超时。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `channelType` | `string` | 是 | `"WECHAT"`, `"DINGTALK"`, `"FEISHU"` |
  | `webhookUrl` | `string` | 否 | 测试新地址时必填；模式 1 可不传 |
  | `secret` | `string` | 否 | 签名密钥 (模式 2 可选) |
- **请求示例 (模式 1：快速测试已存配置)**：
  ```json
  {
    "channelType": "FEISHU"
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "latencyMs": 142
  }
  ```
- **错误分支**：
  - `403 ERR_SSRF_PROHIBITED`：Webhook 域名解析出私有或保留 IP；
  - `400 ERR_NOTIFICATION_FAILED`：远端通知平台返回错误（如签名失效或 Token 无效）。

---

## 第七章：前后端联调测试矩阵与边界用例基线

### 7.1 核心成功路径测试矩阵 (`TC-INT-01` ~ `TC-INT-12`)

| 用例编号 | 业务场景 | 接口链路 | 期望 HTTP 状态 | 核心断言契约 |
| :---: | :--- | :--- | :---: | :--- |
| **TC-INT-01** | CSRF 令牌安全获取 | `GET /api/v1/auth/csrf` | `200 OK` | 返回 64 位十六进制 Token；若无种子自动下发 `mcp_csrf_seed` Cookie |
| **TC-INT-02** | 用户自主强口令注册 | `POST /api/v1/auth/register` | `200 OK` | 录入强密码，账号初始状态为 `PENDING`，`must_change_password=0`，记录审批流 |
| **TC-INT-03** | 初始超管密码登录 | `POST /api/v1/auth/login` | `200 OK` | 下发 `mcp_admin_sid` HttpOnly Cookie，返回 `UserProfileDTO` (含过期时间) |
| **TC-INT-04** | 会话信息全状态拉取 | `GET /api/v1/auth/me` | `200 OK` | `PENDING/REJECTED/DISABLED/ACTIVE` 均返回 200，被驳回用户下发 `reject_reason` |
| **TC-INT-05** | 审批通过直接激活 | `POST /api/v1/approvals/:id/approve` | `200 OK` | 用户状态流转为 `ACTIVE`，`must_change_password=0`，**用户可直接用原密码登录** |
| **TC-INT-06** | 自主修改密码 | `POST /api/v1/auth/change-password` | `200 OK` | 更新密码并重置 `password_updated_at`，重新开始过期计算，换发新 Session |
| **TC-INT-07** | 个人访问令牌签发 | `POST /api/v1/pats` | `200 OK` | **单次返回 rawToken 明文**，数据库存储哈希，返回 `token_prefix` |
| **TC-INT-08** | 数据源已存连通性测试 | `POST /api/v1/profiles/test-db` | `200 OK` | 仅传 `profile_id`，后端成功解密存量密码，返回 `{ reachable: true }` |
| **TC-INT-09** | 研发拉取轻量 Profile 选项 | `GET /api/v1/profiles/my-options` | `200 OK` | 仅返回授权 Profile 的 `{ id, name, displayName }`，绝无主机端口泄露 |
| **TC-INT-10** | 表级 ACL 黑名单置顶配置 | `PUT /api/v1/roles/:id/table-acls` | `200 OK` | 规则全量原子替换，`profile_id="0"` 全局生效，父角色版本自增并返回新版本 |
| **TC-INT-11** | 态势大盘双视角动态裁剪 | `GET /api/v1/audits/stats` | `200 OK` | 管理员视角返回全量指标；普通研发视角仅聚合本人数据且屏蔽连接数 |
| **TC-INT-12** | 审计日志 5 分钟 Ticket 导出 | `POST /api/v1/audits/export` ➔ `GET .../download` | `200 OK` | 签名 Ticket 验证通过，流式返回 CSV，首字符带公式注入前缀自动转义 |

### 7.2 安全与异常边界测试矩阵 (`TC-INT-13` ~ `TC-INT-27`)

| 用例编号 | 业务场景 | 触发操作 | 期望 HTTP | 期望错误码 (`code`) | 交互断言与自愈校验 |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **TC-INT-13** | 密码登录防爆破锁定 | 连续 5 次输入错误密码 | `429` | `ERR_AUTH_ACCOUNT_LOCKED` | 账号被锁定 15 分钟，响应体携带精确 `retry_after_sec` 倒计时 |
| **TC-INT-14** | 待审账号越权访问功能 | `PENDING` 账号访问 `/api/v1/pats` | `403` | `ERR_AUTH_ACCOUNT_PENDING` | L2 守卫硬拦截，前端自动分流引导至 `/approvals/wait` 状态页 |
| **TC-INT-15** | 密码超期失效拦截功能 | 密码超过 90 天访问 `/api/v1/profiles` | `403` | `ERR_MUST_CHANGE_PASSWORD` | L3 守卫硬拦截，前端弹出全局模态改密框，锁定其他路由功能 |
| **TC-INT-16** | 尝试使用弱口令注册/改密 | 提交长度为 6 位纯数字密码 | `400` | `ERR_PASSWORD_POLICY_VIOLATED` | 表单对应字段标红并展示大小写/数字/特殊字符复杂度要求 |
| **TC-INT-17** | CSRF 令牌伪造或缺失 | 发起写请求携带空 `x-csrf-token` | `403` | `ERR_CSRF_INVALID` | `preValidation` 零副作用拦截，前端自动单飞拉取新 Token 后静默重试 |
| **TC-INT-18** | 超管尝试自冻结/自删除 | 管理员对自己调用停用或删除接口 | `400` | `ERR_SELF_ACTION_PROHIBITED` | 操作被阻止，Toast 提示“系统防自残保护中，禁止对自己执行此操作” |
| **TC-INT-19** | 尝试停用最后一名超管 | 系统仅存 1 名超管时尝试停用 | `400` | `ERR_LAST_SUPER_ADMIN` | 排他事务锁判定拦截，弹窗明确提示“系统必须保留至少 1 名超管” |
| **TC-INT-20** | 数据源编辑草稿并发冲突 | 携带旧 `version: 1` 提交 PUT | `409` | `ERR_CONCURRENCY_CONFLICT` | **前端严格保留用户本地草稿**，弹出冲突横条并高亮差异字段 |
| **TC-INT-21** | 修改数据源端点未填密码 | 修改了 host 但未填入密码 | `400` | `ERR_CREDENTIAL_REENTRY_REQUIRED` | 防外泄铁律拦截，密码框变红提示“修改主机目标必须重新输入密码” |
| **TC-INT-22** | 连通性测试命中私网 SSRF | 测试连接 `169.254.169.254` | `403` | `ERR_SSRF_PROHIBITED` | 域名 Post-DNS 拦截，引导联系管理员配置 `ALLOWED_OUTBOUND_IPS` |
| **TC-INT-23** | 删除仍在使用的 Profile | 删除已被角色关联的数据源 | `400` | `ERR_PROFILE_IN_USE` | 阻断删除，错误详情列表标出占用的关联角色名称 |
| **TC-INT-24** | 审计下载 Ticket 重复消费 | 使用已下载过的 Ticket 再次请求 | `403` | `ERR_TICKET_ALREADY_USED` | 单次消费原则拦截，提示“凭证已被使用，不可重复下载” |
| **TC-INT-25** | 审计下载 Ticket 超过 5 分钟 | 等待 301 秒后请求下载链接 | `403` | `ERR_TICKET_EXPIRED` | 拦截过期凭证，提示“导出凭证已过期，请重新发起导出申请” |
| **TC-INT-26** | 密码有效期配置更新 | `PUT /auth/password-policy` 设为 60 天 | `200` | - | 更新成功，重新计算过期时间点，返回最新剩余天数 |
| **TC-INT-27** | 关闭密码过期风险提醒拦截 | 尝试设置 `passwordExpiresDays: null` | `200` | - | 前端必须弹窗高风险警示对话框，用户确认后提交成功，服务端审计记录 |
| **TC-INT-28** | 限流删除重建防 ABA 校验 | A读取版本1，B删除后重新创建分配版本2，A提交旧版本1 | `409` | `ERR_CONCURRENCY_CONFLICT` | 持久化计数器分配新版本2，A的旧版本1更新被CAS原子拦截，杜绝ABA覆盖 |
| **TC-INT-29** | 审计 Ticket 并发原子预占 | 两个并发请求携带同一 Ticket 请求下载 | `403` | `ERR_TICKET_ALREADY_USED` | 首个请求 CAS 预占成功下载，第二个请求未发流直接被 403 阻断 |
| **TC-INT-30** | SSH/TLS 信任边界变更防外泄 | 数据源主机未变，但切换 `use_ssh=true` 且未填密码 | `400` | `ERR_CREDENTIAL_REENTRY_REQUIRED` | 信任边界发生变更，强制必须重新输入密码，防止凭据外泄 |
| **TC-INT-31** | 双栈 IPv6 ULA / 映射地址拦截 | 目标域名解析出 `fc00::1` 或 `::ffff:127.0.0.1` | `403` | `ERR_SSRF_PROHIBITED` | 双栈 DNS 全量解析核验，Fail-Closed 立即拦截私网出站 |
| **TC-INT-32** | 时序 QPM 速率与未完成桶折算 | 请求带 `timezone`，10分钟桶发生120次调用 | `200` | - | 正确输出速率 `12.0` QPM；未完成当前桶平滑折算，历史空桶补零 `0.0` |

### 7.3 前端 Mock 数据适配基线

在前后端独立并行开发阶段，前端 `apps/admin-ui` 可基于本契约标准结构接入 MSW (Mock Service Worker) 或 Vite 本地代理，所有 Mock 端点必须满足：
1. 主键全部使用 64 位大整型格式的字符串（如 `"1001"`, `"90001002003004005"`）；
2. 修改接口必须返回递增后的整数 `version`；
3. 异常分支必须完整返回包含 `code`, `message`, `timestamp`, `action_guidance` 的 `StandardErrorResponse`；
4. 密码策略相关端点完整模拟 30~180 天范围校验与关闭风险确认弹窗行为。

---

## 第八章：附录与设计基线索引

### 8.1 关联设计文档与架构决策索引
- **系统总架构说明书**：[`docs/ARCHITECTURE_SPEC.md`](./ARCHITECTURE_SPEC.md) (v1.2.1 基线版)
  - §5.2 物理 Schema 唯一入口（统一引用 `docs/sql/001_metadata_schema.sql` 的14表结构）
  - §6.1 MCP 11 项 Tools 显式传参契约与紧凑二维出参
  - §6.3 统一错误码与异常响应矩阵
- **后端详细设计说明书**：[`docs/BACKEND_ARCHITECTURE_SPEC.md`](./BACKEND_ARCHITECTURE_SPEC.md) (v1.7.0 七轮整改版)
  - §3.3 全链路 64 位 `EntityId (string)` 类型契约
  - §5.4 `preValidation` 无副作用 CSRF 校验器与 `/auth/csrf` 端点
  - §5.5 四级分层守卫完整实现流水线
  - §9.2 连通性测试三模式解析与防外泄安全铁律
  - §10.2 `/audits/stats` 双角色视角脱敏与时序聚合
  - §10.4 审计安全 CSV 导出、防公式注入与 5 分钟 Ticket
  - §11.1 管控面全量 RESTful 路由总表
- **前端详细设计说明书**：[`docs/FRONTEND_ARCHITECTURE_SPEC.md`](./FRONTEND_ARCHITECTURE_SPEC.md) (v1.4.0 终审修订版)
  - §3.2 `packages/shared-types` 纯类型边界定义
  - §4.1 会话管理、CSRF 刷新与 `SessionRequestManager` 代际管理
  - §4.2 账号生命周期全状态机与分层守卫顺序
  - §4.8 乐观锁冲突控制与草稿保留交互
  - §8.1 核心 RESTful API 路由映射表
  - §8.3 后端协同确认契约清单 (9 项闭环跟踪)

### 8.2 契约签名与生效声明
本接口契约规范自发布之日起作为 **MySQL MCP 企业级安全网关与管控平台 v1.0** 前后端研发、集成联调与自动化测试验收的唯一执行准则。