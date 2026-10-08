import type { Connection, ResultSetHeader } from 'mysql2';
import type { ConnectionDraft } from '../server/connections.js';
import { ServerError, type ServerErrorCode } from '../server/errors.js';
import { CHANGE_LIMITS, type WriteResult } from '../changes/types.js';
import { writeResult } from '../changes/journal.js';
import { evaluateSql } from './policy.js';
import { inspectSql, isNode, parseSql } from './ast.js';
import { metadataStatement } from './driver.js';

export interface WriteSession {
  preflight?(sql: string, database: string): Promise<void>;
  execute(sql: string): Promise<WriteResult>;
  close(): Promise<void>;
}
export type WriteSessionFactory = (draft: Readonly<ConnectionDraft>, database: string | null, signal: AbortSignal) => Promise<WriteSession>;
export class WriteExecutionError extends Error {
  constructor(readonly code: ServerErrorCode, readonly uncertain: boolean) { super('Write execution failed.'); }
}
const accessCodes = new Set(['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR', 'ER_SPECIFIC_ACCESS_DENIED_ERROR']);
/** Only a MySQL server error packet proves failure; transport/unclassified errors are ambiguous after dispatch. */
export function writeError(error: unknown): WriteExecutionError {
  if (error instanceof WriteExecutionError) return error;
  const native = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  if (typeof native['errno'] === 'number' && Number.isInteger(native['errno']) && typeof native['sqlState'] === 'string' &&
      /^[A-Z0-9]{5}$/.test(native['sqlState']) && native['sqlState'] !== '08S01' &&
      typeof native['code'] === 'string' && native['code'].startsWith('ER_') && !native['fatal']) {
    return new WriteExecutionError(accessCodes.has(native['code']) ? 'DB_ACCESS_DENIED' : 'DB_ERROR', false);
  }
  return new WriteExecutionError('DB_ERROR', true);
}
/** Target kind is derived only after complete policy validation. Database DDL must not select a nonexistent/dropped default database. */
export function databaseDdl(sql: string, database: string): boolean {
  const policy = evaluateSql(sql, database, 'change');
  return ['CREATE', 'ALTER', 'DROP'].includes(policy.operation) && /^(CREATE|ALTER|DROP)\s+(DATABASE|SCHEMA)\b/i.test(inspectSql(sql).text);
}
export const mysqlWriteSession: WriteSessionFactory = async (draft, database, signal) => {
  if (!['127.0.0.1', 'localhost', '::1'].includes(draft.host)) throw new ServerError('SERVICE_UNAVAILABLE');
  if (signal.aborted) throw new ServerError('EXECUTION_TIMEOUT');
  const { default: mysql } = await import('mysql2');
  if (signal.aborted) throw new ServerError('EXECUTION_TIMEOUT');
  const connection = mysql.createConnection({ host: draft.host, port: draft.port, user: draft.username, password: draft.password,
    ...(database === null ? {} : { database }), multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true,
    decimalNumbers: false, dateStrings: true, connectTimeout: CHANGE_LIMITS.execution_timeout_ms, flags: ['-LOCAL_FILES'] });
  connection.on('error', () => {});
  const abort = (): void => { connection.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  const close = async (): Promise<void> => { signal.removeEventListener('abort', abort); connection.destroy(); };
  try {
    await initializeWriteSession(connection, signal);
    return {
      preflight: (sql, target) => preflight(connection, signal, sql, target),
      execute: async sql => {
        const result = await operation(connection, signal, done => connection.query(sql, (error, result) => done(error, result)));
        if (!isNode(result) || Array.isArray(result) || !('affectedRows' in result)) throw new WriteExecutionError('DB_ERROR', true);
        const header = result as unknown as ResultSetHeader;
        return writeResult({ affected_rows: header.affectedRows, last_insert_id: header.insertId, warning_count: header.warningStatus });
      }, close
    };
  } catch (error) { await close(); throw error; }
};
export function operation(connection: Connection, signal: AbortSignal,
  dispatch: (done: (error?: unknown, result?: unknown) => void) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => { signal.removeEventListener('abort', abort); connection.off('error', fail); };
    const done = (error?: unknown, result?: unknown): void => {
      if (settled) return; settled = true; cleanup();
      if (error) reject(writeError(error)); else resolve(result);
    };
    const fail = (error: unknown): void => done(error);
    const abort = (): void => { if (settled) return; settled = true; cleanup(); reject(new WriteExecutionError('EXECUTION_TIMEOUT', true)); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true }); connection.once('error', fail);
    try { dispatch(done); } catch (error) { done(error); }
  });
}
export async function initializeWriteSession(connection: Connection, signal: AbortSignal): Promise<void> {
  await operation(connection, signal, done => connection.connect(error => done(error)));
  // A fresh server may default autocommit to OFF; a success receipt must describe a completed single statement.
  await operation(connection, signal, done => connection.query('SET SESSION autocommit = 1', error => done(error)));
}
export async function preflight(connection: Connection, signal: AbortSignal, sql: string, database: string): Promise<void> {
  const decision = evaluateSql(sql, database, 'change');
  if (!decision.requires_approval) throw new ServerError('SQL_NOT_ALLOWED');
  if (databaseDdl(sql, database)) {
    if (decision.operation !== 'DROP') return;
    // Database deletion may include invisible views/triggers/foreign keys; do not pretend AST alone proves its scope.
    await visibleMetadata(connection, signal, database);
    const references = await metadataRows(connection, signal,
      'SELECT COUNT(*) AS n FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = ? AND TABLE_SCHEMA <> ?', [database, database]);
    if (references.length !== 1 || String(references[0]!['n']) !== '0') throw new ServerError('SQL_NOT_ALLOWED');
    return;
  }
  if (decision.operation === 'CREATE') return; // Static policy disallows LIKE/SELECT/foreign keys/options.
  const ast = parseSql(inspectSql(sql).text);
  const target = ast.type === 'drop' || ast.type === 'truncate' ? ast.name : ast.table;
  if (!Array.isArray(target) || target.length !== 1 || !isNode(target[0]) || typeof target[0].table !== 'string') throw new ServerError('SQL_NOT_ALLOWED');
  const table = target[0].table;
  await visibleMetadata(connection, signal, database);
  const names = new Set<string>([table]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!isNode(value)) return;
    if (Object.hasOwn(value, 'db') && typeof value.table === 'string' && value.type !== 'column_ref') names.add(value.table);
    for (const [key, child] of Object.entries(value)) if (key !== 'tableList' && key !== 'columnList') visit(child);
  };
  visit(ast);
  const check = (statement: string, values: string[]): Promise<Record<string, unknown>[]> => metadataRows(connection, signal, statement, values);
  for (const name of names) {
    const tables = await check('SELECT TABLE_TYPE AS kind FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 2', [database, name]);
    if (tables.some(row => row['kind'] !== 'BASE TABLE')) throw new ServerError('SQL_NOT_ALLOWED');
  }
  const triggers = await check('SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?', [database, table]);
  const references = await check('SELECT COUNT(*) AS n FROM information_schema.KEY_COLUMN_USAGE WHERE (TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL) OR (REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME = ?)', [database, table, database, table]);
  if (triggers.length !== 1 || references.length !== 1 || String(triggers[0]!['n']) !== '0' || String(references[0]!['n']) !== '0') throw new ServerError('SQL_NOT_ALLOWED');
}
async function metadataRows(connection: Connection, signal: AbortSignal, statement: string, values: string[]): Promise<Record<string, unknown>[]> {
  const rows = await operation(connection, signal, done => connection.query(metadataStatement(statement, values), (e, r) => done(e, r)));
  if (!Array.isArray(rows) || rows.length > 2 || rows.some(row => !isNode(row))) throw new ServerError('SQL_NOT_ALLOWED');
  return rows as Record<string, unknown>[];
}
async function visibleMetadata(connection: Connection, signal: AbortSignal, database: string): Promise<void> {
  // Fail closed unless direct grants establish visibility of ALL incoming FK metadata and triggers.
  // Roles/proxy grants are intentionally not inferred. Never grant privileges on the user's behalf.
  const rows = await operation(connection, signal, done => connection.query('SHOW GRANTS', (e, r) => done(e, r)));
  if (!Array.isArray(rows) || rows.length > 256) throw new ServerError('SQL_NOT_ALLOWED');
  let select = false; let triggers = false;
  for (const row of rows) {
    if (!isNode(row)) throw new ServerError('SQL_NOT_ALLOWED');
    for (const value of Object.values(row)) {
      if (typeof value !== 'string') throw new ServerError('SQL_NOT_ALLOWED');
      // Partial privilege revokes invalidate a superficially global grant.
      if (/^REVOKE\b/i.test(value)) throw new ServerError('SQL_NOT_ALLOWED');
      const grant = /^GRANT (.+?) ON (\*\.\*|`[A-Za-z_][A-Za-z0-9_]{0,63}`\.\*) TO /i.exec(value);
      if (!grant) continue;
      const privileges = grant[1]!.toUpperCase().split(',').map(part => part.trim());
      const all = privileges.includes('ALL PRIVILEGES');
      if (grant[2] === '*.*' && (all || privileges.includes('SELECT'))) select = true;
      if ((grant[2] === '*.*' || grant[2] === `\`${database}\`.*`) && (all || privileges.includes('TRIGGER'))) triggers = true;
    }
  }
  if (!select || !triggers) throw new ServerError('SQL_NOT_ALLOWED');
}
