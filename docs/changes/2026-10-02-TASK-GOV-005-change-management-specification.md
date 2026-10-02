# [TASK-GOV-005] 变更管理与发版说明集成规约

- 变更日期：2026-10-02
- 关联任务：TASK-GOV-005
- 关联 PR：待交付 (in_progress)
- 关联 Commit：待交付 (in_progress)
- 责任执行方：Antigravity
- 关联功能/需求：G02, R18

---

## 📢 发版说明（Release Notes）

### 变更分类与追溯条目
- **🚀 Added**：
  - 建立 `docs/changes/` 专属变更管理库，并在 `docs/changes/README.md` 中确立单篇变更规范与索引规约 by @ArturiaGit (待关联 PR)
  - 确立变更文档“双重视角”标准模板：既包含面向发布的标准分类（Added/Changed/Fixed/Breaking 等）与 PR/Commit 溯源链接，又包含面向 Agent 的深层设计与避坑指南。
  - 确立“发版驱动”生命周期闭环：平时沉淀独立变更碎片，发版时一键聚合生成正式 GitHub Releases / CHANGELOG 并自动归档至 `docs/changes/archive/vX.Y.Z/`。
  - 回溯补齐 PR #1 ~ PR #4 历史变更文档，提供真实超链接与踩坑警示。
- **🔄 Changed**：
  - 更新 `AGENTS.md` 入口约束：任何 Agent 开启新任务前，必须强制通读 `docs/changes/` 下所有活动未发版变更。
  - 同步更新 `docs/README.md`、`docs/COLLABORATION_WORKFLOW.md` 与 `docs/VERSIONING.md`。

### 发版亮点摘要 (Highlights)
彻底解决了 Agent 会话遗忘历史、重复踩坑以及未来发版时难以提取 Release Notes 的难题，实现了从日常微小变更到大版本发布的自动化演进闭环。

---

## 🛠️ Agent 工程上下文与架构演进

### 1. 架构与设计决策 (Why & Design)
- 为什么不纯依赖 Git log？
  - Git diff 充满噪声（格式、import、底层碎屑），Token 消耗极大；且 Git commit 无法体现“为什么要这么改”、“踩了什么坑”、“后续任务绝对不能做什么”。
- 为什么采用独立文件而不是单文件？
  - 独立碎片文件天然具备 Git 分支并行友好性，不同任务不会产生单文件合并冲突；发版时通过简单读取未发版目录直接聚合，逻辑极为纯粹。
- 任务模式选定：
  - 本任务属于纯规范与文档体系演进（文档-only），由 Antigravity 全权负责规划、编写与交付，流程为 `planning → documentation_delivery`。

### 2. 实际改动文件与逻辑清单 (What)
- 新增 `docs/changes/` 及其规范和 5 篇变更文档。
- 新增 `docs/plans/change-management.md`。
- 修改 `AGENTS.md`、`docs/README.md`、`docs/REQUIREMENTS.md`、`docs/COLLABORATION_WORKFLOW.md`、`docs/VERSIONING.md`。
- 修改 `governance/features.json`、`governance/tasks.json`、`governance/checks.json`。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **新任务启动前必须通读本目录**：这是 `AGENTS.md` 写入的铁律，绝不可省略跳过！
- **发版后归档规范**：一旦某版本（如 v0.1.0）正式发布，必须将该版本对应的变更文档整体移入 `docs/changes/archive/vX.Y.Z/`，不可让过期变更长期停留在根目录干扰后续 Agent。
- **真实链接回填**：任务在 `record-delivery` 获取真实 PR 和 commit 后，必须将变更文档中的“待交付”替换为真实超链接。

### 4. 验证证据 (Verification)
- 全量治理测试 `node scripts/governance/check.mjs` 与 `node scripts/governance/run.mjs` 验证通过。
