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