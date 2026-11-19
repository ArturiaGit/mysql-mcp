# MySQL MCP Server 企业级网关与管控平台需求规格说明书 (PRD)

| 文档版本 | 创建日期 | 状态 | 系统架构 | 权限与网络模型 |
| :--- | :--- | :--- | :--- | :--- |
| **v2.3.0** | 2026-11-07 | **生产级闭环版 (Production-Ready)** | **中心化远程网关 (HTTP+SSE) + Web 管理控制台** | **注册审批流 + RBAC与表级ACL + 严格Fail-Closed只读 + 双重漏斗限流 + 全面SSRF防重绑定** |

---

## 一、项目定位与核心价值

随着大语言模型 (LLM/Agent) 在企业数据分析、研发协同中的深入应用，直接将单机版数据库 MCP 交给终端用户存在巨大的安全与管理黑洞：无法管控使用者身份、数据库账号密码易泄露、跨环境/跨库权限无控制、缺乏全局审计追踪，以及大模型可能因自我纠错陷入死循环拖垮底层数据库。

本项目定位为**企业级 MySQL-MCP 访问安全网关与管控平台（Enterprise MySQL-MCP Gateway & Portal）**：
- **服务端集中管控与逻辑 Session 隔离**：采用中心化远程架构，使用者无需接触底层密码，凭 256-bit 高熵个人访问令牌 (PAT) 接入，状态严格绑定在服务端逻辑 `McpSession` 上。
- **生命周期审批流与自举保护**：用户自主注册后经管理员审核激活；系统初建时超管凭据支持安全环境变量注入或随机自举，事务级硬保证系统内始终存在至少 1 个 ACTIVE 超管。
- **双重漏斗动态限流 (Dual-Bucket Rate Limiter)**：主体配额桶与 Profile 资源池保护桶取 `AND` 逻辑同时生效；支持防刷限流与 Agent 连续报错死循环熔断。
- **Fail-Closed 严格只读与 AST 深度防御**：不仅拦截 DDL/DML，严密拦截锁表语句 (`FOR UPDATE`)、延时注入 (`SLEEP`)、文件读取 (`LOAD_FILE`)；复杂 SQL 重写 LIMIT 失败时一律拒绝执行，杜绝裸查。
- **连接池无状态复位防串线**：归还物理连接时强制执行协议级 `COM_RESET_CONNECTION`，彻底清除会话变量、事务与临时表。
- **全方位 SSRF 防护体系**：覆盖 Webhook、MySQL、SSH 与 SMTP 连通性测试，实行 DNS 解析后校验（防 DNS 重绑定）与禁用 3xx 跳转。
- **分级审计与安全 Web 控制台**：高危拦截与管理操作强一致同步落库，普通查询背压异步归档；Web 控制台实行强安全基线（HTTPS、CSRF/CORS、Argon2id/bcrypt 密码哈希、防爆破锁定）。

---

## 二、系统总体架构与元数据存储

### 2.1 网关自身元数据存储体系
- **网关内部系统库**：网关服务自身采用独立的 **MySQL** 作为底层元数据存储（存储用户账号、角色权限策略、Profile 配置、PAT 摘要、审计流水、审批记录、多级限流规则等）。
- **敏感字段保护**：存储在系统 MySQL 中的数据源密码、SSH 私钥由服务端通过对称可逆加密算法（**AES-256-GCM**，主密钥通过环境变量注入）密文存储，Web 前端只允许重新录入，严禁回传明文。

### 2.2 系统架构拓扑
```
[MCP 客户端生态] (Claude Desktop / Codex / Dify / 自建 Agent)
        │
        ▼ 携带个人令牌 (Bearer mcp_pat_xxxx / ?token=mcp_pat_xxxx)
┌────────────────────────────────────────────────────────────────────────┐
│                   MySQL-MCP 集中式安全网关 (Gateway)                     │
│                                                                        │
│  [1. 鉴权、Session 管理与双重漏斗限流]                                   │
│       ├─ 逻辑 McpSession 绑定与生命周期隔离 (防跨客户端串线)             │
│       ├─ PAT 不可逆摘要常量时间比较 (HMAC-SHA-256)                      │
│       ├─ 账号生命周期状态检查 (仅 ACTIVE 放行，PENDING/DISABLED 拦截)      │
│       ├─ 双重漏斗限流计算: (用户桶 <= 配额) AND (Profile 资源桶 <= 阈值) │
│       └─ Agent 报错死循环智能熔断 (连续 N 次相同错误阻断)                │
│                                                                        │
│  [2. RBAC 细粒度权限校验与 AST 表级 ACL]                                 │
│       ├─ Profile 授权白名单检查                                         │
│       ├─ 递归 AST 解析: 别名、JOIN、子查询、CTE 提取全部物理表           │
│       ├─ 黑名单优先于白名单规则判定                                     │
│       └─ 动态配额约束 (Quota: 单次最大行数 / 最大超时时间)                 │
│                                                                        │
│  [3. SQL AST 安全与 Fail-Closed 只读内核]                                │
│       ├─ 封禁写操作 + 封禁锁表 (FOR UPDATE) + 封禁延时 (SLEEP/BENCHMARK) │
│       ├─ 拦截多语句 (;) 与 LOAD_FILE / INTO OUTFILE 磁盘操作             │
│       └─ LIMIT 注入失败时执行 Fail-Closed (拒绝执行，要求显式声明 LIMIT) │
│                                                                        │
│  [4. 运行时连接池治理与协议级状态复位]                                   │
│       ├─ 并发排队等待队列 (超时可配，防连接池打爆)                       │
│       ├─ 借出显式绑定 Context，归还强制 COM_RESET_CONNECTION 彻底复位    │
│       ├─ 直连连接池 (TCP + TLS/SSL)                                     │
│       └─ 原生 SSH 堡垒机/跳板机隧道转发 (VPC 内网穿透)                   │
│                                                                        │
│  [5. 分级审计流]                                                         │
│       ├─ 高危拦截、鉴权失败、管理员操作: 事务级强一致同步落库            │
│       └─ 正常只读查询: 有界内存队列异步批量写入 (带背压与脱敏)           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ SQL 转发与结果接收
                                    ▼
                         [企业业务 MySQL 数据库集群]
                   (生产只读从库 / 预发测试库 / 报表数仓)

==========================================================================

[使用者 / 管理员] ──────── 浏览器访问 ───────▶ [Web 管理控制台 (Admin Portal)]
  ├─ 初始自举：生产环境环境变量注入/随机凭据，首次登录强制改密
  ├─ 事务级保证至少 1 个 ACTIVE 超管 (严禁自残自杀)
  ├─ 用户自主注册 / 登录 (REJECTED 可重申，DISABLED 可解冻)
  ├─ 管理员审批 (企微/钉钉/飞书通知，全方位 SSRF 防 DNS 重绑定)
  ├─ 数据源 (Profiles) 可视化 CRUD & 一键连通性测试 (SSRF 拦截)
  ├─ SSH 堡垒机配置与隧道测试 (SSRF 拦截)
  ├─ 个人中心：PAT 生成 (仅展示一次)，一键复制客户端配置片段
  └─ 全局 SQL 审计大盘与高危拦截监控 (支持日志导出脱敏)
```

---

## 三、管控面与 Web 控制台规格 (Control Plane & Web Portal)

### 模块 1：账号生命周期、管理员自举与审批流

#### 1.1 初始管理员账号自举 (Bootstrap) 与安全约束
- **初始化凭据生成规则**：
  - **开发环境默认值**：用户名 `admin`，初始密码 `123456`（仅限非生产环境快速联调）。
  - **生产环境强制安全规范**：若环境变量 `INITIAL_ADMIN_PASSWORD` 存在，则初始化该密码；若未配置，系统首次启动时使用密码学安全随机数生成 16 位强密码并打印至控制台标准输出 (stdout)，严禁硬编码弱密码作为生产默认值。
- **首次强制改密机制**：
  - 标记字段 `must_change_password: true`。首次登录后前端路由强制拦截，必须重置密码。
  - 允许在改密弹窗中自定义管理员用户名/称号。
  - 密码哈希采用 **Argon2id**（或 bcrypt），严禁明文或简单哈希。
- **超级管理员自锁保护 (Super-Admin Protection)**：
  - 管理员严禁禁用或删除自己的账号。
  - 任何禁用、删除或降级操作，底层必须通过数据库事务行级排他锁校验：
    `SELECT COUNT(*) FROM users WHERE role = "SUPER_ADMIN" AND status = "ACTIVE" FOR UPDATE`；
    若活跃超级管理员数量 <= 1，操作一律强制拒绝，杜绝系统失控。

#### 1.2 账号状态机流转闭环 (State Machine Transitions)
- **`PENDING` (待审批)**：
  - 注册后初始状态；无法建立 MCP 握手，调用返回 `403 Forbidden: Account is pending administrator approval`。
- **`ACTIVE` (已激活)**：
  - 管理员审批通过并分配角色；正常使用 MCP 与 Web 控制台。
- **`REJECTED` (已拒绝)**：
  - 管理员驳回申请并记录驳回原因。
  - **闭环规则**：允许用户在 Web 端查看驳回理由，修改申请信息与部门说明后**重新提交审批**，状态流转回 `PENDING`。
- **`DISABLED` (已禁用/冻结)**：
  - 管理员手动冻结账号。
  - **闭环规则**：允许超级管理员随时对已禁用的账号执行**解冻恢复**，状态流转回 `ACTIVE`。

#### 1.3 审批事件通知集成与全方位 SSRF 防御
- **多渠道通知推送**：
  - 支持配置企业微信机器人、钉钉群机器人、飞书机器人 Webhook 或 SMTP 邮件。新用户申请注册时发送卡片通知，审批通过/驳回后邮件通知申请人。
- **【核心加固】服务端全场景 SSRF 深度防御规范**：
  - 适用场景：**Webhook 推送、MySQL 连通性测试、SSH 隧道测试、SMTP 连通性测试**。
  - **IP 黑名单**：严格封禁环回地址 (`127.0.0.0/8`, `::1`)、云厂商敏感元数据地址 (`169.254.169.254`)、私网链路本地地址 (`169.254.0.0/16`)。
  - **DNS 解析后校验（Post-DNS Resolution Check）**：必须先对目标域名进行 DNS 解析，获得全部实际 IP 后逐一进行黑名单过滤，**彻底防御 DNS 重绑定 (DNS Rebinding) 与十进制 IP/IPv4-mapped-IPv6 编码绕过**。
  - **协议与行为限制**：禁止跟随 HTTP 3xx 重定向；连接超时硬限制 2000ms，读取超时硬限制 3000ms。
  - **内网白名单管理**：若企业内部需要访问内网地址，必须由服务端管理员在安全环境配置文件中显式配置 `ALLOWED_OUTBOUND_IPS`，**前端或普通用户绝不可传参覆盖**。

---

### 模块 2：个人访问令牌体系 (Personal Access Token, PAT)

#### 2.1 令牌生成、存储与展示规范
- **生成标准**：使用密码学安全随机数生成 256-bit 高熵 Token，命名格式为 `mcp_pat_<32位随机安全字符串>`。
- **存储标准**：数据库**严禁存储 Token 明文**，仅存储不可逆摘要：`HMAC-SHA-256(server_secret, token)`（或独立盐的 SHA-256 哈希）。
- **比较标准**：鉴权校验时必须使用**常量时间比较 (Constant-Time Comparison)**，防御时序攻击。
- **单次可见性**：明文仅在创建成功时展示一次，用户关闭弹窗后无法再次查看，丢失只能撤销重签。
- **全链路脱敏**：任何系统日志、反向代理日志、审计表、错误堆栈中严禁出现完整 Token。

#### 2.2 传输协议与吊销 SLA
- **传输规范**：优先使用 Header `Authorization: Bearer <token>`；URL Query (`?token=xxx`) 仅作为客户端不支持 Header 时的兼容后备，网关层必须对请求 URL 强行打码后再输出日志。
- **吊销与断开 SLA (Revocation SLA)**：
  - 当用户在控制台手动撤销 PAT、修改密码，或管理员将账号置为 `DISABLED` 时：
  - **生效时效**：单机内存实时就地失效 (< 50ms)；分布式集群通过本地短 TTL (1~2s) 快照与广播失效协同，目标收敛时效 P99 < 1.5s。
  - **正在执行的 SQL**：加装取消租约锁，通过 Admin 专用通道向底层发送 `KILL QUERY <thread_id>`，排队中直接出队，杜绝并发误杀复用连接。
  - **连接清理与销毁 (Fail-Destroy)**：经历过取消的物理连接直接执行 `destroy()` 销毁套接字，拒绝任何潜在脏状态复用。

---

### 模块 3：会话状态管理与逻辑 Session 隔离 (McpSession Isolation)

- **请求自包含授权快照与会话解耦**：
  - 请求上下文与安全边界严格基于每次请求解析的不可变授权快照 (`RequestContextSnapshot`)，解耦物理传输连接；
  - 核心工具支持显式传入目标数据源与库名；`mcp-session-id` 作为向后兼容标识仅用于为无法显式传参的交互式遗留客户端维持交互偏好，不再作为唯一安全边界。
- **【核心加固】连接池协议级状态彻底复位 (COM_RESET_CONNECTION)**：
  - 从连接池借出连接时，按当前 Session 显式设定目标 Profile、database、字符集。
  - **归还时复位底线**：在归还连接池前，**严禁仅使用 `USE default_db`**，底层必须调用 MySQL 协议级重置指令 **`COM_RESET_CONNECTION`**（或驱动等效原语）。
  - **清理范围**：彻底清除用户自定义变量 (`@var`)、未提交事务、临时表、预处理语句 (Prepared Statements)、时区、字符集与会话级 SQL Mode。
  - **异常兜底**：无论查询成功、客户端中断、超时还是异常抛错，经历过取消或复位失败的连接坚决直接销毁 (Fail-Destroy)，正常结束的连接经官方驱动命令状态机确认后方可安全归还，彻底杜绝数据串线。

---

### 模块 4：Web 可视化管理控制台功能与安全基线

#### 4.1 管理端生产安全基线 (Web Security Baseline)
- 强制全站 HTTPS / TLS 通信；
- 认证 Cookie 强制设置 `HttpOnly; Secure; SameSite=Strict`；
- 启用严格的 CSRF Token 校验与 CORS 域名白名单控制；
- **防暴力破解机制**：同一 IP 或同一用户名连续登录失败 5 次，自动锁定账号 15 分钟，并在审计日志中产生告警。

#### 4.2 控制台功能清单
1. **工作台概览 (Dashboard)**：待审批提醒卡片、今日 MCP 调用总量、慢查统计、拦截高危数、Profile 活跃度。
2. **账号与审批中心**：待审批清单查看与审批/驳回（带理由）、用户列表管理、强制改密、启停账号。
3. **角色与权限策略 (RBAC Settings)**：定义角色模版，绑定 Profile 白名单、库表黑白名单与查询配额。
4. **安全与限流配置中心**：全局限流开关、全局 QPM、死循环熔断规则、连接池排队超时时间热调。
5. **数据源与 Profile 配置中心**：可视化 CRUD MySQL、TLS 证书上传、连通性测试（带 SSRF 拦截）、SSH 堡垒机配置与隧道测试（带 SSRF 拦截）。
6. **全链路 SQL 审计大盘 (Audit Trail)**：多维检索、高危拦截分析、耗时分布。
7. **用户端能力**：审批进度感知、PAT 生成与单次展示、一键复制 Claude Desktop / Codex 客户端配置片段、授权数据源查看、个人查询历史回溯。

---

## 四、安全护栏、动态防刷与高可用韧性 (Safety & Resilience)

### 模块 5：双重漏斗动态限流与 Agent 死循环熔断 (Dual-Bucket Rate Limiter)

#### 5.1 双重漏斗限流计算公式 (Dual-Bucket Calculation)
请求通过限流器必须**同时满足两个独立维度的约束 (取 AND 逻辑)**：
```
is_allowed = (user_current_qpm < effective_user_limit) AND (profile_current_qpm < profile_capacity_limit)
```
1. **主体配额桶 (User Bucket)**：
   - 优先级：`单个用户专属配置 > 所属角色配额模板 > 全局默认配额`。若用户属于多个角色，取配额最大者（宽松原则）。
   - 用户配额配置为 `-1` 时表示**豁免个人主体限流**。
2. **资源保护桶 (Profile Capacity Bucket)**：
   - 针对单个 Profile 实例配置全局承载上限（如重负载从库 `prod_readonly` 上限 300 QPM），所有访问该 Profile 的用户请求**统一共享此计数**。
   - **安全红线**：**任何用户的 `-1` 免限流配置绝不可穿透 Profile 资源池的保护上限**。
3. **超限信息脱敏返回**：
   - 用户主体超限时，返回：`"HTTP 429: User rate limit exceeded. Please slow down."`
   - Profile 资源池满载时，返回统一的通用提示：`"HTTP 429: Database resource pool is currently busy. Please retry later."`，**严禁向调用者泄露底层 Profile 的内部负载指标与系统拓扑**。

#### 5.2 Agent 报错死循环智能熔断 (Configurable Agent Loop Breaker)
- 在内存中以滑动窗口（默认 30 秒，范围 10~120 秒可调）追踪每个 Session 的执行流水。
- **熔断判定**：若检测到连续发起 N 次（默认 3 次，范围 2~10 次可调）相同或高度相似且均报错的 SQL，直接中断本次执行并熔断后续重试。
- **反馈内容**：`"Loop detected: Identical or repetitive failed query executed multiple times. Execution aborted to protect database resources. Please re-read the schema or rephrase your logic."`

### 模块 6：并发排队与连接池拥塞控制 (Wait Queue)
1. **连接池满载排队等待**：每个 Profile 设定最大连接数（默认 5~10，可调）。满载时进入网关排队队列。
2. **可配置排队超时 (Configurable Queue Timeout)**：
   - 默认最大排队等待时长为 `3000ms`（可调）。空闲连接释放立即接管。
   - 超时未获得连接时返回友好提示：`"Database connection pool is currently busy under high concurrency. Please retry in a few seconds."`。

### 模块 7：SQL AST 安全、Fail-Closed 只读与表级 ACL (Fail-Closed Read-Only Engine)

#### 7.1 严格只读白名单与高危指令全面封禁
系统不仅拦截传统的 DML/DDL/DCL，还在 AST 层强制封禁以下所有只读伪装指令：
1. **锁表与并发争抢指令**：严禁 `SELECT ... FOR UPDATE`、`LOCK IN SHARE MODE`、`FOR SHARE`。
2. **延时与拒绝服务 (DoS) 函数**：严禁 `SLEEP()`、`BENCHMARK()`、`GET_LOCK()`、`RELEASE_LOCK()`。
3. **文件读取与外联指令**：严禁 `LOAD_FILE()`、`INTO OUTFILE`、`INTO DUMPFILE`、`LOAD DATA`。
4. **会话状态与变量修改**：严禁 `SET @var = ...`、用户变量赋值语句。
5. **显式事务控制**：严禁 `START TRANSACTION`、`BEGIN`、`COMMIT`、`ROLLBACK`。

#### 7.2 库表 ACL 深度匹配规范
1. **黑白名单匹配原则**：**黑名单优先于白名单**（凡命中黑名单一律拒绝）。
2. **通配符支持**：支持如 `order_*`、`audit.log_*` 通配规则。
3. **AST 递归真实表名提取**：
   - SQL 解析器必须递归分析整棵语法树，穿透表别名 (Alias)、嵌套子查询 (Subquery)、多表 JOIN、CTE (`WITH ... AS`) 以及 `UNION / UNION ALL`；
   - 提取出查询所涉及的所有**底层真实物理表清单**，只要其中任何一张表命中用户黑名单或未在授权白名单内，直接阻断并返回：`"Access denied for table in query"`。

#### 7.3 LIMIT 注入之 Fail-Closed 原则 (Fail-Closed LIMIT Policy)
1. 对于缺少 LIMIT 的普通 SELECT，在 AST 外层注入用户角色的默认 LIMIT。
2. 若用户传入的 LIMIT 超过角色最大上限（如 1000 行），强制重写为该上限值。
3. **【核心安全底线】Fail-Closed 原则**：
   - 若遇到复杂嵌套子查询、聚合或复合 UNION 导致 AST 无法 100% 确保安全改写注入 LIMIT 时，**系统严禁裸放行执行**！
   - 系统必须**直接拒绝执行**并返回明确的指导性错误：
     `"Unable to safely inject LIMIT into complex SQL structure. Execution aborted. Please explicitly specify a LIMIT clause (<= max_limit) in your query."`。

---

## 五、MCP 数据执行内核与 Token 优化 (Data Engine & Token Economics)

### 模块 8：渐进式元数据感知与同实例多库 (Schema Discovery)
1. **`list_profiles`**：列出当前用户被授权访问的 Profile 列表（仅显示名称与说明，隐藏密码与私钥）。
2. **`switch_profile(profile_name)`**：在当前 McpSession 范围内平滑切换底层连接池（越权访问未授权 Profile 直接拒绝）。
3. **`get_current_context`**：获取当前用户身份、活跃 Profile、服务器 Host 及当前 Database。
4. **`list_databases`**：列出当前连接有权限访问的数据库列表。
5. **`use_database(database_name)`**：切换当前 McpSession 的工作库（受 Database ACL 校验）。
6. **`list_tables(pattern?, database?)`**：列出目标库的所有表及业务注释（`TABLE_COMMENT`），支持跨库指定，自动过滤无权限表。
7. **`describe_table(table_name, database?)`**：返回目标表的列名、类型、默认值、主外键、索引及**字段注释 (`COLUMN_COMMENT`)`**。
8. **`sample_table_data(table_name, ...)`**：数据样本抽取（默认 3~5 行），感知真实存储形态。
9. **`get_column_distinct_values(table_name, column_name, ...)`**：枚举/状态字段值域分布统计。
10. **逻辑/物理外键推断**：自动读取外键与命名习惯关联，辅助模型编写准确的 JOIN。

### 模块 9：紧凑序列化与 Token 优化
1. **`execute_query(sql, params?)`**：
   - 参数化执行，返回紧凑二维数组结构：`{"columns": [...], "rows": [[...], [...]]}`，去除重复 Key，降低 40%~60% Token 消耗。
   - 清洗 MySQL 错误码回传，使 Agent 具备自主反思修正 SQL 的能力。
2. **`explain_query(sql)`**：
   - 结构化提取执行计划核心瓶颈（`ALL` 全表扫描、索引命中、预估扫描行数、filesort 告警）。
3. **字段截断与数据脱敏**：
   - 超长文本（TEXT/BLOB/JSON > 256字符）自动截断并标注占位符。
   - 手机号、邮箱、身份证号内置动态掩码处理。

---

## 六、全链路分级审计与不可篡改保障 (Audit System)

### 模块 10：分级审计可靠性架构 (Tiered Audit Architecture)
1. **安全核心审计事件（同步强一致落库）**：
   - 包括：**高危 SQL 拦截、鉴权失败/无效 Token、PAT 撤销与签发、管理员审批与配置变更、SSRF 拦截事件**。
   - 必须通过本地事务**同步写入**系统 MySQL 审计表，写入成功后操作方可完成，保证安全审计零丢失。
2. **常规数据查询审计（有界队列异步写 + 背压保护）**：
   - 普通合法的只读 SQL、执行耗时、返回行数，放入网关内部有界内存队列批量异步落库。
   - **容量前置预留与背压**：请求执行前必须先申请并锁定审计队列槽位，队列利用率达 80% 触发背压减速，达 100% 暂停接收新请求。
   - **客观容灾边界说明**：正常停机通过 SIGTERM/SIGINT 优雅下刷；在操作系统极端强杀 (SIGKILL / OOM) 或物理断电场景下，未持久化 RingBuffer 存在丢失窗口，最大丢失量严格受限于队列容量上限 (<= 10,000条)。
3. **审计数据合规与脱敏**：
   - 审计日志中记录的 SQL 语句，若含有引号参数中的敏感字段，自动打码掩盖；
   - 审计日志保留时长支持配置（默认 180 天），提供分页只读检索与安全导出。

---

## 七、标准化 Tools 契约清单

| 工具名称 | 参数签名 | 核心职责与鉴权约束 |
| :--- | :--- | :--- |
| **`list_profiles`** | *无* | 列出当前用户**被授权**的环境与角色 Profile 清单 |
| **`switch_profile`** | `profile_name: string` | 动态切换当前 McpSession 的活跃连接池（越权访问直接拒绝） |
| **`get_current_context`** | *无* | 获取当前用户身份、活跃 Profile、服务器 Host 及当前 Database |
| **`list_databases`** | *无* | 列出当前连接有权限访问的数据库列表 |
| **`use_database`** | `database_name: string` | 切换当前 McpSession 的默认数据库（受 Database ACL 校验） |
| **`list_tables`** | `pattern?: string, database?: string` | 列出表名及表注释（自动过滤无权限表） |
| **`describe_table`** | `table_name: string, database?: string` | 查询字段定义、索引与字段注释（需具备目标表读取权限） |
| **`sample_table_data`** | `table_name: string, database?: string, limit?: number, columns?: string[]` | 采样抽取典型数据记录 |
| **`get_column_distinct_values`** | `table_name: string, column_name: string, database?: string, max_distinct?: number` | 统计枚举字段值域分布 |
| **`execute_query`** | `sql: string, params?: any[]` | 执行只读 SQL，通过 AST、Table ACL、双重漏斗限流、死循环熔断与 Fail-Closed LIMIT 校验 |
| **`explain_query`** | `sql: string` | 执行并结构化解析执行计划 |

---

## 八、验收标准与质量矩阵 (Acceptance Criteria & Test Matrix)

为确保系统可严格交付与验收，定义以下关键测试场景验收基线：

| 验收分类 | 验收测试场景 | 预期测试结果 / 交付标准 |
| :--- | :--- | :--- |
| **认证与PAT** | 1. 携带伪造/已撤销 PAT 调用 MCP<br>2. 撤销正在执行长 SQL 的 PAT | 1. 立即返回 401 Unauthorized。<br>2. 加装租约锁下发 `KILL QUERY` 并执行 Fail-Destroy 销毁连接，杜绝误杀下一请求。 |
| **只读与AST** | 1. 执行 `SELECT ... FOR UPDATE` 或 `SLEEP(5)`<br>2. 复杂多重 UNION 未显式声明 LIMIT | 1. AST 层直接拦截，返回 Read-Only Policy 拒绝信息。<br>2. 触发 Fail-Closed，拒绝执行并明确提示补齐 LIMIT。 |
| **表级 ACL** | 1. 使用别名或 CTE 隐式访问黑名单表 `salary` | 1. 递归 AST 穿透别名与 CTE，准确拦截并报 `Access denied for table salary`。 |
| **双重漏斗限流**| 1. 用户 QPM 超过个人阈值<br>2. 用户配额为 -1 但 Profile 资源池满载 | 1. 返回 HTTP 429 用户限流提示。<br>2. 返回通用资源繁忙提示，且不泄露 Profile 内部配额指标。 |
| **连接复位** | 1. 前一个请求设置 `@test_var=1` 或切换库后发生异常 | 1. 连接归还执行 `COM_RESET_CONNECTION`，下一个请求复用该连接时查不到任何残留变量与库状态。 |
| **SSRF 防御** | 1. Webhook 配置 `127.0.0.1` 或绑定指向 `169.254.169.254` 的域名 | 1. DNS 解析后校验拦截，禁止外联并同步产生高危审计记录。 |
| **超管保护** | 1. 并发请求同时禁用系统中仅有的最后 1 名超级管理员 | 1. 数据库事务行级排他锁校验生效，全部拦截并拒绝操作。 |
| **审计完整性** | 1. 触发高危 SQL 拦截或连通性测试 | 1. 强一致同步事务写入系统库，前置预留审计槽位，敏感字段严格脱敏。 |
