## 第八章：页面—接口—DTO 契约映射表与后端协同清单

### 8.1 核心 RESTful API 路由映射矩阵

> 本矩阵的内联对象为字段概要，**非完整签名**；必填性、联合类型与条件安全约束以 `API_CONTRACT_SPEC.md` 对应接口为准。生成类型/真实响应 fixture 与47项实现追踪见 `docs/contracts/`（由 `scripts/generate_readiness_contracts.py` 生成）。

| 业务模块 | 接口路由 (Route) | HTTP 方法 | 请求入参签名 (Request Payload) | 响应数据 (Response Body) | 关键错误码与交互边界 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **认证** | `/api/v1/auth/csrf` | `GET` | *(无入参)* | `{ csrfToken: string }` | 公开无门槛端点，单飞刷新 CSRF Token |
| | `/api/v1/auth/password-policy` | `GET` | *(无入参)* | `PasswordPolicyDTO` | 查询当前登录用户密码轮换周期与到期时间 |
| | `/api/v1/auth/password-policy` | `PUT` | `{ passwordExpiresDays: number | null }` | `{ success: true, passwordExpiresDays: number | null, passwordExpiresAt: string | null, isExpirationEnabled: boolean }` | 调整密码轮换天数 (30~180天，null 为关闭轮换并弹高危风险确认对话框) |
| | `/api/v1/auth/register` | `POST` | `{ username, password, email, department, reason }` | `{ success: true, message: string }` | 注册申请成功，引导进入待审排队页 |
| | `/api/v1/auth/login` | `POST` | `{ username, password }` | `{ user: UserProfileDTO }` (Cookie 下发) | `ERR_AUTH_FAILED` (提示防爆破剩余次数) |
| | `/api/v1/auth/logout` | `POST` | *(无入参)* | `{ success: true }` | 调用 SessionRequestManager 掐断，清空缓存 |
| | `/api/v1/auth/change-password`| `POST` | `{ oldPassword, newPassword }` | `{ success: true }` | 成功后轮换 CSRF 并解锁全局改密限制 |
| | `/api/v1/auth/me` | `GET` | *(无入参，依赖 Cookie)* | `UserProfileDTO` | 401 重定向登录，网络超时展示重试卡片 |
| **审批** | `/api/v1/approvals/pending` | `GET` | `?page=1&pageSize=20` | `Paginated<PendingApprovalDTO>` | 待审批工单高密度分页列表 |
| | `/api/v1/approvals/:id/approve`| `POST`| `{ roleIds: string[] }` | `{ success: true }` | 严格非乐观更新，等待 HTTP 200 后刷新列表 |
| | `/api/v1/approvals/:id/reject` | `POST`| `{ reason: string }` | `{ success: true }` | 必填驳回理由校验 |
| | `/api/v1/approvals/resubmit` | `POST`| `{ email, department, reason }` | `{ success: true }` | 重新提交后跳转至 `/approvals/wait` |
| **用户** | `/api/v1/users` | `GET` | `?page=1&pageSize=20&search=...` | `Paginated<UserListItemDTO>` | 含 `is_last_super_admin` 标记 |
| | `/api/v1/users/:id/status` | `PUT` | `{ status: "DISABLED" \| "ACTIVE", version }` | `{ success: true }` | 命中 `ERR_LAST_SUPER_ADMIN` 或本人保护阻断 |
| | `/api/v1/users/:id/roles` | `PUT` | `{ roleIds: string[], version }` | `{ success: true }` | 命中超管防自残阻断；低权限禁止越权提权 |
| | `/api/v1/users/:id` | `DELETE` | *(无入参)* | `{ success: true }` | 本人与最后超管保护，二次确认弹窗 |
| **PAT** | `/api/v1/pats` | `GET` | *(无入参)* | `PatListItemDTO[]` | 仅返回 `token_prefix` 与脱敏摘要 |
| | `/api/v1/pats` | `POST` | `{ name, expiresDays }` | `{ pat: PatCreatedDTO, rawToken: string }` | **仅本次返回 rawToken，触发三态防呆弹窗** |
| | `/api/v1/pats/:id/revoke` | `POST` | *(无入参)* | `{ success: true }` | 仅支持吊销本人 PAT，二次确认 |
| **数据源** | `/api/v1/profiles` | `GET` | *(无入参)* | `ProfileDTO[]` | 密码脱敏为 `******`，包含 `version` |
| | `/api/v1/profiles/my-options` | `GET` | *(无入参)* | `ProfileOptionDTO[]` | 普通研发配置向导轻量选项 (不泄露运维配置) |
| | `/api/v1/profiles` | `POST` | `{ name, display_name, host, port, user, password, database, max_pool_size, profile_capacity_qpm }` | `{ id: string }` | 新建数据源，初始版本号 1 |
| | `/api/v1/profiles/:id` | `PUT` | `{ ...profileFields, version }` | `{ success: true }` | 密码留空不改；409 冲突保留草稿并提示 |
| | `/api/v1/profiles/:id` | `DELETE` | *(无入参)* | `{ success: true }` | 级联检查，若有依赖阻断删除 |
| | `/api/v1/profiles/test-db` | `POST` | `{ profile_id?, host?, port?, user?, password?, database?, tls_config?, use_ssh?, ssh_host?, ssh_port?, ssh_user?, ssh_private_key?, ssh_host_fingerprint_sha256? }` | `{ reachable: boolean, latencyMs: number }` | 三模式测试；`ERR_SSRF_PROHIBITED` 引导白名单 |
| | `/api/v1/profiles/test-ssh`| `POST` | `{ profile_id?, host?, port?, username?, privateKey?, hostFingerprintSha256? }` | `{ reachable: boolean, latencyMs: number }` | 三模式测试；`ERR_SSRF_PROHIBITED` 引导白名单 |
| **角色ACL**| `/api/v1/roles` | `GET/POST`| GET无 / POST: `{ role_name, display_name, description?, profileIds: string[] }` | `RoleDTO[]` / `{ id: string }` | 角色模版创建与列表 |
| | `/api/v1/roles/:id` | `PUT/DELETE`| PUT: `{ display_name?, description?, profileIds: string[], default_limit?, max_limit?, max_timeout_ms?, user_qpm_limit?, version }` / DELETE无 | `{ success: true }` | 角色模版与策略参数更新/删除 (带版本校验) |
| | `/api/v1/roles/:id/table-acls` | `GET/PUT` | GET无 / PUT: `{ rules: TableAclRuleDTO[], version }` | `TableAclResponseDTO` / `{ success: true }` | 表级黑名单置顶，支持 409 冲突控制 |
| | `/api/v1/roles/:id/db-acls` | `GET/PUT` | GET无 / PUT: `{ rules: DbAclRuleDTO[], version }` | `DbAclResponseDTO` / `{ success: true }` | 库级结构化规则 (ALLOW/DENY/profile_id="0"为全局) |
| **限流** | `/api/v1/rate-limits/global` | `GET/PUT`| GET无 / PUT: `{ defaultUserQuotaQpm, burstCapacity, agentLoopThreshold, agentLoopWindowSec, version }` | `GlobalRateLimitDTO` / `{ success: true }` | 全局默认配额与死循环熔断阈值 |
| | `/api/v1/rate-limits/users/:id`| `GET/PUT`| GET无 / PUT: `{ userQuotaQpm, burstCapacity?, revision }` | `UserRateLimitDTO` / `{ success: true }` | 用户专属配额 (-1 免限流，受 Profile 上限约束) |
| **审计** | `/api/v1/audits` | `GET` | `?status=...&profile=...&query_instance_id=...&page=1`| `Paginated<AuditRecordDTO>` | 支持按 `query_instance_id` 精确单条回补 |
| | `/api/v1/audits/stats` | `GET` | `?profile_id=...&range=today` | `AdminDashboardStatsDTO` 或 `DeveloperDashboardStatsDTO` | 10s 轮询，服务端根据角色进行脱敏裁剪 |
| | `/api/v1/audits/export` | `POST` | `{ range, profile_id?, status? }` | `{ downloadUrl: string, count: number }` | 导出脱敏审计 CSV |
| **通知** | `/api/v1/settings/notifications`| `GET/PUT` | GET无 / PUT: `{ channels: NotificationChannelDTO[], version }` | `NotificationSettingsDTO` / `{ success: true }` | 企微/钉钉/飞书 Webhook 渠道配置 |
| | `/api/v1/settings/test-notify` | `POST` | `{ channelType: "WECHAT" \| "DINGTALK" \| "FEISHU", webhookUrl: string }` | `{ success: true, latencyMs: number }` | 发送测试通知，带 SSRF 防重绑定拦截 |
| | `/api/v1/users/:id/reset-password` | `POST` | `{ newTemporaryPassword?, mustChangePassword?, version }` | `{ success, temporaryPassword, version }` | 仅SUPER_ADMIN；二次确认；临时密码仅本次展示、不持久缓存；409保留输入并刷新版本 |
| | `/api/v1/rate-limits/users/:id` | `DELETE` | `?revision=N`（N>0，兼容version） | `{ success: true }` | 恢复继承按钮；409刷新；QPM按角色/全局、burst按GLOBAL重新取值 |
| | `/api/v1/audits/export/download` | `GET` | `?ticket=...` | `text/csv` 文件流 | 同源Cookie下载；过期/已消费403引导重新导出；不自动复用Ticket |

---

### 8.2 核心 DTO 字段结构定义 (空值规范与大整型字符串契约)

```ts
// 用户基础模型 DTO (email 对齐数据库允许为 NULL 约束)
export interface UserProfileDTO {
  id: string;                 // 服务端强制输出为字符串，防止精度丢失
  username: string;
  email: string | null;       // 规范对齐：允许为空
  department: string | null;
  status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
  must_change_password: boolean;
  password_updated_at?: string;
  password_expires_days: number | null;
  password_expires_at: string | null;
  is_password_expired: boolean;
  version: number;
  roles: string[];
  reject_reason: string | null;
  created_at: string;
}

// 用户密码生命周期策略 DTO (100% 对齐 GET /api/v1/auth/password-policy 线上契约)
export interface PasswordPolicyDTO {
  passwordExpiresDays: number | null; // 30~180 天；关闭定期更换时为 null
  passwordExpiresAt: string | null;   // ISO 8601 UTC 到期时间；关闭定期更换时为 null
  isExpirationEnabled: boolean;       // 是否启用定期更换
  daysRemaining: number;              // 剩余有效天数；关闭定期更换时固定为 -1
  isExpired: boolean;                 // 当前密码是否已自然过期
  minDays: number;                    // 最小可配天数 (30)
  maxDays: number;                    // 最大可配天数 (180)
}

// 审计流水实体 DTO (100% 对齐 sys_audit_logs 物理表)
export interface AuditRecordDTO {
  id: string;                 // 服务端强制序列化为 string，防 64 位整型截断
  query_instance_id: string;  // 全局唯一查询实例 ID (VARCHAR(64))
  session_id: string | null;  // 逻辑 McpSession ID (允许 null)
  user_id: string;
  username: string;
  profile_id: string;
  profile_name: string | null;// 若已解绑/删除为 null，前端规范回显 "(已解绑数据源)"
  database_name: string | null;// 允许 null
  sql_text: string;           // 脱敏后的完整 SQL
  sql_type: string;           // SELECT 等
  status: AuditStatus;        // SUCCESS, BLOCKED_AST, BLOCKED_ACL, BLOCKED_CONCURRENCY, BLOCKED_RATE, CANCELED, FAILED_MYSQL, TIMEOUT
  error_message: string | null;
  latency_ms: number;
  rows_affected: number;
  client_ip: string;
  is_high_risk: boolean;
  created_at: string;
}

// 库级结构化 ACL 规则 DTO
export interface DbAclRuleDTO {
  id?: string;
  profile_id: string;         // "0" 表示对该角色名下所有 Profile 生效的全局规则
  database_name: string;      // 目标数据库名 (v1.0仅精确名，拒绝通配符)
  effect: 'ALLOW' | 'DENY';   // 明确允许或拒绝 (DENY 优先)
}

export interface DbAclResponseDTO {
  rules: DbAclRuleDTO[];
  version: number;            // 规则集版本号
}

// 表级结构化 ACL 规则 DTO
export interface TableAclRuleDTO {
  id?: string;                        // 规则唯一标识 (读取时提供)
  profile_id: string;                 // "0" 为全局规则
  table_pattern: string;              // 支持通配符如 "salary_*" 或 "order_*"
  rule_type: 'BLACKLIST' | 'WHITELIST'; // 规则类型: 黑名单优先生效
  description?: string | null;        // 规则备注说明
}

export interface TableAclResponseDTO {
  rules: TableAclRuleDTO[];
  version: number;
}

// 普通研发轻量 Profile 选项 DTO (不暴露底层运维配置)
export interface ProfileOptionDTO {
  id: string;
  name: string;
  displayName: string;
}

// 管理员大盘统计 DTO (全量运维视角)
export interface AdminDashboardStatsDTO {
  total_calls_today: number;
  total_calls_growth_pct: number;
  active_sessions_count: number;
  active_db_connections: number; // 物理连接数 (独立指标)
  high_risk_blocked_count: number;
  pending_approvals_count: number;
  profile_traffic: Array<{
    profile_id: string;
    profile_name: string;
    profile_capacity_qpm: number;// QPM 容量上限
    current_qpm: number;         // 当前实时吞吐
    time_series: Array<{
      timestamp: string;
      actual_qpm: number;
      limit_qpm: number;
    }>;
  }>;
}

// 普通研发大盘统计 DTO (个人视图脱敏裁剪，不暴露底层连接数与审批数)
export interface DeveloperDashboardStatsDTO {
  personal_calls_today: number;
  personal_calls_growth_pct: number;
  personal_blocked_count: number;
  authorized_profiles: Array<{
    profile_id: string;
    profile_name: string;
    user_quota_qpm: number;     // 个人配额
    current_qpm: number;        // 个人吞吐
    time_series: Array<{
      timestamp: string;
      personal_qpm: number;
    }>;
  }>;
}

// 数据源实体 DTO
export interface ProfileReadDTO {
  id: string;
  name: string;
  display_name: string;
  environment: 'PROD' | 'STG' | 'DEV';
  host: string;
  port: number;
  username: string; // GET只返回username，写请求使用user
  database: string;
  max_pool_size: number;
  profile_capacity_qpm: number;
  queue_timeout_ms: number;
  max_inflight_concurrency: number;
  use_ssh: boolean;
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_user?: string | null;
  ssh_host_fingerprint_sha256?: string | null;
  tls_config: { enabled: boolean; ca_cert?: string | null } | null;
  status: 'ACTIVE' | 'DISABLED';
  version: number;
  created_at: string;
  updated_at: string;
}
export type ProfileDTO = ProfileReadDTO; // 仅供旧读调用迁移，不能作为写Payload
// CreateProfilePayload / UpdateProfilePayload 从 docs/contracts/readiness.types.ts 生成导入。
// 仅选择可写字段，不展开整个读DTO；不回填密码、私钥、id、时间和status。
export function profileToEditForm(profile: ProfileReadDTO) {
  return {
    display_name: profile.display_name, host: profile.host, port: profile.port,
    user: profile.username, database: profile.database,
    max_pool_size: profile.max_pool_size, queue_timeout_ms: profile.queue_timeout_ms,
    profile_capacity_qpm: profile.profile_capacity_qpm,
    max_inflight_concurrency: profile.max_inflight_concurrency,
    use_ssh: profile.use_ssh, ssh_host: profile.ssh_host ?? undefined,
    ssh_port: profile.ssh_port ?? undefined, ssh_user: profile.ssh_user ?? undefined,
    ssh_host_fingerprint_sha256: profile.ssh_host_fingerprint_sha256 ?? undefined,
    tls_config: profile.tls_config, version: profile.version,
  };
}
```

---

### 8.3 后端协同确认契约清单 (Backend Collaboration Tracker)

为杜绝前端单方面定契约导致的联调阻断，将本详细设计中梳理出的需后端协同入库的契约点单独建表跟踪：

| 契约项 | 前端详细设计诉求 | 后端主架构现状 | 联调协同与入库状态 |
| :--- | :--- | :--- | :--- |
| **1. 审计单条精确回补** | `GET /api/v1/audits?query_instance_id=xxx` 支持精准拉取单条记录，用于 URL 深度直达 | 已有分页 `/audits` 接口，入参需增加 `query_instance_id` 过滤分支 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **2. 连通性测试草稿模式**| `test-db`/`test-ssh` 支持传 `{ profile_id, host, port }`，自动复用密文密码与新参数测试 | 已有连通性测试端点，需扩展入参联合解析逻辑 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **3. 实体乐观锁版本机制**| `Profile`、`Role`、`ACL`、`RateLimit` 响应增加 `version`，PUT 校验 `version`，409 拦截 | 需后端确认版本来源方案 (增加 version 列 / ETag / updated_at 毫秒戳) | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **4. 库级 ACL 结构化规则**| 库级 ACL 传 `DbAclRuleDTO[]` (包含 `profile_id`, `database_name`, `effect`) | 物理表 `sys_role_database_acls` 结构完全支持，API 需对齐 DTO | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **5. 大盘响应按角色裁剪**| 普通研发人员调用 `/audits/stats` 时，服务端自动脱敏裁剪为 `DeveloperDashboardStatsDTO` | 已有 `/audits/stats`，需在 Service 层按当前用户角色做返回体分支 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **6. CSRF 独立获取端点**| `GET /api/v1/auth/csrf` 作为公开端点，在各守卫前均放行访问 | 需在 Fastify 路由注册全局放行名单 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **7. 限流更新路由目标拆分**| 拆分为 `/rate-limits/global` (全局与熔断) 与 `/rate-limits/users/:id` (用户配额) | 目前基线路由为扁平 `/rate-limits`，需拆分端点映射 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **8. 64 位整型字符串输出**| 超过 53 位的 BIGINT 实体 ID，后端在 JSON 序列化阶段强制输出为 `string` 格式 | 需在 Fastify 序列化器或 DTO 转换层配置大数字符串化 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **9. 研发轻量 Profile 选项**| 提供 `GET /api/v1/profiles/my-options`，仅返回 `{ id, name, displayName }` 脱敏选项 | 避免普通研发调用管理端全量 Profile 列表造成信息泄露 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |