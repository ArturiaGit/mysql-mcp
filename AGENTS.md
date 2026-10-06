# Agent 执行规则

## 入口与范围

开始前阅读[需求基线](docs/REQUIREMENTS.md)、[安全约束](docs/PROJECT_CONSTRAINTS.md)、[Git 工作流](docs/GIT_WORKFLOW.md)、[协作交接规范](docs/COLLABORATION_WORKFLOW.md)，并通读[变更管理台账](docs/changes/README.md)下的所有活动未发版变更文档以掌握近期架构演进与避坑警示，再按任务阅读接口、模型和审查规范。事实、用户确认、建议和待验证事项必须区分。

只执行用户已授权的任务。默认 Git 授权不等于可以自行开发新功能、连接数据库或修改客户端配置。

## 职责与人工转交

- **全栈分工与强制性约束**（详见[全栈分工规范](docs/FULLSTACK_DIVISION_SPECIFICATION.md)）：
  - **前端界面由 Antigravity 负责**：涵盖 `mysql-mcp/web/` 下的 HTML、CSS、客户端 TS/JS、UI 组件与界面交互及前端自测；严禁侵入后端系统源码与底层数据库驱动。
  - **PI-Desktop 负责后端**：涵盖 `mysql-mcp/src/` 及相关测试中的 Fastify 服务端路由、MCP Stdio 协议、Windows Keyring 凭据管理、AST 策略引擎与 MySQL 连接执行器；严禁侵入前端界面资产与页面代码。
  - **接口先行**：前后端以[接口契约](docs/API_AND_PROTOCOLS.md)为唯一交互纽带，未经文档锁定的私有协议或隐式耦合严禁开发。
- **Antigravity**：planning、需求/计划/规范/台账/变更文档、授权前端界面（`mysql-mcp/web/`）实现、documentation_delivery、提交信息、暂存、commit、push、创建/更新 PR 和查询 CI；负责日常变更文档汇总维护及发版时 Release Notes 聚合归档；可重跑已有检查，严禁自行修复后端系统源码或构建配置。
- **PI-Desktop**：implementation/rework 中的授权后端代码、测试、依赖与构建配置、实际测试/构建/编译；可以阅读规范与未发版变更文档、在交接报告中提出文档同步请求与技术改动事实，通常不得直接改规范/台账，绝不修改前端页面资产，绝不执行本仓库 commit、push 或 PR 操作。
- **用户**：在两端人工复制交接 prompt；无自动通信。生成 prompt 不等于已转交，接收方须显式核验并接受准确事件 ID 和 SHA256 摘要。
- 阶段流转：纯文档任务（`planning → documentation_delivery`）；后端任务（`planning → implementation (PI) → documentation_delivery (Antigravity)`，代码问题走 `rework`）；前端任务（`planning → implementation (Antigravity) → documentation_delivery (Antigravity)`）。不伪造角色阶段。

## 强制工作流

1. Antigravity 修改前检查工作区、分支、远程、未提交改动及基线。新任务先更新已确认 origin 引用并确认 main 基线，再创建 feat/、fix/、docs/ 或 chore/ 分支。PI 接收后核对任务分支/基线，不另起 Git 交付。禁止直接在 main 修改或提交。
2. 同一任务续作复用原分支和 PR；前一任务未合并时，不把其变更隐式带入新任务。保留用户修改，不擅自 stash、reset 或 clean；无法安全隔离时报告阻塞。
3. Antigravity 先登记标准和任务并完成 planning 交接；PI 验证接受后实现、测试，生成实际结果和文档同步请求。交接 JSON 是受约束机器产物，不是扩大角色权限的入口。
4. Antigravity 接受结果、同步文档/台账，形成完整 documentation_delivery 候选及 Conventional Commits 提交信息。在最终文件确定后执行 `node scripts/governance/run.mjs` 生成匹配当前候选快照的真实证据。检查实际暂存差异和敏感信息，只暂存本任务明确文件；Hook 在指纹匹配时快速直通验签（代码漂移时安全降级全量），必要检查通过后由 Antigravity 自动 commit。
5. 完成约定验收后由 Antigravity 自动 push 当前任务分支并创建/更新以 main 为 base 的 PR，无需逐次征求 commit/push/PR 许可。仅推送已确认 origin，不 force push。Git 交付操作使用 `GOV_ROLE=antigravity`；Hook 分别校验 staged/ref/msg 与完整交接候选，变量不是身份认证。
6. Antigravity 查询现有 PR 避免重复，记录需求、范围、真实检查、未验证项、风险和限制；CI 无配置写“未配置”，不得称全绿。创建前任务 `pr` 可为 `null`，创建后真实 commit/PR/CI 由 delivery event 记录并后续同步任务台账，不猜 PR 号。
7. Antigravity 用 `record-delivery` 核实实际 Git/gh 交付信息后生成回传 prompt；CI 代码问题明确交回 PI rework，成功则等待用户确认合并或下一项授权。不得自动合并、开启自动合并、删除分支、创建 Tag 或发布。

必要检查失败先按职责交回修复重测；验收不能完成则报告，不冒充已完成。快速失败与防死循环：当 `run.mjs` 因底层超时（如 ETIMEDOUT）或环境异常失败时，Agent 不得自行展开耗时超过 2 轮的发散性底层环境压测（如递归扫描宿主磁盘、修改系统 PATH、盲调线程池）；应在核实失败类型后向用户报告阻塞并请求指令。网络或权限失败保留本地提交，不改用未知账号/远程，不绕过检查。

## 安全与证据

密码、令牌、真实连接配置、原始业务 SQL/数据、私人邮箱和本地历史快照不得公开。不要暂存 .pi/ 或 mysql-mcp-memory.md。文档-only 执行文档检查，不运行不存在的 npm 脚本；当前无应用 package，不声称 MySQL 应用编译通过。

所有数据库写入及 DDL 仍须逐次人工确认，原生不可靠时用本地页面；Git 回退不等于 SQL 回滚。交接接受不替代数据库批准。

## 初始化例外与本次 bootstrap

首次仅含 .gitignore 的 main 基线是已用完的初始化例外，不得用于后续直提 main。应用尚未实现；治理脚本、Hook、CI 和远程保护的实际部署证据见 docs/verification/，不能仅凭配置文本声称生效。

用户另批准仅 `TASK-GOV-004`、分支 `chore/antigravity-pi-handoff`、基线 `ed631a2201e6b439bc79ca6d241176db68ddad82` 的一次性 bootstrap：PI 可启动该阶段并修改任务明确限定的规范/台账及技术实现。本次授权绝不允许 PI 执行本仓库 commit/push/PR，不继承到其他任务；具体文件范围以批准计划与任务授权为准，本次文档同步仅覆盖指定规范及新协作入口。

## 需求与验收门禁

开始任务先读 docs/ACCEPTANCE.md、governance/features.json 和 governance/tasks.json，搜索现有实现/测试；PR 查询由 Antigravity 完成。新功能必须唯一登记；修复复用功能 ID 并增加回归标准，不重复开发。新协作对应 G03/R17/TASK-GOV-004，并扩展 G01/G02；历史任务不补造交接或无依据升级状态。

修改范围必须对应活动任务和需求。先写可观察验收标准，再实现及测试；不得删标准、删测试或改门禁来使功能虚假通过。治理自身变更必须显式登记 governance_change 并由用户审查。

执行 `node scripts/governance/check.mjs`、`node scripts/governance/run.mjs`；Antigravity 台账变化时用 `node scripts/governance/report.mjs --write` 更新派生状态，本次仅在 bootstrap 明确授权内例外。提交检查暂存快照，推送检查实际 ref/commit，不以工作区或 AI 口头保证替代。交接命令及 details 字段见协作规范，命令实现与实际部署需另外验证。

每项功能分别报告实现、验证、验收、交付状态。必要测试失败/跳过/零测试、缺证据、输入摘要变化均不能标完成。本地 run 报告及嵌入 TAP 副本是诊断声明，CI 必须独立重跑；最终还需可核查 CI、必要实机/人工证据及合并记录。同账号 Agent、角色变量不能证明真人已转交或独立批准，不能强制抵御同机恶意改写；外部证据不能可靠认证时保持未验收。

禁止 --no-verify、关闭 hooksPath 或降低远程检查绕过验收。治理门禁自身需用户审查，不能声称自证绝对安全。
