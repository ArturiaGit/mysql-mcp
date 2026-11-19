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
