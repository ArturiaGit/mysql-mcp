# 后端详细设计第四轮复审报告

- 评审日期：2026-11-08（Asia/Shanghai）。
- 评审对象：[后端详细设计 v1.3.0](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md)，218,793 字节、4,798 行。
- 受评正文 SHA-256：`65522F75AE0DECA5444178DF62E624375618CAAEAC889BAEBA68D2AFFEA19B59`。
- 对照材料：需求 v2.3.0、总体架构 v1.2.1、前端详细设计 v1.4.0，以及前三轮评审报告和复现脚本。
- **结论：修改后复审（Request Changes）。本轮新增 4 项需修改问题：2 项 P1、2 项 P2。上一轮 8 项问题的原有反例均未再复现，不重新计入本轮问题。**
- 本文所引行号均基于上述哈希的正文。正文与生成器规定的 11 个源分片拼接结果逐字节一致。未修改设计正文、源分片、生成器或前三轮评审文件。

## 一、上一轮整改复核

先独立运行第三轮脚本，输出到临时文件，再用第四轮脚本完整重跑原有观察并扩展边界。两次原有 45 项均为 **45/45 不变量成立**，与 v1.3.0 页首声明相符。

| 第三轮问题 | 本轮原有用例的结果 | 关闭边界 |
| --- | --- | --- |
| BE-R3-01：无库前缀的反引号 `dual` 被漏提取 | 已提取真实 `dual` 表；裸 DUAL 仍正确识别为无表查询 | 原反例关闭；不代表所有标识符处理均正确，见 BE-R4-01 |
| BE-R3-02：TLS 可绕过证书信任与主机名校验 | 可信匹配证书可通过；错误主机名和自签不可信证书被拒绝 | 本地真实 TLS 握手覆盖；未验证完整 MySQL 认证协议 |
| BE-R3-03：SSH 缓存忽略连接与信任配置变更 | 更换堡垒机配置创建不同 client，缺失指纹的新连接被拒绝 | 受控 ssh2 替身验证；失败恢复另见 BE-R4-03 |
| BE-R3-04：KILL 使用可变端口或缺失租约回退 DNS | 使用原端点端口；没有租约则在 TCP/SQL 前拒绝 | 参数和调用记录验证，未执行真实 KILL |
| BE-R3-05：启动后没有活动 Profile 池 | Registry 读取活动配置并交给 warm-up，运行时可建立池条目 | 原运行时反例关闭；类型交接另见 BE-R4-04 |
| BE-R3-06：本地推算版本越过已提交 DB 版本 | 并发通知次序反例不再导致永久墓碑 | 受控读取/通知次序验证 |
| BE-R3-07：停机不等待高危写入和预留槽位 | 两类在途工作均被 stop 等待 | 原时序反例关闭；不覆盖 JSONL 重放并发 |
| BE-R3-08：TLS 元数据补丁依赖 cwd/NODE_PATH | 独立 Node 子进程在无依赖的 cwd 下成功安装补丁并继承端点与复位函数 | 使用实际锁定 mysql2 的原型路径验证 |

这些修订有实质效果。本轮结论不是“此前整改无效”，而是原有用例之外还有四个可复现边界需要补齐。

## 二、验证方法与结果

### 2.1 运行环境

- Node.js **v22.22.0**；mysql2 **3.24.6**；node-sql-parser **5.4.0**；Fastify **5.12.8**；TypeScript **5.9.3**。
- 测试辅助依赖：node-forge **1.3.1**、ipaddr.js **2.5.0**。这些是本次复现环境的实际版本，不是新增生产依赖建议。
- 从 Markdown 中按源文件标记提取 TS 代码块，转译后执行原文实现；类型问题单独用 TypeScript 编译器进行语义检查，而不是只调用 `transpileModule`。
- HTTP、TCP 和 TLS 仅使用本地回环。新增审计用例使用真实临时文件系统，新增 SSH 用例使用受控 DNS/ssh2 替身；所有 MySQL 写入、KILL 和完整启动均是受控替身。
- **没有连接真实 MySQL/SSH 服务，没有运行容器集成，没有全工程 `tsc`。** 当前工作区尚没有完整后端工程，不能由文档片段测试推导系统已可部署。

### 2.2 观察数量

| 范围 | 总数 | 不变量成立 | 被反例否定 |
| --- | ---: | ---: | ---: |
| 原有前三轮观察 | 45 | 45 | 0 |
| 本轮新增观察 | 8 | 3 | 5 |
| 合计 | **53** | **48** | **5** |

新增 5 条反例归并成 4 项问题；表名身份丢失与 CTE 误认属于同一根因，不重复计数。其余三个新增观察为正向对照：同名 CTE 的正常识别、无暂时故障的 SSH 建连、无并发追加的封存文件重放。

- [第四轮复现脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round4.repro.cjs)
- [第四轮原始证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round4.evidence.json)

`invariantHolds: false` 表示设计不变量被当前输入否定。脚本退出码 0 只表示观察已完成，不能作为评审通过标记。

## 三、P1：需要在相应核心模块实现前修正

### BE-R4-01 [P1] — trim 改变合法表名身份，且会把真实表误认成 CTE

**定位：** [正文 L2213–2214](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2213)、[CTE 匹配 L2274–2277](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2274)。源分片：[part7 L33–34](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part7_ast_and_mcp_tools.md#L33)。

**触发条件：** 库中存在带前导空格的反引号表名；数据库账户可以访问该表，但应用层 ACL 不允许访问它。MySQL 允许引号标识符包含空格；禁止数据库/表/列名称以空格结尾，不等于禁止以空格开头。这里不是 SQL 外围格式空白，而是表名自身的一部分。

原文对 AST 标识符统一调用 `ident.trim()`，导致授权对象与实际执行对象分离。直接执行锁定 parser、ScopeExtractor、AstValidator、LimitRewriter 后得到：

| 输入 | 原 parser 保留的真实表名 | 提取结果 | 最终改写仍引用 |
| --- | --- | --- | --- |
| `` SELECT * FROM ` orders` `` | `" orders"` | `app.orders` | `` ` orders` `` |
| `` WITH salary AS (SELECT 1) SELECT * FROM orders JOIN ` salary` ON 1=1 `` | `"orders"`、`" salary"` | **仅 `app.orders`** | `` `orders` INNER JOIN ` salary` `` |

第二个例子不是单纯 ACL key 格式不一致：`" salary"` 被 trim 为 `salary`，命中 CTE 名集合，真实表引用直接从待授权列表中消失。查询仍含 `orders`，不能靠“没有提取到表就拒绝”的兜底发现漏项。两个输入均通过原文的只读与安全校验，LIMIT 改写也保留原始表名。

**影响：** 若按提取结果执行表级 ACL，前一个输入可能借用 `orders` 的授权；后一个输入使真实 `" salary"` 表完全不参与 ACL 检查。是否实际读取数据取决于目标库表存在及数据库账户权限，本次没有执行真实读库或生产 ACL evaluator，不宣称已实证数据泄露。

**修改要求：**

1. 对 AST 已解码的标识符保留原始字符，不执行 trim、空白折叠等改变对象身份的处理；大小写折叠按目标实例规则单独处理。
2. 如果产品不支持某类合法标识符，明确在执行前拒绝，不要改名后按另一个对象授权。
3. CTE 名比较与物理表授权使用一致、不会造成身份碰撞的规则；不要只针对这两个 SQL 写特判。

**验收：** 正确提取 `app. orders` 与 `app. salary`；在仅允许 `app.orders` 的 ACL 下拒绝这些读取。正常 `JOIN salary` CTE 仍可通过。补充真实 MySQL 8.0 上前导空格表名与 CTE 的集成测试，并覆盖库名、显式库限定、嵌套查询及三种 `lower_case_table_names` 规则。

**证据键：** `r4_quoted_identifier_identity`、`r4_cte_name_must_not_shadow_different_physical_identifier`；正向对照 `r4_exact_cte_alias_control`。

### BE-R4-02 [P1] — 重放读取后继续追加同一 JSONL，最后 unlink 会丢失新事件

**定位：** [追加路径 L4561–4565](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4561)、[重放 L4571–4582](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4571)。源分片：[part10 L315–336](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part10_audit_and_stats.md#L315)。

**触发条件：** 数据库恢复过程中，对当日应急文件启动重放；同一文件尚未封存，期间又有普通审计事件因写库失败而追加。文档没有封存文件类型、轮转屏障或互斥机制，`replayEmergencyLogsToDb(filePath)` 也不校验文件是否仍被写入。

**确定性复现次序：**

1. 通过原 `reserveSlotOrBackpressure → commit → flushBatch` 路径，让事件 A 写库失败后落到当日 JSONL。
2. 启动重放，读取包含 A 的文件，并把重放的 MySQL 写入挂起。
3. 再通过相同路径提交 B，使 B 写库失败、成功追加到同一真实文件；此时文件内容为 A、B，队列已清空。
4. 放行 A 的重放写入。重放只持有此前读取的 A，成功后直接删除整个文件。

**实测结果：**

```text
unlink 前文件事件： [r4-A, r4-B]
模拟 MySQL 成功写入： [r4-A]
重放返回条数：       1
重放后剩余文件：     []
剩余队列/在途计数：  0
```

B 已被普通降级审计路径视为写入成功，之后却既不在模拟数据库中，也不在文件或队列中。这里使用真实临时目录和文件读写；数据库成功/失败时机由替身控制，不是真实 MySQL 故障注入。

**影响：** 应急审计数据在恢复时静默丢失，破坏“失败则保留、恢复可重放”的设计承诺。`INSERT IGNORE` 只解决重放重复，不能保护读快照之后追加的字节。

**修改要求：**

- 定义“活动写入文件”和“封存待重放文件”的状态，重放只能消费已封存文件。
- 在与 writer 协调的轮转屏障内切换新活动文件，确认旧文件不再有在途追加后再交给重放；仅单独做 rename，而不协调已取到旧路径或文件句柄的 writer，也不足以保证安全。
- 重放成功后只归档/删除该封存批次；失败和进程重启时保持可恢复、幂等。

**验收：** 保留本轮 A/B 交错用例；B 必须留在新活动文件或已经入库。再补充轮转时正在 append、并发重放、重放失败、写库成功但归档前崩溃的测试。若只允许停写后的离线重放，应把前置条件编码为强制状态校验，不能仅依赖运维自觉。

**证据键：** `r4_replay_must_not_delete_concurrent_append`；正向对照 `r4_sealed_file_replay_control`。

## 四、P2：接口可实现性与故障恢复需要补齐

### BE-R4-03 [P2] — 建连前的暂时失败被永久缓存，同配置无法自行恢复

**定位：** [getOrCreateClient L3701–3721](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3701)、[缓存写入 L3762](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3762)。源分片：[part8 L1041–1057](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part8_core_engine_pool.md#L1041)。

**触发条件：** 首次访问堡垒机时，`resolveAndValidateHost(sshConfig.host)` 暂时抛出 `EAI_AGAIN` 等错误。异步 IIFE 对应的 Promise 已写入 `activeClients`，但错误发生在 SSH client 和 error/close 监听器创建之前。

当前删除逻辑只覆盖 SSH 计时器和 client 事件，因此上述拒绝的 Promise 留在缓存。之后同一完整配置元组命中它，不再做 DNS 或建连。使用精确实现和受控 guard（第一次失败、第二次本可成功）连续访问两次，结果为：

```text
堡垒机 DNS/guard 调用： 1 次
ssh2.connect 调用：     0 次
两次返回错误：          EAI_AGAIN / EAI_AGAIN
失败后缓存条目：        1
```

无暂时故障的新 manager 对照可正常到 ready 并建立 channel，排除了替身自身不可用。

**影响：** 一次暂时故障变成该配置持续不可用；现有实现只能通过关闭/清空 manager、重启或改变缓存键恢复。修订后的完整配置缓存键解决了信任串用，但没有覆盖失败 Promise 的生命周期。

**修改要求：** 对最外层建连 Promise 的全部拒绝路径进行条件淘汰：仅在 `activeClients.get(key)` 仍等于该 Promise 时删除，避免旧失败误删新连接。要覆盖 guard、解密和同步 `connect()` 抛错，不只监听 client.error。保留连接建立过程中的并发合并，并按需设置有界退避，避免失败后重试风暴。

**验收：** 暂时失败后同配置第二次调用重新执行 guard 并成功；并发首批只建立一个连接；旧 Promise 失败不能删掉新的缓存条目。永久策略拒绝可明确返回拒绝，但不应与无期限缓存暂时失败混在一起。

**证据键：** `r4_ssh_transient_preconnect_failure_can_retry`；对照 `r4_ssh_ready_control`。

### BE-R4-04 [P2] — Registry 返回类型与 warm-up 入参不兼容，启动调用产生 TS2345

**定位：** [启动调用 L184](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L184)、[Registry 返回类型 L1771–1773](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1771)、[warm-up 入参 L3066–3079](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3066)。源分片：[part6 L393](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part6_data_plane_pipeline.md#L393)、[part8 L406](D:/E/PersonalProjects/mysql-mcp/scripts/be_parts/part8_core_engine_pool.md#L406)。

v1.3.0 新增的运行时配置交接已经修复“启动后没有池”的旧反例，但声明不一致：

```typescript
// RegistryHub
getActiveProfileConfigs(): Array<Record<string, any>>

// PoolManager
warmUpActiveProfiles(activeProfileConfigs?: Array<{
  id: string; name: string; host: string; port: number;
  username: string; passwordEncrypted: string;
  defaultDatabase: string; maxPoolSize: number; queueTimeoutMs: number;
  // ...可选 TLS/SSH 字段
}>): Promise<void>

// bootstrap 原调用
await poolManager.warmUpActiveProfiles(registryHub.getActiveProfileConfigs());
```

将两个实际签名与实际调用提取到最小编译单元，用 TypeScript 5.9.3 进行语义检查，得到 **TS2345**：`Record<string, any>[]` 不能赋值给所需配置数组，因为不保证含有 `id`、`name`、`host` 等必填属性。字符串索引签名里的 any 不等于整个对象是 any。

**影响：** 按这些接口落成同一 TypeScript 工程后，该启动调用无法通过类型检查。此前运行时探针用转译执行，不做类型检查，因此 45/45 并不能发现这个接口问题。这不是已运行完整后端构建后的报错，而是原签名与调用在实际编译器中的最小语义复现。

**修改要求：** 提取共享的 `ActiveProfileConfig` 类型；让 Registry 的缓存、映射结果、返回值和 PoolManager 参数使用同一类型。在元数据行映射处验证 JSON/密文字段。不要通过 `as any` 或放宽 warm-up 参数来掩盖必需字段契约。

**验收：** 此最小编译用例无 TS2345；省略 host、port 等必需字段时仍报错。完整工程建立后再执行 workspace `tsc --noEmit`，不以 `transpileModule` 成功代替语义类型检查。

**证据键：** `r4_bootstrap_config_signature_typechecks`。原始证据含完整 fixture、提取签名及编译器诊断。

## 五、待澄清与集成门禁（不计入上述四项已复现问题）

1. **权限构建接口的角色作用域：** `SnapshotBuilder` 的 ACL 行包含 roleId，但只按 profileId 过滤；roles 也由外部传入。当前没有完整上游组装代码，无法认定请求确实会拿到其他角色的 ACL，因此本轮不声称已复现跨角色越权。应明确：由 builder 校验实际角色交集并过滤 ACL，还是调用方必须提供经校验的集合；选择后增加“混入其他角色行”的测试，不留下隐含安全前置条件。
2. **真实 MySQL 8.0：** 原始 SQL、改写 SQL、对象解析与应用 ACL 必须使用同一语义；补充前导空格对象、大小写及 CTE 的容器验收。
3. **真实 TLS/SSH/KILL：** 本地 TLS 握手不是完整 MySQL 连接；受控 SSH/KILL 调用记录不是堡垒机/数据库集成。需要实际验证配置切换、端点租约、证书校验与取消连接隔离。
4. **审计故障与恢复：** 应急容量、轮转、重启重放和 JSONL 半行损坏等仍需工程/运维验收。本轮只证明了一个具体的并发删除数据问题，不能把它的修复等同于整个恢复协议已验收。

## 六、复现与交付

### 6.1 文件

- 本报告：[BACKEND_DESIGN_REVIEW_ROUND4.md](D:/E/PersonalProjects/mysql-mcp/docs/reviews/BACKEND_DESIGN_REVIEW_ROUND4.md)
- 复现脚本：[backend-design-review-round4.repro.cjs](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round4.repro.cjs)
- 本次证据：[backend-design-review-round4.evidence.json](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round4.evidence.json)

### 6.2 本机复现命令

依赖安装在工作区之外的独立临时目录，没有向项目添加 package.json、lockfile 或 node_modules。本机现有目录可直接使用：

```powershell
Set-Location -LiteralPath 'D:\E\PersonalProjects\mysql-mcp'
$tmp = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$env:NODE_PATH = "$tmp\node_modules;$tmp\r3-extra\node_modules"
# 如不希望覆盖本次证据，指定新的输出路径：
$env:REVIEW_EVIDENCE_FILE = Join-Path $tmp 'round4-rerun.evidence.json'
& "$tmp\r2-node22\node_modules\node\bin\node.exe" `
  'D:\E\PersonalProjects\mysql-mcp\docs\reviews\backend-design-review-round4.repro.cjs' `
  'D:\E\PersonalProjects\mysql-mcp\docs\BACKEND_ARCHITECTURE_SPEC.md'
```

新环境需在独立目录准备 Node 22.22.0 与上述锁定依赖，并令 NODE_PATH 指向对应 node_modules。脚本会创建仅供本次测试使用的临时目录，不会对外部服务发起数据库/SSH/KILL 操作。原始证据中的临时路径、时间和回环端口每次可能不同；验收应比较观察不变量与受评正文哈希，而非要求整份 JSON 完全相同。

### 6.3 核对过的一手资料

以下用于解释 API/标识符语义；本地缺陷是否复现以脚本、原始证据和对应正文为准。保留可复制的资料地址：

```text
MySQL 8.0 Reference Manual — Schema Object Names
https://dev.mysql.com/doc/refman/8.0/en/identifiers.html

TypeScript Handbook — Type Compatibility
https://www.typescriptlang.org/docs/handbook/type-compatibility.html

Node.js v22.22.0 — File system
https://nodejs.org/download/release/v22.22.0/docs/api/fs.html

ssh2 v1.17.0 — Client API
https://raw.githubusercontent.com/mscdex/ssh2/v1.17.0/README.md
```

## 七、建议评审决议

**接受上一轮八项问题在原反例范围内已修复；不将 v1.3.0 直接批准为后端实施终稿。** 先补齐两项 P1 的对象身份与审计恢复协议，再同步修复 SSH 暂时故障恢复和共享配置类型；下一版保留原有 45 项并加入本轮 8 项回归。随后仍须通过真实 MySQL/SSH 和完整工程构建验收，才能关闭集成门禁。
