with open('scripts/contract_generators/gen_part5_6.py', 'r', encoding='utf-8') as f:
    text = f.read()

# Update 5.2 Trust Boundary Credential Re-entry Rule
old_52 = """### 5.2 数据源连通性测试与配置保存防外泄铁律 (全链路覆盖)"""
new_52 = """### 5.2 连接路径与信任边界变更防外泄铁律 (全链路覆盖)

为防止存量凭据在网络转发路径变更时被恶意复用探测未授权内网或受到中间人劫持，系统在数据源连通性测试（`test-db` / `test-ssh`）与配置保存（`PUT /api/v1/profiles/:id`）中，**将防凭据外泄规则从单纯的主机比对扩展为“连接路径与信任边界完整性”防御模型**：

#### 1. 触发强制重填凭据的边界变更矩阵
当管理员在编辑已有数据源时，**只要发生以下任一信任边界与连接端点变动，必须重新输入数据库密码（若启用 SSH，同时必须重新录入私钥与指纹）**：
1. **数据库端点与认证身份变更**：修改了 `host`、`port` 或 `user`；
2. **网络转发隧道与信任边界变更**：
   - 切换 `use_ssh` 状态（由关闭切为开启，或由开启切为关闭）；
   - 或修改了跳板机连接参数：`ssh_host`、`ssh_port`、`ssh_user`、`ssh_host_fingerprint_sha256`；
3. **传输层加密信任级别变更**：
   - 切换 `tls_config.enabled`（由关闭切为开启，或由开启切为关闭）；
   - 或修改了自定义 CA 证书文本 `tls_config.ca_cert`。

若发生上述任一变动而请求体中 `password` 为空、缺省或为 `"******"`，服务端**无条件阻断，统一返回 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`**；
只有在数据库端点、SSH 转发隧道、跳板机指纹与 TLS 配置**全链路拓扑完全未变**的前提下（例如仅修改展示名、连接池大小、QPM配额、排队超时），才允许密码留空以沿用库内旧密文。"""

# Replace in 5.2
start_idx = text.find("### 5.2 数据源连通性测试与配置保存防外泄铁律 (全链路覆盖)")
end_idx = text.find("### 5.3 全场景 SSRF 拦截与内网白名单引导 (`ERR_SSRF_PROHIBITED`)")
if start_idx != -1 and end_idx != -1:
    text = text[:start_idx] + new_52 + "\n\n" + text[end_idx:]

# Update 5.3 SSRF Strategy with complete IPv6 & dual-stack
old_ssrf = """### 5.3 全场景 SSRF 拦截与内网白名单引导 (`ERR_SSRF_PROHIBITED`)"""
new_ssrf = """### 5.3 全场景 SSRF 深度防御与双栈地址过滤策略 (`ERR_SSRF_PROHIBITED`)

数据源连通性测试、Profile 保存后连接池构建以及系统通知 Webhook 推送属于主动发起外部出站请求的高危链路，必须严格通过 SSRF 深度防御流水线：

#### 1. 规范化与地址类型全面归一
- **IPv4-Mapped IPv6 规范化**：解析或输入若包含 `::ffff:0:0/96`（例如 `::ffff:127.0.0.1`、`::ffff:10.0.8.21`），在匹配过滤规则前必须强制解包规范化还原为原生 IPv4 地址进行判定；
- **IPv6 统一小写全展开**：所有 IPv6 地址进行标准化展开比对，杜绝利用双冒号压缩混淆绕过。

#### 2. 全量受限地址段黑名单 (Comprehensive IP Deny-List)
系统默认禁止向下列所有非公网单播与特殊用途 IP 发起出站 TCP 连接：
| 协议类型 | 地址类别 | 拦截 CIDR 范围 | 安全风险与防范说明 |
| :--- | :--- | :--- | :--- |
| **IPv4** | 本地环回 (Loopback) | `127.0.0.0/8` | 防止探测本地宿主机未授权服务 |
| | 本地网络 (This host) | `0.0.0.0/8` | 未指定源地址 |
| | 私有内网 (RFC 1918) | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | 除非在 `ALLOWED_OUTBOUND_IPS` 白名单中，默认禁止探测内网 |
| | 链路本地 / 云元数据 | `169.254.0.0/16` (含 `169.254.169.254`) | 严格阻断云厂商 Metadata 凭据外泄 (AWS, GCP, Aliyun) |
| | 运营级 NAT (CGNAT) | `100.64.0.0/10` | 运营商级共享内网 |
| | 组播与保留地址 | `224.0.0.0/4`, `240.0.0.0/4`, `255.255.255.255/32` | 广播组播滥用 |
| | 文档保留地址 | `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | 测试文档保留网段 |
| **IPv6** | 节点环回 (Loopback) | `::1/128` | 本机环回访问拦截 |
| | 未指定地址 | `::/128` | 未指定目标 |
| | 唯一本地地址 (ULA) | `fc00::/7` (RFC 4193) | IPv6 内部私有局域网，除非白名单显式放行 |
| | 链路本地地址 | `fe80::/10` | 邻居发现与链路内部保留 |
| | 组播地址 | `ff00::/8` | IPv6 组播 |
| | 文档保留地址 | `2001:db8::/32` | IPv6 示例保留网段 |
| | IPv4 映射地址 | `::ffff:0:0/96` | 统一解包按 IPv4 黑名单处理 |

#### 3. 双栈 (Dual-Stack) DNS 解析与 Fail-Closed 判定规则
- **A 与 AAAA 记录并发解析**：提取域名执行 DNS 解析时，必须同时查询所有 A 与 AAAA 记录；
- **全量无死角校验 (Fail-Closed)**：解析出的**所有物理 IP 地址必须逐一通过上述黑名单核验**；若其中任意一个 IP 命中受限网段，**整个请求必须立即 Fail-Closed 阻断拒绝**，返回 `403 ERR_SSRF_PROHIBITED`，防止轮询 DNS (DNS Round-Robin) 穿透内网；
- **IP Pinning 连接锁定**：校验通过后，后续实际网络 Socket 必须直接连向已通过安全核验的 `pinnedIp`，并严格复用该 IP，彻底免疫二次 DNS 重绑定 (Time-of-Check to Time-of-Use, TOCTOU) 攻击；
- **TLS 证书域名绑定**：底层 TCP 连向 `pinnedIp`，而 TLS 握手 SNI 与服务端证书核验的主机名（`servername` / `checkServerIdentity`）严格绑定为原始域名 `host`。"""

start_idx = text.find("### 5.3 全场景 SSRF 拦截与内网白名单引导 (`ERR_SSRF_PROHIBITED`)")
end_idx = text.find("### 5.4 超管防自残保护与排他事务自锁控制 (`ERR_LAST_SUPER_ADMIN`)")
if start_idx != -1 and end_idx != -1:
    text = text[:start_idx] + new_ssrf + "\n\n" + text[end_idx:]

# Update 5.5 PAT 72-char specification
old_pat = """1. **高强度单向安全存储**：
   - 生成：256-bit CSPRNG 安全随机数，前缀固定为 `mcp_pat_`，总长 48 位字符；
   - 存储：数据库仅持久化其 HMAC-SHA-256 不可逆哈希摘要（`token_hash`）及前 12 位脱敏展示前缀（`token_prefix`，如 `mcp_pat_8f3a...`）；"""

new_pat = """1. **高强度单向安全存储与 72 字符规范**：
   - 生成：256-bit CSPRNG 安全随机数（32 字节原始熵），采用 64 位十六进制小写编码，固定携带 `mcp_pat_` 前缀，Token 完整总长度固定为 **72 位字符**（格式匹配 `^mcp_pat_[0-9a-f]{64}$`）；
   - 展示脱敏：控制台仅暴露前 16 位脱敏前缀（`token_prefix`，如 `mcp_pat_8f3a9e2d...`）；
   - 存储：数据库仅持久化其 HMAC-SHA-256 不可逆哈希摘要（`token_hash`，64 位十六进制字符）。"""

text = text.replace(old_pat, new_pat)

with open('scripts/contract_generators/gen_part5_6.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated gen_part5_6.py")
