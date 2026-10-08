# 技术选型

> 状态：Phase 1 应用工程脚手架（F28）已在 `mysql-mcp/` 落地，固定原生 ESM 与 TypeScript 严格编译契约，锁定直接依赖与开发依赖版本；业务功能（HTTP/MCP/MySQL/凭据）处于规划中，源码入口当前仅提供惰性描述符。

## 1. 选型矩阵与版本锁定

| 领域 | 选型组件 | 实际版本 | 锁定来源 | 职责与当前落地状态 |
|---|---|---|---|---|
| 语言/运行时 | TypeScript / Node.js | TypeScript 5.9.3 / Node >=22 | `package.json` + `tsconfig.json` | 原生 ESM、严格 NodeNext、Windows Node 24.16.0 / npm 11.13.0 实测通过 |
| 包管理 | npm | npm 11.13.0 (lockfile v3) | `package-lock.json` | 官方源 153 个包，0 漏洞，`npm ci --ignore-scripts` 可复现安装 |
| 领域 | 选型组件 | 实际版本 | 锁定来源 | 职责与当前落地状态 |
|---|---|---|---|---|
| 语言/运行时 | TypeScript / Node.js | TypeScript 5.9.3 / Node >=22 | `package.json` + `tsconfig.json` | 原生 ESM、严格 NodeNext、Windows Node 24.16.0 / npm 11.13.0 实测通过 |
| 包管理 | npm | npm 11.13.0 (lockfile v3) | `package-lock.json` | 官方源 153 个包，0 漏洞，`npm ci --ignore-scripts` 可复现安装 |
| MCP | @modelcontextprotocol/sdk | 1.32.0 | 生产直接依赖 | 官方 TypeScript SDK，Phase 3 已落地 5 个受限读取与元数据工具、`BudgetTransport` 预算守卫、`ReadToolService` 依赖注入与 Stdio 协议集成 |
| MySQL | mysql2 | 3.24.5 | 生产直接依赖 | 原生协议驱动，Phase 3 已落地逐请求独立只读会话 (`mysqlReadSession`)、流式行拉取、只读事务与固定 hex 占位元数据查询 |
| 管理 HTTP | Fastify | 5.12.5 | 生产直接依赖 | Phase 2-A 已实现本地回环 Fastify HTTP 服务端 (`createLocalServer`)、内存会话、CSRF 防御、连接原子存储与测试模拟，63项接口单测全绿 |
| SQL 分类 | node-sql-parser + [策略矩阵](./SQL_POLICY_MATRIX.md) | 5.4.0 | 生产直接依赖 | Phase 1-B/3 已实现 AST 辅助语法分类与 L0~L3 风险矩阵 (`evaluateSql`)、LIMIT 1001 哨兵改写及二次 AST 复验 (`prepareReadonlySql`) |
| 系统凭据 | @napi-rs/keyring + [凭据抽象](./DATA_MODELS.md#7-凭据提供者接口与异常脱敏规范) | 2.1.0 | 生产直接依赖 | Phase 1-B 已实现 Windows Keyring 异步封装 (`WindowsKeyringProvider`)，真实系统凭据 CRUD 实测通过 |
| 依赖类型 | @types/node | 22.20.5 | 开发依赖 | Node.js 22 LTS 类型声明支持 |
| 本地 UI | HTML/CSS/JavaScript | 原生标准 ESM | 生产自研 | Phase 2-B 已落地 `mysql-mcp/web/` 本地管理控制台 SPA，零外部大型框架依赖 |
| 测试与沙箱 | [测试策略与假数据直连规范](./TESTING_STRATEGY.md) | `node:test` 内置套件 | 内置测试器 | 本地 Windows 307 项应用测试（server 63、SQL 113、keyring 5、MCP 12、smoke 6、tools 108）全绿 |

### 运行时与安装要求
- **运行时基线**：`mysql-mcp/package.json` 显式声明 `"engines": { "node": ">=22" }`。开发与实测环境为 Windows Node.js v24.16.0 与 npm 11.13.0。
- **离线与可复现安装**：治理隔离快照与 CI 统一使用 `scripts/governance/prepare.mjs` 执行 `npm ci --ignore-scripts --include=dev --no-audit --no-fund --prefer-offline`，严格禁用生命周期钩子脚本，禁止复制工作区 `node_modules`。零新增依赖，锁文件未变。
- **应用构建脚本**：
  - `npm run compile` / `npm run typecheck`：执行 `node scripts/compile.mjs`，调用本地 `tsc --noEmit`，纯类型检查，不向磁盘写入产物。
  - `npm run build` / `npm test`：执行 `node scripts/build.mjs`，构建前清理 `dist/`，调用本地 `tsc` 编译至 `dist/`，并运行全部 6 个测试套件（307 项测试全部通过）。
- **应用入口当前状态**：`mysql-mcp/src/index.ts` 导出 `APP_NAME`、`APP_VERSION`、`createApplication()` 以及安全凭据、SQL 策略、MCP 工厂、Fastify 本地服务工厂与 Phase 3 的 `ReadToolService`、`readTools`、`READ_LIMITS`、`collectRows`、`mysqlReadSession`；导入时不创建端口监听、不连接数据库、不读取系统凭据。

## 2. 工程布局（详见 [工程化规范](./ENGINEERING_TOOLCHAIN.md)）

```text
工作区/
├── docs/                   全局规约、实施计划与变更台账
├── governance/             功能台账、任务清单与门禁检查配置
├── scripts/governance/     治理检查、依赖准备与快照执行脚本
├── tests/governance/       治理测试、快照与协作流测试套件
└── mysql-mcp/              生产应用工程（Phase 3 后端与 Phase 2-B 前端均就绪）
    ├── package.json        应用元数据与精确锁定依赖
    ├── package-lock.json   确定性依赖锁文件（153 packages, 0 vulnerabilities）
    ├── tsconfig.json       严格模式 NodeNext TypeScript 配置
    ├── scripts/
    │   ├── build.mjs       纯 Node 生产构建与 307 项测试联动执行入口（无 Shell）
    │   └── compile.mjs     纯 Node 类型检查入口（无 Shell，不落盘）
    ├── web/                前端管理控制台 SPA（HTML/CSS/JS，Antigravity 专职）
    ├── src/
    │   ├── index.ts        顶层导出聚合器
    │   ├── security/       Windows 系统凭据封装
    │   ├── sql/            SQL AST、L0~L3 策略、只读改写、流式收集与驱动会话
    │   ├── mcp/            MCP Stdio Server、受限读取工具与 BudgetTransport
    │   └── server/         Fastify 本地回环 HTTP 管理服务与会话/连接存储
    └── tests/
        ├── smoke.test.mjs  脚手架冒烟测试（6项）
        ├── keyring.test.mjs Windows 系统凭据 CRUD 实测（5项）
        ├── sql-policy.test.mjs L0~L3 策略矩阵测试（113项）
        ├── mcp.test.mjs    MCP 协议交互与 BudgetTransport 测试（12项）
        ├── server.test.mjs Fastify 接口路由与会话/存储测试（63项）
        ├── tools.test.mjs  受限读取 5 工具与 Schema/截断测试（108项）
        └── web/            前端 UI 与无障碍自动化测试（4项）
```

运行数据拟位于 `%LOCALAPPDATA%/MySQLMCP/`，不与源代码混放。不将连接配置存入待查询的 MySQL，不要求新增 Redis、独立队列或云服务。

## 3. 依赖决策规则

- 先确认必要性、官方来源、维护情况、许可证和安全影响；记录直接依赖及原生安装脚本。
- 解析器只辅助分类，不能承诺所有 SQL 正确识别。不能为了支持一条语句关闭策略检查。
- 凭据模块失败不得降级明文；先报告可复现原因，替代模块或 DPAPI 方案需重新评估。
- 连接池若使用，必须按连接版本隔离并清理会话状态；是否采用池在资源验证后确定。
- 不照搬参考项目的 React/NestJS/Go/Prisma，也不将当前轻量 UI 草案变成用户已锁定的框架要求。

## 4. 首批验证输出

TASK-APP-001（Phase 1）已落地输出：
1. 依赖版本清单与锁文件固化（7 个直接与开发依赖已精确锁定，无安全漏洞）。
2. TypeScript 严格编译与纯 Node 无 Shell 构建脚本落地（`app-build` 与 `app-compile` 门禁契约建立）。
3. 治理隔离快照依赖准备契约落地（`prepare.mjs` 与 `dependencies.mjs`，CI 与快照环境安全 `npm ci`）。
4. 6 项应用冒烟测试在隔离快照中全部通过。
后续 Phase 2 将输出 MCP 客户端兼容证据，Phase 3 输出 SQL 策略矩阵实测与 Windows 原生模块凭据结果。检查和状态记录见[代码审查](./CODE_REVIEW.md)与[部署指南](./DEPLOYMENT_GUIDE.md)。
