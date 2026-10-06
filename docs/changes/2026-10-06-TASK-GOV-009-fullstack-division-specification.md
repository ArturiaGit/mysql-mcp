# [TASK-GOV-009] 全栈分工与前后端物理隔离协作规范

- 变更日期：2026-10-06
- 关联任务：TASK-GOV-009
- 关联 PR：待交付
- 关联 Commit：待提交
- 责任执行方：Antigravity (Planning & Documentation Delivery)
- 关联功能/需求：G02, G03, F27 / R01, R11, R13, R15, R16, R17

---

## 📢 发版说明（Release Notes / 面向用户与下游）

### 变更分类与追溯条目
- **🚀 Added**：
  - 制定核心协作规范 [`docs/FULLSTACK_DIVISION_SPECIFICATION.md`](../FULLSTACK_DIVISION_SPECIFICATION.md)，系统确立前端界面由 Antigravity 专职负责、后端系统由 PI-Desktop 专职负责的强制性约束；
  - 确立前端界面的专属物理隔离目录 `mysql-mcp/web/` 与后端专属目录 `mysql-mcp/src/`，消除前缀歧义并适配治理门禁路径检查；
  - 确立“接口先行（Interface-First）”原则，规定前后端通信必须严格以 [`docs/API_AND_PROTOCOLS.md`](../API_AND_PROTOCOLS.md) 锁定的回环 HTTP RESTful API 与 JSON Schema 为唯一依据；
  - 扩展协作工作流任务分流模型，新增 `mode: "frontend"`（前端独立任务流），支持 Antigravity 专职进行界面开发与交付。
- **🔒 Security**：
  - 在 [`docs/PROJECT_CONSTRAINTS.md`](../PROJECT_CONSTRAINTS.md) 确立安全不变量 **C13**：全栈职责物理隔离与接口先行；
  - 确立双向绝对禁止红线：Antigravity 严禁修改后端业务逻辑、数据库驱动、系统凭据底层或 AST 引擎；PI-Desktop 严禁修改前端界面资产、HTML、CSS、客户端脚本，严禁执行本仓库 Git 交付。
- **🔄 Changed**：
  - 更新根目录 [`AGENTS.md`](../../AGENTS.md) 与 [`docs/COLLABORATION_WORKFLOW.md`](../COLLABORATION_WORKFLOW.md)，注入全栈分工与职责矩阵条目；
  - 更新 [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)，在分层架构拓扑中明确各层责任 Agent（Antigravity 负责 web 层，PI-Desktop 负责 server/mcp/approval/db 层）；
  - 更新 [`docs/ENGINEERING_TOOLCHAIN.md`](../ENGINEERING_TOOLCHAIN.md)，在工程目录结构中加入 `mysql-mcp/web/` 前端资产规范；
  - 更新 [`docs/FRONTEND_UI_GUIDELINES.md`](../FRONTEND_UI_GUIDELINES.md)，明确 Antigravity 为前端界面专属设计与实现方；
  - 在 `governance/features.json` 扩充 G02-A4 验收标准，在 `governance/tasks.json` 回填 TASK-APP-002 的 PR 10 并注册 TASK-GOV-009。

### 发版亮点摘要 (Highlights)
正式确立了全栈分工协作体系与强制性约束：前端界面（`mysql-mcp/web/`）全权由 Antigravity 专职负责，后端系统（`mysql-mcp/src/`）全权由 PI-Desktop 专职负责，双方互为绝对禁区；前后端以文档锁定的标准 API 为唯一交互纽带，打通了兼具高质感 UI 与高防御安全后端的工程演进基础。

---

## 🛠️ Agent 工程上下文与架构演进（面向开发者与后续 Agent）

### 1. 架构与设计决策 (Why & Design)
- **为什么必须强制前后端物理隔离？**：
  在此前的协作模型（TASK-GOV-004）中，Antigravity 被严格限制为只改文档/治理，应用代码一律归属 PI-Desktop。但这在全栈工程中造成了结构性矛盾：PI-Desktop 作为后台环境下的工程智能体，专注于本地 Node 原生模块、系统凭据与编译器执行，难以发挥出色的视觉设计与前端交互体验；而 Antigravity 具备顶尖的 UI 架构、生成式前端与可访问性调试能力。通过确立“Antigravity 前端、PI-Desktop 后端”的强制分工，既彻底解决了权责边界模糊的问题，又最大限度发挥了双端的最佳效能。
- **为什么选择独立平级的 `mysql-mcp/web/` 目录？**：
  治理脚本 `scripts/governance/lib/collaboration.mjs` 中的 `owner()` 函数采用严密的无重叠前缀校验（`overlapping role paths` 失败即抛出异常）。若将前端置于 `mysql-mcp/src/web/`，则与 `mysql-mcp/src/` 产生严重的前缀嵌套冲突。将前端平级定位于 `mysql-mcp/web/`，后端保留在 `mysql-mcp/src/`，实现了路径空间上的天然正交与物理互斥。
- **接口先行的刚性约束**：
  前后端必须完全解耦，严禁跨进程/跨端内部黑盒依赖。任何新功能的开发，首先由 Antigravity 在 `docs/API_AND_PROTOCOLS.md` 锁定 REST 路由、参数、响应结构、CSRF Nonce 与错误码，双方基于冻结的契约独立开发与测试，最后在端到端环节闭环。

### 2. 实际改动文件与逻辑清单 (What)
- **新设规约文档 (`docs/`)**：
  - `docs/FULLSTACK_DIVISION_SPECIFICATION.md`：核心全栈分工规约正文。
- **规约联动升级 (`docs/` & `AGENTS.md`)**：
  - `AGENTS.md`：职责与人工转交增加全栈分工与双向红线。
  - `docs/COLLABORATION_WORKFLOW.md`：职责矩阵更新与前端任务流支持。
  - `docs/PROJECT_CONSTRAINTS.md`：新增 C13 约束。
  - `docs/ARCHITECTURE.md`：分层拓扑架构表增加责任 Agent 标注。
  - `docs/ENGINEERING_TOOLCHAIN.md`：目录布局加入 `mysql-mcp/web/`。
  - `docs/FRONTEND_UI_GUIDELINES.md`：确认 Antigravity 责任所有权。
  - `docs/README.md` & `docs/plans/README.md`：全景索引与实施计划同步。
- **任务与治理台账 (`governance/`)**：
  - `governance/tasks.json`：回填 TASK-APP-002 的 `pr: 10`，注册 TASK-GOV-009。
  - `governance/features.json`：G02 扩充 G02-A4，G02/G03 关联 TASK-GOV-009。
  - `governance/checks.json`：`governance-tests` 关联 G02-A4。
  - `docs/FEATURE_STATUS.md`：派生状态同步更新。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **避坑警示 1（Antigravity 绝对禁碰后端代码）**：
  Antigravity 绝不允许修改 `mysql-mcp/src/`、`mysql-mcp/scripts/` 或后端测试代码。任何需要调整后端接口返回或数据库执行逻辑的需求，必须通过 Handoff 移交 PI-Desktop 实现！
- **避坑警示 2（PI-Desktop 绝对禁碰前端页面）**：
  PI-Desktop 绝不允许修改 `mysql-mcp/web/` 下的 HTML、CSS 或客户端脚本。PI-Desktop 提供的 Fastify 服务仅负责标准 JSON API 与静态资源托管，不得擅自在服务端生成页面或直接编写前端 UI！
- **避坑警示 3（严禁未定接口先行开发）**：
  开发任何包含前后端联动的功能前，接口必须且只能在 `docs/API_AND_PROTOCOLS.md` 明确定义并经用户审查锁定。未定义契约的代码在代码审查时将被直接拒绝！
- **避坑警示 4（Git 交付仍然是 Antigravity 独家职责）**：
  前端分工赋予了 Antigravity 编写界面的权利，但 Git 交付（`GOV_ROLE=antigravity`）仍旧由 Antigravity 统一执行。PI-Desktop 无论何时都不得在本地执行 `git commit` 或 `git push`！
