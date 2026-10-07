# [TASK-APP-004] Phase 2-B 前端管理控制台与连接管理交互实现

- 变更日期：2026-10-07
- 关联任务：TASK-APP-004
- 关联 PR：[#14](https://github.com/ArturiaGit/mysql-mcp/pull/14)（待提交创建）
- 关联 Commit：待提交
- 责任执行方：Antigravity (Planning, Frontend Implementation & Documentation Delivery)
- 关联功能/需求：F01, F02, F03, F04, F05, F25, F27 / R01, R02, R14, R15, R16, R17

---

## 📢 发版说明（Release Notes / 面向用户与下游）

### 变更分类与追溯条目
- **🚀 Added**：
  - 在 `mysql-mcp/web/` 正式落地本地安全管控单页应用（SPA）界面：
    - `index.html`：语义化 HTML5 结构，具备本地一次性高熵码登录卡片、主控制台、连接表格、新增/编辑/删除/测试连接模态框；
    - `css/style.css`：轻量高质感本地工具设计系统 tokens，高对比度 `:focus-visible` 焦点轮廓，动效减弱与移动端/窄屏媒体查询适配；
    - `js/api.js`：原生 REST API 客户端，封装 Session 兑换、内存 CSRF 令牌管理与自动头挂载、结构化错误脱敏映射及 401 自动拦截回调；
    - `js/app.js`：前端应用主控制器，响应式视图切换、连接列表渲染、表单字段边界校验、密码留空保持逻辑、删除警示弹窗与双模连接测试交互；
  - 在 `mysql-mcp/tests/web/frontend.test.mjs` 落地 4 项前端自动化测试套件：
    - `index.html` 语义与无障碍规范校验（DOCTYPE、lang、label 映射、dialog role、密码无预置明文、无内联事件）；
    - `css/style.css` 设计系统与无障碍规范校验（focus-visible、Tokens、prefers-reduced-motion、媒体查询）；
    - `ApiClient` 核心安全与契约逻辑测试（登录/注销、CSRF 附加、密码留空忽略、401 会话失效回调、参数边界）；
    - 表单字段边界与规则校验测试（端口 1..65535、连接名 1..64、主机名 1..255、用户名 1..128 字符）。
- **🔒 Security**：
  - **凭据零泄露与即用即弃**：密码与本地高熵码在前端仅存在于当前表单输入中，绝不保存至 `localStorage`、`sessionStorage` 或全局变量，模态框关闭或提交后立即清空内存；
  - **密码保持语义**：编辑连接时，密码输入框显式提示“留空保持原密码”，若用户未输入新密码，前端发起的 PATCH 请求体中彻底移除 `password` 字段，杜绝误置空或传回假掩码；
  - **CSRF 强绑定**：CSRF Token 仅保留于 `ApiClient` 内存实例，所有变动请求（POST/PATCH/DELETE）自动挂载 `x-csrf-token`，注销或会话失效后立即置空；
  - **删除警示铁律**：删除模态框显式标明“删除本地连接资料及凭据，不删除数据库”，明确仅清理本机配置与凭据，绝不影响远端/本地数据库本身；
  - **DOM 注入安全**：所有动态列表渲染采用 `textContent` 与 `createElement` 原生安全 API，彻底消除任何 XSS 攻击面。
- **♿ Accessibility (WCAG 2.1 AA)**：
  - 所有模态框配备 `role="dialog"`、`aria-modal="true"` 与 `aria-labelledby`；
  - 实现无障碍焦点陷阱：打开模态框自动聚焦首个输入项，按 `Tab` / `Shift+Tab` 焦点受限于模态框内循环；
  - 按下 `Escape` 键立即安全关闭模态框，并自动恢复焦点至原触发按钮；
  - 所有输入框显式通过 `for` 属性关联 `<label>`，图标与操作按钮提供 `aria-label`。

### 发版亮点摘要 (Highlights)
Phase 2-B 标志着 MySQL MCP 正式拥有了现代化、安全且完全无障碍的本地可视化管理界面！在 `mode: "frontend"` 机械隔离保障下，由 Antigravity 专职研发并交付：不仅打通了单次高熵码到会话 Cookie/CSRF 的全链路，而且提供了优雅的多连接 CRUD、留空保持密码、安全删除及连接测试模拟功能。前端测试套件全绿通过，应用与治理全量测试累计达到 392 项无一失败。

---

## 🛠️ Agent 工程上下文与架构演进（面向开发者与后续 Agent）

### 1. 架构与设计决策 (Why & Design)
- **纯原生无外生重型框架**：本项目定位为轻量级本地安全 MCP 工具，避免引入复杂的 Webpack/Vite 或 React/Vue 依赖树，直接使用纯标准 ESM（HTML5 + CSS3 + 原生 JS）。不仅保证零依赖构建与极致启动速度，还消除了前端依赖带来的安全漏洞与供应链风险。
- **物理路径隔离与 Frontend Mode 自主闭环**：依据 TASK-GOV-010 落地的全栈分工门禁，本任务严格收敛于 `mysql-mcp/web/` 与 `mysql-mcp/tests/web/`。Antigravity 在不触碰任何后端代码的情况下，实现了完整的 `planning → implementation → documentation_delivery` 流转，证明了全栈分工规范的有效性。
- **接口契约先行驱动**：前端与后端交互完全基于 `docs/API_AND_PROTOCOLS.md` 锁定的 Fastify 回环 API，包括标准状态码、结构化脱敏错误模型、乐观锁版本号控制（`expected_version`）及 409 STATE_CONFLICT 冲突处理。

### 2. 实际改动文件与逻辑清单 (What)
- `mysql-mcp/web/index.html`：本地管理控制台主入口单页应用；
- `mysql-mcp/web/css/style.css`：设计系统 tokens、深色中性配色、焦点可见轮廓与响应式布局；
- `mysql-mcp/web/js/api.js`：原生 REST API 客户端与 CSRF/会话管理器；
- `mysql-mcp/web/js/app.js`：应用主控制器、DOM 安全渲染、A11y 模态框与键盘事件处理；
- `mysql-mcp/tests/web/frontend.test.mjs`：前端结构、A11y、契约与字段边界自动化测试；
- `docs/changes/2026-10-07-TASK-APP-004-web-connection-management.md`：本变更台账；
- `docs/changes/README.md`：索引本变更；
- `docs/verification/web-connection-management.md`：本任务全量验证与证据记录；
- `docs/verification/README.md`：索引本任务验证报告。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **密码留空更新语义**：在后续扩展连接管理或测试连接时，切记编辑态如果未输入新密码，PATCH 请求必须彻底移除 `password` 字段，服务端会根据字段是否存在决定是否保留 Keyring 中旧凭据。
- **密码绝不持久化**：切勿在前端任何逻辑中将密码存入 `localStorage`、`sessionStorage`、Cookie 或全局长期变量。
- **contractHash 计划与基线冻结**：在 `documentation_delivery` 阶段，严禁修改 planning 已冻结的 `docs/plans/web-connection-management.md`、`governance/features.json` 等文件，否则会破坏 contractHash 引发 `plan/code drift` 交付拦截。

### 4. 验证证据 (Verification)
- `node --test mysql-mcp/tests/web/frontend.test.mjs`：4 项前端自动化测试全部 pass；
- `node scripts/governance/handoff.mjs builds --task TASK-APP-004 --role antigravity`：app-build 190 项与 app-compile 全部 exit 0；
- `node scripts/governance/run.mjs`：通过治理测试 89/89，协作测试 113/113，应用测试 190/190，合计 392 项无失败/跳过/取消。
