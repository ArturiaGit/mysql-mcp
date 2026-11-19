with open('scripts/contract_generators/gen_part9_10.py', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update 6.7.3 & 6.7.4 & 6.7.5 for monotonic revision anti-ABA
old_rate_sec = """#### 6.7.3 获取指定用户的专属限流配置
- **接口路径**：`GET /api/v1/rate-limits/users/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：获取指定用户的个性化配额覆盖配置。
- **继承态与版本语义**：
  - 若用户未配置个性化规则（继承全局基准）：返回 `isCustom: false`，`version: 0`，`userQuotaQpm: null`，`burstCapacity: null`；
  - 若已配置覆盖规则：返回 `isCustom: true`，`version: N`（N >= 1），以及实际配置的配额数值。
- **成功响应 (已配置自定义覆盖)**：`200 OK`
  ```json
  {
    "userId": "1001",
    "username": "zhangsan",
    "userQuotaQpm": 120,
    "burstCapacity": 20,
    "isCustom": true,
    "version": 1
  }
  ```
- **成功响应 (继承全局默认)**：`200 OK`
  ```json
  {
    "userId": "1002",
    "username": "lisi",
    "userQuotaQpm": null,
    "burstCapacity": null,
    "isCustom": false,
    "version": 0
  }
  ```

---

#### 6.7.4 配置或更新指定用户的专属限流配额
- **接口路径**：`PUT /api/v1/rate-limits/users/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：设置或更新用户的专属 QPM。
- **首次创建与并发版本契约**：
  - **首次从继承态创建自定义覆盖**：客户端必须传入 `version: 0`。服务端在事务内尝试 `INSERT INTO sys_rate_limits (scope_type='USER', scope_id=userId, version=1, ...)`；若并发冲突已存在记录，返回 `409 ERR_CONCURRENCY_CONFLICT`；
  - **更新已有的自定义覆盖**：客户端必须传入当前版本的 `version` (>= 1)。服务端原子 CAS 比较更新并递增 `version`；版本不匹配返回 `409 ERR_CONCURRENCY_CONFLICT`。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `userQuotaQpm` | `number` | 是 | 整数，`-1` 或 `1 <= val <= 10000` | 专属配额 (`-1` 为免限流) |
  | `burstCapacity` | `number` | 否 | 整数，`1 <= val <= 500` (默认 10) | 专属突发容量 |
  | `version` | `number` | 是 | 继承态传 `0`，已有覆盖传当前 `version` | 乐观锁版本前置条件 |
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 2
  }
  ```"""

new_rate_sec = """#### 6.7.3 获取指定用户的专属限流配置
- **接口路径**：`GET /api/v1/rate-limits/users/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：获取指定用户的个性化配额覆盖配置与终身单调代际版本号。
- **继承态与版本语义 (防 ABA 核心设计)**：
  - **继承态**：若用户未配置个性化规则（继承全局基准）：返回 `isCustom: false`，`revision: 0`，`version: 0`，`userQuotaQpm: null`，`burstCapacity: null`；
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
- **成功响应 (继承全局默认)**：`200 OK`
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
- **功能说明**：设置或更新用户的专属 QPM。
- **首次创建与并发版本 CAS 契约**：
  - **首次从继承态创建自定义覆盖**：客户端必须传入 `revision: 0` (或 `version: 0`)。服务端在事务内原子分配最新代际 `newRevision = COALESCE((SELECT MAX(revision) FROM sys_rate_limits WHERE scope_type='USER' AND scope_id=?), 0) + 1`，插入记录；若并发冲突已存在记录，返回 `409 ERR_CONCURRENCY_CONFLICT`；
  - **更新已有的自定义覆盖**：客户端必须传入当前版本的 `revision: N` (N >= 1)。服务端原子 CAS 比较更新：
    ```sql
    UPDATE sys_rate_limits 
    SET user_quota_qpm = ?, burst_capacity = ?, revision = revision + 1, version = version + 1 
    WHERE scope_type = 'USER' AND scope_id = ? AND revision = ?;
    ```
    若影响行数为 0，说明被他人修改或已被删除，立即回滚并返回 `409 ERR_CONCURRENCY_CONFLICT`。
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
  ```"""

text = text.replace(old_rate_sec, new_rate_sec)

# 2. Update 6.7.5 DELETE to require ?revision=N
old_del_sec = """- **并发 CAS 校验与防 ABA 机制**：
  - 客户端删除时必须在 Query 参数中携带当前读取到的版本号：`?version=N`；
  - 服务端执行条件删除：`DELETE FROM sys_rate_limits WHERE scope_type = 'USER' AND scope_id = ? AND version = ?`；若影响行数为 0，说明已被抢先更新，返回 `409 ERR_CONCURRENCY_CONFLICT`；
  - **防 ABA 机制**：`sys_rate_limits` 物理表由自增 ID 保证唯一记录代际；删除覆盖后若重新自定义，服务端插入全新自增记录，生成新代际版本号，杜绝版本号 ABA 覆盖风险。
- **请求头**：`x-csrf-token: <string>`
- **查询参数**：
  | 参数名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `version` | `number` | 是 | 当前覆盖配置的乐观锁版本号 (防并发误删) |"""

new_del_sec = """- **并发 CAS 校验与防 ABA 机制**：
  - 客户端删除时必须在 Query 参数中携带当前读取到的代际版本号：`?revision=N` (兼容 `?version=N`)；
  - 服务端执行条件删除：
    ```sql
    DELETE FROM sys_rate_limits 
    WHERE scope_type = 'USER' AND scope_id = ? AND revision = ?;
    ```
    若影响行数为 0，说明配置已被他人更新或已被提前删除，立即返回 `409 ERR_CONCURRENCY_CONFLICT`；
  - **终生单调代际彻底免疫 ABA**：删除后历史代际 `revision` 永久作废；当下一次重新为该用户创建自定义配置时，系统强制分配递增的新 `revision`（如 `N + 1`），持有旧版本 `N` 的任何并发修改或删除均因条件不匹配被原子拦截。
- **请求头**：`x-csrf-token: <string>`
- **查询参数**：
  | 参数名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `revision` | `number` | 是 | 当前覆盖配置的单调代际版本号 (防并发误删与 ABA 覆盖) |"""

text = text.replace(old_del_sec, new_del_sec)

# 3. Update 6.8.2 QPM Rate definitions & In-progress smooth formula
old_qpm_def = """  2. **分桶对齐与补零**：
     - `range='today'`：从今日 00:00:00 至当前时间，桶宽固定为 **10 分钟**；未产生调用的历史桶必须**强制补零 (`actual_qpm: 0`)**；正在流逝的当前桶按已产生的实际调用数上报；
     - `range='7d'`：过去连续 7 个已完成自然日加今日当前时间，桶宽固定为 **1 小时**；空桶补零；
     - `range='30d'`：过去连续 30 个已完成自然日加今日当前时间，桶宽固定为 **1 天**；空桶补零；"""

new_qpm_def = """  2. **时序 QPM 速率含义与分母精确定义**：
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
       示例：若当前 10 分钟桶刚流逝 30 秒内发生了 10 次调用，`elapsed_minutes` 兜底为 1 分钟，当前速率平滑输出为 `10.0` QPM，平滑反映当前业务吞吐。"""

text = text.replace(old_qpm_def, new_qpm_def)

# 4. Update 6.9.2 Notification payload schema with webhookUrl optional & secret string|null
old_notif_table = """  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `channels` | `NotificationChannelWriteItem[]` | 是 | 数组容量 1~3 条，渠道类型禁止重复 | 完整的通知渠道配置列表 |
  | `channels[].channelType` | `string` | 是 | 枚举: `'FEISHU'`, `'DINGTALK'`, `'WECHAT'` | 通知渠道标识 |
  | `channels[].enabled` | `boolean` | 是 | 布尔值 | 是否启用该渠道告警推送 |
  | `channels[].webhookUrl` | `string` | 是 | 最大 512 字符，含掩码时保留旧密文 | 机器人 Webhook URL |
  | `channels[].secret` | `string` | 否 | 传空串清空；传掩码/null保留；传新值覆盖 | 机器人签名密钥 |
  | `channels[].alertEvents` | `string[]` | 是 | 有效事件枚举数组 | 订阅告警类别 (如 `HIGH_RISK_AST`) |
  | `version` | `number` | 是 | 必须等于当前读取到的全局设置版本号 | 乐观锁版本前置条件 |"""

new_notif_table = """  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `channels` | `NotificationChannelWriteItem[]` | 是 | 数组容量 1~3 条，渠道类型禁止重复 | 增量合并更新的通知渠道列表 |
  | `channels[].channelType` | `string` | 是 | 枚举: `'FEISHU'`, `'DINGTALK'`, `'WECHAT'` | 通知渠道标识 |
  | `channels[].enabled` | `boolean` | 是 | 布尔值 | 是否启用该渠道告警推送 |
  | `channels[].webhookUrl` | `string` | **否** | 最大 512 字符；缺省或含掩码时保留已存原值 | 机器人 Webhook URL |
  | `channels[].secret` | `string \| null` | **否** | 传 `null` 或 `"******"` 保留原密钥；传 `""` 物理清空；传新值覆盖 | 机器人签名密钥 |
  | `channels[].alertEvents` | `string[]` | 是 | 有效事件枚举数组 | 订阅告警类别 (如 `HIGH_RISK_AST`) |
  | `version` | `number` | 是 | 必须等于当前读取到的全局设置版本号 | 乐观锁版本前置条件 |

- **未提交渠道的确定性增量合并语义**：
  更新采用**按 `channelType` 增量合并 (Partial Patch by channelType)**。客户端仅需提交发生配置变更的渠道；未在 `channels` 数组中提交的渠道类型，服务端**保持原配置与启用状态不变**；若提交全部 3 个渠道则全量覆盖。"""

text = text.replace(old_notif_table, new_notif_table)

# 5. Append TC-INT-28 ~ TC-INT-32 in part10 test matrix
old_tc_matrix = """| **TC-INT-26** | 密码有效期配置更新 | `PUT /auth/password-policy` 设为 60 天 | `200` | - | 更新成功，重新计算过期时间点，返回最新剩余天数 |
| **TC-INT-27** | 关闭密码过期风险提醒拦截 | 尝试设置 `passwordExpiresDays: null` | `200` | - | 前端必须弹窗高风险警示对话框，用户确认后提交成功，服务端审计记录 |"""

new_tc_matrix = """| **TC-INT-26** | 密码有效期配置更新 | `PUT /auth/password-policy` 设为 60 天 | `200` | - | 更新成功，重新计算过期时间点，返回最新剩余天数 |
| **TC-INT-27** | 关闭密码过期风险提醒拦截 | 尝试设置 `passwordExpiresDays: null` | `200` | - | 前端必须弹窗高风险警示对话框，用户确认后提交成功，服务端审计记录 |
| **TC-INT-28** | 限流删除重建防 ABA 校验 | A读取版本1，B删除重建分配版本2，A提交旧版本1 | `409` | `ERR_CONCURRENCY_CONFLICT` | 单调代际前置条件拦截，杜绝版本号 ABA 覆盖更新 |
| **TC-INT-29** | 审计 Ticket 并发原子预占 | 两个并发请求携带同一 Ticket 请求下载 | `403` | `ERR_TICKET_ALREADY_USED` | 首个请求 CAS 预占成功下载，第二个请求未发流直接被 403 阻断 |
| **TC-INT-30** | SSH/TLS 信任边界变更防外泄 | 数据源主机未变，但切换 `use_ssh=true` 且未填密码 | `400` | `ERR_CREDENTIAL_REENTRY_REQUIRED` | 信任边界发生变更，强制必须重新输入密码，防止凭据外泄 |
| **TC-INT-31** | 双栈 IPv6 ULA / 映射地址拦截 | 目标域名解析出 `fc00::1` 或 `::ffff:127.0.0.1` | `403` | `ERR_SSRF_PROHIBITED` | 双栈 DNS 全量解析核验，Fail-Closed 立即拦截私网出站 |
| **TC-INT-32** | 时序 QPM 速率与未完成桶折算 | 请求带 `timezone`，10分钟桶发生120次调用 | `200` | - | 正确输出速率 `12.0` QPM；未完成当前桶平滑折算，历史空桶补零 `0.0` |"""

text = text.replace(old_tc_matrix, new_tc_matrix)

with open('scripts/contract_generators/gen_part9_10.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated gen_part9_10.py with ABA protection, QPM formula, notifications payload, and TC-INT-28..32")
