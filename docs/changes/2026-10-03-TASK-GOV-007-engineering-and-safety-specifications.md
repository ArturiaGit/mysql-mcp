# [TASK-GOV-007] 工程化工具链、SQL策略与测试规范增强

- 变更日期：2026-10-03
- 关联任务：TASK-GOV-007
- 关联 PR：待回填（Git 交付后由 record-delivery 与后续台账同步）
- 关联 Commit：待回填（Git 交付后由 record-delivery 与后续台账同步）
- 责任执行方：Antigravity (Planning & Documentation Delivery)
- 关联功能/需求：G02 (规范与 Git 交付基线), R06, R07, R12, R13, R14, R16

---

## 📢 发版说明（Release Notes / 面向用户与下游）

### 变更分类与追溯条目
- **🚀 Added**：
  - 新增工程化脚手架与构建检查契约规范 [`docs/ENGINEERING_TOOLCHAIN.md`](../ENGINEERING_TOOLCHAIN.md)：确立原生 ESM 模式与 TypeScript 严格模式，规范 `mysql-mcp/scripts/build.mjs` 与 `compile.mjs` 纯 Node 无 Shell 执行契约，严格满足治理自动化门禁 `task.build_checks` 要求 by @Antigravity
  - 新增 SQL 语法支持矩阵与风险分级策略规范 [`docs/SQL_POLICY_MATRIX.md`](../SQL_POLICY_MATRIX.md)：建立 L0（只读直通/LIMIT截断）、L1（常规受控DML单次人工确认）、L2（高危全表修改与DDL双重警示强确认）、L3（跨库/多语句/提权/文件交互硬拦截）四级安全矩阵与 AST 语法流向 by @Antigravity
  - 新增自动化测试分层与沙箱隔离规范 [`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md)：严守自动化测试绝不默认连接真实外部数据库的绝对安全红线，规划纯内存单测、驱动连接桩及 MCP stdio 探针三层测试金字塔，并确立 Windows 防单测超时与防 I/O 抖动策略 by @Antigravity
  - 增强跨平台凭据抽象与异常脱敏规范（更新 [`docs/DATA_MODELS.md`](../DATA_MODELS.md) 与 [`docs/TECH_STACK.md`](../TECH_STACK.md)）：引入可插拔 `ICredentialProvider`（生产 Windows Keyring vs 测试/CI 加密内存桩），解决 Linux CI 无系统 keyring 运行环境问题；确立连接串、冲突数据值及本地路径掩蔽规则 by @Antigravity
- **🔄 Changed**：
  - 扩展 G02 功能台账并新增 G02-A3 验收标准；
  - 同步更新 `docs/README.md`、`docs/plans/README.md` 与 `docs/FEATURE_STATUS.md` 全景索引。

### 发版亮点摘要 (Highlights)
全面补齐了从治理架构走向业务代码落地的四大核心规范，为下一步生产代码实现提供了明确的构建契约、SQL 安全防线与离线可复现测试沙箱。

---

## 🛠️ Agent 工程上下文与架构演进（面向开发者与后续 Agent）

### 1. 架构与设计决策 (Why & Design)
- **背景与痛点**：在完成治理双 Agent 协作（TASK-GOV-004）与变更管理体系（TASK-GOV-005、TASK-GOV-006）后，主干已具备强健门禁。但在启动生产应用（`mysql-mcp/`）代码开发前，缺乏应用构建契约、SQL 细粒度风险分级、自动化测试沙箱隔离及凭据抽象，直接动手开发极易触发门禁拦截或平台不兼容。
- **设计决策**：
  1. **构建与编译解耦（契约适配）**：治理门禁规定有应用代码时必须登记 `task.build_checks`。为此提前规定必须提供纯 Node 运行的 `build.mjs` 与 `compile.mjs`，严禁任何复杂 Shell 命令。
  2. **四级 SQL 风险矩阵**：从 L0（只读直通）到 L3（硬拦截），利用 AST 树分析确保单数据库作用域，防止注入与提权越界。
  3. **沙箱测试与 CI 稳定性**：强制测试禁止直连真实外部库，采用虚拟协议桩与纯内存用例，保障 Linux CI（无 Keyring 守护进程）与 Windows 开发机（耗时敏感）双端 100% 稳定运行。

### 2. 实际改动文件与逻辑清单 (What)
- `docs/ENGINEERING_TOOLCHAIN.md`：新增工程化与构建规范。
- `docs/SQL_POLICY_MATRIX.md`：新增 SQL 策略与风险矩阵规范。
- `docs/TESTING_STRATEGY.md`：新增自动化测试与沙箱隔离规范。
- `docs/DATA_MODELS.md`：新增第 7 节定义跨平台 `ICredentialProvider` 与异常脱敏规范。
- `docs/TECH_STACK.md`：补充多环境凭据适配与构建命令说明。
- `docs/README.md` & `docs/plans/README.md`：更新文档全景索引与实施计划台账。
- `governance/features.json`：G02 扩充 G02-A3 验收标准。
- `governance/tasks.json`：登记 TASK-GOV-007，回填 TASK-GOV-006 `pr: 6`。
- `governance/checks.json`：映射 G02-A3 至 governance-tests，并适配 Windows 耗时调整 governance-tests 超时阈值（240s）。
- `docs/FEATURE_STATUS.md`：通过 `report.mjs --write` 更新派生状态。
- `docs/plans/engineering-and-safety-specifications.md`：记录本任务实施计划。
- `docs/changes/2026-10-03-TASK-GOV-007-engineering-and-safety-specifications.md`：记录本次变更台账。
- `docs/changes/README.md`：更新活动未发版变更列表并回填 PR #6。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **避坑警示 1（计划文件漂移导致 plan/code drift 报错）**：
  `contractHash` 强绑定 `t.plan_path`！如果在规划阶段结束生成契约后修改计划文件，会导致 `contract_sha256` 漂移，进而触发 `plan/code drift: replan and rework before delivery` 报错！因此，**计划文件在 planning 阶段必须定稿，一旦进入后续阶段严禁篡改其内容**。
- **避坑警示 2（Windows 单测 I/O 耗时与超时阈值）**：
  治理测试在 Windows 上单次执行耗时约 105s，贴近 120s 超时阈值。因此在后续业务测试中必须纯内存运行，严禁在用例中密集派生进程或创建磁盘小文件。
- **避坑警示 3（Linux CI 无 Keyring 兼容性）**：
  GitHub Actions Linux Runner 缺乏 D-Bus/Secret Service，直接调用系统 Keyring 会导致 CI 崩溃。代码必须基于 `ICredentialProvider` 接口编程，测试与 CI 中注入 `InMemoryCredentialProvider`。
- **避坑警示 4（构建检查强制无 Shell 契约）**：
  一旦创建 `package.json`，任务必须登记 `task.build_checks`；执行命令必须为 `node mysql-mcp/scripts/xxx.mjs`，严禁借助 Shell 管道或分号拼接命令。

### 4. 验证证据 (Verification)
- `node scripts/governance/check.mjs` 门禁结构与范围检查通过。
- `node scripts/governance/run.mjs` 141 项治理测试全部通过（68 项 governance-tests + 73 项 collaboration-tests）。
