## 第五章：并发控制与安全防护契约

### 5.1 乐观并发控制规范 (Optimistic Locking & Versioning)

在控制台多管理员并发治理环境下，为避免后提交者静默覆盖前者的配置变更，系统在所有核心业务实体上实施**强校验乐观并发控制 (CAS)**：

#### 1. 纳管实体与版本来源
| 业务实体 | 对应数据表 | 版本来源字段 | 最小自增步长 | 说明 |
| :--- | :--- | :--- | :---: | :--- |
| **数据源配置** | `sys_profiles` | `version` (INT UNSIGNED) | +1 | 每次更新连接参数或热重载连接池时自增 |
| **角色策略模版** | `sys_roles` | `version` (INT UNSIGNED) | +1 | 每次修改默认 LIMIT、配额或超时时间时自增 |
| **表级 ACL 规则集** | `sys_roles` / `sys_role_table_acls` | 共享父记录 `sys_roles.version` | +1 | 全量替换表级 ACL 规则时原子校验并递增父角色版本 |
| **库级 ACL 规则集** | `sys_roles` / `sys_role_database_acls` | 共享父记录 `sys_roles.version` | +1 | 全量替换库级 ACL 规则时原子校验并递增父角色版本 |
| **用户角色与状态** | `sys_users` | `version` (INT UNSIGNED) | +1 | 分配角色与启停账号时原子 CAS 校验，防止并发覆盖 |
| **全局限流规则** | `sys_rate_limits` | `version` (INT UNSIGNED) | +1 | `scope_type = 'GLOBAL'` 的系统基线限流 |
| **用户专属限流** | `sys_rate_limits` | `version` (INT UNSIGNED) | +1 | `scope_type = 'USER'` 的用户专属配额 (继承态 version=0) |
| **系统通知设置** | `sys_system_settings` | `version` (INT UNSIGNED) | +1 | Webhook 渠道启用与告警事件更新时自增 |

#### 2. 交互协议与 CAS 执行规则
- **GET 查询回显**：实体详情或列表中显式返回整数 `version`；
- **PUT 请求携带**：客户端在发起更新时，**必须在请求体根节点原样包含读取到的 `version`**；
- **服务端原子校验**：
  ```sql
  UPDATE sys_profiles 
  SET display_name = ?, host = ?, port = ?, ..., version = version + 1 
  WHERE id = ? AND version = ?;
  ```
  若影响行数 (`affectedRows`) 为 0，表明数据已被他人抢先更新，立即回滚事务并返回：
  ```http
  HTTP/1.1 409 Conflict
  Content-Type: application/json; charset=utf-8

  {
    "code": "ERR_CONCURRENCY_CONFLICT",
    "message": "当前配置已被其他管理员更新，请重新加载最新版本。",
    "timestamp": "2026-11-08T06:30:15.123Z",
    "action_guidance": "检测到版本号冲突，已保留您的修改草稿。请比对差异后重新提交。",
    "details": {
      "current_version": 3,
      "submitted_version": 2
    }
  }
  ```
- **前端草稿保护铁律**：前端接收到 409 状态码后，**严禁清空用户的当前表单**，必须保持用户的本地输入草稿，弹出冲突差异提示条，允许管理员查看远端变更并手动合并提交。

### 5.2 连接路径与信任边界变更防外泄铁律 (端点适用范围精准界定)

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
- **SSH 独立防外泄约束**：若在测试已存配置草稿时修改了 `ssh_host`、`ssh_port` 或 `ssh_user`，必须在请求体中提供新 `privateKey` 与 `hostFingerprintSha256`；若未填新私钥则抛出 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`；若跳板机参数未变且携带 `profile_id`，允许复用库内已解密私钥测通。

### 5.3 全场景 SSRF 深度防御与双栈地址过滤策略 (`ERR_SSRF_PROHIBITED`)

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
- **TLS 证书域名绑定**：底层 TCP 连向 `pinnedIp`，而 TLS 握手 SNI 与服务端证书核验的主机名（`servername` / `checkServerIdentity`）严格绑定为原始域名 `host`。

### 5.4 超管防自残保护与排他事务自锁控制 (`ERR_LAST_SUPER_ADMIN`)

超级管理员具备系统最高治理权限，为杜绝由于误操作或并发竞争导致系统中“无任何可用超级管理员”的系统性瘫痪（自残），系统在数据库事务级建立刚性保护：

1. **本人操作防护 (`ERR_SELF_ACTION_PROHIBITED`)**：
   - 超管用户不可在用户列表中调用接口将自己的账号设为 `DISABLED`；
   - 超管用户不可调用接口删除自己的用户账号；
   - 超管用户不可在分配角色时将自己的 `SUPER_ADMIN` 角色移除；
   - 违反者一律拦截返回 `400 ERR_SELF_ACTION_PROHIBITED`；
2. **并发排他判定与“仅存最后一名超管”自锁保护 (`ERR_LAST_SUPER_ADMIN`)**：
   当管理员尝试停用、删除或降级其他超级管理员账号时，后端必须在事务内加排他锁判定操作后的剩余超管数：
   ```sql
   -- 所有授予/撤销、启停、删除、审批授予都先锁永久角色行。
   SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE;
   SELECT id, status FROM sys_users ORDER BY id FOR UPDATE;
   SELECT user_id FROM sys_user_roles WHERE role_id = ? ORDER BY user_id FOR UPDATE;
   -- 用当前读集合计算本次操作后的ACTIVE超管数量（仅实际减少集合时检查）。
   ```
   若计算出的 `active_super_admins < 1`，事务立即自动回滚，并抛出：
   ```http
   HTTP/1.1 400 Bad Request
   Content-Type: application/json; charset=utf-8

   {
     "code": "ERR_LAST_SUPER_ADMIN",
     "message": "操作已被阻止：系统必须保留至少 1 名活跃超级管理员。",
     "timestamp": "2026-11-08T06:30:15.123Z",
     "action_guidance": "当前目标用户为系统仅存的最后一名活跃超级管理员。请先激活或指派其他超级管理员账号，再对当前账号执行变更。"
   }
   ```

### 5.5 PAT 个人访问令牌生命周期与“单次明文展示”契约

个人访问令牌（PAT）用于大模型 Agent 接入数据面网关时进行身份凭证鉴权：

1. **高强度单向安全存储与 72 字符规范**：
   - 生成：256-bit CSPRNG 安全随机数（32 字节原始熵），采用 64 位十六进制小写编码，固定携带 `mcp_pat_` 前缀，Token 完整总长度固定为 **72 位字符**（格式匹配 `^mcp_pat_[0-9a-f]{64}$`）；
   - 展示脱敏：控制台仅暴露前 16 位脱敏前缀（`token_prefix`，如 `mcp_pat_8f3a9e2d...`）；
   - 存储：数据库仅持久化其 HMAC-SHA-256 不可逆哈希摘要（`token_hash`，64 位十六进制字符）。
2. **单次明文返回契约 (Single-Viewing Secret Contract)**：
   - 完整的 Token 明文（`rawToken`）**仅在调用 `POST /api/v1/pats` 成功的单次响应体中返回**；
   - 随后的所有 `GET /api/v1/pats` 列表接口中，绝不返回明文，仅展示 `token_prefix` 与脱敏占位符；
3. **前端防呆确认模态框 (`PatModal`)**：
   - 创建成功后，前端展示全屏遮罩的凭证防呆弹窗，包含：
     - 明文复制按钮与显隐切换开关；
     - 显式警告文案：“该令牌密钥仅显示一次，离开页面后将无法找回。请立即复制并妥善保管”；
     - 三态配置片段一键生成器：实时生成 Cursor、Claude Desktop、LibreChat 的 `mcpServers` JSON 配置模板。