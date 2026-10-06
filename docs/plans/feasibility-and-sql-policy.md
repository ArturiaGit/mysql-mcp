# Phase 1-B 关键依赖可行性与核心安全原型实施计划

状态：in_progress
需求来源：R03, R06, R07, R08, R12, R14, R16
关联特性：F06 (Windows 凭据与密码保护), F26 (SQL 策略与资源限制)
授权范围：用户批准方案 A：开展 Phase 1-B 依赖可行性与核心安全原型验证，封装 Windows 系统凭据存储模块，实现基于 AST 的 SQL 风险分级与单语句策略引擎，验证 MCP Stdio 协议骨架，关闭 Q05/Q07，不连接外部生产数据库，不提权。
明确排除：业务数据真实写入、未授权规范篡改；PI 不得执行本仓库 commit/push/PR。
任务分支：feat/feasibility-and-sql-policy
main 基线提交：f2dfffcc45e03871efd33b9b62711d6f7b0cd0ca

## 目标与现状

### 事实
- 治理门禁与协作规范已完备就绪，Hook 快速验签直通与基线缓存机制已全量合并入主干（PR #9, `f2dfffc`）。
- 应用工程脚手架 `mysql-mcp/` 已在 TASK-APP-001 (PR #8) 中初始化，严格 NodeNext ESM 编译器、直接依赖（`@napi-rs/keyring@2.1.0`、`node-sql-parser@5.4.0`、`@modelcontextprotocol/sdk@1.32.0`、`mysql2@3.24.5`、`fastify@5.12.5`）与无 Shell 构建脚本（`build.mjs`, `compile.mjs`）运行正常。
- 待验证项 Q05（Windows 系统凭据模块）和 Q07（SQL 解析与资源限制策略）尚未关闭，Phase 1 退出条件（“安全关键候选依赖可用，不能以明文后备绕过失败”）尚未完全达成。

### 提案
1. **Windows 凭据模块封装与测试 (F06, Q05)**：
   - 在 `mysql-mcp/src/security/keyring.ts` 中封装 `@napi-rs/keyring`，提供强类型的 `setPassword`、`getPassword`、`deletePassword`；
   - 遵循安全约束 C02：凭据存储失败直接抛出异常，坚决不回退到明文存储；增加命名空间隔离（`mysql-mcp:<connection-id>`）；
   - 在 `mysql-mcp/tests/keyring.test.mjs` 中执行真实 Windows Credential Manager 的虚构凭据 CRUD 回归测试并在测试后即时清理，关闭 Q05。
2. **基于 AST 的 SQL 风险分级与单语句策略引擎 (F26, Q07)**：
   - 在 `mysql-mcp/src/sql/policy.ts` 与 `mysql-mcp/src/sql/ast.ts` 中基于 `node-sql-parser` 严格落实 `docs/SQL_POLICY_MATRIX.md` 规范：
     - L0 (只读直通)：SELECT, EXPLAIN, DESCRIBE，校验无写操作与跨库前缀；
     - L1 (常规受控 DML)：带 WHERE 条件的 INSERT, UPDATE, DELETE；
     - L2 (高危 DML/DDL)：无 WHERE 的全表更新/删除、CREATE/ALTER/DROP/TRUNCATE 库表结构变更，标记 `HIGH_RISK`；
     - L3 (绝对黑名单阻断)：多语句拼接（含分号）、跨库表名前缀（如 `other_db.tbl`、`mysql.*`）、`INTO OUTFILE`、用户自管事务（`BEGIN/COMMIT`）、存储过程与账号管理，硬性拦截阻断并返回 `SQL_NOT_ALLOWED`；
   - 在 `mysql-mcp/tests/sql-policy.test.mjs` 中构建 100% 确定性内存单测矩阵，覆盖 L0~L3 的正反例，关闭 Q07。
3. **MCP Stdio 协议原型 (F28)**：
   - 在 `mysql-mcp/src/mcp/server.ts` 中基于 `@modelcontextprotocol/sdk` 创建基础 MCP Server 实例与 Stdio 通道原型；
   - 在 `mysql-mcp/src/index.ts` 中统一导出安全凭据模块、SQL 策略模块与 MCP 协议骨架。
4. **构建与测试联动**：
   - 更新 `mysql-mcp/scripts/build.mjs`，在编译后自动执行 `smoke.test.mjs`、`keyring.test.mjs` 与 `sql-policy.test.mjs`，确保 `task.build_checks` 机械门禁全绿。

## 文件与行为

### Antigravity 规划交付
- `docs/plans/feasibility-and-sql-policy.md`：本实施计划。
- `docs/plans/README.md`：登记 TASK-APP-002。
- `governance/tasks.json`：登记 TASK-APP-002，回填 TASK-GOV-008 `pr: 9`。
- `governance/features.json`：关联 F06、F26、F28 到 TASK-APP-002。
- `docs/changes/README.md`：回填 TASK-GOV-008 关联 PR #9 与 Commit `f2dfffc`。
- `docs/changes/2026-10-05-TASK-GOV-008-governance-verification-performance.md`：回填 PR #9 与 Commit `f2dfffc`。
- `docs/FEATURE_STATUS.md`：由 `report.mjs --write` 更新。

### PI-Desktop 实现交付
- `mysql-mcp/src/security/keyring.ts`：Windows 凭据存储封装。
- `mysql-mcp/src/sql/policy.ts` & `mysql-mcp/src/sql/ast.ts`：SQL AST 解析与 L0~L3 风险策略引擎。
- `mysql-mcp/src/mcp/server.ts`：MCP Stdio 基础协议骨架。
- `mysql-mcp/src/index.ts`：应用入口聚合导出。
- `mysql-mcp/tests/keyring.test.mjs`：凭据管理器 CRUD 与异常测试。
- `mysql-mcp/tests/sql-policy.test.mjs`：L0~L3 策略矩阵纯内存测试。
- `mysql-mcp/scripts/build.mjs`：联动执行全部测试。

## 实施步骤

1. Antigravity 完成 Planning 阶段：更新任务及特性台账、回填历史 PR #9 元数据、定稿计划、生成 handoff prompt。
2. 用户人工转交 prompt 给 PI-Desktop。
3. PI-Desktop 显式接受交接（`handoff.mjs accept`）并进入 implementation 阶段（`handoff.mjs begin`）。
4. PI-Desktop 实现 `keyring.ts`、`policy.ts`、`server.ts` 及对应单元测试。
5. PI-Desktop 运行 `npm run compile`、`npm run build`、`node scripts/governance/handoff.mjs builds --task TASK-APP-002 --role pi-desktop`。
6. PI-Desktop 运行 `node scripts/governance/run.mjs` 确保快照与构建检查全绿。
7. PI-Desktop 完成阶段（`finish`）并生成反向 prompt。
8. 用户转交回 Antigravity，Antigravity 验收代码、同步变更文档、自动 commit、push、创建 PR 并查询 CI。

## 验收

- `node scripts/governance/check.mjs` 门禁通过。
- `node scripts/governance/run.mjs` 隔离快照运行全量通过（含既有测试、`app-build` 与 `app-compile`）。
- 凭据测试与 SQL 策略测试在 Windows 平台与 CI 离线环境下 exit 0。
