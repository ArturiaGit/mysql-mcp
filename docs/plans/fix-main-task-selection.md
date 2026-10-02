# 修复主干多任务识别歧义与元数据回填鲁棒性实施计划

状态：in_progress
需求来源：R16，关联特性：G01
授权范围：优化 selectMainTask 在 candidates 内判定变动任务，支持历史任务元数据安全回填，增加单元回归测试
明确排除：非治理相关的应用代码、放宽越界修改门禁
任务分支：fix/governance-main-task-selection-robustness
main 基线提交：d3d4e2d999e23a75cdfb05328eee383cb5cc2e15

## 目标与现状

### 事实
- PR #5 合并进入 main 后，主干 push CI 报错失败：`main delta must identify exactly one associated task; ambiguous/multi-task merge requires explicit split review`。
- 根因分析：在 PR #5 中同时回填了历史任务 TASK-GOV-004 的 PR 号并新增了 TASK-GOV-005。`selectMainTask` 原逻辑无条件要求全表 `changedTasks.length === 1`，未在匹配当前变更文件范围的候选任务集（`candidates`）中筛选，导致历史元数据维护与活动任务交付产生假性冲突。

### 提案
1. 优化 `selectMainTask`：
   - 提取在 `candidates` 中的变动任务 `changedCandidates = changedTasks.filter(t => candidates.some(c => c.id === t.id))`。
   - 当变动任务发生时，要求 `changedCandidates` 必须精确为 1（即真正承担本次文件交付的合法候选任务唯一）。
   - 对不在 `candidates` 中的历史变动任务，增加防御校验：必须是历史已存在任务且仅允许修改只读元数据（`pr` 字段），禁止改动 `allowed_paths`, `base_commit`, `authorization` 等安全字段；若存在越界改动则严格拒绝。
2. 在 `tests/governance/governance.test.mjs` 中增加回归用例：验证历史任务回填 pr 字段同时新增任务时，main 检测器能准确识别新任务并不报错；若历史任务偷改安全字段依然坚决拒绝。

## 文件与行为

- `docs/plans/fix-main-task-selection.md`：本修复计划台账。
- `governance/features.json`：G01 增加 G01-A5 验收标准。
- `governance/checks.json`：更新 governance-tests 映射。
- `governance/tasks.json`：登记 TASK-GOV-006，授权范围包含 `governance/` 以容纳交接记录与元数据配置。
- `scripts/governance/lib/scope.mjs`：优化 `selectMainTask`。
- `tests/governance/governance.test.mjs`：增加回归测试。
- `docs/FEATURE_STATUS.md`：派生状态同步。
- `docs/verification/governance-main-task-selection-robustness.md`：验证记录。

## 验收

- `tests/governance/governance.test.mjs` 新增回归测试通过。
- `node scripts/governance/run.mjs` 全量通过。
- GitHub Actions CI 在 PR 与 main 分支全量通过。
