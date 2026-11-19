# 后端详细设计第六轮复审报告

- 评审日期：2026-11-08（Asia/Shanghai）。
- 评审对象：[后端详细设计 v1.5.0](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md)，227,972 字节、5,115 行。
- 受评正文 SHA-256：`A5775C232D0FFF0C3C1851C22674847B054D7243ECD9EB9B960EE22FADE0C598`。
- 对照：需求 v2.3.0、总体架构 v1.2.1、前端详设 v1.4.0，以及前五轮报告、脚本和历史证据。
- **评审结论：修改后复审（Request Changes）。本轮 2 项需修改问题：1 项 P1、1 项 P2，分别是新增文件轮转协议的身份冲突，以及新熔断状态机的窗口语义偏差。**
- 正文与生成器规定的 11 个源分片拼接结果逐字节一致。本轮未修改正文、源分片、生成器或前五轮评审材料。

## 一、先明确上一轮已整改的部分

| 上一轮问题 | 本轮验证 | 判定范围 |
| --- | --- | --- |
| BE-R5-01：最后一次读文件后追加的日志被删除/覆盖 | 同路径锁与写入 epoch 重验后，第五轮两个原交错用例均保留新事件 | **原反例通过**；不等于新增轮转与重放的组合正确，见 BE-R6-01 |
| BE-R5-02：熔断器没有执行结果反馈和状态更新接口 | 已提供 `recordOutcome`、`recordFailure`、`recordSuccess`、`executeWithBreaker`；经公开 wrapper 连续 3 次受控失败后，后续调用被阻断 | **接口缺口关闭**；窗口判定的边界另见 BE-R6-02 |

本轮还通过了以下正向对照：

- 先封存、再按封存路径重放，新的活动文件不被删除。
- 熔断状态按 Session 隔离，不同 Session 不串扰。
- 成功执行清除失败状态，不同 SQL 的计数重新开始。
- 所测取消、并发/限流/排队、审计背压和内存错误不累加失败计数。
- 显式设置阈值 2、窗口 10 秒能生效，冷却到期后放行。
- `maxTrackedKeys=2` 时状态规模保持在 2。

这些结果说明修订有实质效果。本轮不是沿用“没有锁”“没有反馈接口”的旧结论，而是在新协议中发现了两个不同的边界问题。

### 1.1 旧熔断探针的迁移说明

先原样运行第五轮脚本，另存为 [legacy60 证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round6.legacy60.evidence.json)。结果为 **59/60 不变量成立**。唯一不成立项仍调用“执行前检查 → 外部查询失败但不反馈”，不使用新增加的结果反馈接口。因此，这一项的失败不能证明 v1.5.0 仍缺少状态更新接口。

第六轮脚本只将该项迁移为通过 `executeWithBreaker(params, failingWork)` 执行受控失败，**仍要求恰好 3 次实际 work 失败后，下一次调用抛出 `ERR_AGENT_LOOP_DETECTED`**，未通过手动注入状态满足这条断言。历史脚本、历史证据没有修改。第五轮的测试注入状态对照继续保留，但不作为公开 API 正常接线的证明。

第四轮共享计数器的既有修正继续保留；两项测试修正/迁移均记录在新证据的 `harnessCorrections` 中。

## 二、验证环境、结果与边界

| 范围 | 总数 | 不变量成立 | 被反例否定 |
| --- | ---: | ---: | ---: |
| 第五轮脚本原样运行 | 60 | 59 | 1（未接入新反馈接口的旧调用方式） |
| 第六轮继承观察，迁移上述一项后 | 60 | 60 | 0 |
| 第六轮新增观察 | 8 | 6 | 2 |
| 第六轮脚本合计 | **68** | **66** | **2** |

- Node.js **v22.22.0**、mysql2 **3.24.6**、node-sql-parser **5.4.0**、Fastify **5.12.8**、TypeScript **5.9.3**。
- 测试辅助：node-forge **1.3.1**、ipaddr.js **2.5.0**，沿用项目外的独立临时依赖目录，不是新增生产依赖建议。
- 直接提取当前 Markdown 中的 TS 示例执行；继承的类型探针继续使用真实编译器语义检查。
- 新增轮转反例使用原 `AuditEngine` 的公开方法，真实执行临时文件的 append、rename、read、unlink。只控制 MySQL 写入的成败和等待时机，没有伪造文件删除算法。
- 新增熔断用例仅调用公开 `recordFailure`、`checkBeforeExecution` 等接口，使用其提供的 `now` 参数控制时间，没有注入私有状态来构造反例。
- 继承 HTTP/TCP/TLS 仅使用本地回环。完整启动、业务数据库写入、SSH 和 KILL 为受控替身。
- **没有连接真实 MySQL/SSH，没有执行真实 KILL，没有容器集成或全工程构建。** 当前仍是设计文档及片段验证，不是可部署后端验收。

脚本退出码 0 仅表示观察完成。请核对 `regression`、`extension`、`summary`、`harnessCorrections`、各项 `invariantHolds` 和受评正文哈希。

## 三、BE-R6-01 [P1] — 封存轮转可以替换在途重放的路径，旧偏移会清理新文件

**定位：** [封存方法 L4848–4856](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4848)、[初次快照 L4860–4878](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4860)、[后续清理 L4881–4895](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4881)。源分片：[part10 L372–420](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part10_audit_and_stats.md#L372)。

### 3.1 触发条件与根因

同一个 `AuditEngine` 中，在活动文件的重放等待数据库时，对该活动路径调用新增的 `sealActiveEmergencyLog`；之后 writer 在原路径创建下一代活动文件。

当前方法允许直接重放活动路径，没有“必须封存后重放”的状态校验。`sealActiveEmergencyLog` 也没有检查该路径是否正在 `activeReplayingFiles` 中。

锁保护的是一次操作期间的**路径**，不是从初次快照到最后清理的**文件身份**。重放器保留旧文件的 `consumedByteLength`，清理时却重新按相同路径打开文件；这个路径已经可能指向新一代文件。

写入 epoch 的比较也不能防住本例：它在写库完成之后才采样 `epochBeforeSecondRead`；轮转及新文件写入都已发生，两个采样值相同。即使检测到 epoch 变化，也不能把旧文件的消费偏移直接应用到新文件。

### 3.2 通过公开方法的确定性复现

```text
1. A 正常写库失败，经 reserve → commit → flushBatch 落到活动文件 P。
2. replayEmergencyLogsToDb(P) 读取 A，记录旧文件的消费字节数，暂停模拟 MySQL 写入。
3. sealActiveEmergencyLog(P) 在锁内将旧文件 P 移到 S.sealed.jsonl。
4. B 再次降级，writer 在原路径 P 创建新文件并完成 append。
5. 放行 A 的写库。旧重放器按路径 P 读取到 B，随后按 A 的旧字节数清理 P。
```

本次故意让 A 大于 B，以确定进入 `latestBuf.byteLength <= consumedByteLength` 分支。**A 较大只是便于确定性演示，不是防护前置条件。**

实际观察：

```text
旧文件 A 的快照长度： 2371 字节
新活动文件 B 的长度：  322 字节
清理前新活动文件内容： [r6-B]
模拟数据库成功写入：   [r6-A]
清理后剩余文件内容：   [r6-A]（旧 sealed 文件）
原路径 P 是否存在：    否
队列/在途计数：        0
```

B 已成功降级落盘，后来被处理 A 的重放器删除；它既不在模拟数据库中，也不在剩余文件或队列中。整个反例不依赖多个进程、外部修改文件或绕过私有字段。

正向对照“先封存 A，再只重放 sealed 路径”能保留新活动文件 B，说明封存机制可以成为正确方案的一部分，但目前未把文件所有权约束落实为调用契约。

**证据键：** `r6_rotation_cannot_retarget_inflight_replay`；对照 `r6_seal_then_replay_sealed_control`。

### 3.3 影响与修改要求

**影响：** 数据库恢复期间的审计无损承诺仍不成立，新增轮转和旧活动路径重放可以组合出静默丢失。更大的替换文件还存在把旧消费偏移应用到错误字节序列的风险；该分支本轮没有另行构造损坏文件测试，不把它计为第三项已复现问题。

**应修正的核心不变量：** 重放快照、数据库提交和文件清理必须始终对应同一文件代际，不能只保证每次文件操作分别持锁。

可选择的实现方向：

1. **强制封存后重放**：在协调屏障中生成不可变封存文件/租约，replayer 只接受该文件身份；活动路径不得直接进入清理流程。让状态检查可执行，而不是只写在注释中。
2. **拒绝或延迟冲突轮转**：若继续支持活动路径重放，应在同一协调协议中禁止其在途期间更换文件身份，并正确处理 writer、seal 与 replay 的全部入口。
3. 无论哪一种，都需要让重放租约绑定真实文件代际；发现身份改变时不能按旧偏移裁剪新文件。
4. 保持“先封存再重放”的成功路径、同文件重放防重入、失败可重试、归档及崩溃恢复规则一致。

**验收：** 同时运行本轮轮转交错、第五轮最后读取后的追加反例和普通封存重放对照；所有已确认落盘的事件必须在数据库或可恢复文件中。允许安全地拒绝冲突操作，但不得悄悄清理替换文件。不能只以增加 epoch 采样次数作为文件身份正确性的证明。

## 四、BE-R6-02 [P2] — 首错锚定窗口冒充滑动窗口，会漏掉窗口内达到阈值的连续失败

**定位：** [recordOutcome L2196–2217](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2196)，重点为 [L2202–2211](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2202)。源分片：[part6 L834–849](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part6_data_plane_pipeline.md#L834)。需求依据：[REQUIREMENTS L198–200](D:/E/PersonalProjects/mysql-mcp/docs/REQUIREMENTS.md#L198)。

### 4.1 根因

需求 §5.2 要求按默认 30 秒的**滑动窗口**追踪执行流水，连续相同/相似失败达到默认 3 次时熔断。

当前实现仅保存 `firstErrorAt` 和一个累计计数。当 `now - firstErrorAt > windowMs` 时，把整个状态重置为当前失败一次。这相当于以首错锚定的计数窗口，无法保留仍在最近窗口内的中间失败。

### 4.2 确定性时间序列

同一用户、Profile、Session、SQL 和错误，在以下时间发生失败：

| 相对时间 | 公开反馈后的内部 count | 说明 |
| ---: | ---: | --- |
| 0 秒 | 1 | 首次失败 |
| 29 秒 | 2 | 第二次失败 |
| 31 秒 | 1 | 首错已过 30 秒，全部重置；29 秒的失败也被丢弃 |
| 32 秒 | 2 | 再次累加 |

在 **32.001 秒**调用执行前检查，最近 30 秒内有 **29、31、32 秒共 3 次连续相同失败**，按需求应拒绝后续重试；当前 guard 未抛出错误，因为内部仅计为 2 次。

正确的滑动逻辑应移除已过期的 0 秒事件，同时保留 29 秒事件，不是把此前所有计数清零。

本用例直接通过公开 `recordFailure(..., { now })` 和 `checkBeforeExecution(..., now)` 执行，没有依赖真实时间等待、私有状态注入或异步竞争。

**证据键：** `r6_loop_breaker_true_sliding_window`。

### 4.3 影响与修改要求

**影响：** 一些合法时间分布的连续失败已经达到规则阈值，却仍被放行。快速连续三次失败、Session 隔离和冷却恢复等正向用例通过，并不能覆盖这个跨窗口边界。

**修改要求：**

- 实现真正的滚动计数，例如为每个主体/指纹保留有界失败时间序列，每次反馈仅移除过期事件，再判断阈值；与现有成功/不同 SQL 重置、错误分类、容量淘汰和动态配置组合一致。
- 由于阈值本身有上限，应明确时间序列容量和配置变化规则，避免把修复变成无界流水存储。
- 如果确实要采用首错锚定计数窗口，应先统一需求、架构与用户规则说明，不能仍宣称实现了滑动窗口。

**验收：** 上述 0/29/31/32 秒用例在下一次检查时触发熔断；同时保留全部超过窗口时不误阻断、窗口边界、阈值变化、不同 Session、成功重置及冷却结束的对照。断言以公开接口的可观察行为为准。

## 五、本轮结论不覆盖的门禁

1. 真实 MySQL 认证、TLS、SSH 主机校验、KILL 权限及取消隔离仍需集成。继承的本地 TLS 握手不是完整 MySQL 协议验收。
2. 审计恢复的断电/进程崩溃、半行损坏、磁盘满、归档与重启重放尚未完成工程验收；本轮只证明了一种明确的轮转身份冲突。
3. 当前仍无完整后端工程，不能把 Registry 片段语义检查和运行时探针称为全仓构建通过。
4. 上游角色集合与用户的关联读取、实际 ACL evaluator、元数据变更通知和配置热更新等仍需完整链路验收。继承用例通过的边界保持不变，不扩大为系统安全认证。

## 六、交付与复现

### 6.1 文件

- [第六轮评审报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/BACKEND_DESIGN_REVIEW_ROUND6.md)
- [第六轮复现脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round6.repro.cjs)
- [第六轮验证证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round6.evidence.json)
- [第五轮脚本在本版本的原样执行证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round6.legacy60.evidence.json)

### 6.2 本机命令

依赖仍位于项目外的独立临时目录，没有向项目加入 package.json、lockfile 或 node_modules。

```powershell
Set-Location -LiteralPath 'D:\E\PersonalProjects\mysql-mcp'
$tmp = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$env:NODE_PATH = "$tmp\node_modules;$tmp\r3-extra\node_modules"
# 单独输出复跑结果，不覆盖本轮证据：
$env:REVIEW_EVIDENCE_FILE = Join-Path $tmp 'round6-rerun.evidence.json'
& "$tmp\r2-node22\node_modules\node\bin\node.exe" `
  'D:\E\PersonalProjects\mysql-mcp\docs\reviews\backend-design-review-round6.repro.cjs' `
  'D:\E\PersonalProjects\mysql-mcp\docs\BACKEND_ARCHITECTURE_SPEC.md'
```

新环境需在独立目录安装上述精确版本依赖并准备 Node 22.22.0。临时路径、时间和回环端口每次可能不同；验收应比较不变量、证据字段和正文哈希，而不是整份 JSON 的字节一致性。

### 6.3 一手资料

文件系统 API 的行为依据核对了 Node.js 22.22.0 官方文档；缺陷的主要证据仍是原文实现和真实文件交错。本轮不依赖二手博客推断轮转或窗口语义。滑动窗口的项目契约来自上文链接的需求 §5.2。

```text
https://nodejs.org/download/release/v22.22.0/docs/api/fs.html
```

## 七、建议评审决议

**接受第五轮两项问题在原反例范围内的整改，但暂不批准 v1.5.0 为后端实施终稿。** 下一版需明确并执行审计重放的文件代际/所有权契约，禁止旧快照清理新文件；同时对齐熔断滑动窗口语义。两项通过组件回归后，再进入真实数据库/SSH、故障恢复和全工程构建验收。
