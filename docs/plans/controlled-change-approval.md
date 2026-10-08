# Phase 4-A 受控写入审批与状态机后端实现计划

> 状态：in_progress  
> 任务编号：TASK-APP-006  
> 关联功能：F12 (INSERT 写入), F13 (UPDATE 更新), F14 (DELETE 删除数据), F15 (CREATE 库表), F16 (ALTER 库表), F17 (DROP 库表), F18 (TRUNCATE 表), F19 (本地逐次人工审批), F20 (原生确认与安全后备), F21 (执行去重、超时和重启)  
> 需求来源：R06, R07, R09, R10, R14, R16, R17  
> 任务分支：feat/controlled-change-approval  
> main 基线：`817a701eda4e149890be4f2bf1bd4781d706ab7f`  
> 执行模式：`mode: "code"`（后端核心任务，Antigravity 规划/交付 × PI-Desktop 实施代码与测试）  

---

## 1. 目标与背景

根据 [阶段实施路线图](../ROADMAP.md) 与 [全栈分工与前后端物理隔离协作规范](../FULLSTACK_DIVISION_SPECIFICATION.md)，Phase 1、Phase 2 与 Phase 3（受限读取与 MCP 只读协议）已全部落地并通过 307 项自动化测试与主干合并闭环。项目现正式推进至 **Phase 4：受控写入与审批状态机 (Controlled Changes & Approval State Machine)**。

按照全栈分工与递进拆分原则，Phase 4 拆分为后端核心与前端交互两个子阶段：
- **Phase 4-A（本任务 TASK-APP-006，后端核心）**：由 **PI-Desktop** 在 `mysql-mcp/src/` 与 `mysql-mcp/tests/` 中落地 2 个变更管理 MCP 工具（`request_change` 与 `get_change_status`）、10 状态变更生命周期引擎（包含去重、5分钟到期、版本失效与不可重试 UNKNOWN 故障语义）、Fastify 浏览器管理审批 HTTP 路由、DML/DDL AST 策略分级拦截与后端自动化测试套件；
- **Phase 4-B（后续任务 TASK-APP-007，前端交互）**：由 **Antigravity** 在 `mysql-mcp/web/` 中落地待审批变更列表、详细 SQL 语法高亮审查抽屉/弹窗、CSRF/Nonce 绑定决策提交与执行终态反馈。

---

## 2. 授权范围与绝对禁止事项

### 2.1 授权范围
- 任务允许路径：`mysql-mcp/src/`、`mysql-mcp/tests/`、`mysql-mcp/scripts/`、`docs/`、`governance/`；
- 实施代码路径（PI-Desktop 专职）：
  - `mysql-mcp/src/mcp/`：新增 `request_change` 与 `get_change_status` MCP 工具，完善 Schema 校验与分发；
  - `mysql-mcp/src/server/`：新增 Fastify 审批路由（`GET /api/v1/changes`、`GET /api/v1/changes/:request_id`、`POST /api/v1/changes/:request_id/decision`），实现单次 Nonce 挑战与连接并发锁；
  - `mysql-mcp/src/sql/`：扩充 `policy.ts` 与 DML/DDL 执行器，支持 INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/TRUNCATE 单语句策略拦截与目标一致性校验；
  - `mysql-mcp/src/changes/` 或对应模块：实现 10 状态机（`ChangeManager`）、内存有界存储、单次派发意图锁、版本失效监听与 5 分钟自动清理；
  - `mysql-mcp/tests/changes.test.mjs`：编写全量状态机流转、审批路由、MCP 工具与故障语义单测；
  - `mysql-mcp/scripts/build.mjs`：联动运行 `changes.test.mjs` 测试套件。

### 2.2 绝对禁止事项（双向红线）
1. **PI-Desktop 严禁侵入前端资产**：严禁创建或修改 `mysql-mcp/web/` 与 `mysql-mcp/tests/web/` 下任何文件；
2. **PI-Desktop 严禁执行 Git 交付**：严禁运行 `git commit`、`git push` 或操作 PR，所有产物以 handoff details 交付 Antigravity；
3. **安全凭据绝不泄露**：
   - MCP 工具及审批接口返回数据中，**绝对不包含数据库明文密码或 Keyring 的 credential_ref**；
   - 审批日志与错误响应必须脱敏，严禁向客户端泄露本地系统绝对路径或内网拓扑；
4. **禁止连接外部未授权生产数据库**：全部测试运行于本地回环沙箱与模拟测试驱动中，不连接生产数据库，不执行提权；
5. **严禁自动重试非幂等写入**：对于 `UNKNOWN`、`FAILED` 终态，坚决杜绝任何自动化重试逻辑。

---

## 3. 技术契约与接口规格

依据 [`docs/API_AND_PROTOCOLS.md`](../API_AND_PROTOCOLS.md)、[`docs/DATA_MODELS.md`](../DATA_MODELS.md) 与 [`docs/SQL_POLICY_MATRIX.md`](../SQL_POLICY_MATRIX.md) 锁定的通用契约：

### 3.1 两个 MCP 变更工具契约

#### 1) `request_change`
- **输入参数**（强制 `additionalProperties: false`）：
  - `connection_id: string`（必填，UUID v4）
  - `database: string`（必填，目标数据库，空库或跨库直接拒绝）
  - `sql: string`（必填，DML 或 DDL 单语句）
  - `reason?: string`（可选，变更原因描述，仅保留于内存，不作为批准证据）
- **处理逻辑**：
  - 检查连接是否存在并提取当前 `connection_version`（不存在返回 `NOT_FOUND`）；
  - 调用 `evaluateSql(sql, database)` 进行 AST 分析：
    - 语句必须为单一受支持 DML（INSERT, UPDATE, DELETE）或 DDL（CREATE, ALTER, DROP, TRUNCATE）；
    - 拒绝多语句分号分隔（`;`）、事务控制（BEGIN/COMMIT）、管理命令（GRANT/REVOKE）及外部导入导出（L3 拦截，返回 `SQL_NOT_ALLOWED`）；
    - 检查语句内显式库名前缀与 `database` 参数严格一致（若不一致返回 `TARGET_MISMATCH`）；
    - 无 WHERE 的 UPDATE/DELETE 或 DROP/TRUNCATE/ALTER 标记为 L2 风险，附加风险码 `HIGH_RISK`；常规 DML 标记为 L1 风险；
  - 分配 `request_id` (UUID v4)，生成 AST 标准化结构指纹 `sql_fingerprint` 与原始文本摘要 `exact_sql_digest`；
  - 确定确认通道：若客户端探针未验证，默认降级为 `confirmation_channel: "web"`；
  - 生成针对该请求的单次高熵 `approval_nonce`（32字节HEX，仅认证 Web 页面可见）；
  - 设定 5 分钟过期时间（`expires_at = now + 300_000ms`），状态初始化为 `PENDING` 并入库；
- **输出格式**：
  ```json
  {
    "ok": true,
    "data": {
      "request_id": "uuid",
      "state": "PENDING",
      "confirmation_channel": "web",
      "management_url": "http://127.0.0.1:<port>/changes?id=<uuid>",
      "risk_codes": ["HIGH_RISK"],
      "expires_at": "ISO-8601"
    }
  }
  ```

#### 2) `get_change_status`
- **输入参数**：`request_id: string`（必填，UUID v4）
- **输出格式**：
  - 若不存在或已被清理：返回 `NOT_FOUND` 错误；
  - 若存在：返回当前状态及相关摘要：
    ```json
    {
      "ok": true,
      "data": {
        "request_id": "uuid",
        "state": "PENDING | APPROVED | EXECUTING | SUCCEEDED | FAILED | UNKNOWN | REJECTED | CANCELLED | EXPIRED | INVALIDATED",
        "updated_at": "ISO-8601",
        "result": {
          "affected_rows": 1,
          "last_insert_id": 0,
          "warning_count": 0,
          "execution_ms": 12
        }
      }
    }
    ```

---

### 3.2 10 状态生命周期状态机 (`ChangeState`)

系统定义 10 种严格互斥的状态：

| 状态 | 类别 | 含义 | 下一允许状态 |
|---|---|---|---|
| `PENDING` | 活动中 | 等待人工决策 | `APPROVED`, `REJECTED`, `CANCELLED`, `EXPIRED`, `INVALIDATED` |
| `APPROVED` | 活动中 | 已有效批准，等待派发执行 | `EXECUTING`, `CANCELLED`, `FAILED`, `EXPIRED`, `INVALIDATED` |
| `EXECUTING` | 执行中 | 持有唯一派发权，SQL 正在派发底层 MySQL | `SUCCEEDED`, `FAILED`, `UNKNOWN` |
| `SUCCEEDED` | 终态 | 数据库返回确定性成功回执 | 无（不再派发） |
| `FAILED` | 终态 | 数据库返回确定性错误回执 | 无（不自动重试） |
| `UNKNOWN` | 终态 | 执行超时、网络断连或崩溃，提交结果无法确定 | 无（**坚决不重试**，需人工介入核实） |
| `REJECTED` | 终态 | 人工在界面明确拒绝 | 无（零派发） |
| `CANCELLED` | 终态 | 人工主动取消或会话断开 | 无（零派发） |
| `EXPIRED` | 终态 | 超过 5 分钟未获决策 | 无（零派发） |
| `INVALIDATED` | 终态 | 依赖的连接被编辑或删除，旧请求失效 | 无（零派发） |

#### 状态机流转守卫原则
1. **不可回退**：终态（SUCCEEDED, FAILED, UNKNOWN, REJECTED, CANCELLED, EXPIRED, INVALIDATED）绝不允许重新激活或回退为 PENDING/APPROVED；
2. **唯一派发权**：只有从 APPROVED 流转到 EXECUTING 时获得单次派发权；任何重复批准请求直接报 `409 STATE_CONFLICT`；
3. **版本失效响应**：当 `ConnectionStore` 中某个连接被更新（version 自增）或删除时，监听机制同步将该连接所有处于 `PENDING` 或 `APPROVED` 状态的请求直接置为 `INVALIDATED`；
4. **到期自动清理**：定时器检查或按需检查超过 `expires_at` 的活动请求，自动置为 `EXPIRED` 并清理其 `approval_nonce`。

---

### 3.3 Fastify 审批管理 HTTP 路由

所有管理路由均需要有效的浏览器 HttpOnly Cookie 会话验证。

| 路由 | 方法 | 必须 Header | 参数/请求体 | 行为与安全校验 |
|---|---|---|---|---|
| `/api/v1/changes` | GET | Cookie | 无（拒绝 query 参数） | 返回活动中及最近的变更请求列表摘要（不含明文秘密） |
| `/api/v1/changes/:request_id` | GET | Cookie | 无 | 获取变更详情；返回完整脱敏 SQL、目标库表、风险码及专属于该请求的单次 `approval_nonce` |
| `/api/v1/changes/:request_id/decision` | POST | Cookie, `x-csrf-token` | `{ decision, approval_nonce, sql_fingerprint, connection_version }` | 提交审批决策（`decision`: `"approve"` \| `"reject"` \| `"cancel"`） |

#### `POST /api/v1/changes/:request_id/decision` 强校验流水线：
1. **CSRF 与会话校验**：校验 Cookie 与 `x-csrf-token` 严格匹配；
2. **Nonce 单次消费**：传入的 `approval_nonce` 必须与请求存储的 Nonce 完全一致，验证后**立即销毁该 Nonce**，杜绝重放；
3. **状态校验**：若状态非 `PENDING`（对于 cancel 允许 `PENDING` 或 `APPROVED`），报 `409 STATE_CONFLICT`；
4. **超时校验**：若已过期，置状态为 `EXPIRED`，返回 `409 APPROVAL_EXPIRED`；
5. **指纹校验**：传入的 `sql_fingerprint` 必须与请求记录的指纹完全一致，防止页面审查内容与提交内容不一致；
6. **连接版本校验**：传入的 `connection_version` 必须与当前连接版本完全一致，若连接已被修改报 `409 CONNECTION_CHANGED`；
7. **执行调度**：
   - 若 `decision === 'approve'`：立即将状态置为 `EXECUTING`，获取连接独占使用锁，派发 SQL；
   - 执行成功：置 `SUCCEEDED`，记录受影响行数；
   - 数据库确定报错：置 `FAILED`，记录脱敏错误；
   - 出现超时或断线：置 `UNKNOWN`，记录故障诊断，**坚决不重试**。

---

### 3.4 DML/DDL AST 策略分级 (F12 ~ F18)

在 `mysql-mcp/src/sql/policy.ts` 中增强对变更语法的静态解析与分级：
- **F12 (INSERT)**：AST 顶层操作为 `INSERT`，允许单表插入，列与值匹配；风险等级 L1；
- **F13 (UPDATE)**：AST 顶层操作为 `UPDATE`。若包含 `WHERE` 子句判定为 L1；若**缺少 WHERE 子句**，判定为全表更新，标记 L2 并赋予风险码 `HIGH_RISK`；
- **F14 (DELETE)**：AST 顶层操作为 `DELETE`。若包含 `WHERE` 子句判定为 L1；若**缺少 WHERE 子句**，判定为全表删除，标记 L2 并赋予风险码 `HIGH_RISK`；
- **F15 (CREATE)**：`CREATE TABLE` 或 `CREATE DATABASE`，判定为 L2，标记风险码 `HIGH_RISK`；
- **F16 (ALTER)**：`ALTER TABLE` 或 `ALTER DATABASE`，判定为 L2，标记风险码 `HIGH_RISK`；
- **F17 (DROP)**：`DROP TABLE` 或 `DROP DATABASE`，判定为 L2 破坏性变更，标记风险码 `HIGH_RISK`；
- **F18 (TRUNCATE)**：`TRUNCATE TABLE`，判定为 L2 破坏性变更，标记风险码 `HIGH_RISK`；
- **L3 黑名单绝对阻断**：任何多语句、跨库访问（库名前缀与当前目标不匹配）、`INTO OUTFILE`、`LOAD DATA`、`GRANT/REVOKE`、存储过程、触发器或事务命令（`BEGIN`/`COMMIT`）一律硬性拦截，返回 `SQL_NOT_ALLOWED`。

---

## 4. 实施阶段与测试验收计划

### 4.1 实施规划
1. **领域模型与状态机 (`ChangeManager`)**：
   - 实现内存有界存储、10 状态变迁矩阵、超时清理定时器与版本变更广播监听。
2. **AST DML/DDL 策略适配 (`policy.ts`)**：
   - 扩充 `evaluateSql` 对 INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/TRUNCATE 的解析、分类、指纹生成与风险码打标。
3. **Fastify 路由实现 (`changes.ts`)**：
   - 注册 `/api/v1/changes` 及其子路由，实现 Nonce 消费、指纹对比与执行流转。
4. **MCP 变更工具集成 (`change-tools.ts`)**：
   - 实现 `request_change` 与 `get_change_status`，接入 `createMcpServer`。
5. **自动化测试套件 (`mysql-mcp/tests/changes.test.mjs`)**：
   - 覆盖全部 10 状态流转、版本失效、超时、Nonce 防重放、SQL 指纹校验、DML/DDL 策略分级及 UNKNOWN 故障语义。

### 4.2 构建与测试门禁
- `node scripts/governance/check.mjs`：分支与交接链校验通过；
- `node mysql-mcp/scripts/compile.mjs`（`app-compile`）：TypeScript NodeNext 严格模式零报错；
- `node mysql-mcp/scripts/build.mjs`（`app-build`）：既有 307 项测试 + 新增 `changes.test.mjs` 全量测试全绿。
