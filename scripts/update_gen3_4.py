with open('scripts/contract_generators/gen_part3_4.py', 'r', encoding='utf-8') as f:
    text = f.read()

# Add ERR_ROLE_IMMUTABLE_FIELD right after ERR_PROFILE_IMMUTABLE_FIELD
old_err = "| `ERR_PROFILE_IMMUTABLE_FIELD` | 400 | 数据源服务 | 尝试修改 Profile 的 name 或 environment 等不可变字段 | 数据源基础标识禁止修改。 | 数据源唯一标识与环境属性创建后不可变更，请保持原值。 | `details.immutable_fields` |"
new_err = old_err + "\n| `ERR_ROLE_IMMUTABLE_FIELD` | 400 | 策略管理 | 尝试修改角色的唯一英文标识 role_name | 角色唯一英文标识禁止修改。 | 角色唯一英文标识创建后不可变更，请保持原值。 | `details.immutable_fields` |"

text = text.replace(old_err, new_err)

# Update migration SQL in section 4.4
old_sql = """   ```sql
   -- 增量变更：增加密码修改时间戳与自定义过期天数配置
   ALTER TABLE `sys_users` 
     ADD COLUMN `password_updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '密码最后修改时间',
     ADD COLUMN `password_expires_days` INT DEFAULT 90 COMMENT '密码有效期天数 (30-180，NULL表示永不过期)';

   -- 存量历史数据回填：平滑初始化旧账号
   UPDATE `sys_users` 
   SET `password_updated_at` = `created_at`, `password_expires_days` = 90 
   WHERE `password_updated_at` IS NULL;
   ```"""

new_sql = """   ```sql
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
   ```"""

text = text.replace(old_sql, new_sql)

with open('scripts/contract_generators/gen_part3_4.py', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated gen_part3_4.py')
