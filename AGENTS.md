# AGENTS.md — MySQL MCP 网关与管控平台工程宪章

本文件是仓库的根目录 AI 开发总纲。所有代码实现、重构、测试与文档联动均须无条件遵守以下规则。

---

## 1. 工程结构与锁定技术栈

- **Monorepo 应用**：
  - `apps/gateway`（Port `8080`）：MCP 数据面网关（Streamable HTTP / Legacy SSE / Stdio + 11 项工具 + `/health/*` + `/metrics`）
  - `apps/admin-api`（Port `8081`）：Web 控制台管控面 REST API（`/api/v1/*`）
  - `apps/admin-ui`：Web 控制台前端（`React 19 + Vite 6 + Tailwind CSS v4 + shadcn/ui + TanStack Query v5 + TanStack Table v8 + Zod + Lucide Icons`）
- **共享包与单向依赖铁律**：
  - `packages/shared-types`：纯 TypeScript 类型与接口，**零运行时依赖，零运行时 JS 代码**（禁止引入 `zod`、禁止普通 `enum`）。
  - `packages/security`、`packages/core-ast`、`packages/core-engine`：供 `apps/gateway` 与 `apps/admin-api` 依赖；**禁止 `packages/*` 反向依赖 `apps/*`**；**禁止 `apps/admin-ui` 引用后端包**。
- **核心版本锁定（根 `package.json` 禁止使用 `^` / `~` 范围漂移）**：
  - 运行时：`Node.js 22.22.0`、`TypeScript 5.9.3`（strict）、`pnpm`
  - 后端核心：`mysql2: "3.24.6"`、`node-sql-parser: "5.4.0"`、`fastify: "5.12.8"`、`@node-rs/argon2: "2.0.2"`、`ssh2: "1.16.0"`

---

## 2. 真源优先级与文件角色（SSOT）

| 优先级 | 权威资产 | 用途与边界 |
| :--- | :--- | :--- |
| **1（物理表）** | `docs/sql/001_metadata_schema.sql` | 14 张元数据表、索引、约束、自举种子标记的唯一物理基线 |
| **2（接口契约）** | `docs/API_CONTRACT_SPEC.md` (v1.5.2)<br>`docs/contracts/endpoint-trace.json`<br>`docs/contracts/readiness.types.ts`<br>`docs/contracts/request-fields.json` | 47 项管控面接口签名、错误码与测试追踪；`readiness.types.ts` 仅是字段形状，运行期范围/枚举/条件校验须按 `request-fields.json` 与正文在 Zod Schema 中补全 |
| **3（架构详设）** | `docs/BACKEND_ARCHITECTURE_SPEC.md` (v1.7.3)<br>`docs/FRONTEND_ARCHITECTURE_SPEC.md` (v1.4.2)<br>`docs/ARCHITECTURE_SPEC.md` (v1.2.2)<br>`docs/DATABASE_DESIGN_SPEC.md` (v1.0.2) | 双面运行机制、状态机、锁序、守卫链、DTO 边界与测试验收基线；**日常开发优先读取对应的轻量化分片文件 `scripts/be_parts/`、`scripts/fe_parts/`、`scripts/contract_parts/`、`scripts/arch_parts/`（与合成正文同源一致），避免全量加载几百 KB 大文件** |
| **4（视觉与布局）** | `docs/UI_DESIGN_SPEC.md`、`docs/LAYOUT_SPEC.md`<br>`ui-showcase.html`、`admin-console-demo.html` | 视觉设计令牌、密度、信息层级与组件微交互参考（**HTML 原型仅管视觉与交互体验，不作字段/DTO/技术栈依据**） |

### 历史只读区与防漂移规矩
- **禁止当作现行开发依据或重跑**：`docs/reviews/*`、`scripts/apply_*.py`、`scripts/update_*.py`、`scripts/bump_*.py`、`scripts/contract_generators/*`（仅作历史评审证据）。
- **设计正文维护规则**：四份长设计正文由 `scripts/arch_parts`、`be_parts`、`fe_parts`、`contract_parts` 合成；实施阶段如发现设计矛盾或功能缺口（如缺少字段、弹窗或接口变更），**严禁私自改写代码凑合或擅自手改 `docs/*.md`**，须暂停并向用户上报冲突点。经用户明确批准变更后，须先修改对应 `scripts/*_parts/` 分片（及必要时的 `docs/sql/001_metadata_schema.sql`），运行 `node scripts/combine_*.js`、`python scripts/generate_readiness_contracts.py`（并确认 `--check` 与 `python scripts/validate_database_design.py` 通过）提交落盘后，方可恢复编码。

---

## 3. 不可妥协的工程与架构红线

### 3.1 类型与 ID 安全
1. 全面开启 `strict: true`、`noImplicitAny: true`、`noUncheckedIndexedAccess: true`；**严禁 `as any`、`@ts-ignore`、`@ts-expect-error` 掩盖类型问题**。
2. 全链路 64 位整型主外键与实体 ID（`EntityId`）统一使用十进制 `string`（全局约定为 `"0"`），**严禁 `Number(id)` 转换**。

### 3.2 数据库、驱动与安全通道（后端）
3. `MetadataPool` 启用 `supportBigNumbers: true, bigNumberStrings: true` 与每次借连接 UTC 会话设定；**业务代码与 Repository 严禁绕过 `MetadataQueryExecutor` 直接调用裸 `mysql2.Pool.query`**。
4. 数据面连接池与维护通道统一使用原生 callback 风格 `mysql2@3.24.6`：
   - 保留原始逻辑 `host` + 自定义 `stream` 工厂（先经 `ssrfGuard.resolveAndValidateHost` 做 IP Pinning，再连 `pinnedIp` 或 `ssh2` 隧道）+ `ssl: { rejectUnauthorized: true, verifyIdentity: true }`；
   - 结果集强制开启 `rowsAsArray: true` 配合 `fields` 元数据提取，**严禁 `Object.values(row)`**；
   - `conn.reset(cb)` 配 1500ms 硬超时，失败或取消时 2000ms 内无条件 `conn.destroy()`。
5. **超管防自残与并发锁序**：所有用户禁用/降权/删除/审批变更必须严格遵守 **`SUPER_ADMIN` 角色锁 → 按 ID 锁用户 → 锁绑定当前读** 与同事务管理审计；`BootstrapService` 仅允许在 `bootstrap_state = 'PENDING'` 且 14 张业务表为空时执行首次自举，严禁无活跃超管时自动自愈新建。
6. **限流与审计安全**：USER 限流创建/更新共用 `sys_rate_limit_revisions` counter 分配，防止 ABA；`isCustom = false` 时不得拿 `GLOBAL` 默认值伪造用户覆盖；高危审计强一致入库，应急文件重放基于 `replayedIdSet` 原子裁剪，双通道失败不丢批次。
7. **敏感信息与输入校验**：密码、PAT 原文、SSH 私钥、Webhook Secret、加密明文绝不写入普通日志；CSRF 校验放在 Fastify `preValidation` 无副作用执行；所有 SQL 坚持参数化占位符。

### 3.3 前端原型保真与安全边界（皮与骨分离）
8. **技术栈与视觉标准**：使用 `React 19 + Tailwind v4 (@theme)` + `FRONTEND_ARCHITECTURE_SPEC.md` §9.3 的 OKLCH `theme.css` + `shadcn/ui` + `Lucide Icons`；**严禁搬运 HTML 原型的原生 CSS 类名或内联脚本，严禁在正式 UI 中使用 Emoji**。
9. **尺寸与密度裁决**（原型 `60/64/67px` 顶栏与 `31/33px` 按钮均收敛至正式规范）：
   - 锁定 Topbar `56px` (`h-14`)、Sidebar `240px / 64px`、Table 行高 `38px` (`h-[38px]`)、按钮 `h-8 / h-9`（工具栏 `h-7`）、Sheet 抽屉断点 `600px (>=1440px) / 540px (1024~1439px) / 70vw (768~1023px) / 底部 85vh (<768px)`；
   - 全站数值/耗时/QPM/ID 强制 `tabular-nums`；业务界面锁定高密度 `8/10`，不保留展台式的“舒适/紧凑”切换器。
10. **严格剔除原型虚构字段与功能**：
    - `InspectSheet` 仅渲染 `sys_audit_logs` 真实物理字段，**严禁展示伪造的 EXPLAIN、AST 穿透树、改写前 SQL 或“一键吊销 PAT”按钮**；
    - 不实现原型中的 `inviteUser` 邀请弹窗；不用原型演示角色名（如 `DATA_ANALYST`）硬编码鉴权。
11. **前端安全与 DTO 契约**：
    - 守卫固定顺序：`AuthGuard -> StatusGuard -> MustChangePwdGuard（仅 ACTIVE） -> RoleGuard`；
    - 登录跳转必须经 `sanitizeReturnUrl` 过滤路径穿越与 `//` 协议相对 URL；登出使用 `SessionRequestManager.abortAndRotate()` 先断业务流再发 `/auth/logout`；
    - `ProfileReadDTO.username` 通过显式表单映射提交为 `user`，**严禁展开 GET DTO 直接 `PUT`**；修改主机/用户/TLS/SSH 信任边界须强制重输凭据；
    - PAT 揭示弹窗严格执行三态防呆与关闭清空明文；`409` 乐观锁冲突保留表单草稿；抽屉状态与列表筛选以 URL SearchParams 为唯一事实源（SSOT）。

---

## 4. `RD-08` 未决决策保护条款

以下 5 项在 `docs/DATABASE_DESIGN_SPEC.md` §15.1 中**尚未取得产品/安全最终签署**，实现相关模块时**禁止擅自硬编码写死不可配置逻辑**，须保留清晰配置边界或标记 `PROVISIONAL` 并向用户确认：
1. 新库全局 `burstCapacity` 默认值（暂按 `10`，存量 `15` 不覆盖）；
2. 库级 ACL 通配符范围（v1.0 暂按精确名，扩大需补规范）；
3. `USER / ROLE / GLOBAL` 限流外部行为与文案冻结签署；
4. DST 23/25 小时自然日与固定 1440 分钟日桶口径；
5. 密码 `daysRemaining` 取整边界文案（暂定 `ceil`、最小 `0`、关闭为 `-1`）。

---

## 5. 模块开发与联调工作流

1. **按 `TODO.md` -> `todos/M*.md` 顺序推进（`M0 -> M7`）**：每次先读根目录 `TODO.md` 定位当前模块文件（`todos/M*.md`），再仅阅读该模块文件及其指定的文档章节，先输出简短改动计划后编码。
2. **单模块内部串行咬合顺序（及契约冻结下的并行例外）**：
   - 先对齐/更新 `packages/shared-types` 与请求校验 Schema；
   - 再完成后端实现并跑通类型检查、单测及**真实 MySQL 容器集成/契约测试**；
   - 再按 `FRONTEND_ARCHITECTURE_SPEC.md` 与两个 HTML 原型完成前端页面/组件并**直连真实后端**；
   - **分段勾选与总表收口口径**：`todos/M*.md` 内部交付子清单按 Step 分段勾选（后端真实 MySQL 验收通过后勾后端子清单、前端直连真实后端验收通过后勾前端子清单、QA 独立验收 `PASS` 后勾模块验收门禁）；根目录 `TODO.md` 模块总表保持 `[ ]`，直至该模块全部步骤、端到端联调及适用的双审验收通过后再统一勾选 `[x]` 收口。同次收口须同步更新 `README.md` 的里程碑徽章、阶段概述、门禁命令与 Roadmap，并将对应 `todos/M*.md` 顶部状态写为验收定稿，移除待批准推送或待合入等临时文案。
   - **并行开发例外**：在基础底座与接口契约已冻结的前提下，允许前后端分 `git worktree` 并行编码（执行真实数据库测试或启动本地端口时注意错开），但**严禁各自 Mock 过关**，编码完成后必须合回同一特性分支，再由前端直连真实后端完成联调与验收。
3. **诚实汇报边界**：禁止将 Mock 测试或局部单测通过汇报为“真实 MySQL / 前后端真实联调已通过”；每次汇报必须列出实际执行的验证命令与结果。
4. **新页面 / 新功能交付必启本地在线预览（Owner 人工验收门禁）**：凡里程碑或迭代开发出新的前端页面、交互视图或用户可感知的新功能，在 QA 独立验收 `PASS` 并向 Owner 提交终审交付时，须同步在本机独立拉起可交互的本地预览环境（真实 Docker MySQL 8.0 + `admin-api` + `admin-ui`，按需含 `gateway`），验证各服务就绪后一并交付访问 URL、本地临时预览账密（严禁写入仓库或日志）、日志路径及停止命令，供 Owner 在浏览器实测验收后再批准推送与合入 `main`。
---

## 6. Git 分支、提交、版本号与 CI/安全审计规范

1. **Git 分支工作流（GitHub Flow）**：
   - `main` 为唯一长期受保护主干，**严禁直接在 `main` 上开发提交或未过门禁直推**（仓库首次 `M0` 初始化建仓除外）。
   - 分支命名强制为 `<type>/<short-kebab-name>`（与提交 `type` 对齐），例如里程碑分支 `feat/m0-foundation-lab`、`feat/m1-auth-guards`，缺陷修复 `fix/m1-csrf-header`，文档/杂项 `docs/...`、`chore/...`。
   - 每个里程碑或任务从最新 `main` 切出独立短生命周期分支；经 Review 批准并走 PR 通过 CI/安全门禁合入 `main` 后，删除已合并的特性分支并同步本地 `main`。
2. **Git 提交规范（[Conventional Commits v1.0.0](https://www.conventionalcommits.org/zh-hans/v1.0.0/)）**：
   - 格式强制为 `<type>(<scope>)[!]: <subject>`。
   - 允许 `type`：`feat`、`fix`、`refactor`、`perf`、`test`、`docs`、`build`、`ci`、`chore`、`revert`。
   - 统一 `scope`：`gateway`、`admin-api`、`admin-ui`、`core-ast`、`core-engine`、`security`、`shared-types`、`db`、`ci`、`deps`、`docs`。
   - **Git / GitHub 全链路中文规范**：Git 提交信息（`<subject>`、Body、Footer；仅保留英文 `<type>(<scope>)` 前缀及必要技术术语/代码/路径原文）、PR 标题与描述、PR Review 意见、Issue / Commit 评论与 Release Notes 等所有 Git / GitHub 协作信息**必须统一使用简体中文**撰写。
   - **禁止跳过钩子**（严禁 `--no-verify`）；严禁将 `.env*`、私钥、测试凭据、临时截图或调试产物提交进仓库；未跑通对应切片门禁前不得提交 `feat` 宣称完成。
3. **版本号规范（[SemVer 2.0.0](https://semver.org/lang/zh-CN/)）**：
   - `M0 ~ M7` 开发联调期及 `RD-08` 未最终签署前使用 **`0.x.y`** 步进（`0.1.0` 起步，阶段里程碑递增 `MINOR`，缺陷修复递增 `PATCH`）；全链路 E2E 与准入门禁全部冻结后发布 **`v1.0.0`**（Git Tag 统一 `vX.Y.Z`）。
   - Monorepo 内部包互引用使用 `workspace:*` 跟随根版本步进；变更映射遵循 `fix -> PATCH`、`feat -> MINOR`、`BREAKING CHANGE / ! -> MAJOR`。
   - **锁定依赖保护**：Dependabot 或自动化升级不得擅自跨版本修改 `mysql2@3.24.6`、`node-sql-parser@5.4.0`、`fastify@5.12.8`、`@node-rs/argon2@2.0.2`、`ssh2@1.16.0`；任何升级须人工源码复核并全量通过 `TC-BE-01~18`。
4. **GitHub CI/CD 与安全审计**：
   - 合入主分支的 PR 必须通过 CI（`commitlint`、契约防漂移 `--check`、`typecheck`、`lint`、MySQL 8.0 集成测试、前端包体预算与 E2E）及安全门禁（CodeQL SAST、`pnpm audit --audit-level=high`、Secret Scanning / Push Protection）。
   - `.github/workflows/*.yml` 必须显式收紧最小 `permissions`（默认只读），第三方 Action 尽量锁定完整 Commit SHA。
