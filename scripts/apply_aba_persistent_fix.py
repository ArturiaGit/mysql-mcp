with open('scripts/contract_generators/gen_part9_10.py', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace the rate limit create rule in 6.7.4
old_create_cas = """- **首次创建与并发版本 CAS 契约**：
  - **首次从继承态创建自定义覆盖**：客户端必须传入 `revision: 0` (或 `version: 0`)。服务端在事务内原子分配最新代际 `newRevision = COALESCE((SELECT MAX(revision) FROM sys_rate_limits WHERE scope_type='USER' AND scope_id=?), 0) + 1`，插入记录；若并发冲突已存在记录，返回 `409 ERR_CONCURRENCY_CONFLICT`；
  - **更新已有的自定义覆盖**：客户端必须传入当前版本的 `revision: N` (N >= 1)。服务端原子 CAS 比较更新：
    ```sql
    UPDATE sys_rate_limits 
    SET user_quota_qpm = ?, burst_capacity = ?, revision = revision + 1, version = version + 1 
    WHERE scope_type = 'USER' AND scope_id = ? AND revision = ?;
    ```
    若影响行数为 0，说明被他人修改或已被删除，立即回滚并返回 `409 ERR_CONCURRENCY_CONFLICT`。"""

new_create_cas = """- **首次创建与并发版本 CAS 契约 (持久化单调代际计数器)**：
  - **持久化单调代际计数器机制 (`sys_rate_limit_revisions`)**：
    为防止配置删除后历史代际丢失导致版本号被重置为 1（引发 ABA 覆盖），系统在元数据库中通过独立的持久化代际计数器表维护用户的终身单调代际，**该计数器绝不随配置记录的删除而丢失或重置**：
    ```sql
    -- 原子获取并递增该用户的终身单调代际号
    INSERT INTO sys_rate_limit_revisions (scope_type, scope_id, last_revision)
    VALUES ('USER', ?, 1)
    ON DUPLICATE KEY UPDATE last_revision = last_revision + 1;

    -- 获取本次创建分配的权威代际 newRevision
    SELECT last_revision FROM sys_rate_limit_revisions 
    WHERE scope_type = 'USER' AND scope_id = ?;
    ```
  - **首次从继承态创建自定义覆盖**：客户端必须传入 `revision: 0` (或 `version: 0`)。服务端在事务内原子获取 `newRevision`（保证严格大于该用户历次分配过的所有 revision），向 `sys_rate_limits` 插入记录；若并发冲突已存在记录，立即回滚并返回 `409 ERR_CONCURRENCY_CONFLICT`；
  - **更新已有的自定义覆盖**：客户端必须传入当前版本的 `revision: N` (N >= 1)。服务端原子 CAS 比较更新：
    ```sql
    UPDATE sys_rate_limits 
    SET user_quota_qpm = ?, burst_capacity = ?, revision = revision + 1, version = version + 1 
    WHERE scope_type = 'USER' AND scope_id = ? AND revision = ?;
    ```
    若影响行数为 0，说明被他人修改或已被删除，立即回滚并返回 `409 ERR_CONCURRENCY_CONFLICT`。"""

text = text.replace(old_create_cas, new_create_cas)

# Replace the delete explanation in 6.7.5
old_del_aba = """  - **终生单调代际彻底免疫 ABA**：删除后历史代际 `revision` 永久作废；当下一次重新为该用户创建自定义配置时，系统强制分配递增的新 `revision`（如 `N + 1`），持有旧版本 `N` 的任何并发修改或删除均因条件不匹配被原子拦截。"""

new_del_aba = """  - **持久化计数器彻底免疫 ABA**：删除操作仅清除 `sys_rate_limits` 业务行以恢复继承全局默认，**持久化计数器 `sys_rate_limit_revisions` 的 `last_revision` 保持不变**。当下一次重新为该用户创建自定义配置时，系统原子分配 `last_revision + 1`（例如从 1 递增至 2），因此新记录的 `revision` 严格单调递增，持有旧版本 `1` 的任何迟到更新或删除请求均因 `WHERE revision = 1` 匹配 0 行而被安全阻断（409），彻底消灭 ABA 静默覆盖与误删漏洞。"""

text = text.replace(old_del_aba, new_del_aba)

# Update TC-INT-28
old_tc28 = """| **TC-INT-28** | 限流删除重建防 ABA 校验 | A读取版本1，B删除重建分配版本2，A提交旧版本1 | `409` | `ERR_CONCURRENCY_CONFLICT` | 单调代际前置条件拦截，杜绝版本号 ABA 覆盖更新 |"""
new_tc28 = """| **TC-INT-28** | 限流删除重建防 ABA 校验 | A读取版本1，B删除后重新创建分配版本2，A提交旧版本1 | `409` | `ERR_CONCURRENCY_CONFLICT` | 持久化计数器分配新版本2，A的旧版本1更新被CAS原子拦截，杜绝ABA覆盖 |"""
text = text.replace(old_tc28, new_tc28)

with open('scripts/contract_generators/gen_part9_10.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated gen_part9_10.py with sys_rate_limit_revisions persistent counter")
