# Git 工作流

> 状态：用户已确认的角色化 Git 执行约定；Git 交付归 Antigravity，PI 负责代码/测试/构建。协作门禁的实际运行与 Hook/CI/远程保护结果见 docs/verification/，配置文本不等于部署或验收证据。

## 1. 仓库与授权

目标为公开仓库 `ArturiaGit/mysql-mcp`，仓库根是工作区根，docs 与未来 mysql-mcp 应用子目录同仓。用户已授权：对明确获准的阶段开发、功能修复或文档任务，由 Antigravity 先建分支，在必要门禁与约定验收满足后自动 commit、push、创建/更新 PR，无需逐次确认常规动作。PI-Desktop 不执行本仓库 commit/push/PR；人工转交与阶段接受见[协作规范](./COLLABORATION_WORKFLOW.md)。

该授权不包括自动合并、自动合并开关、删除分支、Tag、发布、强推或破坏性恢复操作；不包括自行发起新功能或数据库写操作。Agent 入口见 [AGENTS.md](../AGENTS.md)。

## 2. 开发前必须创建任务分支

1. Antigravity 检查当前分支、status、remote、未提交及已暂存修改；确认 origin 是目标仓库。以下分支准备与 Git 交付步骤均由 Antigravity 执行，PI 接收时核对准确分支/基线。
2. 新任务先 fetch origin，确认最新 origin/main 基线；本地 main 有独有提交或分歧时先查原因，不能 reset 或强推覆盖。
3. 从已确认基线创建短期分支，再修改文件。命名为 feat/connection-manager、fix/approval-expiry、docs/spec-update 或 chore/toolchain。
4. 同一任务续作复用原分支及 PR；不得在 main 直接开发或提交。
5. 前一任务未合并时，不隐式把它作为独立新任务的基线；需要依赖分支或堆叠 PR 应明确说明并确认。保留所有用户改动，不能擅自 stash/reset/clean；无法安全隔离时报告阻塞。

一个阶段可以有多个原子提交；大阶段可拆成多个独立任务分支/PR。不得把相互无关任务长期堆在一个分支。

## 3. 实现、验收与提交

PI 完成授权技术实现和检查后，将实际结果、run 证据及文档同步请求交回 Antigravity；Antigravity 接受交接、同步规范/台账，形成 documentation_delivery 的准确交付候选，再审查暂存 diff。只暂存任务明确文件，不盲目 git add 全部。配套实现、测试和文档随同一意图提交，不夹带无关格式化。文档-only 由 Antigravity 走 planning → documentation_delivery，不伪造 PI 实现。

提交信息由 Antigravity 编写，格式为 `type(scope): 简明描述`（Conventional Commits），documentation_delivery/ready 的 details 必填 `commit_message` 并绑定候选；实际 commit-msg 必须一致。type 包括 feat、fix、docs、test、refactor、build、chore；scope 如 connections、mcp、approval、sql、security、web、docs。破坏性契约变更说明 BREAKING CHANGE，版本规则见[版本规范](./VERSIONING.md)。

提交前检查秘密、原始业务 SQL、连接配置、私人信息和日志截图；本地 .pi/ 与 mysql-mcp-memory.md 不上传。公开仓库优先使用当前 GitHub 账号的 noreply 提交邮箱，不改全局身份。

相关检查失败不得提交普通交付候选；代码/构建问题明确交回 PI rework，重测后重新交回 documentation_delivery，文档问题由 Antigravity 修正并重验。必要验收无法完成必须报告。网络/权限失败可保留已经合法产生的本地提交，但不能将未通过阶段称为已验收。未来需要提前分享草稿 PR 时单独说明用途。

## 4. Push 与 PR

阶段或修复满足交付门禁和约定验收后由 Antigravity 自动 push 当前任务分支到已确认 origin，首次设置 upstream。禁止强推，不直接向 main 推送任务变更。

先查询同 head/base 的开放 PR，有则更新，无则新建，以 main 为 base。PR 标题遵循提交风格，正文必须写：需求、变更范围、实际检查与结果、未执行项和原因、风险与限制、迁移影响。文档任务只检查实际存在的文档，不运行不存在的 npm 脚本。

Antigravity 查询 CI/检查状态并报告：通过、失败、等待中、未运行或未配置。没有 CI 不是全绿，不能虚构必需检查已经运行。网络或权限失败保留本地提交并说明阻塞，不切换未知远程或账号。任务 `pr` 创建前可为 `null`，创建后真实 commit/PR/CI 记录在 delivery event 并后续同步任务台账，不猜 PR 号。`record-delivery --task <ID> --role antigravity --details <FILE>` 须读取真实 Git/gh 核实结果并生成回传 prompt，不自动执行 Git 交付或发送消息。

## 5. 停止点：等待用户确认合并

Antigravity 交付报告必须写真实分支、提交哈希、PR URL、检查状态和剩余限制，并生成由用户转交 PI 的下一步 prompt。创建 PR 后进入 waiting_for_merge，不等于已合并或发布。CI 代码失败给出明确 rework 范围；成功则等待用户确认合并或下一项授权，不启动未批准开发。

不得自动合并、启用自动合并或删除分支。用户明确确认后才执行对应合并操作；拟采用 squash，实际以授权和仓库设置为准。CI 尚未结束时报告等待，不静默当成通过。Git 回退不能撤销已执行 SQL；补偿仍需逐次人工确认。

## 6. 首次初始化例外

本次用户单独批准：在 main 创建仅含 .gitignore 的最小基线提交 `bf703ad`，用于首个 PR 的比较基线；随后创建 docs/agent-git-workflow 分支。初始化时允许首次推送该 main 基线，但不把本例外用于后续功能或规范主体提交。

本地 Hook 与 CI 由 scripts/governance 实现，安装使用 node scripts/governance/install-hooks.mjs。Antigravity 本地 Git 交付操作须设置 `GOV_ROLE=antigravity`：pre-commit 检查实际暂存快照与完整交接候选，commit-msg 检查实际提交信息，pre-push 检查实际 ref/OID 并运行必要测试；禁止绕过。角色变量不是身份认证，不能证明用户已转交或抵御同机恶意改写。main 远程保护须按 API 验证，不能仅凭 workflow 文件宣称生效。验收规则见[验收规范](./ACCEPTANCE.md)。

## 7. 防偏离与证据要求

Antigravity 在任务开始前登记 governance/tasks.json 并查 governance/features.json 的既有功能/验收标准，完成 planning 交接；PI 验证接受后实施。修改文件须同时符合任务授权路径和角色边界，修复复用功能 ID。运行 node scripts/governance/check.mjs 和 node scripts/governance/run.mjs；记录快照、命令、退出码和实际测试统计。交接本地 run 报告及经校验的 TAP 副本仅为诊断，CI 在实际提交独立重跑。

治理变更（包括检查器、工作流、验收标准）需显式标识且用户审查。功能状态不以 PR 正文或手工勾选为准；缺实机/人工证据保持未验收。保护规则要求 PR 与治理检查，不表示当前共享账号具备独立真人身份认证。

## 8. TASK-GOV-004 的一次性 bootstrap

用户批准 PI 在 `chore/antigravity-pi-handoff`、base `ed631a2201e6b439bc79ca6d241176db68ddad82` 为 `TASK-GOV-004` 启动 bootstrap 并更新限定规范/台账及治理技术实现，**绝不允许 PI 执行本仓库 commit、push、创建/更新 PR**。结束生成真实交接，等待用户转交 Antigravity，由其接受后 documentation_delivery。该例外不用于其他任务，不恢复已用完的 main 初始化权限；本轮不得提前声称 Git 交付、独立 CI 或验收成功。
