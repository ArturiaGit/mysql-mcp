# REVIEW.md — AI 代码审查、视觉核验与门禁清单

本文件是仓库的独立 Code Review 与 QA 验收指南，配合 [`AGENTS.md`](AGENTS.md) 与 [`TODO.md`](TODO.md) 使用。所有审查角色（QA 门禁 Agent 与独立安全二审顾问）在审阅 `git diff` 与验收报告时须严格遵循以下规则。

---

## 1. 审查原则与降噪规则

1. **只报高置信度实质性问题**：每一条阻塞意见必须经源码上下文核实、具备真实触发路径；按 `P0`（安全漏洞/数据损坏/阻断性缺陷）、`P1`（违反架构红线/契约漂移/测试造假）、`P2`（可记录但不阻断合入的改进项）分级。
2. **明确忽略以下噪音（禁止刷屏）**：
   - 纯个人偏好的变量命名、注释措辞或代码风格（统一交由 ESLint / TypeScript 机械门禁裁决）；
   - 超出当前 `todos/M*.md` 切片范围的“顺手大重构”建议；
   - 已被 CI / `typecheck` / `lint` 明确捕获的重复格式报错。
3. **只读审查边界**：审查角色严禁直接代替开发大改业务代码，严禁擅自修改 `docs/*.md` 与历史只读区（`docs/reviews/*`）。

---

## 2. 一票否决的高危必查项（P0 / P1 硬阻断）

所有红线以仓库最新 [`AGENTS.md`](AGENTS.md) 为唯一真源（SSOT），审查时重点核验以下 4 类高危区：

### 2.1 类型、ID 与 Monorepo 边界
- 严禁出现 `as any`、`@ts-ignore`、`@ts-expect-error`；
- 64 位 `EntityId` 全链路必须为十进制 `string`，严禁 `Number(id)` 转换；
- `packages/shared-types` 必须保持零运行时依赖、零运行时 JS（禁 `zod`、禁普通 `enum`）；
- 严禁破坏单向依赖（`packages/*` 不得引用 `apps/*`；`apps/admin-ui` 不得引用后端包）；
- 严禁擅自改动锁定核心依赖版本或引入 `^` / `~` 范围漂移。

### 2.2 后端安全、数据库与并发一致性
- 元数据访问必须走 `MetadataPool`（`supportBigNumbers: true, bigNumberStrings: true` + UTC）与 `MetadataQueryExecutor`，严禁业务层裸调 `mysql2.Pool.query`；
- 数据面连接通道必须保持原生 callback 风格 `mysql2`、`ssrfGuard.resolveAndValidateHost` IP Pinning、`ssh2`/TLS 校验、`rowsAsArray: true`（严禁 `Object.values(row)`）及 `1500ms / 2000ms` reset/destroy 超时回收；
- 超管禁用/降权/删除/审批变更必须严格遵守并发锁序与同事务管理审计，禁止无活跃超管时自动自愈自举；
- 限流变更须防 ABA，禁止伪造用户覆盖；高危审计强一致入库且应急重放原子裁剪；
- 密码、PAT 原文、SSH 私钥、Webhook Secret、加密明文绝不进普通日志；CSRF 校验放在 `preValidation` 无副作用执行；SQL 严格参数化。

### 2.3 前端安全与 DTO 契约
- 路由守卫固定顺序：`AuthGuard -> StatusGuard -> MustChangePwdGuard（仅 ACTIVE） -> RoleGuard`；
- 登录回跳必须经 `sanitizeReturnUrl` 防开放重定向；登出必须先 `SessionRequestManager.abortAndRotate()` 再发 `/auth/logout`；
- 表单提交使用显式 DTO 映射（如 `ProfileReadDTO.username -> user`），严禁展开 GET DTO 直接 `PUT`；修改信任边界须强制重输凭据；
- PAT 单次揭示严格执行三态防呆与关闭清空明文；`409` 乐观锁冲突保留草稿；抽屉/筛选以 URL SearchParams 为唯一事实源。

### 2.4 契约防漂移、未决决策与 Git 门禁
- 实施阶段发现设计矛盾或功能缺口时，是否暂停上报并按 `scripts/*_parts/` → `combine_*.js` → `generate_readiness_contracts.py --check` 流程更新真源（严禁手改 `docs/*.md`）；
- 触及 `AGENTS.md` §4 未决决策项（`RD-08`）时，禁止擅自硬编码写死；
- Git 提交信息（`<subject>` 与正文）、PR 标题与描述、Review 意见及 Issue / Commit 评论等 Git / GitHub 协作信息必须统一使用中文（`<type>(<scope>)` 前缀及技术术语/路径保持英文原文）；
- 严禁 `--no-verify` 跳过钩子，严禁混入 `.env*`、私钥、测试凭据或临时截图/调试产物。

---

## 3. 前端页面视觉对照设计稿门禁

凡涉及 `apps/admin-ui` 页面、组件或布局改动，具备浏览器与多模态能力的 QA 角色（如邓恩）**必须执行真实渲染视觉核验**，不得仅凭纯文本 Diff 放行：

1. **真实打开与截屏对照**：启动真实前端（直连真实后端，非 Mock），在浏览器中截取关键视图（含 **Dark / Light 双模式**、核心抽屉/弹窗态及主要响应式断点），对照 `docs/UI_DESIGN_SPEC.md`、`docs/LAYOUT_SPEC.md` 及视觉原型（`ui-showcase.html`、`admin-console-demo.html`）核验。
2. **该还原的必须达标**：
   - OKLCH 语义化色板与 WCAG 2.1 AA 对比度达标；
   - 锁定尺寸与高密度 `8/10` 视觉层级（Topbar `56px`、Sidebar `240px/64px`、Table `38px` 行高、按钮与 Sheet 抽屉断点、全站数值 `tabular-nums`）；
   - 加载态、空态、错误态、键盘可达路径与焦点归还正常，无控制台报错与未处理 Promise 拒绝。
3. **该剔除的绝不能照抄（皮与骨分离）**：
   - 严禁搬运 HTML 原型的原生 CSS 类名、内联脚本或正式 UI Emoji；
   - 严禁保留原型旧尺寸（`60/64/67px` 等）与展台式“舒适/紧凑”切换器；
   - 严禁出现原型虚构字段与功能（如假 EXPLAIN、AST 穿透树、改写前 SQL、“一键吊销 PAT”按钮、`inviteUser` 弹窗、硬编码演示角色名 `DATA_ANALYST`）。
4. **截图留存红线**：验收截图仅用于任务汇报与人工审阅，**严禁提交进 Git 仓库**。

---

## 4. 诚实举证与双模型交叉二审规则

1. **拒绝口头通过**：每次验收报告必须附带实际执行的命令与原始输出摘要（`typecheck`、`lint`、`generate_readiness_contracts.py --check`、单测、**真实 MySQL 8.0 集成测试**、**Playwright 双端真实联调 E2E**）。严禁拿 Mock 测试或静态渲染冒充真实联调通过。
2. **高危模块触发独立二审**：涉及认证/会话/CSRF、超管并发锁序、SSRF/SSH/密钥加密、ACL/限流防 ABA、AST SQL 防火墙与数据面连接池等高危改动时，在 QA 初审后，建议在任务评论区 `@` 独立安全二审顾问（异构模型、全新干净上下文）执行盲审，两方均无 P0/P1 阻塞项后再提请 Owner Review 放行。

---

## 5. 历史踩坑沉淀区（Post-mortem Rules）

> 每次线上/CI 翻车或发现隐蔽缺陷后，在此追加一条永久检查规则，防止同类问题复发：

- **[M0-01]** 根工作区 `pnpm typecheck` 必须完整覆盖 `apps/admin-ui` 及所有工作区包，禁止漏检前端类型。
- **[M0-02]** Light / Dark 双模式下的语义告警色（如 `--color-warning`）必须满足 WCAG 2.1 AA 文本对比度；任何令牌调整须先经批准同步 `scripts/fe_parts/` 并重新合成校验，避免代码与真源漂移。
