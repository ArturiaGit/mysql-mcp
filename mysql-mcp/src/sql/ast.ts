import sqlParser from 'node-sql-parser';

export const MAX_SQL_BYTES = 65_536;
export const MAX_SQL_DEPTH = 32;
export const MAX_SQL_TOKENS = 4096;
export type AstNode = Record<string, unknown>;

export class SqlPolicyError extends Error {
  readonly code: 'SQL_NOT_ALLOWED' | 'TARGET_MISMATCH';
  constructor(code: 'SQL_NOT_ALLOWED' | 'TARGET_MISMATCH' = 'SQL_NOT_ALLOWED') {
    super(code === 'TARGET_MISMATCH' ? 'SQL target does not match the requested database.' : 'SQL is outside the supported safety policy.');
    this.code = code;
    this.name = 'SqlPolicyError';
    this.stack = `${this.name}: ${this.code}`;
  }
}
export function rejectSql(code: 'SQL_NOT_ALLOWED' | 'TARGET_MISMATCH' = 'SQL_NOT_ALLOWED'): never { throw new SqlPolicyError(code); }
export function isNode(value: unknown): value is AstNode {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// MySQL-aware lexical guard, not a statement classifier. Reject ambiguous modes
// (double quotes/backslash escapes) rather than assuming the server SQL mode.
export function inspectSql(sql: string): { text: string; structure: string } {
  if (typeof sql !== 'string' || !sql.trim() || Buffer.byteLength(sql, 'utf8') > MAX_SQL_BYTES || Buffer.from(sql, 'utf8').toString('utf8') !== sql) rejectSql();
  const text: string[] = [];
  const tokens: string[] = [];
  let depth = 0;
  let i = 0;
  const token = (value: string): void => {
    tokens.push(value);
    if (tokens.length > MAX_SQL_TOKENS) rejectSql();
  };
  while (i < sql.length) {
    const c = sql[i]!;
    if (/^[ \t\r\n]$/.test(c)) { text.push(' '); i++; continue; }
    if (c === '\0' || c === ';' || c === '@' || c === '\\' || c === '"' || c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126) rejectSql();
    if (sql.startsWith('/*', i)) {
      if (sql[i + 2] === '!' || sql[i + 2] === '+' || /^\/\*M!/i.test(sql.slice(i, i + 5))) rejectSql();
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) rejectSql();
      text.push(' '); i = end + 2; continue;
    }
    if (c === '#' || (sql.startsWith('--', i) && /^[ \t\r\n]$/.test(sql[i + 2] ?? ''))) {
      const relativeEnd = sql.slice(i).search(/[\r\n]/);
      text.push(' '); i = relativeEnd < 0 ? sql.length : i + relativeEnd + 1; continue;
    }
    if (c === "'" || c === '`') {
      const start = i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '\\' || sql[i] === '\0') rejectSql();
        if (sql[i] === c) {
          if (sql[i + 1] === c) { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      if (!closed) rejectSql();
      const value = sql.slice(start, i);
      text.push(value); token(c === "'" ? '?' : value); continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i));
    if (word) { text.push(word[0]); token(word[0].toUpperCase()); i += word[0].length; continue; }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(sql.slice(i));
    if (number) { text.push(number[0]); token('?'); i += number[0].length; continue; }
    if (c === '(' && ++depth > MAX_SQL_DEPTH) rejectSql();
    if (c === ')' && --depth < 0) rejectSql();
    if (sql.startsWith(':=', i)) rejectSql();
    text.push(c); token(c); i++;
  }
  if (depth !== 0) rejectSql();
  return { text: text.join('').trim(), structure: tokens.join(' ') };
}

// node-sql-parser's MySQL grammar does not support ALTER DATABASE. This bounded
// adapter recognizes the entire small grammar, never a generic statement prefix.
function parseAlterDatabase(text: string): AstNode {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_SQL_BYTES) rejectSql();
  const tokens: string[] = [];
  const tokenPattern = /[A-Za-z_][A-Za-z0-9_]*|`[A-Za-z_][A-Za-z0-9_]{0,63}`|=/y;
  let offset = 0;
  while (offset < text.length) {
    const start = offset;
    while (/[ \t\r\n]/.test(text[offset] ?? '') && offset < text.length) offset++;
    if (offset === text.length) break;
    tokenPattern.lastIndex = offset;
    const match = tokenPattern.exec(text);
    if (!match || match[0].length > 66 || (tokens.length > 0 && start === offset && match[0] !== '=' && tokens.at(-1) !== '=')) rejectSql();
    tokens.push(match[0]);
    if (tokens.length > 16) rejectSql();
    offset = tokenPattern.lastIndex;
  }
  let index = 0;
  const take = (word: string): boolean => {
    if (tokens[index]?.toUpperCase() !== word) return false;
    index++; return true;
  };
  const identifier = (quoted: boolean): string => {
    const raw = tokens[index++];
    if (raw === undefined) rejectSql();
    // MySQL permits an omitted db_name. An unquoted option keyword must never
    // be mistaken for the explicitly bound target (notably DEFAULT).
    if (quoted && !raw.startsWith('`') && ['DEFAULT', 'CHARACTER', 'CHARSET', 'COLLATE', 'IF'].includes(raw.toUpperCase())) rejectSql();
    const name = quoted && raw.startsWith('`') ? raw.slice(1, -1) : raw;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) rejectSql();
    return name;
  };
  if (!take('ALTER') || !take('DATABASE')) rejectSql();
  const database = identifier(true);
  const options: AstNode[] = [];
  const seen = new Set<string>();
  while (index < tokens.length) {
    take('DEFAULT');
    let keyword: string;
    if (take('CHARACTER')) { if (!take('SET')) rejectSql(); keyword = 'character set'; }
    else if (take('CHARSET')) keyword = 'character set';
    else if (take('COLLATE')) keyword = 'collate';
    else return rejectSql();
    if (seen.has(keyword)) rejectSql();
    seen.add(keyword);
    const symbol = take('=') ? '=' : null;
    options.push({ keyword, symbol, value: { type: 'default', value: identifier(false) } });
  }
  if (options.length < 1 || options.length > 2) rejectSql();
  return { type: 'alter_database', database, options };
}

export function parseSql(text: string): AstNode {
  try {
    const parser = new sqlParser.Parser();
    const ast: unknown = parser.astify(text, { database: 'MySQL' });
    if (!isNode(ast)) rejectSql();
    return ast;
  } catch { return parseAlterDatabase(text); } // Never expose parser diagnostics or original SQL.
}
