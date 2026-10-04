# [TASK-APP-001] 应用工程脚手架、构建门禁与依赖隔离准备

- 变更日期：2026-10-04
- 关联任务：TASK-APP-001
- 关联 PR：待交付
- 关联 Commit：待提交
- 责任执行方：Antigravity (Planning & Documentation Delivery) × PI-Desktop (Implementation)
- 关联功能/需求：F28 (Node.js/TypeScript 应用工程), R12, R13, R16

---

## 📢 发版说明（Release Notes / 面向用户与下游）

### 变更分类与追溯条目
- **🚀 Added**：
  - 在 `mysql-mcp/` 建立原生 ESM TypeScript 生产工程脚手架：包含 `package.json`（v0.1.0-alpha.0，Node >=22）、`tsconfig.json`（严格 NodeNext 模式）、`src/index.ts`（惰性不可变应用描述对象）与 6 项核心冒烟测试用例 `tests/smoke.test.mjs` by @PI-Desktop
  - 新增纯 Node 无 Shell 构建与类型检查入口 `scripts/build.mjs` 与 `scripts/compile.mjs`，接入 `task.build_checks` 机械门禁契约（`app-build` 与 `app-compile`），构建失败自动清理 `dist/`，编译成功自动运行冒烟自检 by @PI-Desktop
  - 新增治理快照与 CI 依赖准备契约 `scripts/governance/prepare.mjs` 与 `scripts/governance/lib/dependencies.mjs`：支持通过 Node 原生定位 `npm-cli.js`（`shell: false`）执行离线 `npm ci --ignore-scripts`，封禁生命周期脚本，严格校验锁文件防篡改并隔离敏感环境变量 by @PI-Desktop
  - 精确锁定 5 个生产运行时直接依赖（`@modelcontextprotocol/sdk@1.32.0`、`@napi-rs/keyring@2.1.0`、`fastify@5.12.5`、`mysql2@3.24.5`、`node-sql-parser@5.4.0`）及开发依赖（`typescript@5.9.3`、`@types/node@22.20.5`），`package-lock.json` 固化 153 个包，安全审计 0 漏洞 by @PI-Desktop
  - 治理测试套件扩充 14 项依赖与快照准备专项测试（`tests/governance/dependencies.test.mjs`），覆盖无应用、缺锁、篡改、安装失败/超时、离线禁脚本等场景 by @PI-Desktop
- **🔄 Changed**：
  - 治理隔离快照执行器 `scripts/governance/run.mjs` 接入依赖准备阶段，在创建纯净快照后自动安装 dev 依赖，彻底解决隔离快照缺少本地编译器导致的构建阻断 by @PI-Desktop
  - GitHub Actions 流水线 `.github/workflows/governance.yml` 引入 `node scripts/governance/prepare.mjs` 准备步骤，保证 CI 与本地语义完全对称 by @PI-Desktop
  - 全面同步 4 份规约文档：[`docs/TECH_STACK.md`](../TECH_STACK.md)、[`docs/DEPLOYMENT_GUIDE.md`](../DEPLOYMENT_GUIDE.md)、[`docs/CODE_REVIEW.md`](../CODE_REVIEW.md)、[`docs/ENGINEERING_TOOLCHAIN.md`](../ENGINEERING_TOOLCHAIN.md)，如实记录 Phase 1 落地现状与依赖契约 by @Antigravity

### 发版亮点摘要 (Highlights)
正式建立了 `mysql-mcp/` 生产应用脚手架与无 Shell 构建编译门禁，精确固化直接与开发依赖版本，并创新性地确立了治理隔离快照与 CI 依赖准备契约，在严格杜绝脏依赖污染的同时保证了受控构建与 155 项自动化测试的百分百全绿通过。

---

## 🛠️ Agent 工程上下文与架构演进（面向开发者与后续 Agent）

### 1. 架构与设计决策 (Why & Design)
- **第一轮实施阻断复盘 (E5 Blocked)**：
  在 TASK-APP-001 第一轮 implementation 中，PI 成功创建了 `mysql-mcp/` 骨架并在本地执行通过。但治理门禁 `run.mjs` 设计为在临时纯净快照目录中运行全部测试与构建，而快照根据 `.gitignore` 不会拷贝 `node_modules`。这导致快照内执行 `app-build` 与 `app-compile` 时，因找不到本地 `tsc` 抛出 `ENOENT` 失败退出。
- **架构方案权衡**：
  - *方案 A（拒绝）*：从宿主工作区直接拷贝 `node_modules` 到快照中。此方案破坏了快照纯净性，可能引入未追踪文件、平台差异或脏编译产物，违反治理隔离红线。
  - *方案 B（拒绝）*：在快照中退回调用全局 `tsc`。此方案破坏了无全局工具假设与版本确定性，CI 或无全局 TypeScript 的机器上必死。
  - *方案 C（采纳）*：建立严格的快照依赖准备契约。由 `scripts/governance/lib/dependencies.mjs` 在快照目录中根据 `package.json` 与 `package-lock.json` 执行 `npm ci`。执行采用原生 Node 定位 `npm-cli.js`（`shell: false`，杜绝 Shell 注入），加入 `--ignore-scripts --include=dev --no-audit --prefer-offline`，严格限制 180s 超时、过滤 `GIT_*` 与 `GOV_*` 等敏感环境变量，并在安装前后校验包文件与锁文件的 SHA256 哈希值，杜绝安装过程产生未声明文件篡改。

### 2. 实际改动文件与逻辑清单 (What)
- **应用工程骨架 (`mysql-mcp/`)**：
  - `package.json` & `package-lock.json`：定义 ESM 模块类型、Node >=22 引擎基线，精确锁定 5 个生产依赖与 2 个开发依赖。
  - `tsconfig.json`：严格模式 NodeNext 配置，开启所有严格检查项并启用声明生成。
  - `scripts/build.mjs`：生产构建脚本，清理旧 `dist/`，调用本地 `tsc` 编译，并在编译后立即执行冒烟测试。
  - `scripts/compile.mjs`：纯类型检查入口，调用本地 `tsc --noEmit`，不产生落盘文件。
  - `src/index.ts`：导出 `APP_NAME`、`APP_VERSION` 以及 `createApplication()`（返回不可变的冻结应用描述对象）。
  - `tests/smoke.test.mjs`：包含 6 项冒烟断言，覆盖包元数据匹配、精确依赖版本锁定、编译器严格配置防御、不可变描述对象拒绝篡改与状态隔离。
- **治理与快照准备 (`scripts/governance/`, `tests/governance/`, `.github/workflows/`)**：
  - `scripts/governance/lib/dependencies.mjs`：跨平台定位 `npm-cli.js`，实现安全的 `prepareDependencies` 核心逻辑。
  - `scripts/governance/prepare.mjs`：根目录运行的直接准备入口。
  - `scripts/governance/run.mjs`：在隔离快照目录绑定与校验完成后，自动执行快照依赖安装，随后执行登记的 `app-build` 与 `app-compile`。
  - `tests/governance/dependencies.test.mjs`：14 项依赖管理与准备专项测试。
  - `.github/workflows/governance.yml`：在运行治理门禁前新增依赖准备步骤。
- **规约与变更文档 (`docs/`)**：
  - `docs/TECH_STACK.md`、`docs/DEPLOYMENT_GUIDE.md`、`docs/CODE_REVIEW.md`、`docs/ENGINEERING_TOOLCHAIN.md` 同步最新事实；
  - `docs/changes/README.md` 与本变更文档登记。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **避坑警示 1（隔离快照零继承工作区依赖）**：
  治理快照绝不会从你的工作区拷贝 `node_modules`！如果在后续任务中新增 npm 依赖，必须确保 `package.json` 与 `package-lock.json` 同步更新，且该依赖能够在 `--ignore-scripts` 离线缓存模式下成功安装。
- **避坑警示 2（纯 Node 与无 Shell 契约）**：
  无论是应用内部脚本（如 `build.mjs`、`compile.mjs`）还是治理调度器，执行命令必须为 `node path/to/script.mjs` 数组入参格式，严禁借助系统 Shell（`cmd.exe` 或 `sh`）执行管道符、分号拼接或重定向。
- **避坑警示 3（协作交接状态机强一致性）**：
  未执行 `handoff.mjs begin` 之前，工作区受控文件快照必须与上一交接事件的 `after` 哈希完全一致。严禁在接收交接（`accept`）与开启新阶段（`begin`）之间修改受控文件，否则会报 `snapshot changed after handoff; begin next authorized phase`。
- **避坑警示 4（构建产物清理与无副作用要求）**：
  `build.mjs` 必须确保在构建前与构建失败时完全清空 `dist/`，杜绝旧产物残留；`compile.mjs` 严禁产生任何落盘文件。
- **避坑警示 5（应用代码入口当前为惰性骨架）**：
  `src/index.ts` 当前仅导出冻结的应用元数据描述符，尚未实现 HTTP 监听、MCP stdio 映射、数据库连接池或系统凭据管理。后续 Phase 2/3 开发必须基于既定规约逐步实现。

### 4. 验证证据 (Verification)
- `node scripts/governance/check.mjs` 静态结构检查通过。
- `node scripts/governance/run.mjs` 全量通过：
  - 82 项 governance-tests 全部 pass；
  - 73 项 collaboration-tests 全部 pass；
  - 隔离快照内依赖安装成功，`app-build`（含 6 项冒烟测试）与 `app-compile` 均以 exit 0 通过。
