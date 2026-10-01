# PR #1 合并后 CI 环境隔离修复

## 已执行合并

用户明确要求合并 PR #1。合并前核实 head=4900c06、governance 成功、MERGEABLE/CLEAN；正常 Squash Merge，未绕过保护。合并提交 689f9ef01f06f248b62764fe97d0b0fa4171fec3，原任务分支保留，本地 main 已快进同步。

## 合并后失败与原因

[main run 36894151353](https://github.com/ArturiaGit/mysql-mcp/actions/runs/36894151353) 失败。实际下载产物定位到测试“main CI selects completed delta task despite unrelated active branches; no push permission”：测试子进程继承 GITHUB_ACTIONS/GITHUB_EVENT_NAME/GITHUB_REF，污染本应非 CI 的负面场景。没有把合并成功写成所有检查通过。

## 修复与验证

新分支 fix/governance-ci-context，任务 TASK-GOV-002，复用功能 G01，新增回归标准 G01-A3。执行器及测试夹具清理继承的 GITHUB_ 变量；真正 CI 执行器的上下文不变，显式模拟 CI 仍可测试。原失败测试保留，新增环境隔离用例，不降低标准。

实际执行：
- 模拟 GITHUB_ACTIONS=true、GITHUB_EVENT_NAME=push、GITHUB_REF=refs/heads/main 运行完整 node:test：55 通过、0 失败/跳过/取消。
- node scripts/governance/check.mjs：TASK-GOV-002 通过。
- node scripts/governance/run.mjs：快照运行通过，acceptance 保持 unverified。

修复通过任务分支和 PR 单独交付，未经明确确认不合并 PR #2。原 main 失败历史保留，业务功能状态不变。本地通过不替代修复后 main 的独立 CI，需要合并后核实。
