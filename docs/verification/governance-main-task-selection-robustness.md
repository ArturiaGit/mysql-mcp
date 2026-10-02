# PR #5 合并后 main 任务选择鲁棒性与元数据回填修复

用户授权 Squash Merge PR #5；合并提交 d3d4e2d999e23a75cdfb05328eee383cb5cc2e15。未绕过保护，未删除分支或发布；本地 main 同步。

PR #5 合并触发的 post-merge push CI 在任务检查阶段失败：`main delta must identify exactly one associated task; ambiguous/multi-task merge requires explicit split review`。
根因分析：在 PR #5 中回填了历史任务 TASK-GOV-004 的 `pr: 4` 元数据，同时新增了本次交付任务 TASK-GOV-005。原 `selectMainTask` 对所有任务全量比对变动（`changedTasks`），无条件要求变动任务总数为 1，未将变动判定限制在匹配本次文件变更的候选任务集内，导致合法元数据维护与活动任务产生假性多任务歧义。

TASK-GOV-006、fix/governance-main-task-selection-robustness 引用原 G01 并增加 G01-A5：
1. 提取变动任务中与当前改动文件匹配的候选集 `changedCandidates = changedTasks.filter(t => candidates.some(c => c.id === t.id))`，要求 `changedCandidates.length === 1`。
2. 对非候选任务发生变动的情况实施严格白名单保护：必须为历史已存在任务且仅允许变更 `pr` 字段；若变动安全字段（`allowed_paths`、`base_commit`、`authorization`、`status`、`feature_ids` 等）或引入新增非候选任务，坚决拒绝。

执行验证：
- 真实命令：`node --test --test-reporter=tap tests/governance/governance.test.mjs`（68 项通过，无失败/跳过/取消）；`node --test --test-reporter=tap tests/governance/collaboration.test.mjs tests/governance/collaboration-git.test.mjs`（73 项通过，无失败/跳过/取消）；全量 141 项测试全部通过。
- 修复前复现：在修复前代码下，历史任务回填 PR 同时新增任务时抛出歧义错误；修复后该用例成功通过，且 PR #5 真实增量（`d3d4e2d^..d3d4e2d`）只读重放准确选中 TASK-GOV-005。
- 门禁结构与范围检查 `node scripts/governance/check.mjs` 通过。
- 独立 CI 状态须后续在 GitHub Actions 核实，本地通过不代表远端 CI 自动通过；未经用户确认不自动合并 PR。

业务 F01–F28 不变。机器 acceptance 仍 unverified，不以此伪造完成或人工认证。
