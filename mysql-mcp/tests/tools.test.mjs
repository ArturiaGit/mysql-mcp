import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ConnectionService, ReadToolService, ReadError, readError, databaseError, readTools,
  collectRows, READ_LIMITS, responseBytes, prepareReadonlySql, createMcpServer, mysqlReadSession } from '../dist/index.js';
import { metadataStatement, callbackOperation, driverColumns, streamQuery } from '../dist/sql/driver.js';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { BudgetTransport } from '../dist/mcp/transport.js';

const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const secret = 'SYNTHETIC_SECRET_MARKER';
const view = { id, name: 'synthetic', host: '127.0.0.1', port: 3306, username: 'synthetic', default_database: null, version: 1 };
const args = { connection_id: id, database: 'demo', sql: 'SELECT 1' };
const body = result => JSON.parse(result.content[0].text);
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = (rows, columns = [{ name: 'value', mysql_type: 'VARCHAR', encoding: 'text' }]) => ({ columns,
  rows: (async function* () { yield* rows; })() });
function fixture(query = async () => source([[1]]), timeout = 1000) {
  const calls = []; let opened = 0; let closed = 0; let leases = 0;
  const connections = {
    list: async () => [{ ...view, password: secret, credential_ref: secret }],
    withReadConnection: async (connectionId, signal, action) => {
      leases++;
      assert.equal(connectionId, id);
      if (signal.aborted) throw new ReadError('EXECUTION_TIMEOUT');
      return action({ ...view, password: secret });
    }
  };
  const factory = async (draft, database, signal) => {
    opened++; assert.equal(draft.password, secret);
    return { query: async (sql, values) => { calls.push({ sql, values, database }); return query(sql, values, database, signal); },
      close: async () => { closed++; } };
  };
  return { service: new ReadToolService(connections, factory, timeout), connections, factory, calls,
    get opened() { return opened; }, get closed() { return closed; }, get leases() { return leases; } };
}
function success(result) { assert.equal(result.isError, false); assert.equal(body(result).ok, true); return body(result).data; }
function failure(result, code) {
  assert.equal(result.isError, true); const parsed = body(result);
  assert.equal(parsed.ok, false); assert.equal(parsed.error.code, code);
  assert.ok(!JSON.stringify(result).includes(secret));
}

test('five strict schemas and discovery snapshots are independent', () => {
  const tools = readTools(); assert.equal(tools.length, 5);
  for (const tool of tools) { assert.equal(tool.inputSchema.additionalProperties, false); assert.equal(tool.annotations.readOnlyHint, true); }
  tools[0].inputSchema.additionalProperties = true;
  assert.equal(readTools()[0].inputSchema.additionalProperties, false);
});
test('list_connections strips credentials and never opens a database', async () => {
  const f = fixture(); const data = success(await f.service.call('list_connections', {}));
  assert.deepEqual(data, { items: [view], next_cursor: null }); assert.equal(f.opened, 0);
});
for (const [name, valid] of [['list_connections', {}], ['list_databases', { connection_id: id }],
  ['list_tables', { connection_id: id, database: 'demo' }], ['describe_table', { connection_id: id, database: 'demo', table: 'notes' }], ['query', args]]) {
  for (const extra of ['password', 'credential_ref', 'confirmed', 'max_rows']) test(`${name} rejects extra ${extra}`, async () => {
    const f = fixture(); failure(await f.service.call(name, { ...valid, [extra]: secret }), 'INVALID_ARGUMENT'); assert.equal(f.opened, 0);
  });
  for (const key of Object.keys(valid)) test(`${name} requires ${key}`, async () => {
    const f = fixture(); const invalid = { ...valid }; delete invalid[key];
    failure(await f.service.call(name, invalid), 'INVALID_ARGUMENT'); assert.equal(f.leases, 0);
  });
}
for (const invalid of [null, [], 42, 'text', { ...args, connection_id: -1 }, { ...args, connection_id: otherId + 'x' },
  { ...args, database: '' }, { ...args, database: 'other.db' }, { ...args, database: 'a'.repeat(65) },
  { ...args, database: 'a\n' }, { ...args, sql: '' }, { ...args, sql: 'a'.repeat(65537) }]) test(`invalid argument shape ${JSON.stringify(invalid).slice(0, 65)}`, async () => {
  const f = fixture(); failure(await f.service.call('query', invalid), 'INVALID_ARGUMENT'); assert.equal(f.leases, 0);
});
for (const sql of ['INSERT INTO t VALUES (1)', 'UPDATE t SET a=2 WHERE a=1', 'DELETE FROM t', 'DROP TABLE t', 'ALTER TABLE t ADD a INT',
  'TRUNCATE TABLE t', 'SELECT 1; SELECT 2', "SELECT 1 INTO OUTFILE '/tmp/synthetic'", "SELECT 1 INTO DUMPFILE '/tmp/synthetic'",
  'SET PASSWORD = 1', 'GRANT ALL ON t TO x', 'SELECT * FROM other_db.t', 'SELECT * FROM mysql.user',
  'SELECT SLEEP(1)', 'SELECT LOAD_FILE(1)', 'SELECT @x := 1', 'SELECT * FROM t FOR UPDATE', '/*! SELECT 1 */',
  'SHOW TABLES', 'EXPLAIN SELECT 1', 'SELECT * FROM t LIMIT -1']) test(`read channel denies ${sql}`, async () => {
  const f = fixture(); failure(await f.service.call('query', { ...args, sql }), 'SQL_NOT_ALLOWED'); assert.equal(f.leases, 0);
});
for (const [input, match] of [['SELECT 1', /LIMIT 1001$/], ['SELECT 1 LIMIT 10', /LIMIT 10$/],
  ['SELECT 1 LIMIT 0', /LIMIT 0$/], ['SELECT 1 LIMIT 2000 OFFSET 3', /LIMIT 1001 OFFSET 3$/],
  ['SELECT 1 LIMIT 3, 2000', /LIMIT 3, 1001$/], ['SELECT 1 UNION ALL SELECT 2', /LIMIT 1001$/],
  ['WITH x AS (SELECT 1 AS a) SELECT a FROM x', /LIMIT 1001$/]]) test(`AST bounded SQL ${input}`, () => {
  assert.match(prepareReadonlySql(input, 'demo'), match);
});
test('query preserves duplicate columns, BIGINT, DECIMAL, dates and binary encoding', async () => {
  const columns = ['BIGINT', 'DECIMAL', 'DATE', 'BLOB'].map((type, i) => ({ name: 'same', mysql_type: type, encoding: i === 3 ? 'base64' : 'text' }));
  const f = fixture(async () => source([['9007199254740993', '123.4567890123456789', '2026-10-07', Buffer.from([0, 255])]], columns));
  const data = success(await f.service.call('query', args));
  assert.deepEqual(data.rows, [['9007199254740993', '123.4567890123456789', '2026-10-07', 'AP8=']]);
  assert.equal(data.columns.length, 4); assert.equal(data.truncated, false); assert.equal(f.closed, 1);
});
test('list_databases has no implicit default database', async () => {
  const f = fixture(async () => source([['demo'], ['empty']]));
  assert.deepEqual(success(await f.service.call('list_databases', { connection_id: id })), { items: ['demo', 'empty'], next_cursor: null });
  assert.equal(f.calls[0].database, null); assert.equal(f.calls[0].sql, 'SHOW DATABASES');
});
test('list_tables emits tables/views and parameterizes explicit target', async () => {
  const f = fixture(async () => source([['notes', 'BASE TABLE'], ['summary', 'VIEW']], [{ name: 'name', mysql_type: 'text', encoding: 'text' }, { name: 'type', mysql_type: 'text', encoding: 'text' }]));
  assert.deepEqual(success(await f.service.call('list_tables', argsWithoutSql())), { items: [{ name: 'notes', type: 'table' }, { name: 'summary', type: 'view' }], next_cursor: null });
  assert.deepEqual(f.calls[0].values, ['demo']);
});
function argsWithoutSql() { return { connection_id: id, database: 'demo' }; }
test('empty tables are distinct from nonexistent table metadata', async () => {
  const f = fixture(async () => source([]));
  assert.deepEqual(success(await f.service.call('list_tables', argsWithoutSql())).items, []);
  failure(await f.service.call('describe_table', { ...argsWithoutSql(), table: 'missing' }), 'NOT_FOUND'); assert.equal(f.closed, 2);
});
test('describe_table maps columns/indexes, with injection-like identifiers only in value parameters', async () => {
  const f = fixture(async sql => sql.includes('COLUMNS') ? source([['id', 'bigint', 'NO', 'PRI', '1']], Array.from({ length: 5 }, (_, i) => ({ name: String(i), mysql_type: 'text', encoding: 'text' }))) :
    source([['PRIMARY', 'id', '0', '1']], Array.from({ length: 4 }, (_, i) => ({ name: String(i), mysql_type: 'text', encoding: 'text' }))));
  const table = "notes' OR 1=1 --";
  const data = success(await f.service.call('describe_table', { ...argsWithoutSql(), table }));
  assert.deepEqual(data, { columns: [{ name: 'id', mysql_type: 'bigint', nullable: false, primary_key: true, ordinal_position: 1 }], indexes: [{ name: 'PRIMARY', column: 'id', unique: true, sequence: 1 }] });
  for (const call of f.calls) { assert.ok(!call.sql.includes(table)); assert.deepEqual(call.values, ['demo', table]); }
});
test('concurrent database requests use separate sessions and never a default', async () => {
  const f = fixture(async (_sql, _values, db) => { await tick(); return source([[db]]); });
  const results = await Promise.all(['demo', 'other'].map(database => f.service.call('query', { ...args, database })));
  assert.deepEqual(results.map(result => success(result).rows[0][0]), ['demo', 'other']); assert.equal(f.opened, 2); assert.equal(f.closed, 2);
});
for (const code of ['DB_ACCESS_DENIED', 'NOT_FOUND', 'DB_ERROR']) test(`safe error and session cleanup ${code}`, async () => {
  const f = fixture(async () => { throw new ReadError(code); });
  failure(await f.service.call('query', args), code); assert.equal(f.closed, 1);
});
test('unknown errors discard message, stack, native code and credential markers', async () => {
  const f = fixture(async () => { throw Object.assign(new Error(`password=${secret} /home/private C:\\private Duplicate entry '${secret}'`), { code: 'UNKNOWN' }); });
  failure(await f.service.call('query', args), 'INTERNAL_ERROR'); assert.equal(f.closed, 1);
});
for (const [native, code] of [['ER_ACCESS_DENIED_ERROR', 'DB_ACCESS_DENIED'], ['ER_DBACCESS_DENIED_ERROR', 'DB_ACCESS_DENIED'],
  ['ER_TABLEACCESS_DENIED_ERROR', 'DB_ACCESS_DENIED'], ['ER_BAD_DB_ERROR', 'NOT_FOUND'], ['ER_NO_SUCH_TABLE', 'NOT_FOUND'], ['ECONNRESET', 'DB_ERROR']]) test(`native error whitelist ${native}`, () => {
  assert.equal(readError(databaseError({ code: native, message: secret })).code, code); assert.ok(!JSON.stringify(readError(databaseError({ code: native, message: secret }))).includes(secret));
});
test('row truncation reads only the 1001st sentinel and closes iterator', async () => {
  let read = 0; let ended = false;
  const rows = (async function* () { try { while (true) { read++; yield [read]; } } finally { ended = true; } })();
  const data = await collectRows({ columns: source([]).columns, rows });
  assert.equal(data.returned_rows, 1000); assert.equal(data.truncation_reason, 'row_limit'); assert.equal(read, 1001); assert.equal(ended, true);
});
test('exactly 1000 rows are complete', async () => { const data = await collectRows(source(Array.from({ length: 1000 }, (_, i) => [i]))); assert.equal(data.truncated, false); });
test('UTF8 and escaped large fields cap serialized cell bytes without splitting surrogate pairs', async () => {
  for (const value of ['😀'.repeat(40000), '\u0001'.repeat(70000), 'a'.repeat(70000)]) {
    const data = await collectRows(source([[value]])); assert.equal(data.truncated, true); assert.equal(data.truncation_reason, 'byte_limit');
    assert.ok(Buffer.byteLength(JSON.stringify(data.rows[0][0])) <= READ_LIMITS.max_field_bytes);
    assert.equal(Buffer.from(data.rows[0][0]).toString(), data.rows[0][0]);
  }
});
test('large binary cells are valid bounded base64', async () => {
  const data = await collectRows(source([[Buffer.alloc(70000, 255)]], [{ name: 'blob', mysql_type: 'BLOB', encoding: 'base64' }]));
  assert.equal(data.truncated, true); assert.equal(Buffer.from(data.rows[0][0], 'base64').toString('base64'), data.rows[0][0]);
});
test('columns are hard-capped and duplicate positions retained', async () => {
  const data = await collectRows(source([Array.from({ length: 129 }, (_, i) => i)], Array.from({ length: 129 }, () => source([]).columns[0])));
  assert.equal(data.columns.length, 128); assert.equal(data.rows[0].length, 128); assert.equal(data.truncated, true);
});
test('MCP escaped envelope is within 1MiB including a single oversize row', async () => {
  const columns = Array.from({ length: 128 }, () => source([]).columns[0]);
  const data = await collectRows(source([Array.from({ length: 128 }, () => '"'.repeat(70000))], columns));
  assert.equal(data.returned_rows, 0); assert.equal(data.truncated, true); assert.ok(responseBytes(data) <= READ_LIMITS.max_response_bytes);
  const many = await collectRows(source(Array.from({ length: 100 }, () => ['"'.repeat(30000)])));
  assert.equal(many.truncation_reason, 'byte_limit'); assert.ok(responseBytes(many) <= READ_LIMITS.max_response_bytes);
});
for (const invalid of [undefined, {}, new Date(), NaN, Infinity, 9007199254740992]) test(`reject ambiguous cell ${String(invalid)}`, async () => {
  await assert.rejects(collectRows(source([[invalid]])), { code: 'DB_ERROR' });
});
test('malformed row shape fails closed', async () => { await assert.rejects(collectRows(source([[1, 2]])), { code: 'DB_ERROR' }); });
test('metadata truncation is not falsely presented as a complete list', async () => {
  const f = fixture(async () => source(Array.from({ length: 1001 }, () => ['demo'])));
  failure(await f.service.call('list_databases', { connection_id: id }), 'RESOURCE_LIMIT'); assert.equal(f.closed, 1);
});
test('timeout aborts work but retains concurrency until actual completion', async () => {
  let release; let observedSignal;
  const f = fixture(async (_sql, _v, _db, signal) => { observedSignal = signal; await new Promise(resolve => { release = resolve; }); return source([[1]]); }, 10);
  failure(await f.service.call('query', args), 'EXECUTION_TIMEOUT'); assert.equal(observedSignal.aborted, true); assert.equal(f.closed, 0);
  release(); await tick(); assert.equal(f.closed, 1);
});
test('four slots held by hung reads reject a fifth before dispatch', async () => {
  const releases = [];
  const f = fixture(async () => { await new Promise(resolve => releases.push(resolve)); return source([]); }, 10);
  const pending = Array.from({ length: 4 }, () => f.service.call('query', args)); await tick();
  failure(await f.service.call('query', args), 'RESOURCE_LIMIT'); assert.equal(f.opened, 4);
  for (const result of await Promise.all(pending)) failure(result, 'EXECUTION_TIMEOUT');
  failure(await f.service.call('query', args), 'RESOURCE_LIMIT');
  releases.forEach(release => release()); await tick(); assert.equal(f.closed, 4);
});
test('pre-cancellation has zero dispatch; shutdown cancels active reads', async () => {
  const f = fixture(); const abort = new AbortController(); abort.abort();
  failure(await f.service.call('query', args, abort.signal), 'EXECUTION_TIMEOUT'); assert.equal(f.opened, 0);
  f.service.close(); failure(await f.service.call('query', args), 'SERVICE_UNAVAILABLE');
});
test('default factory rejects remote targets and pre-cancelled reads before sockets', async () => {
  await assert.rejects(mysqlReadSession({ ...view, host: 'example.invalid', password: secret }, 'demo', new AbortController().signal), { code: 'SERVICE_UNAVAILABLE' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(mysqlReadSession({ ...view, password: secret }, 'demo', controller.signal), { code: 'EXECUTION_TIMEOUT' });
});
test('real ConnectionService leases prevent edit/delete until all parallel readers settle', async () => {
  let stored = null; const secrets = new Map();
  const credentials = { getCredential: async ref => secrets.get(ref) ?? null, setCredential: async (ref, value) => secrets.set(ref, value), deleteCredential: async ref => { secrets.delete(ref); } };
  const service = new ConnectionService({ read: async () => stored, write: async data => { stored = structuredClone(data); } }, credentials);
  await service.initialize(); const saved = await service.create({ name: 'synthetic', host: '127.0.0.1', port: 3306, username: 'synthetic', password: secret });
  const releases = [];
  const pending = Array.from({ length: 2 }, () => service.withReadConnection(saved.id, new AbortController().signal, async draft => {
    assert.ok(Object.isFrozen(draft)); assert.ok(!('credential_ref' in draft)); await new Promise(resolve => releases.push(resolve));
  }));
  while (releases.length < 2) await tick();
  await assert.rejects(service.update(saved.id, { expected_version: 1, name: 'new' }), { code: 'STATE_CONFLICT' });
  await assert.rejects(service.remove(saved.id, { expected_version: 1 }), { code: 'STATE_CONFLICT' });
  releases[0](); await pending[0];
  await assert.rejects(service.update(saved.id, { expected_version: 1, name: 'new' }), { code: 'STATE_CONFLICT' });
  releases[1](); await pending[1]; await service.update(saved.id, { expected_version: 1, name: 'new' }); await service.close();
});
test('late credentials after timeout never dispatch and keep connection protected', async () => {
  let stored = null; let release; let secretValue;
  const credentials = { getCredential: async () => new Promise(resolve => { release = resolve; }), setCredential: async (_ref, value) => { secretValue = value; }, deleteCredential: async () => {} };
  const connections = new ConnectionService({ read: async () => stored, write: async data => { stored = structuredClone(data); } }, credentials);
  await connections.initialize();
  const item = await connections.create({ name: 'synthetic', host: '127.0.0.1', port: 3306, username: 'synthetic', password: secret });
  let opened = 0; const tools = new ReadToolService(connections, async () => { opened++; throw new Error(secret); }, 10);
  failure(await tools.call('query', { ...args, connection_id: item.id }), 'EXECUTION_TIMEOUT');
  await assert.rejects(connections.remove(item.id, { expected_version: 1 }), { code: 'STATE_CONFLICT' });
  release(secretValue); await tick(); assert.equal(opened, 0);
  await connections.remove(item.id, { expected_version: 1 }); await connections.close();
});
test('REAL SDK in-memory transport discovers and executes tools with text envelope', async () => {
  const f = fixture(); const server = await createMcpServer({ connections: f.connections, sessionFactory: f.factory });
  const client = new Client({ name: 'synthetic-client', version: '1.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    assert.equal((await client.listTools()).tools.length, 5);
    assert.deepEqual(success(await client.callTool({ name: 'list_connections', arguments: {} })).items, [view]);
    assert.equal(success(await client.callTool({ name: 'query', arguments: args })).returned_rows, 1);
    failure(await client.callTool({ name: 'query', arguments: { ...args, confirmed: true } }), 'INVALID_ARGUMENT');
  } finally { await client.close(); await server.close(); }
});
test('metadata binding is safe under NO_BACKSLASH_ESCAPES and ANSI_QUOTES', () => {
  const value = "x\\'; DROP TABLE synthetic; --";
  const bound = metadataStatement('SELECT name WHERE db = ? AND name = ?', ['demo', value]);
  assert.ok(!bound.includes(value));
  assert.ok(!bound.includes('DROP TABLE'));
  assert.match(bound, /CONVERT\(X'[0-9a-f]+' USING utf8mb4\)/);
  assert.ok(bound.includes(Buffer.from(value).toString('hex')));
  assert.throws(() => metadataStatement('SELECT ?', []), { code: 'INTERNAL_ERROR' });
  assert.throws(() => metadataStatement('SELECT 1', ['extra']), { code: 'INTERNAL_ERROR' });
});
test('active external cancellation aborts without retry and eventually closes the session', async () => {
  let observed; let release;
  const f = fixture(async (_sql, _values, _db, signal) => {
    observed = signal;
    await new Promise(resolve => { release = resolve; });
    return source([]);
  });
  const controller = new AbortController();
  const pending = f.service.call('query', args, controller.signal);
  while (!observed) await tick();
  controller.abort(); failure(await pending, 'EXECUTION_TIMEOUT');
  assert.equal(observed.aborted, true); assert.equal(f.opened, 1);
  release(); await tick(); assert.equal(f.closed, 1);
});
test('MCP transport disconnect cancels active execution, not only explicit server.close', async () => {
  let observed; let release;
  const f = fixture(async (_sql, _values, _db, signal) => {
    observed = signal;
    await new Promise(resolve => { release = resolve; });
    return source([]);
  });
  const server = await createMcpServer({ connections: f.connections, sessionFactory: f.factory });
  const client = new Client({ name: 'synthetic-client', version: '1.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  const pending = client.callTool({ name: 'query', arguments: args }).catch(() => null);
  while (!observed) await tick();
  await serverTransport.close();
  assert.equal(observed.aborted, true);
  release(); await tick(); assert.equal(f.closed, 1);
  await client.close(); await pending; await server.close();
});
test('driver callback adapter settles silent cancellation and connection-only errors', async () => {
  const connection = new EventEmitter(); const controller = new AbortController();
  const pending = callbackOperation(connection, controller.signal, () => {});
  controller.abort(); await assert.rejects(pending, { code: 'EXECUTION_TIMEOUT' });
  assert.equal(connection.listenerCount('error'), 0);
  const disconnected = callbackOperation(connection, new AbortController().signal, () => {});
  connection.emit('error', new Error(secret));
  await assert.rejects(disconnected, { code: 'DB_ERROR' });
  assert.equal(connection.listenerCount('error'), 0);
});
test('BIT driver fields map Buffer values to explicit base64', async () => {
  const columns = driverColumns([{ name: 'flag', columnType: 16, characterSet: 63 }]);
  assert.equal(columns[0].encoding, 'base64');
  const data = await collectRows(source([[Buffer.from([1])]], columns));
  assert.deepEqual(data.rows, [['AQ==']]); assert.equal(data.truncated, false);
});
test('transport validates full outgoing frames and bounds incoming IDs before dispatch', async () => {
  let received = 0; let sent = 0; let closed = 0; let inner;
  inner = { start: async () => {}, send: async () => { sent++; }, close: async () => { closed++; inner.onclose?.(); } };
  const transport = new BudgetTransport(inner); transport.onmessage = () => { received++; };
  await transport.start();
  inner.onmessage({ jsonrpc: '2.0', id: 1, method: 'ping' }); assert.equal(received, 1);
  await transport.send({ jsonrpc: '2.0', id: 1, result: {} }); assert.equal(sent, 1);
  await assert.rejects(transport.send({ jsonrpc: '2.0', id: 1, result: { value: 'x'.repeat(1_048_576) } }));
  assert.equal(sent, 1); assert.equal(closed, 1);
  const second = new BudgetTransport(inner); second.onmessage = () => { received++; }; await second.start();
  inner.onmessage({ jsonrpc: '2.0', id: 'x'.repeat(1_048_576), method: 'tools/call', params: { name: 'list_connections' } });
  assert.equal(received, 1); assert.equal(closed, 2);
});
test('driver stream adapter settles disconnect before and after fields and silent abort', async () => {
  for (const phase of ['before', 'after', 'abort']) {
    const connection = new EventEmitter(); const query = new EventEmitter();
    const stream = new PassThrough({ objectMode: true });
    query.stream = () => stream; connection.query = () => query;
    const controller = new AbortController();
    const pending = streamQuery(connection, 'SELECT 1', undefined, controller.signal);
    if (phase === 'after') {
      query.emit('fields', [{ name: 'one', columnType: 3, characterSet: 63 }]);
      const rows = await pending;
      const collecting = collectRows(rows);
      connection.emit('error', new Error(secret));
      await assert.rejects(collecting, { code: 'DB_ERROR' });
    } else {
      if (phase === 'abort') controller.abort(); else connection.emit('error', new Error(secret));
      await assert.rejects(pending, { code: phase === 'abort' ? 'EXECUTION_TIMEOUT' : 'DB_ERROR' });
    }
    await tick(); assert.equal(connection.listenerCount('error'), 0); assert.equal(stream.destroyed, true);
  }
});
