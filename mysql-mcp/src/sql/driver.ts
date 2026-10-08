import type { Connection, FieldPacket } from 'mysql2';
import type { ConnectionDraft } from '../server/connections.js';
import { databaseError, ReadError } from './read-errors.js';
import { READ_LIMITS, type ReadRows } from './results.js';

export interface ReadSession {
  query(sql: string, values?: readonly string[]): Promise<ReadRows>;
  close(): Promise<void>;
}
export type ReadSessionFactory = (draft: Readonly<ConnectionDraft>, database: string | null, signal: AbortSignal) => Promise<ReadSession>;

// mysql2.destroy() does not reliably settle pending callbacks. Cancel explicitly.
export function callbackOperation(connection: Connection, signal: AbortSignal, dispatch: (done: (error?: unknown) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => { signal.removeEventListener('abort', abort); connection.off('error', done); };
    const abort = (): void => { cleanup(); reject(new ReadError('EXECUTION_TIMEOUT')); };
    const done = (error?: unknown): void => {
      cleanup();
      if (error) reject(databaseError(error)); else resolve();
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    connection.once('error', done);
    try { dispatch(done); } catch (error) { done(error); }
  });
}
/** A new, never pooled session for every request. Remote TLS policy is not yet frozen. */
export const mysqlReadSession: ReadSessionFactory = async (draft, database, signal) => {
  if (!['127.0.0.1', 'localhost', '::1'].includes(draft.host)) throw new ReadError('SERVICE_UNAVAILABLE');
  if (signal.aborted) throw new ReadError('EXECUTION_TIMEOUT');
  const { default: mysql } = await import('mysql2');
  if (signal.aborted) throw new ReadError('EXECUTION_TIMEOUT');
  const connection = mysql.createConnection({ host: draft.host, port: draft.port, user: draft.username,
    password: draft.password, ...(database === null ? {} : { database }),
    multipleStatements: false, rowsAsArray: true, supportBigNumbers: true, bigNumberStrings: true,
    decimalNumbers: false, dateStrings: true, jsonStrings: true, connectTimeout: READ_LIMITS.timeout_ms,
    flags: ['-LOCAL_FILES'] });
  // Never print native errors. All sessions are destroyed, not returned to a pool.
  connection.on('error', () => {});
  const abort = (): void => { connection.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  const close = async (): Promise<void> => {
    signal.removeEventListener('abort', abort);
    connection.destroy();
  };
  try {
    await callbackOperation(connection, signal, done => connection.connect(done));
    await callbackOperation(connection, signal, done => connection.query(`SET SESSION MAX_EXECUTION_TIME = ${READ_LIMITS.timeout_ms}`, done));
    await callbackOperation(connection, signal, done => connection.query('START TRANSACTION READ ONLY', done));
    return { query: (sql, values) => streamQuery(connection, sql, values, signal), close };
  } catch (error) {
    await close();
    throw signal.aborted ? new ReadError('EXECUTION_TIMEOUT') : error;
  }
};

/** Only fixed server metadata templates use placeholders; never escape user SQL. */
export function metadataStatement(sql: string, values: readonly string[] = []): string {
  let index = 0;
  const statement = sql.replace(/\?/g, () => {
    const value = values[index++];
    if (typeof value !== 'string') throw new ReadError('INTERNAL_ERROR');
    return `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
  });
  if (index !== values.length) throw new ReadError('INTERNAL_ERROR');
  return statement;
}
export function driverColumns(fields: readonly FieldPacket[]): ReadRows['columns'] {
  return fields.map(field => ({ name: field.name, mysql_type: String(field.columnType),
    encoding: field.characterSet === 63 && [15, 16, 249, 250, 251, 252, 253, 254].includes(field.columnType ?? -1) ? 'base64' : 'text' }));
}
export function streamQuery(connection: Connection, sql: string, values: readonly string[] | undefined, signal: AbortSignal): Promise<ReadRows> {
  if (signal.aborted) return Promise.reject(new ReadError('EXECUTION_TIMEOUT'));
  return new Promise((resolve, reject) => {
    const query = connection.query({ sql: values?.length ? metadataStatement(sql, values) : sql, rowsAsArray: true });
    const stream = query.stream({ highWaterMark: 1 });
    let fieldsSeen = false;
    const cleanup = (): void => { signal.removeEventListener('abort', abort); connection.off('error', disconnected); };
    const abort = (): void => {
      cleanup();
      const error = new ReadError('EXECUTION_TIMEOUT');
      reject(error); stream.destroy(error);
    };
    const disconnected = (native: unknown): void => {
      cleanup();
      const error = databaseError(native);
      reject(error); stream.destroy(error);
    };
    signal.addEventListener('abort', abort, { once: true });
    connection.once('error', disconnected);
    stream.on('error', error => {
      if (!fieldsSeen) { cleanup(); reject(databaseError(error)); }
    });
    query.once('fields', (fields: FieldPacket[]) => {
      fieldsSeen = true;
      resolve({
        columns: driverColumns(fields),
        rows: (async function* () {
          try {
            for await (const row of stream) {
              if (signal.aborted) throw new ReadError('EXECUTION_TIMEOUT');
              yield row as unknown[];
            }
          } catch (error) { throw signal.aborted ? new ReadError('EXECUTION_TIMEOUT') : databaseError(error); }
          finally { cleanup(); stream.destroy(); }
        })()
      });
    });
    query.once('end', () => {
      if (!fieldsSeen) { cleanup(); reject(new ReadError('DB_ERROR')); }
    });
  });
}
