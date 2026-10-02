# 双 Agent 协作门禁执行证据索引

任务 TASK-GOV-004；功能 G01/G02/G03；分支 `chore/antigravity-pi-handoff`；基线 `ed631a2201e6b439bc79ca6d241176db68ddad82`。实施范围见[计划](../plans/antigravity-pi-collaboration.md)，操作见[协作规范](../COLLABORATION_WORKFLOW.md)。

## 执行记录与可复核来源

最终完整检查以 `governance/handoffs/TASK-GOV-004.json` 的结束事件为准：包含 source HEAD、开发摘要、检查定义、命令、退出码、真实统计及原始 TAP/stderr 副本和产物摘要。当前活动阶段或结束结果可用 `node scripts/governance/handoff.mjs check --task TASK-GOV-004` 检查；prompt 必须由该事件确定性渲染。记录是本地诊断，不是独立验收证明。

完整执行使用 `node scripts/governance/check.mjs`、`node scripts/governance/run.mjs`、`node scripts/governance/report.mjs --check` 及 `--run .governance-evidence/run.json`；结束交接改变完整输入后不能继续称原完整报告为当前输入，嵌入报告仍按开发快照校验。Antigravity 接收/文档收尾后须重新 run 并核对原始输出。

语法检查覆盖治理和测试 `.mjs`；文档检查覆盖相对链接、围栏、模板 JSON 与导航；执行 `git diff --check`。未运行不存在的 npm 脚本。

## 保留本轮失败与修复历史

- 原治理套件在初轮修改后实际执行 58/58 通过，不删除既有回归。
- 协作烟雾首轮因测试放在未分类 `tests/` 顶层被拒绝；改夹具为授权的 `tests/governance/`，不放宽正式策略，正常双向交接与真实 Hook 烟雾 2/2 通过。
- 协作首轮完整测试 60 项：58 通过、2 失败。两个负例已被拒绝，但错误匹配未命中：无效台账先被 schema 拒绝、改写收据未同步引用先被链拒绝。改为结构合法越权和引用完整的历史改写；相关定向回归 4/4 通过。
- 一次只读复核发现取消候选未撤销、快照遗漏 executable mode、计划路径存在性缺失；修复并新增回归，定向 6/6 通过。不将 Agent 复核称为独立真人审批。
- 增补任务授权冻结/重新规划、交付后 CI 失败接收返工、PR 补记不改变代码授权、未来构建实际执行等回归。为避免 Windows 隔离 Git 操作长时间串行，测试拆成阶段/证据和 Git 交付两个文件，由同一 collaboration-tests 全部运行；未删除或跳过用例。
- 本任务的最初 bootstrap E1 在 executable mode 加入前记录了内容摘要。保留其原事件和摘要不改写；验证器只对准确 TASK-GOV-004 的这一 Git 基线验证并推导 mode，其后所有事件和新任务均使用内容+mode。此兼容不允许缺失模式的其他任务/基线。
- 在 documentation_delivery 阶段重新执行 `node scripts/governance/run.mjs` 时，`governance-tests` 58/58 通过（约 96 秒），但 `collaboration-tests`（包含 `collaboration.test.mjs` 和 `collaboration-git.test.mjs` 共 72 项测试）在当前 Windows 环境下执行耗时超过预设的 300000ms（5分钟）硬超时限制，导致被 `SIGKILL` 终止（单独运行 `collaboration.test.mjs` 59 项测试耗时达 316.8 秒）。
- 按照职责与安全规范，Antigravity 不自行修改源码、测试实现或擅自放大门禁，将具体超时阻塞判定为 blocked（E5）明确交回 PI-Desktop rework。
- PI-Desktop 显式接受 E5（E6），启动返工 rework（E7）。将共享夹具优化为按进程创建一次只读合成 Git 基线并完整独立复制，新增隔离性回归（用例增至 73 项）。正式 run 中 governance-tests 58/58（76.468 秒），collaboration-tests 73/73（217.483 秒），在 300000ms 限额内全部通过。PI 完成返工并生成 E8。

## 验证覆盖与限制

隔离合成仓库实际触发 pre-commit、commit-msg、pre-push、合法/非法提交与本地 bare 推送；验证 staged/ref/OID/message、拒绝/取消候选、模式差异、PR 精确 base/head 和 squash main 上下文。合成 PR/CI 元信息只测试本地状态机，不冒称已访问真实 PR/CI。

本次已有 hooksPath=.githooks，新增 Hook 在后续 Antigravity 暂存/交付时保留 mode 并核实安装。真实仓库的 commit/push/PR、Antigravity 实际接收和独立 CI/合并后 CI 均由用户转交后的交付阶段完成，PI 不提前声称通过；PR 当前未创建，不猜号，不伪造下一端已接受。真实 gh 核验命令只有在 record-delivery 阶段才执行。

MySQL 应用尚未实现，无应用 package.json，应用构建/编译不适用。模拟构建执行不证明真实 MySQL、客户端接入、页面、数据库写入或人工验收。G03-A4 等真人/交付证据未满足前保持未验收；功能派生状态不手改完成。

## Antigravity 接收与文档交付进展

- Antigravity 核验工作区状态、基线 `ed631a2201e6b439bc79ca6d241176db68ddad82`、分支 `chore/antigravity-pi-handoff` 与 `origin` 引用。
- 显式核验接受 PI-Desktop 交接事件 `TASK-GOV-004-E2`（E3），启动首轮 `documentation_delivery`（E4），发现超时并生成 `blocked` 返工交接 `TASK-GOV-004-E5`。
- PI-Desktop 返工完成后，Antigravity 显式核验接受 `TASK-GOV-004-E8`（摘要 `020d22d76bf33409370017748005aa4ff8a076293d09c53482f041f6d771f882`），生成收据 `TASK-GOV-004-E9`。
- 重新启动 `documentation_delivery` 阶段（`TASK-GOV-004-E10`），同步验证文档并复核治理套件与协作测试。
- 交付与真实 commit、push、PR 及 CI 状态核实由 Antigravity 随后续交付操作执行，并由 `record-delivery` 记录；在用户审查与确认合并前，G03-A4 及任务最终验收保持未验收。

