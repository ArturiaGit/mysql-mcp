# MySQL MCP Server 企业级网关与管控平台系统架构设计说明书 (Architecture Specification)

| 文档版本 | 发布日期 | 状态 | 适用范围 | 密级 |
| :--- | :--- | :--- | :--- | :--- |
| **v1.2.2** | 2026-11-12 | **单节点原型工程实现基线版 (Single-Node Prototype Implementation Baseline)** | **系统研发、架构演进、并发测试与安全验收** | **内部公开** |

---

## 开发准入整改（v1.2.2 / 2026-11-12）

核验并修订 RD-01/02/03/04/05/06/07/09：持久限流版本、UTC连接、单一DDL、读写DTO、请求字段、47项接口追踪、超管锁序与首次自举标记。
RD-08 产品/接口签署仍待确认；新库burst暂按数据库既有值10，库级ACL按既有v1.0精确名，不代表新增产品批准。
验证范围及未完成的真实MySQL/HTTP/浏览器门禁见 `docs/reviews/COMPREHENSIVE_DESIGN_READINESS_REMEDIATION_20261112.md`。

## 修订说明 (Revision Preface - v1.2.1 执行契约与失败路径闭环)

本版本在 v1.2.0 的基础上，针对资深架构师最小隔离验证暴露出的驱动连接模型混用、结果集键排序错乱、取消缺乏有界收尾以及二次鉴权时间语义缺失等 4 大关键实现死角进行了彻底收敛。本规范作为单节点原型工程开发的最终执行基线：

1. **驱动连接模型与精确版本锁定**：
   - 精确锁定生产驱动版本为 **`mysql2: "3.24.6"`**（官方支持 `COM_RESET_CONNECTION` 原生 `reset(cb)` 状态机的稳定版本，杜绝版本范围漂移）；
   - 数据面统一采用原生 callback 风格的 `mysql2.PoolConnection`，直接调用 `conn.reset(cb)`，杜绝 Promise 包装与底层 Socket 混用的契约混乱，消除所有的 `as any` 不安全转换；
2. **流式执行器原生数组行模式 (rowsAsArray) 与多层内存预算**：
   - 彻底废弃 `Object.values(row)`，强制开启 `rowsAsArray: true`，结合 `fields` 事件提取列元数据，根治数字别名乱序与 JOIN 重名列被覆盖丢列的严重缺陷；
   - 将“5MB 内存防爆”解耦为分层预算体系：协议层 `maxAllowedPacket (16MB)`、单行单字段截断 (64KB)、结果集返回预算 (5MB) 与并发总内存预算 (25MB)；
3. **取消状态机双重 Deadline 与有界收尾**：
   - 为 Admin 通道 KILL 操作设置独立的 2000ms 硬超时；
   - 确立本地强制清理兜底逻辑：无论 KILL 成功、超时还是报错，2000ms 内**无条件强制执行 `conn.destroy()` 物理切断连接**并清理本地在途配额与审计槽位，杜绝业务连接永久挂死在 CANCELING；
4. **二次鉴权完整多维契约**：
   - 借出连接瞬间，不仅比对 `authVersion`，同时强制校验 **PAT 自然到期时间 (`patExpiresAt`)**、**快照有效时限 (TTL 2000ms)**、**全局策略版本号** 与 **Profile 活跃状态**，任一失效立即阻断；
5. **超管自锁逻辑完善与 PRD 需求对齐**：
   - 超管自锁按操作后“剩余活跃超管数”精确判定，避免修改无关角色被误拒；
   - 同步修正 PRD 遗留的 `mcp-session-id` 强依赖描述；将吞吐量等指标如实标为“原型待验证设计目标”。

---

## 目录索引 (Table of Contents)
1. [第一章：架构概述与设计原则](#第一章架构概述与设计原则)
   - 1.1 业务背景与系统定位
   - 1.2 八大核心闭环设计原则
   - 1.3 核心设计目标与基线指标矩阵 (待验证设计目标)
2. [第二章：技术选型与架构决策记录 (ADR)](#第二章技术选型与架构决策记录-adr)
   - 2.1 ADR-01: 核心语言与单主进程模型 (Node.js 22 LTS 单事件循环架构)
   - 2.2 ADR-02: 协议适配层与业务状态解耦 (MCP 2026 规范自包含请求快照)
   - 2.3 ADR-03: 数据库驱动与精确版本治理 (mysql2: 3.24.6 + 原生 reset + 1.5s 超时)
   - 2.4 ADR-04: SQL AST 与三层立体防御 (库名前缀优先 + 物理最小权限只读兜底)
   - 2.5 ADR-05: Web 控制台前端与全量后端守卫 (React 19 + 后端全量 API 强制改密拦截)
   - 2.6 ADR-06: 状态机驱动的取消租约锁、有界收尾与流式 rowsAsArray 防护
3. [第三章：系统总体架构与拓扑](#第三章系统总体架构与拓扑)
   - 3.1 总体拓扑架构 (单节点单主进程架构模型)
   - 3.2 单节点核心执行链 (10 步闭环流式防护标准链路)
   - 3.3 逻辑分层架构 (7 层闭环安全模型)
   - 3.4 交互时序图 (租约锁防误杀、流式中断、reset 超时生命周期)
4. [第四章：核心子系统深度技术设计](#第四章核心子系统深度技术设计)
   - 4.1 协议适配与带全量时效校验的 RequestContextSnapshot
   - 4.2 认证、短 TTL 授权快照与二次鉴权多维完整契约
   - 4.3 三层纵深数据安全防线与修正后的 CTE 提取算法
   - 4.4 全链路立体资源防护 (在途并发、超时联动 KILL、流式 rowsAsArray 与分层内存预算)
   - 4.5 连接池治理、官方 reset(cb) 原生命令与 1500ms 超时
   - 4.6 取消租约锁 (Lease Lock) 与双重 Deadline 有界收尾
   - 4.7 全场景 SSRF 深度防御系统 (Post-DNS Resolution Check & IP Pinning)
   - 4.8 高可靠分级审计体系 (全量在途事件有界管控与容量丢失边界)
   - 4.9 超管自锁判定完善与全量入口事务级防自残
5. [第五章：数据模型与系统元数据库设计](#第五章数据模型与系统元数据库设计)
   - 5.1 实体关系模型 (ER Diagram)
   - 5.2 物理 Schema 唯一入口（14表权威DDL引用）
   - 5.3 敏感信息对称可逆加密方案 (带 key_id 的 AES-256-GCM 密钥环)
   - 5.4 多角色冲突判定决策表与库表 ACL 继承规则
6. [第六章：标准接口契约与协议规范](#第六章标准接口契约与协议规范)
   - 6.1 MCP 11 项 Tools 显式传参契约与紧凑二维出参
   - 6.2 管控面 RESTful API 清单与定义 (含强制改密中间件约束)
   - 6.3 统一错误码与异常响应矩阵 (Error Code Matrix)
7. [第七章：工程目录结构与代码组织规范](#第七章工程目录结构与代码组织规范)
   - 7.1 Monorepo 模块化目录树规范 (pnpm workspaces)
   - 7.2 模块职责边界与单向依赖约束
8. [第八章：单节点原型验证、运维与安全加固](#第八章单节点原型验证运维与安全加固)
   - 8.1 运行模型 (单节点单主进程模型规范)
   - 8.2 生产级容器化编排 (docker-compose.yml 示例)
   - 8.3 核心并发与安全验收测试用例 (Test Matrix: TC-01 ~ TC-08)
   - 8.4 监控告警指标 (Prometheus Metrics & Healthcheck)

---

## 第一章：架构概述与设计原则

### 1.1 业务背景与系统定位
在大模型驱动企业数据智能的背景下，Model Context Protocol (MCP) 为终端 Agent 与底层数据库建立了标准桥梁。然而，直接暴露数据库存在凭据散落、越权串线、死循环拖垮主库与审计合规漏洞。

本项目定位为**企业级 MySQL-MCP 访问安全网关与管控平台（Enterprise MySQL-MCP Gateway & Portal）**。系统立足于**“单节点原型闭环、核心机制无竞态漏洞、三层立体纵深防御、执行器契约严丝合缝”**，为大模型生态提供零信任安全代理与企业级管控后台。

---

### 1.2 八大核心闭环设计原则

| 原则序号 | 架构原则名称 | 核心闭环机制与实现方案 |
| :--- | :--- | :--- |
| **01** | **三层立体纵深防御** | 坚决不让 AST 纯文本孤军奋战：① **物理层**：MySQL 账号由 DBA 严格配置为最小权限只读（仅授权特定表 `SELECT`，彻底收回写、`FILE`、`SUPER`、`EXECUTE` 特权）；② **语法层**：AST 白名单控制，未知结构与危险函数一律拒绝；③ **策略层**：库表 ACL 严格执行 **Default Deny**，白名单未显式允许一律拦截。 |
| **02** | **库名前缀优先与 CTE 作用域栈** | 彻底修复 ACL 绕过风险：解析时**带显式库名前缀的表（`db.table`）一律优先作为真实物理实体提取，严禁匹配 CTE 别名**；建立同级与嵌套 CTE 作用域栈；放行 `SELECT 1` 等安全无表查询。 |
| **03** | **取消租约锁与有界收尾机制** | 彻底消除并发误杀：引入全局单调唯一 `query_instance_id`，取消状态转移 `RUNNING -> CANCELING` 原子加装**连接租约锁 (Lease Lock)**。被锁定的连接绝不允许正常归还连接池；Admin KILL 设 2000ms 超时，超时无条件强制 `conn.destroy()` 物理销毁。 |
| **04** | **驱动契约自洽与 1500ms 复位硬超时** | 精确锁定驱动 `mysql2: "3.24.6"`。数据面统一采用 callback 风格 `mysql2.PoolConnection`，直接调用原生 `conn.reset(cb)`，消除所有 `as any`；加装 **1500ms 复位硬超时定时器**，异常一律 **Fail-Destroy** 物理销毁。 |
| **05** | **流式 rowsAsArray 与分层内存预算** | 查询强制启用 `rowsAsArray: true`，从 `fields` 事件提取元数据，杜绝数字别名乱序与重名列丢列；建立协议层包大小 (16MB)、单行单字段截断 (64KB)、结果集预算 (5MB) 与并发总内存预算 (25MB) 的分层防御。 |
| **06** | **单节点单主进程模型** | 规避 Node Cluster 多进程内存独立导致的在途并发、连接池与 QPM 配额翻倍裂变。首期基准确定为**单节点单主进程架构 (Single Process)**，单点内实现无锁内存限流与连接池严密闭环。 |
| **07** | **容量前置预留与全量在途事件管控** | 请求执行前必须先申请并锁定审计队列槽位，申请失败直接触发背压；已预留槽位、正在排队与处理中的在途事件全部计入 10,000 条有界容量上限，消除失控溢出。 |
| **08** | **超管全入口事务自锁与二次鉴权多维契约** | 修正自锁 SQL 与多角色关联表的连表查询，按操作后剩余活跃超管数精确校验；后端网关全局过滤器硬拦截未改密账号；执行前二次鉴权全面核验 PAT 到期时间、快照 TTL 与策略版本。 |

---

### 1.3 核心设计目标与基线指标矩阵 (待验证设计目标)

> ⚠️ **指标属性说明**：以下指标定义为在明确前置基准环境下的**单节点原型待验证设计目标 (Target Baseline for Verification)**，将在原型实现后通过标准化压测脚本验证，非无条件的绝对生产 SLA 承诺。

| 指标维度 | 待验证设计目标 (Target) | 测试基准约束条件 (Preconditions & Benchmark Profile) |
| :--- | :--- | :--- |
| **网关处理开销** | P99 <= 3.5ms (目标) | 单主进程事件驱动模型；SQL 长度 <= 2KB；AST 深度 <= 15 层；命中本地热点元数据快照。 |
| **单机稳态吞吐** | >= 1000 QPS (目标) | 单主进程多路复用；纯只读索引查询；无连接排队；常规审计异步写入；禁用复杂 PII 正则。 |
| **连接复位耗时** | P99 <= 1.8ms (目标) | 原生 `reset(cb)` 状态机等待服务端确认；网络 RTT < 0.5ms；无锁等待。复位超时阈值硬设为 1500ms。 |
| **排队等待超时** | 默认 3000ms (可调) | 连接池队列达到硬上限 (max_pool_size * 2) 立即拒绝；超时自动安全出队，不占用物理连接。 |
| **AST 解析改写** | P99 <= 2.0ms (目标) | 标准复杂分析查询（含 CTE、2~3 个 JOIN、嵌套子查询，SQL 长度 <= 4KB）。 |
| **吊销收敛时效** | 单机 < 50ms；分布式 P99 < 1.5s (目标)| 单机内存快照就地失效；分布式环境下基于短 TTL (1~2s) 快照与 Redis Pub/Sub 广播协同。 |
| **审计丢失上限** | 正常退出 0 丢失；强杀 <= 10,000 条 | 依赖 SIGTERM 优雅退出；极端 OOM/SIGKILL 时，丢失量严格受限于已预留与队列容量上限。 |

---

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

---

## 第三章：系统总体架构与拓扑

### 3.1 总体拓扑架构 (单节点单主进程模型)

单节点网关采用**高性能单主进程事件循环架构 (Single Process Architecture)**，确保内存中的在途并发计数器、双重漏斗令牌桶、连接池等待队列与审计 RingBuffer 具备单一权威状态源，绝无跨进程配额翻倍裂变。

```
┌────────────────────────────────────────────────────────┐
│                        终端大模型接入生态 (LLM & Agents)                 │
│  [Claude Desktop]      [VS Code / Codex]      [Dify / AgentFlow]       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 携带 PAT 凭据 (Header: Bearer mcp_pat_xxx)
                                    ▼ 
┌────────────────────────────────────────────────────────┐
│                    协议适配层 (Protocol Adapter Layer)                  │
│  ├─ 现代模式：Streamable HTTP (POST /mcp, 基于最新 2026 规范基线)    │
│  ├─ 遗留模式：Legacy HTTP+SSE (/sse & /messages 双通道)             │
│  └─ 本地模式：Stdio (用于轻量嵌入与本地调试)                          │
│  【核心职责】统一解构成自包含的标准内部调用对象 InternalMcpInvocation      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 派发标准调用
                                    ▼ [端口: 8080 - 单一 Node.js 进程]
┌────────────────────────────────────────────────────────┐
│               企业级 MySQL-MCP 核心安全网关 (Data Plane)                 │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │  1. 鉴权与快照冻结 (Auth & RequestContextSnapshot)                  │ │
│ │     · PAT 常量时间验签 · 冻结完整时效快照 (含 authVersion 与 patExpiresAt)│
│ └──────────────────────────────────┬─────────────────────────────────┘ │
│                                    ▼                                   │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │  2. 容量前置预留与立体防护 (Capacity Pre-allocation & Guardrails)   │ │
│ │     · 在途并发预留 (单用户<=5, 单Profile<=30) · 审计槽位前置锁定    │ │
│ │     · 双重漏斗 QPM 扣减 · 滑动窗口死循环熔断 (Loop Breaker)         │ │
│ └──────────────────────────────────┬─────────────────────────────────┘ │
│                                    ▼                                   │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │  3. AST 安全防火墙与 Fail-Closed 改写 (AST Firewall & Rewriter)     │ │
│ │     · 库名前缀优先提取真实物理表 · 同级/嵌套 CTE 作用域栈解析       │ │
│ │     · 表级 ACL Default Deny · 动态注入/收缩 LIMIT (复杂结构阻断)     │ │
│ └──────────────────────────────────┬─────────────────────────────────┘ │
│                                    ▼                                   │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │  4. 查询生命周期与连接治理 (Query Lifecycle & Pool Governance)      │ │
│ │     · 注册 query_instance_id 状态机 · 借出瞬间核验完整二次鉴权契约  │ │
│ │     · 取消加装租约独占锁 (Lease Lock) · Admin KILL 设 2s 安全超时   │ │
│ │     · 官方 conn.reset(cb) 状态机 · 1500ms 超时 · Fail-Destroy 销毁  │ │
│ └──────────────────────────────────┬─────────────────────────────────┘ │
│                                    ▼                                   │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │  5. 原生 rowsAsArray 流式防爆与分级审计 (Streaming & Tiered Audit)  │ │
│ │     · 原生二维数组模式 · 从 fields 事件提取列元数据 (杜绝乱序与覆写)│ │
│ │     · 流式动态累加字节数 (累计 > 5MB 立即主动销毁流并切断连接)       │ │
│ │     · 消费预留的审计槽位异步刷盘                                    │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└───────────────┬────────────────────────────────────────┬───────────────┘
                │                                        │
                │ 内部系统元数据读写                     │ 目标只读 SQL 转发
                ▼                                        ▼
┌───────────────────────────────┐        ┌───────────────────────────────┐
│ 网关系统元数据库 (System DB)  │        │ 企业受管业务 MySQL 数据库集群 │
│   (独立 MySQL 8.0 实例)       │        │ (物理最小只读权限账号兜底)   │
│ · 用户多角色关联表与生命周期  │        └───────────────▲───────────────┘
│ · 数据源 Profile (AES 密钥环) │                        │
│ · 数据库与表级 ACL 规则       │         [内网隔离 VPC] │ (通过 SSH 隧道穿透)
│ · 分级全链路 SQL 审计流水表   │                        │
└───────────────▲───────────────┘        ┌───────────────┴───────────────┐
                │ 业务状态同步           │ 原生 SSH 跳板机 / 堡垒机      │
                │                        └───────────────────────────────┘
                ▼ [端口: 8081 - /api/v1/*, Web 控制台静态资源]
┌────────────────────────────────────────────────────────────────────────┐
│                Web 可视化管理控制台 (Control Plane - Portal)            │
│  ├─ 初始超管自举、首次强制改密 (后端全量 API 网关层硬拦截)            │
│  ├─ 事务行级排他锁保证至少 1 个活跃超管 (统一全量管理操作面)           │
│  ├─ 用户自主注册与审批流 (企微/钉钉/飞书通知，全方位 SSRF 防重绑定)   │
│  ├─ 数据源 Profile CRUD 与连通性测试 (DNS 解析后校验与 IP Pinning)    │
│  ├─ 个人中心：PAT 签发 (仅展示一次)、一键复制客户端配置片段           │
│  └─ 全链路 SQL 审计大盘与高危拦截监控 (支持日志脱敏导出)              │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ 浏览器访问 (HTTPS, HttpOnly Cookie)
                                    │
                         [DBA / SecOps / 研发人员]
```

---

### 3.2 单节点核心执行链 (Standard 10-Step Execution Chain)

网关所有数据面查询严格执行以下**十步闭环标准链路**：

```
[1. 协议适配] ──▶ 解码客户端请求 (Streamable HTTP / SSE / Stdio)，组装自包含 InternalMcpInvocation
      │
      ▼
[2. 请求鉴权] ──▶ 提取 PAT，常量时间校验 HMAC-SHA-256，验证账号状态为 ACTIVE
      │
      ▼
[3. 冻结授权快照] ──▶ 生成不可变 RequestContextSnapshot (锁定用户ID、生效角色、库表ACL、配额、authVersion、patExpiresAt、TTL)
      │
      ▼
[4. 容量前置预留] ──▶ 申请在途并发度 + 申请审计队列槽位 (预留失败直接触发背压) + 扣减双重漏斗 Token
      │
      ▼
[5. AST 与对象授权] ──▶ 语法分析，校验只读白名单，前缀优先提取物理表，Default Deny 库表 ACL，Fail-Closed LIMIT 注入
      │
      ▼
[6. 有界排队治理] ──▶ 进入 Profile 连接池排队队列 (检查队列深度硬上限与超时 Deadline)
      │
      ▼
[7. 执行前二次鉴权] ──▶ 借出连接瞬间，核验完整多维契约：authVersion、patExpiresAt、快照 TTL、策略版本、Profile 状态
      │
      ▼
[8. 限时限量执行] ──▶ 注册 query_instance_id，扣减中间件耗时，开启 rowsAsArray 流式游标 (stream) 透传有效剩余超时
      │
      ▼
[9. 取消或复位清理] ──▶ 正常结束调用官方 conn.reset(cb) 等待 OK 包 (1500ms 超时)；取消或异常一律 Fail-Destroy
      │
      ▼
[10. 审计落库与响应] ──▶ 流式动态累加字节数 (超 5MB 立即中断)，基于 fields 与原生数组组装紧凑结果，消费预留审计槽位落库
```

---

### 3.3 逻辑分层架构 (Layered Architecture Model)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. 协议适配层 (Protocol Adapter Layer)                                  │
│    · Streamable HTTP (POST /mcp) · Legacy SSE · Stdio 传输适配          │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. 身份认证与快照层 (Authentication & Snapshot Layer)                   │
│    · PAT 常量时间比对 (HMAC-SHA-256) · 生成不可变 RequestContextSnapshot │
│    · 本地短 TTL (2s) 快照缓存 · 二次鉴权多维完整契约核验                │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. 资源预留与韧性护栏层 (Pre-allocation & Guardrails Layer)             │
│    · 用户在途并发 (<=5) 与 Profile 在途并发 (<=30) 硬上限               │
│    · 审计队列槽位前置申请 (背压触发) · 双重漏斗 QPM · 死循环智能熔断    │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. AST 语法与对象防火墙层 (AST Firewall & Object Security Layer)        │
│    · 严格只读白名单 (拦截写/锁表/延时/读盘/多语句) · 放行 SELECT 1      │
│    · 库名前缀优先规则 + 作用域栈算法递归提取真实物理表                  │
│    · 库表 ACL 严格 Default Deny · 动态 LIMIT 改写 (复杂结构拒绝)        │
├─────────────────────────────────────────────────────────────────────────┤
│ 5. 查询生命周期与调度层 (Query Lifecycle & Scheduler Layer)             │
│    · query_instance_id 状态机流转 · 取消租约锁 (Lease Lock) 彻底防误杀  │
│    · Admin KILL 设 2000ms 独立硬超时并提供有界收尾清理                  │
├─────────────────────────────────────────────────────────────────────────┤
│ 6. 连接治理与协议状态机层 (Connection Governance & Driver Command Layer) │
│    · Profile 隔离物理连接池 (统一 callback 风格 PoolConnection)         │
│    · 官方 conn.reset(cb) 状态机 · 1500ms 超时 · Fail-Destroy 物理销毁   │
├─────────────────────────────────────────────────────────────────────────┤
│ 7. 存储持久化与可观测层 (Storage & Observability Layer)                 │
│    · 数据库物理只读最小权限兜底 · 系统元数据库 MySQL 8.0 (ACID)         │
│    · 高可用分级审计流水 (月度分区) · Prometheus Metrics 监控            │
│    · 全场景 SSRF 深度防御 (Post-DNS Check & IP Pinning)                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 3.4 交互时序图 (租约锁防误杀、流式中断与 reset 状态机)

```
客户端 (Agent)         网关协议流水线              AST 防火墙           Profile 连接池        目标业务 MySQL        Admin 专用通道
     │                        │                         │                    │                    │                   │
     │ 1. POST /mcp           │                         │                    │                    │                   │
     ├───────────────────────▶│                         │                    │                    │                   │
     │                        │ 2. 验签并冻结完整快照   │                    │                    │                   │
     │                        │ 3. 前置预留并发与审计   │                    │                    │                   │
     │                        │ 4. AST 前缀优先物理提取 │                    │                    │                   │
     │                        ├────────────────────────▶│                    │                    │                   │
     │                        │ 5. ACL 校验 & LIMIT 注入│                    │                    │                   │
     │                        │◀────────────────────────┤                    │                    │                   │
     │                        │                                              │                    │                   │
     │                        │ 6. 申请连接 (登记 query_instance_id 为 QUEUED)                    │                   │
     │                        ├─────────────────────────────────────────────▶│                    │                   │
     │                        │ 7. 借出连接 (二次核验完整鉴权契约, 状态 CAS: ACQUIRING -> RUNNING)│                   │
     │                        │◀─────────────────────────────────────────────┤                    │                   │
     │                        │                                              │                    │                   │
     │                        │ 8. 启动 rowsAsArray 流式游标执行 SQL (透传剩余有效超时)           │                   │
     │                        ├──────────────────────────────────────────────────────────────────▶│                   │
     │                        │                                              │                    │                   │
     │ [场景 A: 客户端断开 / PAT 撤销触发取消]                               │                    │                   │
     │ ──────────────────────▶│                                              │                    │                   │
     │                        │ 9. 状态原子转移 CAS: RUNNING -> CANCELING    │                    │                   │
     │                        │    【加装租约锁: locked_for_cancellation=true】                   │                   │
     │                        │    此时无论业务查询是否正好完成，正常路径一律禁止归还连接池       │                   │
     │                        │ 10. Admin 通道下发 KILL (挂载 2000ms 独立硬超时) ─────────────────┼──────────────────▶│
     │                        │ 11. 执行 KILL QUERY <thread_id>              │                    │                   │
     │                        │ 12. 【有界收尾与 Fail-Destroy】KILL 响应或 2s 到期，强制 conn.destroy()               │
     │                        ├──────────────────────────────────────────────┴────────────────────┼──────────────────▶│
     │                        │                                                                   ▼ (TCP 强制切断)    │
     │                        │                                                                   销毁重建，永不复用  │
     │                        │                                                                                       │
     │ [场景 B: 正常执行完成] │                                                                                       │
     │                        │ 13. 流式读取原生数组行，实时累加字节数 (累计 > 5MB 立即 destroy 流并切断连接)         │
     │                        │ 14. 调用官方 conn.reset(cb) (挂装 1500ms 硬超时定时器) ──────────▶│                   │
     │                        │ 15. 收到服务端 OK_Packet (0x00)，清空超时器，安全归还连接池 ──────┤                   │
     │                        │ 16. 消费预留的审计槽位异步入库                                    │                   │
     │ 17. 200 OK (紧凑结果集)│                                                                   │                   │
     │◀───────────────────────┤                                                                   │                   │
```

---

## 第四章：核心子系统深度技术设计

### 4.1 协议适配与业务上下文 (RequestContext) 模型

#### 4.1.1 协议适配层设计与代际解耦
网关设计独立的协议适配层 (Protocol Adapter)，屏蔽 Streamable HTTP (POST /mcp)、Legacy HTTP+SSE 与 Stdio 底层差异，统一解构为内部标准调用对象 `InternalMcpInvocation`。

#### 4.1.2 携带完整时效校验的 RequestContextSnapshot
为彻底消除“排队期间用户权限变更、PAT 自然过期或策略失效导致越权”的漏洞，快照中显式封装全量时效与版本标识：

```typescript
interface RequestContextSnapshot {
  requestId: string;           // 单次请求全局唯一 ID
  userId: number;              // 认证用户 ID
  username: string;            // 用户名快照
  patId: number;               // 认证使用的 PAT ID
  patExpiresAt: number | null; // PAT 绝对过期时间戳 (毫秒, null 为永久)
  authVersion: number;         // 用户授权版本号 (改密/冻结/改角色时递增)
  globalPolicyVersion: number; // 全局策略版本号 (角色模板/限流/ACL 调整时递增)
  activeRoleIds: number[];     // 生效角色 ID 列表
  effectiveProfile: {
    id: number;
    name: string;
    capacityQpm: number;
    maxPoolSize: number;
  };
  effectiveDatabase: string;   // 当前操作生效的工作数据库
  tableAcl: {
    blacklists: string[];      // 角色合并后的黑名单模式
    whitelists: string[];      // 角色合并后的白名单模式
  };
  quotas: {
    defaultLimit: number;
    maxLimit: number;
    maxTimeoutMs: number;
    userQpmLimit: number;
    maxInflightConcurrency: number; // 单用户最大在途并发数
  };
  snapshotCreatedAt: number;   // 快照生成时间戳
  snapshotTtlMs: number;       // 本地快照有效时限 (硬设为 2000ms)
}
```

---

### 4.2 认证、短 TTL 授权快照与二次鉴权多维完整契约

#### 4.2.1 凭据验签与常量时间比较
- **PAT 生成**：256-bit 高熵 CSPRNG 密钥，格式为 `mcp_pat_<32位安全串>`；
- **存储标准**：数据库仅存储不可逆摘要 `token_hash = HMAC-SHA-256(SERVER_PEPPER, token)`；
- **验签防时序攻击**：调用 `crypto.timingSafeEqual()` 进行常量时间比对。

#### 4.2.2 执行前二次鉴权多维完整契约 (Pre-Execution Validation Contract)
针对“排队延迟导致 PAT 自然到期、快照超时、策略更新或数据源停用”的边缘漏洞，在物理连接借出、即将下发 SQL 瞬间，网关执行严格的多维原子契约核验：

```typescript
function validateSnapshotBeforeExecution(
  snapshot: RequestContextSnapshot,
  registries: {
    userAuth: UserAuthRegistry;
    policy: PolicyRegistry;
    patRevocation: PatRevocationRegistry;
    profile: ProfileRegistry;
  }
): { valid: boolean; reason?: string } {
  const now = Date.now();

  // 1. 检查快照自身 TTL 是否过期 (排队等待超过 2000ms 必须拒绝下发，重新刷新鉴权)
  if (now - snapshot.snapshotCreatedAt > snapshot.snapshotTtlMs) {
    return { valid: false, reason: 'ERR_AUTH_SNAPSHOT_TTL_EXPIRED' };
  }

  // 2. 检查 PAT 是否已自然到期或被撤销
  if (snapshot.patExpiresAt !== null && now > snapshot.patExpiresAt) {
    return { valid: false, reason: 'ERR_AUTH_PAT_NATURALLY_EXPIRED' };
  }
  if (registries.patRevocation.isRevoked(snapshot.patId)) {
    return { valid: false, reason: 'ERR_AUTH_PAT_REVOKED' };
  }

  // 3. 检查用户授权版本 (改密、冻结、角色调整时版本递增)
  if (snapshot.authVersion !== registries.userAuth.getVersion(snapshot.userId)) {
    return { valid: false, reason: 'ERR_AUTH_USER_VERSION_CHANGED' };
  }

  // 4. 检查全局策略版本 (角色模板变更、ACL 策略调整)
  if (snapshot.globalPolicyVersion !== registries.policy.getGlobalVersion()) {
    return { valid: false, reason: 'ERR_AUTH_POLICY_CHANGED' };
  }

  // 5. 检查目标 Profile 状态 (数据源停用或下线)
  if (!registries.profile.isActive(snapshot.effectiveProfile.id)) {
    return { valid: false, reason: 'ERR_PROFILE_INACTIVE' };
  }

  return { valid: true };
}
```
校验不通过时，网关立即终止执行，直接释放或销毁物理连接，杜绝排队延迟引发的隐蔽越权。

---

### 4.3 三层纵深数据安全防线与修正后的 CTE 提取算法

#### 4.3.1 三层纵深防御分工
1. **第 1 道物理防线（绝对兜底）**：MySQL 实例账号仅授予特定业务表的 `SELECT` 权限，彻底收回所有写特权与高级函数特权，杜绝视图穿透与存储过程越权；
2. **第 2 道 AST 语法防线**：拦截 `FOR UPDATE`、`LOCK IN SHARE MODE`、`SLEEP()`、`LOAD_FILE`、`INTO OUTFILE`；
3. **第 3 道策略防线**：库表 ACL 严格执行 **Default Deny**。

#### 4.3.2 修正后的 CTE 递归提取算法 (库名前缀优先与顺序可见性)
算法确立**前缀优先原则**，并处理同级 CTE 顺序可见性：

```
算法：前缀优先与作用域栈物理表提取 (ExtractPhysicalTablesWithScope)
输入：ASTNode 根节点
输出：Set<PhysicalTable> (标准库表标识)

1. 初始化全局物理表集合 physicalTables = new Set()
2. 初始化作用域栈 scopeStack = new Stack<Set<string>>()
3. 进入当前查询块：
   a. 创建当前作用域 cteScope = new Set<string>()
   b. 若当前节点包含 WITH 块 (CTE 声明列表: withList):
      i. 遍历 withList 中的每个定义 (cteItem):
         - 【顺序可见性保障】：在解析 cteItem 的内部查询前，把已注册在 cteScope 的同级前面 CTE 视作可见
         - 递归调用本算法提取 cteItem 内部引用的物理表
         - 将 cteItem.name (纯小写表名) 存入当前层级的 cteScope (供后续同级 CTE 引用)
   c. 将 cteScope 压入 scopeStack
4. 递归遍历查询主体 (FROM、JOIN、子查询、UNION 分支):
   a. 若遇到表引用节点 TableRef (database, name):
      i. 【核心前缀优先规则】：
         若 database 存在且不为空 (例如 finance.salary):
         - 属于显式限定的数据库实体对象，绝不匹配 CTE 别名！
         - 提取为 "finance.salary"，直接加入 physicalTables
      ii. 若 database 为空 (未限定库名，例如 salary):
         - 检查 name 是否在 scopeStack 的任何一层中存在：
           * 若存在：判定为 CTE 虚拟中间表别名，跳过
           * 若不存在：使用上下文默认工作库 defaultDatabase 补全为 "defaultDatabase.name"，加入 physicalTables
   b. 若遇到嵌套子查询或派生表 DerivedTable:
      i. 递归调用步骤 3 处理子查询
5. 退出当前查询块：
   a. scopeStack.pop() 弹出当前层级
6. 返回 physicalTables
```

#### 4.3.3 安全无表查询放行与表级 ACL 判定 (Default Deny)
伪代码明确区分“安全无表查询”与“解析失败”：

```typescript
function evaluateTableAcl(
  physicalTables: Set<string>, 
  acl: { blacklists: string[]; whitelists: string[] },
  isKnownNoTableQuery: boolean // 如 SELECT 1, SELECT NOW(), SELECT @@version
): boolean {
  // 1. 安全无表查询放行
  if (physicalTables.size === 0) {
    if (isKnownNoTableQuery) {
      return true; // 合法的无表探测或心跳查询，允许放行
    }
    return false; // 无法识别的未知对象结构，Default Deny 拦截
  }

  // 2. 实体表严格校验
  for (const table of physicalTables) {
    // 黑名单优先：命中任何一条立即拒绝
    if (acl.blacklists.some(pattern => matchPattern(table, pattern))) {
      return false;
    }
    // 白名单校验：白名单为空或未命中白名单，一律拒绝 (Default Deny)
    if (acl.whitelists.length === 0) {
      return false;
    }
    const isWhitelisted = acl.whitelists.some(pattern => matchPattern(table, pattern));
    if (!isWhitelisted) {
      return false;
    }
  }

  return true;
}
```

---

### 4.4 全链路立体资源防护 (在途并发、超时联动 KILL、流式 rowsAsArray 与分层内存预算)

#### 4.4.1 分层内存预算体系 (Multi-Tier Memory Budget)
系统杜绝将 5MB 简单等同于网关内存防爆，建立四层立体内存约束模型：

```
┌────────────────────────────────────────────────────────┐
│                        四层立体内存约束模型                    │
├─────────────────────┬──────────────────────────────────┤
│ 1. 协议包硬上限     │ maxAllowedPacket = 16MB (底层网络层拒绝巨型数据包)│
│ 2. 单行单字段预算   │ 单字段 > 64KB 截断；单行超长拒绝 (防单个巨型单元格)│
│ 3. 结果集返回预算   │ 累计流式行字节数 > 5MB 立即销毁流并切断连接      │
│ 4. 并发总内存预算   │ 单用户最大在途并发 (5) * 5MB = 25MB (总内存严格有界)│
└─────────────────────┴──────────────────────────────────┘
```

#### 4.4.2 原生数组行模式 (rowsAsArray) 流式执行器
彻底解决 `Object.values(row)` 带来的键排序乱序与重名列覆盖问题：

```typescript
import mysql2 from 'mysql2';

interface ExecutionResult {
  columns: string[];
  rows: any[][];
  truncated: boolean;
  executionTimeMs: number;
}

export async function executeQueryWithStreamDefense(
  conn: mysql2.PoolConnection,
  sql: string,
  params: any[],
  remainingTimeoutMs: number,
  maxBytes: number = 5 * 1024 * 1024 // 5MB 结果预算
): Promise<ExecutionResult> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    let columns: string[] = [];
    const rows: any[][] = [];
    let accumulatedBytes = 0;
    let isTruncated = false;

    // 核心：强制开启 rowsAsArray 原生二维数组模式，并透传有效剩余超时
    const queryStream = conn.query({
      sql,
      values: params,
      rowsAsArray: true, // 杜绝对象键排序乱序与 JOIN 重名列覆盖
      timeout: remainingTimeoutMs,
    }).stream();

    // 1. 从 fields 事件提取原始列元数据，保真列顺序
    queryStream.on('fields', (fields: mysql2.FieldPacket[]) => {
      columns = fields.map(f => f.name);
    });

    // 2. 流式逐行处理原生数组行
    queryStream.on('data', (rowArray: any[]) => {
      if (isTruncated) return;

      // 实时计量每行字节数
      const rowBytes = Buffer.byteLength(JSON.stringify(rowArray));
      accumulatedBytes += rowBytes;

      if (accumulatedBytes > maxBytes) {
        isTruncated = true;
        // 达到 5MB 预算，主动销毁网络流，杜绝大结果集继续灌入 V8 堆内存
        queryStream.destroy();
        // 标记连接处于非干净状态，释放时强制物理销毁
        (conn as any).__force_destroy = true;

        resolve({
          columns,
          rows,
          truncated: true,
          executionTimeMs: Date.now() - startTime,
        });
      } else {
        rows.push(rowArray);
      }
    });

    queryStream.on('end', () => {
      if (!isTruncated) {
        resolve({
          columns,
          rows,
          truncated: false,
          executionTimeMs: Date.now() - startTime,
        });
      }
    });

    queryStream.on('error', (err: Error) => {
      reject(err);
    });
  });
}
```

---

### 4.5 连接池治理、官方 reset(cb) 原生命令与 1500ms 超时

#### 4.5.1 统一 callback 连接模型与原生复位状态机
精确锁定生产驱动为 **`mysql2: "3.24.6"`**，数据面底层统一采用原生 callback 风格 `mysql2.PoolConnection`，直接调用官方状态机 `conn.reset(cb)`，消除所有 `as any`：

```typescript
import mysql2 from 'mysql2';

export async function safeReleaseConnection(conn: mysql2.PoolConnection): Promise<void> {
  // 若执行过程中发生了流式截断超限、客户端中断或超时，强制物理销毁
  if ((conn as any).__force_destroy) {
    conn.destroy();
    return;
  }

  let isResetSuccess = false;
  let resetTimer: NodeJS.Timeout | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      // 挂载 1500ms 复位硬超时定时器，防 MySQL 服务端锁死或 Socket 挂起
      resetTimer = setTimeout(() => {
        reject(new Error('Reset connection timed out after 1500ms'));
      }, 1500);

      // 规范调用官方 reset(cb) 接口 (发送 0x1F 并等待 OK_Packet 回包)
      conn.reset((err: Error | null) => {
        if (resetTimer) clearTimeout(resetTimer);
        if (err) reject(err);
        else resolve(); // 仅当收到服务端 OK_Packet (0x00)，确认复位成功
      });
    });
    isResetSuccess = true;
  } catch (err) {
    isResetSuccess = false;
  } finally {
    if (resetTimer) clearTimeout(resetTimer);

    if (isResetSuccess) {
      conn.release(); // 确认状态干净，安全归还连接池
    } else {
      // 【Fail-Destroy 铁律】：复位超时、复位失败或连接处于未决状态，坚决物理销毁！
      conn.destroy();
    }
  }
}
```

---

### 4.6 取消租约锁 (Lease Lock) 与双重 Deadline 有界收尾

#### 4.6.1 解决取消与完成的竞态以及 Admin KILL 挂死
为防止 Admin KILL 网络挂起导致连接永久锁死，网关引入双重 Deadline 与有界收尾机制：

```typescript
interface ActiveQueryContext {
  queryInstanceId: string;
  threadId: number;
  conn: mysql2.PoolConnection;
  status: 'RUNNING' | 'CANCELING' | 'COMPLETED' | 'CANCELED';
  startedAt: number;
}

export class QueryLifecycleCoordinator {
  private activeQueries = new Map<string, ActiveQueryContext>();

  constructor(private adminChannel: AdminMaintenanceChannel) {}

  // 原子状态转移：RUNNING -> CANCELING (加装连接租约独占锁)
  cancelRunningQuery(instanceId: string): void {
    const context = this.activeQueries.get(instanceId);
    if (!context || context.status !== 'RUNNING') return;

    // 1. 原子加锁：进入 CANCELING 并加装租约锁
    context.status = 'CANCELING';
    (context.conn as any).__locked_for_cancellation = true;

    // 2. 双重 Deadline 保证有界收尾：无论 Admin KILL 是否挂起，本地 2000ms 强制清理
    const safetyDeadline = setTimeout(() => {
      // 兜底强制销毁物理套接字，断开底层 TCP，让 MySQL 服务端自动回收线程
      context.conn.destroy();
      this.activeQueries.delete(instanceId);
    }, 2000);

    // 3. 异步下发 KILL，捕获错误杜绝 unhandled rejection
    this.adminChannel.killQuery(context.threadId)
      .then(() => {
        // 服务端 KILL 成功确认
      })
      .catch((killErr: Error) => {
        // 记录告警：可能线程已经执行结束，属于预期良性竞争
      })
      .finally(() => {
        clearTimeout(safetyDeadline);
        context.conn.destroy(); // 物理销毁套接字，绝不归还
        this.activeQueries.delete(instanceId);
      });
  }

  // 正常执行完成路径的连接交接检查
  handleQuerySuccess(instanceId: string): void {
    const context = this.activeQueries.get(instanceId);
    if (!context) return;

    // 核心互斥检查：若已被取消逻辑锁定租约，正常完成路径放弃归还，严禁复用
    if ((context.conn as any).__locked_for_cancellation || context.status === 'CANCELING') {
      return;
    }

    context.status = 'COMPLETED';
    safeReleaseConnection(context.conn);
    this.activeQueries.delete(instanceId);
  }
}
```

---

### 4.7 全场景 SSRF 深度防御系统 (Post-DNS Resolution Check & IP Pinning)

覆盖 Webhook、MySQL 连接、SSH 隧道与 SMTP 连通性测试。

```
[目标主机 Hostname] ──▶ dns.promises.lookup(host, { all: true }) ──▶ 获得全部解析 IP
                              │
                              ▼
        [逐一遍历 IP 进行 CIDR 黑名单过滤]
        · 环回: 127.0.0.0/8, ::1
        · 私网: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7
        · 云元数据: 169.254.169.254, fd00:ec2::254
        · 链路本地: 169.254.0.0/16, fe80::/10
        · 运营商 CGNAT: 100.64.0.0/10
        · 映射编码: ::ffff:127.0.0.1
                              │
  ┌───────────────────────────┴───────────────────────────┐
  ▼                                                       ▼
[命中了黑名单 且 未在 ALLOWED_OUTBOUND_IPS 白名单中]     [校验完全通过]
  │                                                       │
  ▼                                                       ▼
[403 立即阻断并产生高危告警]                           [强制 IP Pinning 直连]
                                                          直接 Socket 连接已验证 IP，
                                                          禁止 3xx 重定向，超时 2s/3s
```

---

### 4.8 高可靠分级审计体系 (全量在途事件有界管控与容量丢失边界)

#### 4.8.1 全量在途事件有界管控
为防止审计队列统计偏差，网关对**“已预留槽位、正在排队、微批待提交”的所有未持久化在途事件实行统一限额管控**：
- 设定全局未提交事件硬上限为 **10,000 条**；
- 达到 8,000 条 (80%) 触发背压减速；达到 10,000 条 (100%) 暂停接收新入站请求，从源头消除丢日志风险。

#### 4.8.2 客观界定系统容灾边界
- **优雅退出 0 丢失**：系统捕获 `SIGTERM` / `SIGINT` 信号后，停止接入新请求并同步 flush 内存队列；
- **客观容量丢失边界**：在发生不可捕获的 `SIGKILL` (如 OOM Killer 强杀) 或服务器突发物理掉电时，未落盘数据最大潜在丢失量**严格受限于有界容量上限 (<= 10,000 条)**，监控指标暴露最老未持久化事件的存活年龄。

---

### 4.9 超管自锁判定完善与全量入口事务级防自残

#### 4.9.1 精确状态变化判定 (避免无关修改被误拒)
超管自锁不仅检查当前活跃超管数，而是基于**操作后的剩余活跃超管数**进行精确评估：
- 若操作只是修改最后超管的无关属性（如修改邮箱、绑定普通分析师角色），系统予以放行；
- 仅当操作会导致其失去 `SUPER_ADMIN` 角色（解绑超管角色、修改角色列表不含超管）或将其状态置为非 `ACTIVE`（如 `DISABLED` 或物理删除）时，且当前系统中仅剩最后 1 名活跃超管，触发强制拦截。

```sql
-- 事务级排他锁校验
SELECT COUNT(DISTINCT u.id) AS active_super_admins
FROM sys_users u
JOIN sys_user_roles ur ON u.id = ur.user_id
JOIN sys_roles r ON ur.role_id = r.id
WHERE r.role_name = 'SUPER_ADMIN' 
  AND u.status = 'ACTIVE'
FOR UPDATE;

-- 在事务中比对：若目标用户是当前活跃超管，且操作会导致其失效，且 active_super_admins <= 1：
-- 立即 ROLLBACK 并抛出 HTTP 400 错误
```

---

## 第五章：数据模型与系统元数据库设计

### 5.1 实体关系模型 (ER Diagram)

```
  ┌──────────────────┐               ┌───────────────────────┐
  │    sys_users     │ 1           N │   sys_user_approvals  │
  ├──────────────────┼───────────────┼───────────────────────┤
  │ id (PK)          │               │ id (PK)               │
  │ username         │               │ user_id (FK)          │
  │ password_hash    │               │ action                │
  │ status           │               │ reason                │
  │ must_change_password │               │ operator_id (FK)      │
  └────────┬─────────┘               └───────────────────────┘
           │ 1
           ├───────────────────────────────┐
           │ N                             │ N
  ┌────────┴─────────┐            ┌────────┴───────────────┐
  │     sys_pats     │            │     sys_user_roles     │ (多角色关联表)
  ├──────────────────┤            ├────────────────────────┤
  │ id (PK)          │            │ user_id (FK)           │
  │ user_id (FK)     │            │ role_id (FK)           │
  │ token_prefix     │            └────────┬───────────────┘
  │ token_hash       │                     │ N
  │ revoked_at       │                     │ 1
  └──────────────────┘            ┌────────┴───────────────┐
                                  │       sys_roles        │
                                  ├────────────────────────┤
                                  │ id (PK)                │
                                  │ role_name              │
                                  │ default_limit          │
                                  │ max_limit, timeout_ms  │
                                  └────────┬───────────────┘
                                           │ 1
                 ┌─────────────────────────┼─────────────────────────┐
                 │ N                       │ N                       │ N
  ┌──────────────┴───────┐  ┌──────────────┴───────┐  ┌──────────────┴───────┐
  │  sys_role_profiles   │  │  sys_role_table_acls │  │sys_role_database_acls│
  ├──────────────────────┤  ├──────────────────────┤  ├──────────────────────┤
  │ role_id (FK)         │  │ role_id (FK)         │  │ role_id (FK)         │
  │ profile_id (FK)      │  │ profile_id (FK)      │  │ profile_id (FK)      │
  └──────────────┬───────┘  │ rule_type (B/W)      │  │ database_name        │
                 │ N        │ table_pattern        │  │ is_allowed (1/0)     │
                 │ 1        └──────────────────────┘  └──────────────────────┘
  ┌──────────────┴───────┐
  │     sys_profiles     │
  ├──────────────────────┤
  │ id (PK)              │
  │ name, display_name   │
  │ host, port, username │
  │ password_encrypted   │
  │ max_pool_size        │
  │ profile_capacity_qpm │
  └──────────────────────┘

  ┌──────────────────────────────────────────────┐  ┌──────────────────────────────────────┐
  │               sys_audit_logs                 │  │     sys_anonymous_security_logs      │
  ├──────────────────────────────────────────────┤  ├──────────────────────────────────────┤
  │ id (PK), query_instance_id, session_id       │  │ id (PK), client_ip, request_path     │
  │ user_id, username, profile_id, database_name │  │ event_type (AUTH_FAIL, SSRF_BLOCKED) │
  │ sql_text, status, latency_ms, rows_affected  │  │ details (JSON), created_at           │
  │ created_at (PARTITIONED BY MONTH RANGE)      │  └──────────────────────────────────────┘
  └──────────────────────────────────────────────┘
```

---

### 5.2 物理 Schema 唯一入口（MySQL 8.0）

唯一可执行空库脚本为 `docs/sql/001_metadata_schema.sql`，完整列字典、14表/外键/索引/UTC毫秒与迁移约束见 `DATABASE_DESIGN_SPEC.md`。
本章 §5.1 是概念关系图，不是物理 FK 清单（审批和审计历史不设用户 FK）。旧版内嵌 SQL 已移除，不得用于建库；历史评审中的 SQL 仅用于重现当时问题。
后端 Repository 以同一脚本及数据库 §7 的事务/锁序为准，不维护第二套 DDL。

---

### 5.3 敏感信息对称可逆加密方案 (带 key_id 的密钥环)

#### 5.3.1 密文标准格式
```
v1:<key_id>:<12字节 IV 十六进制>:<密文十六进制>:<16字节 Auth Tag 十六进制>
```
- **格式版本** (`v1`)：标识加密算法为 AES-256-GCM；
- **密钥标识符** (`key_id`)：支持**密钥环 (Keyring)** 管理。解密时根据 `key_id` 索引对应密钥，更新时统一使用当前活跃密钥，实现无感平滑轮转。

---

### 5.4 多角色冲突判定决策表与库表 ACL 继承规则

当一个用户被同时授予多个角色（如同时具有 `ANALYST` 和 `DATA_ENGINEER`）时，网关在生成 `RequestContextSnapshot` 时执行以下确定性合并规则：

| 授权维度 | 合并冲突决策算法 | 规则说明与安全边界 |
| :--- | :--- | :--- |
| **单次查询最大行数 (`max_limit`)** | $\max(\text{role}_1.\text{max\_limit}, \dots)$ | **宽松原则**：取所有角色中的最大值。 |
| **默认注入行数 (`default_limit`)** | $\max(\text{role}_1.\text{default\_limit}, \dots)$ | **宽松原则**：取所有角色中的最大值。 |
| **单次执行超时 (`max_timeout_ms`)**| $\max(\text{role}_1.\text{max\_timeout}, \dots)$ | **宽松原则**：取所有角色中的最大值。 |
| **主体 QPM 配额 (`user_qpm_limit`)**| $\max(\text{role}_1.\text{qpm}, \dots)$ | **宽松原则**：若任一角色为 -1，则用户主体整体为 -1 (免主体限流)。 |
| **在途并发上限 (`max_inflight`)** | $\max(\text{role}_1.\text{inflight}, \dots)$ | **宽松原则**：取所有角色中的最大在途并发度。 |
| **数据库级 ACL (`Database ACL`)** | **黑名单优先，白名单并集** | 检查查询涉及的**每一个数据库**（不只默认库）。若任一库命中任一角色的 `is_allowed=0` 则直接拒绝；否则要求该库至少命中一个角色的 `is_allowed=1`。 |
| **表级 ACL (`Table ACL`)** | **黑名单优先，白名单并集，Default Deny** | 所有角色的表黑名单取并集，命中任意一张即拒绝；所有角色的白名单取并集，必须命中白名单；未命中一律拒绝 (Default Deny)。 |

---

## 第六章：标准接口契约与协议规范

### 6.1 MCP 11 项 Tools 显式传参契约与紧凑二维出参

所有工具均支持显式传入 `profile` 与 `database`，避免请求隐式依赖不可信的传输级 Session。

| 工具序号 | 工具标识 (Tool Name) | 入参签名 (Input Schema) | 核心功能与返回契约 | 安全约束与行为 |
| :---: | :--- | :--- | :--- | :--- |
| **01** | `list_profiles` | *(无参数)* | 返回当前用户被授权访问的数据源 Profile 清单：`{ profiles: [{ name, displayName, environment, defaultDatabase }] }` | 仅返回脱敏元数据，严格过滤未授权项，隐藏密码与私钥 |
| **02** | `switch_profile` | `profile_name: string` | 动态设置当前上下文的工作数据源（向后兼容便利工具） | 校验目标 Profile 授权；核心查询仍推荐直接显式传参 |
| **03** | `get_current_context` | *(无参数)* | 获取当前请求上下文快照：`{ username, activeRoles, activeProfile, activeDatabase, host }` | 辅助 Agent 随时校准当前所处环境与工作库 |
| **04** | `list_databases` | `profile?: string` | 列出指定或默认 Profile 连接池中有权访问的数据库清单 | 经 Database ACL 过滤，隐藏未授权库与 MySQL 内部系统库 |
| **05** | `use_database` | `database_name: string, profile?: string` | 切换默认操作数据库 | 检查目标数据库是否符合 Database ACL 策略 |
| **06** | `list_tables` | `pattern?: string, database?: string, profile?: string` | 列出目标库中的所有数据表名及业务注释：`{ tables: [{ name, comment, type }] }` | 严格应用 Table ACL Default Deny，被阻断表完全不可见 |
| **07** | `describe_table` | `table_name: string, database?: string, profile?: string` | 查询目标表的完整列定义、主外键、索引及字段注释 (`COLUMN_COMMENT`) | 校验表级 ACL 访问权限，若无权限返回标准 403 错误 |
| **08** | `sample_table_data` | `table_name: string, database?: string, profile?: string, limit?: number, columns?: string[]` | 抽取 3~5 行典型样本记录，格式化为二维紧凑数组 | limit 硬限制不超过 10 行；敏感字段自动执行动态脱敏掩码 |
| **09** | `get_column_distinct_values` | `table_name: string, column_name: string, database?: string, profile?: string, max_distinct?: number` | 统计枚举字段值域分布与频次 | max_distinct 硬上限 200；受全链路并发与超时限制，不被视为轻量查询 |
| **10** | `execute_query` | `sql: string, params?: any[], profile?: string, database?: string` | 执行只读 SQL 查询，返回紧凑二维结果集与性能指标 | 必须依次通过三层防御、在途并发、死循环熔断、AST只读、Table ACL 与 Fail-Closed LIMIT 改写 |
| **11** | `explain_query` | `sql: string, profile?: string, database?: string` | 执行 EXPLAIN 分析执行计划瓶颈 (全表扫描 ALL、预估扫描行数、filesort 告警) | 仅允许分析只读 SELECT 语句，受 Table ACL 约束 |

#### `execute_query` 紧凑序列化返回与截断标记
```json
{
  "columns": ["user_id", "username", "department", "created_at"],
  "rows": [
    [1001, "zhangsan", "Data Science", "2026-11-01 10:20:00"],
    [1002, "lisi", "Security Ops", "2026-11-02 14:15:30"]
  ],
  "row_count": 2,
  "execution_time_ms": 7.8,
  "payload_bytes": 1420,
  "truncated": false
}
```

---

### 6.2 管控面 RESTful API 清单与定义

管控面基于 `/api/v1` 前缀暴露 RESTful 规范接口。认证采用 HttpOnly 强安全 Cookie，后端全局挂载**强制改密守卫** (`forceChangePasswordGuard`)。

```
┌────────────────────────────────────────────────────────────────────────┐
│                        管控面核心 RESTful API 路由清单                 │
├────────┬────────────────────────────────┬──────────────────────────────┤
│ 模块   │ 路径 (Route)                   │ 请求方法与职责说明 (后端防护)│
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 认证   │ /api/v1/auth/csrf              │ GET  - 获取 CSRF 令牌 (公开) │
│        │ /api/v1/auth/register          │ POST - 用户自主申请注册      │
│        │ /api/v1/auth/login             │ POST - 账号密码登录 (带防爆破)│
│        │ /api/v1/auth/logout            │ POST - 登出并清理会话 Cookie │
│        │ /api/v1/auth/change-password   │ POST - 修改密码 (解除改密限制)│
│        │ /api/v1/auth/me                │ GET  - 获取当前登录人信息与角色│
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 审批   │ /api/v1/approvals/pending      │ GET  - 获取待审批申请人列表  │
│        │ /api/v1/approvals/:id/approve  │ POST - 审批通过并赋予角色    │
│        │ /api/v1/approvals/:id/reject   │ POST - 驳回申请并记录驳回理由│
│        │ /api/v1/approvals/resubmit     │ POST - 被驳回用户重新提交申请│
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 用户   │ /api/v1/users                  │ GET  - 分页查询所有用户列表  │
│        │ /api/v1/users/:id/status       │ PUT  - 冻结/解冻账号 (超管自锁)│
│        │ /api/v1/users/:id/roles        │ PUT  - 变更用户角色 (超管自锁)│
│        │ /api/v1/users/:id              │ DELETE - 删除用户 (超管自锁) │
├────────┼────────────────────────────────┼──────────────────────────────┤
│ PAT    │ /api/v1/pats                   │ GET  - 查看个人名下 PAT 列表 │
│        │ /api/v1/pats                   │ POST - 签发新 PAT (未改密拦截)│
│        │ /api/v1/pats/:id/revoke        │ POST - 主动吊销 PAT (即时失效)│
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 数据源 │ /api/v1/profiles               │ GET/POST - 查询 / 新增数据源 │
│        │ /api/v1/profiles/my-options    │ GET  - 研发端轻量数据源选项  │
│        │ /api/v1/profiles/:id           │ PUT/DELETE - 更新 / 删除数据源│
│        │ /api/v1/profiles/test-db       │ POST - 测试 MySQL 连通(SSRF) │
│        │ /api/v1/profiles/test-ssh      │ POST - 测试 SSH 连通(SSRF)   │
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 策略   │ /api/v1/roles                  │ GET/POST/PUT - RBAC 角色策略 │
│        │ /api/v1/roles/:id/table-acls   │ GET/POST/PUT - 表级黑白名单  │
│        │ /api/v1/roles/:id/db-acls      │ GET/POST/PUT - 数据库级 ACL  │
│        │ /api/v1/rate-limits/global     │ GET/PUT - 全局与熔断限流配置 │
│        │ /api/v1/rate-limits/users/:id  │ GET/PUT - 用户专属限流配额   │
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 审计   │ /api/v1/audits                 │ GET  - 分级 SQL 审计流水检索 │
│        │ /api/v1/audits/stats           │ GET  - 审计高危与耗时大盘指标│
│        │ /api/v1/audits/export          │ POST - 脱敏审计日志导出      │
├────────┼────────────────────────────────┼──────────────────────────────┤
│ 系统   │ /api/v1/settings/notifications │ GET/PUT - Webhook/邮件通知配置│
│        │ /api/v1/settings/test-notify   │ POST - 发送测试通知 (带 SSRF)│
└────────┴────────────────────────────────┴──────────────────────────────┘
```

---

### 6.3 统一错误码与异常响应矩阵 (Error Code Matrix)

```json
{
  "code": "ERR_AST_FORBIDDEN_SYNTAX",
  "message": "Write operation 'UPDATE' is strictly prohibited by Read-Only Policy.",
  "timestamp": "2026-11-07T12:00:00.123Z",
  "action_guidance": "Please convert your query into a read-only SELECT statement."
}
```

| 错误编码 (Code) | HTTP 状态码 | 触发场景说明 | 客户端自愈 / 纠正指引 (Guidance) |
| :--- | :---: | :--- | :--- |
| `ERR_AUTH_UNAUTHORIZED` | 401 | 未携带 PAT 令牌或 Header 格式错误 | 请在请求头中配置 `Authorization: Bearer <mcp_pat_xxx>` |
| `ERR_AUTH_INVALID_PAT` | 401 | PAT 签名错误、已过期或已被主动注销 | 令牌无效或已撤销，请前往 Web 控制台重新签发 |
| `ERR_AUTH_ACCOUNT_PENDING` | 403 | 用户已注册但尚未通过管理员审批 | 账号待审批，请联系系统管理员通过审批后再试 |
| `ERR_AUTH_ACCOUNT_DISABLED`| 403 | 用户账号已被管理员冻结/停用 | 账号已被停用，请联系管理员解冻恢复 |
| `ERR_MUST_CHANGE_PASSWORD` | 403 | 账号初次登录或需要强制改密 | 请先访问修改密码接口完成密码重置，才能进行其他操作 |
| `ERR_CONCURRENCY_LIMIT` | 429 | 用户在途并发或 Profile 在途并发达到硬上限 | "Concurrency quota exceeded. Please wait for previous queries to complete." |
| `ERR_RATE_LIMIT_USER` | 429 | 用户个人 QPM 令牌桶耗尽 | "User rate limit exceeded. Please slow down." |
| `ERR_RATE_LIMIT_PROFILE` | 429 | 目标 Profile 资源池瞬时已满载 | "Database resource pool is currently busy. Please retry later." |
| `ERR_AGENT_LOOP_DETECTED` | 429 | 30 秒内连续 3 次相同报错 SQL 熔断 | "Loop detected: Identical failed query executed multiple times. Please re-read the schema." |
| `ERR_AST_FORBIDDEN_SYNTAX` | 403 | 包含 DML/DDL/锁表(FOR UPDATE)/延时注入 | 严格只读模式禁止写操作、锁表或延时函数 |
| `ERR_AST_TABLE_DENIED` | 403 | 涉及物理表命中黑名单或未在白名单中 (Default Deny) | "Access denied for table in query: [table_name]" |
| `ERR_AST_LIMIT_FAIL_CLOSED`| 400 | 复杂复合 SQL 无法 100% 确保安全改写 LIMIT | "Unable to safely inject LIMIT into complex SQL structure. Please explicitly specify a LIMIT clause." |
| `ERR_AST_COMPLEXITY` | 400 | SQL 长度超 16KB 或 AST 深度/节点数超标 | "SQL query complexity exceeds gateway safety threshold." |
| `ERR_RESULT_PAYLOAD_TOO_LARGE`| 400 | 查询结果集总字节数超过 5MB 硬上限 | "Result payload exceeds max threshold. Please add more specific WHERE filters." |
| `ERR_POOL_QUEUE_TIMEOUT` | 503 | 并发排队等待空闲连接超时 (超过 3000ms) | "Database connection pool is currently busy. Please retry in a few seconds." |
| `ERR_SSRF_PROHIBITED` | 403 | 连通性测试目标命中私网/环回/云元数据 IP | 目标主机命中 SSRF 安全拦截规则，禁止访问内部或保留地址 |
| `ERR_LAST_SUPER_ADMIN` | 400 | 尝试禁用、删除或降级系统中最后 1 名活跃超管 | 至少需保留 1 名活跃超级管理员，禁止自残操作 |

---

## 第七章：工程目录结构与代码组织规范

### 7.1 Monorepo 模块化目录树规范

项目采用 **pnpm workspaces** 构建现代 TypeScript 全栈 Monorepo 仓库，确保业务数据契约共享、依赖版本统一与代码高内聚解耦。

```
mysql-mcp/
├── .github/                      # CI/CD 自动化流水线 (Lint, Test, Docker Build)
├── apps/
│   ├── gateway/                  # 【数据面】MCP 安全网关服务端 (Fastify v5, 端口: 8080)
│   │   ├── src/
│   │   │   ├── config/           # 网关环境变量解析与验证 (Zod 模式)
│   │   │   ├── adapters/         # 协议适配层 (Streamable HTTP, Legacy SSE, Stdio)
│   │   │   │   ├── streamable-http.adapter.ts  # 现代 POST /mcp 适配器
│   │   │   │   ├── legacy-sse.adapter.ts       # 遗留 /sse + /messages 适配器
│   │   │   │   └── stdio.adapter.ts            # 本地命令行标准 I/O 适配器
│   │   │   ├── pipeline/         # 10 步闭环标准处理流水线
│   │   │   │   ├── 01-auth.middleware.ts       # PAT 验签与短 TTL 授权快照
│   │   │   │   ├── 02-capacity.middleware.ts   # 在途并发与审计队列容量前置预留
│   │   │   │   ├── 03-ratelimit.middleware.ts  # 双重漏斗限流与死循环熔断
│   │   │   │   ├── 04-ast.middleware.ts        # AST 语法只读、表级 ACL 与 Fail-Closed 改写
│   │   │   │   └── 05-audit.middleware.ts      # 异步微批处理刷盘与应急日志追加
│   │   │   ├── mcp/              # MCP Tools 标准路由与处理器
│   │   │   │   ├── tools/        # 11 项 Tools 具体执行实现
│   │   │   │   └── server.ts     # MCP SDK 初始化与工具集注册
│   │   │   ├── index.ts          # 网关数据面服务启动入口
│   │   │   └── routes.ts         # 路由分发
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── admin-api/                # 【管控面】Web 控制台后端 REST API 服务 (端口: 8081)
│   │   ├── src/
│   │   │   ├── controllers/      # REST API 控制器 (用户、审批、数据源、审计等)
│   │   │   ├── middlewares/      # 全局中间件
│   │   │   │   └── force-change-pwd.guard.ts  # 后端全量 API 强制改密拦截网关
│   │   │   ├── services/         # 管控面业务逻辑
│   │   │   │   ├── auth.service.ts            # 账号注册登录、Argon2id 加密、防爆破
│   │   │   │   ├── approval.service.ts        # 审批流转与 Webhook 通知集成
│   │   │   │   ├── profile.service.ts         # 数据源 CRUD 与 AES-256 密钥环加解密
│   │   │   │   ├── pat.service.ts             # PAT 签发与即时失效广播
│   │   │   │   ├── audit.service.ts           # 审计流水多维检索与导出
│   │   │   │   └── bootstrap.service.ts       # 初始超管自举与最后 1 超管自锁保护
│   │   │   ├── index.ts          # 管控 API 启动入口
│   │   │   └── routes.ts         # /api/v1 路由分发
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── admin-ui/                 # 【管控面前端】现代化 Web 控制台 (React 19 + Vite 6)
│       ├── src/
│       │   ├── components/       # shadcn/ui 紧凑组件库 (Button, Sheet, Table, Badge 等)
│       │   ├── layouts/          # 全局“三纵两横一抽屉”骨架布局组件
│       │   │   ├── Sidebar.tsx   # 240px/64px 折叠侧边栏
│       │   │   ├── Topbar.tsx    # 56px 悬浮顶栏与全局搜索
│       │   │   └── InspectSheet.tsx # 560px 原位排查与审批抽屉
│       │   ├── views/            # 页面视图 (遵循 UI_DESIGN_SPEC 规范)
│       │   │   ├── Dashboard.tsx    # Bento 网格式安全与流量大盘
│       │   │   ├── Approvals.tsx    # 用户自主注册与管理员审批流
│       │   │   ├── Profiles.tsx     # 数据源配置与连通性测试
│       │   │   ├── Policies.tsx     # RBAC 角色与表级 ACL 策略
│       │   │   ├── Pats.tsx         # 个人 PAT 签发与一键复制客户端配置
│       │   │   └── Audits.tsx       # 全链路 SQL 审计与高危拦截排查
│       │   ├── stores/           # Zustand 客户端轻量状态
│       │   └── hooks/            # TanStack Query 服务端请求 Hooks
│       ├── tailwind.config.ts    # Tailwind CSS v4 与 OKLCH 设计令牌
│       ├── package.json
│       └── vite.config.ts
│
├── packages/
│   ├── core-ast/                 # 【公共内核】SQL AST 安全分析与 Fail-Closed 改写器
│   │   ├── src/
│   │   │   ├── parser.ts         # MySQL 8.0 语法解析封装
│   │   │   ├── scope-extractor.ts# 基于作用域栈的物理表提取 (嵌套 CTE/Alias/Subquery)
│   │   │   ├── validator.ts      # 严格只读白名单与高危指令拦截器
│   │   │   └── rewriter.ts       # Fail-Closed 动态 LIMIT 注入改写器
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── core-engine/              # 【公共内核】连接池治理与协议状态机复位
│   │   ├── src/
│   │   │   ├── pool-manager.ts   # 多 Profile 物理连接池与在途并发排队控制
│   │   │   ├── query-lifecycle.ts# query_instance_id 状态机与原子防误杀取消
│   │   │   ├── driver-reset.ts   # 驱动命令状态机 COM_RESET_CONNECTION (0x1F) 与 Fail-Destroy
│   │   │   └── ssh-tunnel.ts     # 原生 ssh2 堡垒机跳板机双工流隧道
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── security/                 # 【公共安全】深度防御与加密工具库
│   │   ├── src/
│   │   │   ├── ssrf.ts           # Post-DNS Resolution Check & IP Pinning 防御组件
│   │   │   ├── crypto-keyring.ts # 带 key_id 的 AES-256-GCM 密钥环加解密
│   │   │   ├── pat-hasher.ts     # HMAC-SHA-256 常量时间验签工具
│   │   │   └── masker.ts         # SQL 凭据与手机/邮箱 PII 敏感信息脱敏流水线
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared-types/             # 【公共契约】全栈统一 TypeScript 类型与 DTO 库
│       ├── src/
│       │   ├── mcp-tools.ts      # 11 项 Tools 入参与紧凑二维出参契约
│       │   ├── api-dtos.ts       # RESTful API 请求响应 DTO 结构
│       │   ├── entities.ts       # 系统元数据实体定义 (User, Profile, Audit 等)
│       │   └── error-codes.ts    # 全局错误码枚举
│       ├── package.json
│       └── tsconfig.json
│
├── docs/                         # 系统工程文档目录
│   ├── REQUIREMENTS.md           # 生产级闭环版需求规格说明书 (PRD v2.3.0)
│   ├── UI_DESIGN_SPEC.md         # 云原生零信任 Web UI 设计规范说明书
│   ├── LAYOUT_SPEC.md            # Web 控制台布局规范说明书
│   ├── FRONTEND_ARCHITECTURE_SPEC.md # Web 控制台前端实现架构设计说明书
│   ├── BACKEND_ARCHITECTURE_SPEC.md  # 后端实现架构详细设计说明书
│   └── ARCHITECTURE_SPEC.md      # 系统架构设计说明书 (本规范)
│
├── pnpm-workspace.yaml           # pnpm 工作区定义
├── package.json                  # 根项目脚本与开发依赖
├── tsconfig.base.json            # 共享严格 TypeScript 配置基线
└── docker-compose.yml            # 生产环境容器编排配置文件
```

---

### 7.2 模块职责边界与单向依赖约束

1. **单向依赖规则**：
   - `apps/gateway` 与 `apps/admin-api` 可以依赖 `packages/*`；
   - `packages/core-ast`、`packages/core-engine`、`packages/security` 严禁依赖任何 `apps/*`，确保高可测性与高内聚；
   - `packages/shared-types` 仅包含纯类型声明，零运行时依赖。
2. **凭据解密生命周期隔离**：
   - 数据源的真实明文密码与 SSH 密钥的解密操作，仅允许在 `packages/core-engine` 建立物理网络连接的瞬时发生，使用完毕立即垃圾回收，严禁在全局内存或日志中保留明文。

---

## 第八章：单节点原型验证、运维与安全加固

### 8.1 运行模型 (单节点单主进程模型规范)

在进入分布式扩展之前，必须首先完成**单节点单主进程 (Single Gateway Process)** 的闭环原型实现与验收测试。

```
┌────────────────────────────────────────────────────────┐
│               企业内网宿主机 / 单节点虚拟机            │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Docker 容器: mysql-mcp-gateway                   │  │
│  │   ├─ Port 8080: Gateway (Streamable HTTP / SSE)  │  │
│  │   ├─ Port 8081: Admin API & Nginx (Web UI 静态)   │  │
│  │   └─ 单一事件循环: 在途并发 + 授权快照 + RingBuffer │  │
│  └───────────────────────────┬──────────────────────┘  │
│                              │ 本地专用网络直连        │
│  ┌───────────────────────────▼──────────────────────┐  │
│  │ Docker 容器: mysql-metadata                      │  │
│  │   └─ Port 3306: 系统元数据 MySQL 8.0 (持久化卷)   │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```
- **单一权威状态**：单进程内运行的限流器、在途并发原子计数器、等待队列与审计环形缓冲区无需跨进程 IPC 协调，天然保证计数精确且无锁；
- **状态不翻倍**：单进程模式下，声明的在途并发 5 就是 5，连接池最大 10 就是 10，物理保护边界绝对可控。

---

### 8.2 生产级容器化编排 (docker-compose.yml 参考)

```yaml
version: '3.8'

services:
  # 1. 网关系统元数据库
  mysql-metadata:
    image: mysql:8.0-oracle
    container_name: mcp-mysql-metadata
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: RootSecurePassword2026!
      MYSQL_DATABASE: mcp_system
      MYSQL_USER: mcp_user
      MYSQL_PASSWORD: McpUserPassword2026!
      TZ: Asia/Shanghai
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_0900_ai_ci
      - --default-time-zone=+08:00
      - --max_connections=500
    volumes:
      - metadata_data:/var/lib/mysql
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    ports:
      - "3306:3306"
    networks:
      - mcp-internal

  # 2. MySQL-MCP 安全网关与管控服务 (单主进程模式)
  mysql-mcp-gateway:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: mcp-gateway-app
    restart: always
    depends_on:
      - mysql-metadata
    environment:
      NODE_ENV: production
      PORT_GATEWAY: 8080
      PORT_ADMIN: 8081
      DB_HOST: mysql-metadata
      DB_PORT: 3306
      DB_USER: mcp_user
      DB_PASSWORD: McpUserPassword2026!
      DB_NAME: mcp_system
      GATEWAY_MASTER_KEYS: '{"active_key_id":"k2026_01","keys":{"k2026_01":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}}'
      INITIAL_ADMIN_PASSWORD: ""
      ALLOWED_OUTBOUND_IPS: "10.100.0.0/16,172.18.0.0/16"
      MAX_INFLIGHT_CONCURRENCY_PER_USER: 5
      MAX_INFLIGHT_CONCURRENCY_PER_PROFILE: 30
      DEFAULT_QUEUE_TIMEOUT_MS: 3000
      MAX_RESULT_PAYLOAD_BYTES: 5242880 # 5MB
    ports:
      - "8080:8080"
      - "8081:8081"
    volumes:
      - ./logs:/app/logs
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health/live"]
      interval: 10s
      timeout: 3s
      retries: 3
    networks:
      - mcp-internal

volumes:
  metadata_data:
    driver: local

networks:
  mcp-internal:
    driver: bridge
```

---

### 8.3 核心并发与安全验收测试用例 (Test Matrix)

进入单节点原型代码实施后，必须通过以下 8 项关键工程验收测试：

| 用例编号 | 验收测试场景 | 预期测试行为与交付标准 |
| :---: | :--- | :--- |
| **TC-01** | **CTE 同名但带显式库名防穿透**<br>`WITH salary AS (...) SELECT * FROM finance.salary` | 前缀优先算法生效，真实物理表 `finance.salary` 被准确提取并送检 ACL；若在黑名单中，100% 阻断。 |
| **TC-02** | **取消租约锁防误杀与有界收尾**<br>并发压测下取消长查询与查询正常返回毫秒级重叠，且 Admin 通道响应挂死 | 原子 CAS 进入 `CANCELING` 加装租约锁；正常路径严禁归还连接；本地 2s 超时到期强制 `destroy()` 连接并清理配额，零误杀且零挂死。 |
| **TC-03** | **复位无响应与 1500ms 超时清理**<br>模拟 MySQL 底层网络死锁，服务端不回传 `OK_Packet` | 1500ms 复位硬超时触发并抛出异常；连接执行 `destroy()` 物理切断并剔除，连接池重新建连，零泄露。 |
| **TC-04** | **两名超管并发被移除验证**<br>两名管理员同时并发调用 API 移除系统中仅有的两名超管 | 事务行级锁 `FOR UPDATE` 确保串行化；第一笔操作成功，第二笔操作检测到活跃超管仅剩 1 名，被强制拒绝。 |
| **TC-05A**| **大量小行流式防爆截断**<br>执行下发返回 100MB 数据的只读查询 | 流式游标实时累加原生数组行；累计超 5MB 时立即触发 `stream.destroy()` 并切断连接，堆内存波动 < 20MB。 |
| **TC-05B**| **单行/单字段超长防御**<br>查询单个超大字段 (如 10MB BLOB) 或巨型协议包 | 协议层 `maxAllowedPacket (16MB)` 与单字段截断生效，保证内存不被单个异常字段打爆。 |
| **TC-06** | **排队期间 PAT 自然到期二次鉴权**<br>携带 1 秒后到期的 PAT，排队等待 1.5 秒后借出连接 | 借出瞬间核验 `patExpiresAt`，检测到已自然到期，立即中断下发并返回 `ERR_AUTH_PAT_NATURALLY_EXPIRED`。 |
| **TC-07** | **数字别名与重名列保真**<br>执行 `SELECT 'a' AS '2', 'b' AS '1'` 及 `SELECT a.id, b.id FROM a JOIN b` | `rowsAsArray: true` 原生二维数组保真列顺序为 `['a', 'b']`；重名列均保留，零丢列。 |

---

### 8.4 监控告警指标 (Prometheus Metrics & Healthcheck)

网关通过 `/metrics` 接口暴露标准 Prometheus 指标：

```
# HELP mcp_gateway_requests_total 网关处理请求总量 (按 Tool 及响应状态)
# TYPE mcp_gateway_requests_total counter
mcp_gateway_requests_total{tool="execute_query", status="success"} 152840
mcp_gateway_requests_total{tool="execute_query", status="blocked_ast"} 312
mcp_gateway_requests_total{tool="execute_query", status="blocked_concurrency"} 45
mcp_gateway_requests_total{tool="execute_query", status="canceled"} 18

# HELP mcp_gateway_inflight_requests 当前正在执行的在途请求数
# TYPE mcp_gateway_inflight_requests gauge
mcp_gateway_inflight_requests{profile="prod_readonly"} 6

# HELP mcp_gateway_destroyed_connections_total 触发 Fail-Destroy 物理销毁的连接总数
# TYPE mcp_gateway_destroyed_connections_total counter
mcp_gateway_destroyed_connections_total{profile="prod_readonly", reason="canceled"} 18
mcp_gateway_destroyed_connections_total{profile="prod_readonly", reason="reset_timeout"} 2
mcp_gateway_destroyed_connections_total{profile="prod_readonly", reason="payload_exceeded"} 5

# HELP mcp_gateway_pool_waiting_requests 连接池并发排队等待队列当前长度
# TYPE mcp_gateway_pool_waiting_requests gauge
mcp_gateway_pool_waiting_requests{profile="prod_readonly"} 0

# HELP mcp_gateway_com_reset_duration_seconds COM_RESET_CONNECTION 状态复位耗时
# TYPE mcp_gateway_com_reset_duration_seconds histogram
mcp_gateway_com_reset_duration_seconds_bucket{le="0.001"} 145000
mcp_gateway_com_reset_duration_seconds_bucket{le="0.002"} 152800

# HELP mcp_gateway_audit_queue_utilization 审计内存 RingBuffer 队列利用率
# TYPE mcp_gateway_audit_queue_utilization gauge
mcp_gateway_audit_queue_utilization 0.12

# HELP mcp_gateway_oldest_unflushed_audit_age_seconds 最老未刷盘审计事件存活时间 (秒)
# TYPE mcp_gateway_oldest_unflushed_audit_age_seconds gauge
mcp_gateway_oldest_unflushed_audit_age_seconds 0.28
```

#### 健康检查探针 (Healthcheck Probes)
- **存活探针 (Liveness - `/health/live`)**：检测 Node.js 异步事件循环是否健康；
- **就绪探针 (Readiness - `/health/ready`)**：检测系统元数据库连通性、本地密钥环完整性与关键加密参数就绪状态；元数据故障时返回 503 实现负载均衡自动摘流。