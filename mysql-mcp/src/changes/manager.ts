import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import type { ConnectionDraft, ConnectionView } from '../server/connections.js';
import { ServerError, sanitizeError, type ServerErrorCode } from '../server/errors.js';
import { CredentialStoreError } from '../security/keyring.js';
import { evaluateSql } from '../sql/policy.js';
import { SqlPolicyError } from '../sql/ast.js';
import { databaseDdl, mysqlWriteSession, writeError, type WriteSessionFactory } from '../sql/write-driver.js';
import { readJournal, writeResult, type ChangeStorage } from './journal.js';
import { CHANGE_LIMITS, parseChangeInput, parseWebDecision, requestId, terminal, effectNote,
  type ChangeState, type ChangeSummary, type Decision, type ConfirmationChannel } from './types.js';

export interface ChangeConnections {
  get(id: string): Promise<ConnectionView>;
  subscribe(listener: (id: string) => void): () => void;
  withChangeConnection<T>(id: string, version: number, signal: AbortSignal, action: (draft: Readonly<ConnectionDraft>) => Promise<T>): Promise<T>;
}
export type NativeElicitor = (params: ElicitRequestFormParams, signal: AbortSignal) => Promise<ElicitResult>;
interface OriginSession { native?: NativeElicitor }
interface Entry {
  summary: ChangeSummary; session: string | null; sql?: string; reason?: string;
  nonce?: string; browser?: string; native?: string;
}
export interface ChangeManagerOptions {
  connections: ChangeConnections; storage: ChangeStorage; sessionFactory?: WriteSessionFactory;
  now?: () => number; timeoutMs?: number; managementUrl?: () => string;
}
const transitions: Record<ChangeState, readonly ChangeState[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'INVALIDATED'],
  APPROVED: ['EXECUTING', 'CANCELLED', 'FAILED', 'EXPIRED', 'INVALIDATED'],
  EXECUTING: ['SUCCEEDED', 'FAILED', 'UNKNOWN'], SUCCEEDED: [], FAILED: [], UNKNOWN: [],
  REJECTED: [], CANCELLED: [], EXPIRED: [], INVALIDATED: []
};
const secret = (): string => randomBytes(32).toString('hex');
const equal = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** One authority for both protocol entrances. SQL/challenges never enter the journal. */
export class ChangeManager {
  private readonly entries = new Map<string, Entry>();
  private readonly sessions = new Map<string, OriginSession>();
  private readonly running = new Map<string, { controller: AbortController; task: Promise<void> }>();
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private readonly nativeControllers = new Map<string, AbortController>();
  private closed = false;
  private healthy = true;
  private ready = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly factory: WriteSessionFactory;
  constructor(private readonly options: ChangeManagerOptions) {
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? CHANGE_LIMITS.execution_timeout_ms;
    this.factory = options.sessionFactory ?? mysqlWriteSession;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > CHANGE_LIMITS.execution_timeout_ms) throw new ServerError('INVALID_ARGUMENT');
  }
  async initialize(): Promise<void> {
    if (this.ready || this.closed) throw new ServerError('STATE_CONFLICT');
    try {
      for (const summary of readJournal(await this.options.storage.read())) {
        if (summary.state === 'EXECUTING') { summary.state = 'UNKNOWN'; summary.error_code = 'DB_ERROR'; summary.updated_at = this.iso(); }
        else if (!terminal(summary.state)) { summary.state = 'INVALIDATED'; summary.updated_at = this.iso(); }
        this.entries.set(summary.request_id, { summary, session: null });
      }
      this.prune();
      await this.persist();
      this.ready = true;
      this.unsubscribe = this.options.connections.subscribe(id => {
        for (const entry of this.entries.values()) if (entry.summary.connection_id === id &&
          ['PENDING', 'APPROVED'].includes(entry.summary.state)) this.move(entry, 'INVALIDATED', 'CONNECTION_CHANGED');
        void this.serial(() => this.persist()).catch(() => {});
      });
      this.timer = setInterval(() => { void this.sweep().catch(() => {}); }, 1000);
      this.timer.unref();
    } catch { this.healthy = false; throw new ServerError('SERVICE_UNAVAILABLE'); }
  }
  private iso(): string { return new Date(this.now()).toISOString(); }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    if (this.queued >= CHANGE_LIMITS.max_queued) return Promise.reject(new ServerError('RESOURCE_LIMIT'));
    this.queued++;
    const task = this.tail.then(action); this.tail = task.catch(() => {});
    return task.finally(() => { this.queued--; });
  }
  private available(): void {
    if (!this.ready || this.closed || !this.healthy) throw new ServerError('SERVICE_UNAVAILABLE');
  }
  private async persist(receipt?: ChangeSummary): Promise<void> {
    try { await this.options.storage.write({ schema_version: 1, items: [...this.entries.values()].map(entry =>
      structuredClone(receipt?.request_id === entry.summary.request_id ? receipt : entry.summary)) }); }
    catch { this.healthy = false; throw new ServerError('SERVICE_UNAVAILABLE'); }
  }
  private move(entry: Entry, state: ChangeState, error?: ServerErrorCode): void {
    if (!transitions[entry.summary.state].includes(state)) throw new ServerError('STATE_CONFLICT');
    entry.summary.state = state; entry.summary.updated_at = this.iso();
    if (error) entry.summary.error_code = error;
    if (terminal(state)) {
      delete entry.sql; delete entry.reason; delete entry.nonce; delete entry.browser; delete entry.native;
      if (state === 'UNKNOWN') this.running.get(entry.summary.request_id)?.controller.abort();
      this.nativeControllers.get(entry.summary.request_id)?.abort();
    }
  }
  private prune(): boolean {
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (['PENDING', 'APPROVED'].includes(entry.summary.state) && this.now() >= Date.parse(entry.summary.expires_at)) {
        this.move(entry, 'EXPIRED', 'APPROVAL_EXPIRED'); changed = true;
      }
      if (terminal(entry.summary.state) && !this.running.has(id) && this.now() - Date.parse(entry.summary.updated_at) >= CHANGE_LIMITS.retention_ms) {
        this.entries.delete(id); changed = true;
      }
    }
    return changed;
  }
  async sweep(): Promise<void> { await this.serial(async () => { if (this.prune()) await this.persist(); }); }
  openSession(): string {
    this.available();
    if (this.sessions.size >= CHANGE_LIMITS.max_sessions) throw new ServerError('RESOURCE_LIMIT');
    const id = randomUUID(); this.sessions.set(id, {}); return id;
  }
  /** Trusted local adapter only. Never a model tool or browser approval parameter. */
  setNativeElicitor(session: string, elicit: NativeElicitor): void {
    const origin = this.sessions.get(session);
    if (!origin || this.closed) throw new ServerError('NOT_FOUND');
    origin.native = elicit;
  }
  closeSession(session: string): void {
    this.sessions.delete(session);
    for (const entry of this.entries.values()) if (entry.session === session) {
      if (['PENDING', 'APPROVED'].includes(entry.summary.state)) this.move(entry, 'CANCELLED');
      else if (entry.summary.state === 'EXECUTING') this.move(entry, 'UNKNOWN', 'DB_ERROR');
      this.nativeControllers.get(entry.summary.request_id)?.abort();
      this.running.get(entry.summary.request_id)?.controller.abort();
    }
    void this.serial(() => this.persist()).catch(() => {});
  }
  private find(id: unknown, session?: string): Entry {
    const entry = this.entries.get(requestId(id));
    if (!entry || (session !== undefined && (!this.sessions.has(session) || entry.session !== session))) throw new ServerError('NOT_FOUND');
    return entry;
  }
  private summary(entry: Entry): ChangeSummary & { effect_note?: string } {
    const note = effectNote(entry.summary.state);
    return { ...structuredClone(entry.summary), ...(note ? { effect_note: note } : {}) };
  }
  async create(session: string, value: unknown, signal?: AbortSignal): Promise<unknown> {
    const input = parseChangeInput(value);
    let policy;
    try { policy = evaluateSql(input.sql, input.database, 'change'); }
    catch (error) { throw error instanceof SqlPolicyError ? new ServerError(error.code as 'SQL_NOT_ALLOWED' | 'TARGET_MISMATCH') : new ServerError('SQL_NOT_ALLOWED'); }
    if (!policy.requires_approval || policy.risk_level === 'L0') throw new ServerError('SQL_NOT_ALLOWED');
    const entry = await this.serial(async () => {
      this.available(); if (!this.sessions.has(session)) throw new ServerError('NOT_FOUND');
      if (this.prune()) await this.persist();
      const sqlBytes = [...this.entries.values()].reduce((sum, item) => sum + Buffer.byteLength(item.sql ?? '') + Buffer.byteLength(item.reason ?? ''), 0);
      if (this.entries.size >= CHANGE_LIMITS.max_requests || sqlBytes + Buffer.byteLength(input.sql) + Buffer.byteLength(input.reason ?? '') > CHANGE_LIMITS.max_sql_bytes) throw new ServerError('RESOURCE_LIMIT');
      const connection = await this.options.connections.get(input.connection_id);
      if (this.closed || !this.sessions.has(session) || signal?.aborted) throw new ServerError('STATE_CONFLICT');
      const channel: ConfirmationChannel = policy.risk_level === 'L1' && this.sessions.get(session)?.native ? 'native' : 'web';
      const entry: Entry = { session, sql: input.sql, ...(input.reason ? { reason: input.reason } : {}),
        ...(channel === 'web' ? { nonce: secret() } : { native: secret() }), summary: {
          request_id: randomUUID(), connection_id: input.connection_id, connection_version: connection.version, database: input.database,
          operation: policy.operation, risk_level: policy.risk_level, risk_codes: [...policy.risk_codes],
          sql_fingerprint: policy.sql_fingerprint, exact_sql_digest: policy.exact_sql_digest, confirmation_channel: channel,
          state: 'PENDING', created_at: this.iso(), updated_at: this.iso(), expires_at: new Date(this.now() + CHANGE_LIMITS.approval_ttl_ms).toISOString()
        } };
      this.entries.set(entry.summary.request_id, entry);
      try { await this.persist(); } catch (error) { this.move(entry, 'INVALIDATED'); throw error; }
      if (signal?.aborted && entry.summary.state === 'PENDING') { this.move(entry, 'CANCELLED'); await this.persist(); }
      return entry;
    });
    if (entry.summary.confirmation_channel === 'native' && entry.summary.state === 'PENDING') await this.nativeDecision(entry, signal);
    const url = this.options.managementUrl?.();
    return { request_id: entry.summary.request_id, state: entry.summary.state, confirmation_channel: entry.summary.confirmation_channel,
      ...(entry.summary.confirmation_channel === 'web' && url ? { management_url: `${url}/changes?id=${entry.summary.request_id}` } : {}),
      risk_codes: [...entry.summary.risk_codes], expires_at: entry.summary.expires_at };
  }
  async status(session: string, id: unknown): Promise<unknown> {
    return this.serial(async () => { if (this.prune()) await this.persist(); return this.summary(this.find(id, session)); });
  }
  async list(): Promise<unknown> {
    return this.serial(async () => { if (this.prune()) await this.persist(); return { items: [...this.entries.values()].map(entry => this.summary(entry)), next_cursor: null }; });
  }
  async detail(id: unknown, browser: string): Promise<unknown> {
    return this.serial(async () => {
      if (this.prune()) await this.persist(); const entry = this.find(id);
      if (entry.summary.confirmation_channel === 'web' && ['PENDING', 'APPROVED'].includes(entry.summary.state)) {
        if (!entry.nonce || entry.browser !== browser) entry.nonce = secret();
        entry.browser = browser;
      }
      return { ...this.summary(entry), ...(entry.sql ? { sql: entry.sql } : {}), ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.nonce && entry.browser === browser ? { approval_nonce: entry.nonce } : {}) };
    });
  }
  async decide(id: unknown, value: unknown, browser: string): Promise<unknown> {
    const input = parseWebDecision(value);
    const entry = await this.serial(async () => {
      this.available(); if (this.prune()) await this.persist(); const entry = this.find(id);
      this.pending(entry, input.decision);
      if (entry.summary.confirmation_channel !== 'web' || entry.browser !== browser || !entry.nonce || !equal(input.approval_nonce, entry.nonce)) throw new ServerError('STATE_CONFLICT');
      delete entry.nonce; delete entry.browser; // Consume before ANY later validation/await.
      if (input.sql_fingerprint !== entry.summary.sql_fingerprint) {
        this.move(entry, 'INVALIDATED'); await this.persist(); throw new ServerError('STATE_CONFLICT');
      }
      await this.version(entry, input.connection_version);
      this.move(entry, input.decision === 'approve' ? 'APPROVED' : input.decision === 'reject' ? 'REJECTED' : 'CANCELLED');
      try { await this.persist(); } catch (error) { if (entry.summary.state === 'APPROVED') this.move(entry, 'FAILED', 'SERVICE_UNAVAILABLE'); throw error; }
      return entry;
    });
    if (entry.summary.state === 'APPROVED') await this.execute(entry);
    return this.summary(entry);
  }
  private pending(entry: Entry, decision: Decision): void {
    if (entry.summary.state === 'EXPIRED') throw new ServerError('APPROVAL_EXPIRED');
    if (entry.summary.state === 'INVALIDATED') throw new ServerError('CONNECTION_CHANGED');
    if (entry.summary.state !== 'PENDING' && !(decision === 'cancel' && entry.summary.state === 'APPROVED')) throw new ServerError('STATE_CONFLICT');
  }
  private async version(entry: Entry, supplied = entry.summary.connection_version): Promise<void> {
    let actual: ConnectionView | undefined;
    try { actual = await this.options.connections.get(entry.summary.connection_id); }
    catch (error) { if (!(error instanceof ServerError && error.code === 'NOT_FOUND')) throw error; }
    if (!actual || actual.version !== entry.summary.connection_version || supplied !== entry.summary.connection_version) {
      if (['PENDING', 'APPROVED'].includes(entry.summary.state)) this.move(entry, 'INVALIDATED', 'CONNECTION_CHANGED');
      await this.persist(); throw new ServerError('CONNECTION_CHANGED');
    }
    if (this.prune()) await this.persist();
    this.pending(entry, 'cancel'); // Recheck after the asynchronous connection queue.
  }
  private async nativeDecision(entry: Entry, external?: AbortSignal): Promise<void> {
    const challenge = entry.native!; const controller = new AbortController();
    const abort = (): void => {
      controller.abort();
      if (external?.aborted && ['PENDING', 'APPROVED'].includes(entry.summary.state)) {
        this.move(entry, 'CANCELLED'); void this.serial(() => this.persist()).catch(() => {});
      } else if (external?.aborted && entry.summary.state === 'EXECUTING') {
        this.move(entry, 'UNKNOWN', 'EXECUTION_TIMEOUT'); void this.serial(() => this.persist()).catch(() => {});
      }
    };
    external?.addEventListener('abort', abort, { once: true });
    this.nativeControllers.set(entry.summary.request_id, controller);
    const timer = setTimeout(abort, Math.max(1, Date.parse(entry.summary.expires_at) - this.now()));
    if (external?.aborted) abort();
    try {
      const elicit = this.sessions.get(entry.session!)?.native;
      if (!elicit) throw new Error();
      const request = elicit({ mode: 'form', message: `Review this exact change. Connection ${entry.summary.connection_id} version ${entry.summary.connection_version}; database ${entry.summary.database}; risk ${entry.summary.risk_level}.\nSQL:\n${entry.sql}\nReason: ${entry.reason ?? '(not provided)'}\nType the displayed review code to approve: ${challenge}`,
        requestedSchema: { type: 'object', properties: { review_code: { type: 'string' } }, required: ['review_code'] } }, controller.signal);
      let cancelled: (() => void) | undefined;
      const stopped = new Promise<never>((_, reject) => {
        cancelled = () => reject(new ServerError('EXECUTION_TIMEOUT'));
        if (controller.signal.aborted) cancelled(); else controller.signal.addEventListener('abort', cancelled, { once: true });
      });
      let response;
      try { response = await Promise.race([request, stopped]); }
      finally { if (cancelled) controller.signal.removeEventListener('abort', cancelled); }
      await this.serial(async () => {
        this.available(); if (this.prune()) await this.persist(); this.pending(entry, 'approve');
        if (entry.native !== challenge || controller.signal.aborted || entry.summary.confirmation_channel !== 'native') throw new ServerError('STATE_CONFLICT');
        delete entry.native;
        if (response.action === 'decline' || response.action === 'cancel') {
          this.move(entry, response.action === 'decline' ? 'REJECTED' : 'CANCELLED'); await this.persist(); return;
        }
        if (response.action !== 'accept' || response.content?.['review_code'] !== challenge || Object.keys(response.content).length !== 1) {
          this.move(entry, 'CANCELLED'); await this.persist(); return;
        }
        await this.version(entry);
        if (controller.signal.aborted) { this.move(entry, 'CANCELLED'); await this.persist(); return; }
        this.move(entry, 'APPROVED');
        try { await this.persist(); } catch (error) { this.move(entry, 'FAILED', 'SERVICE_UNAVAILABLE'); throw error; }
      });
      clearTimeout(timer);
      if (entry.summary.state === 'APPROVED') await this.execute(entry);
    } catch {
      await this.serial(async () => {
        if (entry.summary.state !== 'PENDING' || entry.native !== challenge) return;
        delete entry.native; // Revoke before fallback: a late native response has no authority.
        if (external?.aborted || !this.sessions.has(entry.session!)) this.move(entry, 'CANCELLED');
        else if (this.now() >= Date.parse(entry.summary.expires_at)) this.move(entry, 'EXPIRED', 'APPROVAL_EXPIRED');
        else { entry.summary.confirmation_channel = 'web'; entry.summary.updated_at = this.iso(); entry.nonce = secret(); }
        await this.persist();
      });
    } finally {
      clearTimeout(timer); external?.removeEventListener('abort', abort); controller.abort();
      this.nativeControllers.delete(entry.summary.request_id);
    }
  }
  private async execute(entry: Entry): Promise<void> {
    if (this.running.has(entry.summary.request_id)) return;
    if (this.running.size >= CHANGE_LIMITS.max_concurrent) {
      await this.serial(async () => { if (entry.summary.state === 'APPROVED') { this.move(entry, 'FAILED', 'RESOURCE_LIMIT'); await this.persist(); } }); return;
    }
    const controller = new AbortController(); const start = performance.now(); let dispatched = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = async (error: unknown): Promise<void> => {
      await this.serial(async () => {
        if (!['APPROVED', 'EXECUTING'].includes(entry.summary.state)) return;
        const safe = error instanceof ServerError || error instanceof CredentialStoreError ? sanitizeError(error).body.error.code : writeError(error).code;
        const uncertain = dispatched && writeError(error).uncertain;
        this.move(entry, uncertain ? 'UNKNOWN' : 'FAILED', safe);
        await this.persist();
      });
    };
    const work = Promise.resolve().then(async () => {
      try {
        const sql = entry.sql;
        if (this.closed || controller.signal.aborted || entry.summary.state !== 'APPROVED') return;
        if (!sql || !this.healthy) throw new ServerError('SERVICE_UNAVAILABLE');
        const policy = evaluateSql(sql, entry.summary.database, 'change');
        if (policy.exact_sql_digest !== entry.summary.exact_sql_digest || policy.sql_fingerprint !== entry.summary.sql_fingerprint || !policy.requires_approval) throw new ServerError('SQL_NOT_ALLOWED');
        await this.options.connections.withChangeConnection(entry.summary.connection_id, entry.summary.connection_version, controller.signal, async draft => {
          const session = await this.factory(draft, databaseDdl(sql, entry.summary.database) ? null : entry.summary.database, controller.signal);
          try {
            if (controller.signal.aborted) throw new ServerError('EXECUTION_TIMEOUT');
            await session.preflight?.(sql, entry.summary.database);
            const allowed = await this.serial(async () => {
              if (this.prune()) await this.persist();
              if (!this.healthy || this.closed || controller.signal.aborted || entry.summary.state !== 'APPROVED' || !this.sessions.has(entry.session!)) return false;
              this.move(entry, 'EXECUTING');
              try { await this.persist(); }
              catch (error) { this.move(entry, 'FAILED', 'SERVICE_UNAVAILABLE'); throw error; }
              if ((entry.summary.state as ChangeState) === 'EXECUTING' && this.now() >= Date.parse(entry.summary.expires_at)) {
                this.move(entry, 'FAILED', 'APPROVAL_EXPIRED'); await this.persist(); return false;
              }
              return !controller.signal.aborted && (entry.summary.state as ChangeState) === 'EXECUTING';
            });
            if (!allowed) return;
            dispatched = true;
            const result = writeResult(await session.execute(sql));
            await this.serial(async () => {
              if (entry.summary.state !== 'EXECUTING') return;
              // Commit the receipt before exposing success. Never make a receipt visible before the durable write.
              const receipt = { ...entry.summary, state: 'SUCCEEDED' as const, updated_at: this.iso(),
                result: { ...result, execution_ms: Math.min(this.timeoutMs, Math.max(0, Math.round(performance.now() - start))) } };
              try {
                await this.persist(receipt);
                if ((entry.summary.state as ChangeState) === 'EXECUTING' && !controller.signal.aborted) {
                  this.move(entry, 'SUCCEEDED'); entry.summary.result = receipt.result;
                } else {
                  if ((entry.summary.state as ChangeState) === 'EXECUTING') this.move(entry, 'UNKNOWN', 'EXECUTION_TIMEOUT');
                  await this.persist(); // Interruption while the receipt write was in flight wins conservatively.
                }
              } catch (error) {
                if ((entry.summary.state as ChangeState) === 'EXECUTING') this.move(entry, 'UNKNOWN', 'SERVICE_UNAVAILABLE');
                throw error;
              }
            });
          } finally { await session.close(); }
        });
      } catch (error) { await fail(error).catch(() => {}); }
      finally { clearTimeout(timer); controller.abort(); this.running.delete(entry.summary.request_id); }
    });
    this.running.set(entry.summary.request_id, { controller, task: work });
    const stopped = new Promise<void>(resolve => {
      timer = setTimeout(() => {
        controller.abort();
        void fail(new ServerError('EXECUTION_TIMEOUT')).catch(() => {}).finally(resolve);
      }, this.timeoutMs);
    });
    // Time out the HTTP wait, not the unique dispatch lock. Uncooperative dependencies stay occupied until they settle.
    await Promise.race([work, stopped]);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer); this.unsubscribe?.();
    for (const session of [...this.sessions.keys()]) this.closeSession(session);
    await this.tail;
    await this.options.storage.close?.();
  }
}
