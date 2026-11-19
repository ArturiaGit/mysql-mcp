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