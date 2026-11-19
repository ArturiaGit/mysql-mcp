with open('scripts/contract_generators/gen_part7_8.py', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update 6.3.2 User Status State Transition Matrix
old_status_sec = """#### 6.3.2 变更用户账号状态 (冻结 / 解冻)
- **接口路径**：`PUT /api/v1/users/:id/status`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：超级管理员启用或停用用户账号。校验 `version` (409 CAS)，同事务加锁校验超管自残，同事务写管理审计，并立即断流。"""

new_status_sec = """#### 6.3.2 变更用户账号状态 (冻结 / 解冻与状态转换矩阵)
- **接口路径**：`PUT /api/v1/users/:id/status`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：超级管理员启用或停用用户账号。校验 `version` (409 CAS)，同事务加锁校验超管自残，同事务写管理审计，并立即断流。
- **状态流转矩阵约束 (防审批绕过铁律)**：
  本接口仅用于存量正常或停用账号的启停流转，**严禁绕过审批治理流程**：
  | 当前状态 (From) | 允许的目标状态 (To) | 业务行为说明 |
  | :--- | :--- | :--- |
  | `ACTIVE` | `DISABLED` | 允许停用，校验自残保护与最后超管保护 |
  | `DISABLED` | `ACTIVE` | 允许解冻恢复已停用账号 |
  | `PENDING` | `*` (任何目标状态) | **严格禁止**！必须通过工单审批流程 (`POST /approvals/:id/approve` 或 `reject`) 流转。违者抛 `400 ERR_INVALID_STATUS_TRANSITION` |
  | `REJECTED` | `*` (任何目标状态) | **严格禁止**！必须由申请人补充重提并经由管理员审批通过后激活。违者抛 `400 ERR_INVALID_STATUS_TRANSITION` |"""

text = text.replace(old_status_sec, new_status_sec)

# Add 400 ERR_INVALID_STATUS_TRANSITION to 6.3.2 error list
text = text.replace(
    "- `409 ERR_CONCURRENCY_CONFLICT`：用户状态已被其他管理员抢先修改；",
    "- `400 ERR_INVALID_STATUS_TRANSITION`：目标用户处于 PENDING 或 REJECTED 状态，严禁直接调用启停接口；\n  - `409 ERR_CONCURRENCY_CONFLICT`：用户状态已被其他管理员抢先修改；"
)

# 2. Add 6.3.5 POST /api/v1/users/:id/reset-password
reset_pwd_sec = """
#### 6.3.5 管理员重置指定用户密码 / 标记强制改密
- **接口路径**：`POST /api/v1/users/:id/reset-password`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：超级管理员重置指定用户的登录口令，或为用户分配新的临时密码并标记下次登录强制改密。
- **同事务联动与会话清退**：
  在同一个元数据库事务内：更新 `password_hash`、置 `must_change_password = 1`、递增 `auth_version = auth_version + 1`、递增 `version = version + 1`，写入管理安全审计；事务提交后立即下发内存失效墓碑、物理打断在途 SQL、销毁该用户全部在途 Web Session。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 默认值 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :---: | :--- | :--- |
  | `newTemporaryPassword` | `string` | 否 | 由服务端自动生成 | 8~64 字符，须含大小写字母、数字及特殊字符 | 指定临时密码；缺省时服务端生成 16 位强随机凭证 |
  | `mustChangePassword` | `boolean` | 否 | `true` | 布尔值 | 用户首次以此密码登录时是否强制重置密码 |
  | `version` | `number` | 是 | - | 当前读取到的用户主记录版本号 | 乐观锁版本号 |
- **请求示例**：
  ```json
  {
    "mustChangePassword": true,
    "version": 1
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "temporaryPassword": "TempPassword2026!#",
    "version": 2
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：用户已被其他管理员修改；
  - `400 ERR_PASSWORD_POLICY_VIOLATED`：手动指定的临时密码不符合强密码复杂度策略；
  - `404 ERR_NOT_FOUND`：目标用户不存在。
"""

delete_user_anchor = "### 6.4 个人访问令牌模块接口契约 (`/api/v1/pats/*`)"
text = text.replace(delete_user_anchor, reset_pwd_sec + "\n---\n\n" + delete_user_anchor)

# 3. Update rawToken in 6.4.2 to exact 72-char hex token
old_raw_token = '"rawToken": "mcp_pat_8f3a9e2d1c4b7a0f6e5d8c3b2a1f0e9d8c7b6a5f4e3d2c1b"'
new_raw_token = '"rawToken": "mcp_pat_8f3a9e2d1c4b7a0f6e5d8c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a32"'
text = text.replace(old_raw_token, new_raw_token)

# 4. Fix raw newlines in JSON strings for 6.5.3 and 6.5.6
old_json_newline_1 = '"ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\\n...",'
# In python string literal, let's make sure it writes \\n...
text = re.sub(
    r'"ssh_private_key":\s*"-----BEGIN OPENSSH PRIVATE KEY-----\r?\n\.\.\."',
    r'"ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\\n..."',
    text
)
text = re.sub(
    r'"ca_cert":\s*"-----BEGIN CERTIFICATE-----\r?\n\.\.\."',
    r'"ca_cert": "-----BEGIN CERTIFICATE-----\\n..."',
    text
)

# 5. Update 6.5.4 Trust Boundary Re-entry description
old_cred_rule = """- **防凭据外泄保存铁律 (Credential Re-entry Iron Law)**：
  - **数据库凭据**：若修改了 `host`、`port` 或 `user`，请求体必须传入新的 `password` 明文字符串；若未提供新密码，服务端**立即阻断并抛出 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`**，绝不沿用旧密文连接新主机；
  - **跳板机凭据**：若修改了 `ssh_host`、`ssh_port` 或 `ssh_user`，请求体必须传入新的 `ssh_private_key` 与 `ssh_host_fingerprint_sha256`；若未提供，同样抛出 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`；
  - 只有在连接端点完全未变的情况下，允许 `password` 或 `ssh_private_key` 为空/缺省以沿用库内旧密文。"""

new_cred_rule = """- **连接路径与信任边界变更防外泄铁律 (Trust Boundary Re-entry Iron Law)**：
  - **全链路信任边界受控**：若发生以下任一变动，请求体**必须传入新的 `password` 明文字符串**；若未提供，服务端**立即阻断并抛出 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`**：
    1. 数据库主机、端口或用户变动 (`host`, `port`, `user`)；
    2. 跳板机转发隧道状态切换 (`use_ssh` 启停)，或跳板机端点/指纹变动 (`ssh_host`, `ssh_port`, `ssh_user`, `ssh_host_fingerprint_sha256`)；
    3. TLS 传输安全级别变动 (`tls_config.enabled` 启停，或 `tls_config.ca_cert` 证书变更)；
  - **跳板机私钥同理**：若跳板机端点发生变动，必须传入新的 `ssh_private_key` 与指纹；
  - 只有在数据库端点、SSH 转发隧道、主机指纹与 TLS 信任级别**全链路拓扑完全未变**的前提下，才允许密码留空沿用库内旧密文。"""

text = text.replace(old_cred_rule, new_cred_rule)

# 6. Update 6.6.6 & 6.6.8 with explicit write payloads & constraints
old_666_table = """  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `rules` | `TableAclRuleDTO[]` | 是 | 全量表级规则数组 (`profile_id`, `table_pattern`, `rule_type`, `description?`) |
  | `version` | `number` | 是 | 关联父角色的当前乐观锁版本号 |"""

new_666_table = """  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `rules` | `TableAclRuleWriteItem[]` | 是 | 数组容量 0~200 条，禁止同模式重复 | 全量表级规则数组 (全量覆盖语义；传空数组表示清空自定义规则) |
  | `rules[].profile_id` | `string` | 是 | `"0"` 或角色已绑定的有效 Profile ID | 作用数据源标识 (`"0"` 为角色下全局规则) |
  | `rules[].table_pattern` | `string` | 是 | 长度 1~128 字符，支持通配如 `salary_*` | 表名匹配模式 |
  | `rules[].rule_type` | `string` | 是 | 枚举: `'BLACKLIST'` 或 `'WHITELIST'` | 规则类型 |
  | `rules[].description` | `string` | 否 | 最大 255 字符，可为 `null` | 规则备注说明 |
  | `version` | `number` | 是 | 必须等于当前读取到的父角色版本号 | 乐观锁版本前置条件 |"""
text = text.replace(old_666_table, new_666_table)

old_668_table = """  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `rules` | `DbAclRuleDTO[]` | 是 | 库级规则数组 (`profile_id`, `database_name`, `effect: 'ALLOW' \| 'DENY'`) |
  | `version` | `number` | 是 | 关联父角色的当前乐观锁版本号 |"""

new_668_table = """  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `rules` | `DbAclRuleWriteItem[]` | 是 | 数组容量 0~100 条，禁止同库重复 | 库级规则数组 (全量覆盖语义；传空数组表示清空自定义规则) |
  | `rules[].profile_id` | `string` | 是 | `"0"` 或角色已绑定的有效 Profile ID | 作用数据源标识 (`"0"` 为角色下全局规则) |
  | `rules[].database_name`| `string` | 是 | 长度 1~64 字符 | 目标数据库名 |
  | `rules[].effect` | `string` | 是 | 枚举: `'ALLOW'` 或 `'DENY'` | 明确允许或禁止 |
  | `version` | `number` | 是 | 必须等于当前读取到的父角色版本号 | 乐观锁版本前置条件 |"""
text = text.replace(old_668_table, new_668_table)

with open('scripts/contract_generators/gen_part7_8.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated gen_part7_8.py")
