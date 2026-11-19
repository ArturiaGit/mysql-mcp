# 数据库设计第一轮评审核验与修复记录

- 修复日期：2026-11-12（Asia/Shanghai）。
- 输入：`DATABASE_DESIGN_REVIEW.md`（2026-11-11），1项P1、3项P2。
- 范围：设计文档、文档中的可执行代码片段、生成源与校验脚本。当前目录不是Git仓库，也没有应用工程源码；没有执行数据库变更。
- 修订版本：数据库 v1.0.1、后端 v1.7.1、接口 v1.5.1、前端 v1.4.1。系统架构与DDL保持不变。

## 1. 查验结论

修改前运行原评审复现脚本，4项问题均成立：USER burst=1/GLOBAL=500时快照取500；无覆盖、角色QPM=60时GLOBAL从100变20不改变有效60，与原接口承诺矛盾；CSRF映射含注销；USER限流三行误用用户管理模板。原校验器同时通过984项断言，证实路径覆盖检查不能替代行为检查。

原评审报告、复现脚本及历史证据全部保留不变。新测试要求正确行为，不把原“证明缺陷存在”的断言反转后当作独立验收。

## 2. 逐项修复

| 编号 | 核验与修改 | 当前结论 |
| --- | --- | --- |
| DB-R1-01 / P1 | 后端§6.2增加`UserRateLimitConfig`和`mapUserRateLimit`，将同一USER行的QPM/burst成对传给快照；QPM仍为USER > ROLE > GLOBAL，burst改为USER > GLOBAL；更新/删除须同步失效并重载两项。数据库§6.3/7.5及DB-D17对应说明同步。 | 文档和可执行片段已修复；真实Repository及自动失效联调待验收。 |
| DB-R1-02 / P2 | API§6.7显式删除“后续全局限流变更自动联动”的错误承诺，统一为“无用户覆盖，按角色/全局策略计算”；不改变既有角色优先算法。前端§5.4区分已保存覆盖与有效QPM；个人大盘取执行侧有效值。数据库DB-D18、§15.1记录接口/产品签署门禁。 | 文本冲突已消除；接口维护者/产品签署与前后端联调尚未完成，不冒充已批准的外部行为变更。 |
| DB-R1-03 / P2 | CSRF映射改为建立/复用seed并返回token，不注销Session、不撤销授权上下文、不写业务库；logout保留注销语义。 | 追踪表及静态语义检查已修复；无真实HTTP运行结论。 |
| DB-R1-04 / P2 | 三个USER限流接口分别描述。GET只读覆盖、无行0/null；PUT规则与counter同事务、revision CAS；DELETE仅删除USER规则、保留counter/PAT、不重置用户版本；不以sys_users.version做CAS。 | 追踪表和反例检测已修复；数据库事务/并发仍待集成验收。 |

补充说明：USER PUT省略`burstCapacity`时按接口既有默认10落库（创建和更新均如此），而不是借用GLOBAL值。角色QPM含-1时仍按既有合并规则处理，Profile独立保护不变。未修改物理表或增加迁移。

## 3. 回归结果

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| `python scripts/validate_database_design.py` | **1067/1067**；原984项保留并新增83项语义断言 | 静态/顺序模型，不是MySQL解析器 |
| `python -B scripts/test_validate_database_design.py` | **3个测试方法通过**：当前矩阵通过；4条历史错误行及13个定向变异全部被拒绝 | 证明校验器能检测关键回归，不验证HTTP实现 |
| `node docs/reviews/database-design-remediation.test.cjs` | **14/14** | 提取完整当前后端TypeScript片段，使用冻结时钟执行，不手抄配额算法 |
| 同上加`--typecheck` | **15/15**，TypeScript **5.9.3** strict/noEmit检查零诊断 | 仅将外部AppError导入替换成类型桩；不是全项目构建 |
| 既有`cross-design-review-round4.repro.cjs` | **96/96**，14项原问题的回归条件均保持 | 沿用原脚本及依赖，包括本地SSH回环；无外部数据库 |
| 既有`backend-design-review-round8.repro.cjs` | **4/4** | 有界审计/熔断专项，不等同完整73项历史套件 |
| 三份变更文档与生成片段拼装 | **逐字一致** | 同步后端、接口、前端生成源；限流契约生成器也已同步 |

新可执行测试包含：USER=1/GLOBAL=500、USER=20/GLOBAL=10、更新后对既有桶收紧容量、删除后恢复角色QPM和GLOBAL burst、GLOBAL QPM变更不替代角色QPM、多角色最大值/-1、USER优先、无角色拒绝、无可用角色配额的兼容兜底、Profile保护不被-1绕过、GLOBAL熔断参数不被USER覆盖，以及契约/生成源一致性。

Node测试使用Node.js 24.16.0的原生TypeScript类型擦除（会输出实验性API警告）。默认14项不需第三方依赖；`--typecheck`和历史脚本需已安装的`typescript`、`@types/node`等依赖。此次复用临时目录中已有的历史评审依赖，没有在项目中新增依赖或访问外部服务。

## 4. 交付及证据

- `docs/DATABASE_DESIGN_SPEC.md`、`docs/BACKEND_ARCHITECTURE_SPEC.md`、`docs/API_CONTRACT_SPEC.md`、`docs/FRONTEND_ARCHITECTURE_SPEC.md`：修复后的正文；对应`be_parts`、`contract_parts`、`fe_parts`及`gen_part9_10.py`同步。
- `scripts/validate_database_design.py`：保留原检查，增加关键接口语义校验。
- `scripts/test_validate_database_design.py`：原错误及变异反例测试。
- `docs/reviews/database-design-remediation.test.cjs`：提取当前片段的回归测试，可选strict类型检查。
- `docs/reviews/database-design-remediation.evidence.json`：15项结果、源文件SHA-256、执行边界。
- `docs/reviews/database-design-remediation.cross-regression.evidence.json`：既有跨设计回归96项新运行结果。
- `docs/reviews/database-design-remediation.backend-regression.evidence.json`：既有后端专项4项新运行结果。

两份历史回归脚本的结果保留其原有评审日期字段；新增`remediationRunDate=2026-11-12`明确本次重跑日期，未覆盖原历史证据。

## 5. 未关闭的上线/签署门禁

1. 真实MySQL空库DDL、CHECK约束、驱动映射、双连接锁序/并发、审计重放及分区边界。
2. 实际Repository→快照→令牌桶、更新/删除后的自动失效通知，以及GET配置/个人大盘/CSRF的HTTP与浏览器联调。
3. DB-R1-02角色优先继承语义的接口维护者与产品签署，按新增TC-DB-43～46验收。
4. 原数据库差异清单其他项目（例如DB-D02计数器更新示例、DB-D15锁点）、迁移/恢复/容量/保留期等，不因本次四项修复而视为关闭。

**结论：本轮4项问题均完成核验和对应文档/片段修复；自动化回归通过。实现基线签署和真实数据库/上线验收仍是独立门禁。**
