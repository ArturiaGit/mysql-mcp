# M0：双端工程底座、机械护栏与 `/_lab` 组件实验室

- **主进度索引**：[`../TODO.md`](../TODO.md)
- **状态**：`[x] 已完成`（Step 1~3 本地 QA、PR #1 远端首轮 CI / CodeQL / Secret Scanning 全绿通过）
- **目标**：搭建 Monorepo 工程骨架、TS/ESLint 机械护栏、Docker MySQL 14 表初始化基线与开发态 `/_lab` 组件实验室，确保后续业务模块在同一套底座与高保真组件库上开发。

---

## 1. 必读依据（轻量分片直读）

- **后端分片**：`scripts/be_parts/part2_adr.md`、`scripts/be_parts/part3_monorepo.md`、`scripts/be_parts/part4_database_and_dal.md`；物理 SQL：`docs/sql/001_metadata_schema.sql`
- **前端分片**：`scripts/fe_parts/part2_adr.md`、`scripts/fe_parts/part3_monorepo.md`、`scripts/fe_parts/part5_layout_paradigms.md`（§5.1 全局骨架）、`scripts/fe_parts/part9_errors_and_tokens.md`
- **视觉规范**：`docs/UI_DESIGN_SPEC.md`、`docs/LAYOUT_SPEC.md`
- **原型参考**：`ui-showcase.html`（全部 5 个展台区块与 6 个弹窗）；`admin-console-demo.html`（仅参考全局骨架与响应式断点，不抄旧色值/旧高度）
---

## 2. 后端与基建交付清单

- [x] 初始化 Git 与提交/版本规范基线：
  - 初始化 `.git`、`.gitignore`（严格屏蔽 `.env*`、私钥、`node_modules`、构建与临时产物）、`.editorconfig`
  - 根 `package.json` 初始版本号设为 `0.1.0`（SemVer 2.0.0），Monorepo 内部引用统一 `workspace:*`
  - 配置 `commitlint` + 本地 Git 钩子（`lefthook` 或 `husky`），强制校验 Conventional Commits v1.0.0
- [x] 初始化 `pnpm` Monorepo 骨架：
  - `apps/gateway`、`apps/admin-api`、`apps/admin-ui`
  - `packages/shared-types`、`packages/security`、`packages/core-ast`、`packages/core-engine`
- [x] 根 `package.json` 精确锁定版本（禁止 `^` / `~`）：`mysql2@3.24.6`、`node-sql-parser@5.4.0`、`fastify@5.12.8`、`@node-rs/argon2@2.0.2`、`ssh2@1.16.0`
- [x] 配置根 `tsconfig.base.json`（`strict: true`、`noImplicitAny: true`、`noUncheckedIndexedAccess: true`）
- [x] 配置 ESLint 机械护栏：
  - 禁止 `as any`、`@ts-ignore`、`@ts-expect-error`
  - 除 `packages/core-engine` 指定连接模块外，全仓禁止直接 `import 'mysql2'` / `'mysql2/promise'`
  - 强制包单向依赖边界（`packages/*` 不得引用 `apps/*`；`apps/admin-ui` 不得引用后端包；`packages/shared-types` 零运行时依赖）
- [x] 准备本地 Docker MySQL 8.0（`>= 8.0.16`）启动配置与 `docs/sql/001_metadata_schema.sql` 一键导入脚本
- [x] 落地 `packages/shared-types` 基础类型：`EntityId = string`、状态字面量联合、错误码契约类型
- [x] 落地 `packages/core-engine` 的 `MetadataPool`（`supportBigNumbers: true, bigNumberStrings: true`、每次借连接 UTC 会话设定）与 `MetadataQueryExecutor` 安全工厂
- [x] 落地 `apps/admin-api` 与 `apps/gateway` 最小宿主骨架及 `/health/live`、`/health/ready`
- [x] 搭建 `.github/` CI/CD 与安全审计配置（所有 workflow 显式收紧最小 `permissions`）：
  - `.github/workflows/ci.yml`：PR/push 自动跑 `commitlint`、`python scripts/generate_readiness_contracts.py --check`、`pnpm typecheck`、`pnpm lint`、GitHub Actions `mysql:8.0` 建表与集成测试、前端构建与包体预算校验
  - `.github/workflows/security.yml`：CodeQL（`javascript-typescript`）SAST 扫描 + `pnpm audit --audit-level=high` 依赖漏洞审计
  - `.github/dependabot.yml`：仅做安全告警与 PR 审查（不自动合并核心锁定依赖 `mysql2`/`node-sql-parser`/`fastify`/`@node-rs/argon2`/`ssh2`）
  - `.github/workflows/release.yml`：`v*.*.*` Tag 触发，CI 与安全门禁全绿后生成构建产物/SBOM 与 GitHub Release

---

## 3. 前端与 `/_lab` 组件实验室清单

- [x] 初始化 `apps/admin-ui`（Vite 6 + React 19 + Tailwind CSS v4 + `@theme`）
- [x] 落地统一样式令牌：
  - `src/styles/theme.css`：对齐 `FRONTEND_ARCHITECTURE_SPEC.md` §9.3 OKLCH Dark/Light 双模式变量（Dark 默认 `#090D16` / `#111827` / `#233044`）
  - `src/styles/globals.css`：`.skip-link`、`tabular-nums`、`prefers-reduced-motion`
- [x] 落地 `src/components/ui/*` 紧凑组件（`button`、`badge`、`table`、`dialog`、`sheet`、`tooltip`、`tabs`、`toast`、表单控件）及 Lucide SVG 图标封装（禁止 Emoji）
- [x] 落地全局骨架（`src/layouts/*`）：
  - `AppShell`、`Sidebar`（`240px / 64px` 折叠）、`Topbar`（固定 `56px` / `h-14`）、`CommandPalette`（`Ctrl+K` / `⌘K`）、`InspectSheet` 壳体（`600px / 540px / 70vw / 85vh` 断点）
- [x] 落地开发态路由 `/_lab`（`src/views/_lab/DesignSystemLabView.tsx`，仅 `import.meta.env.DEV` 挂载），完整复刻 `ui-showcase.html` 的基础交互、数据表（`38px` 行高）、双漏斗预览、安全模式演示与令牌展示

---

## 4. 模块验收门禁（全部通过才可勾 `[x]`）

- [x] `pnpm typecheck` 与 `pnpm lint` 零报错
- [x] `python scripts/generate_readiness_contracts.py --check` 通过
- [x] Docker MySQL 成功导入 `001_metadata_schema.sql`（14 张表及 `bootstrap_state = 'PENDING'`），`admin-api` 连接测试与健康探针通过
- [x] 浏览器对照 `ui-showcase.html` 核验 `/_lab`：Dark/Light 双模式对比度正常、`38px` 表行、`56px` Topbar、键盘导航（`Tab` / `Ctrl+K` / `Esc` 归还焦点）全部正常
- [x] `commitlint` 钩子实测有效（拦截非法 commit 信息、放行合规提交），`.gitignore` 拦截敏感文件
- [x] `.github/workflows/*.yml` 与 `.github/dependabot.yml` 校验通过（推送 GitHub 远端后 CI 与 CodeQL 首轮全绿，并确认开启 Secret Scanning / Push Protection）
