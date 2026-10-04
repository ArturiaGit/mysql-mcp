# Phase 1 应用工程脚手架与构建检查契约实施计划

状态：in_progress
需求来源：R12, R13
关联特性：F28 (Node.js/TypeScript 应用工程)
授权范围：用户批准建立 Phase 1 应用工程脚手架与构建检查契约，初始化 mysql-mcp/，配置 ESM、tsconfig、构建与编译脚本及应用冒烟测试；授权在 scripts/governance/、tests/governance/ 与 .github/workflows/ 中完善治理隔离快照与 CI 依赖准备契约。
明确排除：业务数据真实写入、未授权规范篡改；PI 不得执行本仓库 commit/push/PR。
任务分支：feat/app-scaffold-and-toolchain
main 基线提交：edf957aa653b8037fd3db5a81d37eb51610c7d12

## 目标与现状

### 事实
- 项目规范（包括 `docs/ENGINEERING_TOOLCHAIN.md`、`docs/SQL_POLICY_MATRIX.md`、`docs/TESTING_STRATEGY.md`）已通过 PR #7 完整定稿并合入主干（Commit `edf957a`）。
- PI-Desktop 在第一轮 implementation 中已成功创建 `mysql-mcp/` 生产应用骨架的 7 个核心授权文件：`package.json`、`package-lock.json`、`tsconfig.json`、`scripts/build.mjs`、`scripts/compile.mjs`、`src/index.ts`、`tests/smoke.test.mjs`。
- 在工作区内直接运行 `compile.mjs`、`build.mjs`、`npm test` 与 `handoff.mjs builds` 均 exit 0，6 项冒烟测试全部通过。
- **发现的阻塞问题**：在执行 `node scripts/governance/run.mjs` 门禁时，`run.mjs` 调用 `snapshot()` 创建隔离副本，由于 `node_modules` 属于 `.gitignore` 保护文件，快照副本中不包含 `mysql-mcp/node_modules/`，导致构建脚本调用本地编译器 `tsc` 时报 `ENOENT`，隔离 `run.mjs` 整体失败；同时 GitHub Actions CI 流水线也尚未配置 `mysql-mcp/` 的依赖安装步骤。

### 提案
1. **保留已验证的 `mysql-mcp/` 应用骨架**：
   - 保留原生 ESM 模式（`"type": "module"`）、TypeScript 严格编译配置及 6 项冒烟测试。
2. **治理隔离快照与 CI 依赖准备修复（交由 PI-Desktop 实施）**：
   - **快照依赖准备契约**：在 `scripts/governance/lib/core.mjs`（或 `snapshot` 构建流程）中，当检测到快照目录下存在 `mysql-mcp/package-lock.json` 时，安全、确定性地执行依赖准备（如在快照内部调用 `npm ci --ignore-scripts`，或在有完整锁文件校验下复用依赖沙箱），确保快照中本地 `tsc` 编译器可用且不破坏快照隔离性。
   - **CI 流水线同步**：在 `.github/workflows/governance.yml` 中补充在进入治理测试前的应用依赖安装步骤（如 `npm ci` 在 `mysql-mcp/`），确保远端 GitHub Actions Runner 顺利通过。
   - **治理回归测试**：在 `tests/governance/` 中补充对包含应用工程时快照构建正常运行的回归测试。
3. **特性台账与自动检查闭环**：
   - 在 `governance/features.json` 中将 `F28` 标记为 `in_progress` 并明确绑定 7 个实现与测试文件；
   - 明确 `F28-A1` 的自动化验收由 `task.build_checks`（`app-build` 与 `app-compile`）及快照内实际构建执行验证保证。

## 文件与行为

### Antigravity 规划交付
- `docs/plans/app-scaffold-and-toolchain.md`：本任务实施计划（定稿）。
- `docs/plans/README.md`：更新实施计划台账并清理末尾空行。
- `governance/tasks.json`：登记 TASK-APP-001，扩展 `allowed_paths`（包含 `scripts/governance/`、`tests/governance/`、`.github/workflows/`），回填 TASK-GOV-007 `pr: 7`。
- `governance/features.json`：更新 F28 为 `in_progress`，记录实现与测试路径。
- `docs/TECH_STACK.md`：修正第 17 行测试描述遗留。
- `docs/changes/README.md` & `docs/changes/2026-10-03-TASK-GOV-007-engineering-and-safety-specifications.md`：回填 PR #7 归档信息。
- `docs/FEATURE_STATUS.md`：由 `report.mjs --write` 更新派生状态。

### PI-Desktop 实现交付
- `mysql-mcp/` 生产工程文件维护与完善。
- `scripts/governance/`：完善快照依赖准备逻辑，使隔离 `run.mjs` 正常执行。
- `tests/governance/`：确保既有 141 项测试及新增快照依赖测试全绿通过。
- `.github/workflows/governance.yml`：补充应用依赖安装步骤。

## 实施步骤

1. Antigravity 完成第二轮 Planning 阶段：更新任务授权范围、绑定特性状态、定稿计划、生成 handoff prompt。
2. 用户人工转交 prompt 给 PI-Desktop。
3. PI-Desktop 显式接受交接（`handoff.mjs accept`）并进入 implementation 阶段（`handoff.mjs begin`）。
4. PI-Desktop 在 `scripts/governance/` 修复快照依赖准备契约，并在 `.github/workflows/` 配置依赖安装。
5. PI-Desktop 运行 `node scripts/governance/handoff.mjs builds --task TASK-APP-001 --role pi-desktop` 与完整 `node scripts/governance/run.mjs`，确保快照执行通过。
6. PI-Desktop 完成阶段并生成反向 prompt。
7. 用户转交回 Antigravity，Antigravity 验收代码、同步变更文档、自动 commit、push、创建 PR 并查询 CI。

## 验收

- `node scripts/governance/check.mjs` 门禁通过。
- `node scripts/governance/run.mjs` 隔离快照运行全量通过（含 `governance-tests`、`collaboration-tests`、`app-build` 与 `app-compile`）。
- 依赖和锁定文件完整入库，CI 流水线远端全绿。
- 等待用户确认合并。
