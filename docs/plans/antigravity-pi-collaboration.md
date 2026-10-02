# Antigravity × PI-Desktop 协作门禁

状态：in_progress；TASK-GOV-004，G01/G02/G03；需求 R15/R16/R17。
授权：用户批准协作实施计划及本次 PI-Desktop 限定引导例外。分支 `chore/antigravity-pi-handoff`，基线 `ed631a2201e6b439bc79ca6d241176db68ddad82`。

## 范围

Antigravity 规划、文档、登记与 Git 交付；PI-Desktop 开发、测试、构建与编译。双方完成阶段均生成 prompt，由用户转交。无自动通信、无工具身份认证。只修改协作治理及相关规范；不实现 MySQL，不安装应用依赖、不连接数据库或修改客户端。

本次 PI 可更新 collaboration.json 的 bootstrap.documentation_paths 清单中的规范/登记。例外只能用于本任务的 bootstrap 阶段；不能提交、push、PR，不迁移到后续任务。历史任务/失败保留，不伪造过去的交接。

## 预先登记的可观察验收

- G03-A1：合法规划→开发→文档交付、返工、文档-only、本次 bootstrap 均可运行；角色、阶段、接收摘要、任务/功能/标准/分支/基线错误和越界（含删除/重命名）被拒绝。
- G03-A2：记录包含完整目标、实际结果、文件摘要、真实检查与原始 TAP、构建/编译或明确不适用理由、文档请求、限制/阻塞、下一步和禁止动作；双向 prompt 确定性渲染，无空模板/占位符。生成不等于转交/接收；拒绝/取消保留。
- G03-A3：暂存、commit-msg、实际推送对象和 PR/main 精确 base/head 校验完整交接；旧证据、改写交接、漏报文件、计划漂移、失败/跳过/零测试/超时、缺角色/PI 提交均拒绝。独立 CI 重跑，不把本地报告当验收。
- G03-A4：真实 Antigravity 接收、提交/push/PR/CI 后回传下一步 prompt；用户审查门禁与决定合并。此项须后续实际交付，不由 PI 模拟宣布完成。
- 保留原 58 项治理回归，不删除失败标准或弱化门禁。

## 验证与停止点

Node 语法、内置测试、governance check/run/report、派生状态、Markdown 链接/围栏及 diff 检查；scratch 合成仓库触发真实 Hook/提交/推送与 squash main 上下文。真实仓库不由 PI commit/push/PR。

完成 PI 阶段后输出给 Antigravity 的可复制 prompt，等待用户转交。实际结果见 [验证记录](../verification/antigravity-pi-collaboration.md)。本轮无应用 package.json，应用构建/编译不适用；`.mjs` 语法与执行测试不称为 MySQL 应用构建成功。
