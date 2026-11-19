-- MySQL MCP 元数据库设计 v1.0.2 | 2026-11-12
-- 全新空库参考DDL，非存量升级脚本。仅操作调用者已明确选定的元数据库。
-- 要求MySQL 8.0.16+以执行CHECK；精确部署版本须在集成环境验证。
-- 必须先指定目标数据库；禁止在业务数据源执行。没有DROP/禁用外键操作。
-- 运行前确认严格SQL模式；所有运行时连接同样必须使用UTC。
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET SESSION time_zone = '+00:00';

-- 1. 用户账号主表 (含 auth_version 持久化授权版本号)
CREATE TABLE `sys_users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户唯一自增主键 (全链路序列化为string)',
  `username` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '登录账号；ASCII、不区分大小写唯一',
  `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希 (Argon2id)',
  `email` VARCHAR(128) DEFAULT NULL COMMENT '电子邮箱 (允许NULL)',
  `department` VARCHAR(128) DEFAULT NULL COMMENT '所属部门/业务线',
  `apply_reason` VARCHAR(512) DEFAULT NULL COMMENT '注册或重提申请理由',
  `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING' COMMENT '状态: PENDING, ACTIVE, REJECTED, DISABLED',
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否强制改密: 1-是(仅对ACTIVE拦截), 0-否',
  `password_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '密码最后修改时间',
  `password_expires_days` INT DEFAULT 90 COMMENT '密码有效期天数 (30-180，NULL表示永不过期)',
  `auth_version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '用户授权版本号(改密/冻结/改角色时+1)',
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',
  `failed_login_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '连续登录失败次数 (达5次触发锁定)',
  `locked_until` DATETIME(3) DEFAULT NULL COMMENT '防爆破锁定截止时间 (15分钟)',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  KEY `idx_status_created` (`status`, `created_at`, `id`),
  CONSTRAINT `ck_user_status` CHECK (`status` IN ('PENDING','ACTIVE','REJECTED','DISABLED')),
  CONSTRAINT `ck_user_password_days` CHECK (`password_expires_days` IS NULL OR `password_expires_days` BETWEEN 30 AND 180),
  CONSTRAINT `ck_user_force_password` CHECK (`must_change_password` IN (0,1)),
  CONSTRAINT `ck_user_versions` CHECK (`version` >= 1 AND `auth_version` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户账号主表';

-- 2. RBAC 角色模板表 (含 version 乐观锁版本号)
CREATE TABLE `sys_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_name` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '角色标识 (SUPER_ADMIN, SECURITY_ADMIN, DBA, ANALYST, DEVELOPER)',
  `display_name` VARCHAR(64) NOT NULL COMMENT '角色展示名称',
  `description` VARCHAR(255) DEFAULT NULL,
  `default_limit` INT UNSIGNED NOT NULL DEFAULT 50 COMMENT '默认注入 LIMIT 行数',
  `max_limit` INT UNSIGNED NOT NULL DEFAULT 500 COMMENT '单次允许最大 LIMIT 行数',
  `max_timeout_ms` INT UNSIGNED NOT NULL DEFAULT 15000 COMMENT '单次查询最大超时 (ms)',
  `user_qpm_limit` INT NOT NULL DEFAULT 60 COMMENT '角色主体 QPM 配额 (-1 为免主体限流)',
  `max_inflight_concurrency` INT UNSIGNED NOT NULL DEFAULT 5 COMMENT '单用户最大在途并发数',
  `is_builtin` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否内置角色 (内置角色禁止删除)',
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号 (角色或下属ACL修改时+1)',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_name` (`role_name`),
  CONSTRAINT `ck_role_limits` CHECK (`default_limit` BETWEEN 1 AND 500 AND `max_limit` BETWEEN 1 AND 5000 AND `default_limit` <= `max_limit`),
  CONSTRAINT `ck_role_timeout` CHECK (`max_timeout_ms` BETWEEN 1000 AND 60000),
  CONSTRAINT `ck_role_qpm` CHECK (`user_qpm_limit` = -1 OR `user_qpm_limit` BETWEEN 1 AND 10000),
  CONSTRAINT `ck_role_inflight` CHECK (`max_inflight_concurrency` BETWEEN 1 AND 50),
  CONSTRAINT `ck_role_flags` CHECK (`is_builtin` IN (0,1) AND `version` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='RBAC 角色模板表';

-- 3. 用户与角色多对多关联表
CREATE TABLE `sys_user_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_role` (`user_id`, `role_id`),
  KEY `idx_role_id` (`role_id`),
  CONSTRAINT `fk_ur_user` FOREIGN KEY (`user_id`) REFERENCES `sys_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ur_role` FOREIGN KEY (`role_id`) REFERENCES `sys_roles` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户多角色关联表';

-- 4. 账号审批流与管理强一致审计表 (同一事务写入，失败则业务事务回滚)
CREATE TABLE `sys_user_approvals` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '申请人/目标用户；非用户管理事件为操作员ID',
  `action` VARCHAR(32) NOT NULL COMMENT 'SUBMIT, APPROVE, REJECT, RESUBMIT, CANCELED, STATUS_CHANGE, ROLE_CHANGE, PAT_REVOKE, CONFIG_UPDATE',
  `reason` VARCHAR(512) DEFAULT NULL COMMENT '申请说明、驳回理由或变更摘要',
  `operator_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '操作人 ID；0仅限系统自举或本人注册',
  `application_reason` VARCHAR(512) DEFAULT NULL COMMENT '审批轮次原始申请理由快照；reason可改为驳回理由',
  `decided_at` DATETIME(3) DEFAULT NULL COMMENT '工单处理时间；created_at保留提交时间',
  `target_type` VARCHAR(32) DEFAULT NULL COMMENT '管理审计资源类型；USER/ROLE/PROFILE/PAT/RATE_LIMIT/SETTING',
  `target_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '管理审计目标ID；全局作用域可为0',
  `details` JSON DEFAULT NULL COMMENT '脱敏变更摘要与版本；禁止凭据、密码哈希或密文',
  `pending_user_id` BIGINT UNSIGNED GENERATED ALWAYS AS
    (CASE WHEN `action` IN ('SUBMIT','RESUBMIT') THEN `user_id` ELSE NULL END) STORED COMMENT '数据库约束每用户最多一个待审轮次',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`, `created_at` DESC, `id` DESC),
  KEY `idx_action_created` (`action`, `created_at`, `id`),
  KEY `idx_target_created` (`target_type`, `target_id`, `created_at`),
  UNIQUE KEY `uk_pending_user` (`pending_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='账号审批与管理写操作强一致审计表';

-- 5. 个人访问令牌 (PAT) 表
CREATE TABLE `sys_pats` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(64) NOT NULL COMMENT '令牌用途名称',
  `token_prefix` VARCHAR(24) NOT NULL COMMENT '展示前缀 如 mcp_pat_a1b2...',
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'HMAC-SHA256(SERVER_PEPPER, rawToken) 十六进制摘要',
  `expires_at` DATETIME(3) DEFAULT NULL COMMENT '到期时间 (NULL表示永不过期)',
  `last_used_at` DATETIME(3) DEFAULT NULL,
  `revoked_at` DATETIME(3) DEFAULT NULL COMMENT '主动吊销时间 (非NULL表示已吊销)',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_token_hash` (`token_hash`),
  KEY `idx_user_revoked` (`user_id`, `revoked_at`),
  CONSTRAINT `fk_pat_user` FOREIGN KEY (`user_id`) REFERENCES `sys_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='个人访问令牌安全表';

-- 6. 数据源配置表 (Profiles - 含 version 乐观锁与 lower_case_table_names 语义配置)
CREATE TABLE `sys_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT 'Profile唯一英文标识；不区分大小写、创建后不可变',
  `display_name` VARCHAR(128) NOT NULL COMMENT '展示名称',
  `environment` VARCHAR(32) NOT NULL DEFAULT 'PROD' COMMENT 'PROD, STG, DEV；创建后不可变',
  `host` VARCHAR(255) NOT NULL,
  `port` INT UNSIGNED NOT NULL DEFAULT 3306,
  `username` VARCHAR(64) NOT NULL,
  `password_encrypted` TEXT NOT NULL COMMENT 'AES-256-GCM 密文: v1:key_id:iv:ciphertext:tag',
  `default_database` VARCHAR(64) NOT NULL,
  `lower_case_table_names` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '目标实例大小写模式: 0-区分大小写, 1或2-不区分',
  `tls_config` JSON DEFAULT NULL COMMENT 'null或{enabled:boolean,ca_cert:string|null}；启用时驱动强制证书与身份校验',
  `ssh_config` JSON DEFAULT NULL COMMENT 'SSH配置 (use_ssh, host, port, username, private_key_encrypted, host_fingerprint_sha256)',
  `max_pool_size` INT UNSIGNED NOT NULL DEFAULT 10,
  `queue_timeout_ms` INT UNSIGNED NOT NULL DEFAULT 3000 COMMENT '排队等待空闲连接超时(ms)',
  `profile_capacity_qpm` INT UNSIGNED NOT NULL DEFAULT 300 COMMENT 'Profile资源保护桶QPM上限',
  `max_inflight_concurrency` INT UNSIGNED NOT NULL DEFAULT 30 COMMENT 'Profile最大在途并发上限',
  `status` VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE, DISABLED',
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name` (`name`),
  CONSTRAINT `ck_profile_environment` CHECK (`environment` IN ('PROD','STG','DEV')),
  CONSTRAINT `ck_profile_status` CHECK (`status` IN ('ACTIVE','DISABLED')),
  CONSTRAINT `ck_profile_port` CHECK (`port` BETWEEN 1 AND 65535),
  CONSTRAINT `ck_profile_pool` CHECK (`max_pool_size` BETWEEN 1 AND 50),
  CONSTRAINT `ck_profile_queue` CHECK (`queue_timeout_ms` BETWEEN 500 AND 30000),
  CONSTRAINT `ck_profile_qpm` CHECK (`profile_capacity_qpm` BETWEEN 10 AND 10000),
  CONSTRAINT `ck_profile_inflight` CHECK (`max_inflight_concurrency` BETWEEN 1 AND 50),
  CONSTRAINT `ck_profile_case` CHECK (`lower_case_table_names` IN (0,1,2)),
  CONSTRAINT `ck_profile_version` CHECK (`version` >= 1),
  CONSTRAINT `ck_profile_tls_object` CHECK (`tls_config` IS NULL OR JSON_TYPE(`tls_config`) = 'OBJECT'),
  CONSTRAINT `ck_profile_ssh_object` CHECK (`ssh_config` IS NULL OR JSON_TYPE(`ssh_config`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='数据源 Profile 表';

-- 7. 角色与数据源多对多授权表
CREATE TABLE `sys_role_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `profile_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_profile` (`role_id`, `profile_id`),
  KEY `idx_profile` (`profile_id`),
  CONSTRAINT `fk_rp_role` FOREIGN KEY (`role_id`) REFERENCES `sys_roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rp_profile` FOREIGN KEY (`profile_id`) REFERENCES `sys_profiles` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色与 Profile 授权关联表';

-- 8. 角色数据库级 ACL 授权表 (profile_id='0' 为该角色全局规则)
CREATE TABLE `sys_role_database_acls` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `profile_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 表示对该角色所有授权Profile生效',
  `database_name` VARCHAR(64) COLLATE utf8mb4_0900_as_cs NOT NULL COMMENT '精确数据库名；保留大小写，通配语义未开放',
  `is_allowed` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1-ALLOW(允许), 0-DENY(拒绝, 优先级最高)',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_prof_db` (`role_id`, `profile_id`, `database_name`),
  KEY `idx_db_acl_profile` (`profile_id`, `role_id`),
  CONSTRAINT `ck_db_acl_allowed` CHECK (`is_allowed` IN (0,1)),
  CONSTRAINT `fk_rda_role` FOREIGN KEY (`role_id`) REFERENCES `sys_roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色数据库级 ACL 表';

-- 9. 角色表级 ACL 授权表 (Table ACL - Default Deny)
CREATE TABLE `sys_role_table_acls` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `profile_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 表示对该角色所有授权Profile生效',
  `rule_type` ENUM('BLACKLIST', 'WHITELIST') NOT NULL DEFAULT 'BLACKLIST',
  `table_pattern` VARCHAR(128) COLLATE utf8mb4_0900_as_cs NOT NULL COMMENT '表匹配模式 (如 salary_*, finance.payroll_*, *)',
  `description` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_lookup` (`role_id`, `profile_id`, `rule_type`),
  UNIQUE KEY `uk_role_prof_pattern` (`role_id`, `profile_id`, `table_pattern`),
  KEY `idx_table_acl_profile` (`profile_id`, `role_id`),
  CONSTRAINT `fk_rta_role` FOREIGN KEY (`role_id`) REFERENCES `sys_roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色表级 ACL 规则表';

-- 10. 系统全局与用户专属限流规则表 (含 version 乐观锁版本号)
CREATE TABLE `sys_rate_limits` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope_type` ENUM('GLOBAL', 'USER') NOT NULL COMMENT 'GLOBAL(scope_id=0) 或 USER(scope_id=userId)',
  `scope_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `qpm_limit` INT NOT NULL DEFAULT 60 COMMENT 'QPM配额 (-1表示免主体限流)',
  `burst_capacity` INT NOT NULL DEFAULT 10 COMMENT '突发令牌桶容量',
  `loop_breaker_threshold` INT NOT NULL DEFAULT 3 COMMENT '连续相同报错触发死循环熔断次数',
  `loop_breaker_window_sec` INT NOT NULL DEFAULT 30 COMMENT '死循环检测与冷却窗口(秒)',
  `revision` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'GLOBAL=0；USER为持久单调修订号且等于version',
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scope` (`scope_type`, `scope_id`),
  CONSTRAINT `ck_rate_scope` CHECK ((`scope_type` = 'GLOBAL' AND `scope_id` = 0 AND `revision` = 0 AND `version` >= 1) OR (`scope_type` = 'USER' AND `scope_id` > 0 AND `revision` >= 1 AND `version` = `revision`)),
  CONSTRAINT `ck_rate_qpm` CHECK (`qpm_limit` BETWEEN 1 AND 10000 OR (`scope_type` = 'USER' AND `qpm_limit` = -1)),
  CONSTRAINT `ck_rate_burst` CHECK (`burst_capacity` BETWEEN 1 AND 500),
  CONSTRAINT `ck_rate_loop` CHECK (`loop_breaker_threshold` BETWEEN 2 AND 10 AND `loop_breaker_window_sec` BETWEEN 10 AND 300)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='动态限流与死循环熔断规则表';

-- 11. 分级全链路 SQL 审计流水表 (uk_instance_time保护同事件时间的重放幂等)
CREATE TABLE `sys_audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `query_instance_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '查询实例全局唯一 ID (重放幂等键)',
  `session_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `profile_id` BIGINT UNSIGNED NOT NULL,
  `profile_name` VARCHAR(128) DEFAULT NULL,
  `database_name` VARCHAR(64) DEFAULT NULL,
  `sql_text` MEDIUMTEXT NOT NULL COMMENT '脱敏后的完整 SQL',
  `sql_type` VARCHAR(32) NOT NULL DEFAULT 'SELECT',
  `status` VARCHAR(32) NOT NULL,
  `error_message` TEXT DEFAULT NULL,
  `latency_ms` INT UNSIGNED NOT NULL DEFAULT 0,
  `rows_affected` INT UNSIGNED NOT NULL DEFAULT 0,
  `client_ip` VARCHAR(45) NOT NULL,
  `is_high_risk` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`, `created_at`),
  UNIQUE KEY `uk_instance_time` (`query_instance_id`, `created_at`),
  KEY `idx_user_time` (`user_id`, `created_at`),
  KEY `idx_profile_time` (`profile_id`, `created_at`),
  KEY `idx_status_time` (`status`, `created_at`),
  KEY `idx_query_instance` (`query_instance_id`),
  KEY `idx_time_id` (`created_at`, `id`),
  KEY `idx_user_profile_time` (`user_id`, `profile_id`, `created_at`),
  CONSTRAINT `ck_audit_status` CHECK (`status` IN ('SUCCESS','BLOCKED_AST','BLOCKED_ACL','BLOCKED_CONCURRENCY','BLOCKED_RATE','CANCELED','FAILED_MYSQL','TIMEOUT')),
  CONSTRAINT `ck_audit_high_risk` CHECK (`is_high_risk` IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='分级全链路 SQL 审计表'
PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
  PARTITION p202611 VALUES LESS THAN (202612),
  PARTITION p202612 VALUES LESS THAN (202701),
  PARTITION p202701 VALUES LESS THAN (202702),
  PARTITION pmax VALUES LESS THAN MAXVALUE
);

-- 12. 匿名与未授权安全审计事件表
CREATE TABLE `sys_anonymous_security_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_ip` VARCHAR(45) NOT NULL,
  `request_path` VARCHAR(255) NOT NULL,
  `event_type` VARCHAR(64) NOT NULL COMMENT 'AUTH_FAILED, INVALID_PAT, SSRF_BLOCKED, BRUTE_FORCE_LOCKED, CSRF_INVALID',
  `details` JSON DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_ip_time` (`client_ip`, `created_at`),
  KEY `idx_event_time` (`event_type`, `created_at`),
  KEY `idx_anon_time_id` (`created_at`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='匿名与未授权安全审计表';

-- 13. 系统全局参数与通知配置表
CREATE TABLE `sys_system_settings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `setting_value` MEDIUMTEXT NOT NULL,
  `is_encrypted` TINYINT(1) NOT NULL DEFAULT 0,
  `description` VARCHAR(255) DEFAULT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_key` (`setting_key`),
  CONSTRAINT `ck_setting_flags` CHECK (`is_encrypted` IN (0,1) AND `version` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统全局参数表';

-- 14. 用户专属限流持久代际计数器；删除业务行或用户均不删除计数器
CREATE TABLE `sys_rate_limit_revisions` (
  `scope_type` ENUM('USER') NOT NULL COMMENT '仅用户专属限流使用代际计数器',
  `scope_id` BIGINT UNSIGNED NOT NULL COMMENT '用户历史ID；不复用、无级联外键',
  `last_revision` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已提交的最大修订号；每次创建或更新均递增',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`scope_type`, `scope_id`),
  CONSTRAINT `ck_revision_scope` CHECK (`scope_id` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户限流终身修订计数器';

-- 仅成功执行全套空库DDL后建立首次初始化凭据；不是存量库修复/补管理员脚本。
-- 应用不得在标记缺失时补建；PENDING→READY与初始超管/配置/审计同事务提交。
INSERT INTO sys_system_settings (setting_key, setting_value, is_encrypted, description, version)
VALUES ('bootstrap_state', 'PENDING', 0, 'First empty-database initialization marker; internal only', 1);
