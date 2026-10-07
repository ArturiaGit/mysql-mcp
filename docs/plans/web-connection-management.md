# Phase 2-B 前端管理控制台与连接管理交互实施计划

> 状态：in_progress  
> 任务编号：TASK-APP-004  
> 关联功能：F01 (新增连接), F02 (编辑连接), F03 (删除连接), F04 (多连接列表), F05 (测试连接), F25 (回环认证/CSRF/脱敏), F27 (界面反馈与可访问性)  
> 需求来源：R01, R02, R14, R15, R16, R17  
> 任务分支：`feat/web-connection-management`  
> main 基线：`b6af7e90c5cb89ec1c26e04c675380775b9a0a6f`  
> 执行模式：`mode: "frontend"`（Antigravity 专职负责前端界面实施与全流程交付）  

---

## 1. 目标与背景

根据 [阶段实施路线图](../ROADMAP.md) 与 [全栈分工与前后端物理隔离协作规范](../FULLSTACK_DIVISION_SPECIFICATION.md)：
- **Phase 2-A（TASK-APP-003，PR #12）** 已由 PI-Desktop 完成 Fastify 本地回环服务端开发，包括 127.0.0.1 强绑定监听、本地高熵登录码与 CSRF 会话防护机制、连接元数据原子存储与 Windows Keyring 凭据管理联动、连接测试模拟服务以及乐观锁冲突处理，后端自动化测试达到 190 项全绿；
- **Phase 2-B（TASK-APP-004）** 正式开启前端界面落地，在刚刚由 TASK-GOV-010（PR #13）落地的机械门禁保障下，采用 `mode: "frontend"` 协作模式，由 **Antigravity 专职负责** 在 `mysql-mcp/web/` 下设计并实现本地管理控制台前端界面，并在 `mysql-mcp/tests/web/` 落地前端自动化测试套件；
- **核心功能目标**：
  1. **本地认证与会话防护（F25）**：实现本地一次性高熵码登录界面，向 `/api/v1/session` 换取 HttpOnly Cookie 与 CSRF Token，自动拦截会话失效与跨站非法请求；
  2. **多连接列表与空态（F04）**：展示脱敏后的连接稳定 ID、名称、主机、端口、用户名、默认数据库与乐观版本号，明确支持同名连接区分与空列表状态；
  3. **新增连接交互（F01）**：提供语义化表单，严格客户端字段校验（端口 1..65535、主机名、非空检查），密码安全输入且绝不回传客户端；
  4. **编辑连接与密码保持语义（F02）**：展示脱敏信息，明确“留空保持原密码”交互，提交时自动剔除空密码字段，携带 `expected_version` 乐观锁版本号，遇 409 冲突友好提示；
  5. **删除连接安全弹窗（F03）**：显著警示“仅删除本地连接资料及凭据，不删除数据库”，校验版本号；
  6. **连接测试双重模式（F05）**：清晰区分“测试未保存草稿”与“测试已保存连接”，加载指示明确，失败信息脱敏展示；
  7. **无障碍与界面反馈（F27）**：符合 WCAG 2.1 AA 规范的语义化 HTML、明晰焦点轮廓、键盘全操作（Esc 退出模态框、Tab 焦点陷阱、关闭后焦点复位）、高对比度中性工具设计与响应式视口适配。

---

## 2. 授权范围与绝对禁止事项

### 2.1 授权范围
- **任务允许路径**：`mysql-mcp/web/`、`mysql-mcp/tests/web/`、`docs/`、`governance/`；
- **前端资产实现路径（Antigravity 专职）**：
  - `mysql-mcp/web/index.html`：本地管理控制台单页应用（SPA）入口，集成登录与连接管理工作区；
  - `mysql-mcp/web/css/style.css`：设计系统 tokens、深色/中性配色、焦点可见轮廓、响应式布局；
  - `mysql-mcp/web/js/api.js`：原生 REST API 客户端，封装 Session、CSRF、统一错误脱敏映射与超时机制；
  - `mysql-mcp/web/js/app.js`：前端应用主状态机、视图切换、表单校验、模态框控制器与无障碍键盘陷阱；
  - `mysql-mcp/tests/web/`：前端模块自动化测试套件（DOM 结构、状态机流转、CSRF 附加逻辑、A11y 关键属性）；
- **文档与治理同步路径（Antigravity 专职）**：
  - `docs/plans/web-connection-management.md`、`docs/plans/README.md`
  - `docs/changes/2026-10-07-TASK-APP-004-web-connection-management.md`
  - `docs/FEATURE_STATUS.md`
  - `docs/verification/web-connection-management.md`

### 2.2 绝对禁止事项（双向红线）
1. **严禁修改后端源码与构建脚本**：Antigravity 绝对禁止触碰 `mysql-mcp/src/`、`mysql-mcp/scripts/` 及后端的 `mysql-mcp/tests/` 单测；
2. **严禁接触底层秘密与直连数据库**：前端代码运行于浏览器静态沙箱，绝对禁止尝试调用 `@napi-rs/keyring` 或引入 Node.js 数据库驱动；
3. **严禁泄露密码与虚假回显**：已保存密码绝对不展示任何虚假掩码，编辑时“留空保持原密码”；密码字段在内存中用完即清，严禁持久化到 `localStorage` 或 `sessionStorage`；
4. **严禁绕过接口先行原则**：前端所有网络交互必须且只能通过 [`docs/API_AND_PROTOCOLS.md`](../API_AND_PROTOCOLS.md) 锁定的回环 REST 接口完成。

---

## 3. 技术契约与交互设计

### 3.1 接口映射（遵照 docs/API_AND_PROTOCOLS.md）
- `POST /api/v1/session`：`{ "local_code": string }` -> 换取 Cookie + CSRF Token；
- `DELETE /api/v1/session` -> 注销并清空本地 CSRF 状态；
- `GET /api/v1/connections` -> 获取已脱敏连接列表 `ConnectionView[]`；
- `POST /api/v1/connections` -> 新增连接 `{ name, host, port, username, password, default_database? }`；
- `PATCH /api/v1/connections/:id` -> 编辑连接 `{ expected_version, name?, host?, port?, username?, password?, default_database? }`；
- `DELETE /api/v1/connections/:id` -> 删除连接 `{ expected_version }`；
- `POST /api/v1/connections/test` -> 测试未保存草稿；
- `POST /api/v1/connections/:id/test` -> 测试已保存连接 `{ expected_version }`。

### 3.2 UI 状态与无障碍设计（遵照 docs/FRONTEND_UI_GUIDELINES.md）
- **会话状态**：
  - 未登录态：居中展示本地高熵码登录卡片，清晰提示“请在终端控制台查看 5 分钟有效的一次性代码”；
  - 登录成功：平滑过渡至多连接管理控制台；
  - 会话失效（401）：静默或提示拦截，重置到登录视图并清空内存 CSRF 令牌；
- **安全反馈**：
  - 错误展示统一为 `[错误码] 错误说明`，过滤所有内部底层调用栈；
  - 删除操作弹窗采用红色危险色语义标记，显式说明“仅删除本地连接元数据及凭据，不会对远程/本地数据库造成任何改动”；
- **无障碍（A11y）标准**：
  - 模态框打开时自动聚焦首个表单项，聚焦受限于模态框内部（Tab 陷阱）；
  - 按下 `Escape` 键立即安全关闭模态框，焦点无缝归位至原触发按钮；
  - 所有输入控件配备显式关联的 `<label for="...">`，图标按钮配备 `aria-label`；
  - 支持键盘回车提交与空格触发操作。

---

## 4. 实施步骤

1. **Planning 闭环**：
   - 登记台账与实施计划；
   - 执行 `handoff.mjs begin` 与 `finish` 固化 planning 阶段；
   - Antigravity 显式执行 `accept` 进入 `implementation` 阶段。
2. **前端资产开发（`mysql-mcp/web/`）**：
   - 实现 `index.html`：包含登录卡片、主控制台、连接表格、新增/编辑模态框、删除确认模态框、测试结果浮层；
   - 实现 `css/style.css`：轻量高质感本地工具风格，高对比度色彩 tokens、聚焦高亮环、响应式媒体查询；
   - 实现 `js/api.js`：无依赖纯 JS REST 客户端，自动挂载 `x-csrf-token` 头与凭据 Cookie 策略；
   - 实现 `js/app.js`：应用主控制器，状态响应式更新，A11y 键盘事件绑定。
3. **前端自动化测试开发（`mysql-mcp/tests/web/`）**：
   - 编写 `mysql-mcp/tests/web/frontend.test.mjs`：离线自动化验证前端静态结构符合 A11y 规范、API 客户端请求与 CSRF 头拼装、状态流转与密码留空策略。
4. **构建与门禁执行**：
   - 执行 `node scripts/governance/handoff.mjs builds --task TASK-APP-004 --role antigravity` 验证整体工程构建；
   - 运行独立全量隔离快照验证 `node scripts/governance/run.mjs`。
5. **文档同步与 Documentation Delivery**：
   - 更新实施计划实际记录、变更台账、验证报告与 PR 交付。

---

## 5. 验收标准

- **F01-A1**：保存、校验错误和多个连接不覆盖，真实页面验收；
- **F02-A1**：版本冲突、密码保持与替换失败补偿；
- **F03-A1**：取消、执行中拒绝、凭据清理及不影响数据库；
- **F04-A1**：空态、同名连接区分、列表无密码/凭据引用；
- **F05-A1**：实际 MySQL 成功/失败及超时，草稿不保存；
- **F25-A1**：监听、Host/Origin/CSRF、会话越权、错误日志脱敏负面测试；
- **F27-A1**：视口/缩放/键盘与完整审批内容的实际浏览器证据。
