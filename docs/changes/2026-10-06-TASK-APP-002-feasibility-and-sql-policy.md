# [TASK-APP-002] Phase 1-B 关键依赖可行性与核心安全原型

- 变更日期：2026-10-06
- 关联任务：TASK-APP-002
- 关联 PR：待交付
- 关联 Commit：待提交
- 责任执行方：Antigravity (Planning & Documentation Delivery) × PI-Desktop (Implementation)
- 关联功能/需求：F06, F26, F28 / R03, R06, R07, R08, R12, R14, R16

---

## 📢 发版说明（Release Notes / 面向用户与下游）

### 变更分类与追溯条目
- **🚀 Added**：
  - 在 `mysql-mcp/src/security/` 封装 Windows 系统凭据提供者 `WindowsKeyringProvider`（基于 `@napi-rs/keyring@2.1.0`），提供异步凭据存储、读取与清理，服务名为 `mysql-mcp:<connection-id>`，用户名统一为 `mysql-mcp`，5 项虚构凭据 CRUD 与 Node.js 进程重启重读自动化测试全部通过 by @PI-Desktop
  - 在 `mysql-mcp/src/sql/` 基于 `node-sql-parser@5.4.0` 落地 `evaluateSql` 语法树静态分析与 L0~L3 风险分级引擎，涵盖词法分号多语句预查、可执行注释阻断、系统库跨库探测及白名单校验，构建 113 项纯内存单测矩阵全绿通过 by @PI-Desktop
  - 在 `mysql-mcp/src/mcp/` 建立 `@modelcontextprotocol/sdk@1.32.0` Stdio Server 原型工厂（`createMcpServer` 与 `startStdioServer`），实现纯净 JSON-RPC stdio 通信与生命周期监听，未知工具调用安全阻断且不回显传入参数 by @PI-Desktop
  - 在 `mysql-mcp/scripts/build.mjs` 联动执行全部 4 个测试套件（冒烟 6 项、凭据 5 项、SQL 策略 113 项、MCP 协议 3 项），应用测试扩充至 127 项全部通过 by @PI-Desktop
- **🔒 Security**：
  - 确立系统凭据异常屏蔽防线（`CredentialStoreError` 与 `CredentialArgumentError`），严格校验 Connection ID 格式（1~128 安全字符）与密码内容（UTF-8 长度 <= 1024 字节，非空且无 `\0`），杜绝原生底层错误或路径外泄；生产环境坚决不提供明文后备；
  - 确立防 DoS 与 SQL 注入硬上限：输入字符限制 64KiB、词法 Token 限制 4,096、嵌套深度限制 32 层、AST 节点遍历上限 12,000 次、递归深度限制 64 层；
  - 拦截可执行注释（`/*!...*/`）、优化器 hint、用户变量（`@var`）与方言歧义；导出结构指纹（去除字面量与注释）与准确 SQL 哈希。
- **🔄 Changed**：
  - 更新 `mysql-mcp/src/index.ts` 聚合导出全部安全与协议核心组件，主模块导入保持纯净惰性，不自发启动网络监听或连接数据库；
  - 同步 7 份规约与架构文档（`DATA_MODELS.md`、`SQL_POLICY_MATRIX.md`、`API_AND_PROTOCOLS.md`、`ARCHITECTURE.md`、`PROJECT_CONSTRAINTS.md`、`TECH_STACK.md`、`DEPLOYMENT_GUIDE.md`、`CODE_REVIEW.md`、`ENGINEERING_TOOLCHAIN.md`、`REQUIREMENTS.md`、`ROADMAP.md`），如实记录原型落地事实与未验证项边界 by @Antigravity

### 发版亮点摘要 (Highlights)
完整落地了 Phase 1-B 的三大安全核心：Windows 原生凭据存储异步封装（实机 CRUD 与进程重启重读通过）、基于 AST 的 SQL 四级风险策略防御引擎（113 项单测 100% 覆盖）以及 MCP Stdio 协议原型工厂，应用工程自动化测试扩充至 127 项，零新增运行时依赖。

---

## 🛠️ Agent 工程上下文与架构演进（面向开发者与后续 Agent）

### 1. 架构与设计决策 (Why & Design)
- **凭据抽象与环境隔离**：遵循 C02 安全约束，生产环境强制调用 `WindowsKeyringProvider`，绝不允许明文后备；为保证 CI（Linux/Ubuntu 无 D-Bus/Secret Service 环境）确定性通过，仅在测试用例内部提供测试专用基于 AES-GCM 的 In-Memory 模拟分支，代码主逻辑无生产内存后备漏洞。
- **静态策略引擎防 DoS 与指纹提取**：SQL 策略在接触任何数据库驱动前先行通过 AST 拦截高危指令。为了防御恶意构造的大型复杂嵌套 SQL 造成 Node.js 事件循环阻塞或调用栈溢出，在 `ast.ts` 中设定了三道防线（64KiB 文本截断、4096 词法 Token 深度、12000 AST 访问上限）。
- **MCP 服务端工厂与防泄密回显**：`createMcpServer` 导出的实例在收到未知工具请求时抛出 `MethodNotFound`，但坚决不回显客户端请求中传入的工具名或参数对象，防止参数中包含的敏感数据库密码被反弹至客户端日志。

### 2. 实际改动文件与逻辑清单 (What)
- **应用源码 (`mysql-mcp/src/`)**：
  - `security/keyring.ts`：Windows Keyring 封装与输入校验。
  - `sql/ast.ts`：词法分号多语句预查、`node-sql-parser` 适配与硬阈值。
  - `sql/policy.ts`：L0~L3 风险判定、白名单函数/类型校验、指纹与摘要计算。
  - `mcp/server.ts`：MCP Stdio Server 骨架与 stdio 生命周期管理。
  - `index.ts`：聚合导出各模块类型与工厂。
- **测试套件 (`mysql-mcp/tests/`)**：
  - `tests/keyring.test.mjs`：虚构凭据 CRUD、更新与进程重启持久化测试（5 项）。
  - `tests/sql-policy.test.mjs`：L0~L3 正反例与边界测试（113 项）。
  - `tests/mcp.test.mjs`：MCP Stdio 协议交互与错误处理测试（3 项）。
  - `scripts/build.mjs`：联动执行全部测试。
- **规约文档 (`docs/`)**：
  - 全面同步各规范中的接口定义、数据模型与技术选型。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **避坑警示 1（Windows 历史 CRLF 与临时快照）**：
  治理门禁 `run.mjs` 在创建隔离 Git 快照进行比对时，若宿主 Git 全局未启用 `core.autocrlf`，Windows 下历史检出的 CRLF 文件可能在快照比对时被 `git diff` 误报为工作区脏修改。执行治理检查时需注意使用检查进程级 `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=true` 归一化，严禁擅自修改全局/仓库 Git 基础配置或关闭任何门禁。
- **避坑警示 2（凭据服务不是任意字符串存储）**：
  `WindowsKeyringProvider` 的 `ref` 是连接 ID，服务名强制为 `mysql-mcp:<ref>`，用户名为 `mysql-mcp`。调用时切勿在 `ref` 前重复添加 `mysql-mcp:` 前缀。
- **避坑警示 3（AST 策略引擎不等于数据库执行器）**：
  `evaluateSql` 仅执行纯静态语法树检查与风险等级判定，返回的 `max_rows` (1000) 与 `max_response_bytes` (1048576) 仅为预算元数据；该函数**不会**修改 SQL 文本（未追加 LIMIT），也**不会**执行实际查询或截断。实际执行器与截断控制将在后续阶段实现。
- **避坑警示 4（未验证真实 MySQL）**：
  本阶段未连接真实 MySQL 数据库；不能声称 F06 或 F26 已完成最终验收。

### 4. 验证证据 (Verification)
- `node scripts/governance/check.mjs`：静态治理检查通过。
- `node scripts/governance/run.mjs`：隔离快照下 296 项测试全绿：
  - 治理测试：89/89 pass；
  - 协作测试：80/80 pass；
  - 应用测试：127/127 pass（smoke 6, keyring 5, sql-policy 113, mcp 3）；
  - `app-build` 与 `app-compile` 门禁以 exit 0 通过。
