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