# 全栈分工与前后端物理隔离协作规范实施计划

状态：in_progress
需求来源：R01, R11, R13, R15, R16, R17
关联特性：G02 (规范与 Git 交付基线), G03 (双 Agent 协作门禁)
授权范围：编写 docs/FULLSTACK_DIVISION_SPECIFICATION.md；更新 AGENTS.md、docs/COLLABORATION_WORKFLOW.md、docs/PROJECT_CONSTRAINTS.md、docs/ARCHITECTURE.md、docs/ENGINEERING_TOOLCHAIN.md、docs/FRONTEND_UI_GUIDELINES.md；同步导航索引与治理台账
明确排除：修改已实现后端源码、修改 package-lock 依赖、执行数据库写操作
任务分支：docs/fullstack-division-specification
main 基线提交：be2079577e664e29437bb5a603e03a08b0a1b117

## 目标与现状

### 事实
- 经过 PR #1 ~ #10 的迭代，工程已成功建立完整的双 Agent 机械交接门禁（G03 / TASK-GOV-004）以及 Phase 1 应用脚手架与安全核心原型（TASK-APP-001、TASK-APP-002）。
- 既有规约中，Antigravity 职责严格限于规约文档、规划与 Git 交付，而应用代码（`mysql-mcp/`）全量归属于 PI-Desktop。
- 本项目包含本地可视化管理与审批界面（F01~F05 连接管理，F19 本地 Web 人工审批，F27 界面可访问性与反馈），需要进行高质量的用户界面设计、样式排版、可访问性支持与交互联调。
- Antigravity 拥有出色的 UI 设计、生成式前端开发与无障碍调试能力；PI-Desktop 具备本地宿主环境的原生模块编译、系统凭据与服务端执行能力。

### 提案
1. **建立全栈分工与前后端物理隔离协作规范（`docs/FULLSTACK_DIVISION_SPECIFICATION.md`）**：
   - 确立**前端界面由 Antigravity 专职负责、PI-Desktop 专职负责后端**的强制性约束；
   - 规定物理目录划分：前端资产全量收敛于 `mysql-mcp/web/`，后端系统收敛于 `mysql-mcp/src/`，测试收敛于 `mysql-mcp/tests/`；
   - 确立双向绝对禁止红线（Antigravity 严禁修改后端业务逻辑与底层驱动；PI-Desktop 严禁修改前端页面、组件与样式，严禁执行 Git 提交/推送/PR）；
   - 确立“接口先行（Interface-First）”铁律，前后端必须以 `docs/API_AND_PROTOCOLS.md` 锁定的 REST 接口与 JSON Schema 为唯一协作纽带；
   - 确立任务分流模型：新增 `mode: frontend` 模式，明确前端任务由 Antigravity 自行实现与交付；后端任务保持 `mode: code` / `backend` 由 PI-Desktop 实现。
2. **规则与架构规约联动更新**：
   - 在 `AGENTS.md`、`docs/COLLABORATION_WORKFLOW.md`、`docs/PROJECT_CONSTRAINTS.md`（C08）、`docs/ARCHITECTURE.md`、`docs/ENGINEERING_TOOLCHAIN.md` 及 `docs/FRONTEND_UI_GUIDELINES.md` 中全面强化此强制性分工与边界契约。

## 文件与行为

- `docs/plans/fullstack-division-specification.md`：本任务实施计划台账。
- `governance/features.json`：G02 扩充 G02-A4 验收标准，G02/G03 关联 TASK-GOV-009。
- `governance/tasks.json`：回填 TASK-APP-002 的 PR 10，登记 TASK-GOV-009。
- `governance/checks.json`：映射 G02-A4 至 governance-tests。
- `docs/FULLSTACK_DIVISION_SPECIFICATION.md`：新增全栈分工与前后端物理隔离协作规范。
- `AGENTS.md`：更新 Agent 执行规则中的职责边界与前端负责条款。
- `docs/COLLABORATION_WORKFLOW.md`：更新协作职责矩阵与阶段流转支持。
- `docs/PROJECT_CONSTRAINTS.md`：新增 C08 全栈职责物理隔离与前后端边界强制约束。
- `docs/ARCHITECTURE.md`：更新分层架构职责与责任 Agent 标注。
- `docs/ENGINEERING_TOOLCHAIN.md`：更新工程目录布局，明确 `mysql-mcp/web/` 定位。
- `docs/FRONTEND_UI_GUIDELINES.md`：明确 Antigravity 专职负责前端设计与实现。
- `docs/plans/README.md`：更新计划索引。
- `docs/FEATURE_STATUS.md`：派生状态同步更新。
- `docs/changes/2026-10-06-TASK-GOV-009-fullstack-division-specification.md`：本次任务变更台账。
- `docs/changes/README.md`：更新未发版变更列表。

## 实施步骤

1. 登记 G02-A4 与任务 TASK-GOV-009，同步 tasks.json、features.json 与 checks.json。
2. 启动 Antigravity planning 阶段（`handoff.mjs begin`）。
3. 撰写 `docs/FULLSTACK_DIVISION_SPECIFICATION.md` 并全面更新关联架构与治理文档。
4. 完成 planning 阶段（`handoff.mjs finish`）。
5. 显式核验接受并进入 documentation_delivery 阶段。
6. 撰写变更文档与更新未发版列表。
7. 运行本地全量测试（`run.mjs`）与结构检查（`check.mjs`）。
8. 完成 documentation_delivery 交付候选，执行 Git 提交、推送、创建 PR 并监控 CI。
