# 应用工程化脚手架与构建检查契约规范 (Engineering Toolchain & Build Specification)

> 状态：工程化规范基线；对应特性 F28，需求来源 R12、R13，支撑后续 `mysql-mcp/` 生产代码开发。

---

## 1. 核心定位与工程布局

项目遵循**“根目录纯治理，子目录纯业务”**的严格物理边界：
- 根目录：维护治理脚本（`scripts/governance/`）、治理与流程测试（`tests/governance/`）、规约文档（`docs/`）及 Git 门禁（`.githooks/`、`.github/`）。
- 应用子目录：业务代码全部收敛于 `mysql-mcp/` 独立子工程，具备自包含的依赖描述（`package.json`）、编译配置（`tsconfig.json`）及专用脚本。

```text
工作区根/
├── .github/workflows/          GitHub Actions 自动化流水线
├── .githooks/                  本地 Git 交付拦截钩子
├── docs/                       全局规范体系、计划与变更台账
├── governance/                 功能台账、任务清单与检查定义
├── scripts/governance/         治理门禁核心脚本
├── tests/governance/           治理与协作流程测试套件
└── mysql-mcp/                  生产应用工程（开发落地目录）
    ├── package.json            应用包元数据与直接依赖
    ├── package-lock.json       确定的依赖版本锁定文件
    ├── tsconfig.json           严格模式 TypeScript 配置
    ├── scripts/
    │   ├── build.mjs           纯 Node 生产构建入口（无 Shell）
    │   └── compile.mjs         纯 Node 类型编译检查入口（无 Shell）
    ├── src/                    后端应用源码（ESM TypeScript，PI-Desktop 专职）
    ├── web/                    前端界面资产（HTML/CSS/TS，Antigravity 专职，详见全栈分工规范）
    └── tests/                  应用单元测试与集成测试（Fake沙箱）
```

---

## 2. 运行时与模块系统规范

1. **统一原生 ESM (Node.js ECMAScript Modules)**：
   - `mysql-mcp/package.json` 必须显式声明 `"type": "module"`。
   - 禁止在业务代码中使用 CommonJS（`require()` / `module.exports`），统一使用标准 `import` / `export`。
   - 所有内部相对路径导入必须显式包含 `.js` 扩展名（如 `import { Pool } from './connection.js';`），遵循 TypeScript 的原生 ESM 解析标准。
2. **运行时基线**：
   - 最低兼容运行时为 **Node.js 22 LTS**（当前开发基线为 Node.js v24.16.0）。
   - 充分利用 Node.js 现代内置特性（`node:test` 内置测试运行器、`node:crypto`、`node:path`、`node:fs/promises` 等），减少对第三方轻量工具包的不必要依赖。

---

## 3. TypeScript 编译与质量配置

`mysql-mcp/tsconfig.json` 必须开启最高级别的严格类型安全校验：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests/**/*"]
}
```

---

## 4. 机械门禁构建契约 (`task.build_checks`)

依据 [`COLLABORATION_WORKFLOW.md`](./COLLABORATION_WORKFLOW.md) 第 6 节与第 115 行强校验规则：
> 一旦仓库中引入应用代码或存在 `package.json`，Antigravity 必须在任务中登记 `task.build_checks`，PI-Desktop 在交付前必须运行 `builds` 命令并通过实际证据核实。

为满足治理验证器 `validateBuildDefinitions` 的无 Shell 安全执行约束，应用必须在 `mysql-mcp/scripts/` 下提供两个原子脚本：

| 检查项 ID | `kind` | 执行命令规范 | 职责边界 |
|---|---|---|---|
| `app-build` | `build` | `node mysql-mcp/scripts/build.mjs` | 执行生产构建产物生成（调用编译器打包至 `dist/`），确保产物可完整执行 |
| `app-compile` | `compile` | `node mysql-mcp/scripts/compile.mjs` | 执行纯类型与语法静态检查（如 `tsc --noEmit`），快速发现类型错误 |

### 脚本设计铁律：
1. **纯 Node 入口**：必须能通过 `node mysql-mcp/scripts/xxx.mjs` 直接启动，禁止依赖全局环境命令（如全局 `tsc`），应调用本地 `node_modules/typescript/bin/tsc`。
2. **严禁依赖 Shell 语法**：脚本参数不得包含管道符 `|`、分号 `;`、重定向 `>` 或复杂 shell 拼接。
3. **确定性退出码**：检查成功返回退出码 0；任何语法、类型错误或构建失败必须返回非 0，并在 stderr 输出清晰诊断信息。
4. **无副作用与失败清理**：
   - `compile.mjs` 纯类型检查（`--noEmit`），严禁向磁盘写入任何持久构建产物；
   - `build.mjs` 在构建开始前与构建失败时均清理 `mysql-mcp/dist/`，编译成功后立即调用全部 4 个测试套件（`smoke.test.mjs`、`sql-policy.test.mjs`、`keyring.test.mjs`、`mcp.test.mjs`）执行 127 项应用断言，产物仅允许输出至受 `.gitignore` 保护的 `mysql-mcp/dist/`。

---

## 5. 依赖管理与隔离快照依赖准备契约

### 5.1 直接依赖最小化原则
- 核心依赖严格限定在 [`TECH_STACK.md`](./TECH_STACK.md) 锁定的技术选型矩阵范围内：
  - `@modelcontextprotocol/sdk`：官方 MCP 协议支持
  - `mysql2`：原生协议数据库驱动
  - `fastify`：本地轻量 HTTP 管理服务
  - `node-sql-parser`：SQL 语法树解析辅助
  - `@napi-rs/keyring`：Windows 系统凭据支持（集成测试配合 In-Memory 桩）
  - 开发依赖：`typescript`（5.9.3 编译器）与 `@types/node`（22.20.5 类型声明）

### 5.2 锁定文件强制入库与环境基线
- 安装依赖后必须提交确定的 `mysql-mcp/package-lock.json`（lockfileVersion: 3，153 个包，0 漏洞）。
- 本地与 CI 流水线必须使用 `npm ci` 进行确定性、可复现安装，严禁使用非受控的 `npm install`。

### 5.3 治理隔离快照与 CI 依赖准备契约
为满足测试与构建环境强隔离要求（杜绝污染宿主工作区，亦杜绝工作区临时文件污染验证）：
1. **统一标准入口**：仓库根目录提供 `scripts/governance/prepare.mjs`，依赖核心逻辑收敛于 `scripts/governance/lib/dependencies.mjs`。
2. **禁止复制工作区依赖**：治理快照执行器（`run.mjs`）在生成隔离快照目录后，**严禁从工作区复制 `node_modules`**；必须基于快照内的 `package.json` 与 `package-lock.json` 执行全新的依赖准备。
3. **纯 Node 无 Shell 执行**：通过原生 `process.execPath` 直接调用系统 Node 解析出的 `npm-cli.js`（`shell: false`），跨 Windows 与 POSIX 运行，彻底杜绝 Shell 注入漏洞与命令行封装差异。
4. **安全参数与生命周期脚本封禁**：
   - 执行参数锁定为：`ci --ignore-scripts --include=dev --no-audit --no-fund --prefer-offline --global=false --workspaces=false`；
   - 强制 `--ignore-scripts`，绝对封禁第三方包在安装过程中执行任意生命周期钩子（如 `postinstall`）。
5. **强隔离与防篡改校验**：
   - 超时强限制为 180s，异常超时触发 `SIGKILL` 终止；
   - 过滤敏感环境变量（清理 `GIT_*`、`GOV_*`、`GITHUB_*`、`NODE_OPTIONS` 等）；
   - 执行前后严格比对 `package.json` 与 `package-lock.json` 的 SHA256 哈希值，任何安装过程中的文件篡改均立即抛出异常并使门禁失败。
6. **CI 对齐**：`.github/workflows/governance.yml` 在全量治理门禁运行前执行 `node scripts/governance/prepare.mjs`，确保 CI 与本地运行环境绝对一致。

### 5.4 敏感凭据与测试隔离
- `mysql-mcp/` 内部开发测试严禁硬编码任何真实账号密码。
- 所有运行时临时凭据仅存于内存或受控的系统存储中，严禁在 `mysql-mcp/` 下生成不受版本控制追踪的未命名配置文件。
