import { createHash } from 'node:crypto';
import { inspectSql, isNode, parseSql, rejectSql, type AstNode } from './ast.js';

export type RiskLevel = 'L0' | 'L1' | 'L2';
export interface SqlDecision {
  readonly risk_level: RiskLevel;
  readonly operation: string;
  readonly requires_approval: boolean;
  readonly risk_codes: readonly string[];
  readonly sql_fingerprint: string;
  readonly exact_sql_digest: string;
  readonly max_rows: number;
  readonly max_response_bytes: number;
}
const systemDatabases = new Set(['mysql', 'information_schema', 'performance_schema', 'sys']);
const safeFunctions = new Set(['ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND', 'MOD', 'LOWER', 'UPPER', 'LENGTH', 'CHAR_LENGTH', 'CONCAT', 'SUBSTRING', 'TRIM', 'COALESCE', 'IFNULL', 'NULLIF', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);
const operators = new Set(['=', '!=', '<>', '<', '>', '<=', '>=', '+', '-', '*', '/', '%', 'AND', 'OR', 'NOT', 'IN', 'NOT IN', 'LIKE', 'NOT LIKE', 'IS', 'IS NOT', 'BETWEEN', 'NOT BETWEEN', 'EXISTS', 'NOT EXISTS']);
const dataTypes = new Set(['INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT', 'VARCHAR', 'CHAR', 'TEXT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'DATE', 'DATETIME', 'TIMESTAMP', 'BOOLEAN', 'BOOL']);
const schemas: Record<string, string> = {
  select: 'with type options distinct columns into from where groupby having orderby limit locking_read window collate _next set_op parentheses',
  explain: 'type expr', desc: 'type table', show: 'type keyword from',
  insert: 'type table columns values partition prefix on_duplicate_update',
  update: 'with type table set where orderby limit', delete: 'with type table from where orderby limit',
  create: 'type keyword temporary if_not_exists table ignore_replace as query_expr create_definitions table_options database',
  alter: 'type table expr action column definition resource keyword suffix',
  drop: 'type keyword prefix name', truncate: 'type keyword name',
  column_ref: 'type table column collate db', binary_expr: 'type operator left right parentheses',
  unary_expr: 'type operator expr parentheses', expr_list: 'type value parentheses prefix',
  function: 'type name args over', aggr_func: 'type name args over', cast: 'type keyword expr symbol target',
  values: 'type values', number: 'type value', single_quote_string: 'type value',
  string: 'type value', bool: 'type value', boolean: 'type value', null: 'type value',
  star: 'type value', default: 'type value', 'not null': 'type value',
  ASC: 'type expr', DESC: 'type expr'
};
const structuralKeys = new Set(('db table as join on using expr name stmt ast tableList columnList columns value args schema ' +
  'dataType length scale parentheses suffix column definition resource primary_key nullable default_val ' +
  'seperator distinct orderby modifiers action keyword symbol target prefix addition').split(' '));
function permittedKeys(node: AstNode): void {
  const type = node.type;
  const keys = typeof type === 'string' ? schemas[type] : undefined;
  if (type !== undefined && keys === undefined) rejectSql();
  const allowed = keys === undefined ? structuralKeys : new Set(keys.split(' '));
  if (Object.keys(node).some(key => !allowed.has(key))) rejectSql();
}
function functionName(node: AstNode): string {
  if (typeof node.name === 'string') return node.name.toUpperCase();
  if (!isNode(node.name) || node.name.schema || !Array.isArray(node.name.name) || node.name.name.length !== 1) rejectSql();
  const part: unknown = node.name.name[0];
  if (!isNode(part) || typeof part.value !== 'string') rejectSql();
  return part.value.toUpperCase();
}
function walk(ast: AstNode, database: string): void {
  let count = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++count > 12_000 || depth > 64) rejectSql();
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
    if (!isNode(value)) return;
    permittedKeys(value);
    if (value.db != null && value.db !== database) rejectSql();
    if (typeof value.db === 'string' && systemDatabases.has(value.db.toLowerCase())) rejectSql();
    if (value.schema != null && !Array.isArray(value.schema)) rejectSql();
    if (value.type === 'function' || value.type === 'aggr_func') {
      if (!safeFunctions.has(functionName(value)) || value.over != null) rejectSql();
    }
    if (value.operator != null && !operators.has(String(value.operator).toUpperCase())) rejectSql();
    if (value.dataType != null && !dataTypes.has(String(value.dataType).toUpperCase())) rejectSql();
    if (value.resource != null && value.resource !== 'column') rejectSql();
    if (value.type === 'select') {
      if (value.options != null || value.locking_read != null || value.window != null || value.collate != null) rejectSql();
      if (!isNode(value.into) || Object.keys(value.into).some(key => key !== 'position') || value.into.position != null) rejectSql();
      if (value.set_op != null && !['union', 'union all'].includes(String(value.set_op).toLowerCase())) rejectSql();
      if (value._next != null && (!isNode(value._next) || value._next.type !== 'select')) rejectSql();
    }
    // INTO's sole empty marker is parser metadata, not an expression.
    for (const [key, child] of Object.entries(value)) {
      if (key === 'into' || key === 'tableList' || key === 'columnList') continue;
      visit(child, depth + 1);
    }
  };
  visit(ast, 0);
}
function singleTable(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 1 || !isNode(value[0]) || typeof value[0].table !== 'string' || value[0].join) rejectSql();
}
function classify(ast: AstNode, database: string): RiskLevel {
  switch (ast.type) {
    case 'select': return 'L0';
    case 'explain':
      if (!isNode(ast.expr) || ast.expr.type !== 'select') rejectSql();
      return 'L0';
    case 'desc':
      if (typeof ast.table !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ast.table)) rejectSql();
      return 'L0';
    case 'show':
      if (!['tables', 'columns'].includes(String(ast.keyword))) rejectSql();
      if (ast.keyword === 'columns') singleTable(ast.from);
      return 'L0';
    case 'insert':
      singleTable(ast.table);
      if (!isNode(ast.values) || ast.values.type !== 'values' || ast.partition != null || ast.on_duplicate_update != null || ast.prefix !== 'into') rejectSql();
      return 'L1';
    case 'update': case 'delete':
      singleTable(ast.table);
      if (ast.with != null || ast.orderby != null || ast.limit != null) rejectSql();
      if (ast.type === 'delete') singleTable(ast.from);
      return ast.where == null ? 'L2' : 'L1';
    case 'create':
      if (ast.keyword === 'database') {
        if (!isNode(ast.database) || !Array.isArray(ast.database.schema) || ast.database.schema.length !== 1) rejectSql();
        const name: unknown = ast.database.schema[0];
        if (!isNode(name) || name.value !== database) rejectSql();
      } else if (ast.keyword === 'table') {
        singleTable(ast.table);
        if (ast.temporary != null || ast.ignore_replace != null || ast.as != null || ast.query_expr != null || ast.table_options != null || !Array.isArray(ast.create_definitions)) rejectSql();
      } else rejectSql();
      return 'L2';
    case 'alter':
      singleTable(ast.table);
      if (!Array.isArray(ast.expr) || ast.expr.length === 0) rejectSql();
      for (const clause of ast.expr) {
        if (!isNode(clause) || clause.resource !== 'column' || !['add', 'drop', 'modify'].includes(String(clause.action))) rejectSql();
      }
      return 'L2';
    case 'drop': case 'truncate':
      if (ast.type === 'drop' && ast.keyword === 'database') {
        if (ast.name !== database) rejectSql();
      } else {
        if (ast.keyword !== 'table') rejectSql();
        singleTable(ast.name);
      }
      return 'L2';
    default: return rejectSql();
  }
}

/** Static classification only. L1/L2 never constitute permission to execute. */
export function evaluateSql(sql: string, database: string, channel: 'query' | 'change' = 'query'): Readonly<SqlDecision> {
  if (typeof database !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(database) || systemDatabases.has(database.toLowerCase()) || !['query', 'change'].includes(channel)) rejectSql();
  const lexical = inspectSql(sql);
  const ast = parseSql(lexical.text);
  const risk = classify(ast, database);
  walk(ast, database);
  if (channel === 'query' && risk !== 'L0') rejectSql();
  const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
  return Object.freeze({
    risk_level: risk, operation: String(ast.type).toUpperCase(),
    requires_approval: risk !== 'L0', risk_codes: Object.freeze(risk === 'L2' ? ['HIGH_RISK'] : []),
    sql_fingerprint: hash(lexical.structure), exact_sql_digest: hash(sql),
    max_rows: 1000, max_response_bytes: 1_048_576
  });
}
