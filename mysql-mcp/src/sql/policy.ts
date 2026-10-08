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
const numericTypes = new Set(['INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE']);
const schemas: Record<string, string> = {
  select: 'with type options distinct columns into from where groupby having orderby limit locking_read window collate _next set_op parentheses',
  explain: 'type expr', desc: 'type table', show: 'type keyword from',
  insert: 'type table columns values partition prefix on_duplicate_update',
  update: 'with type table set where orderby limit', delete: 'with type table from where orderby limit',
  create: 'type keyword temporary if_not_exists table ignore_replace as query_expr create_definitions table_options database',
  alter: 'type table expr', alter_database: 'type database options',
  drop: 'type keyword prefix name', truncate: 'type keyword name',
  column_ref: 'type table column collate db', binary_expr: 'type operator left right parentheses',
  unary_expr: 'type operator expr parentheses', expr_list: 'type value parentheses prefix',
  function: 'type name args over', aggr_func: 'type name args over', cast: 'type keyword expr symbol target',
  values: 'type values', number: 'type value', single_quote_string: 'type value',
  string: 'type value', bool: 'type value', boolean: 'type value', null: 'type value',
  star: 'type value', default: 'type value', 'not null': 'type value', backticks_quote_string: 'type value',
  ASC: 'type expr', DESC: 'type expr'
};
const columnKeys = 'column definition resource primary_key nullable default_val';
const alterColumnKeys = `type action keyword suffix ${columnKeys}`;
const structuralKeys = new Set(('db table as join on using expr name stmt ast tableList columnList columns value args schema ' +
  'dataType length scale parentheses suffix column definition resource primary_key nullable default_val ' +
  'seperator distinct orderby modifiers action keyword symbol target prefix addition').split(' '));
function onlyKeys(node: AstNode, keys: string): void {
  const allowed = new Set(keys.split(' '));
  if (Object.keys(node).some(key => !allowed.has(key))) rejectSql();
}
function permittedKeys(node: AstNode): void {
  const type = node.type;
  const keys = type === 'alter' && node.action != null ? alterColumnKeys : typeof type === 'string' && Object.hasOwn(schemas, type) ? schemas[type] : undefined;
  if (type !== undefined && keys === undefined) rejectSql();
  if (keys !== undefined) onlyKeys(node, keys);
  else if (Object.keys(node).some(key => !structuralKeys.has(key))) rejectSql();
}
function functionName(node: AstNode): string {
  if (typeof node.name === 'string') return node.name.toUpperCase();
  if (!isNode(node.name) || node.name.schema || !Array.isArray(node.name.name) || node.name.name.length !== 1) rejectSql();
  const part: unknown = node.name.name[0];
  if (!isNode(part) || typeof part.value !== 'string') rejectSql();
  return part.value.toUpperCase();
}
function target(name: unknown, database: string, channel: 'query' | 'change'): void {
  if (typeof name !== 'string' || systemDatabases.has(name.toLowerCase())) rejectSql();
  if (name !== database) rejectSql(channel === 'change' ? 'TARGET_MISMATCH' : 'SQL_NOT_ALLOWED');
}
function walk(ast: AstNode, database: string, channel: 'query' | 'change'): void {
  let count = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++count > 12_000 || depth > 64) rejectSql();
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
    if (!isNode(value)) return;
    if (value.db != null) target(value.db, database, channel);
    if (value.type === 'backticks_quote_string' && !(ast.type === 'create' && ast.keyword === 'database' &&
      isNode(ast.database) && Array.isArray(ast.database.schema) && ast.database.schema.includes(value))) rejectSql();
    permittedKeys(value);
    // Only SELECT may occur as a nested statement; ALTER's column clauses are
    // separately whitelisted, not permission for arbitrary nested writes.
    if (value !== ast && ['insert', 'update', 'delete', 'create', 'alter', 'alter_database', 'drop', 'truncate'].includes(String(value.type)) &&
      !(ast.type === 'alter' && value.type === 'alter' && value.resource === 'column' && ['add', 'drop', 'modify'].includes(String(value.action)))) rejectSql();
    if (value.schema != null && !Array.isArray(value.schema)) rejectSql();
    if (value.type === 'function' || value.type === 'aggr_func') {
      if (!safeFunctions.has(functionName(value)) || value.over != null) rejectSql();
    }
    if (value.operator != null && !operators.has(String(value.operator).toUpperCase())) rejectSql();
    if (value.dataType != null && !dataTypes.has(String(value.dataType).toUpperCase())) rejectSql();
    // Database alteration has its own AST shape, without relaxing this rule.
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
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value) || value === '*') rejectSql();
  return value;
}
function singleTable(value: unknown, aliases = false, deletion = false): AstNode {
  if (!Array.isArray(value) || value.length !== 1 || !isNode(value[0])) rejectSql();
  const table = value[0];
  onlyKeys(table, deletion ? 'db table as addition' : 'db table as');
  identifier(table.table);
  if (table.as != null) { if (!aliases) rejectSql(); identifier(table.as); }
  if (table.addition != null && table.addition !== true) rejectSql();
  return table;
}
function uniqueNames(names: unknown[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    const normalized = identifier(name).toLowerCase();
    if (seen.has(normalized)) rejectSql();
    seen.add(normalized);
  }
}
function columnName(value: unknown): string {
  if (!isNode(value) || value.type !== 'column_ref') rejectSql();
  onlyKeys(value, schemas.column_ref!);
  if (value.table != null || value.db != null || value.collate != null) rejectSql();
  return identifier(value.column);
}
function columnDefinition(node: AstNode): string {
  if (node.resource !== 'column' || !isNode(node.definition)) rejectSql();
  const name = columnName(node.column);
  const definition = node.definition;
  onlyKeys(definition, 'dataType length scale parentheses suffix');
  if (typeof definition.dataType !== 'string' || !dataTypes.has(definition.dataType.toUpperCase())) rejectSql();
  if (definition.parentheses != null && definition.parentheses !== true) rejectSql();
  if (definition.length != null && (!Number.isSafeInteger(definition.length) || Number(definition.length) < 0 || Number(definition.length) > 65_535)) rejectSql();
  if (definition.scale != null && (!Number.isSafeInteger(definition.scale) || Number(definition.scale) < 0 || definition.length == null || Number(definition.scale) > Number(definition.length))) rejectSql();
  if (definition.suffix != null) {
    if (!Array.isArray(definition.suffix) || definition.suffix.length > 2 || new Set(definition.suffix).size !== definition.suffix.length ||
      definition.suffix.some(suffix => !['UNSIGNED', 'ZEROFILL'].includes(String(suffix)) || !numericTypes.has(String(definition.dataType).toUpperCase()))) rejectSql();
  }
  if (node.primary_key != null && node.primary_key !== 'primary key') rejectSql();
  if (node.nullable != null) {
    if (!isNode(node.nullable)) rejectSql();
    onlyKeys(node.nullable, 'type value');
    if (!((node.nullable.type === 'not null' && node.nullable.value === 'not null') || (node.nullable.type === 'null' && node.nullable.value === 'null'))) rejectSql();
  }
  if (node.default_val != null) {
    if (!isNode(node.default_val) || node.default_val.type !== 'default' || !isNode(node.default_val.value) ||
      !['number', 'single_quote_string', 'string', 'bool', 'boolean', 'null'].includes(String(node.default_val.value.type))) rejectSql();
    onlyKeys(node.default_val, 'type value');
    onlyKeys(node.default_val.value, 'type value');
  }
  return name;
}
function databaseOptions(value: unknown, required: boolean): void {
  if (value == null && !required) return;
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) rejectSql();
  const seen = new Set<string>();
  for (const option of value) {
    if (!isNode(option)) rejectSql();
    onlyKeys(option, 'keyword symbol value');
    const keyword = String(option.keyword).replace(/^default /, '');
    const kind = keyword === 'charset' ? 'character set' : keyword;
    if (!['character set', 'collate'].includes(kind) || seen.has(kind) || (option.symbol != null && option.symbol !== '=') || !isNode(option.value)) rejectSql();
    onlyKeys(option.value, 'type value');
    if (option.value.type !== 'default' || typeof option.value.value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(option.value.value)) rejectSql();
    seen.add(kind);
  }
}
function classify(ast: AstNode, database: string, channel: 'query' | 'change'): RiskLevel {
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
      if (ast.keyword === 'columns') singleTable(ast.from, true);
      return 'L0';
    case 'insert': {
      singleTable(ast.table);
      if (!isNode(ast.values) || ast.values.type !== 'values' || ast.partition != null || ast.on_duplicate_update != null || ast.prefix !== 'into') rejectSql();
      if (ast.columns != null) {
        if (!Array.isArray(ast.columns) || ast.columns.length === 0) rejectSql();
        uniqueNames(ast.columns);
      }
      if (!Array.isArray(ast.values.values) || ast.values.values.length === 0) rejectSql();
      let width = Array.isArray(ast.columns) ? ast.columns.length : undefined;
      for (const row of ast.values.values) {
        if (!isNode(row) || row.type !== 'expr_list' || !Array.isArray(row.value) || row.value.length === 0 || row.prefix != null ||
          (row.parentheses != null && row.parentheses !== true) || row.value.some(value => !isNode(value))) rejectSql();
        width ??= row.value.length;
        if (row.value.length !== width) rejectSql();
      }
      return 'L1';
    }
    case 'update': case 'delete': {
      const table = singleTable(ast.table, true, ast.type === 'delete');
      if (ast.with != null || ast.orderby != null || ast.limit != null || (ast.where != null && !isNode(ast.where))) rejectSql();
      if (ast.type === 'delete') {
        const from = singleTable(ast.from, true);
        if (table.addition !== true || table.db !== from.db || table.table !== from.table || table.as !== from.as) rejectSql();
      } else {
        if (!Array.isArray(ast.set) || ast.set.length === 0) rejectSql();
        const names: string[] = [];
        for (const assignment of ast.set) {
          if (!isNode(assignment) || !isNode(assignment.value)) rejectSql();
          onlyKeys(assignment, 'column value table');
          if (assignment.table != null && assignment.table !== (table.as ?? table.table)) rejectSql();
          names.push(identifier(assignment.column));
        }
        uniqueNames(names);
      }
      return ast.where == null ? 'L2' : 'L1';
    }
    case 'create':
      if (ast.if_not_exists != null && ast.if_not_exists !== 'IF NOT EXISTS') rejectSql();
      if (ast.keyword === 'database') {
        onlyKeys(ast, 'type keyword if_not_exists database create_definitions');
        if (!isNode(ast.database)) rejectSql();
        onlyKeys(ast.database, 'db schema');
        if (ast.database.db != null) rejectSql();
        if (!Array.isArray(ast.database.schema) || ast.database.schema.length !== 1) rejectSql();
        const name: unknown = ast.database.schema[0];
        if (!isNode(name) || !['default', 'backticks_quote_string'].includes(String(name.type))) rejectSql();
        onlyKeys(name, 'type value');
        target(name.value, database, channel);
        databaseOptions(ast.create_definitions, false);
      } else if (ast.keyword === 'table') {
        singleTable(ast.table);
        if (ast.temporary != null || ast.ignore_replace != null || ast.as != null || ast.query_expr != null || ast.table_options != null ||
          !Array.isArray(ast.create_definitions) || ast.create_definitions.length === 0) rejectSql();
        const names: string[] = [];
        let primaryKeys = 0;
        for (const definition of ast.create_definitions) {
          if (!isNode(definition)) rejectSql();
          onlyKeys(definition, columnKeys);
          names.push(columnDefinition(definition));
          if (definition.primary_key != null && ++primaryKeys > 1) rejectSql();
        }
        uniqueNames(names);
      } else rejectSql();
      return 'L2';
    case 'alter':
      singleTable(ast.table);
      if (!Array.isArray(ast.expr) || ast.expr.length === 0) rejectSql();
      for (const clause of ast.expr) {
        if (!isNode(clause) || clause.type !== 'alter' || clause.resource !== 'column' || !['add', 'drop', 'modify'].includes(String(clause.action))) rejectSql();
        if (clause.keyword != null && clause.keyword !== 'COLUMN') rejectSql();
        if (clause.action === 'drop') {
          onlyKeys(clause, 'type action resource keyword column');
          columnName(clause.column);
        } else {
          onlyKeys(clause, alterColumnKeys);
          columnDefinition(clause);
          if (clause.suffix != null) {
            if (!isNode(clause.suffix)) rejectSql();
            if (clause.suffix.keyword === 'FIRST') onlyKeys(clause.suffix, 'keyword');
            else if (clause.suffix.keyword === 'AFTER') {
              onlyKeys(clause.suffix, 'keyword expr');
              columnName(clause.suffix.expr);
            } else rejectSql();
          }
        }
      }
      return 'L2';
    case 'alter_database':
      target(ast.database, database, channel);
      databaseOptions(ast.options, true);
      return 'L2';
    case 'drop': case 'truncate':
      if (ast.type === 'drop' && ast.prefix != null && ast.prefix !== 'if exists') rejectSql();
      if (ast.type === 'drop' && ast.keyword === 'database') target(ast.name, database, channel);
      else {
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
  walk(ast, database, channel);
  const risk = classify(ast, database, channel);
  if (channel === 'query' && risk !== 'L0') rejectSql();
  const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
  return Object.freeze({
    risk_level: risk, operation: ast.type === 'alter_database' ? 'ALTER' : String(ast.type).toUpperCase(),
    requires_approval: risk !== 'L0', risk_codes: Object.freeze(risk === 'L2' ? ['HIGH_RISK'] : []),
    sql_fingerprint: hash(lexical.structure), exact_sql_digest: hash(sql),
    max_rows: 1000, max_response_bytes: 1_048_576
  });
}
