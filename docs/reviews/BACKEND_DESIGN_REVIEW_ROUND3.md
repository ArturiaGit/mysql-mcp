# 后端详细设计第三轮复审报告

- 评审日期：2026-11-08（Asia/Shanghai）
- 评审对象：[后端详设 v1.2.0](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md)，213,957 字节、4,687 行。
- 受评正文 SHA-256：`0FBDE9416C55D3C1A8771E13E12FE49B93EFBCD3C2EFED03D652EB3C9F626C3D`
- 对照：需求 v2.3.0、总体架构 v1.2.1、前端详设 v1.4.0，及前两轮报告和复现脚本。
- **结论：修改后复审（Request Changes）。本轮共 8 项需修改问题：5 项 P1、3 项 P2。**
- 当前正文与生成脚本规定的 11 个源分片逐字节拼接结果一致；本次未修改正文、源分片或前两轮文件。

## 一、先明确已经修好的部分

**上一轮原有 27 条观察，本轮全部不变量成立（27/27）。** 当前版本将状态改为“Probe Verified, Pending Integration Test”，比上一版笼统宣称“全部闭环”更准确；应保留这种证据边界，不将本轮结论解读为修订无效。

已确认的修正包括：

- 前导零 ID 归一化，不安全 number 拒绝；原本人操作绕过样例已阻断。
- `PinnedDuplexTransport` 收发方向隔离；真实回环 TCP 不再回送 greeting/command。
- 较旧代际的权限重载不能清除较新墓碑；原并发反例被阻断。
- 在原探针加载环境中，TLS 升级能继承 endpoint 和字节计数复位入口。
- 带库前缀的 `app`.`dual` 被正确提取。
- SSH 转发目标接入 SSRF guard；补充使用真实 guard 验证，受禁链路本地目标在建连前被拒绝。
- 新建 SSH client 确实因缺失指纹而拒绝，而不只是“配置里存在一个函数”。
- 正在运行的普通批次刷盘可以被停机调用等待；结果内存租约保持到调用方释放，重复释放不重复扣减。
- Node22 的通知 lookup 不再因 `all:true` 返回结构错误而失败。

**但上述样例通过，不等于模块所有输入、配置变化及生命周期组合都正确。** 扩展检查发现以下 8 项问题。

## 二、验证环境与结果

- Node.js **v22.22.0**；mysql2 **3.24.6**；node-sql-parser **5.4.0**；Fastify **5.12.8**；TypeScript **5.9.3**。
- 测试辅助：node-forge **1.3.1**（仅在内存生成本地 TLS 测试证书，不是生产依赖建议）、ipaddr.js **2.5.0**。
- 合计 **45 条观察：33 条不变量成立、12 条被反例否定**。
  - 沿用第二轮的 27 条：**27 成立、0 反例**。
  - 本轮新增的 18 条：**6 成立、12 反例**，归并为下述 8 项，而不是 12 项独立缺陷。
- 直接从当前正文提取 TS 示例后转译执行；没有另写替代业务算法来冒充验证原文。
- HTTP、TCP 和 TLS 只使用真实本地回环连接。TLS 证书反例调用实际锁定驱动的 `startTLS`，完成真实 TLS 握手；它不包含 MySQL greeting、认证或查询协议。
- SSH、数据库写入、管理 KILL、启动服务使用受控替身，仅记录调用、状态与参数；没有向外部主机执行 SSH、SSRF 探测或 KILL。
- 仍没有完整后端工程，未完成全工程 `tsc`、真实 MySQL/SSH/容器集成。脚本退出码 0 表示观察完成，不代表设计通过。

## 三、P1：应在对应核心模块实现前修正

### BE-R3-01 [P1] — 只修了库限定 dual，无库前缀但带反引号的真实表仍漏过 ACL

**定位：** [ScopeExtractor L2231–2243](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2231)、[无表判定 L2277–2289](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2277)。源分片：[part7](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part7_ast_and_mcp_tools.md)。

当前算法在没有数据库前缀时仍根据表名字符串是否等于 `dual` 来跳过引用，没有区分物理标识符与伪表 AST 节点。

```sql
SELECT * FROM `dual`;
```

锁定 parser 的该引用为 `{ db: null, table: 'dual', as: null }`。实际提取 `tables=[]`，`isKnownNoTableQuery=true`，安全校验允许，改写后仍保留该反引号表引用并添加 `LIMIT 10`。**若默认库存在真实的 `dual` 表**，该表不会进入表级 ACL。这里未在真实 MySQL 创建该表或读取数据；复现的是安全流水线丢失物理引用。

反向控制也暴露了判别依据用错：合法 `SELECT 1 FROM DUAL` 的 parser `from` 是 `[{ type: 'dual' }]`，结果反而 `isKnownNoTableQuery=false`。两类节点在锁定 parser 中并非无法区分。

**修改要求：** 按经过锁定测试的 AST 节点类型识别真正 DUAL 伪表；普通 `fromItem.table` 即使叫 dual 也应进入物理表集合。不能仅以字符串或“没有库前缀”作为无表查询依据。

**验收：** 默认库与显式库中的反引号 dual 实表均受黑白名单约束；裸 DUAL 正确归为合法无表查询；大小写、别名、JOIN 与子查询都覆盖。

**证据：** `r3_quoted_unqualified_dual`、`r3_bare_dual_known_no_table`。

### BE-R3-02 [P1] — 允许 rejectUnauthorized:false，使 verifyIdentity:true 不再保证拒绝错误证书

**定位：** [业务池 L2864–2870](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2864)、[KILL 通道 L3136–3143](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3136)、[测试连接 L3884–3890](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3884)；与 [ADR-BE-02 L301](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L301) 强制 `rejectUnauthorized:true` 的约定不一致。源分片：part8、part9。

这三条路径都将 `tlsConfig.rejectUnauthorized ?? true` 作为最终值，保留了显式 false。仅强制 `verifyIdentity:true` 不能抵消此设置；锁定驱动的补充主机名拒绝逻辑也受 `rejectUnauthorized` 条件控制。

**真实本地 TLS 观察：** 使用原文生成的 ssl 配置，连接 `db.example`，服务端提供 SAN 为 `wrong.example` 的测试证书：

| 配置 / 证书信任 | 实际驱动结果 |
|---|---|
| `rejectUnauthorized:false`，不可信自签证书 | `accepted=true`，`authorized=false`，`DEPTH_ZERO_SELF_SIGNED_CERT` |
| `rejectUnauthorized:false`，已信任该测试证书但域名不匹配 | `accepted=true`，`authorized=false`，`ERR_TLS_CERT_ALTNAME_INVALID` |
| 相应控制组改为 `rejectUnauthorized:true` | 两种错误均被拒绝 |
| 强制验证、显式信任且请求域名匹配证书 | `accepted=true`、`authorized=true` |

证书错误被记录在 socket 上但握手仍向上层报告成功，不符合详设承诺的目标身份强校验。这不是仅凭配置字段推测的结果，也不是完整 MySQL 登录验收。

**修改要求：** 按当前安全基线拒绝或覆盖传入的 false，三条路径使用同一强制 TLS 工厂；自签场景应显式配置信任 CA，而不是关闭验证。如果产品确实需要例外，必须先修改安全需求、权限与审计策略，不能仍宣称强制验证。

**验收：** 不可信 CA、可信 CA 下错误域名、正确域名和自签且显式信任四组测试覆盖业务、维护和测试连接，均有明确通过/拒绝预期。

**证据：** `r3_tls_cannot_disable_certificate_verification`、`r3_tls_wrong_hostname_cannot_be_ignored`，以及三个 `r3_tls_strict_control_*`。

### BE-R3-03 [P1] — SSH cache 仅按 profileId 复用，热更新后仍使用旧堡垒机和旧信任上下文

**定位：** [activeClients L3570](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3570)、[提前返回缓存 L3619–3621](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3619)、[建立 client L3632–3668](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3632)。源分片：part8。

新 client 缺少指纹已能 fail closed，但配置热更新不创建新 client：只要 profileId 相同，修改后的 host、port、username、私钥及指纹都不会被当前缓存路径使用。当前类也没有按 profile generation 管理客户端的接口。

**观察：** 同一 profile 先使用堡垒机 A/指纹 A，再请求堡垒机 B/指纹 B。只发生一次 connect；第二次 forwardOut 仍在 client A 上，新配置 B 的握手与 verifier 根本没有执行。使用的是假 SSH client，没有真实登录堡垒机。

**影响：** 新请求进入错误的网络/租户拓扑；主机密钥轮换、凭据撤换和安全配置更新不按预期生效。不能将“旧连接曾经验证成功”当作“新配置已经验证成功”。

**修改要求：** 缓存与不可变 profile generation/信任配置绑定；配置变化时新请求获取新代际 client。旧查询与 KILL 保留其原 client/endpoint 租约直到排空，不能为修复新请求而提前破坏旧查询的同源取消。旧 client 的 close 回调也必须按实例/代际移除缓存，避免误删新项。

**验收：** 同一 profile 修改堡垒机、端口、账号、私钥或指纹后，新的通道按新配置握手，旧查询仍可用原租约取消；指纹撤换后不得默默继续向旧目标发送新业务。

**证据：** `r3_ssh_config_generation_trust`；`r3_missing_ssh_fingerprint_actually_rejected` 是已修复行为的控制组。

### BE-R3-04 [P1] — KILL 仅复用 endpoint 的 IP，端口仍取可变配置；缺失租约时还会重新选目标

**定位：** [SSH 目标 L3104–3115](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3104)、[直连 L3119–3128](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3119)。源分片：part8。

`VerifiedTargetEndpoint` 已包含 port，但维护通道依然使用 `profileCfg.port`。租约也仍为 optional；没有它时 guard 再解析当前 host，然后继续发送旧 threadId 的 KILL。这不是原目标身份固定，而是固定了部分字段后重新拼装目标。

**受控观察：**

- 原租约为 `203.0.113.11:3306`，配置已切换为端口 3307，实际请求建连到 **203.0.113.11:3307**，随后发出 `KILL QUERY 123`。
- 没有原租约时，重新解析 `changed.example` 到 **203.0.113.99:3307**，仍发出相同 KILL。

没有连接真实数据库或杀死查询。风险条件是配置/拓扑发生变化，或者调用链丢失租约；该函数目前既不拒绝这种输入，也不保证完整使用原租约。MySQL KILL 目标由当前实例上的连接标识解释，不能把另一个实例上的同号连接视为原查询。

**修改要求：** KILL 需要不可变、完整的目标租约，包括 host identity、pinned IP、port、直连/SSH 拓扑及代际，并使用与原连接匹配的认证快照。配置与租约冲突时使用经验证的原租约或拒绝，不可静默拼接。缺失或不可用租约应返回失败，由协调器销毁原业务连接，不得重新 DNS 后盲发 KILL。

**验收：** 同一 IP 双实例不同端口、DNS 改变、SSH 配置热更、租约丢失等场景均不得向非原实例发 KILL；分别断言主机、端口、TLS 身份与 SSH 代际。

**证据：** `r3_kill_uses_original_endpoint_port`、`r3_kill_requires_verified_lease`。

### BE-R3-05 [P1] — 启动调用没有传入 active profiles，新增 warmUp 实现仍是空运行

**定位：** [启动 L174–183](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L174)、[warmUpActiveProfiles L3013–3038](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3013)。源分片：part1、part8。

新方法增加了配置数组，但默认值为 `[]`。bootstrap 仍无参调用；方法本身也不从 registry/数据库加载配置。`RegistryHub.initializeAll` 只保存 profile 状态和版本，不能自动变成完整连接配置列表。

**观察：** 用真实 bootstrap 和 PoolManager 示例配合元数据库/服务器替身：数据库返回 1 个 ACTIVE profile，registry 保存 1 项，启动结束业务池数仍为 **0**，两个服务器的 listen 均已执行。控制组显式向同一 warmUp 方法传入 1 个配置，业务池数为 **1**。

当前没有完整 server/执行引擎实现，因此不声称线上查询已经失败；问题是引导代码无法建立自己声明的“加载有效配置并预热后进入服务”条件，文档也未给出替代的懒加载协议。

**修改要求：** 明确连接配置的读取与映射责任，bootstrap 传入真实 ACTIVE 配置，或由 PoolManager 通过受约束的配置 provider 加载；不能用无参空数组默认值掩盖漏接线。同步明确不可达 profile、元数据加载失败、ready 与按 profile 拒绝服务的策略。

**验收：** 带 0/1/多个 ACTIVE 与 DISABLED profile 冷启动，检查实际注册的池；失败时不错误宣称相关数据面已就绪。此项不是强制在设计阶段实现完整系统，而是要求启动契约自洽。

**证据：** `r3_bootstrap_active_profiles_wiring`。

## 四、P2：应在实现验收前修正

### BE-R3-06 [P2] — 最低 authVersion 用本地已发布版本 +1 推算，并发读到后续提交后可能持续误锁用户

**定位：** [L1759–1761](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1759)、[L1773–1774](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1773)、[L1793–1797](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1793)。源分片：part6。

代际屏障修好了“旧结果覆盖新墓碑”，但最低版本不能由当前缓存版本机械 +1 推断。缓存可能已经通过另一次 SELECT 看到了尚未完成本地通知的后续提交。

**可复现状态序列：**

1. 初始用户 ACTIVE v1。
2. 事务 A 提交 v2，其通知置最低版本 2。
3. 事务 B 已在数据库提交 v3，但其 COMMIT 完成回调尚未被本地处理；A 的 SELECT 先读回 ACTIVE v3，发布版本 3。
4. B 的本地通知到达，`prev.version + 1` 变成 4；B 重载读回正确的 DB v3，却被当作旧结果拒绝。

**观察：** 已提交 DB 版本为 3，注册表要求 4，所有已安排的重载完成后用户仍被墓碑锁住。此处使用受控的提交通知/读取顺序，没有执行真库并发，也没有声称存在权限提升；这是并发更新下的错误拒绝服务。

**修改要求：** 管理事务在锁保护下取得并返回实际提交的 auth_version，失效调用携带这个版本，最低要求以真实已提交版本合并；invalidation epoch 与数据库版本职责分离，不把本地通知计数等同于数据库版本。发布时也应防止低版本覆盖已发布的高版本。

**验收：** 两次变更的提交完成通知、SELECT 回调交错，既不能回退版本，也不能要求数据库从未产生的版本；ACTIVE 用户在成功重载后可恢复服务。

**证据：** `r3_auth_min_version_overshoots_committed_db`。

### BE-R3-07 [P2] — stopAndFlushAll 仍不等待高危直接写入及已预留但未提交的槽位

**定位：** [停机循环 L4263–4270](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4263)、[高危写入 L4325–4331](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4325)。源分片：part10。

`activeFlushPromise` 只代表普通队列刷盘，不代表高危 `insertHighRiskStrict`，也不代表 stop 之前已发出的 reservation。closing 标记只能阻止新的 reserve，无法等待这些已有工作。

**观察：** 两个独立样例中，stop 都已返回，但 `totalUnflushedCount=1`：一例是 DB Promise 仍挂起的高危写入，另一例是 stop 前已经预留但尚未 commit 的槽位。普通批次的原反例确实已修复。

当前 bootstrap 的 HTTP close 可能先等待部分调用者，这不能替代该方法自身承诺的排空屏障；本测试不声称所有现有停机都会丢日志，而是证明其成功返回条件不足。

**修改要求：** 跟踪高危写入 Promise 集合与已有 reservation 的结算屏障，closing 后等待所有既有工作完成或按明确 deadline 失败；不能在计数非零时成功返回，也不能用无等待事件的忙循环代替。后续才关闭元数据库及退出。

**验收：** 普通刷盘、高危写入、迟到 commit、releaseUnused 以及双存储失败各阶段触发 stop，均可证明无提前成功及有界失败。

**证据：** `r3_shutdown_pending_highrisk_write`、`r3_shutdown_preexisting_reservation`。

### BE-R3-08 [P2] — TLS 元数据补丁依赖 process.cwd 定位包，加载失败被吞掉，换启动目录即复发

**定位：** [L2665–2670](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2665)、[L2696–2698](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2696)。源分片：part8。

补丁不是从实际导入的 mysql2 模块位置定位依赖，而是构造 cwd 的 node_modules 搜索路径，再使用私有 `_resolveFilename` / `_nodeModulePaths`。服务模块可以正常从自身目录导入依赖，却不保证启动工作目录及其祖先也有这些依赖。错误被 catch 后完全忽略。

**隔离子进程观察：** 不设置 NODE_PATH，依赖从其真实模块位置正常导入，将 cwd 设为不含 node_modules 的临时目录。加载原文 pool 模块没有报错，但 `patchInstalled=false`；随后调用实际驱动 `startTLS`，endpoint 与 reset 入口均未保留。旧探针环境有 NODE_PATH，所以恰好掩盖了这个路径问题。

这里没有假设项目必须使用 ESM，也未伪造一个 require 错误；使用的是实际 Node22 子进程及实际可加载依赖。

**修改要求：** 优先用稳定的连接租约保存元数据而非进程级猴子补丁；若保留版本限定的兼容层，必须从实际模块上下文解析、验证补丁目标就是所用驱动实例，并有启动/借出断言。必要安全元数据不能以“兼容”为由静默丢失。

**验收：** 仓库根目录、应用包目录、无 node_modules 的任意 cwd 启动结果一致；测试构建后包布局和多个依赖副本；补丁不可安装时显式失败，而非退化。

**证据：** `r3_tls_metadata_independent_of_cwd`。

## 五、第二轮整改逐项复核

所有“原探针通过”都仅对应原探针的范围，右列列出本轮扩大范围后的结论。

| 第二轮问题 | 原触发验证 | 本轮扩展结论 |
|---|---|---|
| R2-01 ID 别名/失精 | 通过 | 原保护绕过已阻断；仍需实现阶段统一 helper、UINT64 范围及 DTO 上限 |
| R2-02 双向 PassThrough | 通过 | 真实回环方向正确；真实 MySQL/SSH 协议仍待集成 |
| R2-03 旧重载清新墓碑 | 通过 | 跨代际阻断正确，但版本推算还有 R3-06 |
| R2-04 TLS 元数据丢失 | 通过 | 原环境继承成功；任意 cwd 失败见 R3-08，维护目标完整性见 R3-04 |
| R2-05 限定 dual 漏检 | 通过 | 限定实体修好；非限定反引号实体仍漏检见 R3-01 |
| R2-06 SSH 最终目标校验 | 通过 | 补充真实 SsrfGuard 拒绝受禁数字 IP，符合预期 |
| R2-07 缺失 SSH 指纹 | 通过 | 补充会真实调用 verifier 的替身确认新 client 拒绝；配置热更复用错误见 R3-03 |
| R2-08 停机漏等刷盘 | 通过 | 普通 single-flight 正确；高危与 reservation 漏等见 R3-07 |
| R2-09 响应持有内存漏计 | 通过 | 结果持有期间保留预算、幂等释放均通过；外层 finish/close 接线仍待工程验收 |
| R2-10 lookup all:true | 通过 | 已到达 pinned 回环 TCP 连接阶段，不再发生 lookup 结构错误；不是远端通知成功验收 |

此外，JSONL 容量、轮换、重放去重，SSE 主动关闭，Registry 的完整授权数据装载及热更发布，完整 tsc 和真实 MySQL KILL/RESET 等仍需实现与集成证据；不因旧探针全绿就消除这些门禁，也不另计入本轮 8 项缺陷。

## 六、交付与复现

- [第三轮复现脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round3.repro.cjs)
- [第三轮观察证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round3.evidence.json)
- [第二轮报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/BACKEND_DESIGN_REVIEW_ROUND2.md)

脚本是**当前版本的观察性复现**，不是完整测试框架，不承诺对任意后续大改直接运行。依赖及临时文件位于工作区外；本地 TLS 证书和私钥只在内存中生成。隔离 cwd 子进程在系统临时目录写入一份测试脚本，不运行真实 SQL/SSH。

PowerShell 复现（仓库内不创建 package.json 或 node_modules）：

```powershell
$repo = 'D:\E\PersonalProjects\mysql-mcp'
$deps = Join-Path $env:TEMP 'mysql-mcp-design-review-round3-deps'
npm install --prefix $deps --no-save --no-audit --no-fund typescript@5.9.3 node-sql-parser@5.4.0 mysql2@3.24.6 fastify@5.12.8 node-forge@1.3.1 ipaddr.js@2.5.0
$runtime = Join-Path $deps 'node22'
npm install --prefix $runtime --no-save --no-audit --no-fund node@22.22.0
$node22 = Join-Path $runtime 'node_modules\node\bin\node.exe'
$env:NODE_PATH = Join-Path $deps 'node_modules'
$env:REVIEW_EVIDENCE_FILE = Join-Path $deps 'round3-rerun.evidence.json'
try {
  & $node22 --check "$repo\docs\reviews\backend-design-review-round3.repro.cjs"
  & $node22 "$repo\docs\reviews\backend-design-review-round3.repro.cjs" "$repo\docs\BACKEND_ARCHITECTURE_SPEC.md"
} finally {
  Remove-Item Env:\NODE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\REVIEW_EVIDENCE_FILE -ErrorAction SilentlyContinue
}
```

如果工作目录、依赖或原文发生变化，应先比对证据中的 specSha256 和 environment，再解释差异；不要覆盖历史证据以制造新的“通过时间戳”。

## 七、官方语义核验依据

这些资料仅支持外部 API/数据库语义；具体缺陷是否存在，以本地原文和第三轮 JSON 观察为准。

- MySQL 8.0 官方标识符规则及语法：反引号对象标识符与裸 DUAL 关键字不是同一引用；`from_tables` 区分 `DUAL_SYM` 与表引用列表。`https://dev.mysql.com/doc/refman/8.0/en/identifiers.html`、`https://raw.githubusercontent.com/mysql/mysql-server/8.0/sql/sql_yacc.yy`
- mysql2 v3.24.6 官方 `startTLS` 源码：传递 rejectUnauthorized，且补充身份检查受该标志控制。`https://raw.githubusercontent.com/sidorares/node-mysql2/v3.24.6/lib/base/connection.js`
- Node.js v22.22.0 TLS 官方文档：rejectUnauthorized 的证书拒绝语义。`https://nodejs.org/download/release/v22.22.0/docs/api/tls.html`
- ssh2 v1.17.0 官方 README：hostVerifier 属于连接握手验证，hostHash 的输出为 hex。`https://raw.githubusercontent.com/mscdex/ssh2/v1.17.0/README.md`
- MySQL 8.0 官方 KILL 文档：连接标识与当前服务端执行线程的关系。`https://dev.mysql.com/doc/refman/8.0/en/kill.html`
- Node.js v22.22.0 CommonJS 官方文档：模块解析依赖模块上下文及其搜索路径，不能假定与进程 cwd 一致。`https://nodejs.org/download/release/v22.22.0/docs/api/modules.html`

**建议下一步：** 保留现有修复，不推翻整体架构；先修 R3-01～05 的安全/核心执行契约，再修 R3-06～08 的生命周期可靠性。修改源分片后重新生成正文，提交对应正常与反例控制组；将“本地探针验证”与“工程编译/容器集成验收”继续分开标记。
