## 第十一章：全量接口契约映射、评审问题闭环核验表、测试矩阵与实施路线图

### 11.1 管控面 `/api/v1/*` 全量 RESTful 路由、守卫级别与 DTO 映射总表

> 本矩阵的内联对象为字段概要，**非完整签名**；必填性、联合类型与条件安全约束以 `API_CONTRACT_SPEC.md` 对应接口为准。生成类型/真实响应 fixture 与47项实现追踪见 `docs/contracts/`（由 `scripts/generate_readiness_contracts.py` 生成）。

| 模块 | 路由路径 (Route) | 方法 | 守卫级别 & 角色要求 | 请求负载 / 查询参数 | 响应结构 (DTO) | 乐观锁 / 核心安全约束 |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **认证** | `/api/v1/auth/csrf` | `GET` | **L0 公开** | 无 | `{ csrfToken: string }` | 公开无门槛放行，绑定会话或匿名种子 |
| | `/api/v1/auth/register` | `POST` | **L0 公开** | `{ username, password, email, department, reason }` | `{ success: true, message: string }` | Argon2Semaphore 限流，初始 `PENDING`，同事务审计 |
| | `/api/v1/auth/login` | `POST` | **L0 公开** | `{ username, password }` | `{ user: UserProfileDTO }` | IP+账号双维防爆破；Argon2Semaphore；成功轮换 Session ID |
| | `/api/v1/auth/logout` | `POST` | **L1 会话级** | 无 | `{ success: true }` | 销毁服务端 Session 并清理 HttpOnly Cookie |
| | `/api/v1/auth/change-password` | `POST` | **L2 ACTIVE** | `{ oldPassword, newPassword }` | `{ success: true }` | 解除改密锁定、`auth_version+1`、同步取消在途SQL、轮换Session |
| | `/api/v1/auth/me` | `GET` | **L1 会话级** | 无 | `UserProfileDTO` (含 `reject_reason?`, `password_expires_at`) | **对 PENDING/REJECTED/DISABLED/ACTIVE 均返回 200 OK** |
| | `/api/v1/auth/password-policy` | `GET` | **L2 ACTIVE** | 无 | `PasswordPolicyDTO` | 个人密码过期策略与剩余有效期查询 (对已过期者豁免 L3) |
| | `/api/v1/auth/password-policy` | `PUT` | **L4 全体激活用户** | `{ passwordExpiresDays }` | `{ success: true, passwordExpiresDays }` | 更新个人密码有效期配置 (30~180天或null关闭) |
| **审批** | `/api/v1/approvals/pending` | `GET` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `?page=1&pageSize=20` | `Paginated<PendingApprovalDTO>` | `id` 全链路序列化为 `string` |
| | `/api/v1/approvals/:id/approve` | `POST` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `{ roleIds: string[] }` | `{ success: true }` | 同事务写 `sys_user_approvals`；低权禁止授超管 |
| | `/api/v1/approvals/:id/reject` | `POST` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `{ reason: string }` | `{ success: true }` | 状态置为 `REJECTED`，同事务写 `sys_user_approvals` |
| | `/api/v1/approvals/resubmit` | `POST` | **L1 仅 `REJECTED`** | `{ email, department, reason }` | `{ success: true }` | 状态由 `REJECTED` 原子流转回 `PENDING`，同事务写审计 |
| **用户** | `/api/v1/users` | `GET` | **L4** `SUPER_ADMIN` | `?page=1&pageSize=20&search=...` | `Paginated<UserListItemDTO>` | 动态计算 `is_last_super_admin` 布尔标记，`id` 为 `string` |
| | `/api/v1/users/:id/status` | `PUT` | **L4** `SUPER_ADMIN` | `{ status: 'ACTIVE' \| 'DISABLED' }` | `{ success: true }` | 本人保护 + `FOR UPDATE` 最后超管保护 + 同事务审计 + 同步墓碑断流 |
| | `/api/v1/users/:id/roles` | `PUT` | **L4** `SUPER_ADMIN` | `{ roleIds: string[], version: number }` | `{ success: true }` | 本人保护 + `FOR UPDATE` 最后超管保护 + 同事务审计 + 同步墓碑 |
| | `/api/v1/users/:id` | `DELETE` | **L4** `SUPER_ADMIN` | 无 | `{ success: true }` | 本人保护 + `FOR UPDATE` 最后超管保护 + 同事务审计 + 同步墓碑 |
| **PAT** | `/api/v1/pats` | `GET` | **L4 全体激活用户** | 无 | `PatListItemDTO[]` | 仅查询 `user_id = currentUser.id`，`id` 为 `string` |
| | `/api/v1/pats` | `POST` | **L4 全体激活用户** | `{ name, expiresDays }` | `{ pat: PatListItemDTO, rawToken: string }` | 256-bit CSPRNG，同事务写审计，仅本次响应返回 `rawToken` |
| | `/api/v1/pats/:id/revoke` | `POST` | **L4 全体激活用户** | 无 | `{ success: true }` | 同事务写审计；同步置位 `markPatRevokedSync` 并取消在途 SQL |
| **数据源** | `/api/v1/profiles` | `GET` | **L4** `SUPER_ADMIN` / `DBA` | 无 | `ProfileDTO[]` | 密码固定回显 `'******'`，携带 `version` |
| | `/api/v1/profiles/my-options` | `GET` | **L4 全体激活用户** | 无 | `ProfileOptionDTO[]` | 仅返回当前用户角色有权访问的 `{ id, name, displayName }` |
| | `/api/v1/profiles` | `POST` | **L4** `SUPER_ADMIN` / `DBA` | `CreateProfilePayload` | `{ id: string, version: 1 }` | AES-256-GCM 加密存储密码与 SSH 私钥，同事务写审计 |
| | `/api/v1/profiles/:id` | `PUT` | **L4** `SUPER_ADMIN` / `DBA` | `UpdateProfilePayload & { version }` | `{ success: true, version: number }` | 校验 `sys_profiles.version` (409)，递增 `generation` 热排空连接池 |
| | `/api/v1/profiles/:id` | `DELETE` | **L4** `SUPER_ADMIN` / `DBA` | 无 | `{ success: true }` | 检查 `sys_role_profiles` 依赖，有依赖抛 400 阻断 |
| | `/api/v1/profiles/test-db` | `POST` | **L4** `SUPER_ADMIN` / `DBA` | `{ profile_id?, host?, port?, user?, password?, database?, tls_config?, use_ssh?, ssh_host?, ssh_port?, ssh_user?, ssh_private_key?, ssh_host_fingerprint_sha256? }` | `{ reachable: boolean, latencyMs: number }` | 三模式 + 改 Host/Port 强制重填密码 + 自定义 `stream` IP Pinning + TLS `verifyIdentity` |
| | `/api/v1/profiles/test-ssh` | `POST` | **L4** `SUPER_ADMIN` / `DBA` | `{ profile_id?, host?, port?, username?, privateKey?, hostFingerprintSha256? }` | `{ reachable: boolean, latencyMs: number }` | 三模式 + 改 Host/Port 强制重填私钥 + SSRF IP Pinning + HostKey 指纹校验 |
| **策略** | `/api/v1/roles` | `GET/POST` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | POST: `{ role_name, display_name, description?, profileIds }` | `RoleDTO[]` / `{ id: string }` | 返回含 `version` 的角色列表 |
| | `/api/v1/roles/:id` | `PUT/DELETE`| **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ display_name?, description?, profileIds?, default_limit?, max_limit?, max_timeout_ms?, user_qpm_limit?, version }` | `{ success: true, version: number }` | 校验 `sys_roles.version` (409)；同事务写审计；同步递增 `globalPolicyVersion` |
| | `/api/v1/roles/:id/table-acls` | `GET/PUT` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ rules: TableAclRuleDTO[], version }` | `TableAclResponseDTO` / `{ success: true, version }` | 共享并递增父记录 `sys_roles.version` (409)；同事务写审计 |
| | `/api/v1/roles/:id/db-acls` | `GET/PUT` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ rules: DbAclRuleDTO[], version }` | `DbAclResponseDTO` / `{ success: true, version }` | 共享并递增父记录 `sys_roles.version` (409)；同事务写审计 |
| **限流** | `/api/v1/rate-limits/global` | `GET/PUT` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ defaultUserQuotaQpm, burstCapacity, agentLoopThreshold, agentLoopWindowSec, version }` | `GlobalRateLimitDTO` / `{ success: true, version }` | 校验 `sys_rate_limits.version` (`scope_type='GLOBAL'`) |
| | `/api/v1/rate-limits/users/:id` | `GET/PUT` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ userQuotaQpm, burstCapacity?, version }` | `UserRateLimitDTO` / `{ success: true, version }` | 校验 `sys_rate_limits.version` (`scope_type='USER'`) |
| **审计** | `/api/v1/audits` | `GET` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `?query_instance_id=...&status=...&profile=...&page=1` | `Paginated<AuditRecordDTO>` | 支持 `query_instance_id` 精确回补；`id` 为 `string` |
| | `/api/v1/audits/stats` | `GET` | **L4 全体激活用户** | `?profile_id=...&range=today` | `AdminDashboardStatsDTO \| DeveloperDashboardStatsDTO` | 服务端按调用者角色动态脱敏裁剪返回结构 |
| | `/api/v1/audits/export` | `POST` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `{ range, profile_id?, status? }` | `{ downloadUrl: string, count: number }` | 生成 5 分钟一次性 Ticket 供 `/audits/export/download` 流式下载 |
| **通知** | `/api/v1/settings/notifications`| `GET/PUT` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ channels: NotificationChannelDTO[], version }` | `NotificationSettingsDTO` / `{ success: true, version }` | 校验 `sys_system_settings.version` (409)，Webhook 密文存储 |
| | `/api/v1/settings/test-notify` | `POST` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `{ channelType, webhookUrl }` | `{ success: true, latencyMs: number }` | SSRF DNS 解析后校验 + `lookup` 锁定 IP + 禁 3xx 重定向 + 3s 硬超时 |
| | `/api/v1/users/:id/reset-password` | `POST` | **L4 SUPER_ADMIN + CSRF** | `{ newTemporaryPassword?, mustChangePassword?, version }` | `{ success, temporaryPassword, version }` | UserController / ResetPasswordPayload / UserService / UserRepository；CAS+同事务审计，提交后失效Session/PAT授权上下文并取消在途；409/密码策略错误 |
| | `/api/v1/rate-limits/users/:id` | `DELETE` | **L4 SUPER_ADMIN / SECURITY_ADMIN + CSRF** | `?revision=N`（N>0，兼容version） | `{ success: true }` | RateLimitController / DeleteUserRateLimitQuery / RateLimitService / RateLimitRepository；同锁序CAS+审计，保留counter；旧更新/删除409 |
| | `/api/v1/audits/export/download` | `GET` | **L4 SUPER_ADMIN / SECURITY_ADMIN + Ticket签名/归属/时效** | `?ticket=...` | `text/csv` 文件流 | AuditController / DownloadQuery / AuditExportService / AuditRepository + TicketStore；先CAS UNUSED→CONSUMING再发头/流，完成置CONSUMED；403 INVALID/EXPIRED/ALREADY_USED；断流不退回UNUSED |

---

### 11.2 四轮评审问题（`BE-R01 ~ R15`、`BE-R2-01 ~ R2-10`、`BE-R3-01 ~ R3-08`、`BE-R4-01 ~ R4-04`）整改与验证状态总表

> **验证状态分级定义**：
> - **本地探针与类型检查已验证 (Probe & Type-Check Verified)**：已通过本地灰盒探针与 TypeScript 5.9.3 编译器语义检查验证；
> - **静态核对通过 (Statically Verified)**：代码结构、事务边界与构造签名已完成静态对齐；
> - **待容器集成验收 (Pending Container Integration)**：需在真实 MySQL 8.0 / SSH 堡垒机 / TLS 证书容器环境中完成端到端集成测试。

| 评审编号 | 级别 | 问题描述摘要 | 整改章节与修复方案 | 当前验证状态 |
| :---: | :---: | :--- | :--- | :--- |
| **`BE-R4-01`** | **P1** | `ScopeExtractor` 对 AST 标识符调用 `.trim()`，改变了带前导空格的合法反引号表名（如 `` ` orders` ``、`` ` salary` ``）并使其误匹配同名 CTE | **§7.1 `ScopeExtractor`**：移除 `normalizeIdent` 中的 `.trim()`，完整保留 AST 解码后的原始标识符字符 | **本地探针已验证**（`r4_quoted_identifier_identity`、`r4_cte_name_must_not_shadow_different_physical_identifier` 与正向 CTE 对照全部通过） |
| **`BE-R4-02`** | **P1** | `replayEmergencyLogsToDb` 在读取文件后、MySQL 写入完成前若有新事件并发追加到同一 JSONL，末尾无条件 `unlink` 会误删新事件 | **§10.1 `AuditEngine.replayEmergencyLogsToDb`**：记录重放读取字节偏移量 `consumedByteLength`；完成写库后若文件有新增尾部字节，仅裁剪已消费头部并保留未消费尾部 | **本地探针已验证**（`r4_replay_must_not_delete_concurrent_append` 保留并发追加的 `r4-B`，`r4_sealed_file_replay_control` 无并发追加时正常 `unlink`） |
| **`BE-R4-03`** | **P2** | `SshTunnelManager.getOrCreateClient` 在建连前发生暂时性故障（如 DNS `EAI_AGAIN`）时未从 `activeClients` 淘汰拒绝的 Promise，导致无法自愈 | **§8.6 `SshTunnelManager`**：在最外层建连 Promise 挂载 `.catch` 条件淘汰逻辑，任何阶段失败均自动清理缓存条目 | **本地探针已验证**（`r4_ssh_transient_preconnect_failure_can_retry` 第二次调用自动重试并恢复成功） |
| **`BE-R4-04`** | **P2** | `RegistryHub.getActiveProfileConfigs()` 返回 `Array<Record<string, any>>` 与 `warmUpActiveProfiles` 入参类型不兼容，触发 `TS2345` | **§6.2 `RegistryHub`, §8.1 `PoolManager`**：统一使用显式结构化配置类型签名 | **本地探针与 TS 语义检查已验证**（`r4_bootstrap_config_signature_typechecks` 编译器诊断 `diagnostics.length === 0`） |
| **第 五 节 #1** | **加固** | `SnapshotBuilder` 的 ACL 行包含 `roleId`，原先仅按 `profileId` 过滤，依赖上游预先过滤角色 | **§6.2 `SnapshotBuilder.buildSnapshot`**：显式构造 `activeRoleIdSet` 并在内部同时过滤 `roleId` 与 `profileId` | **静态核对与探针回归通过** |
| **`BE-R3-01 ~ 08`**| **P1/P2**| 第三轮 8 项问题（反引号 `dual` 实表、强制 `rejectUnauthorized: true`、SSH 配置代际缓存、KILL 锁定原端口与强制租约、启动预热接线、版本底线解耦、停机等待高危与预留槽位、TLS 补丁零 cwd 依赖） | 详见各对应章节 | **本地探针已验证 (45/45)** + **待容器集成验收** |
| **`BE-R2-01 ~ 10`**| **P1/P2**| 第二轮 10 项问题（前导零 ID、方向隔离 Duplex、跨代际墓碑、TLS 流替换、限定 dual、SSH 目标校验与 hostVerifier、结果内存租约、Node 22 lookup） | 详见各对应章节 | **本地探针已验证 (27/27)** + **待容器集成验收** |
| **`BE-R01 ~ R15`**| **P1/P2**| 第一轮 15 项问题（AST 子查询、HTTP 断连、UNION LIMIT、小配额、UTF-8 裁剪、双写失败、高危强一致等） | 详见各对应章节 | **本地探针已验证 (15/15)** + **静态核对通过** + **待容器集成验收** |
---

### 11.3 前端 §8.3 后端协同清单（9 项）闭环对照表

| 协同项序号 | 前端详细设计诉求 (`FRONTEND_ARCHITECTURE_SPEC.md` §8.3) | 后端详细设计落地方案与代码锚点 | 闭环状态 |
| :---: | :--- | :--- | :---: |
| **#1** | `GET /api/v1/audits?query_instance_id=xxx` 单条精确回补 | 本规范 **§10.3**：`queryAuditLogs` 优先识别 `query_instance_id` 分支，直接命中二级索引 `idx_query_instance` | **设计已对齐 (待联调验收)** |
| **#2** | `test-db` / `test-ssh` 支持草稿模式复用密文密码与新参数测试 | 本规范 **§9.2**：`ProfileConnectivityService` 支持三模式解析 + 修改 Host/Port 强制重填密码 + 同契约 TLS/SSRF | **设计已对齐 (待联调验收)** |
| **#3** | `Profile`、`Role`、`ACL`、`RateLimit` 乐观锁 `version` 与 409 拦截 | 本规范 **§2.4 & §4.1 & §4.3**：主表显式定义 `version` 列（ACL 子表绑定父角色 `sys_roles.version`），CAS 失败抛 `409` | **设计已对齐 (待联调验收)** |
| **#4** | 库级 ACL 传 `DbAclRuleDTO[]` (`profile_id=0`, `database_name`, `effect`) | 本规范 **§4.4.2 & §6.2**：原子替换规则，`profile_id=0` 代表角色下全局生效，`DENY` 绝对优先于 `ALLOW` | **设计已对齐 (待联调验收)** |
| **#5** | 普通研发调用 `/audits/stats` 时自动脱敏裁剪为 `DeveloperDashboardStatsDTO` | 本规范 **§10.2**：根据 `req.currentUser.roles` 动态分支，普通研发仅聚合本人 `user_id` 指标与授权 Profile 配额 | **设计已对齐 (待联调验收)** |
| **#6** | `GET /api/v1/auth/csrf` 作为公开端点在各守卫前放行 | 本规范 **§5.4 & §5.5**：列入 `PUBLIC_PATHS` L0 白名单，并在 `preValidation` 实现零副作用校验 | **设计已对齐 (待联调验收)** |
| **#7** | 限流路由拆分为 `/rate-limits/global` 与 `/rate-limits/users/:id` | 本规范 **§11.1**：正式拆分为两个独立 RESTful 路由，分别映射 `scope_type='GLOBAL'` 与 `'USER'` | **设计已对齐 (待联调验收)** |
| **#8** | 超过 53 位的 `BIGINT` 实体 ID 强制序列化为 `string` | 本规范 **§3.3 & §4.2**：`bigNumberStrings: true` + 全链路 `EntityId = string`，禁止 `Number(id)` 转换 | **设计已对齐 (待联调验收)** |
| **#9** | 提供 `GET /api/v1/profiles/my-options` 返回脱敏轻量选项 | 本规范 **§11.1**：全体激活用户可访问，仅投影角色授权的 `{ id, name, displayName }` | **设计已对齐 (待联调验收)** |

---

### 11.4 后端工程自动化验收测试矩阵 (`TC-BE-01` ~ `TC-BE-18`)

| 用例编号 | 测试模块 | 验收测试场景与故障注入方式 | 预期断言结果 |
| :---: | :--- | :--- | :--- |
| **TC-BE-01** | `core-ast` | **CTE 同名掩盖与显式库名前缀防穿透**：`WITH salary AS (SELECT 1) SELECT * FROM finance.salary` | `ScopeExtractor` 准确提取物理表 `finance.salary`，命中黑名单返回 `403 ERR_AST_TABLE_DENIED`。 |
| **TC-BE-02** | `core-ast` | **表达式与 JOIN 条件子查询全覆盖 (`BE-R01`)**：测试 `WHERE EXISTS (SELECT 1 FROM secret_salary)`、`WHERE id IN (SELECT ...)`、`JOIN ... ON c.id = (SELECT ...)` | 三条语句 100% 提取出 `app.secret_salary`，绝不漏检。 |
| **TC-BE-03** | `core-ast` | **集合查询 `UNION` 分支与全局 `LIMIT` 识别 (`BE-R05`)**：测试 `(SELECT * FROM orders LIMIT 1) UNION ALL SELECT * FROM orders` 与末尾带全局 `LIMIT 1` | 首分支单侧 `LIMIT` 必抛 `ERR_AST_LIMIT_FAIL_CLOSED`；末尾无括号全局 `LIMIT <= maxLimit` 正常放行。 |
| **TC-BE-04** | `core-ast` | **系统字典库旁路刺探拦截**：执行 `SELECT table_name FROM information_schema.tables` | `AstValidator` 识别出 `information_schema` 系统库，直接阻断并返回 `403 ERR_AST_TABLE_DENIED`。 |
| **TC-BE-05** | `gateway` | **正常 POST 请求与客户端中途断连精确区分 (`BE-R02`)**：发送正常 POST 请求等待 50ms，随后中途销毁客户端 Socket | 正常请求处理期间 `abortSignal.aborted === false`；客户端销毁 Socket 后立即变为 `true`。 |
| **TC-BE-06** | `core-engine` | **低配额角色不被兜底默认值放大 (`BE-R06`)**：单角色配置 `{ defaultLimit: 5, maxLimit: 10, maxTimeoutMs: 1000, userQpmLimit: 2, maxInflightConcurrency: 1 }` | `SnapshotBuilder` 输出精确保持 `{ 5, 10, 1000, 2, 1 }`；空角色列表抛 `403 ERR_RBAC_FORBIDDEN`。 |
| **TC-BE-07** | `core-engine` | **业务池建连 SSRF IP Pinning 与 TLS `verifyIdentity` (`BE-R03/R04`)**：使用自定义 `stream` 工厂建连，注入错误域名证书与 DNS 重绑定 | `resolveAndValidateHost` 100% 被调用；`host` 保留原域名且 `ssl.verifyIdentity === true`，错误域名证书握手失败。 |
| **TC-BE-08** | `core-engine` | **业务连接池满载下同源取消慢查询防死锁**：将连接池占满执行慢查询，触发取消信号 | 独立 `AdminMaintenanceChannel` 复用原连接 `VerifiedTargetEndpoint`（含相同 `pinnedIp` 或 SSH 隧道），2s 内完成 KILL 与销毁。 |
| **TC-BE-09** | `core-engine` | **取消租约锁防完成竞态误归还**：查询进入 `CANCELING` 后 1ms 内恰好触发 `end` 事件 | `completeRunningQuery` 检测到 `__locked_for_cancellation === true` 立即放弃归还，连接仅由取消路径销毁。 |
| **TC-BE-10** | `core-engine` | **`conn.reset(cb)` 1500ms 挂死超时销毁**：Mock 底层 Socket 吞掉 `0x1F` 回包不响应 `OK_Packet` | 1500ms 定时器准时触发，执行 `conn.destroy()` 物理销毁套接字。 |
| **TC-BE-11** | `core-engine` | **UTF-8 64KB 单元格字节裁剪与四层内存预算 (`BE-R08/R14`)**：输入 40,000 个 `'汉'`（120KB）及 >5MB 流式结果 | 裁剪后单元格字节数严格 `<= 65,536` 且 `truncated === true`；超 16MB 原始流或超 25MB 用户并发预算立即熔断。 |
| **TC-BE-12** | `core-engine` | **排队期间 PAT 自然到期与同步墓碑二次鉴权 (`BE-R07`)**：排队期间冻结用户或 PAT 到期，且模拟 DB 重载失败 | `markUserInvalidatedSync` 墓碑同步生效，即使 DB 重载失败，`assertSnapshotValidBeforeExecutionSync` 依然 100% 阻断。 |
| **TC-BE-13** | `core-engine` | **审计双通道失败不丢批次与高危强一致落库 (`BE-R09/R10/R13`)**：注入 `DB_DOWN + ENOSPC`；测试高危事件挂起与失败 | 双败时 `queue.length === 1` 且 `totalUnflushedCount === 1`；高危挂起时计数为 `1`，高危 DB 失败时 `commit` 必 reject 抛错。 |
| **TC-BE-14** | `gateway` | **长连接/SSE 下无死锁优雅停机 (`BE-R11`)**：保持活跃长查询或 SSE 请求时触发停机流程 | 不阻塞在 `server.close()`，立即进入 `cancelAllRunningQueries` 终止在途请求并在预算时间内完成关闭。 |
| **TC-BE-15** | `shared-types`| **超 53 位 `BIGINT` 邻值隔离测试 (`BE-R12`)**：使用 `'9007199254740992'` 与 `'9007199254740993'` 执行并发限流与定向取消 | 两个 ID 在 `RegistryHub`、`InflightTracker`、`QueryLifecycleCoordinator` 中完全独立，零碰撞。 |
| **TC-BE-16** | `admin-api` | **四级守卫防死锁与 `/auth/me` 状态契约**：使用 `PENDING` 且 `must_change_password=1` 的账号访问 `/auth/me` 与 `/pats` | `/auth/me` 返回 `200 OK`；`/pats` 被 L2 `StatusGuard` 拦截返回 `403 ERR_AUTH_ACCOUNT_PENDING`。 |
| **TC-BE-17** | `admin-api` | **双超管并发互冻排他锁与同事务管理审计 (`BE-R10`)**：并发冻结仅有的 2 名超管；模拟管理审计 INSERT 失败 | `FOR UPDATE` 保证保留至少 1 名超管；管理审计 INSERT 失败时用户状态修改自动回滚。 |
| **TC-BE-18** | `security` | **连通性测试草稿模式防凭据外泄与 CSV 公式注入防护**：改 `host` 不重填密码；导出含 `=cmd|...` 的审计日志 | 立即抛 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`；导出的 CSV 单元格被安全转义为 `"'=cmd|..."`。 |

---

### 11.5 后端工程阶段实施路线图 (Phased Backend Roadmap)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        后端工程开发推进路线图 (Backend Roadmap)                         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P1: 公共安全内核与元数据库基座】 (周期: 1 周)                                    │
│ ├─ 初始化 pnpm Monorepo 与 packages/shared-types (全链路 EntityId=string 与 ErrorCode) │
│ ├─ 实现 packages/security (SsrfGuard, CryptoKeyring+轮转, Argon2Semaphore, Masker)    │
│ └─ 落地 14 张系统元数据表 DDL (含 version 乐观锁列)、MetadataPool 与 BootstrapService   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P2: SQL AST 防火墙与连接池核心引擎】 (周期: 1.5 周)                              │
│ ├─ 实现 packages/core-ast (全属性递归 ScopeExtractor, AstValidator, UNION LimitRewriter)│
│ ├─ 实现 packages/core-engine (带同步墓碑的 RegistryHub, InflightTracker, DualBucket)   │
│ └─ 实现自定义 stream 工厂 ManagedProfilePool、同源 AdminChannel、SshTunnel 与流式执行器│
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P3: 数据面网关与 11 项 MCP Tools 闭环】 (周期: 1 周)                             │
│ ├─ 实现 Streamable HTTP (精确断连绑定)、Legacy SSE 与 Stdio 协议适配器                  │
│ ├─ 串联 10 步防护流水线与借出瞬间六维同步二次鉴权核验                                  │
│ └─ 完成全部 11 项 MCP Tools 参数化查询、ACL 静默过滤与动态掩码集成测试                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P4: 管控面 REST API、分级审计与全量联调验收】 (周期: 1.5 周)                    │
│ ├─ 实现 Session Regeneration、preValidation CSRF、四级守卫与同事务强一致管理审计       │
│ ├─ 完成用户/审批/PAT/Profile三模式测试/Role-ACL乐观锁/限流拆分/通知全部 Controller     │
│ ├─ 落地 AuditEngine (无损槽位转移 + 双败回退队首 + 幂等重放)、角色裁剪大盘与 CSV 导出  │
│ └─ 跑通 TC-BE-01 ~ TC-BE-18 自动化测试矩阵，与 apps/admin-ui 完成端到端联调验收        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 附录：关联架构与规范文档索引

- **系统总体架构设计说明书**：[`docs/ARCHITECTURE_SPEC.md`](./ARCHITECTURE_SPEC.md)（v1.2.1）
- **Web 控制台前端实现架构详细设计说明书**：[`docs/FRONTEND_ARCHITECTURE_SPEC.md`](./FRONTEND_ARCHITECTURE_SPEC.md)（v1.4.0）
- **后端详细设计评审报告**：[`docs/reviews/BACKEND_DESIGN_REVIEW.md`](./reviews/BACKEND_DESIGN_REVIEW.md)
- **生产级闭环版需求规格说明书 (PRD)**：[`docs/REQUIREMENTS.md`](./REQUIREMENTS.md)（v2.3.0）
- **Web 控制台布局规范说明书**：[`docs/LAYOUT_SPEC.md`](./LAYOUT_SPEC.md)
- **Web UI 设计规范说明书**：[`docs/UI_DESIGN_SPEC.md`](./UI_DESIGN_SPEC.md)