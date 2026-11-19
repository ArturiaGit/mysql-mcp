# 后端详细设计第七轮复审报告

- 评审日期：2026-11-08（Asia/Shanghai）。
- 评审对象：[后端详细设计 v1.6.0](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md)，229,902 字节、5,154 行。
- 受评正文 SHA-256：`C800F41DC8C27FB14B354BA7310C537F06F99B08E8FDE930B4960BAB60BF72C9`。
- 对照：[需求 v2.3.0](D:/E/PersonalProjects/mysql-mcp/docs/REQUIREMENTS.md)、[总体架构 v1.2.1](D:/E/PersonalProjects/mysql-mcp/docs/ARCHITECTURE_SPEC.md)、[前端详设 v1.4.0](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md)，以及前六轮报告、复现脚本和历史证据。
- **结论：修改后复审（Request Changes）。发现 2 项需修改问题：1 项 P1、1 项 P2。** 两种审计日志丢失交错归并为同一个文件代际绑定问题；另有一处新增熔断代码无法通过组件语义类型检查。
- 正文与生成器规定的 11 个源分片拼接结果逐字节一致。本轮仅新增报告、脚本和证据，没有修改设计正文、源分片、生成器或历史评审材料。

## 一、上一轮整改核验

| 上一轮问题 | 本轮结果 | 判定边界 |
| --- | --- | --- |
| BE-R6-01：活动文件在途重放期间封存，旧偏移误清理下一代活动文件 | 原来的“已读取快照 → 等待写库 → 单次封存 → 新活动文件追加”用例通过；新 redirect 能保全原用例中的新活动文件 | **原反例已修复**；不代表取得快照前封存、连续封存也已正确，见 BE-R7-01 |
| BE-R6-02：首错锚定窗口导致跨边界连续报错漏熔断 | `0s, 29s, 31s, 32s` 等原用例通过，新 `failureTimestamps` 队列保留窗口内失败 | **原窗口反例已修复**；新代码的类型检查问题另见 BE-R7-02 |

第六轮脚本对 v1.6.0 **原样运行 68/68 不变量成立**，与修订说明的这项声明一致。本轮没有迁移旧调用方式、弱化旧断言或更改前 68 项测试以获得通过；新增测试接在这 68 项观察之后。

继承脚本仍保留历史上已经说明的两项测试调整：第四轮 SSH 正向对照采用本次客户端计数增量；第五轮旧熔断探针经第六轮改用公开 `executeWithBreaker` 反馈失败。它们记录在 `harnessCorrections`，不是本轮新增修正。

## 二、验证结果与边界

| 范围 | 观察数 | 不变量成立 | 反例数 |
| --- | ---: | ---: | ---: |
| 第六轮原有基线 | 68 | 68 | 0 |
| 第七轮新增观察 | 5 | 2 | 3 |
| 合计 | **73** | **70** | **3** |

**3 条反例不等于 3 个独立问题。** 两条审计交错指向同一项 P1；一条组件类型检查对应一项 P2。新增两条正向对照分别验证独立封存后重放、移除无效属性表达式后的内存副本类型检查。

### 2.1 环境

- Node.js **v22.22.0**；mysql2 **3.24.6**；node-sql-parser **5.4.0**；Fastify **5.12.8**。
- TypeScript **5.9.3**；node-forge **1.3.1**；ipaddr.js **2.5.0**；`@types/node` **26.6.6**。
- 这些是工作区外临时验证环境的实际版本，不是建议的生产依赖清单。运行时是 Node 22，但本次组件语义检查使用的 Node 类型包是 26.6.6，不能称为 Node 22 类型兼容性验收。
- 测试直接提取当前 Markdown 的 TypeScript 代码块。一般行为探针转译后执行；新增熔断检查调用真实 TypeScript 编译器进行 strict 语义诊断。

### 2.2 测试能证明什么

- 新增审计反例通过 `AuditEngine` 的公开写入、封存、重放方法构造。append、rename、read、unlink/write 都操作真实临时文件；MySQL 的成败与等待时机受控。
- 连续封存反例只暂停数据库写入。首次快照前封存反例另在第一次 `readFile` 实际打开文件前加入调度屏障；放行后读取真实文件内容，没有伪造字节或重写算法。
- 两个反例均未手动写入引擎私有状态；读取 redirect 映射仅用于记录发生的代际变化。
- 这是可重复的、协议允许的交错组件测试，**不证明该竞争在生产环境的发生概率，也不是实际数据库故障注入**。
- 继承探针中的 HTTP/TCP/TLS 通信只在本地回环进行；实际本地 TLS 握手也不等于真实 MySQL TLS 集成。业务查询、SSH、管理 KILL、完整服务启动等仍使用受控依赖替身。
- **没有真实 MySQL/SSH 集成，没有执行真实 KILL，没有容器集成、全工程构建或部署验收。** 当前材料仍为设计及片段，不能用 70 条观察成立推导后端已经可上线。

脚本退出码 0 表示观察运行完成，并不表示评审通过；须读取 `summary`、`regression`、`extension`、受评哈希和各项 `invariantHolds`。

## 三、BE-R7-01 [P1] — 重放目标仍绑定可复用路径，连续封存及快照前封存会丢审计日志

**定位：** [封存时覆盖共享 redirect，L4886–4887](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4886)；[重放登记与首次读取，L4893–4902](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4893)；[目标解析与按旧偏移清理，L4915–4933](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4915)。

源分片：[part10，L393–439](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part10_audit_and_stats.md#L393)。

### 3.1 根因

修订新增 `replayingSealedRedirects`，但它仍是“活动路径 → 最近一次 sealed 路径”的共享可覆盖映射，不是某次重放独有的文件代际身份：

```ts
if (this.activeReplayingFiles.has(normPath)) {
  this.replayingSealedRedirects.set(normPath, sealedPath);
}
```

重放先把路径加入 `activeReplayingFiles`，随后在路径锁外读取初次快照。封存侧只根据这个路径是否存在在途重放来写 redirect，没有确认被封存的文件就是该次重放实际取得的快照。后续清理再读取共享映射，并把最初的 `consumedByteLength` 应用到其当前指向的文件。

因此两个要求都没有成立：

1. 第一次快照与其文件代际必须原子绑定。
2. 后续同名活动路径复用时，不能改写第一代重放已经绑定的目标。

现有路径锁及 epoch 重验能保护部分局部操作，但不能证明“快照字节”和“清理目标”属于同一文件代际。正文 L4870 所说的“始终跟随原物理文件实例”尚未由协议保证。

### 3.2 反例 A：两次封存覆盖第一次重放的目标

证据键：`r7_replay_lease_repeat_seal`。

记活动路径为 P，A、B、C 为不同审计事件。A 使用较长 SQL，使其快照字节数大于 B 的文件长度。

| 顺序 | 公开操作或受控等待 | 结果 |
| --- | --- | --- |
| 1 | A 写库失败并降级到 P；启动 P 的重放 | 取得 A 快照，随后暂停 A 的数据库写入 |
| 2 | `sealActiveEmergencyLog(P)` | P 改名为 S1；redirect[P] = S1 |
| 3 | B 降级写入新的 P | B 属于下一代活动文件 |
| 4 | 再次 `sealActiveEmergencyLog(P)` | B 改名为 S2；**redirect[P] 被覆盖成 S2** |
| 5 | C 降级写入再次创建的 P | C 属于第三代活动文件 |
| 6 | 放行 A 的重放写库 | A 写库成功；清理却选择 S2，并应用 A 的消费长度 |

观测结果：

```text
已确认降级写入：r7-A, r7-B, r7-C
数据库替身持久化集合：r7-A
磁盘最终保留集合：r7-C, r7-A
丢失集合：r7-B
```

A 的 S1 仍然存在，C 的活动文件仍然存在，但 B 的 S2 被删除，B 也未写入数据库。这个结论不是单看返回值，而是比较已确认写入集合与最终数据库/磁盘集合。

**上一轮单次封存修复确实生效；本例是在同一个公开协议下多进行一次合法封存后暴露的缺口。**

### 3.3 反例 B：首次快照实际打开前封存，读 B 却清理 A

证据键：`r7_replay_lease_seal_before_snapshot`。

此例使用较短 A、较长 B；文件系统门面仅延迟第一次读取真正开始的时机：

1. A 已确认降级到活动路径 P。
2. 调用重放，P 已加入 `activeReplayingFiles`；在首次 `readFile(P)` 实际打开文件之前挂起。
3. 封存 P→S1，S1 含 A，redirect[P] = S1。
4. B 降级写入新建的 P，确认落盘。
5. 放行首次真实读取；此时 P 含 B，重放将 B 写入数据库。
6. 清理通过 redirect 找到 S1(A)，用 B 的较大 `consumedByteLength` 删除 S1。

观测结果：

```text
已确认降级写入：r7-A, r7-B
数据库替身持久化集合：r7-B
磁盘最终保留集合：r7-B
丢失集合：r7-A
真实读取顺序：P → [r7-B]，S1 → [r7-A]
```

这里并不是 B 的日志被伪造给 A 的快照，而是**初次读路径与后续清理路径从未原子绑定到同一代文件**。实际读到 B 后，旧 redirect 仍要求清理 A。仅禁止第二次覆盖 redirect 不能单独修复这个反例。

### 3.4 正向对照、影响与修改建议

`r7_two_seals_then_explicit_sealed_replay_control` 先独立封存 A、B，再分别传入各自 sealed 路径重放；数据库保全 A/B，活动文件保全 C。该对照成立，说明问题集中在**可复用活动路径上的在途重放所有权**，不能据此否定所有封存文件重放。

**影响：** 已返回降级写入成功的审计事件，在正常提供的封存/重放接口组合下既不在数据库，也不在备用日志中；这破坏了当前审计持久化保证，因此定为 P1。

应先明确并实现以下不变量，而不是再增加一个可覆盖的路径映射：

- 每次重放取得不可变的文件代际/所有权租约（lease）；快照、消费长度、最终清理目标都属于该租约。
- 取得快照与绑定其实际文件代际必须和封存操作原子协调；在首次读取前发生的轮转必须被正确解析或拒绝。
- 下一代 P 的封存不得改变上一代重放的目标，清理前也不能仅靠“当前路径/当前长度/epoch 看起来未变”判定可以消费。
- 简化选项：强制“先封存、后按稳定 sealed lease 重放”，并在 API 中验证前置条件、拒绝或等待冲突操作。不能只在注释中建议这样调用，而继续允许未经约束的活动路径重放。
- 如果继续支持活动路径重放，应为每次重放保存独立代际状态，并明确同一文件经不同路径进入重放时的所有权约束；此为修复设计要求，不是本轮额外已复现问题。

**复审验收：** 保留原单次封存回归和两个新增反例；覆盖首次快照前、数据库等待中、最后一次读取中、清理前发生封存，以及同一路径连续多次封存。所有测试应核对“每条已确认写入事件最终至少在数据库或某个备用文件中”，而不只是重放返回条数。

## 四、BE-R7-02 [P2] — 滑动窗口回退分支访问未声明属性，组件语义检查报 TS2339

**定位：** [错误表达式 L2219](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2219)；[接口声明 L2085–2091](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2085)。源分片：[part6 L852](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part6_data_plane_pipeline.md#L852)。

```ts
const history = Array.isArray(prev.failureTimestamps)
  ? prev.failureTimestamps.filter((ts) => ts >= cutoff)
  : prev.now !== undefined || now - prev.firstErrorAt <= windowMs
    ? Array.from({ length: prev.count }, () => prev.firstErrorAt).filter((ts) => ts >= cutoff)
    : [];
```

`prev` 的 `LoopBreakerStateEntry` 只声明 `lastFingerprint`、`count`、`firstErrorAt`、`blockedUntil`、`failureTimestamps?`，没有 `now`。`now` 是本次调用的局部时间参数，不是已定义的旧状态字段。

证据键 `r7_limiter_module_semantic_typecheck` 使用真实 TypeScript 5.9.3 对整个 `dual-bucket-limiter.ts` 代码块执行 strict 语义检查，得到：

```text
TS2339: Property 'now' does not exist on type 'LoopBreakerStateEntry'.
documentLine: 2219
```

检查保留真实 Node crypto 类型，只为尚未落地的本地 `AppError` 和 `EntityId` 导入提供最小替身。诊断来自代码块自己的本地接口，不是从 Node 类型包版本差异推导的问题；但本次使用的类型包确为 `@types/node@26.6.6`，不冒充其他版本验收。

在**内存副本**中仅移除 `prev.now !== undefined || ` 后，以完全相同选项检查，`r7_limiter_without_undeclared_property_control` 返回 0 条诊断。没有据此修改设计正文，也没有将这个对照视为用户版本已经修复。

**为什么原 68 项都通过仍有此错：** 行为探针主要转译执行代码，转译并不等价于完整语义检查；原有语义探针也未覆盖这一整段 limiter 模块。即使正常新状态总携带 `failureTimestamps`，编译器仍会检查回退分支。

**影响：** 示例作为 TypeScript 组件落地时会在此处遇到确定的语义编译错误。当前没有完整工程，故结论是“该组件片段检查不通过”，不是声称已运行全仓构建失败。

**修改建议：** 修正或删除无效属性判断，明确缺少 `failureTimestamps` 的旧状态如何回退；如果不支持旧状态，应收紧类型及构造约束。不要用 `any`、跳过检查或随意给接口补 `now` 来掩盖错误。验收须同时保留组件 strict 语义检查及既有滑动窗口行为回归；如继续保留兼容分支，还需独立验证其窗口含义。

## 五、交付物与复跑

- [第七轮复现脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round7.repro.cjs)
- [第七轮完整证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round7.evidence.json)
- [第六轮历史报告（未覆盖）](D:/E/PersonalProjects/mysql-mcp/docs/reviews/BACKEND_DESIGN_REVIEW_ROUND6.md)

以下使用本次已有的独立临时依赖目录，不修改项目依赖。若环境丢失，需先在对应临时目录准备上文固定版本；其中 Node 22.22.0 安装在 `r2-node22` 子目录，node-forge 在 `r3-extra` 子目录，其他依赖在临时根目录。

```powershell
Set-Location 'D:\E\PersonalProjects\mysql-mcp'
$tmp = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$env:NODE_PATH = "$tmp\node_modules;$tmp\r3-extra\node_modules"
$node = "$tmp\r2-node22\node_modules\node\bin\node.exe"
& $node --check docs/reviews/backend-design-review-round7.repro.cjs

# 默认写入第七轮证据；不写前六轮文件。
Remove-Item Env:REVIEW_EVIDENCE_FILE -ErrorAction SilentlyContinue
& $node docs/reviews/backend-design-review-round7.repro.cjs docs/BACKEND_ARCHITECTURE_SPEC.md

$e = Get-Content docs/reviews/backend-design-review-round7.evidence.json -Raw | ConvertFrom-Json
$e | Select-Object specSha256, regression, extension, summary | ConvertTo-Json
$e.tests | Where-Object { -not $_.invariantHolds } | ConvertTo-Json -Depth 10
```

同一受评版本的预期统计：

```json
{
  "regression": { "total": 68, "holds": 68, "violated": 0 },
  "extension": { "total": 5, "holds": 2, "violated": 3 },
  "summary": { "total": 73, "holds": 70, "violated": 3 }
}
```

三个反例键应为 `r7_replay_lease_repeat_seal`、`r7_replay_lease_seal_before_snapshot`、`r7_limiter_module_semantic_typecheck`。临时目录、时间戳及封存文件名每次不同，不作为固定输出断言。

本轮检查包括脚本语法、正式复跑、受评哈希、11 分片拼接一致性、统计/反例集合、报告本地链接及历史文件大小核对。前六轮材料未被本轮写入；历史证据属于各自受评版本，不应拿本轮结果覆盖。

## 六、最终判定

v1.6.0 对第六轮两条原反例的修订有效，68/68 回归结果应予认可。但新协议在“快照取得前轮转”和“同一路径连续轮转”仍丢失已确认的审计日志，且新增 limiter 代码存在确定的类型错误，**本轮不予通过**。

建议完成上述 1 项 P1 和 1 项 P2 后，以新哈希复审；通过文档/组件复审也不替代正文已经列明的真实集成与全仓构建门禁。
