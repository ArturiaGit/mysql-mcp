# [TASK-GOV-002] GitHub CI 继承环境隔离与回归测试

- 变更日期：2026-10-02
- 关联任务：TASK-GOV-002
- 关联 PR：[#2](https://github.com/ArturiaGit/mysql-mcp/pull/2)
- 关联 Commit：[`c61f157`](https://github.com/ArturiaGit/mysql-mcp/commit/c61f1579583c2a9b0399772d11bb74ad8a8b4834)
- 责任执行方：Antigravity
- 关联功能/需求：G01, R16

---

## 📢 发版说明（Release Notes）

### 变更分类与追溯条目
- **🐛 Fixed**：
  - 修复 GitHub Actions 运行测试时意外继承上层环境变量（如 `GITHUB_ACTIONS=true`、`GITHUB_REF`）导致测试夹具判断失真的问题 by @ArturiaGit in [#2](https://github.com/ArturiaGit/mysql-mcp/pull/2) ([`c61f157`](https://github.com/ArturiaGit/mysql-mcp/commit/c61f1579583c2a9b0399772d11bb74ad8a8b4834))
  - 增加 `--ci-main` 上下文正反向单元回归测试。

### 发版亮点摘要 (Highlights)
彻底消除了 CI 执行环境与本地执行环境的行为不一致隐患，保证治理门禁测试在任何机器与 CI Runner 上行为 100% 确定。

---

## 🛠️ Agent 工程上下文与架构演进

### 1. 架构与设计决策 (Why & Design)
- 在 PR #1 合并到 main 触发的 CI run 中，测试夹具执行时因为外层是在 GitHub Runner 环境，子进程自动继承了外部环境变量，导致某些旨在测试“非 CI 模式”的测试用例意外命中 CI 分支逻辑而报错。
- 解决方案：在测试环境准备（fixture）中显式清洗并剔除 `GIT_*`, `GOV_*`, `NODE_TEST_*`, `GITHUB_*` 变量。

### 2. 实际改动文件与逻辑清单 (What)
- 修改 `scripts/governance/lib/execute.mjs`：清洗子进程继承环境。
- 修改 `tests/governance/governance.test.mjs`：增加回归用例。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **子进程测试环境隔离原则**：后续任何编写自动化测试或 spawn 新进程的 Agent，严禁假设子进程运行在干净的 shell 下；如果测试依赖环境变量状态，必须显式隔离或传入独立的 env 字典。

### 4. 验证证据 (Verification)
- 本地与 GitHub Actions CI 均全量运行通过（run 36978438183）。
