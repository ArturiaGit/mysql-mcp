import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ChangeManager, ChangeToolService, ConnectionService, JsonMetadataStorage, CHANGE_LIMITS, CHANGE_STATES,
  ServerError, CredentialStoreError, createLocalServer, changeTools, probeNative, nativeEligible, mysqlWriteSession } from '../dist/index.js';
import { writeError, databaseDdl, operation, preflight, initializeWriteSession } from '../dist/sql/write-driver.js';
import { readJournal, writeResult } from '../dist/changes/journal.js';

class Storage {
  data = null; history = []; failState; fail = false;
  async read() { return structuredClone(this.data); }
  async write(data) {
    if (this.fail || (this.failState !== undefined && data.items.some(item => item.state === this.failState))) throw new ServerError('SERVICE_UNAVAILABLE');
    this.data = structuredClone(data); this.history.push(structuredClone(data));
  }
}
class Credentials {
  key = randomBytes(32); values = new Map(); fail = false; gets = 0;
  async setCredential(id, secret) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    this.values.set(id, { iv, data, tag: cipher.getAuthTag() });
  }
  async getCredential(id) {
    this.gets++; if (this.fail) throw new CredentialStoreError();
    const entry = this.values.get(id); if (!entry) return null;
    const decipher = createDecipheriv('aes-256-gcm', this.key, entry.iv); decipher.setAuthTag(entry.tag);
    return Buffer.concat([decipher.update(entry.data), decipher.final()]).toString('utf8');
  }
  async deleteCredential(id) { this.values.delete(id); }
}
const draft = { name: 'Synthetic', host: '127.0.0.1', port: 3306, username: 'synthetic_user', default_database: null, password: 'synthetic-test-secret' };
const receipt = { affected_rows: 1, last_insert_id: 0, warning_count: 0 };
const insert = "INSERT INTO notes(id,name) VALUES(1,'synthetic-value')";
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const clean = value => assert.doesNotMatch(JSON.stringify(value), /synthetic-test-secret|credential_ref|"password"|stack|[A-Z]:\\/);
const code = (expected) => error => { assert.equal(error.code, expected); clean(error); return true; };
const decision = (detail, action = 'approve') => ({ decision: action, approval_nonce: detail.approval_nonce,
  sql_fingerprint: detail.sql_fingerprint, connection_version: detail.connection_version });
const decoded = result => JSON.parse(result.content[0].text);
async function until(predicate) {
  for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  assert.fail('Bounded test wait did not settle');
}
async function fixture(t, options = {}) {
  let now = 1_000_000;
  const credentials = options.credentials ?? new Credentials(); const metadata = new Storage();
  const connections = new ConnectionService(metadata, credentials); await connections.initialize();
  const connection = await connections.create(draft);
  const storage = options.storage ?? new Storage(); const calls = []; let closed = 0; let opened = 0;
  const factory = options.factory ?? (async (_draft, database, signal) => {
    opened++;
    return { execute: async sql => { assert.equal(signal.aborted, false); calls.push({ sql, database }); return { ...receipt }; }, close: async () => { closed++; } };
  });
  const changes = new ChangeManager({ connections, storage, sessionFactory: factory, timeoutMs: options.timeoutMs,
    now: () => now, managementUrl: () => 'http://127.0.0.1:3210' });
  await changes.initialize(); const session = changes.openSession();
  t.after(async () => { await changes.close(); await connections.close(); });
  const create = (sql = insert, extras = {}) => changes.create(session, { connection_id: connection.id, database: 'demo', sql, ...extras });
  const detail = request => changes.detail(request.request_id, 'browser-A');
  const approve = async request => changes.decide(request.request_id, decision(await detail(request)), 'browser-A');
  return { changes, session, connection, connections, storage, credentials, metadata, create, detail, approve, calls,
    advance: ms => { now += ms; }, get closed() { return closed; }, get opened() { return opened; } };
}

test('change schemas expose only two tools, no model approval channel, fresh strict definitions', () => {
  const tools = changeTools(); assert.deepEqual(tools.map(x => x.name), ['request_change', 'get_change_status']);
  for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(tools[0].annotations.readOnlyHint, false); assert.equal(tools[0].annotations.idempotentHint, false);
  assert.equal(tools[1].annotations.readOnlyHint, true);
  tools[0].inputSchema.properties.connection_id.type = 'number'; assert.equal(changeTools()[0].inputSchema.properties.connection_id.type, 'string');
  assert.deepEqual(CHANGE_STATES, ['PENDING', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'REJECTED', 'CANCELLED', 'EXPIRED', 'INVALIDATED']);
});
test('pending request has no dispatch/credential read, tool output and journal omit SQL/challenges', async t => {
  const f = await fixture(t); const request = await f.create(); clean(request);
  assert.equal(request.state, 'PENDING'); assert.equal(request.confirmation_channel, 'web');
  assert.match(request.management_url, /^http:\/\/127\.0\.0\.1:3210\/changes\?id=[0-9a-f-]+$/);
  assert.equal(f.opened, 0); assert.equal(f.credentials.gets, 0); assert.equal(f.calls.length, 0);
  assert.doesNotMatch(JSON.stringify(request), /synthetic-value|approval_nonce|sql_fingerprint|session/);
  assert.doesNotMatch(JSON.stringify(f.storage.data), /synthetic-value|approval_nonce|review_code|reason|"sql"|session_id/);
  const detail = await f.detail(request); assert.equal(detail.sql, insert); assert.match(detail.approval_nonce, /^[0-9a-f]{64}$/);
  assert.equal(Date.parse(detail.expires_at) - Date.parse(detail.created_at), 300_000);
  const status = await f.changes.status(f.session, request.request_id); assert.doesNotMatch(JSON.stringify(status), /approval_nonce|synthetic-value/);
});
for (const action of ['reject', 'cancel']) test(`web ${action} is terminal with zero dispatch, no challenge after decision`, async t => {
  const f = await fixture(t); const request = await f.create(); const detail = await f.detail(request);
  const result = await f.changes.decide(request.request_id, decision(detail, action), 'browser-A');
  assert.equal(result.state, action === 'reject' ? 'REJECTED' : 'CANCELLED'); assert.equal(f.calls.length, 0);
  assert.equal((await f.detail(request)).approval_nonce, undefined); assert.equal((await f.detail(request)).sql, undefined);
  await assert.rejects(f.changes.decide(request.request_id, decision(detail), 'browser-A'), code('STATE_CONFLICT'));
});
const allowedSql = [insert, 'UPDATE notes SET id=2 WHERE id=1', 'DELETE FROM notes WHERE id=1',
  'UPDATE notes SET id=2', 'DELETE FROM notes', 'CREATE TABLE notes(id INT PRIMARY KEY)', 'ALTER TABLE notes ADD COLUMN value INT',
  'ALTER TABLE notes MODIFY COLUMN value BIGINT', 'ALTER TABLE notes DROP COLUMN value', 'DROP TABLE notes', 'TRUNCATE TABLE notes',
  'CREATE DATABASE demo', 'ALTER DATABASE demo CHARACTER SET utf8mb4', 'DROP DATABASE demo'];
for (const [i, sql] of allowedSql.entries()) test(`approved supported DML/DDL dispatches exactly frozen SQL once (${i + 1})`, async t => {
  const f = await fixture(t); const request = await f.create(sql); const result = await f.approve(request);
  assert.equal(result.state, 'SUCCEEDED'); clean(result); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].sql, sql);
  assert.equal(f.calls[0].database, /DATABASE/.test(sql) ? null : 'demo'); assert.equal(f.closed, 1);
  assert.equal(result.result.affected_rows, 1); assert.ok(Number.isSafeInteger(result.result.execution_ms));
  const observed = f.storage.history.map(data => data.items[0]?.state).filter(Boolean);
  assert.deepEqual(observed.slice(-4), ['PENDING', 'APPROVED', 'EXECUTING', 'SUCCEEDED']);
});
for (const [i, body] of [
  { confirmed: true }, { approval_nonce: 'a'.repeat(64) }, { password: 'synthetic-test-secret' }, { credential_ref: randomUUID() },
  { session_id: randomUUID() }, { database: '' }, { database: 'other.demo' }, { connection_id: 'not-a-uuid' }, { reason: '' },
  { reason: 'x'.repeat(2049) }, { reason: '\n' }, { sql: '' }, { sql: 'x'.repeat(65_537) }, { sql: '\ud800' }
].entries()) test(`request rejects invalid/extra approval controls before credentials (${i + 1})`, async t => {
  const f = await fixture(t); await assert.rejects(f.create(insert, body), code('INVALID_ARGUMENT')); assert.equal(f.credentials.gets, 0);
});
for (const sql of ['SELECT 1', 'UPDATE notes SET id=1; DELETE FROM notes', 'BEGIN', 'GRANT SELECT ON demo.* TO user',
  "LOAD DATA INFILE '/synthetic' INTO TABLE notes", 'CALL unsafe_proc()', 'CREATE TRIGGER unsafe', 'INSERT INTO notes SELECT * FROM notes']) {
  test(`invalid change policy never creates a request (${sql.split(' ')[0]})`, async t => {
    const f = await fixture(t); await assert.rejects(f.create(sql), code('SQL_NOT_ALLOWED'));
    assert.equal(f.storage.data.items.length, 0); assert.equal(f.opened, 0);
  });
}
test('missing connection is NOT_FOUND, current session is not model-supplied', async t => {
  const f = await fixture(t); await assert.rejects(f.create(insert, { connection_id: randomUUID() }), code('NOT_FOUND'));
  const request = await f.create(); const other = f.changes.openSession();
  await assert.rejects(f.changes.status(other, request.request_id), code('NOT_FOUND'));
  await assert.rejects(f.changes.status(f.session, randomUUID()), code('NOT_FOUND'));
  await assert.rejects(f.changes.status(f.session, 'invalid'), code('INVALID_ARGUMENT'));
});
test('nonce is bound to request and authenticated browser; another session rotates it', async t => {
  const f = await fixture(t); const a = await f.create(); const b = await f.create(); const ad = await f.detail(a); const bd = await f.detail(b);
  await assert.rejects(f.changes.decide(b.request_id, decision(ad), 'browser-A'), code('STATE_CONFLICT'));
  await assert.rejects(f.changes.decide(a.request_id, decision(ad), 'browser-B'), code('STATE_CONFLICT'));
  const other = await f.changes.detail(a.request_id, 'browser-B'); assert.notEqual(other.approval_nonce, ad.approval_nonce);
  await assert.rejects(f.changes.decide(a.request_id, decision(ad), 'browser-A'), code('STATE_CONFLICT'));
  const rejected = await f.changes.decide(a.request_id, decision(other, 'reject'), 'browser-B'); assert.equal(rejected.state, 'REJECTED');
  assert.equal((await f.changes.decide(b.request_id, decision(bd, 'cancel'), 'browser-A')).state, 'CANCELLED');
});
test('SQL fingerprint mismatch consumes nonce and invalidates rather than approving a different payload', async t => {
  const f = await fixture(t); const request = await f.create(); const detail = await f.detail(request);
  await assert.rejects(f.changes.decide(request.request_id, { ...decision(detail), sql_fingerprint: 'f'.repeat(64) }, 'browser-A'), code('STATE_CONFLICT'));
  assert.equal((await f.changes.status(f.session, request.request_id)).state, 'INVALIDATED');
  assert.equal((await f.detail(request)).approval_nonce, undefined); assert.equal(f.calls.length, 0);
});
for (const method of ['update', 'remove']) test(`connection ${method} invalidates old waiting approvals synchronously`, async t => {
  const f = await fixture(t); const request = await f.create(); const detail = await f.detail(request);
  await f.connections[method](f.connection.id, { expected_version: 1, ...(method === 'update' ? { name: 'Updated synthetic' } : {}) });
  assert.equal((await f.changes.status(f.session, request.request_id)).state, 'INVALIDATED');
  await assert.rejects(f.changes.decide(request.request_id, decision(detail), 'browser-A'), code('CONNECTION_CHANGED')); assert.equal(f.calls.length, 0);
});
test('supplied stale connection version cannot approve even when fingerprint matches', async t => {
  const f = await fixture(t); const request = await f.create(); const detail = await f.detail(request);
  await assert.rejects(f.changes.decide(request.request_id, { ...decision(detail), connection_version: 2 }, 'browser-A'), code('CONNECTION_CHANGED'));
  assert.equal((await f.changes.status(f.session, request.request_id)).state, 'INVALIDATED');
});
test('TTL boundary is server-clock 5 minutes; nonce is cleared and records retire after bounded retention', async t => {
  const f = await fixture(t); const request = await f.create(); const detail = await f.detail(request);
  f.advance(299_999); assert.equal((await f.changes.status(f.session, request.request_id)).state, 'PENDING');
  f.advance(1); await f.changes.sweep(); assert.equal((await f.detail(request)).state, 'EXPIRED');
  assert.equal((await f.detail(request)).approval_nonce, undefined);
  await assert.rejects(f.changes.decide(request.request_id, decision(detail), 'browser-A'), code('APPROVAL_EXPIRED'));
  assert.equal(f.calls.length, 0); f.advance(300_000); await f.changes.sweep();
  await assert.rejects(f.changes.status(f.session, request.request_id), code('NOT_FOUND'));
});
test('parallel duplicate approve has one winner, one SQL dispatch, and no terminal reactivation', async t => {
  const f = await fixture(t); const request = await f.create(); const input = decision(await f.detail(request));
  const results = await Promise.allSettled([f.changes.decide(request.request_id, input, 'browser-A'), f.changes.decide(request.request_id, input, 'browser-A')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.calls.length, 1);
  await assert.rejects(f.changes.decide(request.request_id, input, 'browser-A'), code('STATE_CONFLICT'));
});
test('APPROVED is observable before dispatch; expiration before session readiness yields zero dispatch', async t => {
  const gate = deferred(); let calls = 0;
  const f = await fixture(t, { factory: async () => { await gate.promise; return { execute: async () => { calls++; return receipt; }, close: async () => {} }; } });
  const request = await f.create(); const task = f.approve(request);
  await until(async () => (await f.changes.status(f.session, request.request_id)).state === 'APPROVED');
  f.advance(300_000); await f.changes.sweep(); gate.resolve(); assert.equal((await task).state, 'EXPIRED'); assert.equal(calls, 0);
});
test('APPROVED allows authenticated cancel using a fresh one-time challenge', async t => {
  const gate = deferred(); let calls = 0;
  const f = await fixture(t, { factory: async () => { await gate.promise; return { execute: async () => { calls++; return receipt; }, close: async () => {} }; } });
  const request = await f.create(); const task = f.approve(request);
  await until(async () => (await f.changes.status(f.session, request.request_id)).state === 'APPROVED');
  const detail = await f.detail(request); assert.match(detail.approval_nonce, /^[0-9a-f]{64}$/);
  assert.equal((await f.changes.decide(request.request_id, decision(detail, 'cancel'), 'browser-A')).state, 'CANCELLED');
  gate.resolve(); await task; assert.equal(calls, 0);
});
test('EXECUTING holds exclusive connection lease against edit/delete/read and repeated approval', async t => {
  const gate = deferred(); let calls = 0;
  const f = await fixture(t, { factory: async () => ({ execute: async () => { calls++; await gate.promise; return receipt; }, close: async () => {} }) });
  const request = await f.create(); const input = decision(await f.detail(request)); const task = f.changes.decide(request.request_id, input, 'browser-A');
  await until(async () => (await f.changes.status(f.session, request.request_id)).state === 'EXECUTING');
  await assert.rejects(f.connections.update(f.connection.id, { expected_version: 1, name: 'new' }), code('STATE_CONFLICT'));
  await assert.rejects(f.connections.remove(f.connection.id, { expected_version: 1 }), code('STATE_CONFLICT'));
  await assert.rejects(f.connections.withReadConnection(f.connection.id, new AbortController().signal, async () => {}), code('STATE_CONFLICT'));
  await assert.rejects(f.changes.decide(request.request_id, input, 'browser-A'), code('STATE_CONFLICT'));
  gate.resolve(); assert.equal((await task).state, 'SUCCEEDED'); assert.equal(calls, 1);
  assert.equal((await f.connections.update(f.connection.id, { expected_version: 1, name: 'new' })).version, 2);
});
test('session close cancels pending, makes executing UNKNOWN, and suppresses late success', async t => {
  const gate = deferred(); const f = await fixture(t, { factory: async () => ({ execute: async () => { await gate.promise; return receipt; }, close: async () => {} }) });
  const waiting = await f.create(); const running = await f.create(); const task = f.approve(running);
  await until(async () => (await f.changes.status(f.session, running.request_id)).state === 'EXECUTING');
  f.changes.closeSession(f.session); gate.resolve(); await task;
  assert.equal((await f.changes.detail(waiting.request_id, 'browser-A')).state, 'CANCELLED');
  assert.equal((await f.changes.detail(running.request_id, 'browser-A')).state, 'UNKNOWN');
  await assert.rejects(f.changes.status(f.session, running.request_id), code('NOT_FOUND'));
});
for (const [i, native, state, expected] of [
  [{ code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000', message: "Duplicate entry 'synthetic-value' for key 'key'" }, 'FAILED', 'DB_ERROR'],
  [{ code: 'ER_TABLEACCESS_DENIED_ERROR', errno: 1142, sqlState: '42000', message: 'password=synthetic-test-secret' }, 'FAILED', 'DB_ACCESS_DENIED'],
  [{ code: 'ECONNRESET', message: 'synthetic-test-secret' }, 'UNKNOWN', 'DB_ERROR'],
  [{ code: 'PROTOCOL_CONNECTION_LOST' }, 'UNKNOWN', 'DB_ERROR'], [new Error('synthetic-test-secret'), 'UNKNOWN', 'DB_ERROR']
].map((x, i) => [i, ...x])) test(`driver fault maps safely to ${state} without automatic retry (${i + 1})`, async t => {
  let count = 0; const f = await fixture(t, { factory: async () => ({ execute: async () => { count++; throw native; }, close: async () => {} }) });
  const request = await f.create(); const result = await f.approve(request); clean(result);
  assert.equal(result.state, state); assert.equal(result.error_code, expected); assert.equal(count, 1);
  assert.match(result.effect_note, /retry/); for (let i = 0; i < 3; i++) await f.changes.status(f.session, request.request_id);
  assert.equal(count, 1); await assert.rejects(f.approve(request), code('INVALID_ARGUMENT'));
});
test('timeout AFTER dispatch is UNKNOWN; uncooperative dependency holds lease until settlement', async t => {
  const gate = deferred(); let calls = 0;
  const f = await fixture(t, { timeoutMs: 30, factory: async () => ({ execute: async () => { calls++; await gate.promise; return receipt; }, close: async () => {} }) });
  const request = await f.create(); assert.equal((await f.approve(request)).state, 'UNKNOWN');
  await assert.rejects(f.connections.update(f.connection.id, { expected_version: 1, name: 'new' }), code('STATE_CONFLICT'));
  gate.resolve(); await until(() => f.connections.update(f.connection.id, { expected_version: 1, name: 'new' }).then(() => true, () => false));
  assert.equal((await f.changes.status(f.session, request.request_id)).state, 'UNKNOWN'); assert.equal(calls, 1);
});
test('timeout BEFORE dispatch is FAILED and a late credential read cannot open a session', async t => {
  const f = await fixture(t, { timeoutMs: 30 }); const gate = deferred(); const original = f.credentials.getCredential.bind(f.credentials);
  f.credentials.getCredential = async id => { await gate.promise; return original(id); };
  const request = await f.create(); assert.equal((await f.approve(request)).state, 'FAILED'); gate.resolve();
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(f.calls.length, 0); assert.equal(f.opened, 0);
});
test('credential error and preflight failure are FAILED before any SQL dispatch', async t => {
  const f = await fixture(t); f.credentials.fail = true; const request = await f.create();
  assert.equal((await f.approve(request)).error_code, 'CREDENTIAL_STORE_UNAVAILABLE'); assert.equal(f.opened, 0);
  const g = await fixture(t, { factory: async () => ({ preflight: async () => { throw new ServerError('SQL_NOT_ALLOWED'); }, execute: async () => assert.fail(), close: async () => {} }) });
  const second = await g.create(); assert.equal((await g.approve(second)).state, 'FAILED');
});
for (const state of ['APPROVED', 'EXECUTING']) test(`journal failure at ${state} blocks dispatch and closes service fail-safe`, async t => {
  const f = await fixture(t); const request = await f.create(); f.storage.failState = state;
  if (state === 'APPROVED') await assert.rejects(f.approve(request), code('SERVICE_UNAVAILABLE'));
  else assert.equal((await f.approve(request)).state, 'FAILED');
  assert.equal(f.calls.length, 0); assert.equal((await f.changes.status(f.session, request.request_id)).state, 'FAILED');
  await assert.rejects(f.create(), code('SERVICE_UNAVAILABLE'));
});
test('failed durable success receipt is UNKNOWN and persisted intent recovers UNKNOWN without replay', async t => {
  const f = await fixture(t); const request = await f.create(); f.storage.failState = 'SUCCEEDED';
  assert.equal((await f.approve(request)).state, 'UNKNOWN'); assert.equal(f.calls.length, 1);
  assert.equal(f.storage.data.items[0].state, 'EXECUTING'); f.storage.failState = undefined;
  const recovered = new ChangeManager({ connections: f.connections, storage: f.storage, sessionFactory: async () => assert.fail(), now: () => 1_000_000 });
  await recovered.initialize(); t.after(() => recovered.close());
  assert.equal((await recovered.detail(request.request_id, 'browser')).state, 'UNKNOWN');
  const session = recovered.openSession(); await assert.rejects(recovered.status(session, request.request_id), code('NOT_FOUND'));
});
for (const state of ['PENDING', 'APPROVED', 'EXECUTING']) test(`crash snapshot ${state} restores summary only, never SQL/challenge/session ownership`, async t => {
  const f = await fixture(t); const request = await f.create(); const store = new Storage();
  store.data = structuredClone(f.storage.data); store.data.items[0].state = state;
  const recovered = new ChangeManager({ connections: f.connections, storage: store, sessionFactory: async () => assert.fail(), now: () => 1_000_000 });
  await recovered.initialize(); t.after(() => recovered.close());
  const detail = await recovered.detail(request.request_id, 'browser'); assert.equal(detail.state, state === 'EXECUTING' ? 'UNKNOWN' : 'INVALIDATED');
  assert.equal(detail.sql, undefined); assert.equal(detail.approval_nonce, undefined); clean(detail);
});
for (const bad of [{ schema_version: 2, items: [] }, { schema_version: 1, items: [], sql: insert }, { schema_version: 1, items: [{}] }]) {
  test('unknown/corrupt journal fails closed rather than being overwritten', () => assert.throws(() => readJournal(bad), code('SERVICE_UNAVAILABLE')));
}
test('request and session capacities are bounded; sweep safely releases expired capacity', async t => {
  const f = await fixture(t);
  for (let i = 1; i < CHANGE_LIMITS.max_sessions; i++) f.changes.openSession();
  assert.throws(() => f.changes.openSession(), code('RESOURCE_LIMIT'));
  for (let i = 0; i < CHANGE_LIMITS.max_requests; i++) await f.create();
  await assert.rejects(f.create(), code('RESOURCE_LIMIT'));
  f.advance(600_000); await f.changes.sweep(); f.advance(300_000); await f.changes.sweep(); assert.equal((await f.create()).state, 'PENDING');
});
test('global SQL/reason byte budget rejects additional pending content without trimming the reviewed SQL', async t => {
  const f = await fixture(t); const large = `INSERT INTO notes(name) VALUES('${'x'.repeat(60_000)}')`;
  for (let i = 0; i < 17; i++) await f.create(large);
  await assert.rejects(f.create(large), code('RESOURCE_LIMIT')); assert.equal(f.opened, 0);
});
test('result precision is preserved, unknown/oversized result fields never leak', () => {
  assert.equal(writeResult({ affected_rows: '18446744073709551615', last_insert_id: '9007199254740993', warning_count: 0 }).last_insert_id, '9007199254740993');
  for (const result of [{ ...receipt, password: 'synthetic-test-secret' }, { ...receipt, last_insert_id: Number.MAX_SAFE_INTEGER + 1 },
    { ...receipt, affected_rows: -1 }, { ...receipt, warning_count: 65536 }, { ...receipt, last_insert_id: '18446744073709551616' }]) assert.throws(() => writeResult(result));
});
test('invalid adapter success receipt is conservatively UNKNOWN after dispatch', async t => {
  const f = await fixture(t, { factory: async () => ({ execute: async () => ({ ...receipt, sql: insert }), close: async () => {} }) });
  assert.equal((await f.approve(await f.create())).state, 'UNKNOWN');
});
test('remote/default write session refuses outside loopback before opening any socket', async () => {
  await assert.rejects(mysqlWriteSession({ ...draft, host: 'synthetic.example.invalid' }, 'demo', new AbortController().signal), code('SERVICE_UNAVAILABLE'));
  assert.equal(databaseDdl('CREATE DATABASE demo', 'demo'), true); assert.equal(databaseDdl(insert, 'demo'), false);
});
test('write callback adapter handles disconnect/abort, settles once and removes listeners', async () => {
  const connection = new EventEmitter(); const abort = new AbortController(); let callback;
  const task = operation(connection, abort.signal, done => { callback = done; }); abort.abort();
  await assert.rejects(task, error => { assert.equal(error.uncertain, true); assert.equal(error.code, 'EXECUTION_TIMEOUT'); return true; });
  callback(undefined, receipt); assert.equal(connection.listenerCount('error'), 0);
  const failed = operation(connection, new AbortController().signal, () => {}); connection.emit('error', { code: 'ECONNRESET' });
  await assert.rejects(failed, error => error.uncertain === true); assert.equal(connection.listenerCount('error'), 0);
  const deterministic = writeError({ code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000' }); assert.equal(deterministic.uncertain, false);
  assert.equal(writeError({ code: 'ER_DUP_ENTRY' }).uncertain, true);
});

const reviewCode = params => params.message.match(/(?:review code:|approve:) ([0-9a-f]{64})/)[1];
const verified = { name: 'synthetic-client', version: '1.0.0', permission_mode: 'ask', evidence_id: 'synthetic-manual-reference',
  full_sql_display: true, per_request_prompt: true, accept_decline_cancel: true, no_auto_approve: true };
test('native eligibility requires exact client/version/mode and independent verification flags', () => {
  assert.equal(nativeEligible(verified.name, verified.version), false);
  const options = { permissionMode: 'ask', verifiedClients: [verified] }; assert.equal(nativeEligible(verified.name, verified.version, options), true);
  for (const mismatch of [{ version: '2' }, { permission_mode: 'auto' }, { no_auto_approve: false }, { evidence_id: '' }, { full_sql_display: false }]) {
    assert.equal(nativeEligible(verified.name, verified.version, { ...options, verifiedClients: [{ ...verified, ...mismatch }] }), false);
  }
});
test('no-side-effect native probe verifies accept/decline/cancel and rejects auto-accept', async () => {
  const actions = ['accept', 'decline', 'cancel']; let i = 0;
  assert.equal(await probeNative(async params => { const action = actions[i++]; return { action, ...(action === 'accept' ? { content: { review_code: reviewCode(params) } } : {}) }; }, new AbortController().signal), true);
  assert.equal(i, 3);
  assert.equal(await probeNative(async params => ({ action: 'accept', content: { review_code: reviewCode(params) } }), new AbortController().signal), false);
  assert.equal(await probeNative(async () => ({ action: 'accept', content: {} }), new AbortController().signal), false);
});
for (const action of ['accept', 'decline', 'cancel']) test(`native ${action} is bound to actual challenge, reject/cancel never use web fallback`, async t => {
  const f = await fixture(t); f.changes.setNativeElicitor(f.session, async params => {
    assert.ok(params.message.includes(insert)); assert.ok(params.message.includes(f.connection.id));
    return { action, ...(action === 'accept' ? { content: { review_code: reviewCode(params) } } : {}) };
  });
  const request = await f.create(); assert.equal(request.state, { accept: 'SUCCEEDED', decline: 'REJECTED', cancel: 'CANCELLED' }[action]);
  assert.equal(request.confirmation_channel, 'native'); assert.equal(f.calls.length, action === 'accept' ? 1 : 0);
  const detail = await f.detail(request); assert.equal(detail.approval_nonce, undefined);
});
test('native unbound generic acceptance cancels and high-risk always uses explicit web warning channel', async t => {
  const f = await fixture(t); f.changes.setNativeElicitor(f.session, async () => ({ action: 'accept', content: {} }));
  assert.equal((await f.create()).state, 'CANCELLED'); assert.equal(f.calls.length, 0);
  const high = await f.create('DELETE FROM notes'); assert.equal(high.confirmation_channel, 'web'); assert.deepEqual(high.risk_codes, ['HIGH_RISK']);
});
test('native transport failure revokes challenge before web fallback, then web may decide once', async t => {
  const f = await fixture(t); f.changes.setNativeElicitor(f.session, async () => { throw new Error('Synthetic unavailable transport'); });
  const request = await f.create(); assert.equal(request.state, 'PENDING'); assert.equal(request.confirmation_channel, 'web');
  assert.equal((await f.approve(request)).state, 'SUCCEEDED'); assert.equal(f.calls.length, 1);
});
test('late native approval after expiry has no authority and no alternate channel', async t => {
  const gate = deferred(); const f = await fixture(t); let params;
  f.changes.setNativeElicitor(f.session, async p => { params = p; return gate.promise; });
  const task = f.create(); await until(() => !!params); f.advance(300_000); await f.changes.sweep();
  gate.resolve({ action: 'accept', content: { review_code: reviewCode(params) } });
  const result = await task; assert.equal(result.state, 'EXPIRED'); assert.equal(result.confirmation_channel, 'native'); assert.equal(f.calls.length, 0);
});

async function httpFixture(t, options = {}) {
  const storage = new Storage(); const changeStorage = new Storage(); const calls = [];
  const server = await createLocalServer({ storage, changeStorage, credentials: new Credentials(), writeSessionFactory: async (_draft, database) => ({
    execute: async sql => { calls.push({ sql, database }); return receipt; }, close: async () => {} }), ...options });
  t.after(() => server.close());
  const base = { host: '127.0.0.1:3210', origin: 'http://127.0.0.1:3210' };
  const request = (method, url, payload, headers = {}) => server.inject({ method, url, headers: { ...base, ...headers }, ...(payload === undefined ? {} : { payload }) });
  const login = await request('POST', '/api/v1/session', { local_code: server.issueLocalCode() });
  const auth = { cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.json().data.csrf_token };
  const call = (method, url, payload, headers = {}) => request(method, url, payload, { ...auth, ...headers });
  const connection = (await call('POST', '/api/v1/connections', draft)).json().data;
  const mcp = await server.createMcpServer(options.mcp ?? {});
  const client = new Client({ name: 'synthetic-client', version: '1.0.0' }, { capabilities: options.capabilities ?? {} });
  if (options.elicit) client.setRequestHandler(ElicitRequestSchema, options.elicit);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await mcp.close(); });
  const create = async () => {
    const response = decoded(await client.callTool({ name: 'request_change', arguments: { connection_id: connection.id, database: 'demo', sql: insert } }));
    assert.equal(response.ok, true); return response.data;
  };
  return { server, mcp, client, connection, create, call, request, auth, calls, changeStorage };
}
test('REAL SDK + HTTP: seven tools, authenticated complete SQL review, CSRF approval, status-only polling', async t => {
  const f = await httpFixture(t); const names = (await f.client.listTools()).tools.map(tool => tool.name); assert.equal(names.length, 7);
  assert.ok(!names.includes('approve_change')); const request = await f.create(); const url = `/api/v1/changes/${request.request_id}`;
  const list = await f.call('GET', '/api/v1/changes'); assert.equal(list.statusCode, 200); clean(list.json());
  assert.doesNotMatch(list.body, /approval_nonce|synthetic-value/); assert.equal(list.headers['cache-control'], 'no-store');
  const detail = (await f.call('GET', url)).json().data; assert.equal(detail.sql, insert); assert.match(detail.approval_nonce, /^[0-9a-f]{64}$/);
  const result = await f.call('POST', `${url}/decision`, decision(detail)); assert.equal(result.statusCode, 200); assert.equal(result.json().data.state, 'SUCCEEDED');
  assert.equal(f.calls.length, 1);
  const status = decoded(await f.client.callTool({ name: 'get_change_status', arguments: { request_id: request.request_id } }));
  assert.equal(status.data.state, 'SUCCEEDED'); assert.equal(f.calls.length, 1); assert.doesNotMatch(JSON.stringify(status), /approval_nonce|synthetic-value/);
});
for (const [i, headers, status] of [[{ cookie: '' }, 401], [{ 'x-csrf-token': '' }, 403], [{ origin: 'http://evil.example' }, 403],
  [{ host: 'evil.example' }, 403], [{ cookie: '', authorization: 'Bearer synthetic-internal-token' }, 401]].map((x, i) => [i, ...x])) {
  test(`HTTP decision rejects browser authentication/CSRF/host/origin bypass (${i + 1})`, async t => {
    const f = await httpFixture(t); const request = await f.create(); const url = `/api/v1/changes/${request.request_id}`;
    const detail = (await f.call('GET', url)).json().data;
    const result = await f.call('POST', `${url}/decision`, decision(detail), headers); assert.equal(result.statusCode, status); clean(result.json()); assert.equal(f.calls.length, 0);
  });
}
for (const extra of [{ confirmed: true }, { sql: insert }, { session_id: randomUUID() }, { approval_nonce: 'wrong' }, { decision: 'retry' }]) {
  test('HTTP decision validates exact body and refuses model-provided overrides', async t => {
    const f = await httpFixture(t); const request = await f.create(); const url = `/api/v1/changes/${request.request_id}`;
    const detail = (await f.call('GET', url)).json().data;
    assert.equal((await f.call('POST', `${url}/decision`, { ...decision(detail), ...extra })).statusCode, 400); assert.equal(f.calls.length, 0);
  });
}
test('HTTP rejects query controls, unregistered approval paths, and unauthenticated detail/list', async t => {
  const f = await httpFixture(t); const request = await f.create(); const url = `/api/v1/changes/${request.request_id}`;
  for (const target of ['/api/v1/changes', url]) { assert.equal((await f.request('GET', target)).statusCode, 401); assert.equal((await f.call('GET', `${target}?confirmed=true`)).statusCode, 400); }
  assert.equal((await f.call('GET', '/api/v1/changes/invalid')).statusCode, 400);
  assert.equal((await f.call('POST', '/internal/v1/operations', { confirmed: true })).statusCode, 404);
  await assert.rejects(f.client.callTool({ name: 'approve_change', arguments: { request_id: request.request_id, confirmed: true } }));
});
test('tools reject extra fields and absent explicit change dependencies without exposing inputs', async () => {
  const tools = new ChangeToolService();
  for (const name of ['request_change', 'get_change_status']) {
    const result = decoded(await tools.call(name, { password: 'synthetic-test-secret', confirmed: true })); assert.equal(result.error.code, 'INVALID_ARGUMENT'); clean(result);
  }
  const result = decoded(await tools.call('request_change', { connection_id: randomUUID(), database: 'demo', sql: insert }));
  assert.equal(result.error.code, 'SERVICE_UNAVAILABLE'); tools.close();
});
test('REAL SDK native capability alone does not authorize elicitation or automatic approval', async t => {
  let prompted = 0;
  const f = await httpFixture(t, { capabilities: { elicitation: { form: {} } }, elicit: async () => { prompted++; return { action: 'accept', content: {} }; } });
  const request = await f.create(); assert.equal(request.confirmation_channel, 'web'); assert.equal(prompted, 0); assert.equal(f.calls.length, 0);
});
test('REAL SDK verified client probes all actions, then binds exact native SQL approval', async t => {
  let prompts = 0;
  const f = await httpFixture(t, { mcp: { nativeApproval: { permissionMode: 'ask', verifiedClients: [verified] } },
    capabilities: { elicitation: { form: {} } }, elicit: async request => {
      prompts++; const params = request.params;
      const action = params.message.includes('choose decline.') ? 'decline' : params.message.includes('choose cancel.') ? 'cancel' : 'accept';
      return { action, ...(action === 'accept' ? { content: { review_code: reviewCode(params) } } : {}) };
    } });
  await until(() => prompts === 3); await new Promise(resolve => setTimeout(resolve, 5));
  const request = await f.create(); assert.equal(request.confirmation_channel, 'native'); assert.equal(request.state, 'SUCCEEDED');
  assert.equal(prompts, 4); assert.equal(f.calls.length, 1);
});
test('journal actual atomic file storage holds writer lease and stores no replayable SQL', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mysql-mcp-change-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'changes.json'); const storage = new JsonMetadataStorage(file);
  const f = await fixture(t, { storage }); await f.create();
  assert.doesNotMatch(await readFile(file, 'utf8'), /synthetic-value|approval_nonce|"sql"|synthetic-test-secret/);
  const competing = new JsonMetadataStorage(file); await assert.rejects(competing.read(), code('SERVICE_UNAVAILABLE')); await competing.close();
});
test('native request cancellation actively settles an uncooperative responder and rejects late approval', async t => {
  const f = await fixture(t); const gate = deferred(); let params;
  f.changes.setNativeElicitor(f.session, async p => { params = p; return gate.promise; });
  const abort = new AbortController();
  const task = f.changes.create(f.session, { connection_id: f.connection.id, database: 'demo', sql: insert }, abort.signal);
  await until(() => !!params); abort.abort(); assert.equal((await task).state, 'CANCELLED');
  gate.resolve({ action: 'accept', content: { review_code: reviewCode(params) } });
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(f.calls.length, 0);
});
test('four global execution slots: fifth approval fails before dispatch; hanging jobs stay bounded', async t => {
  const gate = deferred(); let calls = 0;
  const f = await fixture(t, { factory: async () => ({ execute: async () => { calls++; await gate.promise; return receipt; }, close: async () => {} }) });
  const connections = [f.connection];
  for (let i = 0; i < 4; i++) connections.push(await f.connections.create(draft));
  const requests = [];
  for (const connection of connections) requests.push(await f.create(insert, { connection_id: connection.id }));
  const tasks = requests.slice(0, 4).map(request => f.approve(request));
  await until(() => calls === 4);
  const fifth = await f.approve(requests[4]); assert.equal(fifth.state, 'FAILED'); assert.equal(fifth.error_code, 'RESOURCE_LIMIT'); assert.equal(calls, 4);
  gate.resolve(); for (const result of await Promise.all(tasks)) assert.equal(result.state, 'SUCCEEDED');
});
function metadataConnection(options = {}) {
  const connection = new EventEmitter(); const statements = [];
  connection.query = (sql, done) => {
    statements.push(sql);
    const rows = sql === 'SHOW GRANTS' ? [{ grants: options.grant ?? 'GRANT SELECT, TRIGGER ON *.* TO synthetic_user' }, ...(options.revoked ? [{ revoke: 'REVOKE SELECT ON `demo`.* FROM synthetic_user' }] : [])] :
      sql.includes('TABLE_TYPE') ? [{ kind: options.kind ?? 'BASE TABLE' }] : sql.includes('TRIGGERS') ? [{ n: options.triggers ?? 0 }] : [{ n: options.references ?? 0 }];
    queueMicrotask(() => done(undefined, rows));
  };
  return { connection, statements };
}
test('default preflight allows verified base table, uses mode-independent bindings, never dispatches input SQL', async () => {
  const f = metadataConnection(); await preflight(f.connection, new AbortController().signal, insert, 'demo');
  assert.equal(f.statements.length, 4); assert.ok(f.statements.every(sql => sql !== insert));
  assert.ok(f.statements[1].includes("CONVERT(X'64656d6f' USING utf8mb4)"));
});
for (const options of [{ kind: 'VIEW' }, { triggers: 1 }, { references: 1 }, { grant: 'GRANT SELECT ON `demo`.* TO synthetic_user' }, { revoked: true }]) {
  test('default preflight refuses view/trigger/FK or unprovable/partially revoked metadata visibility', async () => {
    const f = metadataConnection(options);
    await assert.rejects(preflight(f.connection, new AbortController().signal, insert, 'demo'), code('SQL_NOT_ALLOWED'));
    assert.ok(f.statements.every(sql => sql !== insert));
  });
}
test('database DROP checks foreign keys crossing the exact database boundary', async () => {
  const f = metadataConnection({ references: 1 });
  await assert.rejects(preflight(f.connection, new AbortController().signal, 'DROP DATABASE demo', 'demo'), code('SQL_NOT_ALLOWED'));
  assert.ok(f.statements.at(-1).includes('TABLE_SCHEMA <>'));
});
test('CREATE and ALTER DATABASE do not depend on existing default database metadata', async () => {
  const f = metadataConnection();
  for (const sql of ['CREATE DATABASE demo', 'ALTER DATABASE demo CHARACTER SET utf8mb4']) await preflight(f.connection, new AbortController().signal, sql, 'demo');
  assert.equal(f.statements.length, 0);
});
test('session close during durable receipt write cannot expose/revive SUCCEEDED', async t => {
  const gate = deferred(); let writing = false; const storage = new Storage(); const write = storage.write.bind(storage);
  storage.write = async data => {
    if (data.items.some(item => item.state === 'SUCCEEDED')) { writing = true; await gate.promise; }
    await write(data);
  };
  const f = await fixture(t, { storage }); const request = await f.create(); const task = f.approve(request);
  await until(() => writing); f.changes.closeSession(f.session); gate.resolve();
  assert.equal((await task).state, 'UNKNOWN'); assert.equal(storage.data.items[0].state, 'UNKNOWN');
});
test('DML subquery source views are checked, not just the write target table', async () => {
  const f = metadataConnection(); const original = f.connection.query;
  f.connection.query = (sql, done) => {
    if (sql.includes('TABLE_TYPE') && sql.includes(Buffer.from('source_view').toString('hex'))) queueMicrotask(() => done(undefined, [{ kind: 'VIEW' }]));
    else original(sql, done);
  };
  await assert.rejects(preflight(f.connection, new AbortController().signal,
    'UPDATE notes SET id=2 WHERE id IN (SELECT id FROM source_view)', 'demo'), code('SQL_NOT_ALLOWED'));
});
test('write session explicitly enables autocommit only after successful authentication', async () => {
  const connection = new EventEmitter(); const actions = [];
  connection.connect = done => { actions.push('connect'); queueMicrotask(() => done()); };
  connection.query = (sql, done) => { actions.push(sql); queueMicrotask(() => done()); };
  await initializeWriteSession(connection, new AbortController().signal);
  assert.deepEqual(actions, ['connect', 'SET SESSION autocommit = 1']);
  connection.connect = done => queueMicrotask(() => done({ code: 'ER_ACCESS_DENIED_ERROR', errno: 1045, sqlState: '28000' }));
  actions.length = 0;
  await assert.rejects(initializeWriteSession(connection, new AbortController().signal), code('DB_ACCESS_DENIED'));
  assert.deepEqual(actions, []);
});
test('slow dispatch-intent persistence crossing approval deadline blocks SQL dispatch', async t => {
  const storage = new Storage(); const write = storage.write.bind(storage); let expire;
  storage.write = async data => {
    if (data.items.some(item => item.state === 'EXECUTING')) expire();
    await write(data);
  };
  const f = await fixture(t, { storage }); expire = () => f.advance(300_000);
  const result = await f.approve(await f.create());
  assert.equal(result.state, 'FAILED'); assert.equal(result.error_code, 'APPROVAL_EXPIRED'); assert.equal(f.calls.length, 0);
});
