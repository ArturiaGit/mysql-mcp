# 后端详细设计第八轮限定范围复审报告

- 日期：2026-11-08（Asia/Shanghai）。
- 对象：[后端详细设计 v1.7.0](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md)，228,185 字节，5,163 行。
- SHA-256：`7D88B25FEDE3025EAD00D7410983C016C81E69A2F6CB33C21522D4A45B6F77A4`。
- 依据：[第七轮报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/BACKEND_DESIGN_REVIEW_ROUND7.md)中的 BE-R7-01（P1）与 BE-R7-02（P2）。
- **结论：本次限定范围复审通过。上轮两项问题在原反例及必要对照的验证范围内关闭，无遗留需修改项。**

## 一、范围约束

按照用户“不要扩大评审范围”的要求，本轮只做两件事：

1. 核验上轮审计重放丢失日志问题是否修复，复用原来的连续两次封存、首次快照前封存两条反例及独立 sealed 路径重放对照。
2. 核验原 `prev.now` 类型错误是否修复，复用原整个 limiter 代码块的 strict 语义检查。

未新增探针、交错或问题类别；未重新评审其他章节，未重跑原有 68 项全量基线。本次统计仅包含 4 项执行观察。源码与 11 个生成分片的一致性核对仅用于确认受评对象，不计作额外业务测试。

上轮第五条扩展观察 `r7_limiter_without_undeclared_property_control` 是在旧代码的内存副本中模拟移除错误表达式的定位对照。现在正文已移除真实属性访问，本轮不再重复此反事实对照，也不将它算成另一项独立通过。原始脚本与证据保留不变。

文档页首的“累计 73/73”属于修订方声明；**本轮不作独立确认，也不以本轮 4/4 替代该全量统计。**

## 二、复核结果

| 关联问题 | 原观察 | 本次结果 | 判定 |
| --- | --- | --- | --- |
| BE-R7-01 | `r7_replay_lease_repeat_seal` | 已确认 A/B/C；数据库含 A，备用文件保留 B/C；`lostEventIds: []` | 原反例通过 |
| BE-R7-01 | `r7_replay_lease_seal_before_snapshot` | 已确认 A/B；数据库含 B，备用文件保留 A；`lostEventIds: []` | 原反例通过 |
| BE-R7-01 对照 | `r7_two_seals_then_explicit_sealed_replay_control` | 数据库含 control-A/control-B，活动文件保留 control-C | 正向对照通过 |
| BE-R7-02 | `r7_limiter_module_semantic_typecheck` | TypeScript strict 组件语义检查 `diagnostics: []` | 原错误消除 |

合计：**4 项执行、4 项成立、0 条反例。** 各项仍使用上轮的断言及调度屏障，没有通过改变预期结果让修订通过。

### 2.1 BE-R7-01：关闭（限定于本轮复核范围）

修订位置：[重放逻辑 L4873–4948](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4873)，重点为 [L4893–4903](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4893) 与 [L4918–4939](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4918)。

本版没有照搬上轮建议的文件 lease 方案，而是改用等价的保全原则：写库成功后，以本次已入库的 `queryInstanceId` 集合为清理依据，不再把旧文件消费字节数套用到另一个文件。候选文件不含本次已入库事件时跳过；需要清理时在相应路径锁内重新读取，仅剔除集合内事件。

本轮核验的是“不能删除未成功入库的已确认事件”，而不是要求必须采用某种实现形式。原两种交错的实际结果如下：

- **连续封存：** A 入库后清理 A 的 sealed 文件，B 的 sealed 文件与 C 的活动文件均保留，不再因 redirect 被第二次覆盖而删除 B。
- **首次快照前封存：** 即便首次实际快照读取的是新活动文件 B，A 的 sealed 文件因不含本次已入库事件而保留；B 成功入库后才清理其对应内容。

因此，上轮两条数据丢失反例均不再成立，独立封存后重放的原对照仍成立。**不保留 BE-R7-01 为本轮阻断项，也不要求为采用不同修复方案而再次重构。**

### 2.2 BE-R7-02：关闭

修订位置：[窗口回退表达式 L2225–2229](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2225)。

实际表达式已变为 `now - prev.firstErrorAt <= windowMs`，不再访问未声明的 `prev.now` 属性。对同一完整 `dual-bucket-limiter.ts` 代码块执行上轮同选项的 TypeScript 5.9.3 strict 语义检查，返回零诊断，原 TS2339 消除。

检查仍仅替换本地 `AppError`、`EntityId` 导入，其余使用真实编译器及 Node 类型。本轮没有改动或扩展熔断业务验收场景，结论仅为上轮指出的组件类型错误已经修复。

## 三、环境与证据边界

- Node.js v22.22.0；TypeScript 5.9.3；mysql2 3.24.6；`@types/node` 26.6.6，沿用工作区外的独立临时依赖环境。
- 两条审计反例及对照使用真实临时文件，数据库写入由受控替身记录。首次快照前封存用例仅延迟首次实际文件读取，放行后读取真实字节。
- 三条审计观察及一条类型检查的代码直接复用第七轮对应部分；新脚本只裁去范围外测试、旧内存修复对照和全量统计汇总。
- 受评正文与生成器规定的 11 个分片拼接结果逐字节一致。
- **未执行真实 MySQL/SSH 集成、真实 KILL、容器验收或全工程构建。** 这只是已有问题的整改复核，不是重新给予整份设计或生产系统全面验收结论，也不新增这些既有集成门禁作为本轮问题。

## 四、交付与复跑

本轮只新增：

- [本报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/BACKEND_DESIGN_REVIEW_ROUND8.md)
- [限定范围复现脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round8.repro.cjs)
- [限定范围完整证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/backend-design-review-round8.evidence.json)

未修改设计正文、生成分片、生成器或前七轮报告/脚本/证据。

在本次已有临时依赖目录中复跑：

```powershell
Set-Location 'D:\E\PersonalProjects\mysql-mcp'
$tmp = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$env:NODE_PATH = "$tmp\node_modules;$tmp\r3-extra\node_modules"
$node = "$tmp\r2-node22\node_modules\node\bin\node.exe"
& $node --check docs/reviews/backend-design-review-round8.repro.cjs
Remove-Item Env:REVIEW_EVIDENCE_FILE -ErrorAction SilentlyContinue
& $node docs/reviews/backend-design-review-round8.repro.cjs docs/BACKEND_ARCHITECTURE_SPEC.md
```

同一受评版本的证据应包含：

```json
{
  "scope": ["BE-R7-01", "BE-R7-02"],
  "fullBaselineExecuted": false,
  "summary": { "total": 4, "holds": 4, "violated": 0 }
}
```

两条原审计反例的 `lostEventIds` 应均为空，limiter 语义诊断应为空。临时目录及封存时间戳不是固定断言。退出码 0 仅表示脚本运行完成，应同时核对上述证据字段及正文哈希。

## 五、最终意见

**同意关闭上轮 BE-R7-01、BE-R7-02，本次限定范围复审通过。** 无新增评审问题，不扩大整改清单。此结论不外推到未执行的 68 项基线，也不代替既定集成验收。
