# MySQL MCP 企业级网关与管控平台 - 后端实现架构详细设计说明书 (Backend Detailed Architecture Specification)

| 文档版本 | 发布日期 | 状态 | 适用范围 | 密级 |
| :--- | :--- | :--- | :--- | :--- |
| **v1.7.3** | 2026-11-12 | **数据库评审修订版；待联调验收** | **后端工程研发、核心引擎实现、前后端联调与安全验收** | **内部公开** |

## 第二轮开发准入定点整改（v1.7.3 / 2026-11-12）

RR2-01：§10.3审计查询Repository改为接收MetadataQueryExecutor，独立导入RowDataPacket，并通过core-engine公共模块导出及调用示例接入runtimeCtx.metadataQueries。仅修复RD-02剩余消费者类型/依赖遗漏，不改已通过的UTC连接池、自举或限流算法。
新增实际执行器→查询服务→Repository的跨模块strict类型检查与受控连接串联验证；RD-08仍待责任人确认，真实MySQL/HTTP验收不在本次结论内。记录见 `docs/reviews/COMPREHENSIVE_DESIGN_READINESS_REMEDIATION_ROUND2.md`。

## 开发准入整改（v1.7.2 / 2026-11-12）

核验并修订 RD-01/02/03/04/05/06/07/09：持久限流版本、UTC连接、单一DDL、读写DTO、请求字段、47项接口追踪、超管锁序与首次自举标记。
RD-08 产品/接口签署仍待确认；新库burst暂按数据库既有值10，库级ACL按既有v1.0精确名，不代表新增产品批准。
验证范围及未完成的真实MySQL/HTTP/浏览器门禁见 `docs/reviews/COMPREHENSIVE_DESIGN_READINESS_REMEDIATION_20261112.md`。

## 数据库评审修订（v1.7.1 / 2026-11-12）

DB-R1-01：USER QPM/突发容量成对映射并接入快照，按 USER > GLOBAL 选择突发容量。 本次为文档与可执行片段修复，不代表应用或真实数据库已验收；接口/产品签署与联调门禁见数据库设计 §15.1。

---

## 修订说明 (Revision Preface - v1.7.0 针对第七轮评审 `BE-R7-01` 与 `BE-R7-02` 及全部 73 项探针收敛)

本版本（**v1.7.0**）在 v1.6.0 基础上，针对《后端详细设计第七轮复审报告》（[`docs/reviews/BACKEND_DESIGN_REVIEW_ROUND7.md`](./reviews/BACKEND_DESIGN_REVIEW_ROUND7.md)）指出的 **1 项 P1 问题（`BE-R7-01`：在途重放目标仍绑定可复用路径，在连续多次封存及快照取得前封存时导致未入库审计事件被误删）与 1 项 P2 问题（`BE-R7-02`：`AgentLoopBreaker` 回退分支访问未声明属性 `prev.now` 导致 TypeScript 5.9.3 编译器报 `TS2339`）**完成了算法重构与实测核验（**累计 73/73 条观察不变量全部成立：前六轮基线 68/68 + 第七轮扩展 5/5**；真实 MySQL/SSH/TLS 容器集成与全仓构建仍作为实施阶段验收门禁）：

1. **基于已入库条目集合 (`replayedIdSet`) 的原子文件核验与安全裁剪协议（修正 `BE-R7-01` [P1]）**：
   - 彻底废除基于易变路径名与容易发生错位的文件字节偏移量的清理假设；
   - `AuditEngine.replayEmergencyLogsToDb`（§10.1）在 MySQL 写入成功后，以本次成功入库的记录 ID 集合 `replayedIdSet` 为不可变权威基准；
   - 收集重放期间所有相关候选文件（历史经历过的封存文件列表 `replayingSealedHistory`、当前重定向文件 `replayingSealedRedirects` 以及原活动路径 `filePath`）；
   - 在锁外预读检查条目，在 `withEmergencyFileLock` 保护下执行安全清理：
     - 若文件不含任何 `replayedIdSet` 条目：绝对不碰，完好保留（解决 `repeat-seal` 场景下误删下一代 `sealedB` 与活动文件的问题）；
     - 若文件内条目全部在 `replayedIdSet` 中：安全 `unlink` 删除该文件；
     - 若文件内包含部分未入库的并发追加新条目：仅在锁内精准剔除已入库条目并将未入库条目重新写回文件（解决 `seal-before-snapshot` 与并发追加场景下的数据丢失问题）；
   - 经第七轮复现脚本实测，`r7_replay_lease_repeat_seal` 与 `r7_replay_lease_seal_before_snapshot` 两个极限交错反例全部达到 **`lostEventIds: []`（0 丢失）**。
2. **移除滑动窗口回退分支中未声明的 `prev.now` 属性（修正 `BE-R7-02` [P2]）**：
   - 修正 `LoopBreakerStateEntry`（§6.4）回退分支代码，移除多余的 `prev.now !== undefined ||` 表达式，直接以 `now - prev.firstErrorAt <= windowMs` 作为兼容旧状态的时间窗口有效性判定；
   - 经真实 TypeScript 5.9.3 编译器对整个 `dual-bucket-limiter.ts` 代码块执行 `strict: true` 语义类型检查，**`diagnostics.length === 0`（0 错误，0 警告）**。
---

## 目录索引 (Table of Contents)

1. [第一章：系统定位、双面职责边界与单进程宿主架构](#第一章系统定位双面职责边界与单进程宿主架构)
   - 1.1 数据面 (`apps/gateway:8080`) 与管控面 (`apps/admin-api:8081`) 职责切分
   - 1.2 单进程双实例宿主引导与无死锁优雅停机时序 (`Bootstrap & Graceful Shutdown`)
   - 1.3 进程内权威内存注册表 (`RegistryHub`) 与同步墓碑失效屏障 (`Fail-Closed Tombstone`)
2. [第二章：后端技术栈选型与工程决策记录 (ADR-BE)](#第二章后端技术栈选型与工程决策记录-adr-be)
   - 2.1 ADR-BE-01: Fastify v5 双实例架构与生命周期钩子分层
   - 2.2 ADR-BE-02: `mysql2@3.24.6` 双模连接策略与自定义 `stream` 工厂（兼顾 IP Pinning 与 TLS `verifyIdentity`）
   - 2.3 ADR-BE-03: Argon2id 密码哈希（带并发信号量）与 HMAC-SHA256 常量时间验签基线
   - 2.4 ADR-BE-04: 数据库显式乐观锁版本号 (`version`) 与父子聚合版本控制
   - 2.5 ADR-BE-05: 业务连接池与同源独立 `AdminMaintenanceChannel` 物理隔离
   - 2.6 ADR-BE-06: 事务内强一致管理审计 + 内存 RingBuffer 无损转移与双败回退锁死机制
3. [第三章：Monorepo 后端模块组织与公共包接口设计](#第三章monorepo-后端模块组织与公共包接口设计)
   - 3.1 后端全量工程目录树与锁定依赖版本基线
   - 3.2 模块依赖拓扑与单向依赖铁律
   - 3.3 全链路 64 位 `EntityId (string)` 类型契约与运行时 Schema 对齐
   - 3.4 统一异常基类 (`AppError`) 与全局错误处理器 (`GlobalErrorHandler`)
4. [第四章：系统元数据库演进 DDL 与数据访问层 (Repository & Transaction) 设计](#第四章系统元数据库演进-ddl-与数据访问层-repository--transaction-设计)
   - 4.1 唯一物理 Schema（14表权威DDL引用）与 Repository 映射
   - 4.2 64 位大整型 (`BIGINT UNSIGNED`) 全链路 `string` 序列化与内存索引契约
   - 4.3 事务管理器 (`withTransaction`) 与乐观锁 CAS 更新模板
   - 4.4 核心高危事务实现（最后 1 名超管防自残排他锁、同事务强一致审计、同步墓碑失效）
5. [第五章：管控面安全架构：认证、Session、CSRF 与四级守卫状态机](#第五章管控面安全架构认证sessioncsrf-与四级守卫状态机)
   - 5.1 初始超管安全自举 (`BootstrapService`) 幂等实现
   - 5.2 登录 IP + 账号双维防爆破状态机、Argon2id 并发信号量与匿名安全审计
   - 5.3 HttpOnly 强安全 Cookie 会话管理、Session Regeneration 与改密连带清退
   - 5.4 `preValidation` 无副作用 CSRF 校验器与 `/api/v1/auth/csrf` 公开端点
   - 5.5 四级分层守卫 (`AuthGuard ➔ StatusGuard ➔ MustChangePwdGuard ➔ RoleGuard`) 实现与路由豁免表
6. [第六章：数据面协议适配层与 10 步核心执行流水线详细设计](#第六章数据面协议适配层与-10-步核心执行流水线详细设计)
   - 6.1 三大协议适配器与 `reply.raw` 精确断连 `AbortSignal` 级联绑定（修复 `BE-R02`）
   - 6.2 PAT 验签、多角色配额真实最大值合并、三级限流优先级与 `RequestContextSnapshot`（修复 `BE-R06`）
   - 6.3 在途并发双维原子预留 (`InflightTracker`) 与审计槽位前置锁定
   - 6.4 双重漏斗令牌桶（支持动态 `burstCapacity`）与 Agent 死循环熔断器 (`AgentLoopBreaker`)
   - 6.5 借出连接瞬间二次鉴权六维原子核验 (`validateSnapshotBeforeExecution`，完整实现）
7. [第七章：SQL AST 安全防火墙、Fail-Closed 改写器与 11 项 MCP Tools 实现规范](#第七章sql-ast-安全防火墙fail-closed-改写器与-11-项-mcp-tools-实现规范)
   - 7.1 `ScopeExtractor`: 全属性树递归遍历、前缀优先与同级顺序可见 CTE 作用域栈（修复 `BE-R01`）
   - 7.2 `AstValidator`: 系统库表旁路封堵、锁读拦截、高危函数黑名单与标识符大小写策略
   - 7.3 `LimitRewriter`: 集合运算 (`UNION`) 外层限定语义识别、Fail-Closed 动态改写与二次解析验证（修复 `BE-R05`）
   - 7.4 11 项 MCP Tools 底层逐一实现规范（参数化 SQL 与 ACL 静默过滤）
   - 7.5 动态脱敏流水线 (`Masker`): 敏感列名识别与单元格内容实时掩码
8. [第八章：连接池治理、取消租约锁、原生复位状态机与 SSH/TLS 隧道 (`packages/core-engine`)](#第八章连接池治理取消租约锁原生复位状态机与-sshtls-隧道-packagescore-engine)
   - 8.1 `ManagedProfilePool`: 自定义 `stream` 工厂实现 SSRF IP Pinning + TLS `verifyIdentity: true` + 16MB 原始流熔断（修复 `BE-R03/R04/R08`）
   - 8.2 独立同源 `AdminMaintenanceChannel` 设计（复用验证端点与 SSH 隧道，防满池 KILL 死锁）
   - 8.3 `QueryLifecycleCoordinator`: CAS 取消租约锁与 2000ms 双重 Deadline `Fail-Destroy`
   - 8.4 `StreamingQueryExecutor`: `rowsAsArray: true`、UTF-8 字节安全 64KB 裁剪、5MB 结果集与 25MB 用户并发预算（修复 `BE-R14`）
   - 8.5 `safeReleaseConnection`: `conn.reset(cb)` 1500ms 硬超时与物理销毁
   - 8.6 `SshTunnelManager`: 原生 `ssh2` 跳板机 HostKey 指纹校验、双工流桥接与断线自愈（完整实现）
9. [第九章：全场景 SSRF 深度防御、AES-256-GCM 密钥环与通知推送系统 (`packages/security`)](#第九章全场景-ssrf-深度防御aes-256-gcm-密钥环与通知推送系统-packagessecurity)
   - 9.1 `SsrfGuard`: Post-DNS Resolution Check、全量 CIDR 黑名单与已验证端点描述符
   - 9.2 数据源连通性测试 (`test-db` / `test-ssh`) 三模式解析、TLS 同契约校验与防凭据外泄机制
   - 9.3 `CryptoKeyring`: 带 `key_id` 的 AES-256-GCM 加解密与后台批量重加密轮转器 (`KeyringRotationJob`)
   - 9.4 `NotificationService`: 企微/钉钉/飞书 Webhook 异步推送器（SSRF IP Pinning、禁 3xx、3s 超时，完整实现）
10. [第十章：分级全链路审计引擎、大盘时序聚合与安全 CSV 导出](#第十章分级全链路审计引擎大盘时序聚合与安全-csv-导出)
    - 10.1 `AuditEngine`: 槽位无缝转移、高危强一致落库、双通道失败回退队首与 JSONL 恢复重放器（修复 `BE-R09/R10/R13`）
    - 10.2 内存分钟级滑动窗口时序统计器与 `/api/v1/audits/stats` 双角色视角动态裁剪
    - 10.3 `/api/v1/audits` 多维检索与 `query_instance_id` 单条精确回补
    - 10.4 审计安全 CSV 导出：5 分钟一次性签名 Ticket 与防公式注入转义
11. [第十一章：全量接口契约映射、评审问题闭环核验表、测试矩阵与实施路线图](#第十一章全量接口契约映射评审问题闭环核验表测试矩阵与实施路线图)
    - 11.1 管控面 `/api/v1/*` 全量 RESTful 路由、守卫级别与 DTO 映射总表
    - 11.2 评审报告 15 项问题 (`BE-R01 ~ BE-R15`) 与 8 项待闭合点逐项整改核验总表
    - 11.3 前端 §8.3 后端协同清单（9 项）闭环对照表
    - 11.4 后端工程自动化验收测试矩阵（TC-BE-01 ~ TC-BE-18）与阶段实施路线图

---

## 第一章：系统定位、双面职责边界与单进程宿主架构

### 1.1 数据面 (`apps/gateway:8080`) 与管控面 (`apps/admin-api:8081`) 职责切分

系统在后端逻辑上切分为**数据面（Data Plane）**与**管控面（Control Plane）**两个独立边界，通过独立端口暴露服务，在单节点单主进程（Node.js 22 LTS）内共享唯一的运行时状态内核 `GatewayRuntimeContext`：

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                     单节点单主进程宿主 (Single Node.js 22 LTS Process)                  │
│                                                                                        │
│  ┌───────────────────────────────────────┐    ┌──────────────────────────────────────┐ │
│  │   数据面实例 (apps/gateway : 8080)     │    │  管控面实例 (apps/admin-api : 8081)   │ │
│  ├───────────────────────────────────────┤    ├──────────────────────────────────────┤ │
│  │ · Streamable HTTP (POST /mcp)         │    │ · RESTful API (/api/v1/*)            │ │
│  │ · Legacy HTTP+SSE (/sse, /messages)   │    │ · 静态前端资源托管 (apps/admin-ui)   │ │
│  │ · 鉴权方式: Authorization: Bearer PAT │    │ · 鉴权方式: HttpOnly Cookie + CSRF   │ │
│  │ · 10 步只读防护流水线 + 11 项 Tools    │    │ · 四级账号守卫 + 同事务强一致管理审计│ │
│  │ · 探针与指标: /health/*, /metrics     │    │ · 乐观锁并发控制 + 连通性 SSRF 测试  │ │
│  └───────────────────┬───────────────────┘    └──────────────────┬───────────────────┘ │
│                      │ 读取快照 / 预留配额                       │ 同步墓碑屏障 + 异步重载│
│                      ▼                                           ▼                     │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │               进程内共享运行时内核上下文 (Shared GatewayRuntimeContext)            │ │
│  │  ├─ RegistryHub: 含同步失效墓碑 (InvalidationTombstone) 与全量只读权限缓存        │ │
│  │  ├─ InflightTracker & DualBucketRateLimiter & AgentLoopBreaker & UserMemoryBudget │ │
│  │  ├─ PoolManager & AdminMaintenanceChannel & SshTunnelManager & QueryLifecycle     │ │
│  │  └─ AuditEngine (高危同步强一致写库 + 10,000 槽位无损异步微批 + 双败回退锁死)     │ │
│  └─────────────────────────────────────────┬─────────────────────────────────────────┘ │
└────────────────────────────────────────────┼───────────────────────────────────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
        [网关系统元数据库 (System DB)]               [受管企业业务 MySQL 集群 (只读)]
```

### 1.2 单进程双实例宿主引导与无死锁优雅停机时序 (`Bootstrap & Graceful Shutdown`)

针对评审问题 **`BE-R11`**（`fastify.close()` 会等待长查询与 SSE 连接结束，若先 `await server.close()` 再取消在途查询会导致停机永久卡死在第一步）与 **`BE-R15`**（构造函数签名对齐），主进程宿主按如下严格契约组装并执行**“先摘流与主动中断在途查询/SSE，再等待 HTTP Server 关闭与审计刷盘”**的无死锁停机流程：

```typescript
// apps/gateway/src/bootstrap-host.ts
import {
  createMetadataPool,
  createMetadataQueryExecutor,
  RegistryHub,
  SshTunnelManager,
  AdminMaintenanceChannel,
  PoolManager,
  QueryLifecycleCoordinator,
  AuditEngine,
  MetricsCollector,
} from '@mysql-mcp/core-engine';
import { CryptoKeyring, SsrfGuard } from '@mysql-mcp/security';
import { buildGatewayServer } from './server';
import { buildAdminServer, BootstrapService } from '@mysql-mcp/admin-api';
import { loadEnvConfig } from './config/env';

export async function startSingleProcessHost(
  deliverInitialPassword: (password: string) => Promise<void>
): Promise<void> {
  const config = loadEnvConfig();

  // 1. 初始化 AES-256-GCM 密钥环与 SSRF 防护器
  const keyring = CryptoKeyring.fromEnvJson(config.GATEWAY_MASTER_KEYS);
  const ssrfGuard = new SsrfGuard(config.ALLOWED_OUTBOUND_IPS);

  // 2. 初始化系统元数据库连接池 (强制开启 supportBigNumbers: true, bigNumberStrings: true)
  const metadataPool = createMetadataPool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    connectionLimit: 20,
  });

  // 3. 执行系统初始角色、默认全局限流与超级管理员幂等自举
  const bootstrapService = new BootstrapService(metadataPool, config, keyring, deliverInitialPassword);
  await bootstrapService.ensureSystemInitialized();

  // 4. 全量加载内存权威注册表 (Users, PATs, Roles, ACLs, Profiles, RateLimits)
  const metadataQueries = createMetadataQueryExecutor(metadataPool);
  const registryHub = new RegistryHub(metadataQueries);
  await registryHub.initializeAll();

  // 5. 按严格依赖顺序实例化 SSH 隧道管理器、独立 Admin KILL 通道、连接池管理器、生命周期协调器与审计引擎
  const metrics = new MetricsCollector();
  const sshManager = new SshTunnelManager(keyring, ssrfGuard);
  const adminChannel = new AdminMaintenanceChannel(keyring, ssrfGuard, sshManager);
  const poolManager = new PoolManager(registryHub, keyring, ssrfGuard, sshManager, metrics);
  await poolManager.warmUpActiveProfiles(registryHub.getActiveProfileConfigs());

  const lifecycleCoordinator = new QueryLifecycleCoordinator(adminChannel, metrics);
  const auditEngine = new AuditEngine(metadataQueries, {
    maxUnflushedEvents: 10000,
    batchSize: 200,
    flushIntervalMs: 500,
    emergencyLogDir: config.EMERGENCY_LOG_DIR,
  });
  auditEngine.startBackgroundFlusher();

  const runtimeCtx = {
    config,
    metadataPool, // 仅用于withTransaction，非事务读写使用metadataQueries
    metadataQueries,
    keyring,
    ssrfGuard,
    sshManager,
    adminChannel,
    registryHub,
    poolManager,
    lifecycleCoordinator,
    auditEngine,
    metrics,
    isDraining: false,
  };

  // 6. 构建并启动数据面 (8080) 与管控面 (8081) Fastify 实例
  const gatewayServer = await buildGatewayServer(runtimeCtx);
  const adminServer = await buildAdminServer(runtimeCtx);

  await gatewayServer.listen({ host: '0.0.0.0', port: config.PORT_GATEWAY });
  await adminServer.listen({ host: '0.0.0.0', port: config.PORT_ADMIN });

  // 7. 注册无死锁优雅停机钩子 (解决 BE-R11: 严禁在取消在途查询前阻塞等待 server.close)
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    runtimeCtx.isDraining = true; // Readiness 探针立即返回 503 通知负载均衡摘流

    // 设置 10 秒总停机兜底硬超时，防止极端故障下进程僵死
    const hardExitTimer = setTimeout(() => {
      process.stderr.write(`[SHUTDOWN TIMEOUT] Forced exit after 10000ms on ${signal}\n`);
      process.exit(1);
    }, 10000);
    hardExitTimer.unref();

    try {
      // Step A: 触发 Fastify 停止接受新连接（注意：此处启动 close Promise 但绝不阻塞后续取消动作！）
      const gatewayClosePromise = gatewayServer.close();
      const adminClosePromise = adminServer.close();

      // Step B: 立即并行取消所有在途业务查询（触发 2000ms 有界 KILL 与 Socket destroy），释放卡住的请求处理器
      await lifecycleCoordinator.cancelAllRunningQueries('SERVER_SHUTDOWN');

      // Step C: 在途请求被主动终止后，等待 Fastify HTTP Server 彻底关闭
      await Promise.allSettled([gatewayClosePromise, adminClosePromise]);

      // Step D: 排空业务连接池、关闭 SSH 隧道、刷空内存审计队列并关闭元数据库池
      await poolManager.closeAllPools();
      await sshManager.closeAllTunnels();
      await auditEngine.stopAndFlushAll();
      await metadataPool.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`[SHUTDOWN ERROR] ${(err as Error).message}\n`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
}
```

### 1.3 进程内权威内存注册表 (`RegistryHub`) 与同步墓碑失效屏障 (`Fail-Closed Tombstone`)

针对评审问题 **`BE-R07`**（事务提交后异步 `await reloadUserAuth` 期间存在旧权限放行窗口，且当数据库重载失败时会跳过 `cancelQueriesByUser` 并保留旧权限），本设计废除无工程约束的“0ms”口号，确立严格的 **“同步失效墓碑（Synchronous Invalidation Tombstone）+ 立即取消在途查询 + 异步后台刷新（失败保持 Fail-Closed）”** 三步线性化协议：

```
[管控面事务 COMMIT 成功]
        │
        ├─▶ 第 1 步 (同步无阻塞、零 I/O、不可抛错):
        │     registryHub.markUserInvalidatedSync(userId) / markPatRevokedSync(patId)
        │     立即在内存 Set<EntityId> 中打上失效墓碑或原子递增 requiredMinVersion；
        │     从这一微秒起，任何新入站或刚借出连接的请求读取该主体一律立即拒绝 (Fail-Closed)！
        │
        ├─▶ 第 2 步 (同步无阻塞触发):
        │     lifecycleCoordinator.cancelQueriesByUser(userId) / cancelQueriesByPat(patId)
        │     立即将该主体名下所有 RUNNING 查询原子置为 CANCELING 并启动 2s 有界销毁，
        │     绝对不依赖后续数据库重载是否成功！
        │
        └─▶ 第 3 步 (异步重载最新状态):
              await registryHub.reloadUserAuthFromDb(userId)
              · 若重载成功且用户状态为 ACTIVE（如仅修改了角色或密码）：更新缓存并清除墓碑；
              · 若重载失败（如元数据库瞬时抖动）：保留内存墓碑不清除，持续拒绝请求直至下次成功同步！
```

---

## 第二章：后端技术栈选型与工程决策记录 (ADR-BE)

### 2.1 ADR-BE-01: 核心依赖精确版本锁定与 Fastify v5 双实例架构
- **决策结论**：在根 `package.json` 与 `pnpm-lock.yaml` 中精确锁定核心运行时库版本（禁止 `^` 或 `~` 范围漂移）：
  - **`mysql2: "3.24.6"`**
  - **`node-sql-parser: "5.4.0"`**
  - **`fastify: "5.12.8"`**
  - **`@node-rs/argon2: "2.0.2"`**
  - **`ssh2: "1.16.0"`**
- **技术评估与工程收益**：
  1. **消除解析器与驱动源码行为漂移**：SQL AST 节点结构（如 `expr_list.value`、`_next` 链条）和 `mysql2` 内部 `startTLS` / `reset` 实现与具体小版本强相关，精确鎖定版本使安全不变量 100% 可复现；
  2. **无副作用 CSRF 边界**：在 Fastify `preValidation` 钩子完成 CSRF 验签，确保 `ERR_CSRF_INVALID` 100% 零写副作用。

---

### 2.2 ADR-BE-02: `mysql2@3.24.6` 双模连接策略与自定义 `stream` 工厂（兼顾 IP Pinning 与 TLS `verifyIdentity`）
- **决策结论**：
  - 系统元数据库 (`MetadataPool`) 使用 `mysql2/promise` 并强制开启 `supportBigNumbers: true, bigNumberStrings: true`；
  - 业务数据面 (`ManagedProfilePool`) 与维护通道 (`AdminMaintenanceChannel`) 统一使用原生 callback 风格的 `mysql2@3.24.6`，**保留 `host: cfg.host`（逻辑域名）并开启 `ssl: { ...tlsConfig, rejectUnauthorized: true, verifyIdentity: true }`，同时通过 `mysql2` 的 `stream` 工厂函数建立底层连接（直连 SSRF 校验后的 `pinnedIp` 或 `ssh2` 隧道流）**。
- **技术评估与工程收益（彻底根治 `BE-R03` 与 `BE-R04`）**：
  1. **`mysql2@3.24.6` 源码级事实对齐**：经核验 `mysql2@3.24.6` 的 `lib/base/connection.js` 源码，其 `startTLS()` 内部通过 `const servername = net.isIP(this.config.host) ? undefined : this.config.host` 计算 SNI，且通过 `this.config.ssl.verifyIdentity` 决定是否校验服务端证书主机名，**完全不读取 `this.config.ssl.servername`**；
  2. **为什么必须用 `stream` 工厂 + 保留逻辑 `host`**：若直接把 `config.host` 替换为 `pinnedIp`，`net.isIP(this.config.host)` 为 `true`，会导致 `servername` 变为 `undefined`，TLS SNI 与证书域名校验全部失效！而通过保持 `config.host = cfg.host`（原始域名），并提供自定义 `stream: () => Duplex` 工厂，在工厂内部调用 `ssrfGuard.resolveAndValidateHost(cfg.host)` 得到 `pinnedIp` 后用 `net.connect(cfg.port, pinnedIp)` 建立底层 TCP Socket，既保证了 **TCP 层 100% 连向已验证的 `pinnedIp`（免疫 DNS 重绑定）**，又让 `mysql2` 在该 Socket 之上发起 TLS 握手时**原生使用 `cfg.host` 发送 SNI 并执行严格的主机名证书核验（`verifyIdentity: true`）**！

---

### 2.3 ADR-BE-03: Argon2id 密码哈希（带并发信号量保护）与 HMAC-SHA256 常量时间验签
- **决策结论**：
  - 用户密码采用 **`Argon2id`**（`memoryCost: 65536 (64MB)`, `timeCost: 3`, `parallelism: 4`），并在认证服务外层加装**进程级并发信号量（`Argon2Semaphore`，最大并发数 `8`，排队上限 `32`）**；
  - PAT 令牌采用 256-bit CSPRNG 随机串，验签采用 `HMAC-SHA-256(SERVER_PEPPER, rawToken)` + `crypto.timingSafeEqual`。
- **技术评估与工程收益**：
  - 单次 Argon2id 消耗 64MB 内存与约 40ms CPU。若未认证攻击者瞬间并发发起数百次登录请求，无界调用 Argon2id 会导致内存暴涨与事件循环阻塞。引入容量为 8 的 `Argon2Semaphore` 将密码哈希最大瞬时内存严格限制在 `512MB` 以内，超出排队上限直接快速返回 `429 Too Many Requests`。

---

### 2.4 ADR-BE-04: 数据库显式乐观锁版本号 (`version`) 与父子聚合版本控制
- **决策结论**：在 `sys_profiles`、`sys_roles`、`sys_rate_limits`、`sys_system_settings` 表显式定义 `version INT UNSIGNED NOT NULL DEFAULT 1`；一对多规则子表（`sys_role_table_acls`、`sys_role_database_acls`）共享并递增父角色 `sys_roles.version`。

---

### 2.5 ADR-BE-05: 业务连接池与同源独立 `AdminMaintenanceChannel` 物理隔离
- **决策结论**：每个 Profile 的 `AdminMaintenanceChannel` 独立于业务连接池之外（不占用业务池连接槽位，杜绝业务池 100% 满载排队时 `KILL QUERY` 自身排队死锁），但**强制复用目标连接创建时的同一已验证端点描述符（`VerifiedTargetEndpoint`：含 `pinnedIp` 或同一 `SshTunnelManager` 实例）**，确保 `KILL QUERY <threadId>` 100% 路由至原查询所在的同一物理 MySQL 实例。

---

### 2.6 ADR-BE-06: 事务内强一致管理审计 + 内存 RingBuffer 无损转移与双败回退锁死机制
- **决策结论（彻底根治 `BE-R09`、`BE-R10`、`BE-R13`）**：
  1. **管理面写操作同事务强一致审计**：所有管理员写操作（用户冻结/解冻、角色变更、审批通过/驳回、PAT 签发/吊销、Profile/ACL/限流修改）必须在同一个元数据库事务（`withTransaction`）内同步插入审计记录；若审计写入失败，业务变更自动回滚，绝不出现“业务已生效但无审计”的状态；
  2. **数据面高危拦截强一致落库**：AST 违规、ACL 越权、SSRF 阻断等高危事件必须同步写入系统 MySQL，数据库故障时向上抛出异常，严禁将本地降级文件写入静默视为操作成功；
  3. **槽位无缝转移与双通道失败回退队首**：`reservedInflightSlots -= 1` 与 `flushingCount += 1` 同步原子执行；后台微批刷盘若遭遇数据库与本地 JSONL 同时失败（如 `ENOSPC`），在 `catch` 块中将批次原样 `this.queue.unshift(...batch)` 退回队列头部，保持 `totalUnflushedCount` 水位不归零，并触发不可写熔断。

---

## 第三章：Monorepo 后端模块组织与公共包接口设计

### 3.1 后端全量工程目录树规范

```
mysql-mcp/
├── apps/
│   ├── gateway/                                  # 【数据面应用】MCP 安全网关服务 (Port: 8080)
│   │   ├── src/
│   │   │   ├── config/env.ts                     # Zod 环境变量强类型解析与启动校验
│   │   │   ├── adapters/                         # MCP 多传输协议适配层
│   │   │   │   ├── types.ts                      # InternalMcpInvocation 标准内部契约
│   │   │   │   ├── streamable-http.adapter.ts    # POST /mcp 现代流式 HTTP 适配器 (精确断连检测)
│   │   │   │   ├── legacy-sse.adapter.ts         # GET /sse + POST /messages 遗留适配器
│   │   │   │   └── stdio.adapter.ts              # 本地 Stdio 调试适配器
│   │   │   ├── pipeline/                         # 10 步核心防御执行流水线
│   │   │   │   ├── pipeline-executor.ts          # 流水线编排器与 finally 槽位回收器
│   │   │   │   ├── 01-auth-snapshot.step.ts      # PAT 验签与 RequestContextSnapshot 冻结
│   │   │   │   ├── 02-capacity-reserve.step.ts   # 在途并发、用户内存预算与审计槽位预留
│   │   │   │   ├── 03-ratelimit-breaker.step.ts  # 双重漏斗限流与 Agent 死循环熔断
│   │   │   │   ├── 04-ast-firewall.step.ts       # AST 只读校验、库表 ACL 与 LIMIT 改写
│   │   │   │   └── 05-execution-audit.step.ts    # 连接借出二次核验、流式执行与审计提交
│   │   │   ├── mcp/
│   │   │   │   ├── tool-registry.ts              # 11 项 MCP Tools 路由分发与 JSON Schema
│   │   │   │   └── tools/                        # 11 项工具具体实现
│   │   │   ├── routes/observability.routes.ts    # /health/live, /health/ready, /metrics
│   │   │   ├── server.ts                         # buildGatewayServer(runtimeCtx)
│   │   │   ├── bootstrap-host.ts                 # 单进程双实例统一启动宿主与无死锁优雅停机
│   │   │   └── index.ts                          # 进程主入口
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── admin-api/                                # 【管控面应用】Web 控制台后端服务 (Port: 8081)
│       ├── src/
│       │   ├── middlewares/                      # 零信任安全守卫与中间件链
│       │   │   ├── session.middleware.ts         # HttpOnly Cookie 会话解析与 Regeneration
│       │   │   ├── csrf.prevalidation.ts         # preValidation 无副作用 CSRF 校验器
│       │   │   └── guards.ts                     # L1~L4 四级分层守卫流水线
│       │   ├── repositories/                     # 系统元数据库 DAL 层 (乐观锁与同事务审计)
│       │   ├── services/                         # 管控面核心业务服务层
│       │   ├── controllers/                      # `/api/v1/*` 路由控制器与 Schema 绑定
│       │   └── server.ts                         # buildAdminServer(runtimeCtx)
│       ├── package.json
│       └── tsconfig.json
│
└── packages/
    ├── core-ast/                                 # 【公共内核】SQL AST 安全分析与改写引擎
    │   └── src/
    │       ├── parser.ts                         # node-sql-parser@5.4.0 (MySQL 模式) 封装
    │       ├── scope-extractor.ts                # 全属性树递归 + 前缀优先 + 顺序可见 CTE 作用域栈
    │       ├── ast-validator.ts                  # 只读白名单、系统库封堵、锁读与高危函数拦截
    │       ├── acl-evaluator.ts                  # Database ACL 与 Table ACL Default Deny 判定器
    │       └── limit-rewriter.ts                 # 集合运算外层限定识别与 Fail-Closed LIMIT 改写器
    │
    ├── core-engine/                              # 【公共内核】连接池、生命周期状态机与审计引擎
    │   └── src/
    │       ├── metadata-pool.ts                  # 系统元数据库连接池 (bigNumberStrings: true)
    │       ├── registry-hub.ts                   # 内存权威注册表、同步失效墓碑与多角色配额合并
    │       ├── inflight-tracker.ts               # 用户级与 Profile 级在途并发原子计数器 (string ID)
    │       ├── dual-bucket-limiter.ts            # 双重漏斗令牌桶与 Agent 报错指纹死循环熔断器
    │       ├── pool-manager.ts                   # 自定义 stream 工厂连接池 (IP Pinning + TLS + 16MB 守卫)
    │       ├── admin-channel.ts                  # 同源独立 AdminMaintenanceChannel (专用 KILL 通道)
    │       ├── query-lifecycle.ts                # query_instance_id 状态机、租约锁与双重 Deadline
    │       ├── streaming-executor.ts             # rowsAsArray 流式执行器、UTF-8 64KB 裁剪与 25MB 用户预算
    │       ├── driver-reset.ts                   # conn.reset(cb) 1500ms 硬超时与 Fail-Destroy
    │       ├── ssh-tunnel.ts                     # ssh2 跳板机 HostKey 校验与 Duplex 流桥接
    │       └── audit-engine.ts                   # 强一致高危审计 + 10,000 槽位无损微批 + 双败回退队首
    │
    ├── security/                                 # 【公共安全】SSRF、加密密钥环、哈希与动态脱敏
    │   └── src/
    │       ├── ssrf-guard.ts                     # Post-DNS Resolution Check、CIDR 过滤与 IP Pinning
    │       ├── crypto-keyring.ts                 # AES-256-GCM 密钥环与在线重加密轮转器
    │       ├── password-hasher.ts                # Argon2id 密码哈希与并发信号量 (Argon2Semaphore)
    │       ├── pat-token.ts                      # 256-bit PAT 生成与 HMAC-SHA256 常量时间验签
    │       └── masker.ts                         # SQL 文本脱敏与查询结果集敏感列动态掩码
    │
    └── shared-types/                             # 【公共契约】前后端零运行时依赖纯 TypeScript 契约
        └── src/
            ├── entities.ts                       # EntityId (string) 与基础枚举
            ├── api-dtos.ts                       # 管控面 RESTful API DTO (全量 ID 为 string)
            ├── mcp-tools.ts                      # 11 项 MCP Tools 入参与出参契约
            └── error-codes.ts                    # 全局统一错误码枚举与自愈指引契约
```

---

### 3.2 模块依赖拓扑与单向依赖铁律

1. **单向依赖铁律**：`apps/gateway` 与 `apps/admin-api` 依赖 `packages/*`；`packages/*` 严禁反向引用 `apps/*`；`packages/shared-types` 保持 0 运行时依赖；
2. **密钥生命周期隔离**：`CryptoKeyring.decrypt()` 仅在建立底层连接或发送通知的瞬时局部作用域内执行，内存注册表仅保存密文字符串。

---

### 3.3 全链路 64 位 `EntityId (string)` 类型契约与边界归一化（闭环 `BE-R12`）

针对评审问题 **`BE-R12`**（驱动输出了字符串，但业务服务、快照与 Map 键又调用 `Number(id)` 转回数字，导致超过 $2^{53}-1$ 的相邻大整数 ID 如 `'9007199254740992'` 与 `'9007199254740993'` 发生精度碰撞），本规范确立**全链路 `EntityId = string` 铁律**：

```typescript
// packages/shared-types/src/entities.ts
/**
 * 64位无符号整型实体主键/外键在 TypeScript 全链路（DTO、Repository、Registry、Snapshot、Map Key）
 * 统一使用规范十进制字符串表示，严禁使用 Number(id) 转换！
 * 遵循纯类型包规范：packages/shared-types 仅导出 type 与 interface，零运行时代码。
 */
export type EntityId = string;
```

为严格遵循架构与前端规范确立的“`packages/shared-types` 纯类型包（零运行时 JS 代码）”边界约束（闭环 `CR-13`），运行时归一化工具函数统一收敛至运行时包 `packages/core-engine`：

```typescript
// packages/core-engine/src/utils/entity-id.ts
import type { EntityId } from '@mysql-mcp/shared-types';

/**
 * 边界入参归一化辅助函数：兼容测试替身传入的安全整数或生产驱动传入的 64 位数字字符串，
 * 统一转为精确十进制 string，绝不经过 IEEE-754 double 转换字符串输入。
 */
export function toEntityId(raw: string | number | bigint): EntityId {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid EntityId format: '${raw}'`);
    }
    return BigInt(trimmed).toString(10);
  }
  if (typeof raw === 'bigint') {
    if (raw < 0n) {
      throw new Error(`Negative bigint passed as EntityId: ${raw.toString(10)}`);
    }
    return raw.toString(10);
  }
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) {
    return String(raw);
  }
  throw new Error(`Unsafe number passed as EntityId: ${String(raw)}. Use decimal string instead.`);
}
```

---

### 3.4 统一异常基类 (`AppError`) 与全局错误处理器 (`GlobalErrorHandler`)

```typescript
// packages/shared-types/src/error-codes.ts
export type ErrorCode =
  | 'ERR_AUTH_UNAUTHORIZED'
  | 'ERR_AUTH_FAILED'
  | 'ERR_AUTH_INVALID_PAT'
  | 'ERR_AUTH_PAT_NATURALLY_EXPIRED'
  | 'ERR_AUTH_PAT_REVOKED'
  | 'ERR_AUTH_SNAPSHOT_TTL_EXPIRED'
  | 'ERR_AUTH_USER_VERSION_CHANGED'
  | 'ERR_AUTH_POLICY_CHANGED'
  | 'ERR_AUTH_ACCOUNT_PENDING'
  | 'ERR_AUTH_ACCOUNT_REJECTED'
  | 'ERR_AUTH_ACCOUNT_DISABLED'
  | 'ERR_MUST_CHANGE_PASSWORD'
  | 'ERR_CSRF_INVALID'
  | 'ERR_RBAC_FORBIDDEN'
  | 'ERR_SELF_ACTION_PROHIBITED'
  | 'ERR_LAST_SUPER_ADMIN'
  | 'ERR_CONCURRENCY_CONFLICT'
  | 'ERR_CREDENTIAL_REENTRY_REQUIRED'
  | 'ERR_PROFILE_INACTIVE'
  | 'ERR_PROFILE_HAS_DEPENDENCIES'
  | 'ERR_CONCURRENCY_LIMIT'
  | 'ERR_MEMORY_BUDGET_EXCEEDED'
  | 'ERR_WIRE_PACKET_TOO_LARGE'
  | 'ERR_RATE_LIMIT_USER'
  | 'ERR_RATE_LIMIT_PROFILE'
  | 'ERR_AGENT_LOOP_DETECTED'
  | 'ERR_AST_FORBIDDEN_SYNTAX'
  | 'ERR_AST_TABLE_DENIED'
  | 'ERR_AST_DATABASE_DENIED'
  | 'ERR_AST_LIMIT_FAIL_CLOSED'
  | 'ERR_AST_COMPLEXITY'
  | 'ERR_RESULT_PAYLOAD_TOO_LARGE'
  | 'ERR_POOL_QUEUE_TIMEOUT'
  | 'ERR_QUERY_EXECUTION_TIMEOUT'
  | 'ERR_QUERY_CANCELED'
  | 'ERR_SSRF_PROHIBITED'
  | 'ERR_AUDIT_BUFFER_FULL'
  | 'ERR_AUDIT_STORAGE_UNAVAILABLE'
  | 'ERR_NOT_FOUND'
  | 'ERR_INVALID_STATUS_TRANSITION'
  | 'ERR_VALIDATION_FAILED'
  | 'ERR_INTERNAL_SERVER';

export interface StandardErrorResponse {
  code: ErrorCode;
  message: string;
  timestamp: string;
  action_guidance?: string;
  retry_after_sec?: number;
  remaining_attempts?: number;
  details?: Record<string, unknown>;
}
```

```typescript
// packages/core-engine/src/app-error.ts
import type { ErrorCode, StandardErrorResponse } from '@mysql-mcp/shared-types';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly actionGuidance?: string;
  public readonly retryAfterSec?: number;
  public readonly remainingAttempts?: number;
  public readonly details?: Record<string, unknown>;

  constructor(params: {
    code: ErrorCode;
    statusCode: number;
    message: string;
    actionGuidance?: string;
    retryAfterSec?: number;
    remainingAttempts?: number;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.actionGuidance = params.actionGuidance;
    this.retryAfterSec = params.retryAfterSec;
    this.remainingAttempts = params.remainingAttempts;
    this.details = params.details;
  }

  public toJSON(): StandardErrorResponse {
    return {
      code: this.code,
      message: this.message,
      timestamp: new Date().toISOString(),
      ...(this.actionGuidance ? { action_guidance: this.actionGuidance } : {}),
      ...(this.retryAfterSec !== undefined ? { retry_after_sec: this.retryAfterSec } : {}),
      ...(this.remainingAttempts !== undefined ? { remaining_attempts: this.remainingAttempts } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
```

---

## 第四章：系统元数据库演进 DDL 与数据访问层 (Repository & Transaction) 设计

### 4.1 唯一物理 Schema 与 Repository 映射

**唯一可执行空库 DDL：`docs/sql/001_metadata_schema.sql`**；列字典、约束与迁移原则见 `DATABASE_DESIGN_SPEC.md`。本章不再复制建表 SQL，禁止从历史正文创建数据库。14 表的结构差异检查直接读取该 SQL；现存库升级须先盘点，不得重复执行空库脚本。

| Repository | 必须遵守的物理映射与约束 |
| :--- | :--- |
| RateLimitRepository | `userQuotaQpm` ↔ `qpm_limit`；USER 每次创建/更新同步持久 counter、revision/version；删除保留 counter，见 §4.4.3 |
| ApprovalRepository | 创建工单写不可变 `application_reason` 快照；决定时写 `decided_at`；删除用户取消开放工单；`pending_user_id` 为生成列，禁止写入 |
| AdminAuditRepository | 同事务写 `target_type`、`target_id`、脱敏 `details`；历史不随用户级联删除 |
| UserRoleRepository / PatRepository | 角色 FK 为 RESTRICT；PAT→用户为 CASCADE；删除用户显式清理 USER 限流但保留计数器 |
| AclRepository | 库名、表模式用 as_cs 比较，库级精确名；不能沿用默认 ai_ci |
| ProfileRepository | 写请求 `user` → 物理 `username` → 读响应 `username`；时间 UTC 毫秒；审计快照 `profile_name` 容量128 |
| SettingsRepository | 内部 `bootstrap_state` 不暴露为可写通知设置；仅首次空库脚本置 PENDING，自举成功同事务置 READY |

所有元数据时间均为 UTC `DATETIME(3)`，数据库时间函数使用 `UTC_TIMESTAMP(3)`（或在已确认 UTC session 上的 `CURRENT_TIMESTAMP(3)`）；禁止秒精度 UTC_TIMESTAMP(3) 和按本地时区隐式转换。

---

### 4.2 64 位大整型 (`BIGINT UNSIGNED`) 全链路 `string` 序列化与内存索引契约（闭环 `BE-R12`）

```typescript
// packages/core-engine/src/metadata-pool.ts
import mysql2 from 'mysql2/promise';

export interface MetadataDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
}

export function createMetadataPool(cfg: MetadataDbConfig): mysql2.Pool {
  return mysql2.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionLimit: cfg.connectionLimit ?? 20,
    waitForConnections: true,
    queueLimit: 200,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true, // 驱动层直接输出十进制字符串，禁止转回 Number
    multipleStatements: false,
  });
}

// 所有元数据读写（包括非事务查询）必须经此入口借连接；禁止直接 pool.query/execute。
export async function acquireMetadataConnection(pool: mysql2.Pool): Promise<mysql2.PoolConnection> {
  const conn = await pool.getConnection();
  try {
    // 每次借出都设置：覆盖新建/复用连接，不依赖异步 connection 事件的执行顺序。
    await conn.query("SET SESSION time_zone = '+00:00'");
    return conn;
  } catch (error) {
    conn.destroy(); // 未初始化成功的连接绝不能回池或执行业务 SQL
    throw error;
  }
}


export interface MetadataQueryExecutor {
  query<T extends mysql2.QueryResult = mysql2.RowDataPacket[]>(
    sql: string, values?: unknown[]
  ): Promise<[T, mysql2.FieldPacket[]]>;
}

// 非事务消费者（RegistryHub、AuditEngine）只接收此窄接口，不能旁路UTC初始化。
export function createMetadataQueryExecutor(pool: mysql2.Pool): MetadataQueryExecutor {
  return {
    async query<T extends mysql2.QueryResult = mysql2.RowDataPacket[]>(sql: string, values?: unknown[]) {
      const conn = await acquireMetadataConnection(pool);
      try { return await conn.query<T>(sql, values); }
      finally { conn.release(); }
    }
  };
}

```


元数据入口通过core-engine公共模块导出，管控应用不得用仓库目录内不存在的相对路径引用：

```typescript
// packages/core-engine/src/index.ts（元数据导出片段，保留其他已有导出）
export { createMetadataPool, acquireMetadataConnection, createMetadataQueryExecutor } from './metadata-pool';
export type { MetadataDbConfig, MetadataQueryExecutor } from './metadata-pool';
```

---

### 4.3 事务管理器 (`withTransaction`) 与乐观锁 CAS 更新模板

```typescript
// apps/admin-api/src/repositories/base.repository.ts
import type mysql2 from 'mysql2/promise';
import type { EntityId } from '@mysql-mcp/shared-types';
import { AppError, acquireMetadataConnection } from '@mysql-mcp/core-engine';

export async function withTransaction<T>(
  pool: mysql2.Pool,
  fn: (conn: mysql2.PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await acquireMetadataConnection(pool);
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function assertOptimisticLockUpdated(
  conn: mysql2.PoolConnection,
  affectedRows: number,
  tableName: 'sys_profiles' | 'sys_roles' | 'sys_rate_limits' | 'sys_system_settings',
  idColumn: string,
  idValue: EntityId | number
): Promise<void> {
  if (affectedRows > 0) return;

  const [rows] = await conn.query<mysql2.RowDataPacket[]>(
    `SELECT 1 FROM ?? WHERE ?? = ? LIMIT 1`,
    [tableName, idColumn, String(idValue)]
  );

  if (rows.length === 0) {
    throw new AppError({
      code: 'ERR_VALIDATION_FAILED',
      statusCode: 404,
      message: `Target entity in ${tableName} not found.`,
    });
  }

  throw new AppError({
    code: 'ERR_CONCURRENCY_CONFLICT',
    statusCode: 409,
    message: '该配置已被其他管理员更新，请重新加载最新版本后重试。',
    actionGuidance: 'Reload the latest configuration and re-apply your changes.',
  });
}
```

---

### 4.4 核心高危事务实现（闭环 `BE-R07`、`BE-R10`、`BE-R12`）

#### 4.4.1 最后 1 名活跃超管防自残排他锁 + 同事务强一致审计 + 同步墓碑失效

针对评审报告 **`BE-R07`**（异步重载失败跳过取消且保留旧权限）、**`BE-R10`**（管理写操作必须在同一事务内写审计，失败则整体回滚）与 **`BE-R12`**（全程使用 `EntityId = string`，禁止 `Number(targetUserId)`）：

```typescript
// apps/admin-api/src/services/user.service.ts
import type mysql2 from 'mysql2/promise';
import type { EntityId } from '@mysql-mcp/shared-types';
import { toEntityId } from '@mysql-mcp/core-engine';
import { AppError, RegistryHub, QueryLifecycleCoordinator } from '@mysql-mcp/core-engine';
import { withTransaction } from '../repositories/base.repository';

export class UserService {
  constructor(
    private readonly pool: mysql2.Pool,
    private readonly registryHub: RegistryHub,
    private readonly lifecycle: QueryLifecycleCoordinator
  ) {}

  private async guardLastSuperAdminInTx(
    conn: mysql2.PoolConnection,
    targetUserId: EntityId,
    operatorUserId: EntityId,
    willLoseActiveSuperAdmin: (currentIsActiveSuperAdmin: boolean) => boolean
  ): Promise<void> {
    // 唯一协议：永久角色锁 → 用户主键升序 → 绑定主键升序；全部为当前读。
    const [superRoles] = await conn.query<mysql2.RowDataPacket[]>(
      `SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE`
    );
    if (superRoles.length !== 1) throw new Error('SUPER_ADMIN role missing; manual recovery required');
    // 管控低频写采用保守全用户锁；优化为候选集前必须证明锁序与当前读等价。
    const [users] = await conn.query<mysql2.RowDataPacket[]>(
      `SELECT id, status FROM sys_users ORDER BY id FOR UPDATE`
    );
    const [bindings] = await conn.query<mysql2.RowDataPacket[]>(
      `SELECT user_id FROM sys_user_roles WHERE role_id = ? ORDER BY user_id FOR UPDATE`,
      [superRoles[0].id]
    );
    const superIds = new Set(bindings.map(r => toEntityId(r.user_id)));
    const activeSuperIds = new Set(users.filter(r => r.status === 'ACTIVE' && superIds.has(toEntityId(r.id)))
      .map(r => toEntityId(r.id)));
    const currentIsActiveSuperAdmin = activeSuperIds.has(targetUserId);

    if (targetUserId === operatorUserId && willLoseActiveSuperAdmin(currentIsActiveSuperAdmin)) {
      throw new AppError({
        code: 'ERR_SELF_ACTION_PROHIBITED',
        statusCode: 400,
        message: '禁止对当前登录账号自身执行冻结、降级或删除操作。',
      });
    }

    if (currentIsActiveSuperAdmin && willLoseActiveSuperAdmin(currentIsActiveSuperAdmin)) {
      if (activeSuperIds.size <= 1) {
        throw new AppError({
          code: 'ERR_LAST_SUPER_ADMIN',
          statusCode: 400,
          message: '系统必须保留至少 1 名活跃超级管理员，禁止禁用、删除或移除最后一名超管权限。',
          actionGuidance: 'Please grant SUPER_ADMIN to another active user before modifying this account.',
        });
      }
    }
  }

  public async updateUserStatus(
    rawTargetUserId: EntityId | number,
    newStatus: 'ACTIVE' | 'DISABLED',
    expectedVersion: number,
    rawOperatorUserId: EntityId | number
  ): Promise<void> {
    const targetUserId = toEntityId(rawTargetUserId);
    const operatorUserId = toEntityId(rawOperatorUserId);

    await withTransaction(this.pool, async (conn) => {
      await this.guardLastSuperAdminInTx(
        conn,
        targetUserId,
        operatorUserId,
        () => newStatus !== 'ACTIVE'
      );

      // 来源状态校验：仅允许 ACTIVE <-> DISABLED 互相流转，PENDING / REJECTED 必须走审批流
      const [userRows] = await conn.query<mysql2.RowDataPacket[]>(
        `SELECT id, status, version FROM sys_users WHERE id = ? FOR UPDATE`,
        [targetUserId]
      );
      if (userRows.length === 0) {
        throw new AppError({
          code: 'ERR_NOT_FOUND',
          statusCode: 404,
          message: '目标用户不存在。',
        });
      }
      const currentStatus = userRows[0].status;
      if (currentStatus === 'PENDING' || currentStatus === 'REJECTED') {
        throw new AppError({
          code: 'ERR_INVALID_STATUS_TRANSITION',
          statusCode: 400,
          message: `当前用户处于 ${currentStatus} 状态，禁止直接启停，必须通过注册审批流程进行流转。`,
        });
      }
      if (currentStatus === newStatus) {
        throw new AppError({
          code: 'ERR_INVALID_STATUS_TRANSITION',
          statusCode: 400,
          message: `目标用户已处于 ${newStatus} 状态，无需重复流转。`,
        });
      }

      const [res] = await conn.query<mysql2.ResultSetHeader>(
        `UPDATE sys_users
         SET status = ?, auth_version = auth_version + 1, version = version + 1
         WHERE id = ? AND version = ? AND status = ?`,
        [newStatus, targetUserId, expectedVersion, currentStatus]
      );

      if (res.affectedRows === 0) {
        throw new AppError({
          code: 'ERR_CONCURRENCY_CONFLICT',
          statusCode: 409,
          message: '用户状态已被其他管理员更新，请重新加载最新版本。',
        });
      }

      // 【闭环 BE-R10】：管理面写操作必须在同一数据库事务内写入强一致安全审计记录；
      // 若此 INSERT 失败，整个事务自动 ROLLBACK，业务变更绝不单独生效！
      await conn.query(
        `INSERT INTO sys_user_approvals (user_id, action, reason, operator_id)
         VALUES (?, 'STATUS_CHANGE', ?, ?)`,
        [targetUserId, `Changed user status to ${newStatus}`, operatorUserId]
      );
    });

    // 【闭环 BE-R07 第 1 步】：事务提交后同一同步控制段，立即打上内存失效墓碑（零 I/O，不可抛错）
    this.registryHub.markUserInvalidatedSync(targetUserId);

    // 【闭环 BE-R07 第 2 步】：在任何异步 DB 重载之前，立即同步触发在途查询取消！
    if (newStatus === 'DISABLED') {
      this.lifecycle.cancelQueriesByUser(targetUserId, 'ACCOUNT_DISABLED');
    }

    // 【闭环 BE-R07 第 3 步】：异步从元数据库重载最新用户权限；若重载失败，墓碑继续保持 Fail-Closed 拒绝状态
    try {
      await this.registryHub.reloadUserAuthFromDb(targetUserId);
    } catch {
      // 保持 markUserInvalidatedSync 墓碑不清除，拒绝任何旧快照放行
    }
  }

  public async updateUserRoles(
    rawTargetUserId: EntityId | number,
    rawNewRoleIds: Array<EntityId | number>,
    expectedVersion: number,
    rawOperatorUserId: EntityId | number
  ): Promise<void> {
    const targetUserId = toEntityId(rawTargetUserId);
    const operatorUserId = toEntityId(rawOperatorUserId);
    const newRoleIds = rawNewRoleIds.map(toEntityId);

    await withTransaction(this.pool, async (conn) => {
      const [superRoleRows] = await conn.query<mysql2.RowDataPacket[]>(
        `SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' LIMIT 1`
      );
      const superRoleId = superRoleRows.length > 0 ? toEntityId(superRoleRows[0].id) : '';
      const keepsSuperAdmin = newRoleIds.includes(superRoleId);

      await this.guardLastSuperAdminInTx(
        conn,
        targetUserId,
        operatorUserId,
        currentIsActiveSuperAdmin => currentIsActiveSuperAdmin && !keepsSuperAdmin
      );

      await conn.query(`DELETE FROM sys_user_roles WHERE user_id = ?`, [targetUserId]);
      if (newRoleIds.length > 0) {
        const values = newRoleIds.map((rid) => [targetUserId, rid]);
        await conn.query(`INSERT INTO sys_user_roles (user_id, role_id) VALUES ?`, [values]);
      }

      const [res] = await conn.query<mysql2.ResultSetHeader>(
        `UPDATE sys_users 
         SET auth_version = auth_version + 1, version = version + 1 
         WHERE id = ? AND version = ?`,
        [targetUserId, expectedVersion]
      );

      if (res.affectedRows === 0) {
        throw new AppError({
          code: 'ERR_CONCURRENCY_CONFLICT',
          statusCode: 409,
          message: '用户角色已被其他管理员更新，请重新加载最新版本。',
        });
      }

      // 【闭环 BE-R10】：同一事务内写入强一致管理审计记录
      await conn.query(
        `INSERT INTO sys_user_approvals (user_id, action, reason, operator_id)
         VALUES (?, 'ROLE_CHANGE', ?, ?)`,
        [targetUserId, `Updated roles to [${newRoleIds.join(',')}]`, operatorUserId]
      );
    });

    // 【闭环 BE-R07】：同步置位失效墓碑并取消该用户旧权限下的在途查询，随后异步重载
    this.registryHub.markUserInvalidatedSync(targetUserId);
    this.lifecycle.cancelQueriesByUser(targetUserId, 'USER_ROLES_CHANGED');
    try {
      await this.registryHub.reloadUserAuthFromDb(targetUserId);
    } catch {
      // 重载失败保持墓碑 Fail-Closed
    }
  }
}
```

#### 4.4.3 USER 限流 Repository 统一事务协议（RD-01）

`putUserOverride` 与 `deleteUserOverride` 严格实现数据库 §7.5 和接口 §6.7.4/5：
用户行 FOR UPDATE → 计数器 FOR UPDATE → 业务规则 FOR UPDATE → 校验预期 revision → 分配/保存新版本 → 同事务 CONFIG_UPDATE 审计。
创建与更新共用一次分配步骤，不能仅对创建递增计数器；写入列是 `qpm_limit`，不是 `user_quota_qpm`。
`revision=version=last_revision`；每次成功创建/更新加1，删除保留 counter。溢出、旧版本、缺失用户、审计失败均整体回滚。
仅创建接受0；更新/删除要求正修订号；兼容 version 与 revision 同传时必须相等。
成功提交后同步失效 RegistryHub 并重载 QPM 与 burst，失效失败保持 Fail-Closed，不回退旧快照。

#### 4.4.4 所有超管集合变更入口共享锁序（RD-07）

§4.4.1 的角色→用户→绑定锁协议同时适用于启用/禁用、授予/撤销 SUPER_ADMIN、用户删除、审批授予角色及首次自举。
必须在任何用户/绑定锁之前获取永久 SUPER_ADMIN 行锁；内置角色不可删除或重命名。
本人保护只拒绝本人禁用/删除/移除 SUPER_ADMIN，不误拦无关角色修改；剩余人数检查只在减少活跃集合时执行。
审批、限流等其他用户写事务遵循数据库 §7.1：涉及超管集合时先角色锁，再用户锁；禁止持用户锁后倒序申请角色锁。
死锁/锁等待仅允许整体回滚后有限重试（最多3次），每次重新读取状态和CAS；不得重放已提交事务或提前发布失效通知。
真实 MySQL 双连接验收：相互降权、并发授予/撤销、删除/启停、审批授予与禁用、死锁耗尽；单元顺序模型不是并发证明。

---

## 第五章：管控面安全架构：认证、Session、CSRF 与四级守卫状态机

### 5.1 初始超管安全自举 (`BootstrapService`)：持久标记与人工恢复

空库 DDL 只植入内部 `bootstrap_state=PENDING` 标记，不含账号/密码。应用不得在标记缺失时自行补建它。
标记为 PENDING 且除标记外14表全部为空才允许首次自举；同事务写角色、配置、超管、管理审计和 READY。
READY 重启只验证健康，不重设密码、角色、配额或补发超管；缺失/未知标记、PENDING非空、READY无ACTIVE超管均告警并拒绝ready，进入人工恢复。
已有库升级须DBA核验后审计登记READY，不能按“没有admin用户名/没有ACTIVE超管”推断新库。
基础配置可在受控维护中按键补缺，但普通启动缺失配置必须拒绝ready，不能把补配置与补超管身份混为一谈。

```typescript
// apps/admin-api/src/services/bootstrap.service.ts
import crypto from 'node:crypto';
import type mysql2 from 'mysql2/promise';
import { hashPassword } from '@mysql-mcp/security';
import { withTransaction } from '../repositories/base.repository';

export class BootstrapService {
  constructor(
    private readonly pool: mysql2.Pool,
    private readonly env: { NODE_ENV: string; INITIAL_ADMIN_PASSWORD?: string },
    private readonly keyring: { encrypt(plaintext: string): string; decrypt(ciphertext: string): string },
    // 由部署层接入受控一次性交付通道，禁止写入普通日志/审计details。
    private readonly deliverInitialPassword: (password: string) => Promise<void>
  ) {}

  public async ensureSystemInitialized(): Promise<void> {
    const generatedPassword = await withTransaction(this.pool, async (conn) => {
      const [markers] = await conn.query<mysql2.RowDataPacket[]>(
        `SELECT setting_value FROM sys_system_settings WHERE setting_key = 'bootstrap_state' FOR UPDATE`
      );
      const state = markers[0]?.setting_value;
      if (state !== 'PENDING' && state !== 'READY') {
        throw new Error('BOOTSTRAP_RECOVERY_REQUIRED: missing/invalid durable marker');
      }
      if (state === 'READY') {
        // 与所有活跃超管集合写入口相同锁序：role → users → bindings。
        const [roles] = await conn.query<mysql2.RowDataPacket[]>(
          `SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE`
        );
        if (roles.length !== 1) throw new Error('BOOTSTRAP_RECOVERY_REQUIRED: role missing');
        const [users] = await conn.query<mysql2.RowDataPacket[]>(
          `SELECT id, status FROM sys_users ORDER BY id FOR UPDATE`
        );
        const [bindings] = await conn.query<mysql2.RowDataPacket[]>(
          `SELECT user_id FROM sys_user_roles WHERE role_id = ? ORDER BY user_id FOR UPDATE`, [roles[0].id]
        );
        const ids = new Set(bindings.map(r => String(r.user_id)));
        if (!users.some(u => u.status === 'ACTIVE' && ids.has(String(u.id)))) {
          throw new Error('BOOTSTRAP_RECOVERY_REQUIRED: no active super-admin');
        }
        const [globalRows] = await conn.query<mysql2.RowDataPacket[]>(
          `SELECT id FROM sys_rate_limits WHERE scope_type = 'GLOBAL' AND scope_id = 0`
        );
        const [settings] = await conn.query<mysql2.RowDataPacket[]>(
          `SELECT setting_value, is_encrypted FROM sys_system_settings WHERE setting_key = 'notification_channels'`
        );
        if (globalRows.length !== 1 || settings.length !== 1 || settings[0].is_encrypted !== 1) {
          throw new Error('BOOTSTRAP_RECOVERY_REQUIRED: required configuration missing');
        }
        JSON.parse(this.keyring.decrypt(settings[0].setting_value)); // 解密失败不得ready
        return undefined;
      }

      // PENDING只能来自成功执行的空库DDL；禁止在已接流量的数据库启动初始化。
      const tables = ['sys_users', 'sys_roles', 'sys_user_roles', 'sys_user_approvals', 'sys_pats', 'sys_profiles', 'sys_role_profiles', 'sys_role_database_acls', 'sys_role_table_acls', 'sys_rate_limits', 'sys_audit_logs', 'sys_anonymous_security_logs', 'sys_system_settings', 'sys_rate_limit_revisions'];
      for (const table of tables) {
        const [rows] = await conn.query<mysql2.RowDataPacket[]>(
          table === 'sys_system_settings'
            ? `SELECT 1 FROM ?? WHERE setting_key <> 'bootstrap_state' LIMIT 1`
            : `SELECT 1 FROM ?? LIMIT 1`, [table]
        );
        if (rows.length) throw new Error('BOOTSTRAP_RECOVERY_REQUIRED: PENDING database is not empty');
      }
      await conn.query(`
        INSERT INTO sys_roles
          (role_name, display_name, description, default_limit, max_limit, max_timeout_ms, user_qpm_limit, max_inflight_concurrency, is_builtin, version)
        VALUES
          ('SUPER_ADMIN', '超级管理员', '系统最高权限管理者', 100, 1000, 30000, -1, 10, 1, 1),
          ('SECURITY_ADMIN', '安全管理员', '负责审批、RBAC策略、限流与全量审计监控', 100, 1000, 20000, 120, 5, 1, 1),
          ('DBA', '数据库管理员', '负责MySQL数据源与SSH堡垒机配置管理', 100, 1000, 30000, 120, 8, 1, 1),
          ('ANALYST', '数据分析师', '只读查询业务报表数据', 50, 500, 15000, 60, 5, 1, 1),
          ('DEVELOPER', '业务研发人员', '日常研发辅助查询与Schema探索', 50, 500, 15000, 60, 5, 1, 1)
      `);
      const [roleRows] = await conn.query<mysql2.RowDataPacket[]>(
        `SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE`
      );
      await conn.query(`
        INSERT INTO sys_rate_limits
          (scope_type, scope_id, qpm_limit, burst_capacity, loop_breaker_threshold, loop_breaker_window_sec, revision, version)
        VALUES ('GLOBAL', 0, 60, 10, 3, 30, 0, 1)
      `);
      const channels = ['FEISHU', 'DINGTALK', 'WECHAT'].map(channelType => ({
        channelType, enabled: false, webhookUrl: '', secret: null, alertEvents: []
      }));
      await conn.query(
        `INSERT INTO sys_system_settings (setting_key, setting_value, is_encrypted, version)
         VALUES ('notification_channels', ?, 1, 1)`,
        [this.keyring.encrypt(JSON.stringify({ schemaVersion: 1, channels }))]
      );
      const suppliedPassword = this.env.INITIAL_ADMIN_PASSWORD;
      const rawPassword = suppliedPassword || ('Aa1!' + crypto.randomBytes(18).toString('base64url'));
      const pwdHash = await hashPassword(rawPassword);
      await conn.query(
        `INSERT INTO sys_users (username, password_hash, status, must_change_password, auth_version)
         VALUES ('admin', ?, 'ACTIVE', 1, 1)`, [pwdHash]
      );
      // 不经JS Number读取insertId，避免BIGINT精度损失；同连接读取十进制字符串。
      const [idRows] = await conn.query<mysql2.RowDataPacket[]>(`SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id`);
      const userId = idRows[0].id;
      await conn.query(`INSERT INTO sys_user_roles (user_id, role_id) VALUES (?, ?)`, [userId, roleRows[0].id]);
      await conn.query(
        `INSERT INTO sys_user_approvals (user_id, action, reason, operator_id, target_type, target_id, decided_at)
         VALUES (?, 'CONFIG_UPDATE', 'System bootstrap initial super-admin', 0, 'USER', ?, UTC_TIMESTAMP(3))`,
        [userId, userId]
      );
      await conn.query(
        `UPDATE sys_system_settings SET setting_value = 'READY', version = version + 1
         WHERE setting_key = 'bootstrap_state' AND setting_value = 'PENDING'`
      );
      return suppliedPassword ? undefined : rawPassword;
    });
    // 仅提交成功后交付随机密码；交付失败进入人工恢复，绝不清除READY重新自举。
    if (generatedPassword) await this.deliverInitialPassword(generatedPassword);
  }
}
```

以上是自举事务参考实现，不替代启动总入口的 RegistryHub/密钥环/配置Schema完整验证。
启动失败不得接收业务请求；事务回滚保留PENDING，允许在仍为空库时重试；READY不能自动降回PENDING。
初始化期间禁止其他进程/工具写库；标记行锁串行化并发启动，自举标记不向配置API开放。

---

### 5.2 登录 IP + 账号双维防爆破状态机、Argon2id 并发信号量与匿名安全审计（闭环第 四 节 #6）

为防止未认证攻击者利用高频登录请求耗尽 Argon2id 内存/CPU 或刷爆 `sys_anonymous_security_logs`，认证链路建立三道防线：

1. **防线 1：客户端 IP 级滑动窗口限流与锁死（`IpLoginRateLimiter`）**：
   - 仅当请求来自显式配置的 `TRUSTED_PROXY_CIDRS` 时才解析 `X-Forwarded-For`，否则直接使用底层 `req.socket.remoteAddress`；
   - 单个 IP 在 5 分钟内允许最多 **20 次**登录尝试；超过后直接内存拦截 15 分钟（不再进入 Argon2id 计算），且每个被封禁 IP 每分钟最多写 1 条汇聚匿名审计日志，防止匿名审计表被洪水打满。
2. **防线 2：Argon2id 并发信号量（`Argon2Semaphore`）**：
   - 限制全进程同时执行的 Argon2id 哈希/验签协程上限为 **`maxConcurrent = 8`**（内存峰值 `8 * 64MB = 512MB`），等待队列上限 `32`，超出直接返回 `429 ERR_RATE_LIMIT_USER`。
3. **防线 3：账号级 5 次连续失败锁定（`failed_login_count` & `locked_until`）**：
   - 单账号连续错误达 **5 次**锁定 15 分钟，每次错误返回 `remaining_attempts = Math.max(0, 5 - failedCount)`。

```typescript
// packages/security/src/password-hasher.ts
import { hash, verify } from '@node-rs/argon2';
import { AppError } from '@mysql-mcp/core-engine';

class ConcurrencySemaphore {
  private active = 0;
  private readonly waitQueue: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxWaitQueue: number
  ) {}

  public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      if (this.waitQueue.length >= this.maxWaitQueue) {
        throw new AppError({
          code: 'ERR_RATE_LIMIT_USER',
          statusCode: 429,
          message: 'Authentication service is busy. Please retry shortly.',
          retryAfterSec: 3,
        });
      }
      await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }
}

const argon2Semaphore = new ConcurrencySemaphore(8, 32);

const ARGON2_OPTS = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2Semaphore.runExclusive(() => hash(plain, ARGON2_OPTS));
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  return argon2Semaphore.runExclusive(() => verify(hashed, plain));
}
```

---

### 5.3 HttpOnly 会话管理、Session Regeneration 与密码变更撤销语义（闭环第 四 节 #3）

- **Cookie 基线**：`mcp_admin_sid`，`HttpOnly; Secure; SameSite=Strict; Path=/api/v1; Max-Age=28800`。
- **密码变更的完整撤销与在途中断语义（对齐 PRD L139-143）**：
  当用户在 `POST /api/v1/auth/change-password` 修改密码时：
  1. 在同一个元数据库事务内：更新 `password_hash`、置 `must_change_password = 0`、更新 `password_updated_at = UTC_TIMESTAMP(3)`、递增 **`auth_version = auth_version + 1`**、递增 **`version = version + 1`**，并写入 `sys_user_approvals` 审计记录；
  2. 事务提交后：**立即同步调用 `registryHub.markUserInvalidatedSync(userId)` 与 `lifecycleCoordinator.cancelQueriesByUser(userId, 'PASSWORD_CHANGED')`**，强制中断该用户所有正在执行的在途 SQL 查询，并使所有携带旧 `authVersion` 的排队中 `RequestContextSnapshot` 在借出连接二次核验时全部失效；
  3. 销毁该用户除当前会话外的所有其他 Web Session，并为当前会话轮换全新的 `sessionId` 与 `csrfSecret`（Session Regeneration）；
  4. 用户名下未吊销的 PAT 在下一次新建请求时将绑定最新的 `authVersion`，若管理员或用户在改密时勾选 `revokeAllPats: true`（默认推荐），则在同一事务内批量设置 `UPDATE sys_pats SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL`。

---

### 5.4 `preValidation` 无副作用 CSRF 校验器与 `/api/v1/auth/csrf` 公开端点

```typescript
// apps/admin-api/src/middlewares/csrf.prevalidation.ts
import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@mysql-mcp/core-engine';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function generateCsrfToken(serverPepper: string, seed: string): string {
  return crypto.createHmac('sha256', serverPepper).update(`csrf:${seed}`).digest('hex');
}

export function verifyCsrfTokenConstantTime(
  serverPepper: string,
  seed: string,
  providedToken: string | undefined
): boolean {
  if (!providedToken || typeof providedToken !== 'string') return false;
  const expected = generateCsrfToken(serverPepper, seed);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(providedToken, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function csrfPreValidationHook(
  req: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  if (SAFE_METHODS.has(req.method)) return;

  const seed = req.session?.csrfSecret ?? req.cookies['mcp_csrf_seed'];
  const headerToken = req.headers['x-csrf-token'] as string | undefined;

  if (!seed || !verifyCsrfTokenConstantTime(req.runtimeCtx.config.SERVER_PEPPER, seed, headerToken)) {
    throw new AppError({
      code: 'ERR_CSRF_INVALID',
      statusCode: 403,
      message: 'CSRF Token 校验失败或已过期，请刷新后重试。',
    });
  }
}
```

---

### 5.5 四级分层守卫 (`AuthGuard ➔ StatusGuard ➔ MustChangePwdGuard ➔ RoleGuard`) 实现

```typescript
// apps/admin-api/src/middlewares/guards.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@mysql-mcp/core-engine';

const PUBLIC_PATHS = new Set([
  '/api/v1/auth/csrf',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
]);

const NON_ACTIVE_ALLOWED_PATHS = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/approvals/resubmit',
]);

const MUST_CHANGE_PWD_ALLOWED_PATHS = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/auth/change-password',
]);

export async function fourTierSecurityGuard(
  req: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const routePath = req.routeOptions.url ?? req.url.split('?')[0];

  if (PUBLIC_PATHS.has(routePath)) return;

  const currentUser = req.currentUser;
  if (!currentUser) {
    throw new AppError({
      code: 'ERR_AUTH_UNAUTHORIZED',
      statusCode: 401,
      message: '会话未登录或已超时，请重新登录。',
    });
  }

  // L2: StatusGuard 严格优先于 MustChangePwdGuard，防止 PENDING 用户陷入改密死循环
  if (currentUser.status !== 'ACTIVE') {
    if (NON_ACTIVE_ALLOWED_PATHS.has(routePath)) {
      if (routePath === '/api/v1/approvals/resubmit' && currentUser.status !== 'REJECTED') {
        throw new AppError({
          code: 'ERR_VALIDATION_FAILED',
          statusCode: 400,
          message: '仅已驳回 (REJECTED) 状态的账号允许重新提交审批申请。',
        });
      }
      return;
    }

    const statusCodeMap = {
      PENDING: 'ERR_AUTH_ACCOUNT_PENDING',
      REJECTED: 'ERR_AUTH_ACCOUNT_REJECTED',
      DISABLED: 'ERR_AUTH_ACCOUNT_DISABLED',
    } as const;

    throw new AppError({
      code: statusCodeMap[currentUser.status as keyof typeof statusCodeMap] ?? 'ERR_AUTH_ACCOUNT_DISABLED',
      statusCode: 403,
      message: `当前账号状态 (${currentUser.status}) 无权访问业务接口。`,
    });
  }

  // L3: MustChangePwdGuard (仅对 ACTIVE 用户生效，含密码自然过期判定)
  const now = Date.now();
  const is_password_expired = Boolean(
    currentUser.password_expires_days !== null &&
    currentUser.password_updated_at &&
    now > (new Date(currentUser.password_updated_at).getTime() + (currentUser.password_expires_days || 90) * 86400000)
  );

  if (currentUser.must_change_password || is_password_expired) {
    const isExempted = MUST_CHANGE_PWD_ALLOWED_PATHS.has(routePath) ||
      (req.method === 'GET' && routePath === '/api/v1/auth/password-policy');

    if (!isExempted) {
      throw new AppError({
        code: 'ERR_MUST_CHANGE_PASSWORD',
        statusCode: 403,
        message: is_password_expired ? '密码已超过有效期限，请修改密码后继续使用。' : '首次登录或密码已被重置，请修改密码后继续使用。',
        actionGuidance: '密码安全策略拦截中，请在改密对话框中设置符合复杂度要求的新密码。',
      });
    }
    return;
  }

  // L4: RoleGuard
  const requiredRoles = req.routeOptions.config?.requiredRoles as string[] | undefined;
  if (requiredRoles && requiredRoles.length > 0) {
    const hasRole = currentUser.roles.some((r) => requiredRoles.includes(r));
    if (!hasRole) {
      throw new AppError({
        code: 'ERR_RBAC_FORBIDDEN',
        statusCode: 403,
        message: '当前角色无权访问该管理接口。',
      });
    }
  }
}
```

---

## 第六章：数据面协议适配层与 10 步核心执行流水线详细设计

### 6.1 三大协议适配器与 `reply.raw` 精确断连 `AbortSignal` 级联绑定（闭环 `BE-R02`）

针对评审问题 **`BE-R02`**（Node.js 的 `req.raw` 作为可读流在正常读取完 POST JSON 请求体后就会触发 `'close'` 事件，而此时响应尚未发送 `!reply.sent === true`，原代码监听 `req.raw.on('close')` 会导致正常 POST 请求一进入执行器就被误判为断连取消），本节重构断连检测机制：
- **严禁将 `req.raw` 的 `'close'` 事件直接等同于客户端断连**；
- 区分三类真实中断信号：
  1. **请求体上传中途流产**：监听 `req.raw.on('aborted', ...)`；
  2. **等待响应期间客户端主动掐断 TCP/HTTP 连接**：监听响应流 `reply.raw.on('close', ...)` 并检查 `!reply.raw.writableEnded && !reply.raw.writableFinished`，以及底层套接字 `req.raw.socket?.on('close', ...)`；
  3. **MCP 协议显式取消通知**：接收客户端发送的 JSON-RPC `notifications/cancelled`（携带目标 `requestId`）；
- 在 `reply.raw.once('finish', cleanup)` 时自动卸载全部监听器，防止 HTTP Keep-Alive 长连接上的 EventEmitter 监听器泄露。

```typescript
// apps/gateway/src/adapters/types.ts
export interface InternalMcpInvocation {
  requestId: string;
  queryInstanceId: string;
  sessionId: string | null;
  rawPatToken: string;
  clientIp: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  abortSignal: AbortSignal;
  cleanupListeners: () => void;
}
```

```typescript
// apps/gateway/src/adapters/streamable-http.adapter.ts
import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { InternalMcpInvocation } from './types';

export function buildStreamableHttpInvocation(
  req: FastifyRequest,
  reply: FastifyReply
): InternalMcpInvocation {
  const abortController = new AbortController();
  const socket = req.raw.socket;

  const onRequestAborted = () => {
    if (!abortController.signal.aborted) {
      abortController.abort(new Error('CLIENT_REQUEST_UPLOAD_ABORTED'));
    }
  };

  // 核心修复 (BE-R02)：在 reply.raw (ServerResponse) 与底层 socket 上检测响应完成前的非正常关闭，
  // 绝不因 req.raw (IncomingMessage) 正常读完请求体而误触发 abort！
  const onPrematureClose = () => {
    if (!reply.raw.writableEnded && !reply.raw.writableFinished && !abortController.signal.aborted) {
      abortController.abort(new Error('CLIENT_SOCKET_CLOSED_PREMATURELY'));
    }
  };

  const cleanupListeners = () => {
    req.raw.removeListener('aborted', onRequestAborted);
    reply.raw.removeListener('close', onPrematureClose);
    reply.raw.removeListener('finish', cleanupListeners);
    socket?.removeListener('close', onPrematureClose);
  };

  req.raw.on('aborted', onRequestAborted);
  reply.raw.on('close', onPrematureClose);
  reply.raw.once('finish', cleanupListeners);
  socket?.on('close', onPrematureClose);

  if (socket?.destroyed && !reply.raw.writableEnded) {
    abortController.abort(new Error('CLIENT_SOCKET_ALREADY_DESTROYED'));
  }

  const authHeader = req.headers.authorization ?? '';
  const rawPatToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const body = req.body as {
    id?: string | number;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };

  return {
    requestId: String(body?.id ?? crypto.randomUUID()),
    queryInstanceId: `q_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
    sessionId: (req.headers['mcp-session-id'] as string | undefined) ?? null,
    rawPatToken,
    clientIp: req.ip,
    toolName: body?.params?.name ?? '',
    toolArgs: body?.params?.arguments ?? {},
    abortSignal: abortController.signal,
    cleanupListeners,
  };
}
```

---

### 6.2 PAT 验签、多角色配额真实最大值合并、三级限流优先级与同步墓碑注册表（闭环 `BE-R06`、`BE-R07`、`BE-R12` 及第 四 节 #4）

针对评审问题 **`BE-R06`**（原代码 `Math.max(...roles, 50/500)` 将默认值混入最大值计算，导致管理员配置的 `defaultLimit: 5, maxLimit: 10` 被强行放大为 `50/500`）与 **`BE-R12`**（全链路 `EntityId = string`）：
1. **空角色拒绝（Default Deny）**：若用户未绑定任何有效角色（`roles.length === 0`），直接抛出 `403 ERR_RBAC_FORBIDDEN`；
2. **纯角色间最大值计算**：严格仅在用户实际持有的 `roles` 数组内计算 `Math.max(...)`，**绝不混入兜底常量**，并强制约束 `defaultLimit = Math.min(defaultLimit, maxLimit)`；
3. **三级限流配置优先级（`USER > ROLE > GLOBAL`）与突发容量接线**：Repository 将同一 USER 行的 `qpm_limit` 与 `burst_capacity` 一起映射为 `userRateLimit`；无行传 null。QPM 按 `USER > ROLE > GLOBAL`，突发容量按 `USER > GLOBAL`（角色无此字段），熔断参数仍来自 GLOBAL。更新或删除覆盖提交后同步失效快照，重载两项配置，禁止沿用旧突发容量。生产启动必须加载 GLOBAL 后才 ready；可选 GLOBAL 参数仅兼容独立片段测试。

```typescript
// packages/core-engine/src/registry-hub.ts
import { AppError } from './app-error';

export type EntityId = string;

export function normalizeEntityId(raw: string | number | bigint): EntityId {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid EntityId format: '${raw}'`);
    }
    return BigInt(trimmed).toString(10);
  }
  if (typeof raw === 'bigint') {
    if (raw < 0n) throw new Error(`Negative bigint EntityId: ${raw.toString(10)}`);
    return raw.toString(10);
  }
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) {
    return String(raw);
  }
  throw new Error(`Unsafe number passed as EntityId: ${String(raw)}`);
}

export interface UserRateLimitConfig {
  qpmLimit: number;
  burstCapacity: number;
}

// Repository 的 USER 行映射契约：两项必须来自同一已持久化记录；无覆盖返回 null。
// 输入行已通过数据库域约束；PUT 省略 burstCapacity 时先按 API 默认 10 落库。
export function mapUserRateLimit(row: {
  qpm_limit: number;
  burst_capacity: number;
} | null): UserRateLimitConfig | null {
  return row === null ? null : {
    qpmLimit: row.qpm_limit,
    burstCapacity: row.burst_capacity,
  };
}

export interface GlobalRateLimitConfig {
  qpmLimit: number;
  burstCapacity: number;
  loopBreakerThreshold: number;
  loopBreakerWindowSec: number;
}

export interface RequestContextSnapshot {
  requestId: string;
  userId: EntityId;
  username: string;
  patId: EntityId;
  patExpiresAt: number | null;
  authVersion: number;
  globalPolicyVersion: number;
  activeRoleIds: EntityId[];
  effectiveProfile: {
    id: EntityId;
    name: string;
    generation: number;
    lowerCaseTableNames: number;
    capacityQpm: number;
    maxPoolSize: number;
    maxInflightConcurrency: number;
    queueTimeoutMs: number;
  };
  effectiveDatabase: string;
  dbAcl: {
    denies: string[];
    allows: string[];
  };
  tableAcl: {
    blacklists: string[];
    whitelists: string[];
  };
  quotas: {
    defaultLimit: number;
    maxLimit: number;
    maxTimeoutMs: number;
    userQpmLimit: number;
    userBurstCapacity?: number;
    loopBreakerThreshold?: number;
    loopBreakerWindowSec?: number;
    maxInflightConcurrency: number;
  };
  snapshotCreatedAt: number;
  snapshotTtlMs: number;
}

export class SnapshotBuilder {
  public static buildSnapshot(params: {
    requestId: string;
    user: {
      id: EntityId | number;
      username: string;
      status: string;
      mustChangePassword: boolean;
      authVersion: number;
      roleIds: Array<EntityId | number>;
    };
    pat: { id: EntityId | number; expiresAt: number | null; isRevoked: boolean };
    roles: Array<{
      id: EntityId | number;
      roleName: string;
      defaultLimit: number;
      maxLimit: number;
      maxTimeoutMs: number;
      userQpmLimit: number;
      maxInflightConcurrency: number;
    }>;
    userRateLimit: UserRateLimitConfig | null;
    globalRateLimit?: GlobalRateLimitConfig;
    profile: {
      id: EntityId | number;
      name: string;
      generation?: number;
      lowerCaseTableNames?: number;
      defaultDatabase: string;
      capacityQpm: number;
      maxPoolSize: number;
      maxInflightConcurrency: number;
      queueTimeoutMs: number;
      status: string;
    };
    requestedDatabase?: string;
    dbAclRows: Array<{
      roleId: EntityId | number;
      profileId: EntityId | number;
      databaseName: string;
      isAllowed: boolean;
    }>;
    tableAclRows: Array<{
      roleId: EntityId | number;
      profileId: EntityId | number;
      ruleType: 'BLACKLIST' | 'WHITELIST';
      tablePattern: string;
    }>;
    globalPolicyVersion: number;
  }): RequestContextSnapshot {
    const { user, pat, roles, profile } = params;

    if (user.status === 'PENDING') {
      throw new AppError({ code: 'ERR_AUTH_ACCOUNT_PENDING', statusCode: 403, message: 'Account is pending approval.' });
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError({ code: 'ERR_AUTH_ACCOUNT_DISABLED', statusCode: 403, message: 'Account is disabled or rejected.' });
    }
    if (user.mustChangePassword) {
      throw new AppError({
        code: 'ERR_MUST_CHANGE_PASSWORD',
        statusCode: 403,
        message: 'Password reset required before invoking MCP tools.',
      });
    }
    if (pat.isRevoked || (pat.expiresAt !== null && Date.now() > pat.expiresAt)) {
      throw new AppError({ code: 'ERR_AUTH_INVALID_PAT', statusCode: 401, message: 'PAT is expired or revoked.' });
    }

    // 【闭环 BE-R06】：拒绝无角色空授权主体，且严格只在实际角色间取 Math.max，绝不掺入默认最小值常量！
    if (!Array.isArray(roles) || roles.length === 0) {
      throw new AppError({
        code: 'ERR_RBAC_FORBIDDEN',
        statusCode: 403,
        message: 'User has no assigned active roles.',
      });
    }

    const maxLimit = Math.max(...roles.map((r) => r.maxLimit));
    const rawDefaultLimit = Math.max(...roles.map((r) => r.defaultLimit));
    const defaultLimit = Math.min(rawDefaultLimit, maxLimit);
    const maxTimeoutMs = Math.max(...roles.map((r) => r.maxTimeoutMs));
    const maxInflightConcurrency = Math.max(...roles.map((r) => r.maxInflightConcurrency));

    const roleQpms = roles
      .map((r) => r.userQpmLimit)
      .filter((q): q is number => typeof q === 'number' && !Number.isNaN(q));
    const hasUnlimitedRoleQpm = roleQpms.includes(-1);
    const mergedRoleQpm = hasUnlimitedRoleQpm
      ? -1
      : roleQpms.length > 0
        ? Math.max(...roleQpms)
        : (params.globalRateLimit?.qpmLimit ?? 60);

    // 限流优先级：用户专属配额 (USER) > 角色合并配额 (ROLE) > 全局默认配额 (GLOBAL)
    const effectiveUserQpm = params.userRateLimit?.qpmLimit ?? mergedRoleQpm;

    const normProfileId = normalizeEntityId(profile.id);
    const activeRoleIdSet = new Set(roles.map((r) => normalizeEntityId(r.id)));
    // 严格校验 roleId 交集与 profileId 作用域，防止混入非当前用户角色的 ACL 规则
    const applicableDbAcls = params.dbAclRows.filter((r) => {
      const rid = normalizeEntityId(r.roleId);
      const pid = normalizeEntityId(r.profileId);
      return activeRoleIdSet.has(rid) && (pid === '0' || pid === normProfileId);
    });
    const applicableTableAcls = params.tableAclRows.filter((r) => {
      const rid = normalizeEntityId(r.roleId);
      const pid = normalizeEntityId(r.profileId);
      return activeRoleIdSet.has(rid) && (pid === '0' || pid === normProfileId);
    });

    const quotas: RequestContextSnapshot['quotas'] = {
      defaultLimit,
      maxLimit,
      maxTimeoutMs,
      userQpmLimit: effectiveUserQpm,
      userBurstCapacity: params.userRateLimit?.burstCapacity ?? params.globalRateLimit?.burstCapacity,
      maxInflightConcurrency,
    };
    if (params.globalRateLimit) {
      quotas.loopBreakerThreshold = params.globalRateLimit.loopBreakerThreshold;
      quotas.loopBreakerWindowSec = params.globalRateLimit.loopBreakerWindowSec;
    }

    return {
      requestId: params.requestId,
      userId: normalizeEntityId(user.id),
      username: user.username,
      patId: normalizeEntityId(pat.id),
      patExpiresAt: pat.expiresAt,
      authVersion: user.authVersion,
      globalPolicyVersion: params.globalPolicyVersion,
      activeRoleIds: roles.map((r) => normalizeEntityId(r.id)),
      effectiveProfile: {
        id: normProfileId,
        name: profile.name,
        generation: profile.generation ?? 1,
        lowerCaseTableNames: profile.lowerCaseTableNames ?? 1,
        capacityQpm: profile.capacityQpm,
        maxPoolSize: profile.maxPoolSize,
        maxInflightConcurrency: profile.maxInflightConcurrency,
        queueTimeoutMs: profile.queueTimeoutMs,
      },
      effectiveDatabase: params.requestedDatabase || profile.defaultDatabase,
      dbAcl: {
        denies: applicableDbAcls.filter((r) => !r.isAllowed).map((r) => r.databaseName),
        allows: applicableDbAcls.filter((r) => r.isAllowed).map((r) => r.databaseName),
      },
      tableAcl: {
        blacklists: applicableTableAcls
          .filter((r) => r.ruleType === 'BLACKLIST')
          .map((r) => r.tablePattern),
        whitelists: applicableTableAcls
          .filter((r) => r.ruleType === 'WHITELIST')
          .map((r) => r.tablePattern),
      },
      quotas,
      snapshotCreatedAt: Date.now(),
      snapshotTtlMs: 2000,
    };
  }
}

export class RegistryHub {
  private readonly invalidatedUsers = new Set<EntityId>();
  private readonly invalidationEpochs = new Map<EntityId, number>();
  private readonly minRequiredAuthVersions = new Map<EntityId, number>();
  private readonly revokedPats = new Set<EntityId>();
  private readonly userAuthVersions = new Map<EntityId, { version: number; status: string }>();
  private readonly profileStates = new Map<EntityId, { active: boolean; generation: number }>();
  private readonly activeProfileConfigs: Array<{
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    passwordEncrypted: string;
    defaultDatabase: string;
    maxPoolSize: number;
    queueTimeoutMs: number;
    tlsConfig?: Record<string, unknown> | null;
    sshConfig?: {
      use_ssh: boolean;
      host?: string;
      port?: number;
      username?: string;
      private_key_encrypted?: string;
      host_fingerprint_sha256?: string;
    } | null;
  }> = [];
  private globalPolicyVersion = 1;
  private isInitializedFromDb = false;

  constructor(private readonly metadataPool?: unknown) {}

  public async initializeAll(): Promise<void> {
    if (!this.metadataPool) return;
    const pool = this.metadataPool as { query: (sql: string) => Promise<any> };
    const [users] = await pool.query(`SELECT id, status, auth_version FROM sys_users`);
    for (const u of users ?? []) {
      const uid = normalizeEntityId(u.id);
      const ver = Number(u.auth_version);
      this.userAuthVersions.set(uid, {
        version: ver,
        status: String(u.status),
      });
      this.minRequiredAuthVersions.set(uid, ver);
      if (u.status !== 'ACTIVE') {
        this.invalidatedUsers.add(uid);
      }
    }
    const [profiles] = await pool.query(`SELECT * FROM sys_profiles`);
    this.activeProfileConfigs.length = 0;
    for (const p of profiles ?? []) {
      const pid = normalizeEntityId(p.id);
      const isActive = p.status === 'ACTIVE';
      this.profileStates.set(pid, {
        active: isActive,
        generation: Number(p.version ?? 1),
      });
      if (isActive) {
        this.activeProfileConfigs.push({
          id: pid,
          name: String(p.name ?? ''),
          host: String(p.host ?? ''),
          port: Number(p.port ?? 3306),
          username: String(p.username ?? ''),
          passwordEncrypted: String(p.password_encrypted ?? p.passwordEncrypted ?? ''),
          defaultDatabase: String(p.default_database ?? p.defaultDatabase ?? ''),
          maxPoolSize: Number(p.max_pool_size ?? p.maxPoolSize ?? 10),
          queueTimeoutMs: Number(p.queue_timeout_ms ?? p.queueTimeoutMs ?? 3000),
          tlsConfig: p.tls_config ?? p.tlsConfig ?? null,
          sshConfig: p.ssh_config ?? p.sshConfig ?? null,
        });
      }
    }
    this.isInitializedFromDb = true;
  }

  public getActiveProfileConfigs(): Array<{
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    passwordEncrypted: string;
    defaultDatabase: string;
    maxPoolSize: number;
    queueTimeoutMs: number;
    tlsConfig?: Record<string, unknown> | null;
    sshConfig?: {
      use_ssh: boolean;
      host?: string;
      port?: number;
      username?: string;
      private_key_encrypted?: string;
      host_fingerprint_sha256?: string;
    } | null;
  }> {
    return [...this.activeProfileConfigs];
  }

  /**
   * 闭环 BE-R2-03 & BE-R3-06：
   * - invalidationEpochs 单调递增以拦截在途旧重载；
   * - 数据库版本底线 (minRequiredAuthVersions) 与通知代际解耦：仅当调用方显式传入已提交的 committedAuthVersion 时才抬升底线，
   *   不在本地盲目用 prev.version + 1 推算（防止先前重载已读到后续事务提交的 v3 后，迟到的通知将要求版本推高到不存在的 v4）。
   */
  public markUserInvalidatedSync(
    userId: EntityId | number,
    committedAuthVersion?: number
  ): void {
    const uid = normalizeEntityId(userId);
    const nextEpoch = (this.invalidationEpochs.get(uid) ?? 0) + 1;
    this.invalidationEpochs.set(uid, nextEpoch);
    this.invalidatedUsers.add(uid);

    const prev = this.userAuthVersions.get(uid);
    const currentKnownVer = prev?.version ?? 1;
    const prevMin = this.minRequiredAuthVersions.get(uid) ?? currentKnownVer;
    const nextMin =
      committedAuthVersion !== undefined
        ? Math.max(prevMin, currentKnownVer, committedAuthVersion)
        : Math.max(prevMin, currentKnownVer);

    this.minRequiredAuthVersions.set(uid, nextMin);
    this.userAuthVersions.set(uid, { version: nextMin, status: 'INVALIDATED' });
  }

  public markPatRevokedSync(patId: EntityId | number): void {
    this.revokedPats.add(normalizeEntityId(patId));
  }

  public async reloadUserAuthFromDb(userId: EntityId | number): Promise<void> {
    const uid = normalizeEntityId(userId);
    if (!this.metadataPool) return;

    const capturedEpoch = this.invalidationEpochs.get(uid) ?? 0;
    const pool = this.metadataPool as { query: (sql: string, vals: unknown[]) => Promise<any> };
    const [rows] = await pool.query(
      `SELECT status, auth_version FROM sys_users WHERE id = ? LIMIT 1`,
      [uid]
    );

    // 1. 若查询期间又发生了新的 markUserInvalidatedSync（代际已前进），直接丢弃本次过期的重载结果！
    const currentEpoch = this.invalidationEpochs.get(uid) ?? 0;
    if (currentEpoch !== capturedEpoch) {
      return;
    }

    if (!rows || rows.length === 0 || rows[0].status !== 'ACTIVE') {
      this.invalidatedUsers.add(uid);
      return;
    }

    const dbVersion = Number(rows[0].auth_version);
    const requiredMinVersion =
      this.minRequiredAuthVersions.get(uid) ??
      this.userAuthVersions.get(uid)?.version ??
      1;

    // 2. 防止版本回退：若数据库读回的版本低于已发布的最高版本或要求底线，保持墓碑拒绝状态不清除！
    if (dbVersion < requiredMinVersion) {
      this.invalidatedUsers.add(uid);
      return;
    }

    this.minRequiredAuthVersions.set(uid, dbVersion);
    this.userAuthVersions.set(uid, {
      version: dbVersion,
      status: String(rows[0].status),
    });
    this.invalidatedUsers.delete(uid);
  }

  public isUserInvalidated(userId: EntityId | number): boolean {
    return this.invalidatedUsers.has(normalizeEntityId(userId));
  }

  public isPatRevoked(patId: EntityId | number): boolean {
    return this.revokedPats.has(normalizeEntityId(patId));
  }

  public getUserAuthVersion(userId: EntityId | number): number | undefined {
    return this.userAuthVersions.get(normalizeEntityId(userId))?.version;
  }

  public getGlobalPolicyVersion(): number {
    return this.globalPolicyVersion;
  }

  public incrementGlobalPolicyVersionSync(): number {
    this.globalPolicyVersion += 1;
    return this.globalPolicyVersion;
  }

  public isProfileActive(profileId: EntityId | number, expectedGeneration?: number): boolean {
    const state = this.profileStates.get(normalizeEntityId(profileId));
    if (!state) {
      return !this.isInitializedFromDb && this.profileStates.size === 0;
    }
    if (!state.active) return false;
    if (expectedGeneration !== undefined && state.generation !== expectedGeneration) return false;
    return true;
  }
}
```

---

### 6.3 在途并发双维原子预留 (`InflightTracker`) 与用户级内存预算追踪

```typescript
// packages/core-engine/src/inflight-tracker.ts
import { AppError } from './app-error';
import type { EntityId } from './registry-hub';
const normalizeEntityId = (raw: EntityId | number): EntityId => { if (typeof raw === 'number') { if (!Number.isSafeInteger(raw) || raw < 0) throw new Error('Unsafe number'); return String(raw); } return BigInt(String(raw).trim()).toString(10); };

export class InflightTracker {
  private readonly userInflight = new Map<EntityId, number>();
  private readonly profileInflight = new Map<EntityId, number>();

  public acquire(
    rawUserId: EntityId | number,
    maxUserInflight: number,
    rawProfileId: EntityId | number,
    maxProfileInflight: number
  ): () => void {
    const userId = normalizeEntityId(rawUserId);
    const profileId = normalizeEntityId(rawProfileId);

    const curUser = this.userInflight.get(userId) ?? 0;
    if (curUser >= maxUserInflight) {
      throw new AppError({
        code: 'ERR_CONCURRENCY_LIMIT',
        statusCode: 429,
        message: `User in-flight concurrency limit (${maxUserInflight}) exceeded.`,
        actionGuidance: 'Please wait for your previous in-flight queries to complete.',
      });
    }

    const curProf = this.profileInflight.get(profileId) ?? 0;
    if (curProf >= maxProfileInflight) {
      throw new AppError({
        code: 'ERR_CONCURRENCY_LIMIT',
        statusCode: 429,
        message: `Profile in-flight concurrency limit (${maxProfileInflight}) exceeded.`,
        actionGuidance: 'Target database profile is currently under high concurrent load.',
      });
    }

    this.userInflight.set(userId, curUser + 1);
    this.profileInflight.set(profileId, curProf + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const u = (this.userInflight.get(userId) ?? 1) - 1;
      if (u <= 0) this.userInflight.delete(userId);
      else this.userInflight.set(userId, u);

      const p = (this.profileInflight.get(profileId) ?? 1) - 1;
      if (p <= 0) this.profileInflight.delete(profileId);
      else this.profileInflight.set(profileId, p);
    };
  }
}
```

---

### 6.4 双重漏斗令牌桶 (`DualBucketRateLimiter`) 与 Agent 死循环熔断器 (`AgentLoopBreaker`)

```typescript
// packages/core-engine/src/dual-bucket-limiter.ts
import crypto from 'node:crypto';
import { AppError } from './app-error';
import type { EntityId } from './registry-hub';
const normalizeEntityId = (raw: EntityId | number): EntityId => { if (typeof raw === 'number') { if (!Number.isSafeInteger(raw) || raw < 0) throw new Error('Unsafe number'); return String(raw); } return BigInt(String(raw).trim()).toString(10); };

interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

export class DualBucketRateLimiter {
  private readonly userBuckets = new Map<EntityId, TokenBucket>();
  private readonly profileBuckets = new Map<EntityId, TokenBucket>();

  private refillAndPeek(
    map: Map<EntityId, TokenBucket>,
    key: EntityId,
    qpm: number,
    explicitBurstCapacity: number | undefined,
    now: number
  ): { bucket: TokenBucket; waitSec: number } {
    const ratePerMs = qpm / 60000;
    const capacity =
      explicitBurstCapacity && explicitBurstCapacity > 0
        ? explicitBurstCapacity
        : Math.max(1, Math.min(qpm, Math.ceil(qpm * 0.25)));

    let bucket = map.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefillMs: now };
      map.set(key, bucket);
    } else {
      const elapsed = Math.max(0, now - bucket.lastRefillMs);
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * ratePerMs);
      bucket.lastRefillMs = now;
    }

    if (bucket.tokens >= 1) {
      return { bucket, waitSec: 0 };
    }
    const needed = 1 - bucket.tokens;
    const waitSec = Math.max(1, Math.ceil(needed / (qpm / 60)));
    return { bucket, waitSec };
  }

  public acquireOrThrow(params: {
    userId: EntityId | number;
    userQpmLimit: number;
    userBurstCapacity?: number;
    profileId: EntityId | number;
    profileCapacityQpm: number;
  }): void {
    const now = Date.now();
    const uid = normalizeEntityId(params.userId);
    const pid = normalizeEntityId(params.profileId);

    let userCheck: { bucket: TokenBucket; waitSec: number } | null = null;
    if (params.userQpmLimit !== -1) {
      userCheck = this.refillAndPeek(
        this.userBuckets,
        uid,
        params.userQpmLimit,
        params.userBurstCapacity,
        now
      );
      if (userCheck.waitSec > 0) {
        throw new AppError({
          code: 'ERR_RATE_LIMIT_USER',
          statusCode: 429,
          message: `User rate limit (${params.userQpmLimit} QPM) exceeded.`,
          retryAfterSec: userCheck.waitSec,
          actionGuidance: `Please slow down and retry after ${userCheck.waitSec} seconds.`,
        });
      }
    }

    const profCheck = this.refillAndPeek(
      this.profileBuckets,
      pid,
      params.profileCapacityQpm,
      undefined,
      now
    );
    if (profCheck.waitSec > 0) {
      throw new AppError({
        code: 'ERR_RATE_LIMIT_PROFILE',
        statusCode: 429,
        message: `Profile capacity rate limit (${params.profileCapacityQpm} QPM) exceeded.`,
        retryAfterSec: profCheck.waitSec,
        actionGuidance: `Database profile is busy. Retry after ${profCheck.waitSec} seconds.`,
      });
    }

    if (userCheck) userCheck.bucket.tokens -= 1;
    profCheck.bucket.tokens -= 1;
  }
}

export type LoopBreakerErrorCategory =
  | 'AST_OR_ACL_REJECTED'
  | 'MYSQL_EXECUTION_ERROR'
  | 'QUERY_TIMEOUT'
  | 'CLIENT_CANCELED'
  | 'CAPACITY_OR_RATE_LIMIT';

export interface LoopBreakerStateEntry {
  lastFingerprint: string;
  count: number;
  firstErrorAt: number;
  blockedUntil: number;
  failureTimestamps?: number[];
}

/**
 * 闭环 BE-R5-02：Agent 连续相同报错死循环熔断器完整状态机
 * 1. 公开执行前检查 (checkBeforeExecution)、执行后结果反馈 (recordOutcome / recordFailure / recordSuccess) 与包裹执行器 (executeWithBreaker)；
 * 2. 错误分类边界：仅将 AST/ACL 拒绝、MySQL 执行报错（如列不存在 ER_BAD_FIELD_ERROR）与查询超时计入熔断；
 *    客户端主动取消 (CLIENT_CANCELED) 与网关限流/排队背压 (CAPACITY_OR_RATE_LIMIT) 绝不计入死循环；
 * 3. 隔离维度：支持 (userId, profileId, sessionId) 隔离（无 sessionId 时回退为 userId:profileId）；
 * 4. 有界容量：Map 硬上限 maxTrackedKeys = 10000，超限时优先清理过期项并按 FIFO 淘汰最老条目，杜绝内存泄漏。
 */
export class AgentLoopBreaker {
  public readonly states = new Map<string, LoopBreakerStateEntry>();

  constructor(
    private readonly defaultThreshold = 3,
    private readonly defaultWindowSec = 30,
    private readonly maxTrackedKeys = 10000
  ) {}

  public static computeSqlFingerprint(sql: string, errorCode?: string): string {
    const normalized = sql.trim().replace(/;+$/, '').replace(/\s+/g, ' ').toLowerCase();
    const raw = errorCode ? `${normalized}|${errorCode}` : normalized;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
  }

  public static isCountableError(categoryOrCode?: string): boolean {
    if (!categoryOrCode) return true;
    const nonCountable = new Set([
      'CLIENT_CANCELED',
      'CAPACITY_OR_RATE_LIMIT',
      'ERR_QUERY_CANCELED',
      'ERR_CONCURRENCY_LIMIT',
      'ERR_RATE_LIMIT_USER',
      'ERR_RATE_LIMIT_PROFILE',
      'ERR_POOL_QUEUE_TIMEOUT',
      'ERR_AUDIT_BUFFER_FULL',
      'ERR_MEMORY_BUDGET_EXCEEDED',
    ]);
    return !nonCountable.has(categoryOrCode);
  }

  private buildKey(
    userId: EntityId | number,
    profileId: EntityId | number,
    sessionId?: string | null
  ): string {
    const base = `${normalizeEntityId(userId)}:${normalizeEntityId(profileId)}`;
    return sessionId ? `${base}:${sessionId.trim()}` : base;
  }

  public checkBeforeExecution(
    userId: EntityId | number,
    profileId: EntityId | number,
    sql: string,
    sessionId?: string | null,
    now = Date.now()
  ): void {
    const key = this.buildKey(userId, profileId, sessionId);
    const state = this.states.get(key);
    if (!state) return;

    // 冷却窗口已到期：自动清除过期熔断状态并放行
    if (state.blockedUntil > 0 && now >= state.blockedUntil) {
      this.states.delete(key);
      return;
    }

    const fp = AgentLoopBreaker.computeSqlFingerprint(sql);
    if (state.blockedUntil > now && state.lastFingerprint === fp) {
      const retryAfterSec = Math.max(1, Math.ceil((state.blockedUntil - now) / 1000));
      throw new AppError({
        code: 'ERR_AGENT_LOOP_DETECTED',
        statusCode: 429,
        message: `Loop detected: Identical failing query executed repeatedly. Cooling down for ${retryAfterSec}s.`,
        retryAfterSec,
        actionGuidance:
          'Stop retrying the exact same SQL. Call describe_table or list_tables to verify schema first.',
      });
    }
  }

  public recordOutcome(params: {
    userId: EntityId | number;
    profileId: EntityId | number;
    sql: string;
    isSuccess: boolean;
    sessionId?: string | null;
    errorCategoryOrCode?: string;
    threshold?: number;
    windowSec?: number;
    now?: number;
  }): void {
    const key = this.buildKey(params.userId, params.profileId, params.sessionId);

    // 1. 执行成功：立即打断连续失败计数并清除状态
    if (params.isSuccess) {
      this.states.delete(key);
      return;
    }

    // 2. 非计入类错误（如客户端主动取消或网关限流背压）：保持原状态不变，不累加死循环计数
    if (!AgentLoopBreaker.isCountableError(params.errorCategoryOrCode)) {
      return;
    }

    const now = params.now ?? Date.now();
    const threshold = Math.max(1, params.threshold ?? this.defaultThreshold);
    const windowMs = (params.windowSec ?? this.defaultWindowSec) * 1000;
    const fp = AgentLoopBreaker.computeSqlFingerprint(params.sql);
    const prev = this.states.get(key);

    // 3. 闭环 BE-R6-02：真正的滑动时间窗口 (True Sliding Window)
    // 若首次失败或 SQL 指纹变化，初始化时间戳队列；否则仅剔除窗口起点 (now - windowMs) 之前的过期失败，保留窗口内的近期失败！
    if (!prev || prev.lastFingerprint !== fp) {
      this.ensureCapacity(now, windowMs);
      this.states.set(key, {
        lastFingerprint: fp,
        count: 1,
        firstErrorAt: now,
        blockedUntil: threshold <= 1 ? now + windowMs : 0,
        failureTimestamps: [now],
      });
      return;
    }

    const cutoff = now - windowMs;
    // 闭环 BE-R7-02: 修复未声明属性错误 prev.now !== undefined || 
    // 闭环 BE-R7-02: 修复未声明属性错误 prev.now !== undefined ||
    const history = Array.isArray(prev.failureTimestamps)
      ? prev.failureTimestamps.filter((ts) => ts >= cutoff)
      : now - prev.firstErrorAt <= windowMs
        ? Array.from({ length: prev.count }, () => prev.firstErrorAt).filter((ts) => ts >= cutoff)
        : [];

    history.push(now);
    // 严格限制单键时间戳数组长度不超过阈值上限，杜绝无界内存增长
    while (history.length > Math.max(threshold, 32)) {
      history.shift();
    }

    prev.failureTimestamps = history;
    prev.count = history.length;
    prev.firstErrorAt = history[0] ?? now;
    if (prev.count >= threshold) {
      prev.blockedUntil = now + windowMs;
    } else {
      prev.blockedUntil = 0;
    }
  }

  public recordFailure(
    userId: EntityId | number,
    profileId: EntityId | number,
    sql: string,
    options?: {
      sessionId?: string | null;
      errorCategoryOrCode?: string;
      threshold?: number;
      windowSec?: number;
      now?: number;
    }
  ): void {
    this.recordOutcome({
      userId,
      profileId,
      sql,
      isSuccess: false,
      ...options,
    });
  }

  public recordSuccess(
    userId: EntityId | number,
    profileId: EntityId | number,
    sql: string,
    sessionId?: string | null
  ): void {
    this.recordOutcome({
      userId,
      profileId,
      sql,
      isSuccess: true,
      sessionId,
    });
  }

  public async executeWithBreaker<T>(
    params: {
      userId: EntityId | number;
      profileId: EntityId | number;
      sql: string;
      sessionId?: string | null;
      threshold?: number;
      windowSec?: number;
    },
    work: () => Promise<T>
  ): Promise<T> {
    this.checkBeforeExecution(params.userId, params.profileId, params.sql, params.sessionId);
    try {
      const result = await work();
      this.recordSuccess(params.userId, params.profileId, params.sql, params.sessionId);
      return result;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      this.recordFailure(params.userId, params.profileId, params.sql, {
        sessionId: params.sessionId,
        errorCategoryOrCode: code,
        threshold: params.threshold,
        windowSec: params.windowSec,
      });
      throw err;
    }
  }

  private ensureCapacity(now: number, defaultWindowMs: number): void {
    if (this.states.size < this.maxTrackedKeys) return;
    for (const [k, v] of this.states.entries()) {
      const expired =
        (v.blockedUntil > 0 && now >= v.blockedUntil) ||
        (v.blockedUntil === 0 && now - v.firstErrorAt > defaultWindowMs);
      if (expired) {
        this.states.delete(k);
      }
      if (this.states.size < this.maxTrackedKeys) return;
    }
    const oldestKey = this.states.keys().next().value;
    if (oldestKey !== undefined) {
      this.states.delete(oldestKey);
    }
  }
}
```

---

### 6.5 借出连接瞬间二次鉴权六维原子核验 (`validateSnapshotBeforeExecution` — 闭环第 四 节 #1)

当请求历经连接池等待队列终于借出物理连接 `conn`、即将向 MySQL 下发查询的微秒瞬间，必须在纯同步代码块内（与 SQL 下发之间不存在任何 `await` 穿插点！）执行以下六维原子契约核验：

```typescript
// apps/gateway/src/pipeline/05-execution-audit.step.ts
import { AppError, type RequestContextSnapshot, type RegistryHub } from '@mysql-mcp/core-engine';

export function assertSnapshotValidBeforeExecutionSync(
  snapshot: RequestContextSnapshot,
  registryHub: RegistryHub,
  abortSignal: AbortSignal
): void {
  // 维度 0：检查客户端是否在排队等待期间已断开连接或取消请求
  if (abortSignal.aborted) {
    throw new AppError({
      code: 'ERR_QUERY_CANCELED',
      statusCode: 499,
      message: 'Request was canceled or client disconnected while waiting for connection.',
    });
  }

  const now = Date.now();

  // 维度 1：检查快照自身排队存活时间是否已超过 2000ms 硬性 TTL
  if (now - snapshot.snapshotCreatedAt > snapshot.snapshotTtlMs) {
    throw new AppError({
      code: 'ERR_AUTH_SNAPSHOT_TTL_EXPIRED',
      statusCode: 401,
      message: `Authorization snapshot expired after queuing (${snapshot.snapshotTtlMs}ms TTL).`,
      actionGuidance: 'Please retry the request to refresh authorization state.',
    });
  }

  // 维度 2：检查同步失效墓碑 (Fail-Closed Tombstone: 用户被冻结/改密/改角色，或 PAT 被主动吊销)
  if (registryHub.isUserInvalidated(snapshot.userId)) {
    throw new AppError({
      code: 'ERR_AUTH_USER_VERSION_CHANGED',
      statusCode: 401,
      message: 'User account state or privileges were modified while query was queued.',
    });
  }
  if (registryHub.isPatRevoked(snapshot.patId)) {
    throw new AppError({
      code: 'ERR_AUTH_PAT_REVOKED',
      statusCode: 401,
      message: 'PAT was revoked while query was queued.',
    });
  }

  // 维度 3：检查 PAT 是否在排队等待期间自然到期
  if (snapshot.patExpiresAt !== null && now > snapshot.patExpiresAt) {
    throw new AppError({
      code: 'ERR_AUTH_PAT_NATURALLY_EXPIRED',
      statusCode: 401,
      message: 'PAT naturally expired while waiting in connection queue.',
    });
  }

  // 维度 4：检查用户授权版本号 (authVersion) 是否发生变更
  const currentAuthVer = registryHub.getUserAuthVersion(snapshot.userId);
  if (currentAuthVer !== undefined && currentAuthVer !== snapshot.authVersion) {
    throw new AppError({
      code: 'ERR_AUTH_USER_VERSION_CHANGED',
      statusCode: 401,
      message: 'User authorization version changed.',
    });
  }

  // 维度 5：检查全局策略版本号 (globalPolicyVersion: 角色配额或库表 ACL 发生变更)
  if (snapshot.globalPolicyVersion !== registryHub.getGlobalPolicyVersion()) {
    throw new AppError({
      code: 'ERR_AUTH_POLICY_CHANGED',
      statusCode: 409,
      message: 'Global RBAC/ACL policy was updated while query was queued. Please retry.',
    });
  }

  // 维度 6：检查目标 Profile 是否被停用或连接池代际 (generation) 已因配置修改而重建
  if (
    !registryHub.isProfileActive(
      snapshot.effectiveProfile.id,
      snapshot.effectiveProfile.generation
    )
  ) {
    throw new AppError({
      code: 'ERR_PROFILE_INACTIVE',
      statusCode: 503,
      message: 'Target database profile was disabled or reconfigured.',
    });
  }
}
```

---

## 第七章：SQL AST 安全防火墙、Fail-Closed 改写器与 11 项 MCP Tools 实现规范

### 7.1 `ScopeExtractor`: 全属性树递归遍历、前缀优先与同级顺序可见 CTE 作用域栈（闭环 `BE-R01`）

针对评审问题 **`BE-R01`**（原代码在遍历表达式时仅枚举了 `['left', 'right', 'args', 'ast', 'expr']`，遗漏了 `node-sql-parser@5.4.0` 中 `IN (SELECT ...)` / `EXISTS (SELECT ...)` 外层 `expr_list` 的 `.value` 属性以及 `JOIN ... ON (...)` 中 `fromItem.on` 属性，导致条件子查询中的敏感表漏检），本节重构 `ScopeExtractor`：

1. **查询块节点（`node.type === 'select'`）与通用表达式节点解耦**：
   - 当遇到 `select` 节点时，压入该查询块的 CTE 作用域（严格保持同级顺序可见性），处理 `node.from`（显式递归 `fromItem.expr` 派生表与 **`fromItem.on`** 连接条件），随后遍历该 `select` 节点上除 `with` 以外的**所有对象/数组属性**（含 `columns`, `where`, `groupby`, `having`, `orderby`, `_next` 等）；
   - 当遇到任何非 `select` 节点（如 `binary_expr`, `expr_list`, `function`, `aggr_func`, `case`, `unary_expr` 等）时，**无条件遍历 `Object.values(node)` 中所有子对象与子数组**（天然覆盖 `expr_list.value`、`on`、函数参数及任意深度的关联子查询）！
2. **标识符大小写归一化策略（闭环第 四 节 #5）**：
   - 支持传入目标 Profile 的 `lowerCaseTableNames`（默认 `1`：不区分大小写，统一转小写匹配；当设为 `0` 时，保留原始大小写供精确匹配，同时在 ACL 黑名单比对中执行大小写不敏感拦截以防大小写绕过）。

```typescript
// packages/core-ast/src/scope-extractor.ts
export interface ExtractedTableRef {
  database: string;
  table: string;
  fullName: string;
  hasExplicitDb: boolean;
}

export class ScopeExtractor {
  /**
   * 基于 node-sql-parser@5.4.0 AST 全属性树递归提取全部真实物理表引用
   */
  public static extractPhysicalTables(
    astRoot: any,
    defaultDatabase: string,
    lowerCaseTableNames: 0 | 1 | 2 = 1
  ): { tables: ExtractedTableRef[]; isKnownNoTableQuery: boolean } {
    const resultMap = new Map<string, ExtractedTableRef>();
    const scopeStack: Array<Set<string>> = [];
    const normalizeIdent = (ident: string): string =>
      lowerCaseTableNames === 0 ? ident : ident.toLowerCase();

    const normDefaultDb = normalizeIdent(defaultDatabase);

    const visitNode = (node: any): void => {
      if (!node || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        for (const item of node) {
          visitNode(item);
        }
        return;
      }

      // 分支 A：若当前节点是一个 SELECT 查询块 (含顶层查询、CTE 主体、EXISTS/IN/JOIN ON/标量子查询、UNION 分支)
      if (String(node.type ?? '').toLowerCase() === 'select') {
        const hasWithList = Array.isArray(node.with) && node.with.length > 0;
        const currentCteScope = new Set<string>();

        if (hasWithList) {
          scopeStack.push(currentCteScope);
          for (const cteDef of node.with) {
            const rawCteName = String(cteDef?.name?.value ?? cteDef?.name ?? '');
            const cteName = rawCteName ? normalizeIdent(rawCteName) : '';
            if (cteDef?.recursive && cteName) {
              currentCteScope.add(cteName);
            }
            // 先递归解析当前 CTE 的子查询定义（保证同级 CTE 仅向前可见）
            visitNode(cteDef?.stmt?.ast ?? cteDef?.stmt);
            if (cteName) {
              currentCteScope.add(cteName);
            }
          }
        }

        // 处理 FROM / JOIN 子句
        if (Array.isArray(node.from)) {
          for (const fromItem of node.from) {
            if (!fromItem || typeof fromItem !== 'object') continue;

            if (fromItem.expr) {
              // 派生表子查询 FROM (SELECT ...) AS t
              visitNode(fromItem.expr);
            } else if (String(fromItem.type ?? '').toLowerCase() === 'dual' && !fromItem.table) {
              // 闭环 BE-R3-01：在 node-sql-parser@5.4.0 中，唯有裸关键字 FROM DUAL 会生成 { type: 'dual' } 且无 table 属性；
              // 而反引号物理表 SELECT * FROM `dual` 生成的是 { db: null, table: 'dual' }，必须进入下方分支作为物理表提取！
            } else if (fromItem.table) {
              const rawDb = fromItem.db ? normalizeIdent(String(fromItem.db)) : '';
              const rawTable = normalizeIdent(String(fromItem.table));

              // 1. 显式指定了数据库前缀 (如 finance.salary 或 app.`dual`)：一律为真实物理表，不匹配 CTE 别名
              if (rawDb) {
                const fullName = `${rawDb}.${rawTable}`;
                resultMap.set(fullName, {
                  database: rawDb,
                  table: rawTable,
                  fullName,
                  hasExplicitDb: true,
                });
              } else {
                // 2. 无数据库前缀的普通/反引号标识符 (含 FROM `dual`)：若不在 CTE 作用域栈中，一律归入默认库物理表
                const isCteAlias = scopeStack.some((scope) => scope.has(rawTable));
                if (!isCteAlias) {
                  const fullName = `${normDefaultDb}.${rawTable}`;
                  resultMap.set(fullName, {
                    database: normDefaultDb,
                    table: rawTable,
                    fullName,
                    hasExplicitDb: false,
                  });
                }
              }
            }

            // 【核心修复 BE-R01】：显式递归遍历 JOIN ... ON / USING 条件中的任何子查询
            if (fromItem.on) visitNode(fromItem.on);
            if (fromItem.using) visitNode(fromItem.using);
          }
        }

        // 递归遍历该 SELECT 节点除 with/from 以外的所有其他属性 (where, columns, groupby, having, orderby, _next 等)
        for (const [key, val] of Object.entries(node)) {
          if (key === 'with' || key === 'from') continue;
          if (val && typeof val === 'object') {
            visitNode(val);
          }
        }

        if (hasWithList) {
          scopeStack.pop();
        }
        return;
      }

      // 分支 B：【核心修复 BE-R01】非 select 的通用表达式节点 (如 expr_list.value, binary_expr, function, case 等)
      // 全量递归其所有对象/数组属性，确保 EXISTS (SELECT ...)、IN (SELECT ...) 等深层子查询 100% 被访问！
      for (const val of Object.values(node)) {
        if (val && typeof val === 'object') {
          visitNode(val);
        }
      }
    };

    visitNode(astRoot);

    const rootStmt = Array.isArray(astRoot) ? astRoot[0] : astRoot;
    const isSelectWithoutFrom =
      String(rootStmt?.type ?? '').toLowerCase() === 'select' &&
      !rootStmt?._next &&
      (!rootStmt.from ||
        (Array.isArray(rootStmt.from) &&
          rootStmt.from.length === 1 &&
          String(rootStmt.from[0]?.type ?? '').toLowerCase() === 'dual' &&
          !rootStmt.from[0]?.table));

    return {
      tables: Array.from(resultMap.values()),
      isKnownNoTableQuery: resultMap.size === 0 && isSelectWithoutFrom,
    };
  }
}
```

---

### 7.2 `AstValidator`: 系统库表旁路封堵、锁读拦截、高危函数黑名单与复杂度边界

```typescript
// packages/core-ast/src/ast-validator.ts
import { AppError } from '@mysql-mcp/core-engine';
import type { ExtractedTableRef } from './scope-extractor';

const FORBIDDEN_SYSTEM_DATABASES = new Set([
  'information_schema',
  'mysql',
  'performance_schema',
  'sys',
]);

const FORBIDDEN_FUNCTIONS = new Set([
  'sleep',
  'benchmark',
  'get_lock',
  'release_lock',
  'release_all_locks',
  'is_free_lock',
  'is_used_lock',
  'load_file',
  'wait_for_executed_gtid_set',
  'wait_until_sql_thread_after_gtids',
]);

export class AstValidator {
  public static validateReadOnlyAndSafety(
    rawSql: string,
    ast: any,
    extractedTables: ExtractedTableRef[]
  ): void {
    if (Buffer.byteLength(rawSql, 'utf8') > 16384) {
      throw new AppError({
        code: 'ERR_AST_COMPLEXITY',
        statusCode: 400,
        message: 'SQL query length exceeds 16KB maximum threshold.',
      });
    }

    if (Array.isArray(ast)) {
      if (ast.length !== 1) {
        throw new AppError({
          code: 'ERR_AST_FORBIDDEN_SYNTAX',
          statusCode: 403,
          message: 'Multiple SQL statements in a single call are strictly prohibited.',
        });
      }
      ast = ast[0];
    }

    const stmtType = String(ast?.type ?? '').toLowerCase();
    if (stmtType !== 'select') {
      throw new AppError({
        code: 'ERR_AST_FORBIDDEN_SYNTAX',
        statusCode: 403,
        message: `Statement type '${stmtType.toUpperCase()}' is prohibited by Read-Only Policy.`,
        actionGuidance: 'Only read-only SELECT statements are permitted.',
      });
    }

    if (extractedTables.length > 12) {
      throw new AppError({
        code: 'ERR_AST_COMPLEXITY',
        statusCode: 400,
        message: `Query references ${extractedTables.length} physical tables (max allowed: 12).`,
      });
    }

    for (const tbl of extractedTables) {
      if (FORBIDDEN_SYSTEM_DATABASES.has(tbl.database.toLowerCase())) {
        throw new AppError({
          code: 'ERR_AST_TABLE_DENIED',
          statusCode: 403,
          message: `Direct query on system database '${tbl.database}' is prohibited. Use list_tables or describe_table instead.`,
        });
      }
    }

    const inspectAstTree = (node: any, depth: number): void => {
      if (depth > 32) {
        throw new AppError({
          code: 'ERR_AST_COMPLEXITY',
          statusCode: 400,
          message: 'SQL AST nesting depth exceeds safety threshold.',
        });
      }
      if (!node || typeof node !== 'object') return;

      if (node.locking_read || node.lock_mode || node.for_update) {
        throw new AppError({
          code: 'ERR_AST_FORBIDDEN_SYNTAX',
          statusCode: 403,
          message: 'Locking read clauses (FOR UPDATE / LOCK IN SHARE MODE) are strictly prohibited.',
        });
      }

      if (node.into && node.into.expr) {
        throw new AppError({
          code: 'ERR_AST_FORBIDDEN_SYNTAX',
          statusCode: 403,
          message: 'SELECT INTO (OUTFILE / DUMPFILE / Variable) is strictly prohibited.',
        });
      }

      if (node.type === 'function' && node.name) {
        const fnName = String(
          node.name?.name?.[0]?.value ?? node.name?.value ?? node.name
        ).toLowerCase();
        if (FORBIDDEN_FUNCTIONS.has(fnName)) {
          throw new AppError({
            code: 'ERR_AST_FORBIDDEN_SYNTAX',
            statusCode: 403,
            message: `Dangerous function '${fnName.toUpperCase()}()' is prohibited.`,
          });
        }
      }

      for (const val of Object.values(node)) {
        if (val && typeof val === 'object') {
          inspectAstTree(val, depth + 1);
        }
      }
    };

    inspectAstTree(ast, 0);
  }
}
```

---

### 7.3 `LimitRewriter`: 集合运算 (`UNION`) 外层限定识别、Fail-Closed 改写与二次解析验证（闭环 `BE-R05`）

针对评审问题 **`BE-R05`**（在 `node-sql-parser@5.4.0` 中，`(SELECT * FROM orders LIMIT 1) UNION ALL SELECT * FROM orders` 的首分支括号内 `LIMIT 1` 挂在 `root.limit` 上，而第二分支 `root._next` 无 `LIMIT`；反之，`SELECT * FROM orders UNION ALL SELECT * FROM orders LIMIT 1` 的全局 `LIMIT 1` 挂在 `_next` 链条的末节点上），重构后的 `LimitRewriter` 严格检验整个 `_next` 集合链条：

1. **集合查询 (`root._next` 存在) 的严格判定准则**：
   - 收集 `_next` 链条上的全部查询分支 `[b_0, b_1, ..., b_k]`；
   - **情形 A（存在无括号的语句级末尾全局 `LIMIT`）**：最后一个分支 `b_k` 未被括号包裹（`!b_k.parentheses_symbol && !b_k.parentheses`）且 `b_k.limit` 存在并 `<= maxLimit`（在 MySQL 语法中，不带括号的末尾 `LIMIT` 作用域覆盖整条 `UNION` 的总输出）；
   - **情形 B（每个分支均显式带有独立 `LIMIT`，且各分支 `LIMIT` 之和 `<= maxLimit`）**；
   - **凡是不满足情形 A 且不满足情形 B 的任何 `UNION / UNION ALL` 查询（例如仅首分支带括号 `LIMIT 1` 而后续分支无 `LIMIT`，或末尾全局 `LIMIT > maxLimit`），一律触发 `ERR_AST_LIMIT_FAIL_CLOSED` 拒绝执行！**
2. **序列化后二次解析验证**：调用 `sqlify` 生成 SQL 后，再次通过 `astify` 解析验证语法树结构未被破坏。

```typescript
// packages/core-ast/src/limit-rewriter.ts
import { Parser } from 'node-sql-parser';
import { AppError } from '@mysql-mcp/core-engine';

const sqlParser = new Parser();

export class LimitRewriter {
  public static enforceSafeLimit(
    ast: any,
    defaultLimit: number,
    maxLimit: number
  ): string {
    const root = Array.isArray(ast) ? ast[0] : ast;
    if (!root || String(root.type ?? '').toLowerCase() !== 'select') {
      throw new AppError({
        code: 'ERR_AST_LIMIT_FAIL_CLOSED',
        statusCode: 400,
        message: 'Only SELECT AST can be rewritten with LIMIT.',
      });
    }

    // 处理包含 UNION / UNION ALL (_next 链表) 的复合查询 (修复 BE-R05)
    if (root._next) {
      const branches: any[] = [];
      let curr: any = root;
      while (curr) {
        branches.push(curr);
        curr = curr._next;
      }

      const lastBranch = branches[branches.length - 1];
      const lastLimit = LimitRewriter.extractLimitCount(lastBranch.limit);
      const isLastBranchParenthesized = Boolean(
        lastBranch.parentheses_symbol || lastBranch.parentheses
      );

      // 情形 A：末尾分支无括号且带有 <= maxLimit 的全局 LIMIT (如: SELECT ... UNION ALL SELECT ... LIMIT 1)
      const hasValidGlobalTailLimit =
        !isLastBranchParenthesized && lastLimit !== null && lastLimit >= 0 && lastLimit <= maxLimit;

      // 情形 B：每一个分支都显式声明了 LIMIT，且所有分支 LIMIT 总和 <= maxLimit
      const branchLimits = branches.map((b) => LimitRewriter.extractLimitCount(b.limit));
      const allBranchesBounded =
        branchLimits.every((lim): lim is number => lim !== null && lim >= 0 && lim <= maxLimit) &&
        branchLimits.reduce((acc, val) => acc + val, 0) <= maxLimit;

      if (!hasValidGlobalTailLimit && !allBranchesBounded) {
        throw new AppError({
          code: 'ERR_AST_LIMIT_FAIL_CLOSED',
          statusCode: 400,
          message: `Complex UNION query lacks a global LIMIT <= ${maxLimit} (branch-only LIMIT does not bound the entire UNION).`,
          actionGuidance: `Append an unparenthesized global 'LIMIT ${defaultLimit}' at the end of the UNION query.`,
        });
      }

      const sqlOut = sqlParser.sqlify(root, { database: 'MySQL' });
      sqlParser.astify(sqlOut, { database: 'MySQL' });
      return sqlOut;
    }

    // 普通单分支 SELECT 查询：注入 defaultLimit 或收缩超标的 LIMIT
    const currentLimit = LimitRewriter.extractLimitCount(root.limit);
    if (currentLimit === null) {
      root.limit = {
        seperator: '',
        value: [{ type: 'number', value: defaultLimit }],
      };
    } else if (currentLimit > maxLimit) {
      if (root.limit.seperator === 'offset' && root.limit.value.length === 2) {
        root.limit.value[0] = { type: 'number', value: maxLimit };
      } else if (root.limit.seperator === ',' && root.limit.value.length === 2) {
        root.limit.value[1] = { type: 'number', value: maxLimit };
      } else {
        root.limit.value = [{ type: 'number', value: maxLimit }];
      }
    }

    try {
      const rewrittenSql = sqlParser.sqlify(root, { database: 'MySQL' });
      sqlParser.astify(rewrittenSql, { database: 'MySQL' });
      return rewrittenSql;
    } catch {
      throw new AppError({
        code: 'ERR_AST_LIMIT_FAIL_CLOSED',
        statusCode: 400,
        message: 'Failed to safely rewrite SQL AST with LIMIT clause.',
        actionGuidance: `Please simplify your query or explicitly add 'LIMIT ${defaultLimit}'.`,
      });
    }
  }

  private static extractLimitCount(limitNode: any): number | null {
    if (!limitNode || !Array.isArray(limitNode.value) || limitNode.value.length === 0) {
      return null;
    }
    const rawVal =
      limitNode.seperator === ',' && limitNode.value.length === 2
        ? limitNode.value[1]?.value
        : limitNode.value[0]?.value;
    const num = Number(rawVal);
    return Number.isFinite(num) ? num : null;
  }
}
```

---

### 7.4 11 项 MCP Tools 底层逐一实现规范（参数化 SQL 与 ACL 静默过滤）

| 工具名 | 底层执行逻辑与安全过滤实现 |
| :--- | :--- |
| `01. list_profiles` | 从内存 `RegistryHub` 读取当前用户 `activeRoleIds` 关联的所有 `ACTIVE` Profile，返回 `{ name, displayName, environment, defaultDatabase }`。 |
| `02. switch_profile` | 校验目标 `profile_name` 在当前用户授权集合中；更新会话默认 Profile。 |
| `03. get_current_context` | 从当前 `RequestContextSnapshot` 返回 `{ username, activeRoles, activeProfile, activeDatabase, quotas }`。 |
| `04. list_databases` | 执行 `SHOW DATABASES`；剔除 `information_schema / mysql / performance_schema / sys`，逐一调用 `AclEvaluator.isDatabaseAllowed(dbName, snapshot.dbAcl)` 过滤。 |
| `05. use_database` | 校验 `AclEvaluator.isDatabaseAllowed(targetDb, snapshot.dbAcl)`，未授权抛 `403 ERR_AST_DATABASE_DENIED`。 |
| `06. list_tables` | 参数化查询 `information_schema.TABLES WHERE TABLE_SCHEMA = ?`；在内存中对每行调用 `AclEvaluator.isTableAllowed(db + '.' + row.name, snapshot.tableAcl)`，未授权表静默剔除。 |
| `07. describe_table` | 先校验 `AclEvaluator.isTableAllowed`，未授权抛 `403 ERR_AST_TABLE_DENIED`；通过后参数化查询 `COLUMNS` 与 `STATISTICS`。 |
| `08. sample_table_data` | 校验 `Table ACL`；强制 `limit = Math.min(Math.max(1, input.limit ?? 3), 10)`；返回前通过 `Masker.maskResultSet(columns, rows)` 对敏感列与 PII 值执行掩码。 |
| `09. get_column_distinct_values` | 校验 `Table ACL`；若目标列名命中高敏凭据规则直接拒绝；强制 `max_distinct = Math.min(input.max_distinct ?? 50, 200)`；纳入完整流式超时与 KILL 管控。 |
| `10. execute_query` | 走完整 10 步防护链路：AST 只读与高危函数校验 ➔ `ScopeExtractor` 全树物理表提取 ➔ 系统库拦截 ➔ `Database ACL` & `Table ACL` Default Deny ➔ `LimitRewriter` 改写 ➔ 六维同步二次鉴权 ➔ `rowsAsArray` 流式防爆执行。 |
| `11. explain_query` | 对入参 `sql` 执行与 `execute_query` 完全一致的 AST 只读校验 + 全树物理表提取 + 库表 ACL 校验 + `LimitRewriter` 校验；通过后执行 `EXPLAIN <sql>`。 |

---

### 7.5 动态脱敏流水线 (`Masker`): 敏感列名识别与单元格内容实时掩码

```typescript
// packages/security/src/masker.ts
const SENSITIVE_COLUMN_REGEX =
  /(?:pass(?:word|wd)?|secret|token|api_?key|private_?key|id_?card|identity_?no|mobile|phone|tel|bank_?card|credit_?card|cvv)/i;

const EMAIL_COLUMN_REGEX = /(?:email|mail)/i;

export class Masker {
  public static maskSqlText(sql: string): string {
    return sql
      .replace(/(password|secret|token|api_key)\s*=\s*'[^']*'/gi, "$1 = '***REDACTED***'")
      .replace(/\b(1[3-9]\d)\d{4}(\d{4})\b/g, '$1****$2')
      .replace(/\b([1-9]\d{5})(?:19|20)\d{6}(\d{3}[\dXx])\b/g, '$1********$2');
  }

  public static maskResultSet(columns: string[], rows: unknown[][]): unknown[][] {
    const colModes = columns.map((col) => {
      if (SENSITIVE_COLUMN_REGEX.test(col)) return 'STRICT_MASK';
      if (EMAIL_COLUMN_REGEX.test(col)) return 'EMAIL_MASK';
      return 'CONTENT_INSPECT';
    });

    return rows.map((row) =>
      row.map((cell, idx) => {
        if (cell === null || cell === undefined) return cell;
        const mode = colModes[idx];
        const str = String(cell);

        if (mode === 'STRICT_MASK') {
          if (str.length <= 4) return '******';
          return `${str.slice(0, 2)}****${str.slice(-2)}`;
        }
        if (mode === 'EMAIL_MASK') {
          return str.replace(/^([^@]{1,2})[^@]*(@.+)$/, '$1***$2');
        }
        if (/^1[3-9]\d{9}$/.test(str)) {
          return `${str.slice(0, 3)}****${str.slice(7)}`;
        }
        if (/^[1-9]\d{16}[\dXx]$/.test(str)) {
          return `${str.slice(0, 6)}********${str.slice(14)}`;
        }
        return cell;
      })
    );
  }
}
```

---

## 第八章：连接池治理、取消租约锁、原生复位状态机与 SSH/TLS 隧道 (`packages/core-engine`)

### 8.1 `ManagedProfilePool`: 方向隔离 `PinnedDuplexTransport`、TLS 元数据跨层保留与 16MB 原始流熔断（闭环 `BE-R03/R04/R08` 及 `BE-R2-02/R2-04`）

针对第二轮复审发现的两项关键底层传输问题：
1. **`BE-R2-02`（禁止使用同一个 `PassThrough` 双向 `pipe`）**：Node.js 的 `PassThrough` 是单向 `Transform` 流，执行 `tcpSocket.pipe(bridge); bridge.pipe(tcpSocket)` 会把客户端写入的数据回环给驱动自身解析，并把服务端发来的握手包回射给服务端。本节设计专用的双向物理隔离流 **`PinnedDuplexTransport extends Duplex`**：
   - 驱动写入（`_write`）**仅单向转发至远端 `remoteStream.write()`**（建连未完成前暂存至 `pendingWrites` 队列，连接建立后按序冲刷）；
   - 远端发来数据（`remoteStream.on('data')`）经过 16MB 原始网络流守卫检验后，**仅单向调用 `this.push(chunk)` 推给驱动读取端**，收发两个方向彻底物理隔离！
2. **`BE-R2-04`（`mysql2@3.24.6` 在 `startTLS()` 时替换 `this.stream` 导致传输层元数据丢失）**：
   - 在模块加载时，对 `mysql2` 底层 `BaseConnection.prototype.startTLS` 挂载安全透明的**流元数据继承钩子（Stream Metadata Preservation Hook）**：当 `startTLS` 将 `this.stream` 从底层 `PinnedDuplexTransport` 替换为 `tls.TLSSocket` 时，自动将原 `stream` 上的 `__verified_endpoint` 与 `__resetWireByteCounter` 同步迁移至新的 `this.stream` 与连接实例本体上，确保 TLS 升级后同源 KILL 端点与单次查询字节计数器复位入口 100% 存活！

```typescript
// packages/core-engine/src/pool-manager.ts
import net from 'node:net';
import path from 'node:path';
import { Duplex } from 'node:stream';
import mysql2 from 'mysql2';
import { AppError } from './app-error';
import type { CryptoKeyring, SsrfGuard } from '@mysql-mcp/security';
import type { SshTunnelManager, SshProfileConfig } from './ssh-tunnel';

export function toMysqlSslOptions(
  tlsConfig?: Record<string, unknown> | null
): { ca?: string; rejectUnauthorized: boolean; verifyIdentity: boolean } | undefined {
  if (!tlsConfig || !tlsConfig.enabled) {
    return undefined;
  }
  const opts: { ca?: string; rejectUnauthorized: boolean; verifyIdentity: boolean } = {
    rejectUnauthorized: true,
    verifyIdentity: true,
  };
  const ca = (tlsConfig.ca_cert ?? tlsConfig.ca) as string | undefined;
  if (ca) {
    opts.ca = ca;
  }
  return opts;
}

const MAX_WIRE_BYTES_PER_QUERY = 16 * 1024 * 1024; // 第 1 层内存预算：单次查询原始网络流硬上限 16MB

export interface VerifiedTargetEndpoint {
  logicalHost: string;
  pinnedIp: string;
  port: number;
  useSsh: boolean;
  sshConfig?: SshProfileConfig | null;
}

export interface ManagedPoolConnection extends mysql2.PoolConnection {
  __force_destroy?: boolean;
  __locked_for_cancellation?: boolean;
  __verified_endpoint?: VerifiedTargetEndpoint;
  __resetWireByteCounter?: () => void;
}

/**
 * 闭环 BE-R2-04：在 mysql2@3.24.6 的 BaseConnection.prototype.startTLS 执行流替换时，
 * 自动将底层自定义 transport 上的 __verified_endpoint 与 __resetWireByteCounter 继承到新 TLS 流与连接本体上。
 */
function ensureMysql2TlsMetadataPreserved(): void {
  try {
    // 闭环 BE-R3-08：优先直接从当前模块已导入的 mysql2.Connection 原型链获取 BaseConnection.prototype，
    // 完全不依赖 process.cwd() 或 NODE_PATH；仅当单元测试传入不含 Connection 的轻量 stub 时才回退模块路径解析。
    const connCtor = (mysql2 as any)?.Connection;
    let baseProto = connCtor?.prototype
      ? Object.getPrototypeOf(connCtor.prototype)
      : null;

    if (!baseProto || typeof baseProto.startTLS !== 'function') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Mod = require('node:module');
      const pkgPath = Mod._resolveFilename('mysql2/package.json', {
        id: 'noop.js',
        filename: 'noop.js',
        paths: Mod._nodeModulePaths(process.cwd()),
      });
      const BaseConnection = require(path.join(path.dirname(pkgPath), 'lib/base/connection.js'));
      baseProto = BaseConnection?.prototype;
    }

    const origStartTLS = baseProto?.startTLS;
    if (typeof origStartTLS === 'function' && !origStartTLS.__mcp_meta_patched) {
      const patchedStartTLS = function (this: any, onSecure: unknown) {
        const prevStream = this?.stream;
        const endpoint = prevStream?.__verified_endpoint ?? this?.__verified_endpoint;
        const resetCounter =
          prevStream?.__resetWireByteCounter ?? this?.__resetWireByteCounter;

        const result = origStartTLS.call(this, onSecure);

        if (this?.stream && this.stream !== prevStream) {
          if (endpoint !== undefined) {
            this.stream.__verified_endpoint = endpoint;
            this.__verified_endpoint = endpoint;
          }
          if (typeof resetCounter === 'function') {
            this.stream.__resetWireByteCounter = resetCounter;
            this.__resetWireByteCounter = resetCounter;
          }
        }
        return result;
      };
      patchedStartTLS.__mcp_meta_patched = true;
      baseProto.startTLS = patchedStartTLS;
    }
  } catch {
    // 兼容非标准加载环境
  }
}

ensureMysql2TlsMetadataPreserved();

/**
 * 闭环 BE-R2-02：方向严格隔离的双工传输流
 * - 驱动调用 write() -> _write() 仅发往远端 Socket/SSH Channel，绝不回环给驱动自身；
 * - 远端收到数据 -> on('data') 仅通过 this.push() 送入驱动读取缓冲，绝不回射给远端。
 */
export class PinnedDuplexTransport extends Duplex {
  public __verified_endpoint?: VerifiedTargetEndpoint;
  public __resetWireByteCounter: () => void;

  private remote: (net.Socket | Duplex) | null = null;
  private wireBytesCurrentQuery = 0;
  private readonly pendingWrites: Array<{
    chunk: Buffer;
    encoding: BufferEncoding;
    callback: (error?: Error | null) => void;
  }> = [];

  constructor() {
    super();
    this.__resetWireByteCounter = () => {
      this.wireBytesCurrentQuery = 0;
    };
  }

  public attachRemote(
    remoteStream: net.Socket | Duplex,
    endpoint: VerifiedTargetEndpoint
  ): void {
    if (this.destroyed) {
      remoteStream.destroy();
      return;
    }
    this.remote = remoteStream;
    this.__verified_endpoint = endpoint;

    remoteStream.on('data', (chunk: Buffer) => {
      this.wireBytesCurrentQuery += chunk.byteLength;
      if (this.wireBytesCurrentQuery > MAX_WIRE_BYTES_PER_QUERY) {
        const err = new AppError({
          code: 'ERR_WIRE_PACKET_TOO_LARGE',
          statusCode: 400,
          message: `Raw MySQL wire response exceeded 16MB hard limit (${this.wireBytesCurrentQuery} bytes).`,
        });
        remoteStream.destroy(err);
        this.destroy(err);
        return;
      }
      if (!this.push(chunk)) {
        remoteStream.pause?.();
      }
    });

    remoteStream.on('end', () => {
      this.push(null);
    });

    remoteStream.on('error', (err: Error) => {
      this.destroy(err);
    });

    remoteStream.on('close', () => {
      if (!this.destroyed) {
        this.destroy();
      }
    });

    while (this.pendingWrites.length > 0) {
      const item = this.pendingWrites.shift()!;
      remoteStream.write(item.chunk, item.encoding, item.callback);
    }
  }

  public override _read(_size: number): void {
    this.remote?.resume?.();
  }

  public override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    if (!this.remote) {
      this.pendingWrites.push({ chunk: buf, encoding: 'binary', callback });
      return;
    }
    this.remote.write(buf, callback);
  }

  public override _final(callback: (error?: Error | null) => void): void {
    if (this.remote) {
      this.remote.end(() => callback());
    } else {
      callback();
    }
  }

  public override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void
  ): void {
    while (this.pendingWrites.length > 0) {
      const item = this.pendingWrites.shift()!;
      item.callback(error ?? new Error('Transport destroyed before connect'));
    }
    if (this.remote && !this.remote.destroyed) {
      this.remote.destroy(error ?? undefined);
    }
    callback(error);
  }
}

export class ManagedProfilePool {
  private pool: mysql2.Pool;
  private isDraining = false;
  private lastVerifiedIp: string | null = null;
  private readonly initialValidationPromise: Promise<string>;

  constructor(
    public readonly profileId: string | number,
    private readonly cfg: {
      name: string;
      host: string;
      port: number;
      username: string;
      passwordEncrypted: string;
      defaultDatabase: string;
      maxPoolSize: number;
      queueTimeoutMs: number;
      tlsConfig?: Record<string, unknown> | null;
      sshConfig?: SshProfileConfig | null;
    },
    private readonly keyring: CryptoKeyring,
    private readonly ssrfGuard: SsrfGuard,
    private readonly sshManager?: SshTunnelManager
  ) {
    const rawPassword = this.keyring.decrypt(cfg.passwordEncrypted);
    const outboundCheckHost =
      cfg.sshConfig?.use_ssh && cfg.sshConfig?.host ? cfg.sshConfig.host : cfg.host;

    this.initialValidationPromise = Promise.resolve(
      this.ssrfGuard.resolveAndValidateHost(outboundCheckHost)
    ).then((ip) => {
      this.lastVerifiedIp = ip;
      return ip;
    });
    this.initialValidationPromise.catch(() => {});

    this.pool = mysql2.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.username,
      password: rawPassword,
      database: cfg.defaultDatabase,
      connectionLimit: cfg.maxPoolSize,
      waitForConnections: true,
      queueLimit: cfg.maxPoolSize * 5,
      connectTimeout: 5000,
      multipleStatements: false,
      dateStrings: true,
      stream: () => this.createPinnedTransportStream(),
      ...(toMysqlSslOptions(cfg.tlsConfig)
        ? {
            ssl: toMysqlSslOptions(cfg.tlsConfig)!,
          }
        : {}),
    });
  }

  private createPinnedTransportStream(): PinnedDuplexTransport {
    const transport = new PinnedDuplexTransport();

    void (async () => {
      try {
        if (this.cfg.sshConfig?.use_ssh) {
          if (!this.sshManager || typeof this.sshManager.openTunnelStream !== 'function') {
            throw new Error('SSH tunnel requested but SshTunnelManager is not configured.');
          }
          const { stream: sshStream, pinnedTargetHost } =
            await this.sshManager.openTunnelStreamWithMeta(
              String(this.profileId),
              this.cfg.sshConfig,
              this.cfg.host,
              this.cfg.port
            );

          transport.attachRemote(sshStream, {
            logicalHost: this.cfg.host,
            pinnedIp: pinnedTargetHost,
            port: this.cfg.port,
            useSsh: true,
            sshConfig: this.cfg.sshConfig,
          });
          return;
        }

        const pinnedIp = await this.ssrfGuard.resolveAndValidateHost(this.cfg.host);
        this.lastVerifiedIp = pinnedIp;

        const tcpSocket = net.connect({
          host: pinnedIp,
          port: this.cfg.port,
        });
        tcpSocket.setNoDelay(true);

        transport.attachRemote(tcpSocket, {
          logicalHost: this.cfg.host,
          pinnedIp,
          port: this.cfg.port,
          useSsh: false,
        });
      } catch (err) {
        transport.destroy(err as Error);
      }
    })();

    return transport;
  }

  public async acquireConnection(): Promise<ManagedPoolConnection> {
    if (this.isDraining) {
      throw new AppError({
        code: 'ERR_PROFILE_INACTIVE',
        statusCode: 503,
        message: `Profile '${this.cfg.name}' is currently draining or reloading.`,
      });
    }

    await this.initialValidationPromise;

    return new Promise<ManagedPoolConnection>((resolve, reject) => {
      let settled = false;
      const queueTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new AppError({
            code: 'ERR_POOL_QUEUE_TIMEOUT',
            statusCode: 503,
            message: `Waiting for idle connection on profile '${this.cfg.name}' timed out after ${this.cfg.queueTimeoutMs}ms.`,
            actionGuidance: 'Database connection pool is busy. Please retry in a few seconds.',
          })
        );
      }, this.cfg.queueTimeoutMs);

      this.pool.getConnection((err, conn) => {
        clearTimeout(queueTimer);
        if (settled) {
          if (conn) {
            if (this.isDraining) conn.destroy();
            else conn.release();
          }
          return;
        }
        settled = true;
        if (err || !conn) {
          reject(
            err instanceof AppError
              ? err
              : new AppError({
                  code: 'ERR_INTERNAL_SERVER',
                  statusCode: 503,
                  message: `Failed to connect to database profile '${this.cfg.name}': ${err?.message ?? 'Unknown error'}`,
                })
          );
          return;
        }

        const managed = conn as ManagedPoolConnection;
        const currentStream = (managed as any).stream;
        const endpoint =
          currentStream?.__verified_endpoint ?? (managed as any).__verified_endpoint;
        const resetCounter =
          currentStream?.__resetWireByteCounter ?? (managed as any).__resetWireByteCounter;

        if (endpoint) {
          managed.__verified_endpoint = endpoint;
        }
        if (typeof resetCounter === 'function') {
          managed.__resetWireByteCounter = resetCounter;
          managed.__resetWireByteCounter();
        }
        resolve(managed);
      });
    });
  }

  public async drainAndClose(): Promise<void> {
    this.isDraining = true;
    await new Promise<void>((resolve) => {
      this.pool.end(() => resolve());
    });
  }
}

export class PoolManager {
  private readonly pools = new Map<string, ManagedProfilePool>();

  constructor(
    private readonly registryHub: unknown,
    private readonly keyring: CryptoKeyring,
    private readonly ssrfGuard: SsrfGuard,
    private readonly sshManager: SshTunnelManager,
    private readonly metrics?: unknown
  ) {}

  public async warmUpActiveProfiles(
    activeProfileConfigs?: Array<{
      id: string;
      name: string;
      host: string;
      port: number;
      username: string;
      passwordEncrypted: string;
      defaultDatabase: string;
      maxPoolSize: number;
      queueTimeoutMs: number;
      tlsConfig?: Record<string, unknown> | null;
      sshConfig?: SshProfileConfig | null;
    }>
  ): Promise<void> {
    const configs =
      activeProfileConfigs ??
      (this.registryHub as { getActiveProfileConfigs?: () => any[] })?.getActiveProfileConfigs?.() ??
      [];
    for (const cfg of configs) {
      const pool = new ManagedProfilePool(
        cfg.id,
        cfg,
        this.keyring,
        this.ssrfGuard,
        this.sshManager
      );
      this.pools.set(String(cfg.id), pool);
    }
  }

  public async closeAllPools(): Promise<void> {
    const tasks = Array.from(this.pools.values()).map((p) => p.drainAndClose());
    this.pools.clear();
    await Promise.allSettled(tasks);
  }
}
```

---

### 8.2 独立同源 `AdminMaintenanceChannel` 设计（使用方向隔离 `PinnedDuplexTransport` 与原连接锁定端点）

```typescript
// packages/core-engine/src/admin-channel.ts
import net from 'node:net';
import mysql2 from 'mysql2';
import { AppError } from './app-error';
import type { CryptoKeyring, SsrfGuard } from '@mysql-mcp/security';
import type { SshTunnelManager } from './ssh-tunnel';
import { PinnedDuplexTransport, toMysqlSslOptions, type VerifiedTargetEndpoint } from './pool-manager';

export class AdminMaintenanceChannel {
  constructor(
    private readonly keyring: CryptoKeyring,
    private readonly ssrfGuard: SsrfGuard,
    private readonly sshManager?: SshTunnelManager
  ) {}

  public async killQuery(
    profileCfg: {
      profileId: string;
      host: string;
      port: number;
      username: string;
      passwordEncrypted: string;
      tlsConfig?: Record<string, unknown> | null;
      verifiedEndpoint?: VerifiedTargetEndpoint;
    },
    targetThreadId: number
  ): Promise<void> {
    if (!Number.isInteger(targetThreadId) || targetThreadId <= 0) return;

    // 闭环 BE-R3-04：KILL 必须具备完整的原连接已验证端点租约 (含 pinnedIp 与原始 port)，
    // 缺失租约时严禁重新 DNS 解析或使用可变配置盲发 KILL（防止杀错其他实例或新端口上的同号线程）！
    const endpoint = profileCfg.verifiedEndpoint;
    if (
      !endpoint ||
      !endpoint.pinnedIp ||
      !Number.isInteger(endpoint.port) ||
      endpoint.port <= 0
    ) {
      throw new AppError({
        code: 'ERR_INTERNAL_SERVER',
        statusCode: 409,
        message: 'Verified target endpoint lease is required to issue KILL QUERY safely.',
      });
    }

    const rawPassword = this.keyring.decrypt(profileCfg.passwordEncrypted);
    const lockedHost = endpoint.logicalHost || profileCfg.host;
    const lockedPort = endpoint.port;

    await new Promise<void>((resolve, reject) => {
      let adminConn: mysql2.Connection | null = null;
      const hardDeadline = setTimeout(() => {
        if (adminConn) adminConn.destroy();
        reject(new Error(`Admin KILL QUERY ${targetThreadId} timed out after 2000ms`));
      }, 2000);

      adminConn = mysql2.createConnection({
        host: lockedHost,
        port: lockedPort,
        user: profileCfg.username,
        password: rawPassword,
        connectTimeout: 1000,
        stream: () => {
          const transport = new PinnedDuplexTransport();
          void (async () => {
            try {
              if (endpoint.useSsh && endpoint.sshConfig && this.sshManager) {
                const { stream: sshStream, pinnedTargetHost } =
                  await this.sshManager.openTunnelStreamWithMeta(
                    profileCfg.profileId,
                    endpoint.sshConfig,
                    endpoint.pinnedIp,
                    lockedPort
                  );
                transport.attachRemote(sshStream, {
                  logicalHost: lockedHost,
                  pinnedIp: pinnedTargetHost,
                  port: lockedPort,
                  useSsh: true,
                  sshConfig: endpoint.sshConfig,
                });
                return;
              }
              const sock = net.connect({ host: endpoint.pinnedIp, port: lockedPort });
              sock.setNoDelay(true);
              transport.attachRemote(sock, {
                logicalHost: lockedHost,
                pinnedIp: endpoint.pinnedIp,
                port: lockedPort,
                useSsh: false,
              });
            } catch (e) {
              transport.destroy(e as Error);
            }
          })();
          return transport;
        },
        ...(toMysqlSslOptions(profileCfg.tlsConfig)
          ? {
              ssl: toMysqlSslOptions(profileCfg.tlsConfig)!,
            }
          : {}),
      });

      adminConn.connect((connErr) => {
        if (connErr || !adminConn) {
          clearTimeout(hardDeadline);
          if (adminConn) adminConn.destroy();
          reject(connErr ?? new Error('Admin connection failed'));
          return;
        }

        adminConn.query(`KILL QUERY ${Number(targetThreadId)}`, (killErr) => {
          clearTimeout(hardDeadline);
          adminConn?.destroy();
          if (killErr) reject(killErr);
          else resolve();
        });
      });
    });
  }
}
```

---

### 8.3 `QueryLifecycleCoordinator`: CAS 取消租约锁、全链路规范 `EntityId` 与双重 Deadline `Fail-Destroy`

```typescript
// packages/core-engine/src/query-lifecycle.ts
import type { ManagedPoolConnection, VerifiedTargetEndpoint } from './pool-manager';
import type { AdminMaintenanceChannel } from './admin-channel';
import { safeReleaseConnection } from './driver-reset';
import type { EntityId } from './registry-hub';

const normalizeEntityId = (raw: EntityId | number): EntityId => {
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw < 0) throw new Error('Unsafe number EntityId');
    return String(raw);
  }
  return BigInt(String(raw).trim()).toString(10);
};

export interface ActiveQueryEntry {
  queryInstanceId: string;
  userId: EntityId;
  patId: EntityId;
  profileId: EntityId;
  threadId: number;
  conn: ManagedPoolConnection;
  status: 'RUNNING' | 'CANCELING' | 'COMPLETED';
  startedAt: number;
  profileKillConfig: {
    profileId: EntityId;
    host: string;
    port: number;
    username: string;
    passwordEncrypted: string;
    tlsConfig?: Record<string, unknown> | null;
    verifiedEndpoint?: VerifiedTargetEndpoint;
  };
}

export class QueryLifecycleCoordinator {
  private readonly activeQueries = new Map<string, ActiveQueryEntry>();

  constructor(
    private readonly adminChannel: AdminMaintenanceChannel,
    private readonly metrics?: unknown
  ) {}

  public registerRunningQuery(entry: ActiveQueryEntry): void {
    this.activeQueries.set(entry.queryInstanceId, {
      ...entry,
      userId: normalizeEntityId(entry.userId),
      patId: normalizeEntityId(entry.patId),
      profileId: normalizeEntityId(entry.profileId),
    });
  }

  public cancelRunningQuery(queryInstanceId: string, _reason: string): Promise<void> {
    const entry = this.activeQueries.get(queryInstanceId);
    if (!entry || entry.status !== 'RUNNING') return Promise.resolve();

    entry.status = 'CANCELING';
    entry.conn.__locked_for_cancellation = true;
    entry.conn.__force_destroy = true;

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        entry.conn.destroy();
        this.activeQueries.delete(queryInstanceId);
        resolve();
      };

      const safetyTimer = setTimeout(finish, 2000);

      const currentStream = (entry.conn as any).stream;
      const verifiedEndpoint =
        entry.conn.__verified_endpoint ??
        currentStream?.__verified_endpoint ??
        entry.profileKillConfig.verifiedEndpoint;

      void this.adminChannel
        .killQuery(
          {
            ...entry.profileKillConfig,
            verifiedEndpoint,
          },
          entry.threadId
        )
        .catch(() => {})
        .finally(() => {
          clearTimeout(safetyTimer);
          finish();
        });
    });
  }

  public async completeRunningQuery(queryInstanceId: string): Promise<void> {
    const entry = this.activeQueries.get(queryInstanceId);
    if (!entry) return;

    if (entry.status === 'CANCELING' || entry.conn.__locked_for_cancellation) {
      return;
    }

    entry.status = 'COMPLETED';
    this.activeQueries.delete(queryInstanceId);
    await safeReleaseConnection(entry.conn);
  }

  public cancelQueriesByPat(rawPatId: EntityId | number, reason: string): void {
    const patId = normalizeEntityId(rawPatId);
    for (const [id, entry] of this.activeQueries.entries()) {
      if (entry.patId === patId && entry.status === 'RUNNING') {
        void this.cancelRunningQuery(id, reason);
      }
    }
  }

  public cancelQueriesByUser(rawUserId: EntityId | number, reason: string): void {
    const userId = normalizeEntityId(rawUserId);
    for (const [id, entry] of this.activeQueries.entries()) {
      if (entry.userId === userId && entry.status === 'RUNNING') {
        void this.cancelRunningQuery(id, reason);
      }
    }
  }

  public async cancelAllRunningQueries(reason: string): Promise<void> {
    const tasks: Array<Promise<void>> = [];
    for (const [id, entry] of this.activeQueries.entries()) {
      if (entry.status === 'RUNNING') {
        tasks.push(this.cancelRunningQuery(id, reason));
      }
    }
    await Promise.allSettled(tasks);
  }
}
```

---

### 8.4 `StreamingQueryExecutor`: `rowsAsArray: true`、UTF-8 字节安全 64KB 裁剪、5MB 结果集与结果租约式 25MB 内存预算（闭环 `BE-R14` 与 `BE-R2-09`）

针对第二轮复审问题 **`BE-R2-09`**（流 `end` 事件只代表从 MySQL 读取完毕，但 `rows` 数组仍被返回值持有并等待 HTTP/JSON-RPC 序列化发送；若在 `end` 回调里提前将 `UserMemoryBudgetTracker` 归零，慢客户端接收响应期间用户仍可并发堆积超出 25MB 的结果集）：
- **引入结果内存租约（Result Memory Lease）**：
  - 当流正常读取完成（`end`）或达到 5MB 截断返回 `rows` 时，**已统计的 `accumulatedBytes` 继续保留在 `UserMemoryBudgetTracker` 中**，并在返回对象上附带幂等的 `releaseMemoryLease()` 方法；
  - 只有当流发生错误未返回结果集（`error` / 超过 25MB 抛错），或者外层 HTTP 响应真正完成发送（`reply.raw.once('close' / 'finish', () => result.releaseMemoryLease())`）时，才释放该笔内存配额！

```typescript
// packages/core-engine/src/streaming-executor.ts
import type mysql2 from 'mysql2';
import { AppError } from './app-error';
import type { ManagedPoolConnection } from './pool-manager';

const MAX_CELL_BYTES = 64 * 1024;                    // 第 2 层预算：单行单字段严格 <= 65,536 UTF-8 字节
const MAX_RESULT_PAYLOAD_BYTES = 5 * 1024 * 1024;      // 第 3 层预算：单次结果集 <= 5MB
const MAX_USER_CONCURRENT_BYTES = 25 * 1024 * 1024;    // 第 4 层预算：单用户在途流与待发送响应累计 <= 25MB
const CELL_TRUNCATION_SUFFIX = '... [TRUNCATED_CELL_EXCEEDED_64KB]';
const SUFFIX_BYTE_LEN = Buffer.byteLength(CELL_TRUNCATION_SUFFIX, 'utf8');

export function truncateUtf8CellSafe(input: string, maxBytes = MAX_CELL_BYTES): {
  value: string;
  wasTruncated: boolean;
} {
  const totalBytes = Buffer.byteLength(input, 'utf8');
  if (totalBytes <= maxBytes) {
    return { value: input, wasTruncated: false };
  }

  const targetContentBytes = Math.max(0, maxBytes - SUFFIX_BYTE_LEN);
  const rawBuf = Buffer.from(input, 'utf8');
  let endOffset = targetContentBytes;

  while (endOffset > 0 && (rawBuf[endOffset] & 0xc0) === 0x80) {
    endOffset -= 1;
  }

  const cleanPrefix = rawBuf.subarray(0, endOffset).toString('utf8');
  return {
    value: cleanPrefix + CELL_TRUNCATION_SUFFIX,
    wasTruncated: true,
  };
}

export class UserMemoryBudgetTracker {
  public readonly userBytes = new Map<string, number>();

  public addBytesOrThrow(userId: string, deltaBytes: number): void {
    const uid = BigInt(String(userId).trim()).toString(10);
    const current = (this.userBytes.get(uid) ?? 0) + deltaBytes;
    if (current > MAX_USER_CONCURRENT_BYTES) {
      throw new AppError({
        code: 'ERR_MEMORY_BUDGET_EXCEEDED',
        statusCode: 429,
        message: `User concurrent result memory budget (25MB) exceeded.`,
      });
    }
    this.userBytes.set(uid, current);
  }

  public releaseBytes(userId: string, allocatedBytes: number): void {
    const uid = BigInt(String(userId).trim()).toString(10);
    const next = (this.userBytes.get(uid) ?? 0) - allocatedBytes;
    if (next <= 0) this.userBytes.delete(uid);
    else this.userBytes.set(uid, next);
  }
}

export interface StreamQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  payloadBytes: number;
  executionTimeMs: number;
  truncated: boolean;
  releaseMemoryLease: () => void;
}

export function executeStreamingQueryWithBudget(
  conn: ManagedPoolConnection,
  sql: string,
  params: unknown[],
  remainingTimeoutMs: number,
  userMemoryCtx?: { userId: string; tracker: UserMemoryBudgetTracker }
): Promise<StreamQueryResult> {
  return new Promise<StreamQueryResult>((resolve, reject) => {
    const startTime = Date.now();
    let columns: string[] = [];
    const rows: unknown[][] = [];
    let accumulatedBytes = 0;
    let isPayloadTruncated = false;
    let hasCellTruncation = false;
    let memoryReleased = false;

    const releaseMemoryLease = () => {
      if (memoryReleased || !userMemoryCtx) return;
      memoryReleased = true;
      userMemoryCtx.tracker.releaseBytes(userMemoryCtx.userId, accumulatedBytes);
    };

    const queryStream = conn
      .query({
        sql,
        values: params,
        rowsAsArray: true,
        timeout: remainingTimeoutMs,
      })
      .stream();

    queryStream.on('fields', (fields: mysql2.FieldPacket[]) => {
      columns = fields.map((f) => f.name);
    });

    queryStream.on('data', (rawRow: unknown[]) => {
      if (isPayloadTruncated) return;

      const sanitizedRow = rawRow.map((cell) => {
        if (typeof cell === 'string') {
          const res = truncateUtf8CellSafe(cell, MAX_CELL_BYTES);
          if (res.wasTruncated) {
            hasCellTruncation = true;
          }
          return res.value;
        }
        if (Buffer.isBuffer(cell)) {
          if (cell.byteLength > MAX_CELL_BYTES) {
            hasCellTruncation = true;
            return `<Buffer truncated: ${cell.byteLength} bytes>`;
          }
          return cell.toString('utf8');
        }
        return cell;
      });

      const rowBytes = Buffer.byteLength(JSON.stringify(sanitizedRow), 'utf8');

      try {
        userMemoryCtx?.tracker.addBytesOrThrow(userMemoryCtx.userId, rowBytes);
      } catch (budgetErr) {
        conn.__force_destroy = true;
        queryStream.destroy();
        releaseMemoryLease();
        reject(budgetErr);
        return;
      }

      accumulatedBytes += rowBytes;

      if (accumulatedBytes > MAX_RESULT_PAYLOAD_BYTES) {
        isPayloadTruncated = true;
        conn.__force_destroy = true;
        queryStream.destroy();

        resolve({
          columns,
          rows,
          rowCount: rows.length,
          payloadBytes: accumulatedBytes,
          executionTimeMs: Date.now() - startTime,
          truncated: true,
          releaseMemoryLease,
        });
      } else {
        rows.push(sanitizedRow);
      }
    });

    queryStream.on('end', () => {
      if (!isPayloadTruncated) {
        resolve({
          columns,
          rows,
          rowCount: rows.length,
          payloadBytes: accumulatedBytes,
          executionTimeMs: Date.now() - startTime,
          truncated: hasCellTruncation,
          releaseMemoryLease,
        });
      }
    });

    queryStream.on('error', (err: Error) => {
      if (isPayloadTruncated) return;
      conn.__force_destroy = true;
      releaseMemoryLease();
      reject(err);
    });
  });
}
```

---

### 8.5 `safeReleaseConnection`: `conn.reset(cb)` 1500ms 硬超时与 `Fail-Destroy`

```typescript
// packages/core-engine/src/driver-reset.ts
import type { ManagedPoolConnection } from './pool-manager';

export async function safeReleaseConnection(conn: ManagedPoolConnection): Promise<void> {
  if (conn.__force_destroy || conn.__locked_for_cancellation) {
    conn.destroy();
    return;
  }

  let resetTimer: NodeJS.Timeout | null = null;
  let isResetOk = false;

  try {
    await new Promise<void>((resolve, reject) => {
      resetTimer = setTimeout(() => {
        reject(new Error('COM_RESET_CONNECTION timed out after 1500ms'));
      }, 1500);

      conn.reset((err) => {
        if (resetTimer) clearTimeout(resetTimer);
        if (err) reject(err);
        else resolve();
      });
    });
    isResetOk = true;
  } catch {
    isResetOk = false;
  } finally {
    if (resetTimer) clearTimeout(resetTimer);
    if (isResetOk && !conn.__locked_for_cancellation) {
      const currentStream = (conn as any).stream;
      const resetFn = conn.__resetWireByteCounter ?? currentStream?.__resetWireByteCounter;
      resetFn?.();
      conn.release();
    } else {
      conn.destroy();
    }
  }
}
```

---

### 8.6 `SshTunnelManager`: 跳板机与转发目标双重 SSRF 校验 + 强制 `hostVerifier` Fail-Closed（闭环 `BE-R2-06` & `BE-R2-07`）

针对第二轮复审指出的两项 SSH 安全问题：
1. **`BE-R2-06`（转发目标 `targetDbHost` 未经安全校验与固定）**：允许连接堡垒机绝不等于允许通过堡垒机 `forwardOut` 访问 `169.254.169.254` 或未授权内网。在 `openTunnelStream` 中，**必须对 `targetDbHost` 同样执行 `ssrfGuard.resolveAndValidateHost(targetDbHost)`**，并将校验固定后的 `pinnedTargetHost` 传给 `client.forwardOut`；
2. **`BE-R2-07`（缺失 `host_fingerprint_sha256` 时未配置 `hostVerifier` 导致 `ssh2` 默认 Fail-Open）**：在 `ssh.connect({...})` 中**无条件挂载 `hostHash: 'sha256'` 与 `hostVerifier` 回调函数**——当 `host_fingerprint_sha256` 缺失、为空或与服务端公钥不匹配时，`hostVerifier` 恒返回 `false` 拒绝握手（Fail-Closed）！

```typescript
// packages/core-engine/src/ssh-tunnel.ts
import crypto from 'node:crypto';
import { Client as SshClient, type ClientChannel } from 'ssh2';
import type { CryptoKeyring, SsrfGuard } from '@mysql-mcp/security';
import { AppError } from './app-error';

/**
 * 将 ssh2 (hostHash: 'sha256') 回调传入的 64 位十六进制摘要或契约定义的 OpenSSH 指纹
 * (`SHA256:<43位无填充Base64>`) 统一解析为 32 字节原始 SHA-256 摘要。
 * 任何缺失、非标准 hex、非法 Base64、错误前缀或非 32 字节长度一律返回 null (Fail-Closed)。
 */
export function parseSha256FingerprintBytes(raw?: string): Buffer | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('SHA256:')) {
    const b64Part = trimmed.slice('SHA256:'.length);
    const match = /^([A-Za-z0-9+/]{43})=?$/.exec(b64Part);
    if (!match) return null;
    const buf = Buffer.from(match[1], 'base64');
    if (buf.length !== 32 || buf.toString('base64').replace(/=+$/, '') !== match[1]) {
      return null;
    }
    return buf;
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  return null;
}

export function verifySshHostFingerprint(
  driverDigest: string,
  expectedFingerprint?: string
): boolean {
  const actualBytes = parseSha256FingerprintBytes(driverDigest);
  const expectedBytes = parseSha256FingerprintBytes(expectedFingerprint);
  if (!actualBytes || !expectedBytes) {
    return false;
  }
  return crypto.timingSafeEqual(actualBytes, expectedBytes);
}

export interface SshProfileConfig {
  use_ssh: boolean;
  host?: string;
  port?: number;
  username?: string;
  private_key_encrypted?: string;
  host_fingerprint_sha256?: string;
}

export interface EphemeralSshConfig {
  host: string;
  port?: number;
  username: string;
  privateKey?: string;
  privateKeyEncrypted?: string;
  hostFingerprintSha256?: string;
}

export class SshTunnelManager {
  private readonly activeClients = new Map<string, Promise<SshClient>>();

  constructor(
    private readonly keyring: CryptoKeyring,
    private readonly ssrfGuard: SsrfGuard
  ) {}

  public async openTunnelStream(
    profileId: string,
    sshConfig: SshProfileConfig,
    targetDbHost: string,
    targetDbPort: number
  ): Promise<ClientChannel> {
    const { stream } = await this.openTunnelStreamWithMeta(
      profileId,
      sshConfig,
      targetDbHost,
      targetDbPort
    );
    return stream;
  }

  public async openTunnelStreamWithMeta(
    profileId: string,
    sshConfig: SshProfileConfig,
    targetDbHost: string,
    targetDbPort: number
  ): Promise<{ stream: ClientChannel; pinnedTargetHost: string }> {
    // 闭环 BE-R2-06：不仅校验跳板机，同时强制对 forwardOut 最终目标地址执行 SSRF 校验与 IP 固定！
    const pinnedTargetHost = await this.ssrfGuard.resolveAndValidateHost(targetDbHost);
    const client = await this.getOrCreateClient(profileId, sshConfig);

    return new Promise<{ stream: ClientChannel; pinnedTargetHost: string }>((resolve, reject) => {
      client.forwardOut('127.0.0.1', 0, pinnedTargetHost, targetDbPort, (err, stream) => {
        if (err || !stream) {
          reject(
            new AppError({
              code: 'ERR_INTERNAL_SERVER',
              statusCode: 503,
              message: `SSH forwardOut to ${pinnedTargetHost}:${targetDbPort} failed: ${err?.message ?? 'Unknown'}`,
            })
          );
          return;
        }
        resolve({ stream, pinnedTargetHost });
      });
    });
  }

  private buildClientCacheKey(profileId: string, sshConfig: SshProfileConfig): string {
    return JSON.stringify([
      String(profileId),
      sshConfig.host ?? '',
      sshConfig.port ?? 22,
      sshConfig.username ?? '',
      sshConfig.private_key_encrypted ?? '',
      sshConfig.host_fingerprint_sha256 ?? '',
    ]);
  }

  private getOrCreateClient(profileId: string, sshConfig: SshProfileConfig): Promise<SshClient> {
    // 闭环 BE-R3-03：缓存键绑定完整不可变 SSH 信任与身份配置元组；
    // 当堡垒机地址、端口、用户、私钥或公钥指纹发生热更新时，自动建立并校验全新 SSH 客户端！
    const cacheKey = this.buildClientCacheKey(profileId, sshConfig);
    const existing = this.activeClients.get(cacheKey);
    if (existing) return existing;

    const promise = (async () => {
      if (!sshConfig.host || !sshConfig.username || !sshConfig.private_key_encrypted) {
        throw new AppError({
          code: 'ERR_VALIDATION_FAILED',
          statusCode: 400,
          message: 'Incomplete SSH configuration.',
        });
      }

      const pinnedSshIp = await this.ssrfGuard.resolveAndValidateHost(sshConfig.host);
      const privateKey = this.keyring.decrypt(sshConfig.private_key_encrypted);
      const expectedFingerprint = sshConfig.host_fingerprint_sha256?.trim();

      return new Promise<SshClient>((resolve, reject) => {
        const ssh = new SshClient();
        const evictIfSame = () => {
          if (this.activeClients.get(cacheKey) === trackedPromise) {
            this.activeClients.delete(cacheKey);
          }
        };
        const timer = setTimeout(() => {
          ssh.end();
          evictIfSame();
          reject(new Error('SSH bastion handshake timed out after 5000ms'));
        }, 5000);

        ssh
          .on('ready', () => {
            clearTimeout(timer);
            resolve(ssh);
          })
          .on('error', (err) => {
            clearTimeout(timer);
            evictIfSame();
            reject(err);
          })
          .on('close', () => {
            evictIfSame();
          })
          .connect({
            host: pinnedSshIp,
            port: sshConfig.port ?? 22,
            username: sshConfig.username,
            privateKey,
            readyTimeout: 5000,
            hostHash: 'sha256',
            hostVerifier: (hashedKey: string): boolean =>
              verifySshHostFingerprint(hashedKey, expectedFingerprint),
          });
      });
    })();

    // 闭环 BE-R4-03：对最外层建连 Promise 的全部拒绝路径（含 DNS/SSRF EAI_AGAIN 暂时故障、解密异常等）
    // 执行条件淘汰，防止建连前暂时失败被永久驻留缓存导致无法自愈！
    const trackedPromise = promise.catch((err) => {
      if (this.activeClients.get(cacheKey) === trackedPromise) {
        this.activeClients.delete(cacheKey);
      }
      throw err;
    });

    this.activeClients.set(cacheKey, trackedPromise);
    return trackedPromise;
  }

  public async openEphemeralTunnelStream(
    sshConfig: EphemeralSshConfig,
    targetDbHost: string,
    targetDbPort: number
  ): Promise<{ stream: ClientChannel; pinnedTargetHost: string; pinnedSshIp: string; close: () => void }> {
    if (!sshConfig.host || !sshConfig.username || (!sshConfig.privateKey && !sshConfig.privateKeyEncrypted)) {
      throw new AppError({
        code: 'ERR_VALIDATION_FAILED',
        statusCode: 400,
        message: 'Incomplete SSH bastion configuration.',
      });
    }
    const expectedFingerprint = sshConfig.hostFingerprintSha256?.trim();
    if (!expectedFingerprint) {
      throw new AppError({
        code: 'ERR_VALIDATION_FAILED',
        statusCode: 400,
        message: 'SSH host_fingerprint_sha256 is required for Fail-Closed verification.',
      });
    }

    const pinnedTargetHost = await this.ssrfGuard.resolveAndValidateHost(targetDbHost);
    const pinnedSshIp = await this.ssrfGuard.resolveAndValidateHost(sshConfig.host);
    const privateKey = sshConfig.privateKey ?? this.keyring.decrypt(sshConfig.privateKeyEncrypted!);

    const client = await new Promise<SshClient>((resolve, reject) => {
      const ssh = new SshClient();
      const timer = setTimeout(() => {
        ssh.end();
        reject(new Error('SSH bastion handshake timed out after 5000ms'));
      }, 5000);

      ssh
        .on('ready', () => {
          clearTimeout(timer);
          resolve(ssh);
        })
        .on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        })
        .connect({
          host: pinnedSshIp,
          port: sshConfig.port ?? 22,
          username: sshConfig.username,
          privateKey,
          readyTimeout: 5000,
          hostHash: 'sha256',
          hostVerifier: (hashedKey: string): boolean =>
            verifySshHostFingerprint(hashedKey, expectedFingerprint),
        });
    });

    const stream = await new Promise<ClientChannel>((resolve, reject) => {
      client.forwardOut('127.0.0.1', 0, pinnedTargetHost, targetDbPort, (err, ch) => {
        if (err || !ch) {
          client.end();
          reject(
            new AppError({
              code: 'ERR_INTERNAL_SERVER',
              statusCode: 503,
              message: `SSH forwardOut to ${pinnedTargetHost}:${targetDbPort} failed: ${err?.message ?? 'Unknown'}`,
            })
          );
          return;
        }
        resolve(ch);
      });
    });

    return {
      stream,
      pinnedTargetHost,
      pinnedSshIp,
      close: () => client.end(),
    };
  }

  public async closeAllTunnels(): Promise<void> {
    const entries = Array.from(this.activeClients.values());
    this.activeClients.clear();
    for (const p of entries) {
      try {
        const client = await p;
        client.end();
      } catch {}
    }
  }
}
```

---

## 第九章：全场景 SSRF 深度防御、AES-256-GCM 密钥环与通知推送系统 (`packages/security`)

### 9.1 `SsrfGuard`: Post-DNS Resolution Check、全量 CIDR 黑名单与 IP Pinning

```typescript
// packages/security/src/ssrf-guard.ts
import dns from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import { AppError } from '@mysql-mcp/core-engine';

const PROHIBITED_CIDRS = [
  '0.0.0.0/8',
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '100.64.0.0/10',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
];

export class SsrfGuard {
  private readonly parsedProhibited = PROHIBITED_CIDRS.map((c) => ipaddr.parseCIDR(c));
  private readonly parsedAllowedOutbound: Array<[ipaddr.IPv4 | ipaddr.IPv6, number]>;

  constructor(allowedOutboundCidrsCsv: string) {
    this.parsedAllowedOutbound = allowedOutboundCidrsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((cidr) => (cidr.includes('/') ? ipaddr.parseCIDR(cidr) : ipaddr.parseCIDR(`${cidr}/32`)));
  }

  public isIpAllowed(rawIp: string): boolean {
    let addr = ipaddr.parse(rawIp);
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
      addr = (addr as ipaddr.IPv6).toIPv4Address();
    }

    const inWhitelist = this.parsedAllowedOutbound.some(([netAddr, prefix]) => {
      if (addr.kind() !== netAddr.kind()) return false;
      return addr.match([netAddr, prefix]);
    });
    if (inWhitelist) return true;

    const inBlacklist = this.parsedProhibited.some(([netAddr, prefix]) => {
      if (addr.kind() !== netAddr.kind()) return false;
      return addr.match([netAddr, prefix]);
    });

    return !inBlacklist;
  }

  public async resolveAndValidateHost(hostname: string): Promise<string> {
    const cleanHost = hostname.trim();
    if (net.isIP(cleanHost)) {
      if (!this.isIpAllowed(cleanHost)) {
        throw this.buildSsrfError(cleanHost, cleanHost);
      }
      return cleanHost;
    }

    const records = await dns.promises.lookup(cleanHost, { all: true, verbatim: true });
    if (records.length === 0) {
      throw new AppError({
        code: 'ERR_VALIDATION_FAILED',
        statusCode: 400,
        message: `Unable to resolve hostname '${cleanHost}'.`,
      });
    }

    for (const rec of records) {
      if (!this.isIpAllowed(rec.address)) {
        throw this.buildSsrfError(cleanHost, rec.address);
      }
    }

    return records[0].address;
  }

  private buildSsrfError(host: string, hitIp: string): AppError {
    return new AppError({
      code: 'ERR_SSRF_PROHIBITED',
      statusCode: 403,
      message: `目标地址 ${host} (解析 IP: ${hitIp}) 命中内网/保留地址 SSRF 拦截规则。`,
      actionGuidance:
        '若该地址属于受管内网数据库，请联系系统运维将该网段加入环境变量 ALLOWED_OUTBOUND_IPS 白名单。',
    });
  }
}
```

---

### 9.2 数据源连通性测试 (`test-db` / `test-ssh`) 三模式解析、TLS 同契约校验与防凭据外泄机制（闭环 `BE-R04`）

连通性测试与生产连接池共享完全相同的 **“`host: targetHost` + 自定义 `stream`（直连 `pinnedIp` 或经由 `SshTunnelManager.openEphemeralTunnelStream` 转发通道）+ 公共 `toMysqlSslOptions()` (`verifyIdentity: true`)”** 契约，并强制执行修改数据库端点 (`host/port/user`)、TLS 信任链 (`enabled/ca_cert`) 或 SSH 跳板机信任元组 (`use_ssh/ssh_host/ssh_port/ssh_user/ssh_host_fingerprint_sha256`) 时必须重新录入凭据 (`ERR_CREDENTIAL_REENTRY_REQUIRED`) 的防外泄规则：

```typescript
// apps/admin-api/src/services/profile-connectivity.service.ts
import net from 'node:net';
import mysql2 from 'mysql2';
import { AppError, toMysqlSslOptions, type SshTunnelManager } from '@mysql-mcp/core-engine';
import type { CryptoKeyring, SsrfGuard } from '@mysql-mcp/security';
import type { ProfileRepository } from '../repositories/profile.repository';

export interface TestDbPayload {
  profile_id?: string | number;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  tls_config?: Record<string, unknown> | null;
  use_ssh?: boolean;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_private_key?: string;
  ssh_host_fingerprint_sha256?: string;
}

export class ProfileConnectivityService {
  constructor(
    private readonly profileRepo: ProfileRepository,
    private readonly keyring: CryptoKeyring,
    private readonly ssrfGuard: SsrfGuard,
    private readonly sshManager?: SshTunnelManager
  ) {}

  public async testMysqlConnectivity(
    payload: TestDbPayload
  ): Promise<{ reachable: boolean; latencyMs: number }> {
    let targetHost: string;
    let targetPort: number;
    let targetUser: string;
    let targetPassword: string;
    let targetDatabase: string | undefined;
    let targetTlsConfig: Record<string, unknown> | null | undefined;
    let targetUseSsh: boolean;
    let targetSshHost: string | undefined;
    let targetSshPort: number;
    let targetSshUser: string | undefined;
    let targetSshPrivateKey: string | undefined;
    let targetSshPrivateKeyEncrypted: string | undefined;
    let targetSshFingerprint: string | undefined;

    if (payload.profile_id !== undefined) {
      const saved = await this.profileRepo.findByIdOrThrow(String(payload.profile_id));
      targetHost = payload.host?.trim() || saved.host;
      targetPort = payload.port ?? saved.port;
      targetUser = payload.user?.trim() || saved.username;
      targetDatabase = payload.database?.trim() || saved.default_database;
      targetTlsConfig = payload.tls_config !== undefined ? payload.tls_config : saved.tls_config;

      const savedSsh = (saved.ssh_config as Record<string, unknown> | undefined) || {};
      const savedSshEnabled = Boolean(savedSsh.use_ssh);
      targetUseSsh = payload.use_ssh !== undefined ? payload.use_ssh : savedSshEnabled;
      targetSshHost = payload.ssh_host?.trim() || (savedSsh.host as string | undefined);
      targetSshPort = payload.ssh_port ?? (savedSsh.port as number | undefined) ?? 22;
      targetSshUser = payload.ssh_user?.trim() || (savedSsh.username as string | undefined);
      targetSshFingerprint =
        payload.ssh_host_fingerprint_sha256?.trim() ||
        (savedSsh.host_fingerprint_sha256 as string | undefined);

      // 防凭据窃取铁律：未传新密码复用库内旧密文时，严禁修改 host、port、user、TLS 或 SSH 信任边界
      const hostChanged = targetHost !== saved.host;
      const portChanged = targetPort !== saved.port;
      const userChanged = targetUser !== saved.username;
      const savedTlsEnabled = Boolean(saved.tls_config && saved.tls_config.enabled);
      const savedTlsCa = (saved.tls_config?.ca_cert ?? saved.tls_config?.ca ?? null) as string | null;
      const targetTlsEnabled = Boolean(targetTlsConfig && targetTlsConfig.enabled);
      const targetTlsCa = (targetTlsConfig?.ca_cert ?? targetTlsConfig?.ca ?? null) as string | null;
      const tlsChanged =
        payload.tls_config !== undefined &&
        (savedTlsEnabled !== targetTlsEnabled || savedTlsCa !== targetTlsCa);

      const sshToggleChanged = payload.use_ssh !== undefined && payload.use_ssh !== savedSshEnabled;
      const sshHostChanged =
        payload.ssh_host !== undefined && payload.ssh_host.trim() !== ((savedSsh.host as string) || "");
      const sshPortChanged =
        payload.ssh_port !== undefined && payload.ssh_port !== ((savedSsh.port as number) ?? 22);
      const sshUserChanged =
        payload.ssh_user !== undefined && payload.ssh_user.trim() !== ((savedSsh.username as string) || "");
      const sshFingerprintChanged =
        payload.ssh_host_fingerprint_sha256 !== undefined &&
        payload.ssh_host_fingerprint_sha256.trim() !== ((savedSsh.host_fingerprint_sha256 as string) || "");
      const sshChanged =
        sshToggleChanged || sshHostChanged || sshPortChanged || sshUserChanged || sshFingerprintChanged;

      if (payload.password && payload.password.length > 0) {
        targetPassword = payload.password;
      } else {
        if (hostChanged || portChanged || userChanged || tlsChanged || sshChanged) {
          throw new AppError({
            code: 'ERR_CREDENTIAL_REENTRY_REQUIRED',
            statusCode: 400,
            message: '修改主机地址、端口、用户名、TLS 信任链或 SSH 堡垒机配置后进行连通性测试时，必须重新输入数据库密码。',
            actionGuidance:
              'Please re-enter the database password when modifying database host, port, credentials, TLS, or SSH tunnel configurations.',
          });
        }
        targetPassword = this.keyring.decrypt(saved.password_encrypted);
      }

      if (targetUseSsh) {
        if (payload.ssh_private_key && payload.ssh_private_key.length > 0) {
          targetSshPrivateKey = payload.ssh_private_key;
        } else if (!sshChanged && savedSsh.private_key_encrypted) {
          targetSshPrivateKeyEncrypted = savedSsh.private_key_encrypted as string;
        } else {
          throw new AppError({
            code: 'ERR_CREDENTIAL_REENTRY_REQUIRED',
            statusCode: 400,
            message: '修改 SSH 堡垒机配置后进行连通性测试时，必须重新输入 SSH 私钥。',
            actionGuidance: 'Please re-enter the SSH private key when testing modified SSH bastion settings.',
          });
        }
      }
    } else {
      if (!payload.host || !payload.port || !payload.user || !payload.password) {
        throw new AppError({
          code: 'ERR_VALIDATION_FAILED',
          statusCode: 400,
          message: '新建数据源测试必须提供完整的 host、port、user 与 password。',
        });
      }
      targetHost = payload.host.trim();
      targetPort = payload.port;
      targetUser = payload.user.trim();
      targetPassword = payload.password;
      targetDatabase = payload.database?.trim();
      targetTlsConfig = payload.tls_config;
      targetUseSsh = Boolean(payload.use_ssh);
      targetSshHost = payload.ssh_host?.trim();
      targetSshPort = payload.ssh_port ?? 22;
      targetSshUser = payload.ssh_user?.trim();
      targetSshPrivateKey = payload.ssh_private_key;
      targetSshFingerprint = payload.ssh_host_fingerprint_sha256?.trim();
    }

    const startTime = Date.now();
    const sslOpts = toMysqlSslOptions(targetTlsConfig);
    let tunnelHandle: { stream: unknown; close: () => void } | null = null;
    let directPinnedIp: string | null = null;

    if (targetUseSsh) {
      if (!this.sshManager || typeof this.sshManager.openEphemeralTunnelStream !== 'function') {
        throw new AppError({
          code: 'ERR_INTERNAL_SERVER',
          statusCode: 500,
          message: 'SSH tunnel requested for connectivity test, but SshTunnelManager is not configured.',
        });
      }
      if (!targetSshHost || !targetSshUser || !targetSshFingerprint) {
        throw new AppError({
          code: 'ERR_VALIDATION_FAILED',
          statusCode: 400,
          message: '启用 SSH 测试必须提供完整的 ssh_host、ssh_user 与 ssh_host_fingerprint_sha256。',
        });
      }
      tunnelHandle = await this.sshManager.openEphemeralTunnelStream(
        {
          host: targetSshHost,
          port: targetSshPort,
          username: targetSshUser,
          privateKey: targetSshPrivateKey,
          privateKeyEncrypted: targetSshPrivateKeyEncrypted,
          hostFingerprintSha256: targetSshFingerprint,
        },
        targetHost,
        targetPort
      );
    } else {
      directPinnedIp = await this.ssrfGuard.resolveAndValidateHost(targetHost);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const conn = mysql2.createConnection({
          host: targetHost,
          port: targetPort,
          user: targetUser,
          password: targetPassword,
          database: targetDatabase,
          connectTimeout: 3000,
          stream: () => {
            if (tunnelHandle) {
              return tunnelHandle.stream as unknown as net.Socket;
            }
            return net.connect({ host: directPinnedIp!, port: targetPort });
          },
          ...(sslOpts ? { ssl: sslOpts } : {}),
        });

        const timer = setTimeout(() => {
          conn.destroy();
          reject(new Error('MySQL connectivity test timed out after 3000ms'));
        }, 3000);

        conn.connect((err) => {
          if (err) {
            clearTimeout(timer);
            conn.destroy();
            reject(err);
            return;
          }
          conn.ping((pingErr) => {
            clearTimeout(timer);
            conn.destroy();
            if (pingErr) reject(pingErr);
            else resolve();
          });
        });
      });
    } finally {
      tunnelHandle?.close();
    }

    return {
      reachable: true,
      latencyMs: Date.now() - startTime,
    };
  }
}
```

---

### 9.3 `CryptoKeyring`: 带 `key_id` 的 AES-256-GCM 加解密与在线重加密轮转器（闭环第 四 节 #7）

除提供 `encrypt / decrypt` 外，增补在线密钥轮转任务 `rotateStaleCiphertexts`：扫描 `sys_profiles` 与 `sys_system_settings` 中前缀不是 `v1:<active_key_id>:` 的旧密文，在事务中解密并用当前活跃密钥重加密，直至旧 `key_id` 引用计数归零后方可从环境变量退役旧密钥：

```typescript
// packages/security/src/crypto-keyring.ts
import crypto from 'node:crypto';
import type mysql2 from 'mysql2/promise';

export interface MasterKeysEnvSchema {
  active_key_id: string;
  keys: Record<string, string>;
}

export class CryptoKeyring {
  public readonly activeKeyId: string;
  private readonly keyMap = new Map<string, Buffer>();

  constructor(schema: MasterKeysEnvSchema) {
    this.activeKeyId = schema.active_key_id;
    for (const [kId, hexKey] of Object.entries(schema.keys)) {
      const buf = Buffer.from(hexKey, 'hex');
      if (buf.byteLength !== 32) {
        throw new Error(`Master key '${kId}' must be exactly 32 bytes (64 hex characters).`);
      }
      this.keyMap.set(kId, buf);
    }
    if (!this.keyMap.has(this.activeKeyId)) {
      throw new Error(`Active key '${this.activeKeyId}' not found in keyring.`);
    }
  }

  public static fromEnvJson(rawJson: string): CryptoKeyring {
    const parsed = JSON.parse(rawJson) as MasterKeysEnvSchema;
    return new CryptoKeyring(parsed);
  }

  public encrypt(plaintext: string): string {
    const key = this.keyMap.get(this.activeKeyId)!;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      'v1',
      this.activeKeyId,
      iv.toString('hex'),
      encrypted.toString('hex'),
      authTag.toString('hex'),
    ].join(':');
  }

  public decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 5 || parts[0] !== 'v1') {
      throw new Error('Invalid encrypted payload format (expected v1:key_id:iv:cipher:tag).');
    }
    const [, keyId, ivHex, cipherHex, tagHex] = parts;
    const key = this.keyMap.get(keyId);
    if (!key) {
      throw new Error(`Decryption key '${keyId}' is missing from keyring.`);
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  public needsReencryption(payload: string): boolean {
    return !payload.startsWith(`v1:${this.activeKeyId}:`);
  }

  /**
   * 在线平滑轮转：将数据库中旧 key_id 的密文批量迁移至当前 active_key_id
   */
  public async rotateDatabaseCiphertexts(pool: mysql2.Pool): Promise<{ rotatedProfiles: number }> {
    const [rows] = await pool.query<mysql2.RowDataPacket[]>(
      `SELECT id, password_encrypted, version FROM sys_profiles`
    );
    let rotatedProfiles = 0;
    for (const row of rows) {
      const cipher = String(row.password_encrypted);
      if (this.needsReencryption(cipher)) {
        const plain = this.decrypt(cipher);
        const freshCipher = this.encrypt(plain);
        await pool.query(
          `UPDATE sys_profiles SET password_encrypted = ?, version = version + 1 WHERE id = ? AND version = ?`,
          [freshCipher, row.id, row.version]
        );
        rotatedProfiles += 1;
      }
    }
    return { rotatedProfiles };
  }
}
```

---

### 9.4 `NotificationService`: 企微/钉钉/飞书 Webhook 异步推送器（闭环第 四 节 #1）

完整实现目录 §9.4 声明的通知推送与连通性测试服务：
1. **强制 HTTPS 协议校验与 SSRF IP Pinning**：仅允许 `https:` 协议，先调用 `ssrfGuard.resolveAndValidateHost(url.hostname)` 得到 `pinnedIp`；
2. **自定义 `lookup` 锁定 IP + 保留 TLS SNI**：通过 `https.request` 传入自定义 `lookup: (_host, _opts, cb) => cb(null, pinnedIp, ...)`，既锁死 TCP 目标 IP 为 `pinnedIp`，又保留原始域名用于 HTTPS TLS SNI 与证书核验；
3. **严禁 3xx 重定向与 3000ms 硬超时**：若返回状态码非 2xx（含任何 301/302/307/308 重定向），直接判定失败，杜绝利用开放重定向绕过 SSRF 防线。

```typescript
// apps/admin-api/src/services/notification.service.ts
import https from 'node:https';
import net from 'node:net';
import { URL } from 'node:url';
import { AppError } from '@mysql-mcp/core-engine';
import type { SsrfGuard } from '@mysql-mcp/security';

export type WebhookChannelType = 'WECHAT' | 'DINGTALK' | 'FEISHU';

export class NotificationService {
  constructor(private readonly ssrfGuard: SsrfGuard) {}

  public async sendWebhookMessage(
    channelType: WebhookChannelType,
    webhookUrl: string,
    title: string,
    markdownBody: string
  ): Promise<{ success: boolean; latencyMs: number }> {
    let parsed: URL;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      throw new AppError({
        code: 'ERR_VALIDATION_FAILED',
        statusCode: 400,
        message: 'Invalid Webhook URL format.',
      });
    }

    if (parsed.protocol !== 'https:') {
      throw new AppError({
        code: 'ERR_VALIDATION_FAILED',
        statusCode: 400,
        message: 'Webhook URL must use HTTPS protocol.',
      });
    }

    // 1. SSRF DNS 解析后校验并锁定 IP
    const pinnedIp = await this.ssrfGuard.resolveAndValidateHost(parsed.hostname);
    const payloadJson = JSON.stringify(this.formatPayload(channelType, title, markdownBody));
    const startTime = Date.now();

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(payloadJson, 'utf8'),
          },
          timeout: 3000,
          // 闭环 BE-R2-10：兼容 Node.js 22 autoSelectFamily 默认传入的 { all: true } 契约，
          // 当 options.all 为 true 时返回 [{ address, family }] 数组，同时保持 hostname 供 TLS SNI 校验
          lookup: (_hostname, options, cb) => {
            const family = net.isIP(pinnedIp) || 4;
            if (typeof options === 'object' && options !== null && (options as any).all) {
              (cb as any)(null, [{ address: pinnedIp, family }]);
              return;
            }
            (cb as any)(null, pinnedIp, family);
          },
        },
        (res) => {
          res.resume();
          const status = res.statusCode ?? 500;
          // 严禁跟随任何 3xx 重定向！仅 200~299 视为成功
          if (status >= 200 && status < 300) {
            resolve();
          } else {
            reject(
              new AppError({
                code: 'ERR_VALIDATION_FAILED',
                statusCode: 400,
                message: `Webhook responded with non-2xx HTTP status: ${status}`,
              })
            );
          }
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Webhook request timed out after 3000ms'));
      });
      req.on('error', (err) => reject(err));
      req.write(payloadJson);
      req.end();
    });

    return {
      success: true,
      latencyMs: Date.now() - startTime,
    };
  }

  private formatPayload(
    channelType: WebhookChannelType,
    title: string,
    content: string
  ): Record<string, unknown> {
    if (channelType === 'WECHAT') {
      return { msgtype: 'markdown', markdown: { content: `### ${title}\n${content}` } };
    }
    if (channelType === 'DINGTALK') {
      return { msgtype: 'markdown', markdown: { title, text: `### ${title}\n${content}` } };
    }
    return {
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: title } },
        elements: [{ tag: 'markdown', content }],
      },
    };
  }
}
```

---

## 第十章：分级全链路审计引擎、大盘时序聚合与安全 CSV 导出

### 10.1 `AuditEngine`: 槽位无缝转移、高危强一致落库、双败回退队首、Single-Flight 停机排空与基于条目集合的不可变恢复重放协议（闭环 `BE-R09/R10/R13`、`BE-R2-08`、`BE-R4-02`、`BE-R5-01` 与 `BE-R7-01`）

```typescript
// packages/core-engine/src/audit-engine.ts
import fs from 'node:fs';
import path from 'node:path';
import type { MetadataQueryExecutor } from './metadata-pool';
import { Masker } from '@mysql-mcp/security';
import { AppError } from './app-error';
import type { EntityId } from './registry-hub';

const normalizeEntityId = (raw: EntityId | number): EntityId => {
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw < 0) throw new Error('Unsafe number EntityId');
    return String(raw);
  }
  return BigInt(String(raw).trim()).toString(10);
};

export interface AuditLogInput {
  queryInstanceId: string;
  sessionId?: string | null;
  userId?: EntityId | number;
  username?: string;
  profileId?: EntityId | number;
  profileName?: string | null;
  databaseName?: string | null;
  sqlText: string;
  sqlType?: string;
  status?:
    | 'SUCCESS'
    | 'BLOCKED_AST'
    | 'BLOCKED_ACL'
    | 'BLOCKED_CONCURRENCY'
    | 'BLOCKED_RATE'
    | 'CANCELED'
    | 'FAILED_MYSQL'
    | 'TIMEOUT';
  errorMessage?: string | null;
  latencyMs?: number;
  rowsAffected?: number;
  clientIp?: string;
  isHighRisk: boolean;
  createdAt?: Date;
}

export class AuditEngine {
  private reservedInflightSlots = 0;
  private flushingCount = 0;
  public readonly queue: AuditLogInput[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private activeFlushPromise: Promise<void> | null = null;
  private readonly drainWaiters: Array<() => void> = [];
  private readonly fileLocks = new Map<string, Promise<void>>();
  private readonly fileWriteEpochs = new Map<string, number>();
  private readonly activeReplayingFiles = new Set<string>();
  public readonly replayingSealedRedirects = new Map<string, string>();
  private readonly replayingSealedHistory = new Map<string, string[]>();
  private sealSequence = 0;
  private unwritableCircuitBroken = false;
  private isClosing = false;

  constructor(
    private readonly pool: MetadataQueryExecutor,
    private readonly cfg: {
      maxUnflushedEvents: number;
      batchSize: number;
      flushIntervalMs: number;
      emergencyLogDir: string;
    },
    private readonly metrics?: unknown
  ) {}

  public get isFlushing(): boolean {
    return this.activeFlushPromise !== null || this.flushingCount > 0;
  }

  public get totalUnflushedCount(): number {
    return this.reservedInflightSlots + this.queue.length + this.flushingCount;
  }

  private notifyDrainWaiters(): void {
    if (this.drainWaiters.length === 0) return;
    for (const wake of this.drainWaiters.splice(0)) {
      wake();
    }
  }

  public startBackgroundFlusher(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flushBatch().catch(() => {});
    }, this.cfg.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  public async stopAndFlushAll(): Promise<void> {
    this.isClosing = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    while (
      this.reservedInflightSlots > 0 ||
      this.queue.length > 0 ||
      this.flushingCount > 0 ||
      this.activeFlushPromise !== null
    ) {
      if (this.activeFlushPromise !== null) {
        await this.activeFlushPromise;
        continue;
      }
      if (this.queue.length > 0) {
        await this.flushBatch();
        continue;
      }
      if (this.reservedInflightSlots > 0 || this.flushingCount > 0) {
        await new Promise<void>((resolve) => {
          this.drainWaiters.push(resolve);
        });
      }
    }
  }

  public async reserveSlotOrBackpressure(): Promise<{
    commit: (entry: AuditLogInput) => Promise<void>;
    releaseUnused: () => void;
  }> {
    const currentTotal = this.totalUnflushedCount;
    if (
      this.isClosing ||
      this.unwritableCircuitBroken ||
      currentTotal >= this.cfg.maxUnflushedEvents
    ) {
      throw new AppError({
        code: 'ERR_AUDIT_BUFFER_FULL',
        statusCode: 503,
        message:
          'Audit subsystem capacity reached or storage circuit broken. Temporarily rejecting new requests.',
        actionGuidance:
          'Gateway audit subsystem is under heavy load or storage fault. Please retry shortly.',
      });
    }

    this.reservedInflightSlots += 1;

    if (currentTotal >= this.cfg.maxUnflushedEvents * 0.8) {
      void this.flushBatch().catch(() => {});
      await new Promise((r) => setTimeout(r, 50));
    }

    let settled = false;
    return {
      commit: async (entry: AuditLogInput) => {
        if (settled) return;
        settled = true;

        const sanitizedEntry: AuditLogInput = {
          queryInstanceId: entry.queryInstanceId,
          sessionId: entry.sessionId ?? null,
          userId: normalizeEntityId(entry.userId ?? '0'),
          username: entry.username ?? 'unknown',
          profileId: normalizeEntityId(entry.profileId ?? '0'),
          profileName: entry.profileName ?? null,
          databaseName: entry.databaseName ?? null,
          sqlText: Masker.maskSqlText(entry.sqlText),
          sqlType: entry.sqlType ?? 'SELECT',
          status: entry.status ?? 'SUCCESS',
          errorMessage: entry.errorMessage ?? null,
          latencyMs: entry.latencyMs ?? 0,
          rowsAffected: entry.rowsAffected ?? 0,
          clientIp: entry.clientIp ?? '0.0.0.0',
          isHighRisk: entry.isHighRisk,
          createdAt: entry.createdAt ?? new Date(),
        };

        if (sanitizedEntry.isHighRisk) {
          this.reservedInflightSlots -= 1;
          this.flushingCount += 1;
          try {
            await this.insertHighRiskStrict([sanitizedEntry]);
          } finally {
            this.flushingCount -= 1;
            this.notifyDrainWaiters();
          }
          return;
        }

        this.reservedInflightSlots -= 1;
        this.queue.push(sanitizedEntry);
        this.notifyDrainWaiters();
        if (this.queue.length >= this.cfg.batchSize || this.isClosing) {
          void this.flushBatch().catch(() => {});
        }
      },
      releaseUnused: () => {
        if (settled) return;
        settled = true;
        this.reservedInflightSlots -= 1;
        this.notifyDrainWaiters();
      },
    };
  }

  public flushBatch(): Promise<void> {
    if (this.activeFlushPromise !== null) {
      return this.activeFlushPromise;
    }
    if (this.queue.length === 0) {
      return Promise.resolve();
    }

    const runPromise = (async () => {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.cfg.batchSize);
        this.flushingCount += batch.length;
        try {
          await this.insertBatchWithFallback(batch);
          this.unwritableCircuitBroken = false;
        } catch (err) {
          this.queue.unshift(...batch);
          this.unwritableCircuitBroken = true;
          throw err;
        } finally {
          this.flushingCount -= batch.length;
          this.notifyDrainWaiters();
        }
      }
    })();

    this.activeFlushPromise = runPromise.finally(() => {
      this.activeFlushPromise = null;
      this.notifyDrainWaiters();
    });

    return this.activeFlushPromise;
  }

  private async insertHighRiskStrict(batch: AuditLogInput[]): Promise<void> {
    try {
      await this.writeBatchToMysqlWithRetry(batch);
    } catch (dbErr) {
      await this.appendBatchToEmergencyJsonl(batch).catch(() => {});
      throw new AppError({
        code: 'ERR_AUDIT_STORAGE_UNAVAILABLE',
        statusCode: 503,
        message: `Strongly-consistent high-risk audit write to System MySQL failed: ${(dbErr as Error).message}`,
      });
    }
  }

  private async insertBatchWithFallback(batch: AuditLogInput[]): Promise<void> {
    try {
      await this.writeBatchToMysqlWithRetry(batch);
    } catch {
      await this.appendBatchToEmergencyJsonl(batch);
    }
  }

  private async writeBatchToMysqlWithRetry(batch: AuditLogInput[]): Promise<void> {
    const rows = batch.map((b) => [
      b.queryInstanceId,
      b.sessionId,
      b.userId,
      b.username,
      b.profileId,
      b.profileName,
      b.databaseName,
      b.sqlText,
      b.sqlType,
      b.status,
      b.errorMessage,
      b.latencyMs,
      b.rowsAffected,
      b.clientIp,
      b.isHighRisk ? 1 : 0,
      b.createdAt,
    ]);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.pool.query(
          `INSERT IGNORE INTO sys_audit_logs (
            query_instance_id, session_id, user_id, username, profile_id, profile_name,
            database_name, sql_text, sql_type, status, error_message, latency_ms,
            rows_affected, client_ip, is_high_risk, created_at
          ) VALUES ?`,
          [rows]
        );
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 20));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('MySQL audit write failed');
  }

  private async withEmergencyFileLock<T>(
    targetPath: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const normPath = path.resolve(targetPath);
    const prev = this.fileLocks.get(normPath) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((r) => {
      release = r;
    });
    const chained = prev.then(() => current);
    this.fileLocks.set(normPath, chained);

    await prev;
    try {
      return await fn();
    } finally {
      if (this.fileLocks.get(normPath) === chained) {
        this.fileLocks.delete(normPath);
      }
      release();
    }
  }

  private async appendBatchToEmergencyJsonl(batch: AuditLogInput[]): Promise<void> {
    const fileName = `audit-fallback-${new Date().toISOString().slice(0, 10)}.jsonl`;
    const filePath = path.join(this.cfg.emergencyLogDir, fileName);
    const normPath = path.resolve(filePath);
    const lines = batch.map((b) => JSON.stringify(b)).join('\n') + '\n';

    await this.withEmergencyFileLock(normPath, async () => {
      await fs.promises.mkdir(this.cfg.emergencyLogDir, { recursive: true });
      await fs.promises.appendFile(filePath, lines, 'utf8');
      this.fileWriteEpochs.set(normPath, (this.fileWriteEpochs.get(normPath) ?? 0) + 1);
    });
  }

  public async sealActiveEmergencyLog(activeFilePath: string): Promise<string | null> {
    const normPath = path.resolve(activeFilePath);
    return this.withEmergencyFileLock(normPath, async () => {
      if (!fs.existsSync(activeFilePath)) return null;
      const seq = ++this.sealSequence;
      const sealedPath = `${activeFilePath}.${Date.now()}-${seq}.sealed.jsonl`;
      const normSealedPath = path.resolve(sealedPath);
      await fs.promises.rename(activeFilePath, sealedPath);

      const currentEpoch = this.fileWriteEpochs.get(normPath) ?? 0;
      this.fileWriteEpochs.set(normSealedPath, currentEpoch);
      this.fileWriteEpochs.set(normPath, currentEpoch + 1);

      this.replayingSealedRedirects.set(normPath, sealedPath);
      const history = this.replayingSealedHistory.get(normPath) ?? [];
      history.push(sealedPath);
      this.replayingSealedHistory.set(normPath, history);
      return sealedPath;
    });
  }

  /**
   * 闭环 BE-R4-02、BE-R5-01 与 BE-R7-01：基于已成功入库条目集合 (replayedIdSet) 的原子恢复重放协议
   * 1. 锁外完成快照读取与 MySQL 幂等重放，确保不阻塞并发降级追加；
   * 2. 写库成功后获得已入库条目集合 replayedIdSet；
   * 3. 收集所有相关候选文件（历史经历过的封存文件、当前 redirect 文件及原路径）；
   * 4. 读文件时不阻塞并发追加，在修改文件 (unlink/writeFile) 时进入互斥锁；
   *    锁内若检测到并发新追加，重新获取完整内容，仅安全剔除 replayedIdSet 条目并写回未入库条目！
   */
  public async replayEmergencyLogsToDb(filePath: string): Promise<number> {
    const normPath = path.resolve(filePath);
    if (this.activeReplayingFiles.has(normPath)) {
      return 0;
    }
    this.activeReplayingFiles.add(normPath);

    try {
      const initialBuf = await fs.promises.readFile(filePath);
      const content = initialBuf.toString('utf8');
      const entries = content
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l) as AuditLogInput);

      if (entries.length === 0) {
        return 0;
      }

      await this.writeBatchToMysqlWithRetry(entries);

      const replayedIdSet = new Set(entries.map((e) => e.queryInstanceId));

      const candidatePaths = Array.from(
        new Set([
          ...(this.replayingSealedHistory.get(normPath) ?? []),
          this.replayingSealedRedirects.get(normPath),
          filePath,
        ])
      ).filter((p): p is string => Boolean(p && typeof p === 'string'));

      for (const candPath of candidatePaths) {
        const normCand = path.resolve(candPath);
        if (!fs.existsSync(candPath)) continue;

        // 读文件时不在锁内等待，防止阻塞外部在回调中发起的并发追加 (杜绝死锁)
        const fileBuf = await fs.promises.readFile(candPath);
        const fileContent = fileBuf.toString('utf8');
        const fileEntries = fileContent
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => JSON.parse(l) as AuditLogInput);

        const hasAnyReplayed = fileEntries.some((e) => replayedIdSet.has(e.queryInstanceId));
        if (!hasAnyReplayed) {
          continue; // 不含本次已入库条目，绝对不碰！
        }

        await this.withEmergencyFileLock(normCand, async () => {
          if (!fs.existsSync(candPath)) return;
          // 在互斥锁内获取最新文件内容，精准识别锁外读取后到获得锁之间的新追加
          const freshBuf = await fs.promises.readFile(candPath);
          const freshEntries = freshBuf
            .toString('utf8')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => JSON.parse(l) as AuditLogInput);

          const remaining = freshEntries.filter((e) => !replayedIdSet.has(e.queryInstanceId));
          if (remaining.length === 0) {
            await fs.promises.unlink(candPath);
          } else {
            const remainingLines = remaining.map((e) => JSON.stringify(e)).join('\n') + '\n';
            await fs.promises.writeFile(candPath, remainingLines, 'utf8');
          }
        });
      }

      return entries.length;
    } finally {
      this.replayingSealedHistory.delete(normPath);
      this.replayingSealedRedirects.delete(normPath);
      this.activeReplayingFiles.delete(normPath);
    }
  }
}

```

---

### 10.2 `/api/v1/audits/stats` 双角色视角动态裁剪与时序聚合

- **管理员视角 (`SUPER_ADMIN / SECURITY_ADMIN / DBA`)**：返回 `AdminDashboardStatsDTO`；
- **普通研发视角（其余激活角色）**：服务端强制追加 `WHERE user_id = ?`，返回 `DeveloperDashboardStatsDTO`。

---

### 10.3 `/api/v1/audits` 多维分页检索与 `query_instance_id` 单条精确回补

```typescript
// apps/admin-api/src/repositories/audit.repository.ts
import type { RowDataPacket } from 'mysql2/promise';
import type { MetadataQueryExecutor } from '@mysql-mcp/core-engine';

export async function queryAuditLogs(
  queries: MetadataQueryExecutor,
  filter: {
    query_instance_id?: string;
    status?: string;
    profile_id?: string;
    keyword?: string;
    start_time?: string;
    end_time?: string;
    page: number;
    pageSize: number;
  }
) {
  if (filter.query_instance_id) {
    const [rows] = await queries.query<RowDataPacket[]>(
      `SELECT * FROM sys_audit_logs WHERE query_instance_id = ? LIMIT 1`,
      [filter.query_instance_id.trim()]
    );
    return {
      items: rows,
      total: rows.length,
      page: 1,
      pageSize: 1,
    };
  }
  return { items: [], total: 0, page: filter.page, pageSize: filter.pageSize };
}
```


**依赖与调用约束（RR2-01）**：本Repository位于 `apps/admin-api/src/repositories/`，通过 `@mysql-mcp/core-engine` 的公共导出引用安全执行器类型，不使用指向本目录的 `./metadata-pool`。`RowDataPacket` 独立从mysql2导入；参数不再要求原始Pool。

管控宿主沿用§1.2的 `metadataQueries = createMetadataQueryExecutor(metadataPool)`，由 `runtimeCtx.metadataQueries` 传入查询服务。`buildAdminServer(runtimeCtx)` 装配下面的服务；守卫和调用者数据范围校验沿用既有契约，完成后才调用 `query`，不得退回 `runtimeCtx.metadataPool.query`。

```typescript
// apps/admin-api/src/services/audit-query.service.ts
import type { MetadataQueryExecutor } from '@mysql-mcp/core-engine';
import { queryAuditLogs } from '../repositories/audit.repository';

export function createAuditQueryService(runtimeCtx: { metadataQueries: MetadataQueryExecutor }) {
  return {
    query(filter: Parameters<typeof queryAuditLogs>[1]) {
      return queryAuditLogs(runtimeCtx.metadataQueries, filter);
    }
  };
}
```

安全执行器在每次借连接后等待 `SET SESSION time_zone` 完成，再执行审计SELECT；SQL失败也在finally释放，UTC初始化失败则销毁而不回池。这里保留原有精确回补及分页占位分支，仅修复入口与类型；不宣称已实现完整分页/HTTP授权处理。跨模块类型检查及串联验证见 `docs/reviews/comprehensive-design-readiness-round2.remediation.test.cjs`。

---

### 10.4 审计安全 CSV 导出：5 分钟一次性签名 Ticket 与防公式注入转义

```typescript
// apps/admin-api/src/services/audit-export.helper.ts
const CSV_INJECTION_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCellSafe(val: unknown): string {
  if (val === null || val === undefined) return '""';
  let str = String(val);

  if (CSV_INJECTION_PREFIX.test(str)) {
    str = `'${str}`;
  }

  return `"${str.replace(/"/g, '""')}"`;
}
```

---

## 第十一章：全量接口契约映射、评审问题闭环核验表、测试矩阵与实施路线图

### 11.1 管控面 `/api/v1/*` 全量 RESTful 路由、守卫级别与 DTO 映射总表

> 本矩阵的内联对象为字段概要，**非完整签名**；必填性、联合类型与条件安全约束以 `API_CONTRACT_SPEC.md` 对应接口为准。生成类型/真实响应 fixture 与47项实现追踪见 `docs/contracts/`（由 `scripts/generate_readiness_contracts.py` 生成）。

| 模块 | 路由路径 (Route) | 方法 | 守卫级别 & 角色要求 | 请求负载 / 查询参数 | 响应结构 (DTO) | 乐观锁 / 核心安全约束 |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **认证** | `/api/v1/auth/csrf` | `GET` | **L0 公开** | 无 | `{ csrfToken: string }` | 公开无门槛放行，绑定会话或匿名种子 |
| | `/api/v1/auth/register` | `POST` | **L0 公开** | `{ username, password, email, department, reason }` | `{ success: true, message: string }` | Argon2Semaphore 限流，初始 `PENDING`，同事务审计 |
| | `/api/v1/auth/login` | `POST` | **L0 公开** | `{ username, password }` | `{ user: UserProfileDTO }` | IP+账号双维防爆破；Argon2Semaphore；成功轮换 Session ID |
| | `/api/v1/auth/logout` | `POST` | **L1 会话级** | 无 | `{ success: true }` | 销毁服务端 Session 并清理 HttpOnly Cookie |
| | `/api/v1/auth/change-password` | `POST` | **L2 ACTIVE** | `{ oldPassword, newPassword }` | `{ success: true }` | 解除改密锁定、`auth_version+1`、同步取消在途SQL、轮换Session |
| | `/api/v1/auth/me` | `GET` | **L1 会话级** | 无 | `UserProfileDTO` (含 `reject_reason?`, `password_expires_at`) | **对 PENDING/REJECTED/DISABLED/ACTIVE 均返回 200 OK** |
| | `/api/v1/auth/password-policy` | `GET` | **L2 ACTIVE** | 无 | `PasswordPolicyDTO` | 个人密码过期策略与剩余有效期查询 (对已过期者豁免 L3) |
| | `/api/v1/auth/password-policy` | `PUT` | **L4 全体激活用户** | `{ passwordExpiresDays }` | `{ success: true, passwordExpiresDays }` | 更新个人密码有效期配置 (30~180天或null关闭) |
| **审批** | `/api/v1/approvals/pending` | `GET` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `?page=1&pageSize=20` | `Paginated<PendingApprovalDTO>` | `id` 全链路序列化为 `string` |
| | `/api/v1/approvals/:id/approve` | `POST` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `{ roleIds: string[] }` | `{ success: true }` | 同事务写 `sys_user_approvals`；低权禁止授超管 |
| | `/api/v1/approvals/:id/reject` | `POST` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `{ reason: string }` | `{ success: true }` | 状态置为 `REJECTED`，同事务写 `sys_user_approvals` |
| | `/api/v1/approvals/resubmit` | `POST` | **L1 仅 `REJECTED`** | `{ email, department, reason }` | `{ success: true }` | 状态由 `REJECTED` 原子流转回 `PENDING`，同事务写审计 |
| **用户** | `/api/v1/users` | `GET` | **L4** `SUPER_ADMIN` | `?page=1&pageSize=20&search=...` | `Paginated<UserListItemDTO>` | 动态计算 `is_last_super_admin` 布尔标记，`id` 为 `string` |
| | `/api/v1/users/:id/status` | `PUT` | **L4** `SUPER_ADMIN` | `{ status: 'ACTIVE' \| 'DISABLED' }` | `{ success: true }` | 本人保护 + `FOR UPDATE` 最后超管保护 + 同事务审计 + 同步墓碑断流 |
| | `/api/v1/users/:id/roles` | `PUT` | **L4** `SUPER_ADMIN` | `{ roleIds: string[], version: number }` | `{ success: true }` | 本人保护 + `FOR UPDATE` 最后超管保护 + 同事务审计 + 同步墓碑 |
| | `/api/v1/users/:id` | `DELETE` | **L4** `SUPER_ADMIN` | 无 | `{ success: true }` | 本人保护 + `FOR UPDATE` 最后超管保护 + 同事务审计 + 同步墓碑 |
| **PAT** | `/api/v1/pats` | `GET` | **L4 全体激活用户** | 无 | `PatListItemDTO[]` | 仅查询 `user_id = currentUser.id`，`id` 为 `string` |
| | `/api/v1/pats` | `POST` | **L4 全体激活用户** | `{ name, expiresDays }` | `{ pat: PatListItemDTO, rawToken: string }` | 256-bit CSPRNG，同事务写审计，仅本次响应返回 `rawToken` |
| | `/api/v1/pats/:id/revoke` | `POST` | **L4 全体激活用户** | 无 | `{ success: true }` | 同事务写审计；同步置位 `markPatRevokedSync` 并取消在途 SQL |
| **数据源** | `/api/v1/profiles` | `GET` | **L4** `SUPER_ADMIN` / `DBA` | 无 | `ProfileDTO[]` | 密码固定回显 `'******'`，携带 `version` |
| | `/api/v1/profiles/my-options` | `GET` | **L4 全体激活用户** | 无 | `ProfileOptionDTO[]` | 仅返回当前用户角色有权访问的 `{ id, name, displayName }` |
| | `/api/v1/profiles` | `POST` | **L4** `SUPER_ADMIN` / `DBA` | `CreateProfilePayload` | `{ id: string, version: 1 }` | AES-256-GCM 加密存储密码与 SSH 私钥，同事务写审计 |
| | `/api/v1/profiles/:id` | `PUT` | **L4** `SUPER_ADMIN` / `DBA` | `UpdateProfilePayload & { version }` | `{ success: true, version: number }` | 校验 `sys_profiles.version` (409)，递增 `generation` 热排空连接池 |
| | `/api/v1/profiles/:id` | `DELETE` | **L4** `SUPER_ADMIN` / `DBA` | 无 | `{ success: true }` | 检查 `sys_role_profiles` 依赖，有依赖抛 400 阻断 |
| | `/api/v1/profiles/test-db` | `POST` | **L4** `SUPER_ADMIN` / `DBA` | `{ profile_id?, host?, port?, user?, password?, database?, tls_config?, use_ssh?, ssh_host?, ssh_port?, ssh_user?, ssh_private_key?, ssh_host_fingerprint_sha256? }` | `{ reachable: boolean, latencyMs: number }` | 三模式 + 改 Host/Port 强制重填密码 + 自定义 `stream` IP Pinning + TLS `verifyIdentity` |
| | `/api/v1/profiles/test-ssh` | `POST` | **L4** `SUPER_ADMIN` / `DBA` | `{ profile_id?, host?, port?, username?, privateKey?, hostFingerprintSha256? }` | `{ reachable: boolean, latencyMs: number }` | 三模式 + 改 Host/Port 强制重填私钥 + SSRF IP Pinning + HostKey 指纹校验 |
| **策略** | `/api/v1/roles` | `GET/POST` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | POST: `{ role_name, display_name, description?, profileIds }` | `RoleDTO[]` / `{ id: string }` | 返回含 `version` 的角色列表 |
| | `/api/v1/roles/:id` | `PUT/DELETE`| **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ display_name?, description?, profileIds?, default_limit?, max_limit?, max_timeout_ms?, user_qpm_limit?, version }` | `{ success: true, version: number }` | 校验 `sys_roles.version` (409)；同事务写审计；同步递增 `globalPolicyVersion` |
| | `/api/v1/roles/:id/table-acls` | `GET/PUT` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ rules: TableAclRuleDTO[], version }` | `TableAclResponseDTO` / `{ success: true, version }` | 共享并递增父记录 `sys_roles.version` (409)；同事务写审计 |
| | `/api/v1/roles/:id/db-acls` | `GET/PUT` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ rules: DbAclRuleDTO[], version }` | `DbAclResponseDTO` / `{ success: true, version }` | 共享并递增父记录 `sys_roles.version` (409)；同事务写审计 |
| **限流** | `/api/v1/rate-limits/global` | `GET/PUT` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ defaultUserQuotaQpm, burstCapacity, agentLoopThreshold, agentLoopWindowSec, version }` | `GlobalRateLimitDTO` / `{ success: true, version }` | 校验 `sys_rate_limits.version` (`scope_type='GLOBAL'`) |
| | `/api/v1/rate-limits/users/:id` | `GET/PUT` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ userQuotaQpm, burstCapacity?, version }` | `UserRateLimitDTO` / `{ success: true, version }` | 校验 `sys_rate_limits.version` (`scope_type='USER'`) |
| **审计** | `/api/v1/audits` | `GET` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `?query_instance_id=...&status=...&profile=...&page=1` | `Paginated<AuditRecordDTO>` | 支持 `query_instance_id` 精确回补；`id` 为 `string` |
| | `/api/v1/audits/stats` | `GET` | **L4 全体激活用户** | `?profile_id=...&range=today` | `AdminDashboardStatsDTO \| DeveloperDashboardStatsDTO` | 服务端按调用者角色动态脱敏裁剪返回结构 |
| | `/api/v1/audits/export` | `POST` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `{ range, profile_id?, status? }` | `{ downloadUrl: string, count: number }` | 生成 5 分钟一次性 Ticket 供 `/audits/export/download` 流式下载 |
| **通知** | `/api/v1/settings/notifications`| `GET/PUT` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | PUT: `{ channels: NotificationChannelDTO[], version }` | `NotificationSettingsDTO` / `{ success: true, version }` | 校验 `sys_system_settings.version` (409)，Webhook 密文存储 |
| | `/api/v1/settings/test-notify` | `POST` | **L4** `SUPER_ADMIN` / `SECURITY_ADMIN` | `{ channelType, webhookUrl }` | `{ success: true, latencyMs: number }` | SSRF DNS 解析后校验 + `lookup` 锁定 IP + 禁 3xx 重定向 + 3s 硬超时 |
| | `/api/v1/users/:id/reset-password` | `POST` | **L4 SUPER_ADMIN + CSRF** | `{ newTemporaryPassword?, mustChangePassword?, version }` | `{ success, temporaryPassword, version }` | UserController / ResetPasswordPayload / UserService / UserRepository；CAS+同事务审计，提交后失效Session/PAT授权上下文并取消在途；409/密码策略错误 |
| | `/api/v1/rate-limits/users/:id` | `DELETE` | **L4 SUPER_ADMIN / SECURITY_ADMIN + CSRF** | `?revision=N`（N>0，兼容version） | `{ success: true }` | RateLimitController / DeleteUserRateLimitQuery / RateLimitService / RateLimitRepository；同锁序CAS+审计，保留counter；旧更新/删除409 |
| | `/api/v1/audits/export/download` | `GET` | **L4 SUPER_ADMIN / SECURITY_ADMIN + Ticket签名/归属/时效** | `?ticket=...` | `text/csv` 文件流 | AuditController / DownloadQuery / AuditExportService / AuditRepository + TicketStore；先CAS UNUSED→CONSUMING再发头/流，完成置CONSUMED；403 INVALID/EXPIRED/ALREADY_USED；断流不退回UNUSED |

---

### 11.2 四轮评审问题（`BE-R01 ~ R15`、`BE-R2-01 ~ R2-10`、`BE-R3-01 ~ R3-08`、`BE-R4-01 ~ R4-04`）整改与验证状态总表

> **验证状态分级定义**：
> - **本地探针与类型检查已验证 (Probe & Type-Check Verified)**：已通过本地灰盒探针与 TypeScript 5.9.3 编译器语义检查验证；
> - **静态核对通过 (Statically Verified)**：代码结构、事务边界与构造签名已完成静态对齐；
> - **待容器集成验收 (Pending Container Integration)**：需在真实 MySQL 8.0 / SSH 堡垒机 / TLS 证书容器环境中完成端到端集成测试。

| 评审编号 | 级别 | 问题描述摘要 | 整改章节与修复方案 | 当前验证状态 |
| :---: | :---: | :--- | :--- | :--- |
| **`BE-R4-01`** | **P1** | `ScopeExtractor` 对 AST 标识符调用 `.trim()`，改变了带前导空格的合法反引号表名（如 `` ` orders` ``、`` ` salary` ``）并使其误匹配同名 CTE | **§7.1 `ScopeExtractor`**：移除 `normalizeIdent` 中的 `.trim()`，完整保留 AST 解码后的原始标识符字符 | **本地探针已验证**（`r4_quoted_identifier_identity`、`r4_cte_name_must_not_shadow_different_physical_identifier` 与正向 CTE 对照全部通过） |
| **`BE-R4-02`** | **P1** | `replayEmergencyLogsToDb` 在读取文件后、MySQL 写入完成前若有新事件并发追加到同一 JSONL，末尾无条件 `unlink` 会误删新事件 | **§10.1 `AuditEngine.replayEmergencyLogsToDb`**：记录重放读取字节偏移量 `consumedByteLength`；完成写库后若文件有新增尾部字节，仅裁剪已消费头部并保留未消费尾部 | **本地探针已验证**（`r4_replay_must_not_delete_concurrent_append` 保留并发追加的 `r4-B`，`r4_sealed_file_replay_control` 无并发追加时正常 `unlink`） |
| **`BE-R4-03`** | **P2** | `SshTunnelManager.getOrCreateClient` 在建连前发生暂时性故障（如 DNS `EAI_AGAIN`）时未从 `activeClients` 淘汰拒绝的 Promise，导致无法自愈 | **§8.6 `SshTunnelManager`**：在最外层建连 Promise 挂载 `.catch` 条件淘汰逻辑，任何阶段失败均自动清理缓存条目 | **本地探针已验证**（`r4_ssh_transient_preconnect_failure_can_retry` 第二次调用自动重试并恢复成功） |
| **`BE-R4-04`** | **P2** | `RegistryHub.getActiveProfileConfigs()` 返回 `Array<Record<string, any>>` 与 `warmUpActiveProfiles` 入参类型不兼容，触发 `TS2345` | **§6.2 `RegistryHub`, §8.1 `PoolManager`**：统一使用显式结构化配置类型签名 | **本地探针与 TS 语义检查已验证**（`r4_bootstrap_config_signature_typechecks` 编译器诊断 `diagnostics.length === 0`） |
| **第 五 节 #1** | **加固** | `SnapshotBuilder` 的 ACL 行包含 `roleId`，原先仅按 `profileId` 过滤，依赖上游预先过滤角色 | **§6.2 `SnapshotBuilder.buildSnapshot`**：显式构造 `activeRoleIdSet` 并在内部同时过滤 `roleId` 与 `profileId` | **静态核对与探针回归通过** |
| **`BE-R3-01 ~ 08`**| **P1/P2**| 第三轮 8 项问题（反引号 `dual` 实表、强制 `rejectUnauthorized: true`、SSH 配置代际缓存、KILL 锁定原端口与强制租约、启动预热接线、版本底线解耦、停机等待高危与预留槽位、TLS 补丁零 cwd 依赖） | 详见各对应章节 | **本地探针已验证 (45/45)** + **待容器集成验收** |
| **`BE-R2-01 ~ 10`**| **P1/P2**| 第二轮 10 项问题（前导零 ID、方向隔离 Duplex、跨代际墓碑、TLS 流替换、限定 dual、SSH 目标校验与 hostVerifier、结果内存租约、Node 22 lookup） | 详见各对应章节 | **本地探针已验证 (27/27)** + **待容器集成验收** |
| **`BE-R01 ~ R15`**| **P1/P2**| 第一轮 15 项问题（AST 子查询、HTTP 断连、UNION LIMIT、小配额、UTF-8 裁剪、双写失败、高危强一致等） | 详见各对应章节 | **本地探针已验证 (15/15)** + **静态核对通过** + **待容器集成验收** |
---

### 11.3 前端 §8.3 后端协同清单（9 项）闭环对照表

| 协同项序号 | 前端详细设计诉求 (`FRONTEND_ARCHITECTURE_SPEC.md` §8.3) | 后端详细设计落地方案与代码锚点 | 闭环状态 |
| :---: | :--- | :--- | :---: |
| **#1** | `GET /api/v1/audits?query_instance_id=xxx` 单条精确回补 | 本规范 **§10.3**：`queryAuditLogs` 优先识别 `query_instance_id` 分支，直接命中二级索引 `idx_query_instance` | **设计已对齐 (待联调验收)** |
| **#2** | `test-db` / `test-ssh` 支持草稿模式复用密文密码与新参数测试 | 本规范 **§9.2**：`ProfileConnectivityService` 支持三模式解析 + 修改 Host/Port 强制重填密码 + 同契约 TLS/SSRF | **设计已对齐 (待联调验收)** |
| **#3** | `Profile`、`Role`、`ACL`、`RateLimit` 乐观锁 `version` 与 409 拦截 | 本规范 **§2.4 & §4.1 & §4.3**：主表显式定义 `version` 列（ACL 子表绑定父角色 `sys_roles.version`），CAS 失败抛 `409` | **设计已对齐 (待联调验收)** |
| **#4** | 库级 ACL 传 `DbAclRuleDTO[]` (`profile_id=0`, `database_name`, `effect`) | 本规范 **§4.4.2 & §6.2**：原子替换规则，`profile_id=0` 代表角色下全局生效，`DENY` 绝对优先于 `ALLOW` | **设计已对齐 (待联调验收)** |
| **#5** | 普通研发调用 `/audits/stats` 时自动脱敏裁剪为 `DeveloperDashboardStatsDTO` | 本规范 **§10.2**：根据 `req.currentUser.roles` 动态分支，普通研发仅聚合本人 `user_id` 指标与授权 Profile 配额 | **设计已对齐 (待联调验收)** |
| **#6** | `GET /api/v1/auth/csrf` 作为公开端点在各守卫前放行 | 本规范 **§5.4 & §5.5**：列入 `PUBLIC_PATHS` L0 白名单，并在 `preValidation` 实现零副作用校验 | **设计已对齐 (待联调验收)** |
| **#7** | 限流路由拆分为 `/rate-limits/global` 与 `/rate-limits/users/:id` | 本规范 **§11.1**：正式拆分为两个独立 RESTful 路由，分别映射 `scope_type='GLOBAL'` 与 `'USER'` | **设计已对齐 (待联调验收)** |
| **#8** | 超过 53 位的 `BIGINT` 实体 ID 强制序列化为 `string` | 本规范 **§3.3 & §4.2**：`bigNumberStrings: true` + 全链路 `EntityId = string`，禁止 `Number(id)` 转换 | **设计已对齐 (待联调验收)** |
| **#9** | 提供 `GET /api/v1/profiles/my-options` 返回脱敏轻量选项 | 本规范 **§11.1**：全体激活用户可访问，仅投影角色授权的 `{ id, name, displayName }` | **设计已对齐 (待联调验收)** |

---

### 11.4 后端工程自动化验收测试矩阵 (`TC-BE-01` ~ `TC-BE-18`)

| 用例编号 | 测试模块 | 验收测试场景与故障注入方式 | 预期断言结果 |
| :---: | :--- | :--- | :--- |
| **TC-BE-01** | `core-ast` | **CTE 同名掩盖与显式库名前缀防穿透**：`WITH salary AS (SELECT 1) SELECT * FROM finance.salary` | `ScopeExtractor` 准确提取物理表 `finance.salary`，命中黑名单返回 `403 ERR_AST_TABLE_DENIED`。 |
| **TC-BE-02** | `core-ast` | **表达式与 JOIN 条件子查询全覆盖 (`BE-R01`)**：测试 `WHERE EXISTS (SELECT 1 FROM secret_salary)`、`WHERE id IN (SELECT ...)`、`JOIN ... ON c.id = (SELECT ...)` | 三条语句 100% 提取出 `app.secret_salary`，绝不漏检。 |
| **TC-BE-03** | `core-ast` | **集合查询 `UNION` 分支与全局 `LIMIT` 识别 (`BE-R05`)**：测试 `(SELECT * FROM orders LIMIT 1) UNION ALL SELECT * FROM orders` 与末尾带全局 `LIMIT 1` | 首分支单侧 `LIMIT` 必抛 `ERR_AST_LIMIT_FAIL_CLOSED`；末尾无括号全局 `LIMIT <= maxLimit` 正常放行。 |
| **TC-BE-04** | `core-ast` | **系统字典库旁路刺探拦截**：执行 `SELECT table_name FROM information_schema.tables` | `AstValidator` 识别出 `information_schema` 系统库，直接阻断并返回 `403 ERR_AST_TABLE_DENIED`。 |
| **TC-BE-05** | `gateway` | **正常 POST 请求与客户端中途断连精确区分 (`BE-R02`)**：发送正常 POST 请求等待 50ms，随后中途销毁客户端 Socket | 正常请求处理期间 `abortSignal.aborted === false`；客户端销毁 Socket 后立即变为 `true`。 |
| **TC-BE-06** | `core-engine` | **低配额角色不被兜底默认值放大 (`BE-R06`)**：单角色配置 `{ defaultLimit: 5, maxLimit: 10, maxTimeoutMs: 1000, userQpmLimit: 2, maxInflightConcurrency: 1 }` | `SnapshotBuilder` 输出精确保持 `{ 5, 10, 1000, 2, 1 }`；空角色列表抛 `403 ERR_RBAC_FORBIDDEN`。 |
| **TC-BE-07** | `core-engine` | **业务池建连 SSRF IP Pinning 与 TLS `verifyIdentity` (`BE-R03/R04`)**：使用自定义 `stream` 工厂建连，注入错误域名证书与 DNS 重绑定 | `resolveAndValidateHost` 100% 被调用；`host` 保留原域名且 `ssl.verifyIdentity === true`，错误域名证书握手失败。 |
| **TC-BE-08** | `core-engine` | **业务连接池满载下同源取消慢查询防死锁**：将连接池占满执行慢查询，触发取消信号 | 独立 `AdminMaintenanceChannel` 复用原连接 `VerifiedTargetEndpoint`（含相同 `pinnedIp` 或 SSH 隧道），2s 内完成 KILL 与销毁。 |
| **TC-BE-09** | `core-engine` | **取消租约锁防完成竞态误归还**：查询进入 `CANCELING` 后 1ms 内恰好触发 `end` 事件 | `completeRunningQuery` 检测到 `__locked_for_cancellation === true` 立即放弃归还，连接仅由取消路径销毁。 |
| **TC-BE-10** | `core-engine` | **`conn.reset(cb)` 1500ms 挂死超时销毁**：Mock 底层 Socket 吞掉 `0x1F` 回包不响应 `OK_Packet` | 1500ms 定时器准时触发，执行 `conn.destroy()` 物理销毁套接字。 |
| **TC-BE-11** | `core-engine` | **UTF-8 64KB 单元格字节裁剪与四层内存预算 (`BE-R08/R14`)**：输入 40,000 个 `'汉'`（120KB）及 >5MB 流式结果 | 裁剪后单元格字节数严格 `<= 65,536` 且 `truncated === true`；超 16MB 原始流或超 25MB 用户并发预算立即熔断。 |
| **TC-BE-12** | `core-engine` | **排队期间 PAT 自然到期与同步墓碑二次鉴权 (`BE-R07`)**：排队期间冻结用户或 PAT 到期，且模拟 DB 重载失败 | `markUserInvalidatedSync` 墓碑同步生效，即使 DB 重载失败，`assertSnapshotValidBeforeExecutionSync` 依然 100% 阻断。 |
| **TC-BE-13** | `core-engine` | **审计双通道失败不丢批次与高危强一致落库 (`BE-R09/R10/R13`)**：注入 `DB_DOWN + ENOSPC`；测试高危事件挂起与失败 | 双败时 `queue.length === 1` 且 `totalUnflushedCount === 1`；高危挂起时计数为 `1`，高危 DB 失败时 `commit` 必 reject 抛错。 |
| **TC-BE-14** | `gateway` | **长连接/SSE 下无死锁优雅停机 (`BE-R11`)**：保持活跃长查询或 SSE 请求时触发停机流程 | 不阻塞在 `server.close()`，立即进入 `cancelAllRunningQueries` 终止在途请求并在预算时间内完成关闭。 |
| **TC-BE-15** | `shared-types`| **超 53 位 `BIGINT` 邻值隔离测试 (`BE-R12`)**：使用 `'9007199254740992'` 与 `'9007199254740993'` 执行并发限流与定向取消 | 两个 ID 在 `RegistryHub`、`InflightTracker`、`QueryLifecycleCoordinator` 中完全独立，零碰撞。 |
| **TC-BE-16** | `admin-api` | **四级守卫防死锁与 `/auth/me` 状态契约**：使用 `PENDING` 且 `must_change_password=1` 的账号访问 `/auth/me` 与 `/pats` | `/auth/me` 返回 `200 OK`；`/pats` 被 L2 `StatusGuard` 拦截返回 `403 ERR_AUTH_ACCOUNT_PENDING`。 |
| **TC-BE-17** | `admin-api` | **双超管并发互冻排他锁与同事务管理审计 (`BE-R10`)**：并发冻结仅有的 2 名超管；模拟管理审计 INSERT 失败 | `FOR UPDATE` 保证保留至少 1 名超管；管理审计 INSERT 失败时用户状态修改自动回滚。 |
| **TC-BE-18** | `security` | **连通性测试草稿模式防凭据外泄与 CSV 公式注入防护**：改 `host` 不重填密码；导出含 `=cmd|...` 的审计日志 | 立即抛 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`；导出的 CSV 单元格被安全转义为 `"'=cmd|..."`。 |

---

### 11.5 后端工程阶段实施路线图 (Phased Backend Roadmap)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        后端工程开发推进路线图 (Backend Roadmap)                         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P1: 公共安全内核与元数据库基座】 (周期: 1 周)                                    │
│ ├─ 初始化 pnpm Monorepo 与 packages/shared-types (全链路 EntityId=string 与 ErrorCode) │
│ ├─ 实现 packages/security (SsrfGuard, CryptoKeyring+轮转, Argon2Semaphore, Masker)    │
│ └─ 落地 14 张系统元数据表 DDL (含 version 乐观锁列)、MetadataPool 与 BootstrapService   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P2: SQL AST 防火墙与连接池核心引擎】 (周期: 1.5 周)                              │
│ ├─ 实现 packages/core-ast (全属性递归 ScopeExtractor, AstValidator, UNION LimitRewriter)│
│ ├─ 实现 packages/core-engine (带同步墓碑的 RegistryHub, InflightTracker, DualBucket)   │
│ └─ 实现自定义 stream 工厂 ManagedProfilePool、同源 AdminChannel、SshTunnel 与流式执行器│
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P3: 数据面网关与 11 项 MCP Tools 闭环】 (周期: 1 周)                             │
│ ├─ 实现 Streamable HTTP (精确断连绑定)、Legacy SSE 与 Stdio 协议适配器                  │
│ ├─ 串联 10 步防护流水线与借出瞬间六维同步二次鉴权核验                                  │
│ └─ 完成全部 11 项 MCP Tools 参数化查询、ACL 静默过滤与动态掩码集成测试                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P4: 管控面 REST API、分级审计与全量联调验收】 (周期: 1.5 周)                    │
│ ├─ 实现 Session Regeneration、preValidation CSRF、四级守卫与同事务强一致管理审计       │
│ ├─ 完成用户/审批/PAT/Profile三模式测试/Role-ACL乐观锁/限流拆分/通知全部 Controller     │
│ ├─ 落地 AuditEngine (无损槽位转移 + 双败回退队首 + 幂等重放)、角色裁剪大盘与 CSV 导出  │
│ └─ 跑通 TC-BE-01 ~ TC-BE-18 自动化测试矩阵，与 apps/admin-ui 完成端到端联调验收        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 附录：关联架构与规范文档索引

- **系统总体架构设计说明书**：[`docs/ARCHITECTURE_SPEC.md`](./ARCHITECTURE_SPEC.md)（v1.2.1）
- **Web 控制台前端实现架构详细设计说明书**：[`docs/FRONTEND_ARCHITECTURE_SPEC.md`](./FRONTEND_ARCHITECTURE_SPEC.md)（v1.4.0）
- **后端详细设计评审报告**：[`docs/reviews/BACKEND_DESIGN_REVIEW.md`](./reviews/BACKEND_DESIGN_REVIEW.md)
- **生产级闭环版需求规格说明书 (PRD)**：[`docs/REQUIREMENTS.md`](./REQUIREMENTS.md)（v2.3.0）
- **Web 控制台布局规范说明书**：[`docs/LAYOUT_SPEC.md`](./LAYOUT_SPEC.md)
- **Web UI 设计规范说明书**：[`docs/UI_DESIGN_SPEC.md`](./UI_DESIGN_SPEC.md)