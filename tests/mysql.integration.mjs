import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createServer as createAdmin } from '../apps/admin-api/dist/server.js';
import { createServer as createGateway } from '../apps/gateway/dist/server.js';
import { createMetadataPool, createMetadataQueryExecutor, readMetadataConfig } from '../packages/core-engine/dist/index.js';

const config = readMetadataConfig(process.env);
assert(config, 'Integration requires a real metadata database');

test('real MySQL 8.0: exact DDL inventory, PENDING, prepared values, BIGINT and recycled UTC session', async (t) => {
  const pool = createMetadataPool({ ...config, connectionLimit: 1 });
  t.after(() => pool.close());
  const db = createMetadataQueryExecutor(pool);
  const [[{ version }]] = await db.query('SELECT VERSION() AS version');
  assert.match(version, /^8\.0\.\d+/);
  assert(Number(version.split('.')[2]) >= 16);
  const [tables] = await db.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
  const ddl = readFileSync(new URL('../docs/sql/001_metadata_schema.sql', import.meta.url), 'utf8');
  const expected = [...ddl.matchAll(/^CREATE TABLE `([^`]+)`/gm)].map(([, name]) => name).sort();
  assert.equal(expected.length, 14);
  assert.deepEqual(tables.map(({ name }) => name).sort(), expected);
  const [[bootstrap]] = await db.query('SELECT setting_value FROM sys_system_settings WHERE setting_key = ?', ['bootstrap_state']);
  assert.equal(bootstrap.setting_value, 'PENDING');
  console.log(`MySQL ${version}; metadata base tables=${tables.length}; bootstrap_state=${bootstrap.setting_value}`);
  const max = '18446744073709551615';
  const [[before]] = await db.query('SELECT CONNECTION_ID() AS id, @@session.time_zone AS timezone, CAST(18446744073709551615 AS UNSIGNED) AS wide');
  assert.equal(before.timezone, '+00:00');
  assert.equal(before.wide, max);
  await db.query('SET SESSION time_zone = ?', ['+05:00']);
  await assert.rejects(db.query('SELECT nonexistent_column FROM sys_system_settings'));
  const [[after]] = await db.query('SELECT CONNECTION_ID() AS id, @@session.time_zone AS timezone');
  assert.equal(after.id, before.id);
  assert.equal(after.timezone, '+00:00');
  const literal = "literal'value";
  const [[value]] = await db.query('SELECT ? AS value', [literal]);
  assert.equal(value.value, literal);
  await assert.rejects(db.query('SELECT 1; SELECT 2'));
  console.log(`BIGINT=${before.wide} (${typeof before.wide}); reused session time_zone=${after.timezone}; prepared binding/multi-statement guard PASS`);
});

for (const [name, create, port] of [['admin-api', createAdmin, 8081], ['gateway', createGateway, 8080]]) {
  test(`${name}: real TCP HTTP and real MySQL readiness`, async (t) => {
    const listener = create(config, {});
    t.after(() => listener.close());
    const base = await listener.listen({ host: '127.0.0.1', port });
    for (const [route, expected, body] of [['live', 200, { status: 'ok' }], ['ready', name === 'admin-api' ? 503 : 200, { status: name === 'admin-api' ? 'not_ready' : 'ready' }]]) {
      const response = await fetch(`${base}/health/${route}`, { signal: AbortSignal.timeout(5_000) });
      assert.equal(response.status, expected);
      assert.deepEqual(await response.json(), body);
      console.log(`${name} ${base}/health/${route} -> ${response.status} ${JSON.stringify(body)}`);
    }
  });
  test(`${name}: live stays 200 and ready fails closed when MySQL rejects the connection`, async (t) => {
    const listener = create({ ...config, database: `${config.database}_m0_absent` });
    t.after(() => listener.close());
    const base = await listener.listen({ host: '127.0.0.1', port: 0 });
    const ready = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), { status: 'not_ready' });
    const live = await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(live.status, 200);
    await live.json();
    console.log(`${name} invalid DB: /health/ready -> ${ready.status}; /health/live -> ${live.status}`);
  });
}
