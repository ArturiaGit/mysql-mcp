# Antigravity × PI-Desktop 人工转交与机械交接规范

> 状态：G03 / R17 / TASK-GOV-004 的已批准协作规则。命令契约如下，实际实现、测试及部署结果以[验证记录](./verification/antigravity-pi-collaboration.md)为准；本文不声称独立 CI、用户验收或 Git 交付已完成。应用尚无 package 或构建工程。

## 1. 职责与授权

详见[全栈分工与前后端物理隔离协作规范](./FULLSTACK_DIVISION_SPECIFICATION.md)。

| 执行方 | 职责 | 禁止事项 |
|---|---|---|
| Antigravity（`antigravity`） | planning、需求/计划/验收标准/规范/台账；**授权前端界面（`mysql-mcp/web/`）开发、样式与 UI 测试**；documentation_delivery、提交信息、暂存、commit、push、创建/更新 PR、查询 CI；可只读验证和重跑已有检查 | 自行修复后端核心源码（`mysql-mcp/src/`）或构建配置；把前端或 Git 授权扩展为后端/数据库授权 |
| PI-Desktop（`pi-desktop`） | implementation/rework 的授权**后端核心源码（`mysql-mcp/src/`）**、后端测试、依赖/锁文件与构建配置、实际测试/构建/编译；阅读规范并记录文档同步请求 | 修改前端界面资产（`mysql-mcp/web/`）；通常直接修改规范/台账；本仓库 commit、push、创建/更新 PR |
| 用户 | 在两端人工复制完整 prompt，明确任务范围与合并授权 | 用整体开发授权替代每次数据库写入/DDL 确认 |

Antigravity 管理根 `AGENTS.md`、`docs/`、规范 Markdown、功能/任务/检查登记、协作策略以及 `mysql-mcp/web/` 前端界面资产。PI 管理 `mysql-mcp/src/` 后端系统实现、`mysql-mcp/tests/` 后端测试，以及明确登记 `governance_change` 的 `scripts/governance/`、治理测试、Hook、CI 技术实现。任务 `allowed_paths` 是上限，不替代角色与领域约束。

`governance/collaboration.json` 定义策略；`governance/handoffs/<ID>.json` 为单任务交接链，没有可跨任务随意改写的全局“当前阶段”。交接 JSON、prompt、执行报告是受约束机器产物，双方仅按阶段操作生成，不能借机器产物越权。未分类、交叉归属、路径穿越、非普通文件、任务外路径须拒绝；删除/重命名同样校验。

安全规则沿用[项目约束](./PROJECT_CONSTRAINTS.md)、[Git 工作流](./GIT_WORKFLOW.md)、[验收规范](./ACCEPTANCE.md)。交接不授予数据库连接、客户端配置、新功能、发布或合并权限。前后端交互必须严格遵循[接口契约](./API_AND_PROTOCOLS.md)，接口先行。

## 2. 阶段与停止点

1. **planning / Antigravity**：核实仓库/分支/main 基线和既有功能/PR，通读 `docs/changes/` 下所有活动未发版变更文档以掌握近期架构演进与警示，准备任务分支；先登记可观察验收、范围和禁止事项，冻结接口契约，再生成给 PI 的交接（文档任务直接推进至 documentation_delivery；前端任务由 Antigravity 实施）。
2. **implementation / PI (后端) 或 Antigravity (前端)**：
   - 后端任务（`mode: code`）：用户转交后核验并接受准确 ID/摘要；由 PI 开始阶段，执行授权后端技术变更和真实检查，结束时列实际结果、文档同步请求和限制。
   - 前端任务（`mode: frontend`）：由 Antigravity 依据已锁定接口实现 `mysql-mcp/web/` 页面与交互，执行浏览器预览自测。
3. **documentation_delivery / Antigravity**：接受实现结果、同步文档/台账，并在 `docs/changes/` 撰写本次任务变更文档（含发版说明板块与 Agent 避坑指南，维护未发版索引），检查结果与代码一致，生成准确交付候选、暂存摘要和 Conventional Commits 提交信息。必要门禁通过后仅由 Antigravity 完成 Git 交付。
4. **rework / PI**：明确后端代码缺陷/CI 失败交回 PI，核验接受后只修复授权问题并重测；新交接再回 documentation_delivery，旧结果不再授权交付。

正常路径：
- 后端开发：`planning → implementation (PI) → documentation_delivery (Antigravity)`；返工为 `documentation_delivery → rework → documentation_delivery`。
- 文档任务：由 Antigravity 走 `planning → documentation_delivery`，不伪造 PI 开发或构建阶段。
- 前端任务：由 Antigravity 走 `planning → implementation (Antigravity) → documentation_delivery (Antigravity)`。

阶段结束或终端生成 prompt 都不证明用户已转交；接收方必须显式接受。blocked、reject、cancel 保留事件，不自动推进。无下一项授权时回传“等待用户授权，不开始开发”；PR 成功后等待用户确认合并，不自动合并、开启自动合并、删除分支、创建 Tag 或发布。

## 3. 版本与交接绑定

每次 begin 绑定已有文件清单及内容摘要；finish 校验本阶段实际差异，而不是只看最终混合 diff。前后阶段清单须衔接，暂存/推送候选必须与交接链一致。记录包含任务/功能/验收 ID、序号、角色、发送/接收方、前一事件摘要、分支/base/源 HEAD、计划与策略版本、开始/结束快照及新增/修改/删除文件摘要。

计划、验收标准、策略或任务授权变化使相关旧开发交接失效，必须重新交接并重验；外部代码或文档变化不能由收尾文档掩盖。完整治理输入摘要仍保留，开发快照摘要用于区分技术实现与文档/交接产物；交接不纳入自身摘要，不能借防自引用排除授权变更。

流程从策略启用基线后的新任务/新变更生效。历史任务保留原证据和失败，不补造过去交接，不把历史宽泛授权当新流程豁免；任何新任务仍须独立协作记录。

## 4. CLI 契约与手动转交

在仓库根执行。以下是命令格式模板，尖括号项须替换为真实值；示例本身不是有效交接，也不表示命令已验证部署。

```text
node scripts/governance/handoff.mjs begin --task <ID> --role antigravity|pi-desktop --phase planning|implementation|documentation_delivery|rework|bootstrap
node scripts/governance/handoff.mjs finish --task <ID> --role <ROLE> --details <FILE>
node scripts/governance/handoff.mjs accept --task <ID> --role <RECEIVER> --handoff <EVENT_ID> --digest <SHA256>
node scripts/governance/handoff.mjs reject --task <ID> --role <RECEIVER> --handoff <EVENT_ID> --digest <SHA256> --reason <TEXT>
node scripts/governance/handoff.mjs cancel --task <ID> --role <SENDER> --handoff <EVENT_ID> --digest <SHA256> --reason <TEXT>
node scripts/governance/handoff.mjs check --task <ID>
node scripts/governance/handoff.mjs prompt --task <ID> --handoff <EVENT_ID>
node scripts/governance/handoff.mjs builds --task <ID> --role pi-desktop
node scripts/governance/handoff.mjs record-delivery --task <ID> --role antigravity --details <FILE>
```

`ROLE` 仅为 `antigravity` 或 `pi-desktop`，不得把命令行中的 `|` 原样输入。各阶段操作还须满足策略规定的发送/接收方，`--role` 不授予跨阶段权限。reject/cancel 沿用 accept 的 ID/摘要参数并说明原因；拒绝/取消的操作者及可用状态须由实现校验，不可手改链绕过。

路径或 reason 含空格时按当前 shell 引号规则传参。生成 prompt 必须从通过校验的结构化事件渲染，包含接收方职责、任务/功能/验收 ID、准确交接 ID/摘要、分支/base、授权文件与禁止事项、实际变更/检查/构建结果、证据限制、文档同步请求、下一步及回传/停止要求；重渲染须一致，禁止空模板、占位符或 JSON/prompt 内容不一致。手写模板只帮助准备 details，不能替代命令产生的有效 prompt。

操作顺序：

1. 发送方 begin 后执行阶段授权工作，用真实 details finish；运行 check，按产生的事件 ID 执行 prompt。
2. prompt 只在终端确定性渲染，不自动发送、不调用另一端、不自动登记“用户已转交”。用户复制完整输出。
3. 接收方读批准范围、当前任务分支/基线和记录，核验 ID/摘要、文件差异、结果/证据、禁止事项及下一步；一致才 accept 并 begin 对应阶段。不一致则 reject/阻塞，说明原因。
4. 阶段完成生成反向 prompt，由用户再转交。不可把上一轮旧 prompt 用作本轮授权。
5. Antigravity 真实提交/PR/CI 操作后执行 record-delivery，命令须读取真实 Git/gh 核实 commit/PR/CI，再生成回传 prompt。它不自动 commit、push、创建 PR 或发送消息；交付 details 的具体字段以实现 `--help` 和校验为准，不预填未知结果。

## 5. finish details 字段与填写模板

| 字段 | 要求 |
|---|---|
| `goal`、`outcome` | 非空字符串，明确目标和实际结果，不能用空模板冒充完成 |
| `next_actions`、`forbidden` | 非空字符串数组；写接收方具体动作、职责边界及停止点 |
| `documentation_requests` | 数组，列需 Antigravity 同步的文档；无请求可为空 |
| `limitations` | 非空数组，说明证据/信任/实际功能限制 |
| `blockers` | 数组，真实阻塞；无阻塞可为空 |
| `result` | `ready` 或 `blocked`；blocked 不得称可交付 |
| `build` | `{status, reason, check_ids}`；status 为 `not_applicable` / `passed` / `failed`，reason 非空，check_ids 为登记检查 ID 数组 |
| `verification` | `[{check_id, reason}]`；check_id 必须登记，reason 非空；实际通过由 run 证据验证，不从文字推断 |
| `report` | 所有非 planning 的 ready（含文档交付和文档-only）须提供真实 `run.json`；只读本地路径，不入库；不能用尚不存在的应用脚本 |
| `commit_message` | 仅 documentation_delivery 的 `ready` 且 `next_phase: wait` 必填；Antigravity 编写，与实际候选完全一致；返工请求不填 |
| `next_phase` | documentation_delivery 使用 `wait` / `rework` / `planning`；blocked 只能回 rework/planning，不能交付；其余阶段由状态机推导 |
| `build_report` | 可选 builds.json；构建/编译定义非空时必须有真实执行记录，run 也会实际重跑并记录 builds，不接受文字 passed |

以下是**需替换全部占位说明后使用**的 implementation/ready 填写模板；必要检查未执行应报告 blocked。文档-only 无 PI 开发阶段，但 documentation_delivery 同样需要实际治理报告；不伪造应用构建。

```json
{
  "goal": "填写已批准任务目标",
  "outcome": "填写实际实现与检查结果",
  "next_actions": ["Antigravity 核验接收，按请求同步文档，再检查交付候选"],
  "forbidden": ["不得扩大任务范围或执行未批准数据库操作", "PI 不得 commit/push/PR"],
  "documentation_requests": ["填写需同步的确切文档与行为"],
  "limitations": ["本地报告仅为诊断，独立 CI/人工验收须分别核实"],
  "blockers": [],
  "result": "ready",
  "build": {"status": "not_applicable", "reason": "仅治理 mjs 变更，无 MySQL 应用 package/构建工程", "check_ids": []},
  "verification": [{"check_id": "governance-tests", "reason": "填写该登记检查覆盖的实际变更及结果"}],
  "report": "填写实际本地 run.json 路径，不入库"
}
```

保存 details 到本地临时目录，不公开本地路径/敏感信息。documentation_delivery/ready 按本阶段要求填写上述通用字段及 `commit_message`；准确检查 ID 必须以当前 `governance/checks.json` 为准，不猜新增 ID。

## 6. 执行证据与交付检查

ready 不等于验收。实际 run 报告须包含命令、定义/输入摘要、退出码、测试总数及失败/跳过/取消/超时等状态；必要测试失败/跳过/零测试或证据失效均不得冒充可交付。build 的 `passed` 须有实际登记检查证据，无构建工程填 `not_applicable` 和原因；不能声称编译 MySQL。

finish 读取实际 `run.json`，经现有 run 输出校验后，将真实报告及原始 TAP 副本嵌入本地诊断交接；不能手填 passed、改写 TAP 或把报告路径当证据本身。本机 run 文件路径不进入版本化记录。报告与原始产物摘要/输入版本必须匹配，CI 在实际提交独立重跑，不把本地嵌入声明当可信独立验收。

Antigravity Git 交付操作必须设置 `GOV_ROLE=antigravity`。pre-commit 检查实际 staged 快照与完整交接候选；commit-msg 检查实际提交信息；pre-push 检查实际 ref/OID 并重跑必要检查。工作区修复不得掩盖错误暂存/旧推送对象，禁止 --no-verify、关闭 hooksPath 或降低检查。

任务 PR 创建前允许 `pr: null`；创建后真实提交哈希、PR URL/号、CI 状态记录在 delivery event，后续同步任务台账。不猜 PR #4，不预填 commit/PR/CI。台账同步也须遵守快照衔接，不能静默改写已结束阶段。main squash/PR 检查绑定实际 base/head，不把 GitHub 合并对象误认作 PI 越界；具体执行结果须有测试证据。

Git mode（100644/100755）与内容摘要共同组成快照项；文本统一 LF，二进制保留字节。Windows/core.filemode=false 按索引模式核对，POSIX/core.filemode=true 按文件可执行位核对；暂存/ref 从真实 Git 树取模式。对新 Hook，Antigravity 暂存时按 PI 候选保留 100755（必要时 `git update-index --chmod=+x .githooks/commit-msg`），不是静默修改候选。取消/拒绝候选后不能再提交，必须重新规划并形成新候选。

后续应用构建/编译由 Antigravity 在 task.build_checks 登记安全的 Node 入口及参数数组；须同时覆盖 build/compile。PI 的 builds 命令只在活动开发阶段运行；run 在提交和 CI 重跑定义。没有应用工程时明确不适用，存在 package.json 却未登记必要构建会拒绝 ready。

## 7. 本次一次性 bootstrap

仅限 `TASK-GOV-004`、`chore/antigravity-pi-handoff`、base `ed631a2201e6b439bc79ca6d241176db68ddad82`；用户批准 PI 启动 bootstrap，更新建立该流程所必需且明确限定的规范/台账及治理技术实现。其结束仍须真实 report、完整反向 prompt，并由用户转交 Antigravity。

这是对常规 PI 不改规范/台账的单次豁免，不是通用角色权限；不得复制到其他任务、分支、基线或未授权文件。**本次 PI 绝不可执行本仓库 commit/push/PR**。Antigravity 接受后负责 documentation_delivery 和真正 Git 交付。本次[实施计划](./plans/antigravity-pi-collaboration.md)与[验证记录](./verification/antigravity-pi-collaboration.md)分别记录验收范围与实际结果；历史失败和未验收项必须保留。

## 8. 保证与限制

机械检查能校验结构化职责、阶段顺序、版本/文件差异、交接完整性、执行产物与实际 Git 对象；不能仅凭 `--role`、`GOV_ROLE`、本机 JSON、提交邮箱或共享 gh 账号证明真实身份、真人已转交或独立审批，也不能强制抵御同用户权限恶意进程改写 Hook/策略/记录。

本流程没有外部身份服务、秘密签名或自动消息通道。可信外部证据无法认证时保持未验收；本地检查通过、prompt 生成、接受交接、PR 创建/合并都不能替代必要实机/人工验收。CI 未配置、未运行、等待中、失败和通过分别报告，不虚构全绿或业务完成。
