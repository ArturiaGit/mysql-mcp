# 首次治理门禁执行记录

## 范围与版本

任务 TASK-GOV-001，功能 G01/G02，分支 docs/agent-git-workflow，PR #1。治理实现提交 `98ada56df44a57c502400c4ea9831bc75289dc99`；工作流修复提交 `da0ed50`。这些是实现/执行记录，不是用户验收证明。

## 已实际执行

| 检查 | 结果 |
|---|---|
| 初始门禁 node:test | 45 通过、0 失败/跳过 |
| 一次有边界复核后的回归 node:test | 54 通过、0 失败/跳过/取消 |
| node scripts/governance/check.mjs | TASK-GOV-001 结构/范围通过，验收保持 unverified |
| node scripts/governance/run.mjs | 在 Git 快照中实际运行登记检查，通过 |
| node scripts/governance/report.mjs --run .governance-evidence/run.json | 报告、输入摘要、原始 TAP 和产物匹配；只认可本地诊断 |
| node scripts/governance/install-hooks.mjs | 仓库级 core.hooksPath=.githooks，未更改全局配置 |
| git commit / git push | 98ada56 提交及推送经过 Hook；da0ed50 提交经过 Hook |
| git diff --cached --check | 通过 |
| 原始记忆及 4 份计划 SHA-256 | 均未改变，仍未跟踪/上传 |

测试覆盖缺覆盖、重复 ID/key/任务、依赖成环、范围越界、伪完成、缺文件、错误路径、未声明治理变更、标准删除、非零退出、超时、零测试/跳过、过期/篡改产物、暂存与工作区不一致、实际推送对象与分支、基线推进及功能归属。具体用例以 tests/governance/governance.test.mjs 为准。

复核发现并修复：任务基线可推进以隐藏改动、路径范围未检查功能归属、合并后 CI 错误假设唯一活动任务、报告未强制要求原始 TAP。相关回归已纳入 54 项测试。

## 远程执行与未通过项

首次 [Actions run 36821755161](https://github.com/ArturiaGit/mysql-mcp/actions/runs/36821755161) 对应 98ada56，conclusion=failure、jobs=0：工作流 job 级 env 使用 runner.temp 导致未启动测试；没有测试日志，不能称为远程测试通过。

修复 da0ed50 已将 runner.temp 移到 step env，通过本地提交 Hook；后续向同一 origin 推送连续遇到 Connection reset / github.com:443 连接失败。GitHub API 可用不等于 Git push 可用。未使用 API 造提交或其他方式绕过推送 Hook。

截至本记录：修复待成功推送和 CI 重跑；main 保护尚未配置，须在真实 governance 检查出现后绑定并核实。不能宣称远程强制已落实或 CI 全绿。后续恢复后应追加真实 run/job/artifact 与保护 API 结果，不覆写失败历史。

## 功能状态与限制

- F01–F28：未开始，无业务代码或实机验证；全部未验收、未完成。
- G01：门禁已有实现，本地自动验证通过；远程 CI 修复待推送，远程保护未落实，人工验收未完成。
- G02：规范/Git 基线已有产物，PR 仍等待用户审查合并。
- 外部 CI/人工/客户端/MySQL 证据认证器尚未建立，脚本对最终完成升级默认拒绝，不接受手写 passed。
- 本地 Hook 可被管理者绕过；脚本、工作流或授权记录本身不构成独立真人证明。不得以本记录代替用户批准。

## 网络恢复、远程验证与用户确认（追加）

之后定位到浏览器使用 Windows 系统代理而 Git 默认直连失败。仅对单次 Git 命令使用现有系统代理后，正常推送成功，未修改持久代理配置、未绕过 Hook，远程更新至 dff25aa1f3e4aa5c87e6472b329f9ebe069ff16c。上文待推送和 CI 未通过为当时历史状态，现已解除。

[Actions run 36834728611](https://github.com/ArturiaGit/mysql-mcp/actions/runs/36834728611) 的 governance job 成功；实际下载 artifact 11147719225（governance-evidence-36834728611-1）核对 source_commit=dff25aa、exit_code=0、54 tests/pass、0 fail/skipped/cancelled/todo。产物到期时间为 2026-10-15T08:11:12Z；过期后需重跑。机器报告仍保留 acceptance=unverified，不自行批准。

随后应用并读取 GitHub main protection API，核实 protected=true、required_status_checks.strict=true、必需 governance（GitHub Actions app_id=15368）、PR 必需、enforce_admins=true、allow_force_pushes=false、allow_deletions=false、会话讨论需解决。required_approving_review_count=0，不宣称已有独立 reviewer；用户确认合并仍是 Agent 行为约束，共享管理账号仍可修改保护。

用户在本次会话明确表示“验收通过”，记录为对本次治理交付的用户确认，不是 Agent 独立验收或对 F01–F28 业务功能的确认。该结论不替代可信外部验收认证器，也不构成 PR 合并/发布授权；PR #1 仍等待明确合并指令。

当前网络、远程 CI 和 main 保护部署阻塞已解除；治理有本地与独立 CI 执行证据，用户确认已记录。自动状态认证与最终交付仍受现有安全限制，不将功能表手工改为 completed。
