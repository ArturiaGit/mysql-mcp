# 后端详细设计第二轮复审报告

- 评审日期：2026-11-08（Asia/Shanghai）
- 评审对象：[后端详细设计 v1.1.0](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md)，包含其内嵌 TypeScript 示例及生成源分片。
- 原文 SHA-256：`3D32059ADEFC0724869D863E38CDB87DA6D8423A425CB33E92172B042A584173`
- 对照基线：需求 v2.3.0、总体架构 v1.2.1、前端详设 v1.4.0；上一轮报告及探针。
- **结论：仍需修改后复审（Request Changes），不能认定“全部闭环 / Verified Baseline”。**
- 本轮合并为 **10 项需修改问题：7 项 P1、3 项 P2**。问题编号使用 `BE-R2-xx`，避免与上一轮混淆。

## 一、复审结论与验证边界

修订确有实质进展：上一轮的表达式子查询漏表、普通 POST 误取消、UNION 首分支 LIMIT 误判、小配额放大、普通审计双写失败丢计数、高危审计降级后错误成功、UTF-8 单元格截断等原始触发样例已修正。其中管理员事务审计仅做静态核对，其他相应探针结果见证据文件，不能将这些局部通过扩大为整条链路通过。

但新增连接流桥接会混淆收发方向；墓碑清除没有并发代际约束；ID 没有统一规范表示；TLS 升级后连接元数据丢失。SSH、特殊表名 ACL、通知和停机审计也存在反例。这些不是排版或措辞问题，需先修正算法及契约，再推进对应核心模块实现。

### 本轮实际做了什么

1. 直接提取当前详设中的 TypeScript 代码块，转译后在受控依赖替身下执行，不手写替代算法来“验证”原文。
2. 使用 **Node.js v22.22.0**（目标主版本）、`typescript@5.9.3`、`node-sql-parser@5.4.0`、`mysql2@3.24.6`、`fastify@5.12.8`。parser 与 mysql2 对齐文档精确锁定版本。
3. HTTP 断连与 TCP 收发使用真实回环连接；TLS 元数据测试调用实际锁定驱动的 `startTLS`，仅替换 TLS 建连返回值；SSH 用假客户端记录校验和转发目标；管理员 SQL 用事务替身记录执行路径。
4. 完成 **27 条观察：15 条不变量成立、12 条被反例否定，归并为下述 10 项问题**。这些不是端到端验收测试的通过率；同一问题可能对应多条观察，脚本退出码 0 仅代表观察完成。
5. 按生成脚本规定的 11 个源分片顺序重新计算拼接结果，与当前正文完全相同。未修改正文、源分片或上一轮证据。

**未做：** 工作区没有可运行的后端 `apps/` / `packages/` 工程，且不是 Git 仓库。没有执行真实 MySQL 查询、冻结账号、KILL/RESET、证书握手、SSH 登录、远端 SSRF 探测，也没有完成完整 `tsc`。下文的数据库实际命中与拓扑影响，是基于设计路径及官方语义的条件性分析，不冒充真库攻击结果。

## 二、10 项需修改问题

### BE-R2-01 [P1] ID 前导零别名绕过自操作、最后超管检查，并错投墓碑与取消键

**定位：** [§3.3 L451–465](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L451)、[UserService L924–945](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L924)、[更新及失效 L962–1000](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L962)；另有 [重复 normalizer L1484–1488](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1484)。

`toEntityId('01')` 返回 `'01'`，而驱动读出的账号 ID 是 `'1'`。服务用字符串相等判断是否本人，用 `Set.has(targetUserId)` 判断是否最后超管；数据库却按数值主键比较。因此同一个数据库账号拥有两个应用身份表示。

**本轮观察：** 假定唯一活跃超管为 ID `'1'`，直接运行原文 `UserService.updateUserStatus`：

| target / operator | 自操作或最后超管阻断 | 是否进入 UPDATE | 墓碑 / 取消键 |
|---|---|---|---|
| `'1'` / `'1'` | `ERR_SELF_OPERATION_FORBIDDEN` | 否 | 无 |
| `'01'` / `'1'` | 未阻断 | 是，参数 `'01'` | `'01'` |
| `'01'` / `'2'` | 未阻断最后超管检查 | 是，参数 `'01'` | `'01'` |

SQL 仅由替身记录；在真实 BIGINT 主键上，`'01'` 与数值 1 的比较语义使其指向账号 1。这会导致保护检查与实际写入对象分裂，且账号 `'1'` 的旧查询不匹配 `'01'` 的取消键。另一 normalizer 还接受已失精的 number：输入 `Number('9007199254740993')` 被保留成 `'9007199254740992'`。

**修改要求：** 只保留一个全链路规范化入口。字符串应拒绝前导零或用 `BigInt(...).toString(10)` 规范化，再核验无符号 64 位范围；拒绝负 bigint、越界值及不安全 number。DTO、Repository、Registry、Snapshot、限流和取消键统一复用此入口，而不只是定义 `type EntityId = string`。

**验收：** `'1'`、`'01'`、带空格别名必须被统一为同一身份或在入口拒绝；本人和最后超管保护仍生效，失效及取消必须落到实际账号键；相邻超大 ID 不碰撞。

**证据：** `original_canonical_self_operation_guard`、两条 `new_leading_zero_entityid_guard`、`new_runtime_entityid_normalizer`。

### BE-R2-02 [P1] 同一个 PassThrough 双向 pipe 会把服务端数据回送，并把客户端写入交给自身解析

**定位：** [业务池 L2657–2658](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2657)、[SSH L2702–2704](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2702)、[TCP L2727–2729](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2727)；维护通道 [L2889–2911](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2889) 同样存在。

`socket.pipe(bridge); bridge.pipe(socket)` 并不能让同一个 `PassThrough` 成为方向独立的网络代理。它把写入转为自身可读输出，驱动和对端同时消费这份输出，造成交叉回送。

**真实回环 TCP 观察：** 服务端只发送一次 `SERVER_GREETING`，从不 echo；客户端写 `CLIENT_COMMAND`。最终两侧都收到了 `SERVER_GREETINGCLIENT_COMMAND`：服务端收回自己的 greeting，驱动读回自己的 command。该桥接不能支撑正确的 MySQL 握手/查询协议。

**修改要求：** 使用真实 socket，或构造读写方向相互独立的 Duplex：驱动 `_write` 只写远端，远端输入只 `push` 给驱动；处理 backpressure、half-close、error 和 destroy 的所有权。直连、SSH 与 KILL 通道使用同一经验证的连接工厂，不能再用同一 Transform 环接收发。

**验收：** 单向 greeting 只能到驱动，单向 command 只能到服务端；随后分别进行真实 TCP/SSH MySQL 握手、TLS、查询及 KILL 集成测试。

**证据：** `new_transport_directionality`。

### BE-R2-03 [P1] 旧的异步权限重载可清除较新的冻结墓碑，并回退鉴权版本

**定位：** [RegistryHub L1706–1735](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1706)，尤其 L1731–1735。

同步打墓碑修复了单次重载失败的窗口，但 `reloadUserAuthFromDb` 在 SELECT 完成后无条件发布版本并删除墓碑，没有记录重载启动时的 invalidation generation，也不校验读到的版本是否足够新。

**反例时序：** 更新 A 已提交 ACTIVE v2，其重载读到 v2 但尚未发布；随后冻结 B 提交并再次置墓碑（当前版本推进到 v3）；A 的旧重载最后返回。实际代码把版本回退为 2 并删除 B 的墓碑。调用原文二次鉴权函数后，v2 旧快照重新获准执行。

**本轮观察：** `invalidatedBeforeOldReload=true` → `invalidatedAfterOldReload=false`，`currentVersion=2`，`oldSnapshotAllowed=true`。

**修改要求：** 失效记录维护单调递增代际及要求的最小 auth version；重载捕获代际，发布前检查“仍是同一次失效”且版本不回退，较新的墓碑不得被较旧结果删除。角色/ACL 等授权聚合应与版本一致发布，而不只是更新状态和版本数字。

**验收：** 角色变更后立即冻结、改密与降级并发、DB 回调乱序、重载失败后重试，均不能回退授权版本或复活旧快照。

**证据：** `new_stale_reload_clears_new_tombstone`；使用已提交的旧版本 v2，不依赖假设副本返回提交前 v1。

### BE-R2-04 [P1] TLS 升级替换 conn.stream，丢失同源 KILL 租约与每查询字节计数复位入口

**定位：** [元数据写到 bridge L2661–2663](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2661)、[L2720–2725](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2720)、[借出后从当前 stream 读取 L2790–2797](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2790)；取消使用 [L3023–3028](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3023)。

保留逻辑域名与启用 `verifyIdentity` 是正确修订，但锁定驱动在 `startTLS` 中将 `this.stream` 替换为新 TLS 流。自定义字段只存在原始 transport 上，借出连接时却读取当前 TLS 流。

**本轮观察：** 实际驱动 `startTLS` 执行后，`streamWasReplaced=true`，旧 transport 有 endpoint，新 stream 的 `__verified_endpoint` 与 `__resetWireByteCounter` 均不存在。测试没有做真实 TLS 握手，也没有验证证书结果。

**影响：** 同源取消缺少原始 pinned endpoint，维护通道可退回重新解析 DNS，无法保证命中相同后端实例；wire guard 失去借出时复位，可能按整条连接累计，而不是按每次查询累计。此问题独立于 BE-R2-02；修好流方向后仍会遇到。

**修改要求：** endpoint、generation 和字节守卫句柄存于稳定的连接租约/WeakMap，而非依赖可替换的 `.stream`；TLS 升级前后显式传递。KILL 必须使用原连接目标租约，缺失时拒绝或销毁原连接，不能静默用当前配置重新选实例。

**验收：** TLS 连接连续复用多次，每次 wire 预算重置；DNS/配置在连接建立后变化，KILL 仍命中原实例。错误域名证书、SNI 和 SSH+TLS 另需真实集成验证。

**证据：** `new_tls_transport_metadata`。

### BE-R2-05 [P1] 带库名前缀的真实 dual 表被当作无表查询，漏过表级 ACL

**定位：** [ScopeExtractor L2145–2177](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2145)，尤其 L2149；无表归类 [L2205–2216](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2205)。

代码先判断 `rawTable !== 'dual'`，随后才处理显式库名。于是 SELECT * FROM `app`.`dual` 中的 `app.dual` 被整体忽略。MySQL 的无表占位 DUAL 与显式限定、引用的物理表名不是同一种语法对象。

**本轮观察：** 锁定 parser 对该 SQL 的提取结果为 `tables=[]`、`isKnownNoTableQuery=true`。**若受管库存在真实的 `app`.`dual` 表**，表级黑白名单拿不到此物理引用，不能依赖后续表 ACL 阻断它；这里没有声称已在真库创建该表并读取数据。

**修改要求：** 显式数据库限定引用必须优先进入物理表集合。仅对能明确识别的非限定伪表 DUAL 作特殊处理；对反引号实体或 parser 无法保留的区别，应进一步判别或 fail closed。

**验收：** 在 MySQL 中创建受 ACL 限制的 `app`.`dual` 实表；限定引用必须被提取并受限，同时合法无表 SELECT/DUAL 仍按既定策略工作。

**证据：** `new_qualified_dual_extraction`。

### BE-R2-06 [P1] SSH 只校验堡垒机，forwardOut 的最终数据库目标未经过安全校验和固定

**定位：** [openTunnelStream L3357–3377](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3357)、[仅校验堡垒机 L3394–3396](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3394)；业务 endpoint 写为 127.0.0.1 见 [L2694–2700](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2694)。

`resolveAndValidateHost` 只用于 SSH host，`targetHost/targetPort` 原样交给 `forwardOut`。允许访问堡垒机，不意味着允许该堡垒机访问任意目的地址；同一堡垒机再次解析同一数据库域名，也不意味着同一 MySQL 实例。

**本轮观察：** 使用假 SSH 客户端调用目标 `169.254.169.254:80`，安全 guard 的调用列表只有 `bastion.example`，转发仍被请求。没有向真实元数据地址发包。

**修改要求：** 为远端转发目标定义独立的 allowlist/SSRF 策略、获批私网范围与固定目标契约；必要时通过堡垒机侧的可信解析/策略强制，而不是用本机 DNS 结果假装等同远端解析。连接租约记录真实转发目标，业务与维护通道使用同一目标快照；不能用虚构的本地地址代表验证结果。

**验收：** 禁止的回环、链路本地、元数据和未授权私网目的地在 SSH 模式下也拒绝；允许的远端目标可达；DNS/配置切换后取消仍命中原实例。

**证据：** `new_ssh_forward_target_guard`。

### BE-R2-07 [P1] SSH 指纹缺失时没有 hostVerifier，宣称“强制核验”实际 fail-open

**定位：** [SSH 连接配置 L3425–3431](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3425)；与开篇“Host Key sha256 指纹强制核验”声明矛盾。

仅当配置了 `host_fingerprint_sha256` 才安装 verifier。缺少该字段时仍继续连接；ssh2 未配置 verifier 的默认行为是接受主机密钥。IP 校验不能替代服务器身份核验。

**本轮观察：** 未给指纹时仍成功进入受控客户端的通道创建路径，`hostVerifierConfigured=false`。假客户端不能证明真实中间人攻击，但足以证明设计没有建立强制信任门槛。

**修改要求：** 已启用 SSH 的 profile 必须具备经验证的可信指纹/known_hosts 信任记录，缺失即拒绝建连；如需首次登记，应另设受控确认流程。固定指纹编码规范，并设计轮换、缓存失效及审计。

**验收：** 缺失、格式错误、不匹配指纹全部拒绝；正确指纹通过；热更新后旧 client 的信任上下文不能被复用到新目标。

**证据：** `new_ssh_hostkey_required`。

### BE-R2-08 [P2] 审计 stopAndFlushAll 不等待正在运行的刷盘，停机可带未落盘事件返回

**定位：** [L3996–4002](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3996)、[L4080–4082](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4080)；进程退出流程见 §1.2。

后台 flusher 工作时 `isFlushing=true`，停机再调 `flushBatch()` 直接 return，不是加入正在运行的 Promise。`stopAndFlushAll()` 因而提前完成，后续可关闭元数据库或退出。

**本轮观察：** 一个审计事件的 DB Promise 被人为挂起；调用 stop 后 25ms，stop 已返回，但 `totalUnflushedCount=1` 且 `isFlushing=true`。随后释放 DB Promise，仅用于清理探针。

**修改要求：** 维护可等待的 single-flight flush Promise；stop 切换 closing 状态、阻止新 reservation，等待已有刷盘、队列及高危写入完成。超 deadline 的降级持久化及退出状态也需明确，不能把“不再启动一次刷盘”当作“全部排空”。

**验收：** 在后台刷盘和高危写入各阶段触发停机；只要仍有未持久化事件，正常排空 Promise 就不能提前成功。

**证据：** `new_audit_shutdown_wait`。

### BE-R2-09 [P2] 结果仍被响应持有时就释放用户内存预算，25MB 上限不覆盖结果生命周期

**定位：** [release L3183–3187](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3183)、[end L3256–3267](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3256)；超限提前返回分支同样释放后返回已有 rows。

`end` 代表数据库读完，不代表 HTTP/MCP 响应中的 `rows` 已释放。当前在 resolve 携带 rows 之前就清零用户计数。序列化及慢客户端发送期间，结果仍可被持有，新的请求却看到已释放的预算。

**本轮观察：** 接收 1 行后计数 20 字节；触发 end 后计数归零，但返回对象仍保留 1 行。没有将这条小样例夸大为已观测到 OOM；它验证的是预算所有权过早释放。

**修改要求：** 将结果预算作为 response/result lease 转交，直到响应 finish/close 或调用方显式丢弃后释放；同时处理序列化副本、单元格转换临时内存和取消路径。若 25MB 仅计划约束“正在读库阶段”，必须收窄声明，并另给整体内存边界。

**验收：** 单用户连续查询叠加慢响应/序列化阻塞，未完成响应的结果仍占预算，预算达到上限时拒绝或背压；完成/取消后只释放一次。

**证据：** `new_result_memory_ownership`。

### BE-R2-10 [P2] 通知 lookup 未遵守 all:true 回调契约，在目标 Node 22 下报无效 IP

**定位：** [NotificationService L3855–3858](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3855)。

自定义 lookup 忽略 options，始终 `callback(null, pinnedIp, family)`。Node 22 默认自动地址族选择路径会要求 `all:true`，此时应返回地址对象数组，而不是单个 IP 字符串。

**本轮观察：** 原文通知方法使用 pinned `127.0.0.1` 的受控 guard，在任何外网连接前报 `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined`。本轮的 Node v22.22.0 与前期 Node24 探索结果一致；这不是通知服务端故障。

**修改要求：** 按 `options.all` 分支返回数组/标量，或显式使用与 pinning 一致的 family 和地址族策略；保持 TLS 逻辑主机名。另需用整体 deadline 覆盖 DNS、握手和响应，不能仅依赖空闲超时。

**验收：** 在目标 Node22 默认配置下分别测试 IPv4/IPv6 pinned HTTPS、本地受控 TLS、错误证书及超时，不得再出现 lookup 返回结构错误。

**证据：** `new_webhook_lookup_contract`。

## 三、上一轮 15 项问题的复核状态

“原触发已修复”仅表示给定触发条件或展示路径已修正，不自动等于所在模块通过集成验收。

| 上轮编号 | 本轮判定 | 依据 / 剩余项 |
|---|---|---|
| BE-R01 AST 漏表 | 部分修复 | 原 4 条表达式/子查询提取通过；仍有限定 dual 漏检，见 R2-05 |
| BE-R02 HTTP 误取消 | 原触发已修复 | 真实 Fastify 普通 POST 不误 abort；断开后 abort |
| BE-R03 主路径无 SSRF | 部分修复 | 直连 guard 已接线；新 transport 方向错误，SSH 目标未校验，见 R2-02/06 |
| BE-R04 TLS 域名核验 | 部分修复 | 逻辑 host + verifyIdentity 已改；TLS 后租约丢失，且仍缺真握手验收，见 R2-04 |
| BE-R05 UNION LIMIT | 原触发已修复 | 首分支-only LIMIT 被拒绝；真实尾部全局 LIMIT 通过 |
| BE-R06 配额放大 | 原触发已修复 | `{5,10,1000,2,1}` 精确保留 |
| BE-R07 权限回收窗口 | 部分修复 | 单次墓碑前置正确；并发旧重载可清除新墓碑，见 R2-03 |
| BE-R08 wire / 内存边界 | 部分修复 | 无效选项已去除；TLS 复位丢失、响应持有期漏计，见 R2-04/09 |
| BE-R09 双失败丢审计 | 原触发已修复 | DB_DOWN + ENOSPC 后 queue=1、total=1，后续 reservation 被拒 |
| BE-R10 高危/事务审计 | 展示路径已修正 | 高危 DB 失败现 reject；管理员事务审计静态核对通过，未真库验证回滚 |
| BE-R11 停机顺序 | 部分修复 | 已不先等待 HTTP close 才取消；整体仍有审计 drain 反例，见 R2-08；SSE 关闭也需集成证据 |
| BE-R12 EntityId | 部分修复 | 主流程改 string，但规范化不统一且别名绕过保护，见 R2-01 |
| BE-R13 高危槽位漏计 | 原触发已修复 | 挂起高危写入时 totalUnflushedCount=1 |
| BE-R14 UTF-8 裁剪 | 原触发已修复 | 中文 120000→65536 字节，emoji 80000→65534；truncated=true |
| BE-R15 构造/方法不一致 | 静态对齐，待验收 | 相关构造及方法名已对齐；无完整工程、无完整 tsc，不能据此宣称可编译运行 |

汇总：**7 项原始触发/展示路径已修正、7 项部分修复、1 项静态对齐但缺工程验收。** 该分类用于追踪整改，不是再新增 15 项缺陷。

## 四、未计入 10 项数量的验收缺口

1. `RegistryHub.initializeAll()`（L1704）、`PoolManager.warmUpActiveProfiles()`（L2823）仍为空；未登记 profile 在 L1761 返回 active。注册表冷启动、加载失败及未知对象应明确 fail-closed，而不能用空实现承接“可直接实现的终稿”声明。
2. JSONL 的容量上限、轮换、重放、恢复去重等仍主要是文字约定；当前 `appendFile`（L4176–4182）不是完整的有界持久化机制。需单列恢复协议与故障验收，不因主队列反例修复就视为完成。
3. `globalRateLimit.qpmLimit` 未进入所示 quota 计算；用户级 burst 覆盖、SSE 主动关闭等开篇承诺需补齐接线和测试证据。这里仅列待闭合设计，不冒充已做全路径复现。
4. 文档开篇与末尾整改表的“100%”“全部闭合”应改为可追溯状态：已验证、静态核对、待实现、待集成。尤其不得拿上一轮旧证据文件的时间戳作为本修订通过的证据。

## 五、交付物与复现方法

- [本轮复现脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round2.repro.cjs)
- [本轮 Node22 观察证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round2.evidence.json)
- [上一轮评审报告，保留未覆盖](D:/E/PersonalProjects/mysql-mcp/docs/reviews/BACKEND_DESIGN_REVIEW.md)

依赖安装在工作区外，不需要在该设计仓库创建 package.json / node_modules。以下示例使用 PowerShell，在仓库根目录执行；需要 Node/npm 可用及网络访问 npm registry：

```powershell
$repo = 'D:\E\PersonalProjects\mysql-mcp'
$deps = Join-Path $env:TEMP 'mysql-mcp-design-review-round2-deps'
npm install --prefix $deps --no-save --no-audit --no-fund typescript@5.9.3 node-sql-parser@5.4.0 mysql2@3.24.6 fastify@5.12.8
$runtime = Join-Path $deps 'node22'
npm install --prefix $runtime --no-save --no-audit --no-fund node@22.22.0
$node22 = Join-Path $runtime 'node_modules\node\bin\node.exe'
$env:NODE_PATH = Join-Path $deps 'node_modules'
# 避免覆盖已交付证据，另写 rerun 文件；该脚本会执行受信任本地文档代码。
$env:REVIEW_EVIDENCE_FILE = Join-Path $deps 'round2-rerun.evidence.json'
try {
  & $node22 --check "$repo\docs\reviews\backend-design-review-round2.repro.cjs"
  & $node22 "$repo\docs\reviews\backend-design-review-round2.repro.cjs" "$repo\docs\BACKEND_ARCHITECTURE_SPEC.md"
} finally {
  Remove-Item Env:\NODE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\REVIEW_EVIDENCE_FILE -ErrorAction SilentlyContinue
}
```

脚本是**当前文档版本的观察性复现**，不是完整后端单元测试框架；依赖替身不验证 SQL 事务真实语义、远端 DNS、证书信任或 MySQL 线程身份。后续修订应先比对证据中的 specSha256，再复跑并补齐集成测试。

## 六、核验使用的官方资料

以下仅说明外部 API/数据库语义依据；本地反例以原文和本轮 JSON 证据为准。没有使用第三方博客作为关键结论依据。

- Node.js 22 Stream 文档：PassThrough 是输入到输出的 Transform，不提供独立网络收发方向。`https://nodejs.org/docs/latest-v22.x/api/stream.html`
- mysql2 v3.24.6 官方源码 `lib/base/connection.js`：`startTLS` 最后替换 `this.stream`。`https://raw.githubusercontent.com/sidorares/node-mysql2/v3.24.6/lib/base/connection.js`
- MySQL 8.0 官方类型转换规则：数值和字符串比较涉及隐式数值转换。`https://dev.mysql.com/doc/refman/8.0/en/type-conversion.html`
- MySQL 8.0 官方语法：`from_tables` 区分 `DUAL_SYM` 和 `table_reference_list`，`table_ident` 接受库限定标识符。`https://raw.githubusercontent.com/mysql/mysql-server/8.0/sql/sql_yacc.yy`
- ssh2 v1.17.0 官方 README：未配置 hostVerifier 时默认接受密钥。`https://raw.githubusercontent.com/mscdex/ssh2/v1.17.0/README.md`
- Node.js 22 Net 文档：autoSelectFamily 使用 lookup 的 `all:true` 返回契约。`https://nodejs.org/docs/latest-v22.x/api/net.html`

**下一轮准入建议：** 先修复 7 项 P1 并提交对应正常/反例双向测试，再处理 3 项 P2；补齐冷启动、审计恢复和可编译工程骨架。对 TCP/TLS/SSH/KILL、并发权限回收及停机 drain 提供真实集成证据后，再讨论“Verified Baseline”。
