# 验证证据索引

> 本目录只索引实际执行，不接受 AI 自述作为功能完成证明。详细规则见[验收规范](../ACCEPTANCE.md)。

## 1. 执行与保留

本地使用 `node scripts/governance/run.mjs` 生成机器报告和测试输出，输出目录 `.governance-evidence/` 被忽略，不上传本机原始日志。临时测试仓库放 scratch/系统临时目录。

GitHub Actions 在对应提交独立运行，上传报告及合成测试日志为 artifact。必须核对 run 的 head SHA、workflow、job conclusion、实际测试数和 artifact；不是看 PR 正文的“通过”。产物有保留期，过期需要重跑，不把不可访问链接继续标有效。

## 2. 当前入口

- [治理 PR #1](https://github.com/ArturiaGit/mysql-mcp/pull/1)：代码、讨论和检查入口，创建 PR 不等于验收完成。
- [Actions 执行列表](https://github.com/ArturiaGit/mysql-mcp/actions)：按目标提交定位实际运行。
- [功能状态](../FEATURE_STATUS.md)：结构化台账派生，不手动勾完成。

本轮实际执行见[首次治理记录](./governance-bootstrap.md)：保留失败与网络阻塞历史，并追加正常推送、独立 CI 54 项通过、main 保护 API 核实及用户验收确认。PR 仍未合并，业务功能不因此完成。

## 3. 证据边界

自动测试仅证明实际覆盖场景。本轮不执行 MySQL、真实客户端或页面验收。G01/G02 仍需用户审查和合并；F01–F28 未完成。共享 GitHub 账号不能证明独立真人审批，可信外部证据认证尚未建立时门禁默认拒绝完成升级。

不公开数据库凭据、真实地址、业务 SQL/数据、私人邮箱、本地审批快照或含这些内容的截图。测试故障注入必须用虚构内容。
