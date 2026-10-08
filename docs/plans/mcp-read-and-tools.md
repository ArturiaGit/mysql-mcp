# Phase 3 受限读取及 MCP 协议骨架实现计划

> 状态：in_progress  
> 任务编号：TASK-APP-005  
> 关联功能：F07 (动态数据库与目标隔离), F08 (列出数据库), F09 (列出表), F10 (查看表结构), F11 (受限 SELECT 查询)  
> 需求来源：R04, R05, R06, R07, R08, R14, R16, R17  
> 任务分支：feat/mcp-read-and-tools  
> main 基线：`e94b44660a7c5a720e74c02cc419111db244b066`  
> 执行模式：`mode: "code"`（后端核心任务，Antigravity 规划/交付 × PI-Desktop 实施代码与测试）  

---

## 1. 目标与背景

根据 [阶段实施路线图](../ROADMAP.md) 与 [全栈分工与前后端物理隔离协作规范](../FULLSTACK_DIVISION_SPECIFICATION.md)，Phase 1（脚手架与安全原型）与 Phase 2（Fastify 回环服务、连接管理与前端控制台）已全面交付并通过验证。项目现正式推进至 **Phase 3（受限读取及 MCP / Restricted Read & MCP Protocol）**。

依照大型特性“两阶段递进拆分”策略，本任务为 **Phase 3 后端核心协议与只读执行器任务**，专职由 **PI-Desktop** 在 `mysql-mcp/src/mcp/`、`mysql-mcp/src/sql/` 与 `mysql-mcp/tests/` 中落地 MCP Stdio 协议标准工具骨架、动态数据库目标隔离、受限只读查询执行器、结果硬阈值截断、错误脱敏及后端自动化测试套件。前端界面不参与本任务。

---

## 2. 授权范围与绝对禁止事项

### 2.1 授权范围
- 任务允许路径：`mysql-mcp/src/`、`mysql-mcp/tests/`、`mysql-mcp/scripts/`、`docs/`、`governance/`；
- 实施代码路径（PI-Desktop 专职）：
  - `mysql-mcp/src/mcp/`：MCP 工具定义、Schema 校验、Stdio 请求分发与会话生命周期；
  - `mysql-mcp/src/sql/`：只读 SELECT 语法校验适配、行数/列数/字段硬阈值截断规则、目标库隔离检查；
  - `mysql-mcp/src/index.ts`：更新顶层导出（保持惰性，无隐式自发网络副作用）；
  - `mysql-mcp/tests/mcp.test.mjs` / `mysql-mcp/tests/tools.test.mjs`：编写全量协议帧、只读工具、目标隔离与负面用例单测；
  - `mysql-mcp/scripts/build.mjs`：联动运行相关测试套件。

### 2.2 绝对禁止事项（双向红线）
1. **PI-Desktop 严禁侵入前端资产**：严禁创建或修改 `mysql-mcp/web/` 与 `mysql-mcp/tests/web/` 下任何文件；
2. **PI-Desktop 严禁执行 Git 交付**：严禁运行 `git commit`、`git push` 或操作 PR，所有产物以 handoff details 交付 Antigravity；
3. **安全凭据绝不泄露**：
   - MCP 工具返回的连接元数据中，**绝对不包含密码或 credential_ref**；
   - 错误响应必须经由脱敏模型清洗，严禁向客户端泄露本地文件系统路径、堆栈轨迹或数据库主机内网信息；
4. **禁止连接外部未授权生产数据库**：全部测试运行于本地回环沙箱与模拟测试驱动中，不连接生产数据库，不执行提权。

---

## 3. 技术契约与接口规格

依据 [`docs/API_AND_PROTOCOLS.md`](../API_AND_PROTOCOLS.md) 锁定的通用契约与 MCP 工具草案：

### 3.1 五大只读/元数据工具定义
全部工具必须声明严格的 JSON Schema，并强制设置 `additionalProperties: false`：

| 工具名称 | 必填参数 | 输出内容 | 限制与行为 |
|---|---|---|---|
| `list_connections` | 无 | `items: ConnectionView[]` | 返回脱敏连接列表，不包含密码与系统凭据引用 |
| `list_databases` | `connection_id` | `items: string[]` | 仅返回账号实际可见数据库名称列表 |
| `list_tables` | `connection_id`, `database` | `items: { name: string, type: "table" \| "view" }[]` | 严格绑定目标库，返回表与视图列表 |
| `describe_table` | `connection_id`, `database`, `table` | `{ columns: ColumnMeta[], indexes: IndexMeta[] }` | 返回字段名、类型、主键、索引等结构化元数据 |
| `query` | `connection_id`, `database`, `sql` | `QueryResult` | 仅允许受限 SELECT 查询，强制 AST 策略检查与结果集硬截断 |

### 3.2 动态目标隔离与多库并发保护（F07）
- 每次查询必须显式传入 `connection_id` 与 `database`，严禁从默认库隐式省略推断；
- 严禁多库并发时串用底层连接实例或执行租约；
- 当指定的 `database` 在连接元数据中不存在或无权访问时，确定性返回结构化安全错误。

### 3.3 受限 SELECT 查询与资源硬阈值（F11 & F26）
- **语法策略校验**：联动 Phase 1-B 的 AST 策略引擎（`evaluateSql`），仅允许判定为 L0/L1 的单条只读 SELECT 语句；任何包含写入（INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE）、多语句分号分隔、`INTO OUTFILE`/`INTO DUMPFILE` 或管理员命令（`SET PASSWORD`, `GRANT`）的输入，坚决予以阻断（返回安全错误）；
- **输出资源硬截断**：
  - 行数上限：默认至多返回 1,000 行（超出部分自动截断，并显式标记 `truncated: true`）；
  - 单字段大小上限：单个文本/大字段截断上限 64 KiB；
  - 响应体大小上限：总结果集大小不超过 5 MiB；
  - 执行超时：模拟查询执行超时保护（至多 15 秒）。

### 3.4 MCP Stdio 协议与日志通道分离
- **标准输入输出隔离**：`stdout` 仅且必须输出纯净的标准 JSON-RPC 2.0 协议帧；所有诊断、调试与状态日志强制输出至 `stderr`，严禁污染 `stdout` 导致客户端解析中断；
- **错误模型对齐**：工具业务失败统一标记为 `isError: true` 并返回脱敏错误对象，协议级错误返回标准 JSON-RPC 错误码。

---

## 4. 实施阶段与测试验收计划

1. **测试用例规划**：
   - 验证 5 大工具的参数 Schema 校验与非法参数阻断（额外字段、缺失必填项、负数或越界）；
   - 验证 `list_connections`、`list_databases`、`list_tables`、`describe_table` 的结构化输出与脱敏保证；
   - 验证 `query` 工具对合规 SELECT 的执行与结果结构，以及对恶意 SQL（多语句、DML 篡改、文件读写注入）的确定性阻断；
   - 验证行数截断（`truncated: true`）、大字段截断与超时熔断；
   - 验证动态数据库目标隔离与目标不符报错；
   - 验证 stdio 帧完整性与 stderr 脱敏日志输出。
2. **构建门禁**：
   - `node scripts/build.mjs`（`app-build`）：全部既有测试（190 项）及新增 MCP 测试全绿；
   - `node scripts/compile.mjs`（`app-compile`）：TypeScript NodeNext 严格类型编译无报错。
