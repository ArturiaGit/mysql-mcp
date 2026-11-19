import type { MetadataDbConfig } from './metadata-pool.js';

export function readPort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid port configuration');
  }
  return port;
}

export function readMetadataConfig(env: NodeJS.ProcessEnv): MetadataDbConfig | undefined {
  const user = env.METADATA_DB_USER;
  const password = env.METADATA_DB_PASSWORD;
  if (user === undefined && password === undefined) return undefined;
  if (!user || !password) throw new Error('METADATA_DB_USER and METADATA_DB_PASSWORD are both required');
  return {
    user,
    password,
    host: env.METADATA_DB_HOST ?? '127.0.0.1',
    port: readPort(env.METADATA_DB_PORT, 3306),
    database: env.METADATA_DB_NAME ?? 'mysql_mcp_metadata',
  };
}
