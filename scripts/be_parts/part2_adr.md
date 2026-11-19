## 第二章：后端技术栈选型与工程决策记录 (ADR-BE)

### 2.1 ADR-BE-01: 核心依赖精确版本锁定与 Fastify v5 双实例架构
- **决策结论**：在根 `package.json` 与 `pnpm-lock.yaml` 中精确锁定核心运行时库版本（禁止 `^` 或 `~` 范围漂移）：
  - **`mysql2: "3.24.6"`**
  - **`node-sql-parser: "5.4.0"`**
  - **`fastify: "5.12.8"`**
  - **`@node-rs/argon2: "2.0.2"`**
  - **`ssh2: "1.16.0"`**
- **技术评估与工程收益**：
  1. **消除解析器与驱动源码行为漂移**：SQL AST 节点结构（如 `expr_list.value`、`_next` 链条）和 `mysql2` 内部 `startTLS` / `reset` 实现与具体小版本强相关，精确鎖定版本使安全不变量 100% 可复现；
  2. **无副作用 CSRF 边界**：在 Fastify `preValidation` 钩子完成 CSRF 验签，确保 `ERR_CSRF_INVALID` 100% 零写副作用。

---

### 2.2 ADR-BE-02: `mysql2@3.24.6` 双模连接策略与自定义 `stream` 工厂（兼顾 IP Pinning 与 TLS `verifyIdentity`）
- **决策结论**：
  - 系统元数据库 (`MetadataPool`) 使用 `mysql2/promise` 并强制开启 `supportBigNumbers: true, bigNumberStrings: true`；
  - 业务数据面 (`ManagedProfilePool`) 与维护通道 (`AdminMaintenanceChannel`) 统一使用原生 callback 风格的 `mysql2@3.24.6`，**保留 `host: cfg.host`（逻辑域名）并开启 `ssl: { ...tlsConfig, rejectUnauthorized: true, verifyIdentity: true }`，同时通过 `mysql2` 的 `stream` 工厂函数建立底层连接（直连 SSRF 校验后的 `pinnedIp` 或 `ssh2` 隧道流）**。
- **技术评估与工程收益（彻底根治 `BE-R03` 与 `BE-R04`）**：
  1. **`mysql2@3.24.6` 源码级事实对齐**：经核验 `mysql2@3.24.6` 的 `lib/base/connection.js` 源码，其 `startTLS()` 内部通过 `const servername = net.isIP(this.config.host) ? undefined : this.config.host` 计算 SNI，且通过 `this.config.ssl.verifyIdentity` 决定是否校验服务端证书主机名，**完全不读取 `this.config.ssl.servername`**；
  2. **为什么必须用 `stream` 工厂 + 保留逻辑 `host`**：若直接把 `config.host` 替换为 `pinnedIp`，`net.isIP(this.config.host)` 为 `true`，会导致 `servername` 变为 `undefined`，TLS SNI 与证书域名校验全部失效！而通过保持 `config.host = cfg.host`（原始域名），并提供自定义 `stream: () => Duplex` 工厂，在工厂内部调用 `ssrfGuard.resolveAndValidateHost(cfg.host)` 得到 `pinnedIp` 后用 `net.connect(cfg.port, pinnedIp)` 建立底层 TCP Socket，既保证了 **TCP 层 100% 连向已验证的 `pinnedIp`（免疫 DNS 重绑定）**，又让 `mysql2` 在该 Socket 之上发起 TLS 握手时**原生使用 `cfg.host` 发送 SNI 并执行严格的主机名证书核验（`verifyIdentity: true`）**！

---

### 2.3 ADR-BE-03: Argon2id 密码哈希（带并发信号量保护）与 HMAC-SHA256 常量时间验签
- **决策结论**：
  - 用户密码采用 **`Argon2id`**（`memoryCost: 65536 (64MB)`, `timeCost: 3`, `parallelism: 4`），并在认证服务外层加装**进程级并发信号量（`Argon2Semaphore`，最大并发数 `8`，排队上限 `32`）**；
  - PAT 令牌采用 256-bit CSPRNG 随机串，验签采用 `HMAC-SHA-256(SERVER_PEPPER, rawToken)` + `crypto.timingSafeEqual`。
- **技术评估与工程收益**：
  - 单次 Argon2id 消耗 64MB 内存与约 40ms CPU。若未认证攻击者瞬间并发发起数百次登录请求，无界调用 Argon2id 会导致内存暴涨与事件循环阻塞。引入容量为 8 的 `Argon2Semaphore` 将密码哈希最大瞬时内存严格限制在 `512MB` 以内，超出排队上限直接快速返回 `429 Too Many Requests`。

---

### 2.4 ADR-BE-04: 数据库显式乐观锁版本号 (`version`) 与父子聚合版本控制
- **决策结论**：在 `sys_profiles`、`sys_roles`、`sys_rate_limits`、`sys_system_settings` 表显式定义 `version INT UNSIGNED NOT NULL DEFAULT 1`；一对多规则子表（`sys_role_table_acls`、`sys_role_database_acls`）共享并递增父角色 `sys_roles.version`。

---

### 2.5 ADR-BE-05: 业务连接池与同源独立 `AdminMaintenanceChannel` 物理隔离
- **决策结论**：每个 Profile 的 `AdminMaintenanceChannel` 独立于业务连接池之外（不占用业务池连接槽位，杜绝业务池 100% 满载排队时 `KILL QUERY` 自身排队死锁），但**强制复用目标连接创建时的同一已验证端点描述符（`VerifiedTargetEndpoint`：含 `pinnedIp` 或同一 `SshTunnelManager` 实例）**，确保 `KILL QUERY <threadId>` 100% 路由至原查询所在的同一物理 MySQL 实例。

---

### 2.6 ADR-BE-06: 事务内强一致管理审计 + 内存 RingBuffer 无损转移与双败回退锁死机制
- **决策结论（彻底根治 `BE-R09`、`BE-R10`、`BE-R13`）**：
  1. **管理面写操作同事务强一致审计**：所有管理员写操作（用户冻结/解冻、角色变更、审批通过/驳回、PAT 签发/吊销、Profile/ACL/限流修改）必须在同一个元数据库事务（`withTransaction`）内同步插入审计记录；若审计写入失败，业务变更自动回滚，绝不出现“业务已生效但无审计”的状态；
  2. **数据面高危拦截强一致落库**：AST 违规、ACL 越权、SSRF 阻断等高危事件必须同步写入系统 MySQL，数据库故障时向上抛出异常，严禁将本地降级文件写入静默视为操作成功；
  3. **槽位无缝转移与双通道失败回退队首**：`reservedInflightSlots -= 1` 与 `flushingCount += 1` 同步原子执行；后台微批刷盘若遭遇数据库与本地 JSONL 同时失败（如 `ENOSPC`），在 `catch` 块中将批次原样 `this.queue.unshift(...batch)` 退回队列头部，保持 `totalUnflushedCount` 水位不归零，并触发不可写熔断。