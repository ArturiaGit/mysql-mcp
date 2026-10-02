# [TASK-GOV-003] main 多任务基线匹配歧义修复

- 变更日期：2026-10-02
- 关联任务：TASK-GOV-003
- 关联 PR：[#3](https://github.com/ArturiaGit/mysql-mcp/pull/3)
- 关联 Commit：[`ed631a2`](https://github.com/ArturiaGit/mysql-mcp/commit/ed631a2201e6b439bc79ca6d241176db68ddad82)
- 责任执行方：Antigravity
- 关联功能/需求：G01, R16

---

## 📢 发版说明（Release Notes）

### 变更分类与追溯条目
- **🐛 Fixed**：
  - 修复 main 分支在合并 PR（如 PR #2）后执行 push 校验时，因多个历史任务共享相同功能（如 G01）导致 `selectMainTask` 判定“多任务歧义”的误判缺陷 by @ArturiaGit in [#3](https://github.com/ArturiaGit/mysql-mcp/pull/3) ([`ed631a2`](https://github.com/ArturiaGit/mysql-mcp/commit/ed631a2201e6b439bc79ca6d241176db68ddad82))
  - 优化任务匹配算法：优先对比 `tasks.json` 的显式任务对象变更（`changedTasks`），保留对真正跨任务越界修改的拦截。

### 发版亮点摘要 (Highlights)
完善了在 GitHub main 分支上 Squash-Merge 后的自动化校验逻辑，支持后续任务连续迭代同一基础治理功能而不发生匹配锁死。

---

## 🛠️ Agent 工程上下文与架构演进

### 1. 架构与设计决策 (Why & Design)
- 背景：当 PR #2 合并到 main 时，main 上的 CI 脚本 `scripts/governance/check.mjs --snapshot --head ...` 需要反向根据变更推断出是哪一个任务合并进来的。
- 问题：旧逻辑使用“哪些任务关联了被修改的功能”来反查。但 PR #1 和 PR #2 都关联了 `G01`，导致候选集为 2 个任务，触发了 `ambiguous/multi-task merge requires explicit split review` 异常。
- 解决：`selectMainTask` 引入两段式逻辑：先对比 `base..head` 之间 `governance/tasks.json` 到底新增或修改了哪一个任务；如果有明确的且唯一的任务变更，直接精准识别该任务；只有在没有显式任务变更时才回退至功能反查。

### 2. 实际改动文件与逻辑清单 (What)
- 修改 `scripts/governance/lib/scope.mjs` 中的 `selectMainTask` 函数。
- 增加测试用例覆盖该匹配场景。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **多任务共享同一功能的演进规范**：后续任务即使复用已有功能（如 G01/G02），也必须在 `governance/tasks.json` 登记各自唯一的 task ID 和任务定义。严禁在一次 PR 中混合提交多个不同任务的分支改动。

### 4. 验证证据 (Verification)
- 本地自动化测试通过，PR #3 CI run 36979038287 顺利通过。
