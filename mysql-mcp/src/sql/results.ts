import { ReadError } from './read-errors.js';

export const READ_LIMITS = Object.freeze({ max_rows: 1000, max_columns: 128,
  max_field_bytes: 65_536, max_response_bytes: 1_048_576, timeout_ms: 15_000, max_concurrent: 4 });
export interface ColumnMeta { name: string; mysql_type: string; encoding: string }
export interface ReadRows { columns: readonly ColumnMeta[]; rows: AsyncIterable<readonly unknown[]> }
export interface QueryResult {
  columns: ColumnMeta[]; rows: unknown[][]; returned_rows: number; truncated: boolean;
  truncation_reason: 'row_limit' | 'byte_limit' | null; duration_ms: number;
}
// Includes text-content escaping and space for JSON-RPC framing, not merely raw cells.
export function responseBytes(data: unknown): number {
  return Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }], isError: false }), 'utf8') + 1024;
}
function clipped(text: string, budget: number): string {
  if (Buffer.byteLength(JSON.stringify(text)) <= budget) return text;
  let low = 0; let high = Math.min(text.length, budget);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(text.slice(0, mid))) <= budget) low = mid;
    else high = mid - 1;
  }
  // Do not split a UTF-16 surrogate pair (or base64 quartet, handled by caller).
  if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1]!)) low--;
  return text.slice(0, low);
}
export async function collectRows(source: ReadRows, start = performance.now(), signal?: AbortSignal): Promise<QueryResult> {
  const result: QueryResult = { columns: [], rows: [], returned_rows: 0, truncated: false, truncation_reason: null, duration_ms: 0 };
  const truncate = (reason: 'row_limit' | 'byte_limit'): void => {
    result.truncated = true;
    if (result.truncation_reason !== 'byte_limit') result.truncation_reason = reason;
  };
  if (source.columns.length > READ_LIMITS.max_columns) truncate('byte_limit');
  for (const column of source.columns.slice(0, READ_LIMITS.max_columns)) {
    if (typeof column.name !== 'string' || typeof column.mysql_type !== 'string' || !['text', 'base64'].includes(column.encoding)) throw new ReadError('DB_ERROR');
    const safe = { name: clipped(column.name, 1024), mysql_type: clipped(column.mysql_type, 128), encoding: column.encoding };
    if (safe.name !== column.name || safe.mysql_type !== column.mysql_type) truncate('byte_limit');
    result.columns.push(safe);
  }
  for await (const values of source.rows) {
    if (signal?.aborted) throw new ReadError('EXECUTION_TIMEOUT');
    if (result.rows.length >= READ_LIMITS.max_rows) { truncate('row_limit'); break; }
    if (!Array.isArray(values) || values.length !== source.columns.length) throw new ReadError('DB_ERROR');
    const row = values.slice(0, result.columns.length).map((value, i): unknown => {
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new ReadError('DB_ERROR');
        return value;
      }
      if (typeof value === 'bigint') value = value.toString();
      if (Buffer.isBuffer(value)) {
        if (result.columns[i]?.encoding !== 'base64') throw new ReadError('DB_ERROR');
        if (value.length > 49_149) truncate('byte_limit');
        value = value.subarray(0, 49_149).toString('base64');
      }
      if (typeof value !== 'string') throw new ReadError('DB_ERROR');
      const text = clipped(value, READ_LIMITS.max_field_bytes);
      if (text !== value) truncate('byte_limit');
      return result.columns[i]?.encoding === 'base64' ? text.slice(0, text.length - text.length % 4) : text;
    });
    result.rows.push(row); result.returned_rows = result.rows.length;
    // Worst-case duration representation reserved during collection.
    result.duration_ms = READ_LIMITS.timeout_ms;
    if (responseBytes(result) > READ_LIMITS.max_response_bytes) {
      result.rows.pop(); result.returned_rows = result.rows.length; truncate('byte_limit'); break;
    }
  }
  result.duration_ms = Math.max(0, Math.min(READ_LIMITS.timeout_ms, Math.round(performance.now() - start)));
  return result;
}
