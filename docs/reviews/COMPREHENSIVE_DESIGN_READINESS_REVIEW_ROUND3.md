# 综合开发准入评估：第三轮剩余问题复核

- 日期：2026-11-12（Asia/Shanghai）。
- 基线：第二轮报告的 RR2-01（归属 RD-02）关闭条件，以及 RD-08 决策/签署门禁。
- 受评版本：系统架构 v1.2.2、后端 v1.7.3、前端 v1.4.2、接口契约 v1.5.2、数据库 v1.0.2。
- 范围：定点检查本次修复，并回归受影响的查询链路、类型、生成源；不是重新开展无边界的全系统审计。

## 一、结论

**本次技术整改复核通过：RR2-01 关闭，RD-02 在原设计整改范围内完整关闭。原8项技术问题现已全部在设计文档/可执行片段层面关闭；本轮限定范围内没有剩余 P1/P2 技术缺陷。RD-08 仍为待决策/签署事项，不能宣称全部门禁均已通过。**

开发准入分为两个层次：

1. **可以进入开发阶段。** 不必继续围绕已关闭的技术问题反复修改五份文档；可以推进工程实现与集成准备，并按已确定的契约开展联调。
2. **暂不能无条件冻结正式联调基线。** RD-08 中影响 v1.0 外部行为的默认值、统计口径和角色优先语义等，仍须责任人明确决定并留下签署记录。受这些决定影响的实现和验收预期应标为暂定，不能把建议当成最终契约。

真实数据库、HTTP、浏览器、迁移及性能验证属于后续实施验收，不应倒置为开始开发的前提。本结论也不等同于完整应用已实现或可发布。

## 二、RR2-01 的关闭证据

| 上轮关闭条件 | 当前事实 | 判断 |
| --- | --- | --- |
| 消费者接收安全执行器，正确导入类型 | 后端 L5198–5218 明确导入 RowDataPacket 和 MetadataQueryExecutor，参数改为 queries: MetadataQueryExecutor，执行 queries.query | 满足 |
| 内部模块路径可解析 | 后端 L683–689 增加 core-engine 公共导出；Repository 和 Service 统一引用 @mysql-mcp/core-engine | 满足 |
| 调用侧不退回原始 Pool | 后端 L5232–5247 经 runtimeCtx.metadataQueries → createAuditQueryService → queryAuditLogs；明确禁止 raw Pool.query 旁路 | 满足 |
| 生成源同步 | 后端分片规范化拼接与正文完全相同；契约生成器 --check 通过 | 满足 |
| 跨模块编译与 UTC/释放验证 | 四个原文模块及调用者经真实 TypeScript/mysql2 声明编译零诊断；串联测试通过 | 满足 |

定位：[公共导出](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L683)、[审计Repository](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L5198)、[服务装配与约束](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L5232)。

### 不仅检查文字替换

- 实际提取 metadata-pool、公共 index、audit.repository、audit-query.service 四个模块，保留模块边界和导入关系，使用 TypeScript 5.9.3 strict 与真实 mysql2 类型声明检查；当前零诊断。
- 独立反向控制：恢复缺失 mysql2 命名空间的旧写法，出现2条 TS2503；只补导入但仍要求 Pool，出现 TS2345。对方本次测试还验证了错误相对路径产生 TS2307。
- 服务串联执行时，原始 Pool.query 被设为失败哨兵；正常路径必须借连接、等待 UTC SET 完成后才能 SELECT。
- 独立并发场景：第一个请求的 UTC SET 暂停，第二个请求可独立完成；第一个恢复后 SQL 失败，原错误继续传播。两个连接各释放一次，没有相互串扰。
- 独立恢复场景：UTC SET 失败后销毁该连接，不 SELECT、不 release；下一次请求借新连接，依次 SET、SELECT、release。
- 参数仍使用占位符；query_instance_id 的 trim 与大整数 ID 字符串保持。测试没有把用户输入拼接进 SQL。

**方法透明性：**独立脚本复用了对方测试的原文提取、编译及模块加载辅助函数，以避免另造一套被测实现；断言和上述并发/失败恢复场景由本轮另写。它不是完全独立实现的第二套测试框架。

## 三、原问题清单状态

| 编号 | 本轮结论 |
| --- | --- |
| RD-01、RD-03、RD-04、RD-05、RD-06、RD-07、RD-09 | 保持关闭；本轮重跑已有15项正向整改检查，未发现本次修改导致回退 |
| RD-02 / RR2-01 | 本轮关闭；上轮唯一剩余技术项完成类型、导入和调用链迁移 |
| RD-08 | 保留；没有用技术测试结果替代产品/接口维护者签署 |

普通分页仍是既有占位分支，HTTP授权与数据范围守卫也未在本轮实现。后端 L5250 已明确边界；本轮既不将其宣传为完成，也不把未受此次修复影响的占位项重新列为新缺陷。

## 四、本轮实际运行结果

对方修复测试在新建临时镜像中重跑，避免覆盖原工作区历史证据；本轮独立脚本核对了镜像测试的源文件哈希与当前工作区一致，并将重跑证据完整嵌入本轮证据。

| 验证组 | 本轮结果 |
| --- | --- |
| 本次 RR2-01 正向/反向/串联检查 | **7/7通过** |
| 前次综合整改正向检查 | **15/15通过** |
| 数据库静态/顺序模型 | **1067项断言通过** |
| 数据库静态检查器反向变异测试 | **3/3通过** |
| 本轮独立检查组 | **6/6通过** |
| 后端分片拼接与契约生成检查 | **通过**，已包含于上述检查组 |

这些组存在覆盖重叠，不合并为一个夸大的“总测试数”。本轮没有重跑历史96项全套回归，不将上轮的96/96记作本轮结果。

环境：Node.js 22.22.0、TypeScript 5.9.3，使用本机既有依赖。本轮未运行真实 MySQL、真实 HTTP、浏览器端到端或完整项目构建；并发检查使用受控连接，不能当作 InnoDB 双连接事务证明。

## 五、RD-08 仍需处理，但不要求重开技术整改

[数据库设计 §15.1，L1155–1172](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L1155)仍明确记载：

- 角色优先语义须由接口维护者/产品等签署，**未签署前不冻结联调基线**（L1163）。
- 全局 burst：新库暂取10、旧15不自动覆盖（L1164）。
- 库级 ACL：v1.0 精确名；如需通配，先补规范（L1165）。
- 密码 daysRemaining：建议向上取整等，待前后端文案联调（L1168）。
- DST 日桶：固定1440分钟与23/25小时自然日的冲突仍待澄清（L1169）。

这里的结论是**仓库材料中未见完成签署的证据**，不是断言责任人在仓库外从未审批。应由责任人将影响本期的决定、适用范围和验收口径补齐；若某项明确不纳入 v1.0，也应留下范围决定。无需因此再次全面重写五份文档。

## 六、变更与证据保护

- 对比上轮记录的9个源文件哈希，只有后端正文发生变化，其余4份设计、物理DDL、3份生成契约产物保持一致；后端相关生成分片已同步。
- 本轮脚本核验 **184个既有文件**在执行前后哈希不变。
- 本轮只新增本报告、复核脚本、证据JSON；没有修改设计正文、对方测试或历史评审材料。
- 上轮报告中的“剩余P2”是其受评版本的历史结论，不应回写抹除；当前关闭状态以本轮报告为准。

产物：

- [复核脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/comprehensive-design-readiness-round3.repro.cjs)
- [完整证据及源文件SHA-256](D:/E/PersonalProjects/mysql-mcp/docs/reviews/comprehensive-design-readiness-round3.evidence.json)

### 复现方式

以下命令在仓库根目录执行，使用既有依赖；先在全新的临时镜像重跑对方测试，再回原工作区生成本轮证据，不覆盖历史证据。

```powershell
$root = 'D:\E\PersonalProjects\mysql-mcp'
$deps = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$extra = Join-Path $env:TEMP 'mysql-mcp-cross-review-20261111'
$env:NODE_PATH = "$deps\node_modules;$deps\r3-extra\node_modules;$extra\node_modules"
$env:PYTHONIOENCODING = 'utf-8'
$node = "$deps/r2-node22/node_modules/node/bin/node.exe"
$mirror = Join-Path $env:TEMP ('mysql-mcp-readiness-r3-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $mirror | Out-Null
Copy-Item -LiteralPath "$root/docs","$root/scripts" -Destination $mirror -Recurse
Push-Location $mirror
try {
  & $node docs/reviews/comprehensive-design-readiness-round2.remediation.test.cjs --regressions
  if ($LASTEXITCODE -ne 0) { throw 'Remediation regression failed' }
} finally { Pop-Location }
Push-Location $root
try {
  & $node docs/reviews/comprehensive-design-readiness-round3.repro.cjs --mirror $mirror
  if ($LASTEXITCODE -ne 0) { throw 'Independent review failed' }
} finally { Pop-Location }
```

**最终判断：技术整改通过，可以进入开发；RD-08 的决策/签署是正式基线冻结前的剩余动作，不是尚未修好的 RR2-01。**
