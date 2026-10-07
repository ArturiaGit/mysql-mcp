# [TASK-GOV-010] 全栈分工机械门禁落地与前后端物理隔离强校验

- 变更日期：2026-10-07
- 关联任务：TASK-GOV-010
- 关联 PR：[#13](https://github.com/ArturiaGit/mysql-mcp/pull/13)（待提交创建）
- 关联 Commit：待提交
- 责任执行方：Antigravity (Planning & Documentation Delivery) × PI-Desktop (Implementation)
- 关联功能/需求：G02, G03 / R17

---

## 📢 发版说明（Release Notes / 面向用户与下游）

### 变更分类与追溯条目
- **🚀 Added**：
  - 在 `scripts/governance/lib/collaboration.mjs` 正式支持 `mode: "frontend"` 前端任务协作模式（状态机流转为 `planning (Antigravity) → implementation (Antigravity) → documentation_delivery (Antigravity)`，返工为 `rework (Antigravity)`）by @PI-Desktop
  - 在 `collaboration.mjs` 落地前端物理路径与后端物理路径的机械互斥判定：`mysql-mcp/web/` 与 `mysql-mcp/tests/web/` 仅允许由 Antigravity 在前端开发阶段修改，PI-Desktop 具备零写入权限；`mysql-mcp/src/` 及后端单测文件由 PI-Desktop 管辖，Antigravity 具备零写入权限 by @PI-Desktop
  - 在 `scripts/governance/handoff.mjs` 中支持 `builds` 命令接收活动前端开发者角色（`--role antigravity`），并支持 CI 前端失败直接路由至 Antigravity rework，绝不交给 PI 修 UI by @PI-Desktop
  - 在 `tests/governance/collaboration.test.mjs` 新增 33 项全栈分工机械门禁与 frontend 模式回归测试套件，协作门禁测试套件扩充至 113 项全绿通过 by @PI-Desktop
- **🔒 Security**：
  - 物理目录内 Markdown 强绑定领域边界：位于 `mysql-mcp/src/` 或 `mysql-mcp/web/` 内部的 Markdown 文件严格归属于各物理领域所有者，根目录 `*.md` 规则不得跨领域穿透授权；
  - 前端开发快照摘要强制绑定 `web/` 与 `tests/web/`，防止旧证据复用与交付候选漂移；
  - 即使前端模式下 implementation / rework 与 planning / delivery 均为 Antigravity 同角色，各阶段流转依然必须执行显式 `accept` 与 `begin` 命令，严禁隐式越过交接链。
- **🔄 Changed**：
  - 在 `governance/collaboration.json` 落地无前缀重叠的角色路径拆分策略：Antigravity 管辖 `mysql-mcp/web/` 与 `mysql-mcp/tests/web/`，PI-Desktop 管辖 `mysql-mcp/src/`、`mysql-mcp/scripts/` 及后端五项单测单文件，彻底消除 `mysql-mcp/tests/` 前缀重叠引发的策略冲突 by @Antigravity
  - 同步更新 `docs/COLLABORATION_WORKFLOW.md` 与 `docs/FULLSTACK_DIVISION_SPECIFICATION.md`，确立全栈分工机械门禁细节与后端单测单文件扩展机制 by @Antigravity

### 发版亮点摘要 (Highlights)
完整落地了《全栈分工与前后端物理隔离协作规范》的机械化门禁：不仅在规约上明确分工，更在 `collaboration.mjs` 与自动化测试中构筑了坚固的机械防线。前后端物理路径 100% 互斥强校验，新增 `mode: "frontend"` 独立状态机，并在两轮严谨协作中验证了生产策略权限防御的有效性。协作测试新增 33 项回归，总计 113 项治理协作与 190 项应用测试全部通过。

---

## 🛠️ Agent 工程上下文与架构演进（面向开发者与后续 Agent）

### 1. 架构与设计决策 (Why & Design)
- **为什么需要机械门禁落地？**：在 `TASK-GOV-009` 中虽然制定了全栈分工规范，但底层的 `collaboration.mjs` 仅支持 `mode: "code"` 与 `mode: "docs"`，缺少对 `mode: "frontend"` 的识别；且 `collaboration.json` 角色路径尚未拆分，无法在执行时阻断越权。必须在代码层面将规约固化为不可逾越的机械防线。
- **消除前缀重叠设计（Overlapping Prefix Elimination）**：最初设计中 PI-Desktop 管辖 `mysql-mcp/tests/`，而 Antigravity 管辖 `mysql-mcp/tests/web/`。由于 `collaboration.mjs` 强制要求各角色路径非重叠（`overlapping role paths` 断言拦截），总目录前缀与子目录前缀会触发断言失败。因此，我们将后端测试以现有单测文件单列（`smoke`、`keyring`、`sql-policy`、`mcp`、`server`），未来新增后端单测通过 planning 显式单列追加，彻底消除了前缀重叠隐患。
- **两轮协作与严谨阻断（E5 策略权限防御）**：在首轮实施中，PI-Desktop 发现修改生产策略 `governance/collaboration.json` 属于 Antigravity 专职权限。PI 严守防线，拒绝利用 implementation 特权破门篡改策略，而是以 `result: blocked` 回退至 Planning，由 Antigravity 在第二轮 Planning 正式修改生产策略后再次交接给 PI 复验。这充分证明了双 Agent 角色边界与责任链的机械有效性。

### 2. 实际改动文件与逻辑清单 (What)
- `scripts/governance/lib/collaboration.mjs`：支持 `mode: "frontend"`、映射前端 implementation / rework 角色、增加物理路径互斥与阶段校验、增加开发摘要前端资产绑定；
- `scripts/governance/handoff.mjs`：支持前端开发角色执行 `builds`，CI 失败定向路由；
- `governance/collaboration.json`：正式落地非重叠角色所有权拆分；
- `tests/governance/collaboration.test.mjs`：新增 33 项全栈分工、frontend 模式与越权负面测试回归；
- `tests/governance/collaboration-fixture.mjs`：适配非重叠策略，测试直接继承生产配置；
- `docs/COLLABORATION_WORKFLOW.md`、`docs/FULLSTACK_DIVISION_SPECIFICATION.md`：同步机械门禁与状态机映射规约；
- `docs/verification/enforce-fullstack-division-gates.md`：记录本任务真实执行过程与历史阻断细节。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **角色路径绝对非重叠**：任何时候在 `governance/collaboration.json` 中配置角色路径时，绝对不能出现一个角色的路径是另一个角色路径前缀的情况（例如 `foo/` 与 `foo/bar/` 分属两端）。如有子目录拆分需求，父级必须单列具体文件或子目录。
- **前端模式同角色交接不可隐式跳过**：在 `mode: "frontend"` 任务中，虽然 planning、implementation、documentation_delivery 均由 Antigravity 担当，但在阶段流转时**必须依次执行 `accept` 与 `begin`**，交接链与摘要校验机制完全相同，严禁试图合并阶段或跨阶段操作。
- **contractHash 计划与基线冻结**：在 `documentation_delivery` 阶段，绝对不能修改在 planning 阶段已冻结的任务计划（`plan_path`）、验收标准（`ACCEPTANCE.md`）、策略文件（`collaboration.json`）或任务定义。任何此类修改都会改变 `contractHash`，导致 `plan/code drift` 交付拦截。
- **Windows CRLF 差异检验**：运行 Git 校验时保持 `$env:GIT_CONFIG_COUNT="1"; $env:GIT_CONFIG_KEY_0="core.autocrlf"; $env:GIT_CONFIG_VALUE_0="true";`。

### 4. 验证证据 (Verification)
- `node scripts/governance/run.mjs`：通过 `governance-tests` 89/89，通过 `collaboration-tests` 113/113，通过 `app-build` 190/190，通过 `app-compile` exit 0；
- `node scripts/governance/check.mjs`：通过，无范围越界与快照漂移。
