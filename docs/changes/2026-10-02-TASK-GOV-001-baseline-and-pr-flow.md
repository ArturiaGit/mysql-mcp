# [TASK-GOV-001] 规范基线与 Agent 自动分支到 PR 流程

- 变更日期：2026-10-02
- 关联任务：TASK-GOV-001
- 关联 PR：[#1](https://github.com/ArturiaGit/mysql-mcp/pull/1)
- 关联 Commit：[`689f9ef`](https://github.com/ArturiaGit/mysql-mcp/commit/689f9ef01f06f248b62764fe97d0b0fa4171fec3)
- 责任执行方：Antigravity
- 关联功能/需求：G01, G02, R13, R15, R16

---

## 📢 发版说明（Release Notes）

### 变更分类与追溯条目
- **🚀 Added**：
  - 建立全套项目规范体系（架构、需求、接口协议、数据模型、Git 工作流等）by @ArturiaGit in [#1](https://github.com/ArturiaGit/mysql-mcp/pull/1) ([`689f9ef`](https://github.com/ArturiaGit/mysql-mcp/commit/689f9ef01f06f248b62764fe97d0b0fa4171fec3))
  - 建立自动化治理与质量门禁脚本集（`scripts/governance/check.mjs`, `run.mjs`, `report.mjs`）by @ArturiaGit in [#1](https://github.com/ArturiaGit/mysql-mcp/pull/1) ([`689f9ef`](https://github.com/ArturiaGit/mysql-mcp/commit/689f9ef01f06f248b62764fe97d0b0fa4171fec3))
  - 建立 Git 本地 Hooks（pre-commit, commit-msg, pre-push）与 GitHub Actions Governance CI 自动化校验工作流 by @ArturiaGit in [#1](https://github.com/ArturiaGit/mysql-mcp/pull/1) ([`689f9ef`](https://github.com/ArturiaGit/mysql-mcp/commit/689f9ef01f06f248b62764fe97d0b0fa4171fec3))
- **🔒 Security**：
  - 强制禁止私钥、令牌、真实连接串和本地敏感记忆文件提交入库，加入模式校验。

### 发版亮点摘要 (Highlights)
奠定了项目的安全防线与工程治理基准，规范了 Agent 的分支管理、提交信息规范和自动化 PR 流程，确保无证据绝不假标完成。

---

## 🛠️ Agent 工程上下文与架构演进

### 1. 架构与设计决策 (Why & Design)
- 为了解决 AI 编程时容易信口开河、声明“已完成”但实际上没有测试或未真正提交的问题，建立了以机器可读的 `governance/features.json`、`governance/tasks.json`、`governance/checks.json` 为单一真相源的机械治理体系。
- 拒绝宽松信任：所有完成状态必须经由执行器在隔离快照中实际重跑并输出 TAP 报告核查。

### 2. 实际改动文件与逻辑清单 (What)
- 新增 `AGENTS.md`：Agent 行为守则与红线。
- 新增 `docs/` 下全套规范（REQUIREMENTS, GIT_WORKFLOW, ACCEPTANCE 等）。
- 新增 `scripts/governance/` 工具链与 `.githooks/` 挂钩。
- 新增 `.github/workflows/governance.yml`。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **严禁直接在 main 分支修改或提交**：必须先检出任务分支（如 `feat/`, `fix/`, `docs/`, `chore/`）。
- **必须遵循 Conventional Commits**：提交信息必须符合格式（如 `docs(governance): ...`），否则 commit-msg hook 会直接拒绝。
- **治理检查必须通过**：提交前必须跑过 `node scripts/governance/check.mjs`。

### 4. 验证证据 (Verification)
- 运行治理单元测试与快照验证，GitHub Actions CI 初次构建通过。
