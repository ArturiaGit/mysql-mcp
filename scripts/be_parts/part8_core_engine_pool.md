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