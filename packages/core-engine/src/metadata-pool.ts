import mysql, { type FieldPacket, type Pool, type PoolConnection, type QueryResult, type RowDataPacket } from 'mysql2/promise';

export interface MetadataDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
}

export type MetadataParameter = string | number | boolean | Date | Buffer | null;
export type MetadataRow = RowDataPacket;

/** Deliberately excludes Pool.query, Pool.execute, and raw driver access. */
export interface MetadataPool {
  close(): Promise<void>;
}

export interface MetadataQueryExecutor {
  /** SQL must be authored by the caller; untrusted values go in placeholders only. */
  query<T extends QueryResult = RowDataPacket[]>(
    sql: string, values?: readonly MetadataParameter[],
  ): Promise<[T, FieldPacket[]]>;
}

const drivers = new WeakMap<MetadataPool, Pool>();
const queryTimeout = 2_000;

export function createMetadataPool(config: MetadataDbConfig): MetadataPool {
  const driver = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit ?? 20,
    waitForConnections: true,
    queueLimit: 200,
    connectTimeout: queryTimeout,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
  });
  let closing: Promise<void> | undefined;
  const pool: MetadataPool = Object.freeze({ close: () => closing ??= driver.end() });
  drivers.set(pool, driver);
  return pool;
}

async function acquireMetadataConnection(driver: Pool): Promise<PoolConnection> {
  const connection = await driver.getConnection();
  try {
    await connection.query({ sql: "SET SESSION time_zone = '+00:00'", timeout: queryTimeout });
    return connection;
  } catch (error) {
    connection.destroy();
    throw error;
  }
}

export function createMetadataQueryExecutor(pool: MetadataPool): MetadataQueryExecutor {
  const driver = drivers.get(pool);
  if (!driver) throw new TypeError('Expected a MetadataPool created by createMetadataPool');

  return Object.freeze({
    async query<T extends QueryResult = RowDataPacket[]>(sql: string, values: readonly MetadataParameter[] = []) {
      const connection = await acquireMetadataConnection(driver);
      let reusable = true;
      try {
        return await connection.execute<T>({ sql, timeout: queryTimeout }, [...values]);
      } catch (error) {
        // A timed-out command may still be running on the server; never return its connection to the pool.
        if (error instanceof Error && 'code' in error && error.code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
          reusable = false;
          connection.destroy();
        }
        throw error;
      } finally {
        if (reusable) connection.release();
      }
    },
  });
}
