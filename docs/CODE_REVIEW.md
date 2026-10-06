# 代码审查与质量规范

> 状态：Phase 1 应用工程脚手架与构建检查契约（F28）已在 `mysql-mcp/` 落地，`build.mjs` 与 `compile.mjs` 作为构建门禁（`task.build_checks`）在隔离快照中通过验证；业务服务与集成测试处于规划中。安全红线见[项目约束](./PROJECT_CONSTRAINTS.md)。

## 1. 分层规则

入口只做协议、认证、结构校验与响应映射；业务服务统一处理 SQL 策略、审批和目标绑定；基础设施负责 MySQL、文件和凭据。禁止 HTTP/MCP 各自复制 SQL 允许列表，禁止 UI 直接批准后绕过服务端状态机。

TypeScript strict 不能替代运行时校验。标识符不能通过值参数占位符处理，必须验证并正确引用；值采用驱动支持的安全参数方式。用户提交 SQL 仍需完整分类，不能将参数化当作任意 SQL 的安全许可。

## 2. 工程与检查命令契约

| 命令 | 执行入口 | 覆盖范围 | 当前状态 |
|---|---|---|---|
| `npm run typecheck` / `npm run compile` | `node scripts/compile.mjs` | 类型与模块边界（严格 NodeNext，`tsc --noEmit`，不落盘） | 已实现（Phase 1 / F28，作为 `app-compile` 门禁） |
| `npm test` / `npm run build` | `node scripts/build.mjs` | 清理 `dist/`，编译产物并执行全部 127 项应用测试（smoke 6项、keyring 5项、sql-policy 113项、mcp 3项） | 已实现（Phase 1-B / F06, F26, F28，作为 `app-build` 门禁） |
| `node scripts/governance/prepare.mjs` | `scripts/governance/prepare.mjs` | 治理快照与 CI 依赖准备契约（无 Shell，`npm ci --ignore-scripts`） | 已实现（Phase 1 / F28） |
| `npm run test:e2e` | 拟建 | 浏览器交互，默认模拟数据库 | 未实现（后续 Phase） |

本轮治理全量检查命令为 `node scripts/governance/check.mjs` 与 `node scripts/governance/run.mjs`。`run.mjs` 在创建隔离快照后，自动调用依赖准备模块安装 dev 依赖，随后执行 `app-build` 与 `app-compile`，两类结果与测试证据严格绑定，默认检查不接触真实数据库。CI/Hook 实际部署结果见验证索引。

## 3. 安全与行为测试矩阵

| 编号 | 场景 | 通过条件 | 当前进度 |
|---|---|---|---|
| T01 | 配置 CRUD、密码替换及存储失败 | 不回显秘密；失败保留有效旧配置，无明文后备 | Phase 1-B 已完成 Windows 系统凭据 5 项 CRUD 与应用重启测试 |
| T02 | 未认证、伪 Host/Origin、CSRF | 变更前拒绝；内部令牌不能批准网页请求 | 未实现（Phase 2） |
| T03 | 多连接/数据库并发 | 无目标串用，默认库不替代显式参数 | 未实现（Phase 2/3） |
| T04 | 多语句、可执行注释、CTE、文件写入、危险函数 | 策略拒绝越界；无驱动执行 | Phase 1-B 已完成 AST 策略 113 项正反例测试 |
| T05 | 合法读取及权限不足 | 保持精度、正确截断、错误脱敏 |
| T06 | request_change 尚未确认 | 无写入派发 |
| T07 | 原生/网页拒绝、取消、过期 | 无写入，拒绝不改道后备 |
| T08 | 修改 SQL/目标/连接版本 | 旧批准不可复用 |
| T09 | 重复点击、并发响应、迟到挑战 | 原请求最多取得一次派发权 |
| T10 | 会话越权及伪造 confirmed | 拒绝，不能获取他人请求 |
| T11 | 超时、断连、状态日志失败、进程崩溃 | 保守记录 UNKNOWN 或执行前失败，不重放 |
| T12 | 原生不支持/自动批准风险 | 网页后备，未确认不执行 |
| T13 | stdio、脱敏、超大输入输出 | stdout 协议纯净，资源有界 |
| T14 | UI 长 SQL/XSS/密码/键盘 | 安全渲染，完整审批内容，焦点正确 |
| T15 | 隔离 MySQL DML/DDL（另行授权） | 逐次人工确认，DBA 权限有效，不承诺 DDL 回滚 |

每个测试记录前置状态、动作、预期、实际结果、版本和证据。不能只测成功路径，不能把模拟测试当真实客户端或数据库通过。

## 4. 变更审查清单

- [ ] 范围与用户需求匹配，未夹带无关重构。
- [ ] 输入有长度/大小限制，错误不会回传原始 SQL 或秘密。
- [ ] 审批绑定、版本失效、执行锁和状态日志顺序一致。
- [ ] 凭据引用不暴露，密码不进入日志、测试快照、构建产物。
- [ ] 所有写路径复用状态机；读取无法调用写执行器。
- [ ] MySQL 会话状态得到清理，资源在成功/异常/取消下都释放。
- [ ] PI 的实际代码/测试结果和文档同步请求经交接，Antigravity 接受后同步文档/契约；未实现状态如实保留。
- [ ] 实际检查命令、结果与未执行原因清楚，不伪造全绿。

此清单是模板，不代表本轮已经审查应用代码。

## 5. 依赖与审查流程

新增依赖说明用途、替代选择、许可证、原生构建/安装脚本及安全影响。安全扫描发现问题不能无说明忽略；确需例外记录范围、理由和复查条件。

PI 先自查并执行相关检查，再按需进行有边界的复核，交接实际结果/文档同步请求；Antigravity 接受后同步文档/台账，可重跑已有检查，但不得自行修复产品源码或构建配置。代码缺陷明确交回 PI rework，修复后重测并重新交回 documentation_delivery，不因猜测风险无限扩大审查。真实阻塞如无隔离数据库、无客户端实例，应标未验收而非伪装通过。

## 6. Git 交付验收

执行已确认的[Git 工作流](./GIT_WORKFLOW.md)和[协作规范](./COLLABORATION_WORKFLOW.md)：Antigravity planning 准备任务分支，PI implementation/rework 负责授权代码/测试/构建，Antigravity documentation_delivery 同步规范、撰写 Conventional Commits 信息，满足必要检查后自动 commit、push、创建/更新 PR。PI 不执行本仓库 commit/push/PR；用户人工转交双方 prompt，等待用户确认合并。

- 提交前检查暂存文件白名单、差异、敏感信息和提交身份；不上传本地记忆或 .pi/。
- 文档-only 由 Antigravity 走 planning → documentation_delivery，检查相对链接、围栏、导航、规则一致性及 git diff --check，不运行尚不存在的应用脚本。本次 PI 文档同步不操作 Git，差异检查由后续 Antigravity 完成。
- PR 记录实际命令、退出码、测试统计、被测版本/快照和产物链接，CI 独立重跑。未配置、未运行、失败及过期分别报告，不能称全绿。
- 必要检查失败不得称验收完成；先修复重测。真正阻塞保留本地成果并报告。
- 汇报分支、提交哈希、PR URL；PR 创建不等于合并，未经用户确认不得合并、自动合并或发布。

## 7. 验收证据与防重复审查

以[验收规范](./ACCEPTANCE.md)与 governance 台账为准。审查先检查需求覆盖和已有实现，新增/修复任务不得重复定义功能；每项标准有具体正反测试或必要实机步骤。不能删失败测试或降低标准来通过门禁。

治理脚本测试包含非法 ID、缺覆盖、循环依赖、重复任务、越界、伪完成、执行失败/超时/零测试/跳过、过期输入、暂存和推送对象检查。CI 通过只证明所执行检查，不自动证明人工验收或数据库功能。门禁自身变更必须用户审查；共享 gh 身份不等于独立 reviewer。

## 8. 协作交接审查

- [ ] 任务链、角色、阶段和授权文件一致，删除/重命名也无越界；机器产物不扩大权限。
- [ ] 用户转交后接收方核验并接受准确事件 ID/摘要；prompt 仅确定性终端输出，不自动发送或冒称人已转交。
- [ ] 每阶段实际差异与开始/结束快照衔接；计划/标准/策略/授权改变后旧交接重新验证，不用文档收尾掩盖代码变化。
- [ ] implementation/rework/bootstrap 的 ready 使用真实 run.json，经现有输出验证后嵌入报告与 TAP 副本；本机路径不入库，本地证据不当独立验收。
- [ ] build passed 有实际登记检查支持（如 TASK-APP-001 登记的 app-build 与 app-compile）；无应用 package 时填 not_applicable 并说明原因，不虚假声称编译通过。
- [ ] documentation_delivery/ready 提交信息与实际候选一致；Antigravity Git 操作用 GOV_ROLE=antigravity，Hook 校验 staged/ref/msg 及完整候选。
- [ ] PR 创建前可为 null；创建后由 record-delivery 读取真实 Git/gh 核实 commit/PR/CI，记录 delivery event 并后续同步台账，不猜 PR 号。
- [ ] 本次 bootstrap 仅 TASK-GOV-004、chore/antigravity-pi-handoff、base ed631a2201e6b439bc79ca6d241176db68ddad82 的限定文档/台账例外，PI 绝不 commit/push/PR。

角色变量和共用 gh 账号不是身份认证，不能证明真人已转交或抵御同机恶意改写；保留历史失败，不无依据升级历史文档状态。此清单是审查模板，不是已完成验证或独立 CI 的声明。
