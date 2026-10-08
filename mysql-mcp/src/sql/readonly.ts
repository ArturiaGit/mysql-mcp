import sqlParser from 'node-sql-parser';
import { evaluateSql } from './policy.js';
import { inspectSql, parseSql, isNode } from './ast.js';
import { ReadError } from './read-errors.js';
import { READ_LIMITS } from './results.js';

export function prepareReadonlySql(sql: string, database: string): string {
  const decision = evaluateSql(sql, database, 'query');
  if (decision.operation !== 'SELECT' || decision.requires_approval || decision.risk_level !== 'L0') throw new ReadError('SQL_NOT_ALLOWED');
  const ast = parseSql(inspectSql(sql).text);
  let tail = ast;
  while (isNode(tail['_next'])) tail = tail['_next'];
  const limit = tail['limit'];
  const cap = READ_LIMITS.max_rows + 1;
  if (limit == null) tail['limit'] = { seperator: '', value: [{ type: 'number', value: cap }] };
  else {
    if (!isNode(limit) || !Array.isArray(limit['value']) || ![1, 2].includes(limit['value'].length)) throw new ReadError('SQL_NOT_ALLOWED');
    const values = limit['value'];
    for (const number of values) {
      if (!isNode(number) || number['type'] !== 'number' || typeof number['value'] !== 'number' || !Number.isSafeInteger(number['value']) || number['value'] < 0) throw new ReadError('SQL_NOT_ALLOWED');
    }
    const countIndex = limit['seperator'] === ',' ? values.length - 1 : 0;
    const count = values[countIndex] as Record<string, unknown>;
    count['value'] = Math.min(count['value'] as number, cap);
  }
  try {
    const normalized = new sqlParser.Parser().sqlify(ast as never, { database: 'MySQL' });
    // Revalidate the exact SQL that will be dispatched, not only the input.
    if (evaluateSql(normalized, database).operation !== 'SELECT') throw new ReadError('SQL_NOT_ALLOWED');
    return normalized;
  } catch { throw new ReadError('SQL_NOT_ALLOWED'); }
}
