# 后端详细设计评审报告

- 评审日期：2026-11-08（Asia/Shanghai）
- 评审对象：`docs/BACKEND_ARCHITECTURE_SPEC.md`，v1.0.0
- 原文 SHA-256：`FE8DB5F8A5F90BDEE003E90F9A0650376834DAAAA02A7B18601821C5D582427F`
- 对照基线：`docs/REQUIREMENTS.md` v2.3.0、`docs/ARCHITECTURE_SPEC.md` v1.2.1、`docs/FRONTEND_ARCHITECTURE_SPEC.md` v1.4.0，以及 `scripts/be_parts/` 文档源文件。
- 评审结论：**不通过本轮详细设计评审，建议修改后复审（Request Changes）。**

## 一、结论与边界

目前发现 **15 项需修改问题：10 项 P1、5 项 P2**。主要阻塞项不是文档格式，而是安全边界与示例算法存在可复现的不一致：表级 ACL 可漏检、普通请求误取消、生产连接池未执行 SSRF 校验、TLS 身份校验配置不成立、UNION 行数约束可绕过、角色小配额被放大，以及审计可靠性不满足声明。

这不意味着需要推翻单进程双面架构。双维限流、独立 KILL 通道、取消租约隔离、原生复位、CAS 版本等方向可以保留；但现阶段不应使用“100% 闭环”“可直接指导代码编写的终稿”等表述作为安全验收结论。

**本次是设计与示例代码评审，不是生产漏洞扫描或已实现后端的集成验收。** 当前工作区没有 `apps/`、`packages/` 或可运行的后端工程，也不是 Git 仓库。没有连接任何受管数据库，没有执行真实 MySQL KILL/RESET、TLS 握手或 SSH 隧道测试。结论明确区分如下：

1. 从原文直接提取 TypeScript 示例，在受控替身下执行，验证算法、参数、异常路径。
2. 用真实本地 Fastify 和回环 HTTP 请求验证 HTTP 事件及关停等待行为。
3. 核验精确锁定的 `mysql2@3.24.6` 配置解析及源码；同时查阅 Node.js/Fastify 官方文档和 mysql2 官方版本源码。
4. 缺少实现的安全时序按“详细设计未闭合”提出，不虚构端到端攻击成功结果。

验证环境：Node.js **v24.16.0**、Fastify **5.12.8**、mysql2 **3.24.6**、node-sql-parser **5.4.0**。文档目标 Node.js 是 22，故这些探针不能替代目标运行时回归。文档没有精确锁定 SQL parser 版本；本次解析器结果应作为固定 AST 契约与版本的依据，而不能被当作所有 parser 版本的结论。

优先级：P1 表示应在实现相应核心模块前修正的安全/核心正确性问题；P2 表示应在实现验收前修正的可靠性、契约或有界性问题。本报告不将原型设计问题直接定性为线上 P0 事故。

## 二、P1 问题

### BE-R01 — AST 遍历遗漏表达式列表与 JOIN 条件，表级 ACL 可被绕过

**定位：** 后端详设 L1856–1900，尤其 L1893–1898；§7.1 `ScopeExtractor`。

`visitNode` 仅递归固定字段集合，不递归 `expr_list.value`；处理 `fromItem` 时也没有遍历 `on`。结果是 `EXISTS`、`IN` 及 `JOIN ON` 中的物理表没有送入 ACL 检查，而标量子查询又可能正常提取，容易被基础测试掩盖。

最小复现：

```sql
SELECT * FROM orders WHERE EXISTS (SELECT 1 FROM secret_salary);
SELECT * FROM orders WHERE id IN (SELECT id FROM secret_salary);
SELECT * FROM orders o JOIN customers c
  ON c.id = (SELECT MAX(id) FROM secret_salary);
```

**实际观察：** 前两条仅提取 `app.orders`，第三条仅提取 `app.orders/app.customers`；三条均漏掉 `app.secret_salary`，且示例 `AstValidator` 均放行。对照组 `SELECT (SELECT MAX(id) FROM secret_salary) AS n FROM orders` 能提取敏感表。

**影响：** 当底层共享只读账号有敏感表 SELECT 权限、但当前用户的网关 ACL 没有该表权限时，可通过条件子查询读取/推断越权数据；“底层只读”并不补足用户级 ACL。

**修改要求：** 锁定解析器版本，基于真实 AST 建立查询块/表达式的完整 Visitor；覆盖 `value`、`on`、函数参数、派生表、集合运算和 CTE 作用域。未知结构应拒绝，不能因没有提取到表而视为安全。

**复验：** 上述三条、系统库子查询、嵌套 EXISTS/IN 和关联子查询必须提取全部物理表；任一表未授权时，不得借连接执行。

### BE-R02 — 将请求读取完成误当作客户端断开，正常 POST 会触发取消

**定位：** L1413–1418；§6.1 `buildStreamableHttpInvocation`。

示例在 `req.raw.on('close')` 中，只要 `!reply.sent` 就 abort。请求对象的 `close` 不是“等待响应期间底层 Socket 断开”的专属通知；正常请求体读取完成时，响应也通常尚未发出。

**实际观察：** 用本地真实 Fastify 接收正常 JSON POST，在尚未主动断开客户端之前，`abortSignal.aborted` 已经是 `true`。

**影响：** 正常 MCP 调用可能一进入执行流程就被取消，触发无意义 KILL/销毁连接；同时不能据此证明响应阶段断连已正确覆盖。

**修改要求：** 区分“请求上传中止”“响应完成前连接断开”“MCP 协议取消”三个信号；结合响应对象 `close` 与 `writableFinished` 等明确判定，清理监听器。不能将 Node.js 请求体读完事件直接绑定业务取消。SSE 的连接关闭也需遵守对应传输协议的取消/恢复语义，不能机械套用同一规则。

**复验：** 正常 POST/keep-alive 不触发 abort；客户端上传中断、执行中断连及合法 `notifications/cancelled` 触发对应调用的取消，且不影响其他请求。

### BE-R03 — 实际业务连接池跳过 SSRF Guard 和 IP Pinning

**定位：** L2253–2295，尤其 L2274–2277；§8.1 `ManagedProfilePool`。

构造器虽然注入 `ssrfGuard`，实际 `mysql2.createPool` 仍直接使用 `cfg.host`，没有解析和校验目标，也没有使用已校验的 pinned IP。§9.2 连通性测试的校验不等于正式业务连接的校验；测试后/重连时 DNS 记录仍可能变化。

**实际观察：** 通过 createPool 替身捕获配置，`resolveAndValidateHost` 调用次数为 **0**，池内仍是原始 `blocked.example`。

**影响：** 声明的全场景 SSRF 防护在数据面主路径不成立；业务建连/重连可能绕过禁用网段及 DNS 重绑定防护。

**修改要求：** 抽取统一的安全出站连接工厂，建立明确的异步池初始化流程；MySQL 业务连接、维护连接、测试和 SSH 通道均必须使用受校验目标。明确 pinned 目标的更新时机、重连语义与本地隧道例外，禁止验证后再次解析原域名。

**复验：** DNS 先返回允许 IP、后返回受禁 IP时，连接不得落到受禁 IP；默认拒绝的直填 IP、重连、新建池、热更新均须被覆盖。

### BE-R04 — `ssl.servername` 不被锁定驱动使用，IP Pinning 后的 TLS 身份校验承诺不成立

**定位：** L2287–2292、L2404–2412；§8.1、§8.2；另参见 §9.2 L2891–2898。

设计将 `host` 设为 pinned IP，再用 `ssl.servername = originalHost` 声称保留域名校验。但精确锁定的 `mysql2@3.24.6` 在 `startTLS` 中根据 `this.config.host` 计算 servername：host 为 IP 时得到 `undefined`；源码没有读取 `this.config.ssl.servername`。此外，该版本使用 `ssl.verifyIdentity` 控制身份校验，示例没有建立强制开启的基线。仅设置 CA/`rejectUnauthorized` 不等于完成目标域名核验。

**影响：** 不能保证 SNI 路由正确，也不能保证对原始数据库主机名进行证书身份校验。连通性测试还完全没有接收/沿用 TLS 配置，无法验证生产 TLS 链路。

**修改要求：** 选择并验证驱动实际支持的方案，例如保留逻辑域名并通过自定义 stream 连接 pinned IP，同时强制目标身份核验；不能只添加一个驱动未消费的字段。测试、业务和管理通道应共享 TLS 契约。

**复验：** pinned IP + 正确域名证书成功；同 CA 签发的错误域名证书必须失败；核验真实握手 SNI；测试模式与生产模式使用相同 TLS 约束。

### BE-R05 — UNION 分支 LIMIT 被误当作全局 LIMIT

**定位：** L2093–2105；§7.3 `LimitRewriter`。

当存在 `_next` 时，算法只检查 `root.limit`，却没有确认它是整条 UNION 的外层 LIMIT。对于本次 parser，首分支括号内的 LIMIT 在 `root.limit`，语句末尾的全局 LIMIT 则可能出现在末分支。

最小复现：

```sql
(SELECT * FROM orders LIMIT 1) UNION ALL SELECT * FROM orders;
```

**实际观察：** `maxLimit=20` 时，改写器原样接受上述语句；第二分支没有 LIMIT。反而 `SELECT * FROM orders UNION ALL SELECT * FROM orders LIMIT 1` 被拒绝。

**影响：** 可绕过“复杂 SQL 无法安全限行必须拒绝”的核心要求；5MB 输出上限不能替代数据库侧全局行数约束。

**修改要求：** 正确识别集合查询外层限定语义；暂不支持的结构一律拒绝，或在确认语义后构造安全外层 SELECT。对最终序列化 SQL 再解析验证，而非仅检查首节点。

**复验：** 覆盖首分支 LIMIT、末尾全局 LIMIT、嵌套 UNION、UNION ALL、OFFSET 和 EXPLAIN；无全局行数约束的查询不得执行。

### BE-R06 — 配额合并把默认值作为最小值，管理员配置的小配额失效

**定位：** L1512–1521；§6.2 `SnapshotBuilder`。

`Math.max(...roles, 50/500/15000/5/60)` 把兜底默认值纳入最大值计算。它不是“没有配置时才使用默认值”，而是强行给所有角色设置最低额度。

**实际观察：** 只有一个角色，配置 `{ defaultLimit:5, maxLimit:10, maxTimeoutMs:1000, userQpmLimit:2, maxInflightConcurrency:1 }`，最终变成 `{50,500,15000,60,5}`。

**影响：** 限额、超时、并发策略被静默放大；不符合总体架构 §5.4 的“只在实际角色间取最大值”算法。

**修改要求：** 先区分无角色/无有效配置，再做角色间聚合；默认值只用于约定的兜底路径。拒绝空授权主体，校验 defaultLimit 不超过 maxLimit；全局/角色/用户配额优先级需要显式传入和计算。

**复验：** 单个低配额角色保持原值，多角色仅取真实配置最大值；用户覆盖、-1、空角色和全局默认均有独立断言。

### BE-R07 — 事务提交后异步重载，没有权限回收失败时的 Fail-Closed 边界

**定位：** L241–251、L963–968、L1001–1003；§1.3、§4.4.1。

设计宣称“事务提交后 0ms 同步失效”，但实际示例先提交数据库事务，再 `await registryHub.reloadUserAuth(...)`，冻结用户的在途取消还放在重载成功之后。重载实现、耗时上限、失败 tombstone 和协调屏障均未给出。

**触发场景：** 冻结事务成功提交后，重载期间新请求仍可读到旧 ACTIVE 快照；若重载的数据库读取失败，示例直接抛错并跳过 `cancelQueriesByUser`。已经提交的冻结无法回滚，内存却可能继续放行。这是当前流程缺失的故障分支，不是已运行网关的攻击实测。

**修改要求：** 在提交后的同一同步控制段立即将受影响主体标记为不可用/版本失效，再做异步重载；重载失败持续拒绝而不是保留旧许可。明确每一类授权变更的线性化点、写入与发布失败恢复及在途取消责任；不使用没有工程定义的“0ms”作为 SLA。

**复验：** 对 commit 后、发布前插入并发请求；注入重载超时/失败。不得生成有效旧授权快照，冻结用户的在途查询必须触发有界取消。

### BE-R08 — `maxAllowedPacket` 是无效驱动配置，第一层内存保护不存在

**定位：** L2284、L2543–2545、L2590–2607；§8.1、§8.4。

文档将 `maxAllowedPacket: 16 * 1024 * 1024` 作为驱动协议包硬上限。但锁定版本的 mysql2 将该属性作为无效配置忽略；行事件回调里的 64KB 截断发生在驱动已接收/解码整行之后。

**实际观察：** 真实 `mysql2.createPool` 输出 `Ignoring invalid configuration option passed to Connection: maxAllowedPacket`；连接配置中没有该字段。

**影响：** 返回一个巨大的 TEXT/BLOB、或大量并发大行时，尚未进入业务截断即可产生远超声明的内存分配。“16MB 协议包 + 64KB 字段 + 5MB 结果 + 25MB 用户预算”的完整有界性不能成立；示例也未体现 25MB 用户级预算。

**修改要求：** 删除无效选项和虚假的安全保证，明确服务端 `max_allowed_packet`、单行/字段读取、JSON 字段、流背压、全进程/用户预算的真实约束位置；若选用驱动不能在解码前设置边界，就须限制受管库/字段规模、隔离资源或采用其他已验证方案。

**复验：** 大于声明上限的单 TEXT/BLOB/JSON、多列宽行和多用户并发场景，验证真实 RSS/heap 峰值；不能只用已经解码好的 mock 行测业务截断。

### BE-R09 — 数据库与本地降级文件同时失败时，审计批次被静默移出所有计数

**定位：** L3133–3139、L3185–3190；§10.1 `flushBatch`、`insertBatchWithFallback`。

批次先从 `queue.splice` 取出；数据库失败后追加 JSONL；若文件因磁盘满/权限问题继续失败，异常抛出，但 `finally` 仍递减 `flushingCount`，批次没有重新入队或进入待恢复状态。

**实际观察：** 注入数据库不可用和 `appendFile -> ENOSPC` 后，`flushBatch` 抛错，但 `queue.length=0` 且 `totalUnflushedCount=0`。下一次后台刷盘已拿不到原事件。`void flushBatch()` 还没有定义拒绝处理策略。

**影响：** 审计丢失且水位看起来恢复正常，网关继续接受请求；破坏有界队列和不可丢审计的核心承诺。

**修改要求：** 只有确认获得持久化归属后才移交并释放容量；双通道失败时保留批次、保持占用并触发不可写告警和拒绝新请求。定义后台 Promise 错误处理、恢复重放和幂等键。

**复验：** 同时模拟 DB_DOWN、ENOSPC、EACCES，再恢复任一存储；事件必须可恢复且不能重复成功入库；故障期间计数不应归零。

### BE-R10 — 高危审计的本地降级被当作成功，且管理员变更没有事务内审计契约

**定位：** L949–963、L977–1001、L3108–3111、L3167–3190；对照 PRD L264–267。

PRD 要求 PAT 签发/撤销、管理员审批/配置变更等安全核心事件，通过本地事务同步写入系统 MySQL，写入成功操作才完成。当前高危事件复用 `insertBatchWithFallback`，数据库三次失败、本地 JSONL 追加成功后仍正常返回。用户状态/角色变更事务示例也只有业务表更新，没有同事务安全审计记录或可靠 outbox。

**实际观察：** 高危 `commit` 在数据库不可用、仅 fallback append 成功时正常 resolve。对于业务变更，只能静态确认示例没有给出事务绑定，未声称进行了真实事务故障测试。

**影响：** “同步等待过一个函数”被误当成“已满足系统库强一致审计”；可能出现业务操作提交而安全核心审计没有同步入库的状态。

**修改要求：** 区分普通查询降级策略与安全核心审计提交条件。管理员写操作应在同一元数据库事务内写审计/经明确批准的事务 outbox；写入失败须阻止操作成功。若打算允许本地 WAL 代替 MySQL，必须先修改 PRD 的持久性与恢复契约，并设计 fsync、配额、重放、幂等和故障恢复，不能自行降格。

**复验：** 管理操作审计 INSERT 失败时业务变更回滚；高危审计 MySQL 不可用时不得按现有 PRD 返回成功；普通异步查询的容灾语义单独验收。

## 三、P2 问题

### BE-R11 — 先等待 HTTP close，再取消查询，关停可能永远到不了清理阶段

**定位：** L224–230；§1.2 graceful shutdown。

Fastify `close()` 会等待在途请求结束。代码先 await 两个 server close，随后才取消在途查询；对于长查询或 SSE，可能一直卡在 Step A，无法执行后续 KILL、销毁连接及审计下刷。

**实际观察：** 本地真实 Fastify 在处理器未释放时 `close()` 不完成，后续清理不可达。

**修改/复验：** 先切换 draining/readiness 并停止接纳，启动 close 但不阻塞取消；主动终止 SSE 与在途查询，等待统一清理完成，再 await 关闭并刷新审计。加入总关停 deadline 与明确失败退出策略。保持长连接时发送 SIGTERM，验证取消和审计 flush 均在预算内完成。

### BE-R12 — BIGINT 字符串契约在服务和内存索引中被重新转成 number

**定位：** L968、L974–982、L1459–1489、L2448–2453、L3296、L3301；§4.2 反向对照。

元数据库驱动输出字符串并不能抵消后续 `Number(targetUserId)`、`number[] roleIds`、`Map<number,...>` 的精度损失。前端/输出示例也仍存在 `{ id: number }`。

**实际观察：** `Number('9007199254740992') === Number('9007199254740993')`。用于用户/角色/PAT/Profile 身份比较、在途取消和配额索引时会产生碰撞。

**修改/复验：** 实体 ID 自 DTO、repository、snapshot、registry 到 lifecycle/Map key 全程使用规范十进制 string，禁止 Number 转换；MySQL threadId 等独立协议数值单独建类型。用两个相邻超 53 位 ID 验证分离授权与定向取消。此问题通常需极大/导入 ID 才触发，故本轮定为 P2，而不是宣称当前自增用户已可碰撞。

### BE-R13 — 高危同步写审计期间提前释放槽位，10,000 硬上限漏计

**定位：** L3098–3111；§10.1 `reserveSlotOrBackpressure().commit`。

高危 commit 先递减 `reservedInflightSlots`，然后 await 数据库，但没有增加 `flushingCount`。等待写入/排队/重试的安全事件从三项统计中全部消失。

**实际观察：** 高危审计 DB Promise 尚未完成，`totalUnflushedCount` 已为 0。

**修改/复验：** 槽位从预留到同步写/异步队列再到实际持久化，全程只能转移归属，不能提前释放。阻塞数据库，制造大量不同主体的高危事件，第 10,001 个应受到统一容量限制，不能落入未计数的驱动等待队列。

### BE-R14 — 按字符截断不能满足 64KB 字节预算，且截断标记不准确

**定位：** L2593–2607、L2630–2637；§8.4 streaming executor。

对 UTF-8 字符串超限后使用 `slice(0, 32768)`，不是按字节裁剪；多字节文本仍可超出 64KB，附加标记还会继续增加长度。字段被截断但总量未超 5MB 时，结果的 `truncated` 仍返回 false。

**实际观察：** 输入 `汉` 重复 40,000 次（120,000 字节），输出仍为 **98,338 字节**，`truncated=false`。

**修改/复验：** 定义字段预算是否包含占位标记，按 UTF-8 字节安全裁切、不拆代理对/编码序列，统一汇总字段截断状态。覆盖中文、emoji、Buffer、JSON、空值和边界字节。

### BE-R15 — 启动装配与已给出的构造签名不一致，蓝图不能直接编译落地

**定位：** L189–196 对照 L2466–2469、L3055–3063。

启动代码传 `new QueryLifecycleCoordinator(poolManager, metrics)`，正文构造函数却只接受 `AdminMaintenanceChannel`；也未先实例化这一独立维护通道。启动传 `new AuditEngine(metadataPool, metrics, cfg)`，正文只接受 `(pool, cfg)`。此外，`startBackgroundFlusher`、`stopAndFlushAll`、`cancelAllRunningQueries` 被调用但未在给出的类实现中定义。

**影响：** 即使开发者逐段照抄，也无法得到一致可运行的工程；维护通道的关键依赖尤其容易在实现中被绕过或临时复用业务池。

**修改/复验：** 统一接口签名与 composition root，补齐完整生命周期 API，确保所有组件依赖只有一套权威类型。至少提供一份最小可编译 skeleton，以 `tsc --noEmit`、宿主启动/关闭冒烟测试验证。不能用转译成功代替类型检查；本次最小复现使用 transpileModule，并未声称完成后端全工程编译。

## 四、未计入上述 15 项的待闭合设计

以下是详细设计仍需补齐的范围，不在没有实现证据时额外推断漏洞：

1. **目录有条目、正文无实现的核心章节。** §6.5 执行前二次鉴权、§8.6 SSH 隧道、§9.4 通知服务只出现在目录/引用中。需补入真实时序、接口、错误和验收，不能算“已闭环”。尤其二次鉴权应明确 PAT 自然过期、吊销、userAuthVersion、policyVersion、snapshotTTL、Profile 代际与 SQL 下发之间的不可穿插边界。
2. **SSH 数据面与 KILL 通道同源。** `sshConfig/sshManager` 在池构造器中未使用；AdminMaintenanceChannel 的配置没有 SSH 路由，且每次取消又重新解析主机。必须保证取消命中原查询所属实例/拓扑，而不是另一个 DNS 后端；需补隧道生命周期、host key 校验、远端目标校验与失败关闭方案。
3. **密码变更的撤销语义。** PRD L139–143 要求修改密码时取消在途 SQL；§1.3 密码变更行只描述 Web Session 轮换。还需说明现有 PAT 是否继续有效、数据面快照如何失效、哪些在途调用会被取消，不能把 Web Session 失效等同于全部数据访问回收。
4. **限流配置是否真正进入运行时。** `sys_rate_limits` 有全局默认、burst_capacity、loop breaker 参数，但 SnapshotBuilder 没有全局默认入参，令牌桶固定计算 15 秒突发。需给出全局→角色→用户优先级和热更新实例迁移的实际接线。
5. **大小写敏感标识符。** 提取器无条件转小写。需声明对受管 MySQL `lower_case_table_names` 的支持范围；若支持同名不同大小写对象，必须按实例语义做 ACL 匹配，不能混为一表。
6. **登录 IP 维度和未认证流量的资源预算。** §5.2 标题声称双维，正文只有账号失败计数；需补 IP 维度、可信反向代理、Argon2 并发上限和匿名审计限额，避免未认证请求绕过用户/Profile 预算。
7. **安全审计与通知的恢复运维。** JSONL 目前按日期命名但没有文件大小/磁盘配额、持久性确认、恢复重放、去重与告警降级策略；“在线密钥轮转”也只给出了 keyring 加解密，没有重加密任务与旧密钥退出条件。
8. **文档生成链。** 后端详设由 `scripts/combine_be_spec.js` 拼接 `scripts/be_parts/` 生成。整改须先修改源分片再重新生成汇总文件，避免下一次生成覆盖修订。

## 五、建议修订与复审顺序

1. **先闭合数据面不可绕过的安全边界：** BE-R01/R02/R03/R04/R05/R06，并补 §6.5 完整二次鉴权。
2. **再闭合失败与容灾：** BE-R07/R08/R09/R10/R13，以及 SSH/维护通道实例绑定。
3. **最后统一工程契约和生命周期：** BE-R11/R12/R14/R15，补全缺失章节和可编译骨架。
4. **复审证据不能只有“已改”表格：** 为每项提供修订源位置、对应负向用例、预期不变量及执行结果；原 TC-BE-01~12 不足以覆盖本次暴露路径。

建议新增门禁：表达式位置覆盖的 ACL 测试、集合运算语义测试、正常/异常 HTTP 生命周期测试、生产建连的出站目的地测试、错误域名证书测试、低配额回归、commit 后发布失败注入、双存储故障、强一致审计回滚、巨型单行真实内存压测、长 SSE 关停及超 53 位 ID 测试。

## 六、复现材料

本目录包含：

- `backend-design-review.repro.cjs`：从原文提取示例的观测脚本，使用受控替身；**不是完整安全验收套件**。
- `backend-design-review.evidence.json`：本次 17 个观测结果，包含一个正常标量子查询对照项。

依赖安装在系统临时目录，没有向项目添加 package.json、node_modules 或修改原设计。可在项目根目录用 PowerShell 复跑：

```powershell
$deps = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
npm install --prefix $deps --no-audit --no-fund --ignore-scripts `
  node-sql-parser@5.4.0 mysql2@3.24.6 typescript@5.9.3 fastify@5.12.8
$env:NODE_PATH = Join-Path $deps 'node_modules'
node .\docs\reviews\backend-design-review.repro.cjs
```

说明：脚本执行可信本地设计文档中的示例代码，会启动短暂的 127.0.0.1 HTTP 探针并重写证据 JSON；不会访问真实业务数据库。退出码 0 只表示观测脚本运行完成，不代表被评审设计通过。整改后应将预期安全不变量迁移至正式工程的自动化测试，并在目标 Node.js 22 与真实 MySQL/SSH/TLS 环境补做集成验收。

