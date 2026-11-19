with open('scripts/contract_generators/gen_part5_6.py', 'r', encoding='utf-8') as f:
    text = f.read()

# Update 5.2 to clearly distinguish test-db/PUT profile vs test-ssh
old_52_text = """### 5.2 连接路径与信任边界变更防外泄铁律 (全链路覆盖)"""
new_52_text = """### 5.2 连接路径与信任边界变更防外泄铁律 (端点适用范围精准界定)

为防止存量凭据在网络转发路径变更时被恶意复用探测未授权内网或受到中间人劫持，系统针对**不同端点所使用的实际凭据**实施精确界定的防外泄防御模型：

#### 1. 数据库端点保存 (`PUT /profiles/:id`) 与数据库测试 (`POST /profiles/test-db`)
当管理员在编辑已有数据源或执行数据库连通性测试时，**只要发生以下任一信任边界与连接端点变动，必须重新输入数据库密码（若启用 SSH，同时必须重新录入私钥与指纹）**：
1. **数据库端点与认证身份变更**：修改了 `host`、`port` 或 `user`；
2. **网络转发隧道与信任边界变更**：
   - 切换 `use_ssh` 状态（由关闭切为开启，或由开启切为关闭）；
   - 或修改了跳板机连接参数：`ssh_host`、`ssh_port`、`ssh_user`、`ssh_host_fingerprint_sha256`；
3. **传输层加密信任级别变更**：
   - 切换 `tls_config.enabled`（由关闭切为开启，或由开启切为关闭）；
   - 或修改了自定义 CA 证书文本 `tls_config.ca_cert`。

若发生上述任一变动而请求体中 `password` 为空、缺省或为 `"******"`，服务端**无条件阻断，统一返回 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`**；
只有在数据库端点、SSH 转发隧道、跳板机指纹与 TLS 配置**全链路拓扑完全未变**的前提下（例如仅修改展示名、连接池大小、QPM配额、排队超时），才允许密码留空以沿用库内旧密文。

#### 2. SSH 堡垒机独立连通性测试 (`POST /profiles/test-ssh`)
- **适用凭据精确限定**：`test-ssh` 仅测试从网关到堡垒机的 SSH 传输层连通性与公钥认证，**绝不建立 MySQL 连接，请求结构无需也绝不要求提供数据库密码**；
- **SSH 独立防外泄约束**：若在测试已存配置草稿时修改了 `ssh_host`、`ssh_port` 或 `ssh_user`，必须在请求体中提供新 `privateKey` 与 `hostFingerprintSha256`；若未填新私钥则抛出 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`；若跳板机参数未变且携带 `profile_id`，允许复用库内已解密私钥测通。"""

start_idx = text.find("### 5.2 连接路径与信任边界变更防外泄铁律 (全链路覆盖)")
end_idx = text.find("### 5.3 全场景 SSRF 深度防御与双栈地址过滤策略 (`ERR_SSRF_PROHIBITED`)")
if start_idx != -1 and end_idx != -1:
    text = text[:start_idx] + new_52_text + "\n\n" + text[end_idx:]

with open('scripts/contract_generators/gen_part5_6.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated gen_part5_6.py with distinguished credential boundaries")
