with open('scripts/be_parts/part4_database_and_dal.md', 'r', encoding='utf-8') as f:
    text = f.read()

old_str = "  `auth_version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '用户授权版本号(改密/冻结/改角色时+1)',\n"
new_str = "  `auth_version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '用户授权版本号(改密/冻结/改角色时+1)',\n  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',\n"

text = text.replace(old_str, new_str)

with open('scripts/be_parts/part4_database_and_dal.md', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated version in be_parts/part4_database_and_dal.md')
