import re

with open('scripts/be_parts/part4_database_and_dal.md', 'r', encoding='utf-8') as f:
    c4 = f.read()

# Add `version` column to sys_users DDL if not present
if '`version` INT UNSIGNED NOT NULL DEFAULT 1' not in c4:
    c4 = re.sub(
        r"  `password_expires_days` INT DEFAULT 90[^\n]*\n",
        "  `password_expires_days` INT DEFAULT 90 COMMENT '密码有效期天数 (30-180，NULL表示永不过期)',\n  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',\n",
        c4,
        count=1
    )

with open('scripts/be_parts/part4_database_and_dal.md', 'w', encoding='utf-8') as f:
    f.write(c4)

with open('scripts/be_parts/part5_control_plane_security.md', 'r', encoding='utf-8') as f:
    c5 = f.read()

# Add password expiration check to L3 guard in backend spec
if 'is_password_expired' not in c5:
    old_guard = "  // L3: MustChangePwdGuard (仅对 ACTIVE 用户生效)\n  if (currentUser.must_change_password) {"
    new_guard = (
        "  // L3: MustChangePwdGuard (仅对 ACTIVE 用户生效，含密码自然过期判定)\n"
        "  const now = Date.now();\n"
        "  const is_password_expired = Boolean(\n"
        "    currentUser.password_expires_days !== null &&\n"
        "    currentUser.password_updated_at &&\n"
        "    now > (new Date(currentUser.password_updated_at).getTime() + (currentUser.password_expires_days || 90) * 86400000)\n"
        "  );\n\n"
        "  if (currentUser.must_change_password || is_password_expired) {"
    )
    c5 = c5.Replace(old_guard, new_guard) if hasattr(c5, 'Replace') else c5.replace(old_guard, new_guard)

# Ensure MUST_CHANGE_PWD_ALLOWED_PATHS contains /api/v1/auth/password-policy
if "'/api/v1/auth/password-policy'" not in c5:
    c5 = c5.replace(
        "'/api/v1/auth/csrf',",
        "'/api/v1/auth/csrf',\n  '/api/v1/auth/password-policy',"
    )

with open('scripts/be_parts/part5_control_plane_security.md', 'w', encoding='utf-8') as f:
    f.write(c5)

print('Updated be_parts 4 and 5')
