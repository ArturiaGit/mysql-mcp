with open('scripts/contract_generators/gen_part7_8.py', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update 6.3.5 Reset Password with consistent mustChangePassword flag
old_reset_tx = """- **同事务联动与会话清退**：
  在同一个元数据库事务内：更新 `password_hash`、置 `must_change_password = 1`、递增 `auth_version = auth_version + 1`、递增 `version = version + 1`，写入管理安全审计；事务提交后立即下发内存失效墓碑、物理打断在途 SQL、销毁该用户全部在途 Web Session。"""

new_reset_tx = """- **同事务联动与会话清退 (支持选择是否强制改密)**：
  在同一个元数据库事务内执行原子变更：
  ```sql
  UPDATE sys_users 
  SET password_hash = ?, 
      must_change_password = ?, -- 按请求参数动态写入: mustChangePassword === false ? 0 : 1 (默认 1)
      password_updated_at = NOW(),
      auth_version = auth_version + 1, 
      version = version + 1 
  WHERE id = ? AND version = ?;
  ```
  - 若 `mustChangePassword === true`（默认）：用户下次登录时必须修改密码；
  - 若管理员明确传入 `mustChangePassword === false`：用户下次登录可直接使用该临时密码进入控制台正常工作，无需强制改密；
  - 事务提交后立即下发内存失效墓碑、物理打断在途 SQL、销毁该用户全部在途 Web Session。"""

text = text.replace(old_reset_tx, new_reset_tx)

# 2. Update 6.5.7 SSH test description
old_ssh_desc = """- **功能说明**：测试 SSH 堡垒机连通性、HostKey 指纹比对及私钥认证。同契约执行 SSRF 拦截与凭据防外泄铁律。"""
new_ssh_desc = """- **功能说明**：仅测试网关到 SSH 堡垒机本身的连通性、HostKey 指纹比对及私钥认证。**本测试不建立 MySQL 数据库连接，无需也绝不要求输入数据库密码**。
- **SSH 独立防外泄铁律**：若测试已有数据源时修改了 `host` (跳板机)、`port` 或 `username`，必须输入新的 `privateKey` 与 `hostFingerprintSha256`；未输入抛 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`；参数未变时自动复用已解密存量私钥。"""

text = text.replace(old_ssh_desc, new_ssh_desc)

with open('scripts/contract_generators/gen_part7_8.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated gen_part7_8.py with reset-password toggle and test-ssh scope")
