# [TASK-GOV-006] 优化主干任务选择鲁棒性并支持历史任务元数据安全回填

- 变更日期：2026-10-02
- 关联任务：TASK-GOV-006
- 关联 PR：待回填（Git 交付后由 record-delivery 与后续台账同步）
- 关联 Commit：待回填（Git 交付后由 record-delivery 与后续台账同步）
- 责任执行方：Antigravity (Planning / Documentation Delivery) × PI-Desktop (Implementation)
- 关联功能/需求：G01 (自动化门禁体系), R16

---

## 📢 发版说明（Release Notes / 面向用户与下游）

### 变更分类与追溯条目
- **🐛 Fixed**：
  - 修复主干 post-merge push CI 在回填历史任务 PR 元数据时误报多任务歧义的问题，限定主干增量识别在候选任务集内判定变动任务 by @Antigravity & @PI-Desktop
- **🔒 Security**：
  - 增加非候选任务白名单防御：仅允许历史任务修改已存在 PR 元数据，若企图修改 `allowed_paths`、`base_commit`、`authorization`、`status` 等安全属性或新增非候选任务，门禁坚决拒绝

### 发版亮点摘要 (Highlights)
主干 CI 在处理 PR 合并增量时，能智能区分真正负责代码变更的活动候选任务与仅补充历史 PR 链接的已归档任务，既消除了假性多任务冲突，又严格守护了任务安全边界。

---

## 🛠️ Agent 工程上下文与架构演进（面向开发者与后续 Agent）

### 1. 架构与设计决策 (Why & Design)
- **背景与根因**：PR #5 合并入 main 触发 push CI 时，由于在 `tasks.json` 中同时新增了 TASK-GOV-005 并顺手补全了 TASK-GOV-004 的 `pr: 4`，原 `selectMainTask` 检索全局所有发生字符变动的任务，要求变动数精确为 1，导致历史任务只读元数据维护与活动任务交付产生假性冲突并报错。
- **设计推导**：
  1. `changedCandidates` 判定：将真正承担当前文件变更交付的候选任务与变动任务取交集，要求 `changedCandidates.length === 1`。
  2. 历史非候选任务白名单：针对不在 `candidates` 中的变动任务，必须为历史已存在任务且剔除 `pr` 字段后定义完全一致；若变动任何安全属性或试图新增非候选任务，一律 fail closed。

### 2. 实际改动文件与逻辑清单 (What)
- `scripts/governance/lib/scope.mjs`：优化 `selectMainTask`，增加 `changedCandidates` 筛选与非候选任务安全属性防篡改校验。
- `tests/governance/governance.test.mjs`：增加 10 项正反测试用例，覆盖正常 PR 回填、偷改安全字段（`allowed_paths`、`base_commit`、`authorization`、`status`、`feature_ids` 等）、非法新增非候选任务及多候选任务冲突等场景。
- `governance/tasks.json`：登记 TASK-GOV-006，并将 `allowed_paths` 修正为包含 `"governance/"`，确保交接记录文件在授权合法范围内。
- `governance/checks.json` & `governance/features.json`：G01 扩充 G01-A5 验收标准与测试映射。
- `docs/plans/fix-main-task-selection.md`：记录实施计划与验收结果。
- `docs/verification/governance-main-task-selection-robustness.md`：记录 141 项测试通过证据与 PR #5 增量重放。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **踩坑记录 1（交接记录范围越界）**：
  治理任务若会生成 `governance/handoffs/<TASK-ID>.json`，其 `allowed_paths` 必须包含 `"governance/"`（或前缀包含交接目录）。若仅列出单文件而遗漏该目录，门禁的未跟踪文件检查（`validate.mjs`）会抛出 `out of task scope: governance/handoffs/<TASK-ID>.json`。
- **踩坑记录 2（任务授权变化时的规范处理）**：
  若任务在 implementation 阶段发现授权定义（`allowed_paths`、`authorization` 等）有误，绝不能直接手改 JSON 文件或篡改历史事件链。协作规范要求：当前阶段须以 `result: blocked` 提交 finish 并声明 `next_phase: planning`，由 Antigravity 接受并重新 begin planning，在规划阶段修正授权并生成新的有效交接（全新摘要与 contract），绝不可沿用旧摘要。

### 4. 验证证据 (Verification)
- 本地执行 `node --test --test-reporter=tap tests/governance/governance.test.mjs`（68 项全通）。
- 本地执行 `node --test --test-reporter=tap tests/governance/collaboration.test.mjs tests/governance/collaboration-git.test.mjs`（73 项全通）。
- 本地全量 141 项测试全部通过，无失败、无跳过。
- 门禁结构与范围检查 `node scripts/governance/check.mjs` 全部通过。
