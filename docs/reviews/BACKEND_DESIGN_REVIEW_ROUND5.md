# 后端详细设计第五轮复审报告

- 评审日期：2026-11-08（Asia/Shanghai）。
- 评审对象：[后端详细设计 v1.4.0](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md)，219,421 字节、4,854 行。
- 受评正文 SHA-256：`EA77018238ED53816CE1F3857C0E71595BC4CAC6295CF5E3A1AF25D900E62535`。
- 对照材料：需求 v2.3.0、总体架构 v1.2.1、前端详设 v1.4.0，以及前四轮报告、脚本和历史证据。
- **评审结论：修改后复审（Request Changes）。共 2 项需修改问题：1 项 P1（第四轮审计问题未完整关闭）、1 项 P2（本轮新识别的熔断状态机设计缺口，不是新增回归）。**
- 正文与生成器规定的 11 个源分片拼接结果逐字节一致。本轮未修改设计正文、源分片、生成器或前四轮评审文件。

## 一、第四轮整改复核

| 第四轮事项 | v1.4.0 验证结果 | 本轮判定 |
| --- | --- | --- |
| BE-R4-01：trim 改变表名身份、真实表被误认为 CTE | 前导空格表名被保留，两个原反例均正确提取；正常 CTE 对照通过 | 原反例范围内关闭 |
| BE-R4-02：重放期间追加的日志被 unlink 删除 | “等待 MySQL 重放写入时追加 B”的旧用例现在保留 B | **部分修复，不能关闭**；最后一次读文件后的追加仍会丢失，见 BE-R5-01 |
| BE-R4-03：SSH 建连前失败 Promise 永久缓存 | 原暂时 DNS 失败后可以重试；新增并发失败共享、失败淘汰与随后恢复用例通过 | 已关闭所测反例 |
| BE-R4-04：Registry 返回类型与 warm-up 入参不匹配 | 原签名调用无 TS2345；新增整个 Registry/Snapshot 代码块 strict 语义检查，0 诊断 | 已关闭所测反例；不等于全工程构建通过 |
| 第四轮建议：ACL 规则同时按角色、Profile 过滤 | 不相关角色的 allow/deny 和不相关 Profile 的行被过滤；规范化 ID 的当前角色全局规则保留 | 已验证传入角色集合下的规则过滤；未证明上游角色集合与用户关联的完整链路 |

### 1.1 对历史脚本误报的更正

先原样运行第四轮脚本，并将本次原始输出另存为 [legacy53 证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round5.legacy53.evidence.json)。结果为 **52 条成立、1 条不成立**，唯一不成立的是 `r4_ssh_ready_control`，不是 SSH 实现回归。

历史脚本在同一作用域中共用 `clientCount`：前一个恢复测试现在能成功建连，计数从 0 增加为 1；后续正常建连对照又增加 1。原断言固定要求总数等于 1，因此在修复生效后反而误报。

第五轮脚本只将该正向对照改为比较自身增量 `clientCount - clientsBeforeControl === 1`，并记录修正原因；前一个失败恢复测试的预期没有放宽。**历史脚本及其历史证据保持不动。** 这是测试隔离错误的修正，不能拿它作为否定对方整改的缺陷。

## 二、验证结果与证据边界

| 范围 | 总数 | 不变量成立 | 被反例否定 |
| --- | ---: | ---: | ---: |
| 未改动的第四轮脚本，本次原样执行 | 53 | 52 | 1（测试计数误报） |
| 第五轮中继承的观察，修正上述测试隔离错误后 | 53 | 53 | 0 |
| 第五轮新增观察 | 7 | 4 | 3 |
| 第五轮脚本合计 | **60** | **57** | **3** |

新增的两个审计反例是同一并发清理根因的两个分支，归并为一个 P1；熔断器公开接口和状态转换缺口归为一个 P2，而不是把三条反例计成三项独立缺陷。

### 2.1 运行环境

- Node.js **v22.22.0**、mysql2 **3.24.6**、node-sql-parser **5.4.0**、Fastify **5.12.8**、TypeScript **5.9.3**。
- 测试辅助：node-forge **1.3.1**、ipaddr.js **2.5.0**；沿用之前的独立临时依赖目录，不代表新增生产依赖建议。
- 直接提取 Markdown 中带源文件标记的 TypeScript 代码块执行。新增类型检查使用真实编译器语义检查，不以转译成功代替类型检查。
- HTTP/TCP/TLS 探针仅使用本地回环；本轮审计文件读、追加、覆盖和删除使用真实临时文件系统，并在指定交错点加入调度屏障。
- 数据库写入、完整启动、SSH、KILL 均使用受控替身。熔断测试是组件接口完整性观察，不是完整 gateway 端到端测试。
- **没有连接真实 MySQL/SSH 服务，没有执行真实 KILL，没有容器集成，没有全工程 `tsc`。**

### 2.2 材料

- [第五轮复现脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round5.repro.cjs)
- [第五轮原始证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round5.evidence.json)
- [第四轮脚本在当前正文上的原样执行证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round5.legacy53.evidence.json)

脚本退出码 0 表示观察完成，不代表设计通过；应检查 `summary`、各观察的 `invariantHolds` 和正文哈希。

## 三、BE-R5-01 [P1] — 二次读文件后仍有并发窗口，审计日志仍会被删除或覆盖

**性质：** BE-R4-02 的不完整修复，保留 P1；不是因旧反例未通过而重复开单。

**定位：** [正文 L4634–4640](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4634)，相关 writer 为 [L4606–4611](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4606)。源分片：[part10 L343–349](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part10_audit_and_stats.md#L343)。

### 3.1 根因

v1.4.0 的修改记录了初次读取字节数，写库完成后重新读取文件：无尾部则删除，有尾部则用 `writeFile` 回写未消费尾部。它修复了“在等待写库期间追加”的原用例，但**第二次读取仍只是一个快照，不会排斥之后的追加**。

从最后一次读取到 `unlink`／`writeFile` 完成之间没有 writer 协调、文件封存或其他互斥协议；当前实现仍会破坏一个正在被追加的文件。`writeFile` 回写旧快照中的尾部，也不是“只从当前文件移除已消费前缀”的原子操作。

### 3.2 反例 A：二次读取之后追加，走 unlink 分支

```text
1. A 经正常降级路径成功追加到文件。
2. 重放初次读取 A，模拟 MySQL 成功写入 A。
3. 第二次真实 readFile 取得只有 A 的快照；在返回清理逻辑前暂停。
4. B 经 reserve → commit → flushBatch，完成真实 appendFile；文件此时为 A+B。
5. 继续清理。依据旧快照判定“无新追加”，unlink 整个文件。
```

实际观察：删除前文件包含 A、B；模拟 MySQL 仅持有 A；清理后没有文件、没有 B，队列和在途计数为 0。B 是已完成降级落盘后被后续重放删除的事件，不是尚未提交的事件。

**证据键：** `r5_replay_unlink_after_last_read`。

### 3.3 反例 B：二次读取之后追加，走尾部回写分支

```text
1. 重放初次读取 A。
2. 等待模拟 MySQL 写入 A 时，B 成功追加；文件为 A+B。
3. 第二次真实 readFile 得到 A+B 的快照；暂停。
4. C 经正常降级路径成功追加，文件为 A+B+C。
5. 继续清理。以旧快照计算尾部 B，writeFile 将整个文件替换为 B。
```

实际观察：覆盖前文件包含 A、B、C；模拟 MySQL 仅持有 A；覆盖后仅剩 B，**C 丢失**，队列和在途计数仍为 0。

**证据键：** `r5_replay_rewrite_after_last_read`。

两个反例的读写均落在真实临时目录。文件系统替身只在第二次真实读取快照后设置调度屏障，不伪造文件内容，也不替换原实现的删除/覆盖算法；MySQL 的成功与失败由受控替身产生。这证明了合法并发交错下的组件缺陷，不宣称进行了真实数据库故障集成。

### 3.4 影响与整改要求

**影响：** 应急审计在数据库恢复阶段仍可能静默丢失，违背无损降级和可恢复重放的设计目标。再读一次、再 stat 一次只能移动窗口，不能关闭窗口；单独加 `fsync` 也不能解决互斥问题。

**建议修改：**

1. 明确定义活动文件与已封存文件。writer 只能追加活动文件，replayer 只消费不会再被追加的封存文件。
2. 在与所有在途 writer 协调的屏障内完成轮转和文件所有权交接，不能仅 rename 而忽略已经取到旧路径或持有旧句柄的 writer。
3. 已封存批次重放成功后才归档/删除；失败保持原文件可重试，并定义重复 replayer 的所有权、幂等和崩溃恢复行为。
4. 如果采取同进程互斥方案，锁必须覆盖同路径的 append 与完整 read/清理事务，不是只锁 replayer 自己；同时应评估长时间持锁造成的审计背压和容量占用。
5. 不要用“再读一次文件长度”作为并发正确性的替代证明。

**验收：** 保留第四轮旧用例，再加入本轮两个最后读取后的追加交错；所有已确认落盘的事件必须处于数据库或可恢复文件之一。补充 writer 已持有旧路径/句柄、并发 replayer、归档前崩溃和存储写失败的验收。

**一手资料核对：** Node 22.22.0 的文件系统文档明确提示 Promise 文件操作不会替应用提供同文件并发修改的同步保障；`writeFile` 对既有文件执行替换写入。相关 API 本身没有把 read-check-delete／rewrite 组合变成原子事务。本轮判定仍以真实文件复现为主要证据。

## 四、BE-R5-02 [P2] — 死循环熔断器没有失败反馈和状态更新接口，无法自行进入熔断状态

**性质：** 本轮新识别的需求到组件接口设计缺口；不是由 v1.4.0 新改动引入的回归。

**定位：** [正文 L2083–2116](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2083)，尤其是 [L2099–2101](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2099)。源分片：[part6 L711–744](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part6_data_plane_pipeline.md#L711)。需求依据：[REQUIREMENTS §5.2，L198–201](D:/E/PersonalProjects/mysql-mcp/docs/REQUIREMENTS.md#L198)；总体架构的错误码约定：[L1271](D:/E/PersonalProjects/mysql-mcp/docs/ARCHITECTURE_SPEC.md#L1271)。

### 4.1 设计缺口

需求明确要求在滑动窗口中追踪执行流水，并在连续相同/相似错误达到阈值时熔断，默认阈值为 3、窗口为 30 秒。

当前 `AgentLoopBreaker`：

- 初始化一个私有空 `states` Map；
- 仅公开 `checkBeforeExecution(userId, profileId, sql)`，以及静态指纹计算；
- 检查时读取 Map，没有条目便直接返回；
- 类内没有 `states.set`，也没有失败反馈、成功重置、窗口推进或过期清理入口；
- `count`、`firstErrorAt` 从未更新，快照中虽携带 threshold/window，组件接口没有接收并使用这些值的路径。

在本次受评正文中没有发现调用方可使用的状态更新协议。调用方即使有查询错误，也无法通过已设计的公开接口把错误交回此组件；用 `as any` 越过私有字段直接改 Map 不属于可接受的实现契约。

### 4.2 观察与边界

组件探针按“执行前检查 → 受控查询失败”的次序运行 10 次。当前类没有结果反馈入口可调用，最终状态条目数为 0，未抛出 `ERR_AGENT_LOOP_DETECTED`。运行时枚举的实例方法只有 `checkBeforeExecution`。

为排除“错误分支本身失效”，正向对照仅在测试中手动注入一个已阻断状态，同一 guard 能抛出预期错误码。因此缺口在于**如何从执行结果形成状态**，而不是错误文案或 Map 查询写错。

**不能过度解释这项测试：** 本次没有运行完整 gateway，受控失败没有经过真实生命周期。此用例不是要求一个无反馈的 pre-check 凭空感知数据库错误；它暴露的正是详细设计缺少结果反馈接口和接线位置，现有公开接口无法完成需求中的状态转换。

**证据键：** `r5_loop_breaker_can_build_failure_state`、`r5_loop_breaker_seeded_state_control`。

### 4.3 影响与整改要求

**影响：** 按当前组件公开接口落地，熔断器会始终读不到自然产生的阻断状态；连续错误仍只能依赖 QPM 等其他机制限制。QPM 限流不等同于按连续错误触发的熔断，不能用它作为需求已满足的依据。

**修改要求：**

1. 明确执行后反馈接口，例如 `recordOutcome`，定义它接收的主体/Session、Profile、SQL 指纹、结果类别和时间；名称可自行选择，关键是职责及调用时序必须完整。
2. 写清连续失败累加、成功或不同语句如何打断连续性、窗口到期与冷却到期如何重置，并给出同步状态转换算法。
3. 定义哪些错误计入熔断：数据库错误、AST/ACL 拦截、客户端取消、超时是否计入，避免错误归类不一致。
4. 将阈值/窗口配置真正接入组件，说明执行完成和失败路径均恰好反馈一次；明确按 Session 还是按 user/Profile 隔离，若与需求 §5.2 的 Session 口径不同需同步修订契约。
5. 定义状态容量与过期清理，避免完成熔断后引入无界 Map。

**验收：** 通过公开接口，在默认阈值下连续相同失败达到阈值后拒绝后续重试；不同主体/Session 不串扰；成功、不同 SQL、窗口到期、冷却结束和配置变更行为均可测试。测试不能靠手动写私有 Map 作为正常成功路径。

## 五、其他已验证内容与仍保留的门禁

### 5.1 本轮正向验证

- **完整 Registry/Snapshot 代码块的类型语义检查**：仅以最小本地 AppError 类型替代其导入，其余正文代码保持原样，TypeScript 5.9.3 `strict: true`、0 诊断；这比只检查两个方法签名更能覆盖实际返回实现。
- **ACL 规则作用域**：传入当前角色为 `1` 时，当前角色的 `profileId=0` 规则保留，不相关角色与 Profile 的规则被剔除；`01`/`00` 经过规范化后仍正确匹配。
- **SSH 并发故障恢复**：首批两个并发调用共享一次失败的堡垒机解析，失败后缓存为 0；恢复后的下一次调用重新解析并成功。
- **熔断拒绝分支对照**：测试注入已阻断状态后错误分支工作正常，支持把问题限定为状态形成及反馈契约缺失。

### 5.2 不应由本轮结论推导的事项

- 没有证明完整 MySQL 认证、SSH 主机校验、KILL 权限与取消隔离已经集成通过。
- 没有证明上游 `roles` 集合必然只属于该用户；本轮只验证 builder 对所提供角色集合的 ACL 行过滤。应保留用户—角色关联读取与校验的集成验收。
- 没有完成 JSONL 重启恢复、半行损坏、容量上限、磁盘故障、文件系统崩溃一致性等运维门禁。
- 没有全仓工程，不能把一个代码块和签名的语义检查称为完整构建通过。

## 六、复现与交付

### 6.1 本轮文件

- [评审报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/BACKEND_DESIGN_REVIEW_ROUND5.md)
- [第五轮脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round5.repro.cjs)
- [第五轮执行证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round5.evidence.json)
- [旧脚本本次原样执行证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round5.legacy53.evidence.json)

### 6.2 本机运行

依赖位于项目外的独立临时目录。本机可运行：

```powershell
Set-Location -LiteralPath 'D:\E\PersonalProjects\mysql-mcp'
$tmp = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$env:NODE_PATH = "$tmp\node_modules;$tmp\r3-extra\node_modules"
# 使用独立输出，避免覆盖本轮交付证据：
$env:REVIEW_EVIDENCE_FILE = Join-Path $tmp 'round5-rerun.evidence.json'
& "$tmp\r2-node22\node_modules\node\bin\node.exe" `
  'D:\E\PersonalProjects\mysql-mcp\docs\reviews\backend-design-review-round5.repro.cjs' `
  'D:\E\PersonalProjects\mysql-mcp\docs\BACKEND_ARCHITECTURE_SPEC.md'
```

新环境需在独立目录准备上述精确依赖和 Node 22.22.0，并设置 NODE_PATH。脚本产生真实临时测试文件；临时路径、时间戳和回环端口会变化，不以整份 JSON 字节一致作为验收标准。对照 `regression`、`extension`、`summary`、`harnessCorrections` 与正文哈希即可。

### 6.3 一手 API 依据

Node.js v22.22.0 文件系统文档的 Promise API 并发警告和 `fsPromises.writeFile` 替换语义已核对：

```text
https://nodejs.org/download/release/v22.22.0/docs/api/fs.html
```

需求和总体架构的本地链接已列在 BE-R5-02 中。本报告不依赖二手博客判断并发、状态机或接口是否正确。

## 七、建议评审决议

**接受表名身份、SSH 失败恢复、类型交接和所测 ACL 行过滤的整改；暂不关闭审计无损重放问题。** 要求下一版落实 writer/replayer 的文件所有权与协调协议，而非继续追加文件长度判断；同时补齐熔断状态机和结果反馈接口。两项修订通过组件回归后，仍需完成真实数据库/SSH 和全工程构建门禁，才能批准后端实施终稿。
