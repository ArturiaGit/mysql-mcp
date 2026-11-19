## 第二章：技术选型与架构决策记录 (ADR)

### 2.1 ADR-01: 核心语言与单主进程模型 (Node.js 22 LTS 单事件循环架构)
- **决策结论**：单节点网关采用 **Node.js 22 LTS 单主进程事件驱动模型 (Single Process)**，坚决不采用无共享状态的 Node Cluster 多 Worker 模式。
- **背景与技术评估**：
  - **Node Cluster 多 Worker 陷阱**：在多 Worker 独立内存下，每个进程各自维护本地计数，会导致单节点实际承受的在途并发上限（如 `5 * 4 = 20`）、物理连接池总数（如 `10 * 4 = 40`）与 QPM 配额成倍翻倍，彻底击穿底层数据库的物理保护边界；
  - **性能目标定位**：基于轻量 AST Visitor 算法设计与 Node.js 异步 I/O 模型，单主进程理论上可满足单机 1000+ QPS 的设计目标，实际吞吐量将在原型代码完成后通过基准测试脚本验证；
  - **水平扩展归入模式 B**：多节点横向扩展统一依赖接入层负载均衡与 Redis 集中状态总线，在单节点内严格保持单进程严密自洽。

---

### 2.2 ADR-02: 协议适配层与业务状态解耦 (MCP 2026 规范自包含请求快照)
- **决策结论**：引入协议适配层，解除传输层连接对业务状态的单点绑定；核心查询工具支持显式指定 `profile` 与 `database`；每次请求挂载自包含不可变的 `RequestContextSnapshot`。
- **架构决策依据**：
  1. **适配 MCP 2026 官方基线**：屏蔽 Streamable HTTP (POST /mcp)、Legacy HTTP+SSE 与 Stdio 差异，统一解构为内部标准调用；
  2. **消除伪状态风险**：快照中携带 `authVersion`、`patId`、`patExpiresAt`、`snapshotCreatedAt`、`snapshotTtlMs` 与 `globalPolicyVersion`。借出连接前执行全量二次校验，排队期间用户若被冻结、改密或 PAT 自然到期，立即快速失败，防排队越权。

---

### 2.3 ADR-03: 数据库驱动与精确版本治理 (mysql2: 3.24.6 + 原生 reset + 1.5s 超时)
- **决策结论**：精确锁定驱动版本为 **`mysql2: "3.24.6"`**（提交锁文件，禁止版本范围漂移）；数据面执行层统一采用原生 callback 风格的 `mysql2.PoolConnection`，直接调用官方状态机接口 **`conn.reset(cb)`**；增设 **1500ms 复位硬超时定时器**；确立 **Fail-Destroy** 物理销毁原则。
- **架构决策依据**：
  1. **统一连接契约，消灭类型混乱**：杜绝混用 Promise 包装层与底层 Socket。直接使用底层 callback 风格连接，天然同时支持原生 `conn.reset(cb)`、`conn.query({ sql, values, rowsAsArray: true }).stream()`、`conn.release()` 与 `conn.destroy()`，消除所有的 `as any` 不安全强转；
  2. **精确版本确认**：官方在 v3.24.0+ 正式原生集成了 `COM_RESET_CONNECTION (0x1F)` 命令支持，`conn.reset(cb)` 自动下发命令码、挂入驱动队列等待服务端 `OK_Packet (0x00)`，并同步清除预编译语句缓存 (Prepared Statements)；
  3. **复位超时兜底**：若 MySQL 底层发生网络死锁或 Socket 丢包导致 1500ms 内未收到 OK 包，立即主动抛出超时异常；
  4. **Fail-Destroy 铁律**：复位超时、复位失败、或者连接经历过客户端中断/取消，**一律直接调用 `conn.destroy()` 强制物理切断套接字**，从池中剔除并重新建立新连接，绝不心存侥幸归还连接池。

---

### 2.4 ADR-04: SQL AST 与三层立体防御 (库名前缀优先 + 物理最小权限只读兜底)
- **决策结论**：选用 `node-sql-parser` 配合自研作用域栈 Visitor，明确“显式库名前缀优先解析”，并以“数据库底层账号最小只读权限”为第一道不可突破的物理硬屏障。
- **架构决策依据**：
  1. **前缀优先封堵绕过漏洞**：在 MySQL 规范中，带显式库名的表引用（如 `finance.salary`）永远作为真实物理对象解析，绝不匹配 CTE 别名。网关算法严格与之对齐；
  2. **物理权限兜底**：纯文本 AST 无法识别视图背后隐藏的敏感物理表，也无法感知定义者特权对象与带写副作用的存储函数。DBA 在 MySQL 实例上严格仅给网关账号授权目标表 `SELECT` 权限，彻底移除所有写、`FILE`、`SUPER`、`EXECUTE` 特权。

---

### 2.5 ADR-05: Web 控制台前端与全量后端守卫 (React 19 + 后端全量 API 强制改密拦截)
- **决策结论**：Web 控制台采用 React 19 + Tailwind v4 + shadcn/ui；管控后端挂载全量全局改密拦截中间件 (`forceChangePasswordGuard`)。
- **架构决策依据**：未改密账号除了访问密码重置接口与获取自身信息接口外，后端一律返回 HTTP 403 阻断访问任何管理 API，并禁止签发任何 PAT。

---

### 2.6 ADR-06: 状态机驱动的取消租约锁、有界收尾与流式 rowsAsArray 防护
- **决策结论**：为每次查询生成全局单调唯一的 `query_instance_id`，取消状态转移 `RUNNING -> CANCELING` 引入**连接租约锁 (Lease Lock)**，Admin KILL 操作加装 **2000ms 独立硬超时** 并提供本地有界清理收尾；查询执行强制启用 **`rowsAsArray: true`** 并建立分层内存预算。
- **架构决策依据**：
  1. **消除取消与完成的竞态**：被取消的连接被租约独占锁定，正常完成路径严禁归还连接池；Admin KILL 即使超时或挂死，本地 2000ms 定时器到期无条件调用 `conn.destroy()` 切断物理连接并清理在途配额，彻底消除连接挂死与误杀下一请求的致命风险；
  2. **消除错列与重名列覆盖**：强制开启 `rowsAsArray: true`，从 `fields` 事件提取列名，杜绝 JavaScript 对象键自动重排与 JOIN 重名列被覆盖丢列的问题；
  3. **分层内存预算**：明确协议包最大限制 (16MB)、单行单字段截断 (64KB)、结果集返回预算 (5MB) 与单用户并发总预算 (25MB)，防止堆内存耗尽。
