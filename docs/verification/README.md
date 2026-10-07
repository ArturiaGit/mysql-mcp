# 验证证据索引

> 本目录只索引实际执行，不接受 AI 自述作为功能完成证明。详细规则见[验收规范](../ACCEPTANCE.md)。

## 1. 执行与保留

本地使用 `node scripts/governance/run.mjs` 生成机器报告和测试输出，输出目录 `.governance-evidence/` 被忽略，不上传本机原始日志。临时测试仓库放 scratch/系统临时目录。implementation/rework/bootstrap 的 ready 交接读取真实 run.json，经现有输出校验后嵌入报告及原始 TAP 副本供诊断；本机路径不入库。嵌入本地证据仍不是独立验收，CI 在实际提交独立重跑。

GitHub Actions 在对应提交独立运行，上传报告及合成测试日志为 artifact。必须核对 run 的 head SHA、workflow、job conclusion、实际测试数和 artifact；不是看 PR 正文的“通过”。产物有保留期，过期需要重跑，不把不可访问链接继续标有效。

## 2. 当前入口

- [治理 PR #1](https://github.com/ArturiaGit/mysql-mcp/pull/1)：代码、讨论和检查入口，创建 PR 不等于验收完成。
- [Actions 执行列表](https://github.com/ArturiaGit/mysql-mcp/actions)：按目标提交定位实际运行。
- [功能状态](../FEATURE_STATUS.md)：结构化台账派生，不手动勾完成。
- [协作交接规则](../COLLABORATION_WORKFLOW.md)：角色、手动转交、命令/details、限定 bootstrap 和信任限制。
- [TASK-GOV-004 协作验证记录](./antigravity-pi-collaboration.md)：仅列实际执行、失败/未执行与限制；真实 Antigravity 接受、commit/push/PR、独立 CI 和用户验收未取得前不能预填成功。
- [TASK-GOV-006 主干任务选择鲁棒性验证记录](./governance-main-task-selection-robustness.md)：记录 selectMainTask 候选任务集判定、只读元数据回填白名单、141 项测试通过及 PR #5 增量重放。
- [TASK-GOV-010 全栈分工机械门禁验证记录](./enforce-fullstack-division-gates.md)：记录非重叠路径所有权拆分、mode: frontend 状态机支持、E5 策略权限阻断与 E8 规划解除、113 项协作测试与 190 项应用测试全通过。
- [TASK-APP-004 前端管理控制台与连接管理交互验证记录](./web-connection-management.md)：记录 mode: frontend 模式落地、mysql-mcp/web/ 单页管理应用（HTML/CSS/JS）、高熵码登录/CSRF 驱动、连接列表与表单 CRUD、留空保持密码、安全删除与连接测试模拟，前端 4 项测试通过，全量测试达 392 项。

历史[首次治理记录](./governance-bootstrap.md)保留失败与网络阻塞，并记载当时正常推送、独立 CI 54 项通过、main 保护 API 核实及用户验收确认，以及当时 PR 未合并状态；这些是历史证据语境，不用于推断 TASK-GOV-004 或当前版本已通过。历史状态本次不无依据改完成，业务功能不因此完成。

## 3. 证据边界

自动测试仅证明实际覆盖场景。本次协作任务不执行 MySQL、真实客户端或页面验收；无应用 package/构建工程，不声称 MySQL 编译通过。G01/G02/G03 的验收/交付分别依机器台账与真实证据推导，不由本索引写完成；F01–F28 未完成。共享 GitHub 账号、--role 或 GOV_ROLE 不能证明独立真人审批或已人工转交，也不能强制抵御同机恶意改写；可信外部证据认证尚未建立时门禁默认拒绝完成升级。

不公开数据库凭据、真实地址、业务 SQL/数据、私人邮箱、本地审批快照或含这些内容的截图。测试故障注入必须用虚构内容。

本次 bootstrap 仅 TASK-GOV-004、chore/antigravity-pi-handoff、base ed631a2201e6b439bc79ca6d241176db68ddad82；PI 可启动并改明确限定文档/台账，不执行本仓库 commit/push/PR。用户人工转交 prompt 后 Antigravity 显式核验接受，真实 Git/gh 结果由 record-delivery 核实记录后回传。CI 未配置、未运行、等待中、失败、通过分别报告，不把本地检查或命令契约称独立 CI。
