with open('scripts/contract_generators/gen_part7_8.py', 'r', encoding='utf-8') as f:
    text = f.read()

# Update TlsConfig in 6.5.1 example
old_tls_ex = """      "tls_config": {
        "enabled": true,
        "reject_unauthorized": true,
        "server_name": "mysql.internal.corp"
      },"""
new_tls_ex = """      "tls_config": {
        "enabled": true,
        "ca_cert": null
      },"""
text = text.replace(old_tls_ex, new_tls_ex)

# Update TlsConfig in 6.5.3 example
old_tls_ex2 = """    "tls_config": {
      "enabled": true,
      "reject_unauthorized": true,
      "server_name": "mysql.internal.corp"
    }"""
new_tls_ex2 = """    "tls_config": {
      "enabled": true,
      "ca_cert": "-----BEGIN CERTIFICATE-----\\n..."
    }"""
text = text.replace(old_tls_ex2, new_tls_ex2)

# Update TlsConfig in 6.5.6 example
old_tls_ex3 = """    "tls_config": {
      "enabled": true,
      "reject_unauthorized": true
    },"""
new_tls_ex3 = """    "tls_config": {
      "enabled": true,
      "ca_cert": null
    },"""
text = text.replace(old_tls_ex3, new_tls_ex3)

# Update 6.5.4 immutable & patch rules
old_rules_654 = "- **不可变字段规则**：`name` 与 `environment` 属于不可变属性。若请求体试图修改其值，服务端返回 `400 ERR_PROFILE_IMMUTABLE_FIELD` 阻断更新。"
new_rules_654 = (
    "- **不可变字段确定性规则**：`name` 与 `environment` 属于不可变属性。若请求体试图修改其值（即传入值与数据库已存值不一致），服务端**将严格阻断并返回 `400 ERR_PROFILE_IMMUTABLE_FIELD`**；若传入值与数据库已存值完全相同则放行。\n"
    "- **缺省与增量更新语义规范**：更新采用**白名单字段增量合并更新 (Partial Patch on Allowed Fields)**。请求体中未提供的可选字段（缺省/未传）一律视为保留当前已存原值；传有效非空值表示更新覆盖；传 `null` 表示清空允许为空的字段；未知字段返回 `400 ERR_VALIDATION_FAILED`。"
)
text = text.replace(old_rules_654, new_rules_654)

# Update 6.6.3 immutable & patch rules (replacing "将被拒绝或忽略")
old_rules_663 = "- **不可变字段规则**：`role_name` 属于不可变属性，若提交变更将被拒绝或忽略。"
new_rules_663 = (
    "- **不可变字段确定性规则**：`role_name` 属于不可变属性。若请求体试图变更其值（即传入值与数据库已存值不一致），服务端**将严格阻断并返回 `400 ERR_ROLE_IMMUTABLE_FIELD`**；若传入值与数据库已存值完全相同则放行。\n"
    "- **缺省与增量更新语义规范**：更新采用**白名单字段增量合并更新 (Partial Patch on Allowed Fields)**。请求体中未提供的可选字段（缺省/未传）一律视为保留当前已存原值；传有效非空值表示更新覆盖；传 `null` 表示清空允许为空的字段（如 `description`）；未知字段返回 `400 ERR_VALIDATION_FAILED`。"
)
text = text.replace(old_rules_663, new_rules_663)

with open('scripts/contract_generators/gen_part7_8.py', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated gen_part7_8.py')
