# PR #2 合并后 main 任务选择修复

用户授权 Squash Merge PR #2；合并前 CLEAN、governance 成功，合并提交 c61f1579583c2a9b0399772d11bb74ad8a8b4834。未绕过保护，未删除分支或发布；本地 main 同步。

[main run 36896082770](https://github.com/ArturiaGit/mysql-mcp/actions/runs/36896082770) 在测试执行前失败：历史 TASK-GOV-001 与新 TASK-GOV-002 共用 G01 且允许范围重叠，选择器把两者均当作本次任务。保留失败记录，不将 PR 模式通过等同 main 通过。

TASK-GOV-003、fix/governance-main-task-selection 引用原 G01 并增加 G01-A4；优先识别本次 base/head 中新增或变化的任务，只有唯一且覆盖范围合法者可使用；没有任务字段变化时仍检查功能/文件关联；多个变化任务或新任务越界继续拒绝，不回退历史宽范围。

本地结构/范围和快照执行已通过：58 项测试、58 通过、0 fail/skipped/cancelled/todo，包含共享功能、多任务及越界负例。提交后需用准确 main 基线和修复 head 模拟 --ci-main，实际结果及独立 CI 见修复 PR；未经用户确认不自动合并 PR #3。

业务 F01–F28 不变。机器 acceptance 仍 unverified，不用此次修复伪造完成或人工认证。
