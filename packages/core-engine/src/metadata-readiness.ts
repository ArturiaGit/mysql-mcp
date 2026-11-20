import type { MetadataQueryExecutor, MetadataRow } from './metadata-pool.js';

interface BootstrapRow extends MetadataRow {
  setting_value: unknown;
}

/** M0 checks the real metadata table, not merely an open TCP port; PENDING allows first bootstrap. */
export function createMetadataReadinessCheck(executor: MetadataQueryExecutor): () => Promise<boolean> {
  let pending: Promise<boolean> | undefined;
  return () => pending ??= (async () => {
    try {
      const [rows] = await executor.query<BootstrapRow[]>(
        'SELECT setting_value FROM sys_system_settings WHERE setting_key = ?', ['bootstrap_state'],
      );
      return rows.length === 1 && (rows[0]?.setting_value === 'PENDING' || rows[0]?.setting_value === 'READY');
    } catch {
      return false;
    }
  })().finally(() => { pending = undefined; });
}
