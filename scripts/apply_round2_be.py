import os
import re

# 1. Update be_parts/part4_database_and_dal.md
with open('scripts/be_parts/part4_database_and_dal.md', 'r', encoding='utf-8') as f:
    c4 = f.read()

# Add `version` column to sys_users DDL
if '`version`' not in c4[:c4.find('CREATE TABLE `sys_roles`')]:
    c4 = c4.replace(
        "  `password_expires_days` INT DEFAULT 90 COMMENT '密码有效期天数 (30-180，NULL表示永不过期)',\n",
        "  `password_expires_days` INT DEFAULT 90 COMMENT '密码有效期天数 (30-180，NULL表示永不过期)',\n  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',\n"
    )

with open('scripts/be_parts/part4_database_and_dal.md', 'w', encoding='utf-8') as f:
    f.write(c4)

print("Updated be_parts/part4_database_and_dal.md")
