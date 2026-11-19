## 第五章：数据模型与系统元数据库设计

### 5.1 实体关系模型 (ER Diagram)

```
  ┌──────────────────┐               ┌───────────────────────┐
  │    sys_users     │ 1           N │   sys_user_approvals  │
  ├──────────────────┼───────────────┼───────────────────────┤
  │ id (PK)          │               │ id (PK)               │
  │ username         │               │ user_id (FK)          │
  │ password_hash    │               │ action                │
  │ status           │               │ reason                │
  │ must_change_password │               │ operator_id (FK)      │
  └────────┬─────────┘               └───────────────────────┘
           │ 1
           ├───────────────────────────────┐
           │ N                             │ N
  ┌────────┴─────────┐            ┌────────┴───────────────┐
  │     sys_pats     │            │     sys_user_roles     │ (多角色关联表)
  ├──────────────────┤            ├────────────────────────┤
  │ id (PK)          │            │ user_id (FK)           │
  │ user_id (FK)     │            │ role_id (FK)           │
  │ token_prefix     │            └────────┬───────────────┘
  │ token_hash       │                     │ N
  │ revoked_at       │                     │ 1
  └──────────────────┘            ┌────────┴───────────────┐
                                  │       sys_roles        │
                                  ├────────────────────────┤
                                  │ id (PK)                │
                                  │ role_name              │
                                  │ default_limit          │
                                  │ max_limit, timeout_ms  │
                                  └────────┬───────────────┘
                                           │ 1
                 ┌─────────────────────────┼─────────────────────────┐
                 │ N                       │ N                       │ N
  ┌──────────────┴───────┐  ┌──────────────┴───────┐  ┌──────────────┴───────┐
  │  sys_role_profiles   │  │  sys_role_table_acls │  │sys_role_database_acls│
  ├──────────────────────┤  ├──────────────────────┤  ├──────────────────────┤
  │ role_id (FK)         │  │ role_id (FK)         │  │ role_id (FK)         │
  │ profile_id (FK)      │  │ profile_id (FK)      │  │ profile_id (FK)      │
  └──────────────┬───────┘  │ rule_type (B/W)      │  │ database_name        │
                 │ N        │ table_pattern        │  │ is_allowed (1/0)     │
                 │ 1        └──────────────────────┘  └──────────────────────┘
  ┌──────────────┴───────┐
  │     sys_profiles     │
  ├──────────────────────┤
  │ id (PK)              │
  │ name, display_name   │
  │ host, port, username │
  │ password_encrypted   │
  │ max_pool_size        │
  │ profile_capacity_qpm │
  └──────────────────────┘

  ┌──────────────────────────────────────────────┐  ┌──────────────────────────────────────┐
  │               sys_audit_logs                 │  │     sys_anonymous_security_logs      │
  ├──────────────────────────────────────────────┤  ├──────────────────────────────────────┤
  │ id (PK), query_instance_id, session_id       │  │ id (PK), client_ip, request_path     │
  │ user_id, username, profile_id, database_name │  │ event_type (AUTH_FAIL, SSRF_BLOCKED) │
  │ sql_text, status, latency_ms, rows_affected  │  │ details (JSON), created_at           │
  │ created_at (PARTITIONED BY MONTH RANGE)      │  └──────────────────────────────────────┘
  └──────────────────────────────────────────────┘
```

---

### 5.2 物理 Schema 唯一入口（MySQL 8.0）

唯一可执行空库脚本为 `docs/sql/001_metadata_schema.sql`，完整列字典、14表/外键/索引/UTC毫秒与迁移约束见 `DATABASE_DESIGN_SPEC.md`。
本章 §5.1 是概念关系图，不是物理 FK 清单（审批和审计历史不设用户 FK）。旧版内嵌 SQL 已移除，不得用于建库；历史评审中的 SQL 仅用于重现当时问题。
后端 Repository 以同一脚本及数据库 §7 的事务/锁序为准，不维护第二套 DDL。

---

### 5.3 敏感信息对称可逆加密方案 (带 key_id 的密钥环)

#### 5.3.1 密文标准格式
```
v1:<key_id>:<12字节 IV 十六进制>:<密文十六进制>:<16字节 Auth Tag 十六进制>
```
- **格式版本** (`v1`)：标识加密算法为 AES-256-GCM；
- **密钥标识符** (`key_id`)：支持**密钥环 (Keyring)** 管理。解密时根据 `key_id` 索引对应密钥，更新时统一使用当前活跃密钥，实现无感平滑轮转。

---

### 5.4 多角色冲突判定决策表与库表 ACL 继承规则

当一个用户被同时授予多个角色（如同时具有 `ANALYST` 和 `DATA_ENGINEER`）时，网关在生成 `RequestContextSnapshot` 时执行以下确定性合并规则：

| 授权维度 | 合并冲突决策算法 | 规则说明与安全边界 |
| :--- | :--- | :--- |
| **单次查询最大行数 (`max_limit`)** | $\max(\text{role}_1.\text{max\_limit}, \dots)$ | **宽松原则**：取所有角色中的最大值。 |
| **默认注入行数 (`default_limit`)** | $\max(\text{role}_1.\text{default\_limit}, \dots)$ | **宽松原则**：取所有角色中的最大值。 |
| **单次执行超时 (`max_timeout_ms`)**| $\max(\text{role}_1.\text{max\_timeout}, \dots)$ | **宽松原则**：取所有角色中的最大值。 |
| **主体 QPM 配额 (`user_qpm_limit`)**| $\max(\text{role}_1.\text{qpm}, \dots)$ | **宽松原则**：若任一角色为 -1，则用户主体整体为 -1 (免主体限流)。 |
| **在途并发上限 (`max_inflight`)** | $\max(\text{role}_1.\text{inflight}, \dots)$ | **宽松原则**：取所有角色中的最大在途并发度。 |
| **数据库级 ACL (`Database ACL`)** | **黑名单优先，白名单并集** | 检查查询涉及的**每一个数据库**（不只默认库）。若任一库命中任一角色的 `is_allowed=0` 则直接拒绝；否则要求该库至少命中一个角色的 `is_allowed=1`。 |
| **表级 ACL (`Table ACL`)** | **黑名单优先，白名单并集，Default Deny** | 所有角色的表黑名单取并集，命中任意一张即拒绝；所有角色的白名单取并集，必须命中白名单；未命中一律拒绝 (Default Deny)。 |

