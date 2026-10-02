# 变更管理规范与 Agent 历史感知机制实施计划

状态：in_progress
需求来源：R18
授权范围：docs/changes/ 库建设、AGENTS.md 入口规则、规范同步、历史 PR #1~#4 回溯变更文档补齐
明确排除：MySQL 业务代码、真实数据库操作、客户端环境修改
任务分支：docs/change-management-specification
main 基线提交：b80bab2f773cd4ce8bca1ae56f6385c4b76fc1e8

## 目标与现状

### 事实
- 仓库已建立公开基线，并完成了 PR #1 ~ PR #4 治理任务（Hook、CI 隔离、任务匹配修复、双 Agent 人工协作与交付门禁）。
- 目前缺乏独立的变更文档体系，Agent 开启新任务时无集中式未发版变更与踩坑警示可读，发版时无现成可用的聚合 Release Notes。

### 提案
1. 建立 `docs/changes/` 作为专属变更管理库，并在 `docs/changes/README.md` 中定义规约与未发版索引。
2. 单篇变更文档采用“双重视角”结构：
   - 📢 发版说明（Release Notes）：标准分类（Added/Changed/Fixed 等）、发版亮点、作者及 PR/Commit 超链接，1:1 对齐 GitHub Release 页面。
   - 🛠️ Agent 工程上下文：设计决策（Why）、改动文件（What）、对后续 Agent 的避坑指南与警示（Caveats & Do's/Don'ts）、验证证据。
3. Agent 强制阅读义务：在 `AGENTS.md` 明确规定，开启新任务必须通读 `docs/changes/` 下所有活动未发版变更文档。
4. 发版驱动生命周期：日常迭代积累未发版变更，发版时由 AI 自动聚合生成正式发版说明并归档至 `docs/changes/archive/vX.Y.Z/`。
5. 回溯补齐 PR #1 ~ #4（TASK-GOV-001 ~ 004）的初始变更文档，填写真实 PR/Commit 链接。

## 文件与行为

- `docs/plans/change-management.md`：本任务实施计划台账。
- `docs/REQUIREMENTS.md`：增加 R18 需求。
- `governance/features.json`：扩展 G02 关联需求与验收标准。
- `governance/tasks.json`：登记 TASK-GOV-005。
- `governance/checks.json`：关联 G02-A2 至 governance-tests。
- `AGENTS.md`：在入口与职责中增加通读未发版变更与交付变更文档强制要求。
- `docs/README.md`：更新文档导航。
- `docs/COLLABORATION_WORKFLOW.md`：更新协作阶段关于变更文档的前置阅读与交付要求。
- `docs/VERSIONING.md`：在发布流程中增加基于变更文档聚合 Release Notes 的步骤。
- `docs/changes/README.md`：变更规范与未发版/归档索引。
- `docs/changes/2026-10-02-TASK-GOV-001-baseline-and-pr-flow.md`：PR #1 变更记录。
- `docs/changes/2026-10-02-TASK-GOV-002-ci-environment-isolation.md`：PR #2 变更记录。
- `docs/changes/2026-10-02-TASK-GOV-003-main-task-selection-fix.md`：PR #3 变更记录。
- `docs/changes/2026-10-02-TASK-GOV-004-antigravity-pi-handoff.md`：PR #4 变更记录。
- `docs/changes/2026-10-02-TASK-GOV-005-change-management-specification.md`：本次任务变更记录。

## 实施步骤

1. 登记需求 R18 与任务 TASK-GOV-005、更新 G02 特性与检查映射。
2. 执行 Antigravity planning 阶段启动与完成。
3. 执行 Antigravity documentation_delivery 阶段启动。
4. 编写 `docs/changes/` 系列规约与 5 篇结构化变更文档。
5. 更新 `AGENTS.md`、`docs/README.md`、`docs/COLLABORATION_WORKFLOW.md`、`docs/VERSIONING.md`。
6. 运行治理检查与派生状态更新。
7. 完成 documentation_delivery 阶段交付，执行 Git commit、push，创建 PR，运行 record-delivery。

## 验收

- `node scripts/governance/check.mjs` 通过。
- `node scripts/governance/run.mjs` 全量通过。
- 变更文档包含标准发版说明与 Agent 上下文，超链接与实际 GitHub PR/Commit 一致。
- 等待用户确认合并。
