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