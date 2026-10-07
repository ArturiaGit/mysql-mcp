# 规划与任务台账

> 状态：MySQL 应用实施尚未启动。当前批准的协作治理任务为 TASK-GOV-004，G03/R17，并扩展 G01/G02；历史任务记录保留，不由本索引无依据升级完成。自动检查由 scripts/governance 提供，计划新建/归档脚本仍不存在。

## 1. 两类记录的边界

`docs/plans/` 用于项目实施计划及其验证记录；宿主 `.pi/plan/` 是会话审批快照，保留原样，不当成运行代码，也不把存在快照视为批准其全部内容。

先前软件计划仍是历史提案，不登记为正在开发。当前分工为 Antigravity 规划/文档/台账/Git 交付，PI 代码/测试/构建，双方 prompt 由用户手动转交并由接收方显式接受。Git 常规交付由 Antigravity 执行，不逐次询问；PI 不执行本仓库 commit/push/PR。规则见[协作规范](../COLLABORATION_WORKFLOW.md)与[Git 工作流](../GIT_WORKFLOW.md)。

## 2. 软件计划台账

| 计划 | 状态 | 执行授权 | 证据 |
|---|---|---|---|
| 本地连接管理、多客户端接入及写审批 | 提案，未开始 | 待软件实施明确批准 | 需求与路线图，仅设计材料 |

当前无已完成的软件计划或历史软件归档。文档交付结果由本次会话报告；不虚构实现 PR、版本、百分比或提交 ID。

## 3. 生命周期

1. **draft**：写目标、需求来源、范围、文件、行为、风险和验收，不执行隐含变更。
2. **approved**：记录用户批准的准确范围与不包含事项。
3. **in_progress**：只推进已授权任务，保留未完成项。
4. **blocked**：列具体阻塞、影响及可继续工作，不把猜测风险当阻塞。
5. **waiting_for_merge**：约定交付检查满足，Antigravity 已真实提交、push、创建/更新 PR；记录实际检查、未验证项和交付事件，生成下一步 prompt，等待用户确认合并，不等于功能全部验收。
6. **completed**：用户确认合并、核实结果，且所有功能必要实现/验证/人工或实机验收证据可核查；合并本身不能补足证据，不意味着已发布。
7. **archived**：完成后保留证据和时间，移入未来 `archive/` 并更新索引，不丢失历史。

范围取消可标 cancelled，不能算完成。复用已归档计划需新建增量计划，不修改过去的批准事实。

## 4. 计划模板（内嵌示例，非正在执行任务）

```markdown
# 计划标题

状态：draft
需求来源：R 编号及相关规范
授权范围：待确认
明确排除：数据库写入/账号修改/客户端配置等按实际填写
任务分支：
main 基线提交：

## 目标与现状
分别列事实、提案、待验证项。

## 文件与行为
列具体路径、可观察行为及兼容影响。

## 实施步骤
- [ ] 最小实现步骤
- [ ] 相关测试与文档同步

## 验收
命令或人工步骤、环境、预期结果及证据位置。

## 实际记录
实际执行、结果、失败、未执行及原因。
提交哈希、PR URL、head/base、CI 状态、是否等待合并。

## 归档
完成条件、日期、真实提交/版本（没有则明确没有）。
```

## 5. 维护规则

计划文件聚合在本目录；机器任务及功能真相源为 governance/tasks.json 与 governance/features.json，通常由 Antigravity 在 planning/documentation_delivery 维护。node scripts/governance/check.mjs 校验范围/重复/覆盖；node scripts/governance/run.mjs 执行登记测试。PI 报告实际实现/测试及文档同步请求，不直接改规范/台账（仅本次限定 bootstrap 例外）。归档仍人工操作，不执行不存在的自动归档脚本。

涉及真实 MySQL 的步骤必须注明隔离库、账号权限及逐次确认；即使整体开发计划获批也不省略。进度总览见[路线图](../ROADMAP.md)，需求变化先更新[需求基线](../REQUIREMENTS.md)。

## 6. 首次 Git 治理任务

授权范围：创建公开 ArturiaGit/mysql-mcp、仅含 .gitignore 的 main 基线、docs/agent-git-workflow 任务分支及首个 PR；不自动合并。基线提交：bf703ad。

本任务最终提交哈希、PR URL、检查及等待合并状态见首个 PR 与交付报告；不把尚未取得的远程结果预填为已完成。宿主审批快照与原始记忆不上传。

## 7. 历史治理补强任务

TASK-GOV-001 复用 docs/agent-git-workflow 与 PR #1，基线 bf703ad。用户批准新增追踪、证据执行器、Hook、CI 与 main 保护，不授权 MySQL 功能。对应 G01/G02，范围由机器任务 allowed_paths 明确限制。

完成状态只能从实现与证据推导，不能通过本台账写 completed 或勾选代替。测试/保护核实结果见[验证索引](../verification/README.md)；人工验收和合并待用户确认。后续修复必须引用已有功能 ID 和新增回归标准。

## 8. 当前协作治理任务

- [Antigravity × PI-Desktop 协作计划](./antigravity-pi-collaboration.md)：TASK-GOV-004，功能 G03，需求 R17，并扩展 G01/G02；已获本次流程建立授权，具体可观察标准以该计划和机器登记为准。
- 任务分支 `chore/antigravity-pi-handoff`，main 基线 `ed631a2201e6b439bc79ca6d241176db68ddad82`。一次性 bootstrap 允许 PI 启动并改明确限定规范/台账及治理技术实现，绝不允许 PI 本仓库 commit/push/PR，不复用于后续任务。
- 阶段 planning → implementation → documentation_delivery；代码问题进入 rework 再回 documentation_delivery；文档-only planning → documentation_delivery。计划生命周期不是交接事件状态，也不证明用户已转交。
- PR 创建前任务 pr 可为 null；真实创建后记录 delivery event，再后续同步任务台账，禁止猜 PR 号。实际[验证记录](../verification/antigravity-pi-collaboration.md)、独立 CI、用户审查及真实交付分别记录，本地诊断不等于验收。

上述历史记录中的等待/失败/未完成保留其当时语境，本次不补造历史交接、不无依据改完成。

## 9. 变更管理规约任务

- [变更管理规范与 Agent 历史感知实施计划](./change-management.md)：TASK-GOV-005，功能 G02，需求 R18。用户批准建立 `docs/changes/` 专属变更库，确立 Agent 开启新任务前的强制通读规则，规范双重视角模板（发版说明与 Agent 工程上下文），并回溯补齐 PR #1 ~ #4 历史变更。
- 任务分支 `docs/change-management-specification`，main 基线 `b80bab2f773cd4ce8bca1ae56f6385c4b76fc1e8`。模式为 `mode: "docs"`（文档-only），由 Antigravity 按 `planning → documentation_delivery` 推进，不伪造代码开发。

## 10. 主干任务选择鲁棒性修复任务

- [修复主干多任务识别歧义与元数据回填鲁棒性实施计划](./fix-main-task-selection.md)：TASK-GOV-006，功能 G01，需求 R16。修复 PR #5 合并后主干 CI 报多任务歧义的问题，限定在候选任务集内判定变动任务，允许历史任务安全回填 PR 元数据并增加白名单防御。已合并交付（PR #6）。

## 11. 工程化工具链、SQL策略与测试规范增强任务

- [工程化工具链、SQL策略与测试规范增强实施计划](./engineering-and-safety-specifications.md)：TASK-GOV-007，功能 G02，需求 R06、R07、R12、R13、R14、R16。用户批准方案 A，补齐从治理通向业务代码落地的四大规范盲区：新增应用工程与构建契约、SQL 语法风险分级矩阵、自动化测试分层与沙箱隔离规范，补充多环境凭据抽象与错误脱敏规范。已合并交付（PR #7）。
- 任务分支 `docs/engineering-and-safety-specifications`，main 基线 `fa911793060028b96597805ce6a1ccddcf82aeef`。模式为 `mode: "docs"`（文档-only）。

## 12. Phase 1 应用工程脚手架与构建检查契约任务

- [Phase 1 应用工程脚手架与构建检查契约实施计划](./app-scaffold-and-toolchain.md)：TASK-APP-001，功能 F28，需求 R12、R13。用户批准初始化生产工程 `mysql-mcp/`，配置原生 ESM、TypeScript 严格编译配置、编写纯 Node 构建与编译脚本，建立 `task.build_checks` 契约及应用冒烟测试。
- 任务分支 `feat/app-scaffold-and-toolchain`，main 基线 `edf957aa653b8037fd3db5a81d37eb51610c7d12`。模式为 `mode: "code"`。

## 13. 机械验证性能优化与 Hook 快速验签直通任务

- [机械验证性能优化与 Hook 快速验签实施计划](./governance-verification-performance.md)：TASK-GOV-008，功能 G01、G03，需求 R15、R16、R17。针对交付流程耗时过长（超 2 小时）问题，优化 `check.mjs` 引入候选证据指纹直通，消除 Git Hook 中全量测试的重复冷启动；调整超时至 600s 消除 Windows 误报死循环；优化 `governance.test.mjs` 夹具缓存减少子进程派生。已合并交付（PR #9）。
- 任务分支 `chore/governance-verification-performance`，main 基线 `967db371d78365f9643d96dabbf93ee471371e54`。模式为 `mode: "code"`。

## 14. Phase 1-B 关键依赖可行性与核心安全原型任务

- [Phase 1-B 关键依赖可行性与核心安全原型实施计划](./feasibility-and-sql-policy.md)：TASK-APP-002，功能 F06、F26，需求 R03、R06、R07、R08、R12、R14、R16。开展 Phase 1-B 依赖可行性与核心安全原型验证，封装 Windows 系统凭据存储模块，实现基于 AST 的 SQL 风险分级与单语句策略引擎，验证 MCP Stdio 协议骨架，关闭 Q05/Q07，不连接外部生产数据库，不提权。已合并交付（PR #10）。
- 任务分支 `feat/feasibility-and-sql-policy`，main 基线 `f2dfffcc45e03871efd33b9b62711d6f7b0cd0ca`。模式为 `mode: "code"`。

## 15. 全栈分工与前后端物理隔离协作规范任务

- [全栈分工与前后端物理隔离协作规范实施计划](./fullstack-division-specification.md)：TASK-GOV-009，功能 G02、G03，需求 R01、R11、R13、R15、R16、R17。用户授权建立全栈分工规范，确立前端界面由 Antigravity 专职负责（`mysql-mcp/web/`）、PI-Desktop 专职负责后端系统（`mysql-mcp/src/` 等）的强制性约束，确立双向禁止红线、接口先行原则与任务模式扩展。
- 任务分支 `docs/fullstack-division-specification`，main 基线 `be2079577e664e29437bb5a603e03a08b0a1b117`。模式为 `mode: "docs"`（文档-only）。

## 16. Phase 2-A 回环服务与连接管理后端实现任务

- [Phase 2-A 回环服务与连接管理后端实现计划](./server-connection-and-auth.md)：TASK-APP-003，功能 F25、F01、F02、F03、F04、F05，需求 R01、R02、R03、R14、R15、R16、R17。开展 Phase 2-A 回环服务与连接管理后端实现，落地 Fastify 回环 HTTP 服务、会话认证、CSRF 防护、连接元数据存储、Windows Keyring 关联以及连接测试模拟服务，编写后端自动化测试；遵循全栈分工规范，不编写前端界面资产，不连接外部生产数据库。
- 任务分支 `feat/server-connection-and-auth`，main 基线 `bdbef3f6247e581eb793270c3768c530cf7728b6`。模式为 `mode: "code"`。

## 17. 全栈分工机械门禁落地任务

- [全栈分工机械门禁落地实施计划](./enforce-fullstack-division-gates.md)：TASK-GOV-010，功能 G02、G03，需求 R13、R15、R16、R17。按照全栈分工规范第 7 节演进 collaboration.json 路径所有权拆分，在 collaboration.mjs 与相关治理测试中支持 mode: "frontend" 协作流程（planning → implementation (Antigravity) → documentation_delivery (Antigravity)），确保 mysql-mcp/web/ 与 mysql-mcp/src/ 物理路径互斥与角色权限强校验，不破坏既有 code 与 docs 模式。
- 任务分支 `chore/enforce-fullstack-division-gates`，main 基线 `ed7cb8075671b382dce009edf1e99bbccfdb48e2`。模式为 `mode: "code"`。

## 18. Phase 2-B 前端管理控制台与连接管理交互实施任务

- [Phase 2-B 前端管理控制台与连接管理交互实施计划](./web-connection-management.md)：TASK-APP-004，功能 F01、F02、F03、F04、F05、F25、F27，需求 R01、R02、R14、R15、R16、R17。在 mode: "frontend" 模式下由 Antigravity 专职落地 `mysql-mcp/web/` 与 `mysql-mcp/tests/web/`，实现本地登录页、会话/CSRF 驱动、连接列表与表单 CRUD、测试连接状态与无障碍交互，遵循全栈分工规范，不修改后端源码，不连接外部生产数据库。
- 任务分支 `feat/web-connection-management`，main 基线 `b6af7e90c5cb89ec1c26e04c675380775b9a0a6f`。模式为 `mode: "frontend"`。

## 19. Phase 3 受限读取及 MCP 协议骨架实现任务

- [Phase 3 受限读取及 MCP 协议骨架实现计划](./mcp-read-and-tools.md)：TASK-APP-005，功能 F07、F08、F09、F10、F11，需求 R04、R05、R06、R07、R08、R14、R16、R17。在 mode: "code" 模式下由 PI-Desktop 落地 5 个受限读取/元数据 MCP 工具（list_connections, list_databases, list_tables, describe_table, query）、动态目标隔离、AST 策略驱动的只读校验、行数/列数/大字段硬阈值截断、错误脱敏模型及后端自动化测试；遵循全栈分工规范，不编写前端界面，不连接外部生产数据库。
- 任务分支 `feat/mcp-read-and-tools`，main 基线 `e94b44660a7c5a720e74c02cc419111db244b066`。模式为 `mode: "code"`。

