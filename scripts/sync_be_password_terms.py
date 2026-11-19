import re

with open('scripts/be_parts/part4_database_and_dal.md', 'r', encoding='utf-8') as f:
    c = f.read()

pattern = r'  `must_change_password` TINYINT\(1\) NOT NULL DEFAULT 1[^\n]*\n'
replacement = (
    "  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否强制改密: 1-是(仅对ACTIVE拦截), 0-否',\n"
    "  `password_updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '密码最后修改时间',\n"
    "  `password_expires_days` INT DEFAULT 90 COMMENT '密码有效期天数 (30-180，NULL表示永不过期)',\n"
)
c = re.sub(pattern, replacement, c, count=1)
with open('scripts/be_parts/part4_database_and_dal.md', 'w', encoding='utf-8') as f:
    f.write(c)

with open('scripts/be_parts/part11_api_matrix_and_testing.md', 'r', encoding='utf-8') as f:
    c11 = f.read()

pattern11 = r'\| \| `/api/v1/auth/me`[^\n]*\n'
replacement11 = (
    "| | `/api/v1/auth/me` | `GET` | **L1 会话级** | 无 | `UserProfileDTO` (含 `reject_reason?`, `password_expires_at`) | **对 PENDING/REJECTED/DISABLED/ACTIVE 均返回 200 OK** |\n"
    "| | `/api/v1/auth/password-policy` | `GET` | **L2 ACTIVE** | 无 | `PasswordPolicyDTO` | 个人密码过期策略与剩余有效期查询 (对已过期者豁免 L3) |\n"
    "| | `/api/v1/auth/password-policy` | `PUT` | **L4 全体激活用户** | `{ passwordExpiresDays }` | `{ success: true, passwordExpiresDays }` | 更新个人密码有效期配置 (30~180天或null关闭) |\n"
)
c11 = re.sub(pattern11, replacement11, c11, count=1)
with open('scripts/be_parts/part11_api_matrix_and_testing.md', 'w', encoding='utf-8') as f:
    f.write(c11)

print('Successfully synchronized be_parts')
