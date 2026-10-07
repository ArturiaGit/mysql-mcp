# Phase 2-B 前端管理控制台与连接管理交互执行证据索引

任务 TASK-APP-004；功能 F01, F02, F03, F04, F05, F25, F27；分支 `feat/web-connection-management`；基线 `b6af7e90c5cb89ec1c26e04c675380775b9a0a6f`。实施范围见[计划](../plans/web-connection-management.md)，前端规范见[UI 规范](../FRONTEND_UI_GUIDELINES.md)，接口见[协议](../API_AND_PROTOCOLS.md)，分工见[全栈分工规范](../FULLSTACK_DIVISION_SPECIFICATION.md)。

## 1. 执行记录与可复核来源

完整检查以 `governance/handoffs/TASK-APP-004.json` 历史链条为准：
- **E1 ~ E2 (Planning)**：Antigravity 初始化任务，锁定功能 F01/F02/F03/F04/F05/F25/F27 范围，制定实施计划与契约，生成 planning handoff（E2，SHA256: `5aabcee26d8204235439824899d8813a57b4e385ae28f0899f8d64f00e68b86d`）；
- **E3 (Receipt)**：Antigravity 在 `mode: "frontend"` 下作为专职前端开发者，显式核验接受 E2（E3，SHA256: `ca6e3c463ccb37eb5bde637ed47dd3c850a68ee8917ddf1b88851bdb75bc4b6a`）；
- **E4 (Begin Implementation)**：Antigravity 启动 implementation 阶段（E4，SHA256: `cd36d190258ba4de952e70725bb5ffbed9aaad3bd5f9ea00916aa850a1006f24`），专职在 `mysql-mcp/web/` 与 `mysql-mcp/tests/web/` 开发前端页面与测试套件；
- **E5 (Implementation Handoff)**：实现前端单页应用（`index.html`、`style.css`、`api.js`、`app.js`）及自动化测试（`frontend.test.mjs`），运行 builds 与隔离快照 `run.mjs` 全绿通过，生成 implementation handoff（E5，SHA256: `ffd2173d24d6762d23e4550ce9b24926e76d7f9ff027663619399c291887f395`）；
- **E6 ~ E7 (Documentation Delivery)**：Antigravity 显式核验接受 E5（E6），启动 documentation_delivery 阶段（E7，SHA256: `d9d0298025faae8fe29c48b7aad1405360613008f2b824515c344db13b437ab1`），同步变更记录、验证证据并准备最终 Git 交付。

## 2. 真实检查与测试覆盖

在隔离快照中实际执行以下全部检查，所有命令均以 exit code 0 退出，零失败/跳过/取消/超时：
- **前端自动化测试套件**：`node --test --test-reporter=tap mysql-mcp/tests/web/frontend.test.mjs`，通过 4/4：
  1. `index.html 语义与无障碍规范校验`（DOCTYPE、lang="zh-CN"、标签显式绑定、dialog 模态框无障碍属性、删除安全警示文本、密码无明文回显、无内联脚本执行）；
  2. `css/style.css 设计系统与无障碍规范校验`（WCAG :focus-visible 外轮廓、Tokens、动效减弱与响应式媒体查询）；
  3. `ApiClient 核心安全与契约逻辑测试`（登录获取 CSRF、注销清空、GET 列表、POST 校验头、PATCH 留空密码忽略、409 乐观锁冲突、草稿与已保存测试、401 会话失效回调）；
  4. `表单字段边界与规则校验测试`（端口 1..65535、连接名 1..64、主机名 1..255、用户名 1..128 边界判断）；
- **治理套件 (governance-tests)**：`node --test --test-reporter=tap tests/governance/governance.test.mjs`，通过 89/89；
- **协作套件 (collaboration-tests)**：`node --test --test-reporter=tap tests/governance/collaboration.test.mjs tests/governance/collaboration-git.test.mjs`，通过 113/113；
- **应用构建契约 (app-build)**：`node mysql-mcp/scripts/build.mjs`，TypeScript 构建并执行 190/190 项后端测试全部通过；
- **应用编译契约 (app-compile)**：`node mysql-mcp/scripts/compile.mjs`，严格 `tsc --noEmit` 检查通过，exit code 0；
- **代码格式与换行检查**：在 `core.autocrlf=true` 环境下校验通过，无多余空格与格式警告。

## 3. 安全与无障碍核心落地

1. **凭据零泄露与即用即弃**：密码与本地高熵码在前端仅存在于当前表单输入中，绝不保存至 `localStorage`、`sessionStorage` 或全局变量，模态框关闭或提交后立即清空内存；
2. **密码留空保持语义**：编辑连接时输入框 placeholder 提示“留空保持原密码”，若输入为空，前端自动从 PATCH 请求体彻底移除 `password` 属性，与后端 Keyring 补偿机制完全对齐；
3. **CSRF 自动注入与注销清空**：`ApiClient` 内存实例自动注入 `x-csrf-token`，401 会话过期时自动清空内存令牌并回调应用重置为登录界面；
4. **删除仅删本地配置安全警示**：删除模态框包含显著警告文案：“删除本地连接资料及凭据，不删除数据库”，确保用户操作心理模型清晰；
5. **DOM 注入安全**：所有动态列表渲染采用 `textContent` 与 `createElement` 原生安全 API，彻底消除任何 XSS 攻击面；
6. **无障碍焦点陷阱 (WCAG 2.1 AA)**：所有模态框配备 `role="dialog"`、`aria-modal="true"`，支持 `Tab` 循环陷阱与 `Escape` 退出并自动归位焦点。

## 4. 证据边界与未验收限制

- **诊断声明限制**：本地执行产生的 `run.json` 与嵌入 TAP 日志仅为本地诊断证据，必须以 GitHub Actions 独立 CI 与用户人工验收为最终基准。
- **真实 MySQL 连通性限制 (F05)**：当前连接测试主要通过沙箱模拟器与网络探测完成，真实 MySQL 连通性与权限验证留待 DBA 提供测试库授权后执行。
- **无障碍人工实测限制 (F27)**：页面无障碍与视口适配已由自动化测试及结构契约验证，最终实机浏览器人工核验留待端到端验收阶段。
- **无外部数据库连接**：后端测试与前端测试均运行于有界沙箱环境，未连接外部生产 MySQL 数据库。
