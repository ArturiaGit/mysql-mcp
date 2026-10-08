import { randomBytes } from 'node:crypto';
import type { NativeElicitor } from '../changes/manager.js';

export interface NativeVerification {
  name: string; version: string; permission_mode: string; evidence_id: string;
  full_sql_display: true; per_request_prompt: true; accept_decline_cancel: true; no_auto_approve: true;
}
export interface NativeApprovalOptions { permissionMode: string; verifiedClients: readonly NativeVerification[] }
export function nativeEligible(name: string, version: string, options?: NativeApprovalOptions): boolean {
  return !!options?.verifiedClients.some(record => record.name === name && record.version === version &&
    record.permission_mode === options.permissionMode && typeof record.evidence_id === 'string' && !!record.evidence_id.trim() &&
    record.full_sql_display === true && record.per_request_prompt === true && record.accept_decline_cancel === true && record.no_auto_approve === true);
}
/** No SQL or database side effects. Negotiated capability alone never enables approval. */
export async function probeNative(elicit: NativeElicitor, signal: AbortSignal): Promise<boolean> {
  try {
    for (const action of ['accept', 'decline', 'cancel'] as const) {
      if (signal.aborted) return false;
      const code = randomBytes(32).toString('hex');
      const result = await elicit({ mode: 'form', message: `No-side-effect MySQL approval probe. This does NOT execute SQL. For this probe choose ${action}.${action === 'accept' ? ` Type this review code: ${code}` : ''}`,
        requestedSchema: { type: 'object', properties: { review_code: { type: 'string' } }, required: ['review_code'] } }, signal);
      if (signal.aborted || result.action !== action || (action === 'accept' &&
          (result.content?.['review_code'] !== code || Object.keys(result.content).length !== 1))) return false;
    }
    return true;
  } catch { return false; }
}
