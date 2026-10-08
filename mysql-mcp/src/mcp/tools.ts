import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ConnectionDraft, ConnectionView } from '../server/connections.js';
import { ReadError, readError } from '../sql/read-errors.js';
import { READ_LIMITS, collectRows, responseBytes, type QueryResult } from '../sql/results.js';
import { prepareReadonlySql } from '../sql/readonly.js';
import { mysqlReadSession, type ReadSession, type ReadSessionFactory } from '../sql/driver.js';

export interface ReadConnections {
  list(): Promise<ConnectionView[]>;
  withReadConnection<T>(id: string, signal: AbortSignal, action: (draft: Readonly<ConnectionDraft>) => Promise<T>): Promise<T>;
}
const connection = { type: 'string', minLength: 36, maxLength: 36, pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' };
const database = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' };
const table = { type: 'string', minLength: 1, maxLength: 64 };
const sql = { type: 'string', minLength: 1, maxLength: 65_536 };
const definitions = [
  ['list_connections', {}, []],
  ['list_databases', { connection_id: connection }, ['connection_id']],
  ['list_tables', { connection_id: connection, database }, ['connection_id', 'database']],
  ['describe_table', { connection_id: connection, database, table }, ['connection_id', 'database', 'table']],
  ['query', { connection_id: connection, database, sql }, ['connection_id', 'database', 'sql']]
] as const;
export function readTools(): Tool[] {
  return definitions.map(([name, properties, required]) => ({ name, description: `Restricted read: ${name}. Explicit targets only.`,
    inputSchema: { type: 'object', properties: structuredClone(properties), required: [...required], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }));
}
function argumentsFor(name: string, value: unknown): Record<string, string> {
  const definition = definitions.find(item => item[0] === name);
  if (!definition) throw new ReadError('INVALID_ARGUMENT');
  if (value === undefined && name === 'list_connections') value = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReadError('INVALID_ARGUMENT');
  const body = value as Record<string, unknown>;
  const props = definition[1] as Record<string, { minLength: number; maxLength: number; pattern?: string }>;
  if (Object.keys(body).some(key => !Object.hasOwn(props, key)) || definition[2].some(key => !Object.hasOwn(body, key))) throw new ReadError('INVALID_ARGUMENT');
  for (const [key, schema] of Object.entries(props)) {
    const v = body[key];
    if (typeof v !== 'string' || v.length < schema.minLength || v.length > schema.maxLength || !v.trim() ||
      Buffer.from(v, 'utf8').toString('utf8') !== v || (key !== 'sql' && /[\x00-\x1f\x7f]/.test(v)) ||
      (schema.pattern && !new RegExp(schema.pattern).test(v))) throw new ReadError('INVALID_ARGUMENT');
  }
  return body as Record<string, string>;
}
const safeText = (v: unknown): string => { if (typeof v !== 'string') throw new ReadError('DB_ERROR'); return v; };
const safeInteger = (v: unknown): number => {
  if ((typeof v !== 'string' && typeof v !== 'number') || !/^\d+$/.test(String(v)) || !Number.isSafeInteger(Number(v))) throw new ReadError('DB_ERROR');
  return Number(v);
};
async function metadata(session: ReadSession, query: string, values: readonly string[], signal: AbortSignal): Promise<QueryResult> {
  const result = await collectRows(await session.query(query, values), performance.now(), signal);
  if (result.truncated) throw new ReadError('RESOURCE_LIMIT');
  return result;
}

export class ReadToolService {
  private active = 0;
  private readonly controllers = new Set<AbortController>();
  private closed = false;
  constructor(private readonly connections?: ReadConnections,
    private readonly factory: ReadSessionFactory = mysqlReadSession, private readonly timeoutMs: number = READ_LIMITS.timeout_ms) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > READ_LIMITS.timeout_ms) throw new ReadError('INVALID_ARGUMENT');
  }
  close(): void { this.closed = true; for (const controller of this.controllers) controller.abort(); }
  async call(name: string, value: unknown, external?: AbortSignal): Promise<CallToolResult> {
    const response = (body: unknown, isError: boolean): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(body) }], isError });
    try {
      const args = argumentsFor(name, value);
      if (this.closed || !this.connections) throw new ReadError('SERVICE_UNAVAILABLE');
      if (this.active >= READ_LIMITS.max_concurrent) throw new ReadError('RESOURCE_LIMIT');
      // Static policy first: denied SQL cannot read credentials or open a socket.
      const prepared = name === 'query' ? prepareReadonlySql(args['sql']!, args['database']!) : undefined;
      const controller = new AbortController(); const signal = controller.signal;
      const cancel = (): void => controller.abort();
      external?.addEventListener('abort', cancel, { once: true });
      if (external?.aborted) controller.abort();
      this.active++; this.controllers.add(controller);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const task = Promise.resolve().then(async () => {
        if (signal.aborted) throw new ReadError('EXECUTION_TIMEOUT');
        if (name === 'list_connections') {
          const views = await this.connections!.list();
          if (views.length > 256) throw new ReadError('RESOURCE_LIMIT');
          return { items: views.map(({ id, name, host, port, username, default_database, version }) =>
            ({ id, name, host, port, username, default_database, version })), next_cursor: null };
        }
        return this.connections!.withReadConnection(args['connection_id']!, signal, async draft => {
          const session = await this.factory(draft, args['database'] ?? null, signal);
          try {
            if (signal.aborted) throw new ReadError('EXECUTION_TIMEOUT');
            if (name === 'query') return await collectRows(await session.query(prepared!), performance.now(), signal);
            if (name === 'list_databases') {
              const result = await metadata(session, 'SHOW DATABASES', [], signal);
              return { items: result.rows.map(row => safeText(row[0])), next_cursor: null };
            }
            if (name === 'list_tables') {
              const result = await metadata(session,
                'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME LIMIT 1001', [args['database']!], signal);
              return { items: result.rows.map(row => {
                const type = safeText(row[1]);
                if (!['BASE TABLE', 'VIEW'].includes(type)) throw new ReadError('DB_ERROR');
                return { name: safeText(row[0]), type: type === 'VIEW' ? 'view' : 'table' };
              }), next_cursor: null };
            }
            const values = [args['database']!, args['table']!];
            const columns = await metadata(session,
              'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, ORDINAL_POSITION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION LIMIT 1001', values, signal);
            if (columns.rows.length === 0) throw new ReadError('NOT_FOUND');
            const indexes = await metadata(session,
              'SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX LIMIT 1001', values, signal);
            return { columns: columns.rows.map(row => ({ name: safeText(row[0]), mysql_type: safeText(row[1]), nullable: row[2] === 'YES',
              primary_key: row[3] === 'PRI', ordinal_position: safeInteger(row[4]) })),
            indexes: indexes.rows.map(row => ({ name: safeText(row[0]), column: row[1] === null ? null : safeText(row[1]),
              unique: safeInteger(row[2]) === 0, sequence: safeInteger(row[3]) })) };
          } finally { await session.close(); }
        });
      }).finally(() => { this.active--; this.controllers.delete(controller); });
      // Keep the lease and concurrency occupied until actual work settles, even after timeout.
      try {
        const aborted = new Promise<never>((_, reject) => {
          const fail = (): void => reject(new ReadError('EXECUTION_TIMEOUT'));
          if (signal.aborted) fail(); else signal.addEventListener('abort', fail, { once: true });
          timer = setTimeout(cancel, this.timeoutMs);
        });
        const data = await Promise.race([task, aborted]);
        if (responseBytes(data) > READ_LIMITS.max_response_bytes) throw new ReadError('RESOURCE_LIMIT');
        return response({ ok: true, data }, false);
      } finally { clearTimeout(timer); external?.removeEventListener('abort', cancel); controller.abort(); }
    } catch (error) { return response({ ok: false, error: readError(error) }, true); }
  }
}
