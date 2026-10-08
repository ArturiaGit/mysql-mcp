import { randomUUID } from 'node:crypto';
import { open, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { WindowsKeyringProvider, CredentialStoreError, type ICredentialProvider } from '../security/keyring.js';
import { ServerError } from './errors.js';

export interface ConnectionView {
  id: string; name: string; host: string; port: number; username: string;
  default_database: string | null; version: number;
}
interface ConnectionRecord extends ConnectionView { credential_ref: string }
interface StoreData { schema_version: 1; items: ConnectionRecord[]; cleanup_refs: string[] }
export interface MetadataStorage {
  read(): Promise<unknown | null>;
  write(data: unknown): Promise<void>;
  close?(): Promise<void>;
}
const MAX_CONNECTIONS = 256;
const MAX_STORE_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Single writer lease; stale leases fail closed rather than guessing process liveness.
export class JsonMetadataStorage implements MetadataStorage {
  private lease: Awaited<ReturnType<typeof open>> | undefined;
  private closed = false;
  constructor(private readonly file: string) {}
  private async acquire(): Promise<void> {
    if (this.closed) throw new ServerError('SERVICE_UNAVAILABLE');
    if (this.lease) return;
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    this.lease = await open(`${this.file}.lock`, 'wx', 0o600);
  }
  async read(): Promise<unknown | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await this.acquire();
      try { handle = await open(this.file, 'r'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_STORE_BYTES) throw new Error('Invalid store');
      return JSON.parse(await handle.readFile('utf8')) as unknown;
    } catch { throw new ServerError('SERVICE_UNAVAILABLE'); }
    finally { await handle?.close(); }
  }
  async write(data: unknown): Promise<void> {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await this.acquire();
      const bytes = JSON.stringify(data);
      if (Buffer.byteLength(bytes) > MAX_STORE_BYTES) throw new Error('Store limit');
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes, 'utf8');
      await handle.sync();
      await handle.close(); handle = undefined;
      // No fallible work after rename: a rejected write means old metadata survives.
      await rename(temporary, this.file);
    } catch { throw new ServerError('SERVICE_UNAVAILABLE'); }
    finally { await handle?.close().catch(() => {}); await rm(temporary, { force: true }).catch(() => {}); }
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.lease) {
      await this.lease.close(); this.lease = undefined;
      await rm(`${this.file}.lock`, { force: true });
    }
  }
}

export function objectBody(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServerError('INVALID_ARGUMENT');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(body, key))) {
    throw new ServerError('INVALID_ARGUMENT');
  }
  return body;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value) ||
      Buffer.from(value, 'utf8').toString('utf8') !== value) throw new ServerError('INVALID_ARGUMENT');
  return value;
}
const fields = ['name', 'host', 'port', 'username', 'default_database', 'password'] as const;
export interface ConnectionDraft {
  name: string; host: string; port: number; username: string; default_database: string | null; password: string;
}
function connectionFields(body: Record<string, unknown>): Omit<ConnectionView, 'id' | 'version'> {
  const name = text(body['name'], 128);
  const host = text(body['host'], 253);
  if (!/^[A-Za-z0-9._:-]+$/.test(host)) throw new ServerError('INVALID_ARGUMENT');
  const port = body['port'];
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) throw new ServerError('INVALID_ARGUMENT');
  const username = text(body['username'], 128);
  const db = body['default_database'];
  const default_database = db === null || db === '' || db === undefined ? null : text(db, 128);
  return { name, host, port, username, default_database };
}
function password(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.includes('\0') || Buffer.byteLength(value) > 1024 ||
      Buffer.from(value, 'utf8').toString('utf8') !== value) throw new ServerError('INVALID_ARGUMENT');
  return value;
}
export function parseDraft(value: unknown): ConnectionDraft {
  const body = objectBody(value, fields, ['name', 'host', 'port', 'username', 'password']);
  return { ...connectionFields(body), password: password(body['password']) };
}
export function expectedVersion(value: unknown): number {
  const body = objectBody(value, ['expected_version'], ['expected_version']);
  const version = body['expected_version'];
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new ServerError('INVALID_ARGUMENT');
  return version;
}
function view(record: ConnectionRecord): ConnectionView {
  const { id, name, host, port, username, default_database, version } = record;
  return { id, name, host, port, username, default_database, version };
}
function parseStore(value: unknown): StoreData {
  if (value === null) return { schema_version: 1, items: [], cleanup_refs: [] };
  try {
    const body = objectBody(value, ['schema_version', 'items', 'cleanup_refs'], ['schema_version', 'items', 'cleanup_refs']);
    if (body['schema_version'] !== 1 || !Array.isArray(body['items']) || body['items'].length > MAX_CONNECTIONS ||
        !Array.isArray(body['cleanup_refs']) || body['cleanup_refs'].length > 512) throw new Error('Invalid store');
    const ids = new Set<string>(); const refs = new Set<string>();
    const items = body['items'].map((item: unknown): ConnectionRecord => {
      const r = objectBody(item, ['id', 'version', 'credential_ref', ...fields.filter(f => f !== 'password')],
        ['id', 'version', 'credential_ref', 'name', 'host', 'port', 'username', 'default_database']);
      const id = text(r['id'], 36); const ref = text(r['credential_ref'], 36);
      const version = expectedVersion({ expected_version: r['version'] });
      if (!UUID.test(id) || !UUID.test(ref) || ids.has(id) || refs.has(ref)) throw new Error('Invalid store');
      ids.add(id); refs.add(ref);
      return { ...connectionFields(r), id, credential_ref: ref, version };
    });
    const cleanup_refs = body['cleanup_refs'].map((ref: unknown) => {
      if (typeof ref !== 'string' || !UUID.test(ref) || refs.has(ref)) throw new Error('Invalid store');
      return ref;
    });
    if (new Set(cleanup_refs).size !== cleanup_refs.length) throw new Error('Invalid store');
    return { schema_version: 1, items, cleanup_refs };
  } catch { throw new ServerError('SERVICE_UNAVAILABLE'); }
}

export interface TestResult { connected: boolean; simulated: boolean; duration_ms: number }
export type ConnectionTester = (draft: Readonly<ConnectionDraft>, signal: AbortSignal) => Promise<{ connected: boolean; simulated: boolean }>;
// Phase 2-A intentionally does not open sockets or perform MySQL authentication.
export const simulatedConnectionTester: ConnectionTester = async () => ({ connected: false, simulated: true });

export class ConnectionService {
  private data: StoreData = { schema_version: 1, items: [], cleanup_refs: [] };
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private testing = 0;
  private closed = false;
  private readonly busy = new Set<string>();
  private readonly readers = new Map<string, number>();
  private readonly listeners = new Set<(id: string) => void>();
  subscribe(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  get(id: string): Promise<ConnectionView> { return this.serial(async () => view(this.find(id))); }
  constructor(private readonly storage: MetadataStorage,
    private readonly credentials: ICredentialProvider = new WindowsKeyringProvider(),
    private readonly tester: ConnectionTester = simulatedConnectionTester,
    private readonly timeoutMs = 5000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new ServerError('INVALID_ARGUMENT');
  }
  async initialize(): Promise<void> { this.data = parseStore(await this.storage.read()); }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new ServerError('SERVICE_UNAVAILABLE'));
    if (this.queued >= 64) return Promise.reject(new ServerError('RESOURCE_LIMIT'));
    this.queued++;
    const result = this.tail.then(action);
    this.tail = result.catch(() => {});
    return result.finally(() => { this.queued--; });
  }
  private find(id: string, version?: number): ConnectionRecord {
    if (!UUID.test(id)) throw new ServerError('INVALID_ARGUMENT');
    const item = this.data.items.find(record => record.id === id);
    if (!item) throw new ServerError('NOT_FOUND');
    if (version !== undefined && item.version !== version) throw new ServerError('STATE_CONFLICT');
    return item;
  }
  private async commit(data: StoreData): Promise<void> {
    await this.storage.write(data);
    const changed = this.data.items.filter(old => data.items.find(item => item.id === old.id)?.version !== old.version);
    this.data = data;
    for (const old of changed) for (const listener of this.listeners) {
      // Notifications are synchronous after commit; observers must not block metadata writes.
      try { listener(old.id); } catch { /* observer failure cannot undo a committed update */ }
    }
  }
  // Retain tombstones when native cleanup or follow-up persistence fails.
  private async cleanup(): Promise<void> {
    const remaining: string[] = [];
    for (const ref of this.data.cleanup_refs) {
      try { await this.credentials.deleteCredential(ref); } catch { remaining.push(ref); }
    }
    if (remaining.length !== this.data.cleanup_refs.length) {
      try { await this.commit({ ...this.data, cleanup_refs: remaining }); } catch { /* retry idempotently later */ }
    }
  }
  list(): Promise<ConnectionView[]> { return this.serial(async () => this.data.items.map(view)); }
  create(value: unknown): Promise<ConnectionView> {
    const draft = parseDraft(value);
    return this.serial(async () => {
      await this.cleanup();
      if (this.data.items.length >= MAX_CONNECTIONS || this.data.cleanup_refs.length >= 512) throw new ServerError('RESOURCE_LIMIT');
      const id = randomUUID();
      const { password: secret, ...metadata } = draft;
      const record = { ...metadata, id, credential_ref: id, version: 1 };
      // Durable intent precedes native writes, including compensation double faults.
      await this.commit({ ...this.data, cleanup_refs: [...this.data.cleanup_refs, id] });
      try {
        await this.credentials.setCredential(id, secret);
        await this.commit({ ...this.data, items: [...this.data.items, record],
          cleanup_refs: this.data.cleanup_refs.filter(ref => ref !== id) });
      } catch (error) { await this.cleanup(); throw error; }
      return view(record);
    });
  }
  update(id: string, value: unknown): Promise<ConnectionView> {
    const body = objectBody(value, ['expected_version', ...fields], ['expected_version']);
    const version = expectedVersion({ expected_version: body['expected_version'] });
    if (Object.keys(body).length < 2) throw new ServerError('INVALID_ARGUMENT');
    const secret = body['password'] === undefined || body['password'] === '' ? undefined : password(body['password']);
    return this.serial(async () => {
      const old = this.find(id, version);
      if (this.busy.has(id) || this.readers.has(id) || old.version >= Number.MAX_SAFE_INTEGER) throw new ServerError('STATE_CONFLICT');
      const record: ConnectionRecord = { ...old, ...connectionFields({ ...old, ...body }), version: old.version + 1 };
      await this.cleanup();
      if (secret !== undefined) {
        if (this.data.cleanup_refs.length >= 512) throw new ServerError('RESOURCE_LIMIT');
        record.credential_ref = randomUUID();
        await this.commit({ ...this.data, cleanup_refs: [...this.data.cleanup_refs, record.credential_ref] });
      }
      try {
        if (secret !== undefined) await this.credentials.setCredential(record.credential_ref, secret);
        const cleanup_refs = secret === undefined ? this.data.cleanup_refs :
          [...this.data.cleanup_refs.filter(ref => ref !== record.credential_ref), old.credential_ref];
        await this.commit({ ...this.data, items: this.data.items.map(r => r.id === id ? record : r), cleanup_refs });
      } catch (error) {
        await this.cleanup();
        throw error;
      }
      await this.cleanup();
      return view(record);
    });
  }
  remove(id: string, value: unknown): Promise<{ id: string; deleted: true }> {
    const version = expectedVersion(value);
    return this.serial(async () => {
      const record = this.find(id, version);
      if (this.busy.has(id) || this.readers.has(id)) throw new ServerError('STATE_CONFLICT');
      await this.cleanup();
      if (this.data.cleanup_refs.length >= 512) throw new ServerError('RESOURCE_LIMIT');
      await this.commit({ ...this.data, items: this.data.items.filter(r => r.id !== id),
        cleanup_refs: [...this.data.cleanup_refs, record.credential_ref] });
      await this.cleanup();
      return { id, deleted: true };
    });
  }
  private async runTest(load: () => Promise<ConnectionDraft>, settled: () => void = () => {}): Promise<TestResult> {
    if (this.closed || this.testing >= 4) {
      settled();
      throw new ServerError(this.closed ? 'SERVICE_UNAVAILABLE' : 'RESOURCE_LIMIT');
    }
    this.testing++;
    const start = performance.now(); const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task = Promise.resolve().then(load).then(draft => {
      // A late credential read must not dispatch a test after timeout.
      if (abort.signal.aborted) throw new ServerError('EXECUTION_TIMEOUT');
      return this.tester(Object.freeze(draft), abort.signal);
    }).finally(() => { this.testing--; settled(); });
    try {
      const result = await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { abort.abort(); reject(new ServerError('EXECUTION_TIMEOUT')); }, this.timeoutMs);
        })
      ]);
      if (typeof result.connected !== 'boolean' || typeof result.simulated !== 'boolean') throw new ServerError('INTERNAL_ERROR');
      return { connected: result.connected, simulated: result.simulated, duration_ms: Math.max(0, Math.round(performance.now() - start)) };
    } finally { clearTimeout(timer); abort.abort(); }
  }
  testDraft(value: unknown): Promise<TestResult> {
    const draft = parseDraft(value);
    return this.runTest(async () => draft);
  }
  async testSaved(id: string, value: unknown): Promise<TestResult> {
    const version = expectedVersion(value);
    const record = await this.serial(async () => {
      const found = this.find(id, version);
      if (this.busy.has(id) || this.readers.has(id)) throw new ServerError('STATE_CONFLICT');
      this.busy.add(id);
      return { ...found };
    });
    // Native reads happen outside the metadata queue, within the same test budget.
    return this.runTest(async () => {
      const secret = await this.credentials.getCredential(record.credential_ref);
      if (secret === null) throw new CredentialStoreError();
      const { id: _id, version: _version, ...metadata } = view(record);
      return { ...metadata, password: secret };
    }, () => { this.busy.delete(id); });
  }
  /** Read leases share immutable metadata, never a database session or current database. */
  async withReadConnection<T>(id: string, signal: AbortSignal,
    action: (draft: Readonly<ConnectionDraft>) => Promise<T>): Promise<T> {
    const record = await this.serial(async () => {
      const found = this.find(id);
      if (signal.aborted) throw new ServerError('EXECUTION_TIMEOUT');
      if (this.busy.has(id)) throw new ServerError('STATE_CONFLICT');
      this.readers.set(id, (this.readers.get(id) ?? 0) + 1);
      return { ...found };
    });
    try {
      const secret = await this.credentials.getCredential(record.credential_ref);
      if (signal.aborted) throw new ServerError('EXECUTION_TIMEOUT');
      if (secret === null) throw new CredentialStoreError();
      const { id: _id, version: _version, ...metadata } = view(record);
      return await action(Object.freeze({ ...metadata, password: secret }));
    } finally {
      const count = (this.readers.get(id) ?? 1) - 1;
      if (count === 0) this.readers.delete(id); else this.readers.set(id, count);
    }
  }
  /** Exclusive write lease binds the exact version and outlives ambiguous timeouts. */
  async withChangeConnection<T>(id: string, version: number, signal: AbortSignal,
    action: (draft: Readonly<ConnectionDraft>) => Promise<T>): Promise<T> {
    const record = await this.serial(async () => {
      const found = this.find(id);
      if (found.version !== version) throw new ServerError('CONNECTION_CHANGED');
      if (signal.aborted) throw new ServerError('EXECUTION_TIMEOUT');
      if (this.busy.has(id) || this.readers.has(id)) throw new ServerError('STATE_CONFLICT');
      this.busy.add(id);
      return { ...found };
    });
    try {
      const secret = await this.credentials.getCredential(record.credential_ref);
      if (signal.aborted) throw new ServerError('EXECUTION_TIMEOUT');
      if (secret === null) throw new CredentialStoreError();
      const { id: _id, version: _version, ...metadata } = view(record);
      return await action(Object.freeze({ ...metadata, password: secret }));
    } finally { this.busy.delete(id); }
  }
  async close(): Promise<void> { this.closed = true; await this.tail; await this.storage.close?.(); }
}
