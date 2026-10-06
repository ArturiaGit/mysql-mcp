import assert from 'node:assert/strict';
import test from 'node:test';
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
  ['CREATE DATABASE demo', 'L2'], ['DROP DATABASE demo', 'L2']
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
  'ALTER DATABASE demo CHARACTER SET utf8mb4', 'ALTER TABLE notes RENAME TO other',
  'ALTER TABLE notes ADD FOREIGN KEY (id) REFERENCES other.tags(id)',
  'DROP TABLE notes,tags', 'INSERT INTO notes SELECT * FROM tags',
  'INSERT INTO notes(id) VALUES(1) ON DUPLICATE KEY UPDATE id=2',
  'REPLACE INTO notes(id) VALUES(1)', 'UPDATE notes,tags SET notes.id=1',
  'DELETE notes FROM notes JOIN tags ON notes.id=tags.id', 'UPDATE notes SET id=1 LIMIT 1',
  'SELECT JSON_OBJECT(\'x\',1)', 'SELECT CASE WHEN id=1 THEN 2 END FROM notes'
];
for (const [index, sql] of denied.entries()) test(`L3 rejects unsupported/unsafe fixture ${index + 1} without raw diagnostics`, () => {
  assert.throws(() => evaluateSql(sql, 'demo', 'change'), error => {
    assert.equal(error.code, 'SQL_NOT_ALLOWED');
    assert.equal(error.message, 'SQL is outside the supported safety policy.');
    assert.equal(error.cause, undefined);
    return true;
  });
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
