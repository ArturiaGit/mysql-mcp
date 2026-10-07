# 全栈分工机械门禁落地实施计划

> 状态：in_progress  
> 任务编号：TASK-GOV-010  
> 关联功能：G02 (规范与 Git 交付基线), G03 (双 Agent 人工转交与机械协作门禁)  
> 需求来源：R13, R15, R16, R17  
> 任务分支：`chore/enforce-fullstack-division-gates`  
> main 基线：`ed7cb8075671b382dce009edf1e99bbccfdb48e2`  
> 执行模式：`mode: "code"`（Antigravity 规划/交付 × PI-Desktop 实施治理技术实现与测试）  

---

## 1. 目标与背景

在 PR #11 中，项目正式确立并合入了 [《全栈分工与前后端物理隔离协作规范》](../FULLSTACK_DIVISION_SPECIFICATION.md)，并在其第 7 节详细设计了后续机械门禁演进策略。随着 Phase 2-A（PR #12，后端系统服务与测试）圆满收官，项目即将进入 Phase 2-B（前端管理控制台界面开发，由 Antigravity 专职负责 `mysql-mcp/web/`）。

然而，当前底层治理引擎 [`scripts/governance/lib/collaboration.mjs`](../../scripts/governance/lib/collaboration.mjs) 目前硬编码仅支持 `mode: "code"` 与 `mode: "docs"`，且 [`governance/collaboration.json`](../../governance/collaboration.json) 仍将整个 `mysql-mcp/` 根目录归属于 PI-Desktop。若直接启动前端任务，Antigravity 会被底层门禁阻断。

**本任务目标**：将《全栈分工规范》第 7 节的设计机械落地：
1. 演进 `governance/collaboration.json`，将 `mysql-mcp/` 细分为 `mysql-mcp/web/`（Antigravity 专职）与后端/构建路径（PI-Desktop 专职）；
2. 演进 `scripts/governance/lib/collaboration.mjs`，增加对 `mode: "frontend"` 的支持，确立前端任务合法流转链（`planning (Antigravity) → implementation (Antigravity) → documentation_delivery (Antigravity)`）；
3. 严格落实双向禁止红线，确保路径所有权与模式合法性机械强校验；
4. 在 `tests/governance/collaboration.test.mjs` 增补完备正反测试，保持既有 169 项治理与协作测试全部绿灯通过。

---

## 2. 授权范围与绝对禁止事项

### 2.1 授权范围
- 任务允许路径：`AGENTS.md`、`docs/`、`governance/`、`scripts/governance/`、`tests/governance/`；
- 实施代码路径（PI-Desktop 专职实施）：
  - `governance/collaboration.json`：更新角色路径映射规则；
  - `scripts/governance/lib/collaboration.mjs`：支持 `mode: "frontend"` 与双向路径判定；
  - `tests/governance/collaboration.test.mjs`：编写前端模式与越界防御单测。

### 2.2 绝对禁止事项
1. PI-Desktop 严禁执行本仓库 `commit`、`push` 或 `gh pr create`，严禁修改前端界面代码资产；
2. 严禁破坏既有 `mode: "code"`（后端）与 `mode: "docs"`（纯文档）的流转逻辑与现有测试；
3. 严禁降低治理门禁的安全性，严禁允许未授权路径逃逸；
4. 严禁修改业务代码 `mysql-mcp/src/` 或连接外部数据库。

---

## 3. 具体实现方案设计

### 3.1 路径所有权拆分 (`governance/collaboration.json`)
按照《全栈分工规范》第 7 节拆分，并避免 `mysql-mcp/tests/` 与 `mysql-mcp/tests/web/` 跨角色前缀重叠：
```json
{
  "roles": {
    "antigravity": [
      "AGENTS.md",
      "docs/",
      "*.md",
      ".gitignore",
      "governance/features.json",
      "governance/tasks.json",
      "governance/checks.json",
      "governance/collaboration.json",
      "mysql-mcp/web/",
      "mysql-mcp/tests/web/"
    ],
    "pi-desktop": [
      "mysql-mcp/src/",
      "mysql-mcp/scripts/",
      "mysql-mcp/tests/smoke.test.mjs",
      "mysql-mcp/tests/keyring.test.mjs",
      "mysql-mcp/tests/sql-policy.test.mjs",
      "mysql-mcp/tests/mcp.test.mjs",
      "mysql-mcp/tests/server.test.mjs",
      "mysql-mcp/package.json",
      "mysql-mcp/package-lock.json",
      "mysql-mcp/tsconfig.json",
      "scripts/governance/",
      "tests/governance/",
      ".githooks/",
      ".github/workflows/"
    ]
  }
}
```
`mysql-mcp/web/`、`mysql-mcp/tests/web/` 与后端测试单文件完全非重叠，杜绝跨角色前缀重叠，满足 `collaboration.mjs` 中 `overlapping role paths` 的互斥断言。生产策略由 Antigravity 在 planning 中落地，PI-Desktop 在 implementation 中复验。

### 3.2 模式扩展 (`scripts/governance/lib/collaboration.mjs`)
1. **模式合法性**：
   - 允许模式扩展为 `['code', 'docs', 'frontend']`；
2. **阶段与角色映射**：
   - 当 `t.mode === 'frontend'` 时：
     - `planning` 阶段结束后，`expectedStart` / `legalNext` 产生的下一阶段为 `implementation`，其执行角色为 `antigravity`；
     - `implementation` 阶段结束后，下一阶段为 `documentation_delivery`，执行角色为 `antigravity`；
     - `permitted()` 中校验：在 `frontend` 模式的 `implementation` 阶段，允许修改 `mysql-mcp/web/`（归属于 antigravity），若修改 `mysql-mcp/src/` 或后端代码则立即拒绝；
3. **交付检查 (`detailsCheck`)**：
   - 在 `frontend` 模式下，允许通过 `documentation_delivery` 交付，且校验 commit message 符合 Conventional Commits 规范；
   - 适配前端模式的快照与证据绑定。

### 3.3 测试用例扩展 (`tests/governance/collaboration.test.mjs`)
1. **合法流转正例**：
   - 验证 `mode: "frontend"` 下 Antigravity 顺畅执行 `planning → implementation (修改 mysql-mcp/web/) → documentation_delivery`；
2. **越界反例**：
   - 验证 `mode: "frontend"` 下 Antigravity 试图修改 `mysql-mcp/src/` 被刚性阻断；
   - 验证 `mode: "code"` 下 PI-Desktop 试图修改 `mysql-mcp/web/` 被刚性阻断；
   - 验证既有 `docs` 与 `code` 模式不受任何回归影响。

---

## 4. 验证与验收门禁

```powershell
# 1. 运行治理与协作全量测试
node --test --test-reporter=tap tests/governance/governance.test.mjs tests/governance/collaboration.test.mjs tests/governance/collaboration-git.test.mjs

# 2. 隔离快照全量运行
$env:GIT_CONFIG_COUNT="1"; $env:GIT_CONFIG_KEY_0="core.autocrlf"; $env:GIT_CONFIG_VALUE_0="true"; node scripts/governance/run.mjs
```
- 预期指标：治理与协作测试通过，退出码 exit 0，无跳过或失败用例。
