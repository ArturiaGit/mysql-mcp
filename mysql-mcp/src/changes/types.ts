import { ServerError, type ServerErrorCode } from '../server/errors.js';
import { objectBody } from '../server/connections.js';
import type { RiskLevel } from '../sql/policy.js';

export const CHANGE_LIMITS = Object.freeze({ approval_ttl_ms: 300_000, retention_ms: 300_000,
  execution_timeout_ms: 30_000, max_requests: 256, max_sessions: 16, max_concurrent: 4,
  max_sql_bytes: 1_048_576, max_queued: 64 });
export const CHANGE_STATES = ['PENDING', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'UNKNOWN',
  'REJECTED', 'CANCELLED', 'EXPIRED', 'INVALIDATED'] as const;
export type ChangeState = typeof CHANGE_STATES[number];
export type ConfirmationChannel = 'web' | 'native';
export type Decision = 'approve' | 'reject' | 'cancel';
export interface WriteResult { affected_rows: number | string; last_insert_id: number | string; warning_count: number }
export interface ChangeSummary {
  request_id: string; connection_id: string; connection_version: number; database: string;
  operation: string; risk_level: RiskLevel; risk_codes: string[]; sql_fingerprint: string; exact_sql_digest: string;
  confirmation_channel: ConfirmationChannel; state: ChangeState;
  created_at: string; expires_at: string; updated_at: string;
  result?: WriteResult & { execution_ms: number }; error_code?: ServerErrorCode;
}
export interface ChangeInput { connection_id: string; database: string; sql: string; reason?: string }
export interface WebDecision { decision: Decision; approval_nonce: string; sql_fingerprint: string; connection_version: number }
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const HASH = /^[0-9a-f]{64}$/;
export function requestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ServerError('INVALID_ARGUMENT');
  return value;
}
export function parseChangeInput(value: unknown): ChangeInput {
  const body = objectBody(value, ['connection_id', 'database', 'sql', 'reason'], ['connection_id', 'database', 'sql']);
  const connection_id = requestId(body['connection_id']);
  const database = body['database']; const sql = body['sql']; const reason = body['reason'];
  if (typeof database !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(database) ||
      typeof sql !== 'string' || !sql.trim() || Buffer.byteLength(sql) > 65_536 || Buffer.from(sql).toString() !== sql ||
      (reason !== undefined && (typeof reason !== 'string' || !reason.trim() || Buffer.byteLength(reason) > 2048 ||
        /[\x00-\x1f\x7f]/.test(reason) || Buffer.from(reason).toString() !== reason))) throw new ServerError('INVALID_ARGUMENT');
  return { connection_id, database, sql, ...(reason === undefined ? {} : { reason: reason as string }) };
}
export function parseWebDecision(value: unknown): WebDecision {
  const body = objectBody(value, ['decision', 'approval_nonce', 'sql_fingerprint', 'connection_version'],
    ['decision', 'approval_nonce', 'sql_fingerprint', 'connection_version']);
  if (!['approve', 'reject', 'cancel'].includes(String(body['decision'])) || typeof body['decision'] !== 'string' ||
      typeof body['approval_nonce'] !== 'string' || !HASH.test(body['approval_nonce']) ||
      typeof body['sql_fingerprint'] !== 'string' || !HASH.test(body['sql_fingerprint']) ||
      typeof body['connection_version'] !== 'number' || !Number.isSafeInteger(body['connection_version']) ||
      body['connection_version'] < 1) throw new ServerError('INVALID_ARGUMENT');
  return body as unknown as WebDecision;
}
export function terminal(state: ChangeState): boolean { return !['PENDING', 'APPROVED', 'EXECUTING'].includes(state); }
export function effectNote(state: ChangeState): string | undefined {
  if (state === 'UNKNOWN') return 'Execution outcome is unknown. Do not retry; ask the DBA to verify the original request.';
  if (state === 'FAILED') return 'Execution failed. Partial effects or implicit commits may exist; no automatic retry or rollback is promised.';
  if (state === 'SUCCEEDED') return 'A completion receipt was received. DDL and non-transactional changes may not be reversible.';
  return undefined;
}
