# Phase 3 元数据与交接链同步归档实施计划

状态：in_progress
需求来源：R15, R16, R17, R18
授权范围：docs/changes/ 状态同步、docs/ROADMAP.md 更新、docs/plans/ 索引补齐、TASK-APP-005 交付元数据与交接链归档至 main
明确排除：MySQL 业务代码、前端资产修改、生产数据库操作
任务分支：docs/sync-task-app-005-metadata
main 基线提交：bcf7866cd838109f14ffb7d03cf9e05654f03fbb

## 目标与现状

### 事实
- Phase 3（TASK-APP-005）受限读取与 MCP 工具协议骨架已顺利完成，并通过 PR #15 合并入 main 分支（commit `bcf7866cd838109f14ffb7d03cf9e05654f03fbb`）。
- 自动化测试套件共 307 项测试全部绿灯通过。
- 当前仓库处于 Phase 3 结束、准备开启 Phase 4 的交界点。
- 本地工作区存有 TASK-APP-005 的交付终态事件 E9 与接收事件 E10，但 PR #15 的交付元数据尚未在 main 的任务台账与变更日志中正式闭环。

### 提案（方案 A：两步走之第一步）
1. 在 `governance/tasks.json` 中回填 `TASK-APP-005` 的 `pr: 15` 元数据。
2. 将 `governance/handoffs/TASK-APP-005.json` 的终态交接记录（E9 交付事件与 E10 接收事件）正式提交纳入版本控制。
3. 更新 `docs/changes/README.md` 与 `docs/changes/2026-10-07-TASK-APP-005-mcp-read-and-tools.md`，将临时占位符替换为正式 PR 链接（`#15`）与 Commit 哈希（`bcf7866`）。
4. 撰写本次任务变更文档 `docs/changes/2026-10-08-TASK-GOV-011-sync-task-app-005-metadata.md` 并更新未发版列表。
5. 更新 `docs/ROADMAP.md` 与 `docs/plans/README.md`，记录 Phase 3 正式完成与 307 项全绿测试事实，为启动 Phase 4 奠定干净基线。

## 文件与行为

- `docs/plans/sync-task-app-005-metadata.md`：本任务实施计划。
- `governance/tasks.json`：登记 TASK-GOV-011，回填 TASK-APP-005 的 pr 元数据。
- `governance/features.json`：在 G01 与 G02 中关联 TASK-GOV-011。
- `governance/handoffs/TASK-APP-005.json`：纳入 E9/E10 交付事件。
- `docs/changes/README.md`：更新 TASK-APP-005 链接并追加 TASK-GOV-011 记录。
- `docs/changes/2026-10-07-TASK-APP-005-mcp-read-and-tools.md`：闭环 PR #15 与 Commit bcf7866 超链接。
- `docs/changes/2026-10-08-TASK-GOV-011-sync-task-app-005-metadata.md`：记录本次治理同步。
- `docs/ROADMAP.md`：更新 Phase 3 落地进展描述。
- `docs/plans/README.md`：追加第 20 节 TASK-GOV-011 索引。
- `AGENTS.md`：维护入口规范。
- `docs/FEATURE_STATUS.md`：由 report.mjs 脚本生成派生状态。
- `docs/verification/sync-task-app-005-metadata.md`：验证记录。

## 实施步骤

1. 登记任务 TASK-GOV-011，执行 Antigravity planning 阶段 begin 与 finish。
2. Antigravity 接收 planning 产物，执行 documentation_delivery 阶段 begin。
3. 同步变更文档、路线图、规划索引及台账元数据。
4. 执行治理检查脚本 `node scripts/governance/check.mjs` 与 `node scripts/governance/run.mjs`。
5. 完成 documentation_delivery 阶段 finish，执行 Git commit 与 push。
6. 创建 PR，等待 CI 完成并执行 record-delivery 闭环。

## 验收

- `node scripts/governance/check.mjs` 检查通过。
- `node scripts/governance/run.mjs` 治理与协作测试全量通过。
- `node mysql-mcp/scripts/compile.mjs` 编译无报错。
- `node mysql-mcp/scripts/build.mjs` 307 项应用测试全部通过。
- PR #16 创建并通过 GitHub Actions Governance CI。
