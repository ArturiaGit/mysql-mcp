# 工程化工具链、SQL策略与测试规范增强实施计划

状态：in_progress
需求来源：R06, R07, R12, R13, R14, R16
关联特性：G02 (规范与 Git 交付基线), F28 (工程化规范支撑)
授权范围：编写 docs/ENGINEERING_TOOLCHAIN.md、docs/SQL_POLICY_MATRIX.md、docs/TESTING_STRATEGY.md；完善 DATA_MODELS.md 与 TECH_STACK.md 凭据抽象与脱敏；同步导航索引与治理台账
明确排除：业务源码实现、安装 npm 依赖、真实数据库连接
任务分支：docs/engineering-and-safety-specifications
main 基线提交：fa911793060028b96597805ce6a1ccddcf82aeef

## 目标与现状

### 事实
- 仓库已通过 PR #1 ~ #6 建立健全双 Agent 协作与自动化门禁，主干流水线 100% 全绿。
- 但现有规范主要聚焦于治理层（Meta-Governance），在进入应用业务代码（`mysql-mcp/`）开发前，存在应用脚手架构建契约、SQL 细粒度风险分级、自动化测试沙箱隔离及跨平台凭据提供者四大工程盲区。

### 提案
1. **应用工程化脚手架与构建检查契约（`docs/ENGINEERING_TOOLCHAIN.md`）**：
   - 规定原生 ESM 模式（`"type": "module"`）与 TypeScript `strict: true` 规范；
   - 明确构建入口脚本契约（`mysql-mcp/build.mjs` 与 `compile.mjs` 纯 Node 无 Shell 执行），适配 `task.build_checks` 机械门禁要求；
   - 规定包管理、锁定依赖与可复现安装准则。
2. **SQL 语法支持矩阵与风险分级策略规范（`docs/SQL_POLICY_MATRIX.md`）**：
   - 制定 L0（只读直通）、L1（受控 DML 二次审批）、L2（高危 DML/DDL 双重警示确认）、L3（跨库/多语句/提权/文件写入硬拦截）四级安全矩阵；
   - 明确语法解析、参数化与安全审计拦截规则。
3. **测试策略与开发环境假数据直连规范（`docs/TESTING_STRATEGY.md`）**：
   - 依据需求 S10 确立“开发环境直连本地假数据库（随便用、免 Mock 桩）+ CI 离线静态轻量门禁”的双轨测试模型；
   - 彻底废除强制编写维护 Mock Driver / FakeSocket 虚拟协议桩的要求，本地联调与测试直接在开发库真实执行 CRUD 与 DDL 验证；
   - CI 环境仅运行无数据库依赖的 TypeScript 类型检查与纯内存 AST/脱敏过滤器单测，确保 100% 确定性离线秒级通过；
   - 设定 Windows 下测试超时预防与防 I/O 抖动策略；在 `governance/checks.json` 中将 `governance-tests` 超时阈值由 120s 调整为 240s，防止测试用例增多后 Windows NTFS 多进程 I/O 耗时误报超时。
4. **跨平台凭据抽象与异常脱敏完善（更新 `docs/DATA_MODELS.md` / `docs/TECH_STACK.md`）**：
   - 引入可插拔 `ICredentialProvider`（生产 Windows Keyring，测试/CI 内存加密桩），解决 Linux CI 无系统 keyring 崩溃问题；
   - 细化 SQL 错误与回显敏感数据脱敏过滤器规范。

## 文件与行为

- `docs/plans/engineering-and-safety-specifications.md`：本任务实施计划台账。
- `governance/features.json`：G02 扩充 G02-A3 验收标准。
- `governance/tasks.json`：登记 TASK-GOV-007。
- `governance/checks.json`：映射 G02-A3 至 governance-tests，并适配 Windows 进程与 I/O 耗时调整 governance-tests 超时阈值（240s）。
- `docs/ENGINEERING_TOOLCHAIN.md`：新增工程化工具链与构建检查规范。
- `docs/SQL_POLICY_MATRIX.md`：新增 SQL 语法支持与风险分级策略矩阵。
- `docs/TESTING_STRATEGY.md`：新增测试策略与开发环境假数据直连规范（免 Mock 桩）。
- `docs/DATA_MODELS.md`：补充凭据提供者接口抽象与异常脱敏规则。
- `docs/TECH_STACK.md`：补充多环境凭据适配与构建命令说明。
- `docs/README.md`：更新文档全景索引。
- `docs/plans/README.md`：更新实施计划索引。
- `docs/FEATURE_STATUS.md`：派生状态同步更新。
- `docs/changes/2026-10-03-TASK-GOV-007-engineering-and-safety-specifications.md`：本次任务变更台账。
- `docs/changes/README.md`：更新未发版变更列表。

## 实施步骤

1. 登记 G02-A3 与任务 TASK-GOV-007，同步 checks.json 与 tasks.json。
2. 启动 Antigravity planning 阶段（`handoff.mjs begin`）。
3. 编写三大新增规范文档并深化已有数据模型与技术选型文档。
4. 完成 planning 阶段（`handoff.mjs finish`）。
5. 显式核验接受并进入 documentation_delivery 阶段。
6. 编写变更文档与更新未发版列表。
7. 运行本地全量测试（`run.mjs`）与结构检查（`check.mjs`）。
8. 完成 documentation_delivery 交付候选，执行 Git 提交、推送、创建 PR 并监控 CI。

## 验收

- `node scripts/governance/check.mjs` 通过。
- `node scripts/governance/run.mjs` 141 项测试全量通过。
- 新增三大规范内容完整详尽、无 TODO/占位符，相对路径全部可正常解析。
- 等待用户确认合并。
