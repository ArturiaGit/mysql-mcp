with open('scripts/contract_generators/gen_part9_10.py', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update 6.7.5 DELETE /rate-limits/users/:id to require version
old_del_sec = """#### 6.7.5 恢复指定用户继承全局默认限流 (移除自定义覆盖)
- **接口路径**：`DELETE /api/v1/rate-limits/users/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：删除指定用户的个性化配额覆盖记录，恢复为继承全局默认限流规则。后续全局限流变更将对该用户自动联动生效。
- **幂等性与前置条件**：若该用户已处于继承态（记录已不存在），直接返回成功。
- **请求头**：`x-csrf-token: <string>`
- **请求入参**：*(无请求体)*"""

new_del_sec = """#### 6.7.5 恢复指定用户继承全局默认限流 (移除自定义覆盖与防 ABA 并发控制)
- **接口路径**：`DELETE /api/v1/rate-limits/users/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：删除指定用户的个性化配额覆盖记录，恢复为继承全局默认限流规则。后续全局限流变更将对该用户自动联动生效。
- **并发 CAS 校验与防 ABA 机制**：
  - 客户端删除时必须在 Query 参数中携带当前读取到的版本号：`?version=N`；
  - 服务端执行条件删除：`DELETE FROM sys_rate_limits WHERE scope_type = 'USER' AND scope_id = ? AND version = ?`；若影响行数为 0，说明已被抢先更新，返回 `409 ERR_CONCURRENCY_CONFLICT`；
  - **防 ABA 机制**：`sys_rate_limits` 物理表由自增 ID 保证唯一记录代际；删除覆盖后若重新自定义，服务端插入全新自增记录，生成新代际版本号，杜绝版本号 ABA 覆盖风险。
- **请求头**：`x-csrf-token: <string>`
- **查询参数**：
  | 参数名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `version` | `number` | 是 | 当前覆盖配置的乐观锁版本号 (防并发误删) |"""

text = text.replace(old_del_sec, new_del_sec)

# 2. Update 6.8.2 Dashboard with timezone and formula definitions
old_stats_query = """- **查询参数**：
  | 参数名 | 类型 | 必填 | 默认值 | 描述 |
  | :--- | :---: | :---: | :---: | :--- |
  | `profile_id` | `string` | 否 | - | 指定数据源过滤 (缺省为聚合所有授权数据源) |
  | `range` | `string` | 否 | `"today"` | 时间跨度: `"today"`, `"7d"`, `"30d"` |"""

new_stats_query = """- **查询参数**：
  | 参数名 | 类型 | 必填 | 默认值 | 描述 |
  | :--- | :---: | :---: | :---: | :--- |
  | `profile_id` | `string` | 否 | - | 指定数据源过滤 (缺省为聚合所有授权数据源) |
  | `range` | `string` | 否 | `"today"` | 时间跨度: `"today"`, `"7d"`, `"30d"` |
  | `timezone` | `string` | 否 | `"Asia/Shanghai"` | 客户端 IANA 时区标识 (如 `Asia/Shanghai`, `UTC`)，确定日界线 |

- **指标统计口径与计算公式规范**：
  1. **日界线划分**：以传入的 `timezone`（缺省为租户默认时区 `Asia/Shanghai`）零点（`00:00:00.000`）为起止点计算自然日；
  2. **分桶对齐与补零**：
     - `range='today'`：从今日 00:00:00 至当前时间，桶宽固定为 **10 分钟**；未产生调用的历史桶必须**强制补零 (`actual_qpm: 0`)**；正在流逝的当前桶按已产生的实际调用数上报；
     - `range='7d'`：过去连续 7 个已完成自然日加今日当前时间，桶宽固定为 **1 小时**；空桶补零；
     - `range='30d'`：过去连续 30 个已完成自然日加今日当前时间，桶宽固定为 **1 天**；空桶补零；
  3. **实时 QPM (`current_qpm`)**：定义为最近 1 分钟滑动窗口 (`[now - 60s, now]`) 内执行的 SQL 查询总次数；
  4. **日同比调用增长率 (`total_calls_growth_pct`)**：
     公式：`((calls_today - calls_yesterday_same_period) / Math.max(1, calls_yesterday_same_period)) * 100`，保留 1 位小数。
     若昨日同时段调用量为 0，当 `calls_today > 0` 时恒定返回 `+100.0%`；若两者皆为 0 返回 `0.0%`。"""

text = text.replace(old_stats_query, new_stats_query)

# 3. Update 6.8.4 Ticket Atomic Consumption & Server restart behavior
old_ticket_rule = """- **Ticket 单次消费语义**：Ticket 成功开始流式下载后立即在内存标记销毁，防止链接二次复用。"""
new_ticket_rule = """- **Ticket CAS 原子消费与防重放机制**：
  - **原子预占先于响应**：在服务端向 HTTP 连接发送任何响应头（200 OK）或写入首个 CSV 数据块之前，必须在内存原子比对并翻转状态：`CAS state from UNUSED to CONSUMING`；
  - 若 CAS 失败（Ticket 处于 `CONSUMING` 或 `CONSUMED`），服务端**绝不建立 CSV 流**，立即直接响应 `403 ERR_TICKET_ALREADY_USED`，从根源杜绝多线程并发重复拉取；流式发送完毕后状态置为 `CONSUMED`；
  - **单节点进程重启行为定义**：下载凭证为内存态 5 分钟短效 Ticket。若网关节点发生重启或故障转移，旧 Ticket 自动失效，客户端请求将收到 `403 ERR_INVALID_TICKET` 或 `403 ERR_TICKET_EXPIRED`，前端捕获后引导管理员重新点击【导出】生成全新凭证。"""

text = text.replace(old_ticket_rule, new_ticket_rule)

# 4. Update 6.9.2 Notification payload schema with strict validation
old_notif_payload = """  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `channels` | `NotificationChannelDTO[]` | 是 | 完整的通知渠道列表 |
  | `version` | `number` | 是 | 乐观锁版本号 |"""

new_notif_payload = """  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `channels` | `NotificationChannelWriteItem[]` | 是 | 数组容量 1~3 条，渠道类型禁止重复 | 完整的通知渠道配置列表 |
  | `channels[].channelType` | `string` | 是 | 枚举: `'FEISHU'`, `'DINGTALK'`, `'WECHAT'` | 通知渠道标识 |
  | `channels[].enabled` | `boolean` | 是 | 布尔值 | 是否启用该渠道告警推送 |
  | `channels[].webhookUrl` | `string` | 是 | 最大 512 字符，含掩码时保留旧密文 | 机器人 Webhook URL |
  | `channels[].secret` | `string` | 否 | 传空串清空；传掩码/null保留；传新值覆盖 | 机器人签名密钥 |
  | `channels[].alertEvents` | `string[]` | 是 | 有效事件枚举数组 | 订阅告警类别 (如 `HIGH_RISK_AST`) |
  | `version` | `number` | 是 | 必须等于当前读取到的全局设置版本号 | 乐观锁版本前置条件 |"""

text = text.replace(old_notif_payload, new_notif_payload)

with open('scripts/contract_generators/gen_part9_10.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated gen_part9_10.py")
