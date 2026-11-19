## 第七章：SQL AST 安全防火墙、Fail-Closed 改写器与 11 项 MCP Tools 实现规范

### 7.1 `ScopeExtractor`: 全属性树递归遍历、前缀优先与同级顺序可见 CTE 作用域栈（闭环 `BE-R01`）

针对评审问题 **`BE-R01`**（原代码在遍历表达式时仅枚举了 `['left', 'right', 'args', 'ast', 'expr']`，遗漏了 `node-sql-parser@5.4.0` 中 `IN (SELECT ...)` / `EXISTS (SELECT ...)` 外层 `expr_list` 的 `.value` 属性以及 `JOIN ... ON (...)` 中 `fromItem.on` 属性，导致条件子查询中的敏感表漏检），本节重构 `ScopeExtractor`：

1. **查询块节点（`node.type === 'select'`）与通用表达式节点解耦**：
   - 当遇到 `select` 节点时，压入该查询块的 CTE 作用域（严格保持同级顺序可见性），处理 `node.from`（显式递归 `fromItem.expr` 派生表与 **`fromItem.on`** 连接条件），随后遍历该 `select` 节点上除 `with` 以外的**所有对象/数组属性**（含 `columns`, `where`, `groupby`, `having`, `orderby`, `_next` 等）；
   - 当遇到任何非 `select` 节点（如 `binary_expr`, `expr_list`, `function`, `aggr_func`, `case`, `unary_expr` 等）时，**无条件遍历 `Object.values(node)` 中所有子对象与子数组**（天然覆盖 `expr_list.value`、`on`、函数参数及任意深度的关联子查询）！
2. **标识符大小写归一化策略（闭环第 四 节 #5）**：
   - 支持传入目标 Profile 的 `lowerCaseTableNames`（默认 `1`：不区分大小写，统一转小写匹配；当设为 `0` 时，保留原始大小写供精确匹配，同时在 ACL 黑名单比对中执行大小写不敏感拦截以防大小写绕过）。

```typescript
// packages/core-ast/src/scope-extractor.ts
export interface ExtractedTableRef {
  database: string;
  table: string;
  fullName: string;
  hasExplicitDb: boolean;
}

export class ScopeExtractor {
  /**
   * 基于 node-sql-parser@5.4.0 AST 全属性树递归提取全部真实物理表引用
   */
  public static extractPhysicalTables(
    astRoot: any,
    defaultDatabase: string,
    lowerCaseTableNames: 0 | 1 | 2 = 1
  ): { tables: ExtractedTableRef[]; isKnownNoTableQuery: boolean } {
    const resultMap = new Map<string, ExtractedTableRef>();
    const scopeStack: Array<Set<string>> = [];
    const normalizeIdent = (ident: string): string =>
      lowerCaseTableNames === 0 ? ident : ident.toLowerCase();

    const normDefaultDb = normalizeIdent(defaultDatabase);

    const visitNode = (node: any): void => {
      if (!node || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        for (const item of node) {
          visitNode(item);
        }
        return;
      }

      // 分支 A：若当前节点是一个 SELECT 查询块 (含顶层查询、CTE 主体、EXISTS/IN/JOIN ON/标量子查询、UNION 分支)
      if (String(node.type ?? '').toLowerCase() === 'select') {
        const hasWithList = Array.isArray(node.with) && node.with.length > 0;
        const currentCteScope = new Set<string>();

        if (hasWithList) {
          scopeStack.push(currentCteScope);
          for (const cteDef of node.with) {
            const rawCteName = String(cteDef?.name?.value ?? cteDef?.name ?? '');
            const cteName = rawCteName ? normalizeIdent(rawCteName) : '';
            if (cteDef?.recursive && cteName) {
              currentCteScope.add(cteName);
            }
            // 先递归解析当前 CTE 的子查询定义（保证同级 CTE 仅向前可见）
            visitNode(cteDef?.stmt?.ast ?? cteDef?.stmt);
            if (cteName) {
              currentCteScope.add(cteName);
            }
          }
        }

        // 处理 FROM / JOIN 子句
        if (Array.isArray(node.from)) {
          for (const fromItem of node.from) {
            if (!fromItem || typeof fromItem !== 'object') continue;

            if (fromItem.expr) {
              // 派生表子查询 FROM (SELECT ...) AS t
              visitNode(fromItem.expr);
            } else if (String(fromItem.type ?? '').toLowerCase() === 'dual' && !fromItem.table) {
              // 闭环 BE-R3-01：在 node-sql-parser@5.4.0 中，唯有裸关键字 FROM DUAL 会生成 { type: 'dual' } 且无 table 属性；
              // 而反引号物理表 SELECT * FROM `dual` 生成的是 { db: null, table: 'dual' }，必须进入下方分支作为物理表提取！
            } else if (fromItem.table) {
              const rawDb = fromItem.db ? normalizeIdent(String(fromItem.db)) : '';
              const rawTable = normalizeIdent(String(fromItem.table));

              // 1. 显式指定了数据库前缀 (如 finance.salary 或 app.`dual`)：一律为真实物理表，不匹配 CTE 别名
              if (rawDb) {
                const fullName = `${rawDb}.${rawTable}`;
                resultMap.set(fullName, {
                  database: rawDb,
                  table: rawTable,
                  fullName,
                  hasExplicitDb: true,
                });
              } else {
                // 2. 无数据库前缀的普通/反引号标识符 (含 FROM `dual`)：若不在 CTE 作用域栈中，一律归入默认库物理表
                const isCteAlias = scopeStack.some((scope) => scope.has(rawTable));
                if (!isCteAlias) {
                  const fullName = `${normDefaultDb}.${rawTable}`;
                  resultMap.set(fullName, {
                    database: normDefaultDb,
                    table: rawTable,
                    fullName,
                    hasExplicitDb: false,
                  });
                }
              }
            }

            // 【核心修复 BE-R01】：显式递归遍历 JOIN ... ON / USING 条件中的任何子查询
            if (fromItem.on) visitNode(fromItem.on);
            if (fromItem.using) visitNode(fromItem.using);
          }
        }

        // 递归遍历该 SELECT 节点除 with/from 以外的所有其他属性 (where, columns, groupby, having, orderby, _next 等)
        for (const [key, val] of Object.entries(node)) {
          if (key === 'with' || key === 'from') continue;
          if (val && typeof val === 'object') {
            visitNode(val);
          }
        }

        if (hasWithList) {
          scopeStack.pop();
        }
        return;
      }

      // 分支 B：【核心修复 BE-R01】非 select 的通用表达式节点 (如 expr_list.value, binary_expr, function, case 等)
      // 全量递归其所有对象/数组属性，确保 EXISTS (SELECT ...)、IN (SELECT ...) 等深层子查询 100% 被访问！
      for (const val of Object.values(node)) {
        if (val && typeof val === 'object') {
          visitNode(val);
        }
      }
    };

    visitNode(astRoot);

    const rootStmt = Array.isArray(astRoot) ? astRoot[0] : astRoot;
    const isSelectWithoutFrom =
      String(rootStmt?.type ?? '').toLowerCase() === 'select' &&
      !rootStmt?._next &&
      (!rootStmt.from ||
        (Array.isArray(rootStmt.from) &&
          rootStmt.from.length === 1 &&
          String(rootStmt.from[0]?.type ?? '').toLowerCase() === 'dual' &&
          !rootStmt.from[0]?.table));

    return {
      tables: Array.from(resultMap.values()),
      isKnownNoTableQuery: resultMap.size === 0 && isSelectWithoutFrom,
    };
  }
}
```

---

### 7.2 `AstValidator`: 系统库表旁路封堵、锁读拦截、高危函数黑名单与复杂度边界

```typescript
// packages/core-ast/src/ast-validator.ts
import { AppError } from '@mysql-mcp/core-engine';
import type { ExtractedTableRef } from './scope-extractor';

const FORBIDDEN_SYSTEM_DATABASES = new Set([
  'information_schema',
  'mysql',
  'performance_schema',
  'sys',
]);

const FORBIDDEN_FUNCTIONS = new Set([
  'sleep',
  'benchmark',
  'get_lock',
  'release_lock',
  'release_all_locks',
  'is_free_lock',
  'is_used_lock',
  'load_file',
  'wait_for_executed_gtid_set',
  'wait_until_sql_thread_after_gtids',
]);

export class AstValidator {
  public static validateReadOnlyAndSafety(
    rawSql: string,
    ast: any,
    extractedTables: ExtractedTableRef[]
  ): void {
    if (Buffer.byteLength(rawSql, 'utf8') > 16384) {
      throw new AppError({
        code: 'ERR_AST_COMPLEXITY',
        statusCode: 400,
        message: 'SQL query length exceeds 16KB maximum threshold.',
      });
    }

    if (Array.isArray(ast)) {
      if (ast.length !== 1) {
        throw new AppError({
          code: 'ERR_AST_FORBIDDEN_SYNTAX',
          statusCode: 403,
          message: 'Multiple SQL statements in a single call are strictly prohibited.',
        });
      }
      ast = ast[0];
    }

    const stmtType = String(ast?.type ?? '').toLowerCase();
    if (stmtType !== 'select') {
      throw new AppError({
        code: 'ERR_AST_FORBIDDEN_SYNTAX',
        statusCode: 403,
        message: `Statement type '${stmtType.toUpperCase()}' is prohibited by Read-Only Policy.`,
        actionGuidance: 'Only read-only SELECT statements are permitted.',
      });
    }

    if (extractedTables.length > 12) {
      throw new AppError({
        code: 'ERR_AST_COMPLEXITY',
        statusCode: 400,
        message: `Query references ${extractedTables.length} physical tables (max allowed: 12).`,
      });
    }

    for (const tbl of extractedTables) {
      if (FORBIDDEN_SYSTEM_DATABASES.has(tbl.database.toLowerCase())) {
        throw new AppError({
          code: 'ERR_AST_TABLE_DENIED',
          statusCode: 403,
          message: `Direct query on system database '${tbl.database}' is prohibited. Use list_tables or describe_table instead.`,
        });
      }
    }

    const inspectAstTree = (node: any, depth: number): void => {
      if (depth > 32) {
        throw new AppError({
          code: 'ERR_AST_COMPLEXITY',
          statusCode: 400,
          message: 'SQL AST nesting depth exceeds safety threshold.',
        });
      }
      if (!node || typeof node !== 'object') return;

      if (node.locking_read || node.lock_mode || node.for_update) {
        throw new AppError({
          code: 'ERR_AST_FORBIDDEN_SYNTAX',
          statusCode: 403,
          message: 'Locking read clauses (FOR UPDATE / LOCK IN SHARE MODE) are strictly prohibited.',
        });
      }

      if (node.into && node.into.expr) {
        throw new AppError({
          code: 'ERR_AST_FORBIDDEN_SYNTAX',
          statusCode: 403,
          message: 'SELECT INTO (OUTFILE / DUMPFILE / Variable) is strictly prohibited.',
        });
      }

      if (node.type === 'function' && node.name) {
        const fnName = String(
          node.name?.name?.[0]?.value ?? node.name?.value ?? node.name
        ).toLowerCase();
        if (FORBIDDEN_FUNCTIONS.has(fnName)) {
          throw new AppError({
            code: 'ERR_AST_FORBIDDEN_SYNTAX',
            statusCode: 403,
            message: `Dangerous function '${fnName.toUpperCase()}()' is prohibited.`,
          });
        }
      }

      for (const val of Object.values(node)) {
        if (val && typeof val === 'object') {
          inspectAstTree(val, depth + 1);
        }
      }
    };

    inspectAstTree(ast, 0);
  }
}
```

---

### 7.3 `LimitRewriter`: 集合运算 (`UNION`) 外层限定识别、Fail-Closed 改写与二次解析验证（闭环 `BE-R05`）

针对评审问题 **`BE-R05`**（在 `node-sql-parser@5.4.0` 中，`(SELECT * FROM orders LIMIT 1) UNION ALL SELECT * FROM orders` 的首分支括号内 `LIMIT 1` 挂在 `root.limit` 上，而第二分支 `root._next` 无 `LIMIT`；反之，`SELECT * FROM orders UNION ALL SELECT * FROM orders LIMIT 1` 的全局 `LIMIT 1` 挂在 `_next` 链条的末节点上），重构后的 `LimitRewriter` 严格检验整个 `_next` 集合链条：

1. **集合查询 (`root._next` 存在) 的严格判定准则**：
   - 收集 `_next` 链条上的全部查询分支 `[b_0, b_1, ..., b_k]`；
   - **情形 A（存在无括号的语句级末尾全局 `LIMIT`）**：最后一个分支 `b_k` 未被括号包裹（`!b_k.parentheses_symbol && !b_k.parentheses`）且 `b_k.limit` 存在并 `<= maxLimit`（在 MySQL 语法中，不带括号的末尾 `LIMIT` 作用域覆盖整条 `UNION` 的总输出）；
   - **情形 B（每个分支均显式带有独立 `LIMIT`，且各分支 `LIMIT` 之和 `<= maxLimit`）**；
   - **凡是不满足情形 A 且不满足情形 B 的任何 `UNION / UNION ALL` 查询（例如仅首分支带括号 `LIMIT 1` 而后续分支无 `LIMIT`，或末尾全局 `LIMIT > maxLimit`），一律触发 `ERR_AST_LIMIT_FAIL_CLOSED` 拒绝执行！**
2. **序列化后二次解析验证**：调用 `sqlify` 生成 SQL 后，再次通过 `astify` 解析验证语法树结构未被破坏。

```typescript
// packages/core-ast/src/limit-rewriter.ts
import { Parser } from 'node-sql-parser';
import { AppError } from '@mysql-mcp/core-engine';

const sqlParser = new Parser();

export class LimitRewriter {
  public static enforceSafeLimit(
    ast: any,
    defaultLimit: number,
    maxLimit: number
  ): string {
    const root = Array.isArray(ast) ? ast[0] : ast;
    if (!root || String(root.type ?? '').toLowerCase() !== 'select') {
      throw new AppError({
        code: 'ERR_AST_LIMIT_FAIL_CLOSED',
        statusCode: 400,
        message: 'Only SELECT AST can be rewritten with LIMIT.',
      });
    }

    // 处理包含 UNION / UNION ALL (_next 链表) 的复合查询 (修复 BE-R05)
    if (root._next) {
      const branches: any[] = [];
      let curr: any = root;
      while (curr) {
        branches.push(curr);
        curr = curr._next;
      }

      const lastBranch = branches[branches.length - 1];
      const lastLimit = LimitRewriter.extractLimitCount(lastBranch.limit);
      const isLastBranchParenthesized = Boolean(
        lastBranch.parentheses_symbol || lastBranch.parentheses
      );

      // 情形 A：末尾分支无括号且带有 <= maxLimit 的全局 LIMIT (如: SELECT ... UNION ALL SELECT ... LIMIT 1)
      const hasValidGlobalTailLimit =
        !isLastBranchParenthesized && lastLimit !== null && lastLimit >= 0 && lastLimit <= maxLimit;

      // 情形 B：每一个分支都显式声明了 LIMIT，且所有分支 LIMIT 总和 <= maxLimit
      const branchLimits = branches.map((b) => LimitRewriter.extractLimitCount(b.limit));
      const allBranchesBounded =
        branchLimits.every((lim): lim is number => lim !== null && lim >= 0 && lim <= maxLimit) &&
        branchLimits.reduce((acc, val) => acc + val, 0) <= maxLimit;

      if (!hasValidGlobalTailLimit && !allBranchesBounded) {
        throw new AppError({
          code: 'ERR_AST_LIMIT_FAIL_CLOSED',
          statusCode: 400,
          message: `Complex UNION query lacks a global LIMIT <= ${maxLimit} (branch-only LIMIT does not bound the entire UNION).`,
          actionGuidance: `Append an unparenthesized global 'LIMIT ${defaultLimit}' at the end of the UNION query.`,
        });
      }

      const sqlOut = sqlParser.sqlify(root, { database: 'MySQL' });
      sqlParser.astify(sqlOut, { database: 'MySQL' });
      return sqlOut;
    }

    // 普通单分支 SELECT 查询：注入 defaultLimit 或收缩超标的 LIMIT
    const currentLimit = LimitRewriter.extractLimitCount(root.limit);
    if (currentLimit === null) {
      root.limit = {
        seperator: '',
        value: [{ type: 'number', value: defaultLimit }],
      };
    } else if (currentLimit > maxLimit) {
      if (root.limit.seperator === 'offset' && root.limit.value.length === 2) {
        root.limit.value[0] = { type: 'number', value: maxLimit };
      } else if (root.limit.seperator === ',' && root.limit.value.length === 2) {
        root.limit.value[1] = { type: 'number', value: maxLimit };
      } else {
        root.limit.value = [{ type: 'number', value: maxLimit }];
      }
    }

    try {
      const rewrittenSql = sqlParser.sqlify(root, { database: 'MySQL' });
      sqlParser.astify(rewrittenSql, { database: 'MySQL' });
      return rewrittenSql;
    } catch {
      throw new AppError({
        code: 'ERR_AST_LIMIT_FAIL_CLOSED',
        statusCode: 400,
        message: 'Failed to safely rewrite SQL AST with LIMIT clause.',
        actionGuidance: `Please simplify your query or explicitly add 'LIMIT ${defaultLimit}'.`,
      });
    }
  }

  private static extractLimitCount(limitNode: any): number | null {
    if (!limitNode || !Array.isArray(limitNode.value) || limitNode.value.length === 0) {
      return null;
    }
    const rawVal =
      limitNode.seperator === ',' && limitNode.value.length === 2
        ? limitNode.value[1]?.value
        : limitNode.value[0]?.value;
    const num = Number(rawVal);
    return Number.isFinite(num) ? num : null;
  }
}
```

---

### 7.4 11 项 MCP Tools 底层逐一实现规范（参数化 SQL 与 ACL 静默过滤）

| 工具名 | 底层执行逻辑与安全过滤实现 |
| :--- | :--- |
| `01. list_profiles` | 从内存 `RegistryHub` 读取当前用户 `activeRoleIds` 关联的所有 `ACTIVE` Profile，返回 `{ name, displayName, environment, defaultDatabase }`。 |
| `02. switch_profile` | 校验目标 `profile_name` 在当前用户授权集合中；更新会话默认 Profile。 |
| `03. get_current_context` | 从当前 `RequestContextSnapshot` 返回 `{ username, activeRoles, activeProfile, activeDatabase, quotas }`。 |
| `04. list_databases` | 执行 `SHOW DATABASES`；剔除 `information_schema / mysql / performance_schema / sys`，逐一调用 `AclEvaluator.isDatabaseAllowed(dbName, snapshot.dbAcl)` 过滤。 |
| `05. use_database` | 校验 `AclEvaluator.isDatabaseAllowed(targetDb, snapshot.dbAcl)`，未授权抛 `403 ERR_AST_DATABASE_DENIED`。 |
| `06. list_tables` | 参数化查询 `information_schema.TABLES WHERE TABLE_SCHEMA = ?`；在内存中对每行调用 `AclEvaluator.isTableAllowed(db + '.' + row.name, snapshot.tableAcl)`，未授权表静默剔除。 |
| `07. describe_table` | 先校验 `AclEvaluator.isTableAllowed`，未授权抛 `403 ERR_AST_TABLE_DENIED`；通过后参数化查询 `COLUMNS` 与 `STATISTICS`。 |
| `08. sample_table_data` | 校验 `Table ACL`；强制 `limit = Math.min(Math.max(1, input.limit ?? 3), 10)`；返回前通过 `Masker.maskResultSet(columns, rows)` 对敏感列与 PII 值执行掩码。 |
| `09. get_column_distinct_values` | 校验 `Table ACL`；若目标列名命中高敏凭据规则直接拒绝；强制 `max_distinct = Math.min(input.max_distinct ?? 50, 200)`；纳入完整流式超时与 KILL 管控。 |
| `10. execute_query` | 走完整 10 步防护链路：AST 只读与高危函数校验 ➔ `ScopeExtractor` 全树物理表提取 ➔ 系统库拦截 ➔ `Database ACL` & `Table ACL` Default Deny ➔ `LimitRewriter` 改写 ➔ 六维同步二次鉴权 ➔ `rowsAsArray` 流式防爆执行。 |
| `11. explain_query` | 对入参 `sql` 执行与 `execute_query` 完全一致的 AST 只读校验 + 全树物理表提取 + 库表 ACL 校验 + `LimitRewriter` 校验；通过后执行 `EXPLAIN <sql>`。 |

---

### 7.5 动态脱敏流水线 (`Masker`): 敏感列名识别与单元格内容实时掩码

```typescript
// packages/security/src/masker.ts
const SENSITIVE_COLUMN_REGEX =
  /(?:pass(?:word|wd)?|secret|token|api_?key|private_?key|id_?card|identity_?no|mobile|phone|tel|bank_?card|credit_?card|cvv)/i;

const EMAIL_COLUMN_REGEX = /(?:email|mail)/i;

export class Masker {
  public static maskSqlText(sql: string): string {
    return sql
      .replace(/(password|secret|token|api_key)\s*=\s*'[^']*'/gi, "$1 = '***REDACTED***'")
      .replace(/\b(1[3-9]\d)\d{4}(\d{4})\b/g, '$1****$2')
      .replace(/\b([1-9]\d{5})(?:19|20)\d{6}(\d{3}[\dXx])\b/g, '$1********$2');
  }

  public static maskResultSet(columns: string[], rows: unknown[][]): unknown[][] {
    const colModes = columns.map((col) => {
      if (SENSITIVE_COLUMN_REGEX.test(col)) return 'STRICT_MASK';
      if (EMAIL_COLUMN_REGEX.test(col)) return 'EMAIL_MASK';
      return 'CONTENT_INSPECT';
    });

    return rows.map((row) =>
      row.map((cell, idx) => {
        if (cell === null || cell === undefined) return cell;
        const mode = colModes[idx];
        const str = String(cell);

        if (mode === 'STRICT_MASK') {
          if (str.length <= 4) return '******';
          return `${str.slice(0, 2)}****${str.slice(-2)}`;
        }
        if (mode === 'EMAIL_MASK') {
          return str.replace(/^([^@]{1,2})[^@]*(@.+)$/, '$1***$2');
        }
        if (/^1[3-9]\d{9}$/.test(str)) {
          return `${str.slice(0, 3)}****${str.slice(7)}`;
        }
        if (/^[1-9]\d{16}[\dXx]$/.test(str)) {
          return `${str.slice(0, 6)}********${str.slice(14)}`;
        }
        return cell;
      })
    );
  }
}
```