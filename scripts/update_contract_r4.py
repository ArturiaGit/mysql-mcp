with open('scripts/contract_generators/gen_part3_4.py', 'r', encoding='utf-8') as f:
    text = f.read()

old_desc = "- **改密放行白名单**：命中拦截后，除放行改密与会话必需端点（`POST /api/v1/auth/change-password`、`GET /api/v1/auth/me`、`POST /api/v1/auth/logout`、`GET /api/v1/auth/csrf`、`GET /api/v1/auth/password-policy`）外，访问系统内任何其他业务端点均返回 `403 ERR_MUST_CHANGE_PASSWORD`；"

new_desc = (
    "- **改密放行白名单与方法级精准控制**：命中拦截后，除放行改密与会话必需端点（`POST /api/v1/auth/change-password`、`GET /api/v1/auth/me`、`POST /api/v1/auth/logout`、`GET /api/v1/auth/csrf`）以及**特权只读端点 `GET /api/v1/auth/password-policy`**（仅允许 GET 读取策略，**严禁豁免 `PUT /api/v1/auth/password-policy`**，防止超期用户在改密前关闭或篡改过期策略）外，访问系统内任何其他业务端点均返回 `403 ERR_MUST_CHANGE_PASSWORD`；"
)

text = text.replace(old_desc, new_desc)

with open('scripts/contract_generators/gen_part3_4.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated gen_part3_4.py with method-specific L3 exemption")
