# [TASK-GOV-004] Antigravity × PI-Desktop 双 Agent 人工转交与机械门禁

- 变更日期：2026-10-02
- 关联任务：TASK-GOV-004
- 关联 PR：[#4](https://github.com/ArturiaGit/mysql-mcp/pull/4)
- 关联 Commit：[`b80bab2`](https://github.com/ArturiaGit/mysql-mcp/commit/b80bab2f773cd4ce8bca1ae56f6385c4b76fc1e8)
- 责任执行方：Antigravity & PI-Desktop
- 关联功能/需求：G01, G02, G03, R15, R16, R17

---

## 📢 发版说明（Release Notes）

### 变更分类与追溯条目
- **🚀 Added**：
  - 建立 Antigravity 与 PI-Desktop 双 Agent 人工复制转交与版本绑定阶段链规约（`docs/COLLABORATION_WORKFLOW.md`）by @ArturiaGit in [#4](https://github.com/ArturiaGit/mysql-mcp/pull/4) ([`b80bab2`](https://github.com/ArturiaGit/mysql-mcp/commit/b80bab2f99a38f7a0aa02eeefb5da6bb8f029344))
  - 建立交接命令行工具链 `scripts/governance/handoff.mjs`，支持 `begin`, `finish`, `accept`, `reject`, `cancel`, `prompt`, `check`, `builds`, `record-delivery`。
  - 引入机械角色权限边界校验与交接自旋锁：Antigravity 主管规划、文档与 Git 提交，PI-Desktop 主管代码、构建与执行，严禁 PI 提交代码。
- **🔄 Changed**：
  - 增强 pre-commit 与 pre-push 钩子：必须验证完整交接链与角色授权一致性。

### 发版亮点摘要 (Highlights)
彻底解决了两个不同 AI 工具在同一仓库协作时的越权与混乱问题，实现了“文档归 Antigravity、代码归 PI、用户人工审查转交、Git 钩子机械拦截”的坚固协作闭环。

---

## 🛠️ Agent 工程上下文与架构演进

### 1. 架构与设计决策 (Why & Design)
- 痛点：Antigravity 擅长上层规划、文档规范与 Git 交付，而 PI-Desktop 运行在宿主独立应用环境，擅长技术实现与构建。两者之间无直接通信通道。
- 方案：通过 `governance/collaboration.json` 固化各方职责文件边界；通过 `governance/handoffs/<TASK-ID>.json` 维护不可伪造的事件链（基于 SHA256 摘要与版本清单绑定）；由用户人工在两端复制确定的结构化 Prompt；在交付阶段使用 `record-delivery` 对接真实 GitHub PR/CI。

### 2. 实际改动文件与逻辑清单 (What)
- 新增 `governance/collaboration.json`、`scripts/governance/handoff.mjs`、`lib/collaboration.mjs`、`lib/evidence.mjs`。
- 修改 `scripts/governance/check.mjs`、`validate.mjs`、`report.mjs`。
- 修改 `.githooks/` 挂钩以集成交接校验。
- 新增 `tests/governance/collaboration.test.mjs`、`collaboration-git.test.mjs`。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **Windows CRLF 换行陷阱**：在 Windows 环境下，Git 或编辑器容易把文件换行转为 CRLF，导致内容 SHA256 摘要计算偏差！必须确保所有治理脚本、文本文件统一使用 LF 换行，并在 `core.mjs` 中进行 LF 规范化。
- **阶段跳转严格性**：
  - 代码任务：`planning → implementation → documentation_delivery`；
  - 文档任务：`planning → documentation_delivery`；
  - 严禁越阶段操作，严禁在未 accept 上一阶段输出前直接 begin 下一阶段！
- **Git 提交限制**：Git 提交必须在环境带 `GOV_ROLE=antigravity`，且必须与 `documentation_delivery` 生成的候选一致。

### 4. 验证证据 (Verification)
- 48 个治理测试与协作 Git 流程测试全部通过，PR #4 CI 独立运行通过（run 36979843555）。
