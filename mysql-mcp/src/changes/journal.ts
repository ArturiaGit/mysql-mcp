import { objectBody, type MetadataStorage } from '../server/connections.js';
import { ServerError, sanitizeError } from '../server/errors.js';
import { CHANGE_LIMITS, CHANGE_STATES, UUID, HASH, type ChangeSummary, type WriteResult } from './types.js';

export type ChangeStorage = MetadataStorage;
export function writeResult(value: unknown): WriteResult {
  const body = objectBody(value, ['affected_rows', 'last_insert_id', 'warning_count'], ['affected_rows', 'last_insert_id', 'warning_count']);
  const integer = (v: unknown): v is number | string => typeof v === 'number' ? Number.isSafeInteger(v) && v >= 0 :
    typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18_446_744_073_709_551_615n;
  if (!integer(body['affected_rows']) || !integer(body['last_insert_id']) || typeof body['warning_count'] !== 'number' ||
      !Number.isSafeInteger(body['warning_count']) || body['warning_count'] < 0 || body['warning_count'] > 65535) throw new ServerError('DB_ERROR');
  return { affected_rows: body['affected_rows'], last_insert_id: body['last_insert_id'], warning_count: body['warning_count'] };
}
export function readJournal(raw: unknown): ChangeSummary[] {
  if (raw === null) return [];
  try {
    const body = objectBody(raw, ['schema_version', 'items'], ['schema_version', 'items']);
    if (body['schema_version'] !== 1 || !Array.isArray(body['items']) || body['items'].length > CHANGE_LIMITS.max_requests) throw new Error();
    const ids = new Set<string>();
    return body['items'].map((value: unknown) => {
      const required = ['request_id', 'connection_id', 'connection_version', 'database', 'operation', 'risk_level', 'risk_codes',
        'sql_fingerprint', 'exact_sql_digest', 'confirmation_channel', 'state', 'created_at', 'expires_at', 'updated_at'];
      const item = objectBody(value, [...required, 'result', 'error_code'], required);
      for (const key of ['request_id', 'connection_id']) if (typeof item[key] !== 'string' || !UUID.test(item[key] as string)) throw new Error();
      if (ids.has(item['request_id'] as string)) throw new Error();
      ids.add(item['request_id'] as string);
      if (typeof item['connection_version'] !== 'number' || !Number.isSafeInteger(item['connection_version']) || item['connection_version'] < 1 ||
          typeof item['database'] !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(item['database']) ||
          ['mysql', 'information_schema', 'sys', 'performance_schema'].includes(item['database'].toLowerCase()) ||
          !['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE'].includes(String(item['operation'])) ||
          !['L1', 'L2'].includes(String(item['risk_level'])) || !Array.isArray(item['risk_codes']) ||
          JSON.stringify(item['risk_codes']) !== (item['risk_level'] === 'L2' ? '["HIGH_RISK"]' : '[]') ||
          !['web', 'native'].includes(String(item['confirmation_channel'])) || !CHANGE_STATES.includes(item['state'] as never)) throw new Error();
      for (const key of ['sql_fingerprint', 'exact_sql_digest']) if (typeof item[key] !== 'string' || !HASH.test(item[key] as string)) throw new Error();
      for (const key of ['created_at', 'expires_at', 'updated_at']) {
        const v = item[key]; if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) throw new Error();
      }
      if (Date.parse(item['expires_at'] as string) - Date.parse(item['created_at'] as string) !== CHANGE_LIMITS.approval_ttl_ms) throw new Error();
      if (item['error_code'] !== undefined && (typeof item['error_code'] !== 'string' ||
          sanitizeError(new ServerError(item['error_code'] as never)).body.error.code !== item['error_code'])) throw new Error();
      if (item['result'] !== undefined) {
        const r = objectBody(item['result'], ['affected_rows', 'last_insert_id', 'warning_count', 'execution_ms'],
          ['affected_rows', 'last_insert_id', 'warning_count', 'execution_ms']);
        const { execution_ms, ...counts } = r;
        if (typeof execution_ms !== 'number' || !Number.isSafeInteger(execution_ms) || execution_ms < 0 || execution_ms > 30_000) throw new Error();
        item['result'] = { ...writeResult(counts), execution_ms };
      }
      return structuredClone(item) as unknown as ChangeSummary;
    });
  } catch { throw new ServerError('SERVICE_UNAVAILABLE'); }
}
