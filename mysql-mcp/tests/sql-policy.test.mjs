import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import sqlParser from 'node-sql-parser';
import { evaluateSql } from '../dist/sql/policy.js';
import { MAX_SQL_BYTES, SqlPolicyError } from '../dist/sql/ast.js';

const allowed = [
  ['SELECT id FROM notes WHERE id=1', 'L0'],
  ['SELECT demo.notes.id FROM demo.notes', 'L0'],
  ["SELECT '; /* not a comment */ --' AS value", 'L0'],
  ["SELECT 'it''s safe'", 'L0'],
  ['/* harmless ; */ SELECT id FROM notes -- trailing ;\n', 'L0'],
  ['SELECT 1 # harmless ;\n', 'L0'],
  ['SELECT `semi;colon` FROM `notes`', 'L0'],
  ['WITH c AS (SELECT id FROM notes) SELECT * FROM c', 'L0'],
  ['SELECT * FROM notes WHERE id IN (SELECT id FROM tags)', 'L0'],
  ['SELECT * FROM (SELECT id FROM notes) AS n', 'L0'],
  ['SELECT id FROM notes UNION ALL SELECT id FROM tags', 'L0'],
  ["SELECT COUNT(*),SUM(id),COALESCE(name,'x'),CAST(id AS CHAR) FROM notes n LEFT JOIN tags t ON n.id=t.id GROUP BY name HAVING COUNT(*)>1 ORDER BY name DESC LIMIT 10 OFFSET 2", 'L0'],
  ['EXPLAIN SELECT id FROM notes', 'L0'],
  ['DESCRIBE notes', 'L0'], ['SHOW TABLES', 'L0'], ['SHOW COLUMNS FROM notes', 'L0'],
  ["INSERT INTO notes(id,name) VALUES(1,'synthetic'),(2,'sample')", 'L1'],
  ['UPDATE notes SET id=2 WHERE id=1', 'L1'], ['DELETE FROM notes WHERE id=1', 'L1'],
  ['UPDATE notes SET id=2', 'L2'], ['DELETE FROM notes', 'L2'],
  ["CREATE TABLE notes(id INT PRIMARY KEY, name VARCHAR(50) NOT NULL DEFAULT 'x')", 'L2'],
  ['ALTER TABLE notes ADD COLUMN name VARCHAR(20)', 'L2'],
  ['ALTER TABLE notes DROP COLUMN name', 'L2'],
  ['ALTER TABLE notes MODIFY COLUMN id BIGINT', 'L2'],
  ['DROP TABLE notes', 'L2'], ['TRUNCATE TABLE notes', 'L2'],
  ['CREATE DATABASE demo', 'L2'], ['DROP DATABASE demo', 'L2'],
  ['ALTER DATABASE demo CHARACTER SET utf8mb4', 'L2'],
  ["INSERT INTO demo.notes(id,name) VALUES(1,'x'),(2,'y')", 'L1'],
  ["INSERT INTO notes VALUES(1,'x'),(2,'y')", 'L1'],
  ['INSERT INTO `demo`.`notes`(`id`,`name`) VALUES(ABS(-1),LOWER(\'X\'))', 'L1'],
  ['UPDATE demo.notes AS n SET n.id=ABS(n.id)+1, name=LOWER(name) WHERE demo.notes.id=1', 'L1'],
  ['UPDATE notes SET id=1 WHERE id IN (SELECT id FROM demo.tags)', 'L1'],
  ['UPDATE demo.notes SET name=\'x\',id=2', 'L2'],
  ['DELETE FROM demo.notes AS n WHERE n.id=1', 'L1'],
  ['DELETE FROM demo.notes WHERE id IN (SELECT id FROM demo.tags)', 'L1'],
  ['DELETE FROM demo.notes', 'L2'],
  ['UPDATE notes SET id=1 WHERE 1=1', 'L1'],
  ['DELETE FROM notes WHERE TRUE', 'L1'],
  ["CREATE TABLE IF NOT EXISTS demo.notes(id INT UNSIGNED PRIMARY KEY, amount DECIMAL(10,2) NULL DEFAULT 0, name VARCHAR(50) NOT NULL DEFAULT 'x')", 'L2'],
  ['CREATE TABLE `demo`.`notes`(active BOOLEAN DEFAULT TRUE, id INT DEFAULT NULL)', 'L2'],
  ['CREATE DATABASE IF NOT EXISTS demo DEFAULT CHARACTER SET=utf8mb4 DEFAULT COLLATE=utf8mb4_bin', 'L2'],
  ['CREATE DATABASE `demo` DEFAULT CHARSET=utf8mb4', 'L2'],
  ['CREATE DATABASE demo COLLATE=utf8mb4_bin', 'L2'],
  ["ALTER TABLE demo.notes ADD COLUMN name VARCHAR(20) NOT NULL DEFAULT 'x' FIRST", 'L2'],
  ['ALTER TABLE notes ADD name VARCHAR(20) AFTER id, DROP COLUMN old_name, MODIFY COLUMN id BIGINT UNSIGNED NOT NULL', 'L2'],
  ['ALTER TABLE notes MODIFY name VARCHAR(30) NULL DEFAULT NULL AFTER id', 'L2'],
  ['ALTER TABLE `demo`.`notes` DROP COLUMN `name`', 'L2'],
  ['ALTER DATABASE `demo` DEFAULT CHARACTER SET = utf8mb4 DEFAULT COLLATE = utf8mb4_bin', 'L2'],
  ['alter database demo charset=utf8mb4', 'L2'],
  ['ALTER DATABASE demo COLLATE=utf8mb4_bin', 'L2'],
  ['ALTER DATABASE demo COLLATE utf8mb4_bin CHARACTER SET utf8mb4', 'L2'],
  ['/* harmless */ ALTER /* gap */ DATABASE demo DEFAULT CHARSET utf8mb4 # tail\n', 'L2'],
  ['DROP TABLE IF EXISTS demo.notes', 'L2'],
  ['DROP DATABASE IF EXISTS demo', 'L2'],
  ['TRUNCATE `demo`.`notes`', 'L2'],
  ['INSERT INTO notes(id) VALUES((SELECT MAX(id) FROM demo.tags))', 'L1'],
  ['CREATE TABLE notes(id INT(11) UNSIGNED ZEROFILL, price DECIMAL(10,2), created DATETIME(6))', 'L2'],
  ['ALTER TABLE notes ADD COLUMN id INT PRIMARY KEY, MODIFY name VARCHAR(20) NOT NULL', 'L2'],
  ['ALTER DATABASE demo DEFAULT COLLATE utf8mb4_bin DEFAULT CHARSET utf8mb4', 'L2'],
  [`ALTER DATABASE demo CHARSET ${'x'.repeat(64)}`, 'L2'],
  ['SHOW COLUMNS FROM notes AS n', 'L0'],
];
for (const [sql, risk] of allowed) test(`classifies supported fixture ${allowed.findIndex(x => x[0] === sql) + 1} as ${risk}`, () => {
  const result = evaluateSql(sql, 'demo', 'change');
  assert.equal(result.risk_level, risk);
  assert.equal(result.requires_approval, risk !== 'L0');
  assert.deepEqual(result.risk_codes, risk === 'L2' ? ['HIGH_RISK'] : []);
  assert.equal(result.max_rows, 1000);
  assert.equal(result.max_response_bytes, 1048576);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.risk_codes));
  if (risk === 'L0') assert.equal(evaluateSql(sql, 'demo').risk_level, 'L0');
  else assert.throws(() => evaluateSql(sql, 'demo'), SqlPolicyError);
});

const denied = [
  'SELECT 1 # comment\r UNION SELECT SLEEP(1)',
  'SELECT 1 -- comment\r UNION SELECT * FROM other.notes',
  'SELECT\u00a01',
  '', '/* comment only */', 'SELECT', 'SELECT 1;', 'SELECT 1; SELECT 2',
  "SELECT 'x'; DELETE FROM notes", 'SELECT 1 /* unclosed', "SELECT 'unclosed",
  'SELECT * FROM other.notes', 'SELECT * FROM mysql.user', 'SELECT * FROM information_schema.tables',
  'SELECT * FROM performance_schema.threads', 'SELECT * FROM sys.version',
  'SELECT * FROM notes JOIN other.tags ON notes.id=tags.id',
  'WITH c AS (SELECT * FROM other.notes) SELECT * FROM c',
  'SELECT * FROM notes WHERE id IN (SELECT id FROM other.tags)',
  'SELECT id FROM notes UNION SELECT id FROM other.tags',
  'SELECT (SELECT SLEEP(1))', 'SELECT SLEEP(1)', 'SELECT GET_LOCK(\'x\',1)',
  "SELECT LOAD_FILE('/synthetic')", 'SELECT BENCHMARK(1000,1)', 'SELECT custom_function(1)',
  'SELECT demo.ABS(1)', 'SELECT @x', 'SELECT @@version', 'SELECT @x:=1',
  "SELECT * FROM notes INTO OUTFILE '/synthetic'", "SELECT 1 INTO DUMPFILE '/synthetic'", 'SELECT 1 INTO @x',
  'SELECT * FROM notes FOR UPDATE', 'SELECT * FROM notes LOCK IN SHARE MODE',
  'SELECT SQL_CALC_FOUND_ROWS * FROM notes', 'SELECT COUNT(*) OVER () FROM notes',
  'SELECT /*!50000 SLEEP(1) */ 1', 'SELECT /*M! SLEEP(1) */ 1', 'SELECT /*+ MAX_EXECUTION_TIME(1) */ 1',
  "SELECT 'a\\\'b'", 'SELECT "ambiguous"', 'SELECT \u0000',
  'USE demo', 'SET autocommit=0', 'BEGIN', 'START TRANSACTION', 'COMMIT', 'ROLLBACK', 'SAVEPOINT s',
  'CALL proc()', 'PREPARE s FROM \'SELECT 1\'', 'EXECUTE s', 'DEALLOCATE PREPARE s',
  "CREATE USER 'synthetic'@'localhost'", "GRANT SELECT ON demo.* TO 'synthetic'@'localhost'", 'FLUSH PRIVILEGES', 'KILL 1',
  "LOAD DATA INFILE '/synthetic' INTO TABLE notes", 'SHOW DATABASES', 'EXPLAIN UPDATE notes SET id=2',
  'CREATE VIEW v AS SELECT * FROM notes', 'CREATE TABLE notes AS SELECT * FROM tags',
  'CREATE TEMPORARY TABLE notes(id INT)', 'CREATE TABLE notes(id INT) ENGINE=MyISAM',
  'CREATE DATABASE other', 'DROP DATABASE other', 'DROP TABLE other.notes', 'TRUNCATE TABLE other.notes',
  'ALTER DATABASE demo READ ONLY=1', 'ALTER TABLE notes RENAME TO other',
  'ALTER TABLE notes ADD FOREIGN KEY (id) REFERENCES other.tags(id)',
  'DROP TABLE notes,tags', 'INSERT INTO notes SELECT * FROM tags',
  'INSERT INTO notes(id) VALUES(1) ON DUPLICATE KEY UPDATE id=2',
  'REPLACE INTO notes(id) VALUES(1)', 'UPDATE notes,tags SET notes.id=1',
  'DELETE notes FROM notes JOIN tags ON notes.id=tags.id', 'UPDATE notes SET id=1 LIMIT 1',
  'SELECT JSON_OBJECT(\'x\',1)', 'SELECT CASE WHEN id=1 THEN 2 END FROM notes',
  'INSERT INTO notes(id,id) VALUES(1,2)', 'INSERT INTO notes(id,ID) VALUES(1,2)',
  'INSERT INTO notes(`id`,id) VALUES(1,2)', 'INSERT INTO notes(id) VALUES(1,2)',
  'INSERT INTO notes(id,name) VALUES(1)', 'INSERT INTO notes(id,name) VALUES(1,2),(3)',
  'INSERT INTO notes VALUES(1),(2,3)', 'INSERT INTO notes VALUES(1,2),(3)',
  'INSERT INTO notes() VALUES()', 'INSERT INTO notes VALUES(),()',
  'INSERT IGNORE INTO notes(id) VALUES(1)', 'INSERT LOW_PRIORITY INTO notes(id) VALUES(1)',
  'INSERT HIGH_PRIORITY INTO notes(id) VALUES(1)', 'INSERT DELAYED INTO notes(id) VALUES(1)',
  'INSERT INTO notes PARTITION(p1)(id) VALUES(1)', 'INSERT INTO notes SET id=1',
  'INSERT INTO notes(id) VALUES(SLEEP(1))',
  'UPDATE notes JOIN tags ON notes.id=tags.id SET notes.id=1 WHERE notes.id=2',
  'UPDATE notes SET id=1 ORDER BY id', 'UPDATE notes SET id=1 WHERE id=2 LIMIT 1',
  'UPDATE notes SET id=1,id=2 WHERE id=3', 'UPDATE notes n SET tags.id=1 WHERE id=2',
  'UPDATE IGNORE notes SET id=1', 'UPDATE LOW_PRIORITY notes SET id=1',
  'WITH c AS (SELECT id FROM tags) UPDATE notes SET id=1 WHERE id=1',
  'WITH c AS (SELECT id FROM tags) DELETE FROM notes WHERE id=1',
  'DELETE FROM notes ORDER BY id', 'DELETE FROM notes WHERE id=1 LIMIT 1',
  'DELETE notes FROM notes WHERE id=1', 'DELETE n FROM notes n WHERE id=1',
  'DELETE notes,tags FROM notes JOIN tags ON notes.id=tags.id',
  'DELETE FROM notes USING notes JOIN tags ON notes.id=tags.id',
  'DELETE QUICK FROM notes WHERE id=1', 'DELETE IGNORE FROM notes WHERE id=1',
  'CREATE TABLE notes(id INT, id BIGINT)', 'CREATE TABLE notes(id INT, ID BIGINT)',
  'CREATE TABLE notes(id INT PRIMARY KEY, name INT PRIMARY KEY)',
  'CREATE TABLE notes(id INT, PRIMARY KEY(id))', 'CREATE TABLE notes(id INT UNIQUE)',
  'CREATE TABLE notes(id INT AUTO_INCREMENT)', 'CREATE TABLE notes(id INT CHECK(id>0))',
  'CREATE TABLE notes(id INT REFERENCES tags(id))', 'CREATE TABLE notes LIKE tags',
  'CREATE TABLE notes(id JSON)', 'CREATE TABLE notes(name VARCHAR(20) CHARACTER SET utf8mb4)',
  'CREATE TABLE notes(id INT GENERATED ALWAYS AS (1))',
  'CREATE TABLE notes(id INT DEFAULT ABS(1))', 'CREATE TABLE notes(updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
  'CREATE DATABASE demo CHARACTER SET utf8mb4 CHARSET latin1',
  'CREATE DATABASE demo COLLATE utf8mb4_bin COLLATE utf8mb4_unicode_ci',
  'CREATE DATABASE demo ENCRYPTION=\'Y\'', 'CREATE DATABASE IF EXISTS demo',
  'CREATE TABLE IF EXISTS notes(id INT)',
  'ALTER TABLE notes ADD COLUMN name VARCHAR(20) COLLATE utf8mb4_bin',
  'ALTER TABLE notes ADD COLUMN id INT AUTO_INCREMENT', 'ALTER TABLE notes ADD COLUMN id INT UNIQUE',
  'ALTER TABLE notes ADD COLUMN id INT CHECK(id>0)', 'ALTER TABLE notes ADD COLUMN id INT DEFAULT ABS(1)',
  'ALTER TABLE notes CHANGE COLUMN id note_id INT', 'ALTER TABLE notes RENAME COLUMN id TO note_id',
  'ALTER TABLE notes ADD INDEX id_idx(id)', 'ALTER TABLE notes DROP PRIMARY KEY',
  'ALTER TABLE notes ADD name INT, ALGORITHM=INSTANT', 'ALTER TABLE notes ADD name INT, LOCK=NONE',
  'ALTER TABLE notes CONVERT TO CHARACTER SET utf8mb4', 'ALTER TABLE notes ENGINE=InnoDB',
  'ALTER TABLE notes ADD COLUMN IF NOT EXISTS id INT', 'ALTER TABLE notes DROP COLUMN IF EXISTS id',
  'DROP TABLE IF NOT EXISTS notes', 'DROP DATABASE IF NOT EXISTS demo',
  'DROP TEMPORARY TABLE notes', 'DROP VIEW notes', 'TRUNCATE DATABASE demo',
  'ALTER DATABASE demo', 'ALTER DATABASE CHARACTER SET utf8mb4',
  'ALTER DATABASE IF EXISTS demo CHARSET utf8mb4', 'ALTER DATABASE IF NOT EXISTS demo CHARSET utf8mb4',
  'ALTER DATABASE demo CHARACTER utf8mb4', 'ALTER DATABASE demo CHARACTER SET',
  'ALTER DATABASE demo DEFAULT DEFAULT CHARSET utf8mb4', 'ALTER DATABASE demo CHARSET=utf8mb4 CHARSET=latin1',
  'ALTER DATABASE demo CHARACTER SET utf8mb4 CHARSET latin1',
  'ALTER DATABASE demo COLLATE utf8mb4_bin COLLATE utf8mb4_unicode_ci',
  'ALTER DATABASE demo CHARACTER SET utf8mb4 COLLATE utf8mb4_bin ENCRYPTION=\'Y\'',
  'ALTER DATABASE demo UPGRADE DATA DIRECTORY NAME', 'ALTER DATABASE demo ENCRYPTION=\'Y\'',
  'ALTER DATABASE demo CHARACTER SET=\'utf8mb4\'', 'ALTER DATABASE demo CHARSET=`utf8mb4`',
  'ALTER DATABASE demo CHARSET utf8mb4, COLLATE utf8mb4_bin',
  'ALTER DATABASE demo CHARSET utf8mb4 COLLATE=utf8mb4_bin SELECT 1',
  'ALTER DATABASE demo CHARSET utf8mb4; DROP DATABASE demo',
  'ALTER DATABASE demo CHARSET utf8mb4 /*! COLLATE latin1_bin */',
  'ALTER DATABASE `demo-x` CHARSET utf8mb4', 'ALTER DATABASE `dem``o` CHARSET utf8mb4',
  'ALTER DATABASE `演示` CHARSET utf8mb4', 'ALTER DATABASE demo.notes CHARSET utf8mb4',
  `ALTER DATABASE demo CHARSET ${'x'.repeat(65)}`,
  `ALTER DATABASE ${'d'.repeat(65)} CHARSET utf8mb4`,
  'ALTERDATABASE demo CHARSET utf8mb4', 'ALTER DATABASE`demo` CHARSET utf8mb4',
  'ALTER DATABASE demo CHARSET utf8mb4COLLATE utf8mb4_bin',
  'INSERT INTO notes(id) VALUES ROW(1)',
  'CREATE TABLE notes(id INT SIGNED)', 'CREATE TABLE notes(id INT) AUTO_INCREMENT=100',
  'CREATE DATABASE demo.demo', 'CREATE DATABASE demo CHARACTER SET \'utf8mb4\'',
  'CREATE SCHEMA demo', 'DROP SCHEMA demo', 'DROP DATABASE `demo`',
  'ALTER TABLE notes ADD COLUMN id INT COMMENT \'x\'',
  'ALTER TABLE notes ADD COLUMN id INT ON UPDATE CURRENT_TIMESTAMP',
  'ALTER TABLE notes ADD COLUMN id INT DEFAULT (1+2)',
  'ALTER SCHEMA demo CHARACTER SET utf8mb4',
  'ALTER DATABASE demo CHARSET utf8mb4 DEFAULT', 'ALTER DATABASE demo CHARSET==utf8mb4',
  'ALTER DATABASE demo CHARSET utf8mb4# tail\n COLLATE utf8mb4_bin READ ONLY=1'
];
const mismatchedFixtures = new Set([
  'SELECT 1 -- comment\r UNION SELECT * FROM other.notes',
  'SELECT * FROM other.notes', 'SELECT * FROM notes JOIN other.tags ON notes.id=tags.id',
  'WITH c AS (SELECT * FROM other.notes) SELECT * FROM c',
  'SELECT * FROM notes WHERE id IN (SELECT id FROM other.tags)', 'SELECT id FROM notes UNION SELECT id FROM other.tags',
  'CREATE DATABASE other', 'DROP DATABASE other', 'DROP TABLE other.notes', 'TRUNCATE TABLE other.notes'
]);
for (const [index, sql] of denied.entries()) test(`L3 rejects unsupported/unsafe fixture ${index + 1} without raw diagnostics`, () => {
  assert.throws(() => evaluateSql(sql, 'demo', 'change'), error => {
    assert.equal(error.code, mismatchedFixtures.has(sql) ? 'TARGET_MISMATCH' : 'SQL_NOT_ALLOWED');
    assert.equal(error.message, mismatchedFixtures.has(sql) ? 'SQL target does not match the requested database.' : 'SQL is outside the supported safety policy.');
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.throws(() => evaluateSql(sql, 'demo'), error => error instanceof SqlPolicyError && error.code === 'SQL_NOT_ALLOWED');
});

test('rejects missing, system, oversized and ambiguous database/channel inputs', () => {
  for (const database of [undefined, null, '', 'mysql', 'MYSQL', 'other.demo', 'a'.repeat(65)]) {
    assert.throws(() => evaluateSql('SELECT 1', database), SqlPolicyError);
  }
  assert.throws(() => evaluateSql('SELECT 1', 'demo', 'confirmed'), SqlPolicyError);
  assert.throws(() => evaluateSql(null, 'demo'), SqlPolicyError);
});
test('bounds UTF-8 size, token count, parser depth and AST traversal', () => {
  assert.throws(() => evaluateSql(`SELECT '${'x'.repeat(MAX_SQL_BYTES)}'`, 'demo'), SqlPolicyError);
  assert.throws(() => evaluateSql(`SELECT '${'中'.repeat(MAX_SQL_BYTES / 3)}'`, 'demo'), SqlPolicyError);
  assert.throws(() => evaluateSql(`SELECT ${'('.repeat(33)}1${')'.repeat(33)}`, 'demo'), SqlPolicyError);
  assert.throws(() => evaluateSql(`SELECT ${Array(4100).fill('1').join(',')}`, 'demo'), SqlPolicyError);
});
test('structure fingerprints hide literals but exact SQL digest distinguishes approval inputs', () => {
  const first = evaluateSql("SELECT id FROM notes WHERE name='synthetic-a' AND id=1", 'demo');
  const second = evaluateSql("select id from notes where name='synthetic-b' and id=2", 'demo');
  assert.equal(first.sql_fingerprint, second.sql_fingerprint);
  assert.notEqual(first.exact_sql_digest, second.exact_sql_digest);
  assert.match(first.sql_fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(first).includes('synthetic-a'));
});

const targetMismatches = [
  'INSERT INTO other.notes(id) VALUES(1)',
  'INSERT INTO notes(id) VALUES((SELECT id FROM other.tags LIMIT 1))',
  'UPDATE other.notes SET id=1 WHERE id=2',
  'UPDATE notes SET id=(SELECT id FROM other.tags LIMIT 1) WHERE id=2',
  'UPDATE demo.notes SET id=1 WHERE other.notes.id=2',
  'DELETE FROM other.notes WHERE id=1',
  'DELETE FROM notes WHERE id IN (SELECT id FROM other.tags)',
  'DELETE FROM demo.notes WHERE other.notes.id=1',
  'CREATE TABLE other.notes(id INT)', 'CREATE DATABASE IF NOT EXISTS other',
  'CREATE DATABASE `other` CHARACTER SET utf8mb4', 'CREATE DATABASE Demo',
  'ALTER TABLE other.notes ADD COLUMN id INT', 'ALTER TABLE Demo.notes DROP COLUMN id',
  'ALTER TABLE notes MODIFY COLUMN other.notes.id INT',
  'ALTER DATABASE other CHARSET utf8mb4', 'ALTER DATABASE `Demo` COLLATE utf8mb4_bin',
  'DROP TABLE IF EXISTS other.notes', 'DROP DATABASE IF EXISTS other',
  'TRUNCATE other.notes', 'SELECT demo.notes.id FROM Demo.notes'
];
for (const [index, sql] of targetMismatches.entries()) test(`checks every explicit database target ${index + 1}`, () => {
  for (const channel of ['change', 'query']) assert.throws(() => evaluateSql(sql, 'demo', channel), error => {
    assert.ok(error instanceof SqlPolicyError);
    assert.equal(error.code, channel === 'change' ? 'TARGET_MISMATCH' : 'SQL_NOT_ALLOWED');
    assert.equal(error.cause, undefined);
    assert.equal(error.stack, `SqlPolicyError: ${error.code}`);
    assert.ok(!error.message.includes(sql));
    return true;
  });
});

for (const database of ['mysql', 'information_schema', 'performance_schema', 'sys', 'MYSQL']) test(`system database ${database} never becomes an approval target`, () => {
  const sqls = [
    `INSERT INTO ${database}.notes(id) VALUES(1)`, `UPDATE ${database}.notes SET id=1`,
    `UPDATE notes SET id=(SELECT id FROM ${database}.notes LIMIT 1)`,
    `DELETE FROM ${database}.notes`, `CREATE TABLE ${database}.notes(id INT)`,
    `CREATE DATABASE ${database}`, `ALTER TABLE ${database}.notes DROP COLUMN id`,
    `ALTER DATABASE ${database} CHARACTER SET utf8mb4`, `DROP DATABASE ${database}`,
    `DROP TABLE ${database}.notes`, `TRUNCATE ${database}.notes`
  ];
  for (const sql of sqls) for (const channel of ['query', 'change']) assert.throws(
    () => evaluateSql(sql, 'demo', channel), error => error instanceof SqlPolicyError && error.code === 'SQL_NOT_ALLOWED'
  );
});

test('change fingerprints retain structure/exact digest contract without altering SQL', () => {
  const sqls = [
    ["INSERT INTO notes(id,name) VALUES(1,'x')", "/* note */ insert into notes(id,name) values(2,'y')"],
    ['UPDATE notes SET id=2 WHERE id=1', 'update notes set id=3 where id=2'],
    ['DELETE FROM notes WHERE id=1', 'delete from notes where id=2'],
    ["CREATE TABLE notes(id INT DEFAULT 1, name VARCHAR(20) DEFAULT 'x')", "create table notes(id int default 2, name varchar(20) default 'y')"],
    ['ALTER DATABASE demo CHARSET=utf8mb4', '/* note */ alter database demo charset = utf8mb4']
  ];
  const hash = value => createHash('sha256').update(value).digest('hex');
  for (const [first, second] of sqls) {
    const a = evaluateSql(first, 'demo', 'change');
    const b = evaluateSql(second, 'demo', 'change');
    assert.equal(a.sql_fingerprint, b.sql_fingerprint);
    assert.equal(a.exact_sql_digest, hash(first));
    assert.equal(b.exact_sql_digest, hash(second));
    assert.notEqual(a.exact_sql_digest, b.exact_sql_digest);
  }
  const alteration = evaluateSql('ALTER DATABASE demo CHARSET utf8mb4', 'demo', 'change');
  assert.equal(alteration.operation, 'ALTER');
  assert.notEqual(alteration.sql_fingerprint, evaluateSql('ALTER DATABASE demo CHARSET latin1', 'demo', 'change').sql_fingerprint);
});

test('ALTER DATABASE adapter remains bounded and consumes the entire input', () => {
  for (const sql of [
    `ALTER DATABASE demo CHARSET ${'x'.repeat(MAX_SQL_BYTES)}`,
    `ALTER DATABASE demo ${Array(4100).fill('DEFAULT').join(' ')}`,
    `ALTER DATABASE demo CHARSET ${'('.repeat(33)}utf8mb4${')'.repeat(33)}`
  ]) assert.throws(() => evaluateSql(sql, 'demo', 'change'), error => error instanceof SqlPolicyError && error.code === 'SQL_NOT_ALLOWED');
});

test('DML/DDL AST whitelist rejects unknown keys, resources and malformed nested shapes', t => {
  const parser = new sqlParser.Parser();
  const fixtures = [
    ['INSERT INTO notes(id) VALUES(1)', ast => { ast.modifiers = ['IGNORE']; }],
    ['INSERT INTO notes(id) VALUES(1)', ast => { ast.values.values[0].value.push({ type: 'number', value: 2 }); }],
    ['INSERT INTO notes(id) VALUES(1)', ast => { ast.values.unknown = true; }],
    ['INSERT INTO notes(id) VALUES(1)', ast => { ast.values.values[0].prefix = 'ROW'; }],
    ['INSERT INTO notes(id) VALUES(1)', ast => { ast.values.values[0].value[0].type = 'unknown'; }],
    ['INSERT INTO notes(id) VALUES(1)', ast => { ast.values.values[0].value[0].type = 'constructor'; }],
    ['INSERT INTO notes(id) VALUES(1)', ast => { ast.values.values[0].value[0].type = 'toString'; }],
    ['UPDATE notes SET id=1 WHERE id=2', ast => { ast.set[0].resource = 'table'; }],
    ['UPDATE notes SET id=1 WHERE id=2', ast => { ast.set[0].value = parser.astify('DELETE FROM notes'); }],
    ['DELETE FROM notes WHERE id=1', ast => { ast.from[0].using = ['id']; }],
    ['DELETE FROM notes WHERE id=1', ast => { ast.table[0].table = 'tags'; }],
    ['CREATE TABLE notes(id INT)', ast => { ast.create_definitions[0].resource = 'constraint'; }],
    ['CREATE TABLE notes(id INT)', ast => { ast.create_definitions[0].definition.unknown_option = true; }],
    ['CREATE TABLE notes(id INT)', ast => { ast.create_definitions[0].primary_key = 'unknown'; }],
    ['CREATE TABLE notes(id INT)', ast => { ast.if_not_exists = 'IF EXISTS'; }],
    ['CREATE TABLE notes(id INT)', ast => { ast.create_definitions[0].nullable = { type: 'not null', value: 'unknown' }; }],
    ['CREATE TABLE notes(id INT)', ast => { ast.create_definitions[0].definition.suffix = ['UNKNOWN']; }],
    ['CREATE TABLE notes(id INT)', ast => { ast.create_definitions[0].definition.length = -1; }],
    ['CREATE DATABASE demo', ast => { ast.database.schema[0].unknown = true; }],
    ['CREATE DATABASE demo CHARSET utf8mb4', ast => { ast.create_definitions[0].keyword = 'encryption'; }],
    ['ALTER TABLE notes ADD COLUMN id INT', ast => { ast.expr[0].action = 'rename'; }],
    ['ALTER TABLE notes ADD COLUMN id INT', ast => { ast.expr[0].resource = 'database'; }],
    ['ALTER TABLE notes ADD COLUMN id INT', ast => { ast.expr[0].suffix = { keyword: 'UNKNOWN' }; }],
    ['DROP TABLE notes', ast => { ast.prefix = 'unknown'; }],
    ['TRUNCATE TABLE notes', ast => { ast.unknown = true; }],
    [{ type: 'alter_database', database: 'demo', options: [{ keyword: 'collate', symbol: '=', value: { type: 'default', value: 'utf8mb4_bin' } }] }, ast => { ast.resource = 'database'; }],
    [{ type: 'alter_database', database: 'demo', options: [{ keyword: 'read only', symbol: '=', value: { type: 'number', value: 1 } }] }, () => {}],
    [{ type: 'alter_database', database: 'demo', options: [{ keyword: 'charset', symbol: '=', value: { type: 'default', value: 'utf8mb4' }, unknown: true }] }, () => {}]
  ];
  const asts = fixtures.map(([sql, mutate]) => {
    const ast = typeof sql === 'string' ? parser.astify(sql, { database: 'MySQL' }) : sql;
    mutate(ast);
    return ast;
  });
  const method = t.mock.method(sqlParser.Parser.prototype, 'astify');
  for (const ast of asts) {
    method.mock.mockImplementation(() => ast);
    assert.throws(() => evaluateSql('SELECT 1', 'demo', 'change'), error => error instanceof SqlPolicyError && error.code === 'SQL_NOT_ALLOWED');
  }
});

test('AST resource budgets apply to changes as well as reads', t => {
  const parser = new sqlParser.Parser();
  const deep = parser.astify('UPDATE notes SET id=1 WHERE id=2');
  for (let i = 0; i < 70; i++) deep.where = { type: 'unary_expr', operator: 'NOT', expr: deep.where };
  const wide = parser.astify('INSERT INTO notes(id) VALUES(1)');
  wide.values.values = Array.from({ length: 4000 }, () => ({ type: 'expr_list', value: [{ type: 'number', value: 1 }], prefix: null }));
  const method = t.mock.method(sqlParser.Parser.prototype, 'astify');
  for (const ast of [deep, wide]) {
    method.mock.mockImplementation(() => ast);
    assert.throws(() => evaluateSql('SELECT 1', 'demo', 'change'), error => error instanceof SqlPolicyError && error.code === 'SQL_NOT_ALLOWED');
  }
});

test('database identifier AST adaptation does not broaden the L0 function whitelist', () => {
  for (const sql of ['SELECT `ABS`(1)', 'INSERT INTO notes(id) VALUES(`ABS`(1))']) {
    for (const channel of ['query', 'change']) assert.throws(() => evaluateSql(sql, 'demo', channel),
      error => error instanceof SqlPolicyError && error.code === 'SQL_NOT_ALLOWED');
  }
});

test('ALTER DATABASE never confuses omitted targets with option keywords', () => {
  for (const database of ['default', 'DEFAULT', 'charset', 'CHARACTER', 'collate', 'IF']) {
    for (const sql of [
      `ALTER DATABASE ${database} CHARACTER SET utf8mb4`,
      `ALTER DATABASE ${database} COLLATE utf8mb4_bin`
    ]) assert.throws(() => evaluateSql(sql, database, 'change'), error => error instanceof SqlPolicyError && error.code === 'SQL_NOT_ALLOWED');
    assert.equal(evaluateSql(`ALTER DATABASE \`${database}\` CHARACTER SET utf8mb4`, database, 'change').risk_level, 'L2');
  }
});
