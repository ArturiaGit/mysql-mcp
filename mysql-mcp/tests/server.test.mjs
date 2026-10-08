import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalServer, ConnectionService, JsonMetadataStorage, CredentialStoreError, ServerError, sanitizeError } from 'mysql-mcp';

// Test-only AES-GCM provider: never exported by production code.
class Credentials {
  values = new Map(); key = randomBytes(32); failSet = false; failDelete = false; failGet = false;
  async setCredential(ref, secret) {
    if (this.failSet) throw new CredentialStoreError();
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    this.values.set(ref, { iv, data, tag: cipher.getAuthTag() });
  }
  async getCredential(ref) {
    if (this.failGet) throw new CredentialStoreError();
    const entry = this.values.get(ref); if (!entry) return null;
    const decipher = createDecipheriv('aes-256-gcm', this.key, entry.iv); decipher.setAuthTag(entry.tag);
    return Buffer.concat([decipher.update(entry.data), decipher.final()]).toString('utf8');
  }
  async deleteCredential(ref) { if (this.failDelete) throw new CredentialStoreError(); this.values.delete(ref); }
}
class Storage {
  data = null; fail = false; writes = 0; failAt = Infinity;
  async read() { return structuredClone(this.data); }
  async write(data) { if (this.fail || this.writes === this.failAt) throw new ServerError('SERVICE_UNAVAILABLE'); this.data = structuredClone(data); this.writes++; }
}
const draft = { name: 'Synthetic connection', host: '127.0.0.1', port: 3306, username: 'synthetic_user', default_database: null, password: 'synthetic-test-secret' };
const host = '127.0.0.1:3210';
const base = { host, origin: `http://${host}` };
async function fixture(t, options = {}) {
  const storage = options.storage ?? new Storage(); const credentials = options.credentials ?? new Credentials();
  const server = await createLocalServer({ storage, credentials, changeStorage: new Storage(), ...options });
  t.after(() => server.close());
  const request = (method, url, payload, headers = {}) => server.inject({ method, url, headers: { ...base, ...headers }, ...(payload === undefined ? {} : { payload }) });
  const login = async () => {
    const code = server.issueLocalCode();
    const response = await request('POST', '/api/v1/session', { local_code: code });
    assert.equal(response.statusCode, 200);
    return { cookie: response.headers['set-cookie'].split(';')[0], 'x-csrf-token': response.json().data.csrf_token, code, response };
  };
  const session = await login();
  const call = (method, url, payload, headers = {}) => request(method, url, payload, { cookie: session.cookie, 'x-csrf-token': session['x-csrf-token'], ...headers });
  return { storage, credentials, server, request, login, session, call };
}
const clean = response => {
  assert.doesNotMatch(response.body, /synthetic-test-secret|credential_ref|"password"|stack|[A-Z]:\\/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
};
const codeError = (response, status, code) => { assert.equal(response.statusCode, status); assert.equal(response.json().error.code, code); clean(response); };

test('session is HttpOnly/Strict, high entropy, one-use and does not return its cookie secret', async t => {
  const f = await fixture(t); const response = f.session.response;
  assert.match(response.headers['set-cookie'], /HttpOnly; SameSite=Strict; Max-Age=1800/);
  assert.match(f.session['x-csrf-token'], /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(response.body, new RegExp(f.session.cookie.split('=')[1]));
  codeError(await f.request('POST', '/api/v1/session', { local_code: f.session.code }), 401, 'UNAUTHENTICATED');
});
for (const invalid of [undefined, 'mysql_mcp_session=forged', 'Bearer internal-token']) {
  test(`missing/forged browser session is rejected (${String(invalid)})`, async t => {
    const f = await fixture(t);
    codeError(await f.request('GET', '/api/v1/connections', undefined, invalid ? { cookie: invalid, authorization: 'Bearer internal-token' } : {}), 401, 'UNAUTHENTICATED');
  });
}
for (const headers of [
  { host: 'evil.example:3210' }, { host: '127.0.0.1:3211' }, { host: '127.0.0.1:3210.evil.example' },
  { origin: 'https://127.0.0.1:3210' }, { origin: 'http://evil.example' }, { origin: 'null' },
  { origin: 'http://localhost:3210' }, { origin: 'http://127.0.0.1:3210/' }, { 'sec-fetch-site': 'cross-site' }
]) {
  test(`host/origin rejects ${JSON.stringify(headers)}`, async t => {
    const f = await fixture(t);
    codeError(await f.call('GET', '/api/v1/connections', undefined, headers), 403, 'FORBIDDEN');
    codeError(await f.request('POST', '/api/v1/session', { local_code: f.server.issueLocalCode() }, headers), 403, 'FORBIDDEN');
  });
}
test('localhost alias requires its exact origin and proxy headers cannot override host', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('GET', '/api/v1/connections', undefined, { host: 'localhost:3210', origin: 'http://localhost:3210' })).statusCode, 200);
  codeError(await f.call('GET', '/api/v1/connections', undefined, { host: 'evil.example', 'x-forwarded-host': host }), 403, 'FORBIDDEN');
});
for (const [method, url, payload] of [
  ['POST', '/api/v1/connections', draft], ['PATCH', `/api/v1/connections/${randomUUID()}`, { expected_version: 1, name: 'new' }],
  ['DELETE', `/api/v1/connections/${randomUUID()}`, { expected_version: 1 }], ['DELETE', '/api/v1/session'],
  ['POST', '/api/v1/connections/test', draft], ['POST', `/api/v1/connections/${randomUUID()}/test`, { expected_version: 1 }]
]) {
  test(`CSRF required before ${method} ${url.split('/').at(-1)}`, async t => {
    const f = await fixture(t);
    for (const csrf of ['', 'wrong']) codeError(await f.call(method, url, payload, { 'x-csrf-token': csrf }), 403, 'FORBIDDEN');
    assert.equal(f.storage.writes, 0);
  });
}
test('CSRF cannot be borrowed from another session, duplicate cookies rejected, logout invalidates', async t => {
  const f = await fixture(t); const second = await f.login();
  codeError(await f.call('POST', '/api/v1/connections', draft, { 'x-csrf-token': second['x-csrf-token'] }), 403, 'FORBIDDEN');
  codeError(await f.call('GET', '/api/v1/connections', undefined, { cookie: `${f.session.cookie}; ${second.cookie}` }), 401, 'UNAUTHENTICATED');
  const response = await f.call('DELETE', '/api/v1/session'); assert.equal(response.statusCode, 200);
  assert.match(response.headers['set-cookie'], /Max-Age=0/);
  codeError(await f.call('GET', '/api/v1/connections'), 401, 'UNAUTHENTICATED');
  assert.equal((await f.request('GET', '/api/v1/connections', undefined, { cookie: second.cookie })).statusCode, 200);
});
test('local code and session expire using server clock', async t => {
  let now = 1_000_000; const f = await fixture(t, { now: () => now });
  const code = f.server.issueLocalCode(); now += 300_000;
  codeError(await f.request('POST', '/api/v1/session', { local_code: code }), 401, 'UNAUTHENTICATED');
  now += 1_500_000;
  codeError(await f.call('GET', '/api/v1/connections'), 401, 'UNAUTHENTICATED');
});
test('login attempts are limited and recover after window', async t => {
  let now = 1_000_000; const f = await fixture(t, { now: () => now });
  for (let i = 0; i < 9; i++) codeError(await f.request('POST', '/api/v1/session', { local_code: 'wrong' }), 401, 'UNAUTHENTICATED');
  codeError(await f.request('POST', '/api/v1/session', { local_code: 'wrong' }), 429, 'RESOURCE_LIMIT');
  now += 60_000; assert.equal((await f.login()).response.statusCode, 200);
});
test('session extra controls, oversized/malformed JSON and unknown routes are safely rejected', async t => {
  const f = await fixture(t);
  codeError(await f.request('POST', '/api/v1/session', { local_code: f.server.issueLocalCode(), confirmed: true }), 400, 'INVALID_ARGUMENT');
  codeError(await f.call('POST', '/api/v1/connections', { ...draft, name: 'a'.repeat(20_000) }), 400, 'INVALID_ARGUMENT');
  codeError(await f.server.inject({ method: 'POST', url: '/api/v1/connections', headers: { ...base, cookie: f.session.cookie, 'x-csrf-token': f.session['x-csrf-token'], 'content-type': 'application/json' }, payload: '{broken' }), 400, 'INVALID_ARGUMENT');
  codeError(await f.call('GET', '/api/v1/unknown'), 404, 'NOT_FOUND');
  codeError(await f.call('GET', '/api/v1/connections?password=hidden'), 400, 'INVALID_ARGUMENT');
});
test('multiple same-name connections have stable distinct IDs, persisted metadata never contains secrets', async t => {
  const f = await fixture(t); const empty = await f.call('GET', '/api/v1/connections');
  assert.deepEqual(empty.json().data, { items: [], next_cursor: null });
  const first = await f.call('POST', '/api/v1/connections', draft); clean(first); assert.equal(first.statusCode, 201);
  const second = await f.call('POST', '/api/v1/connections', { ...draft, host: 'localhost', default_database: '' }); clean(second);
  assert.notEqual(first.json().data.id, second.json().data.id);
  const list = await f.call('GET', '/api/v1/connections'); clean(list); assert.equal(list.json().data.items.length, 2);
  assert.equal(second.json().data.default_database, null);
  assert.doesNotMatch(JSON.stringify(f.storage.data), /synthetic-test-secret|"password"/);
  const service = new ConnectionService(f.storage, f.credentials); await service.initialize();
  assert.deepEqual(await service.list(), list.json().data.items);
});
for (const patch of [
  { name: '' }, { host: ['mysql://user', 'secret@localhost'].join(':') }, { host: 'host/path' }, { port: 0 }, { port: 65536 },
  { port: 1.5 }, { port: '3306' }, { username: '' }, { default_database: 1 }, { password: '' },
  { password: 'x'.repeat(1025) }, { password: '\0' }, { password: '\ud800' }, { confirmed: true }, { credential_ref: randomUUID() }
]) {
  test(`invalid draft rejects field ${Object.keys(patch)[0]} without persistence`, async t => {
    const f = await fixture(t);
    codeError(await f.call('POST', '/api/v1/connections', { ...draft, ...patch }), 400, 'INVALID_ARGUMENT');
    assert.equal(f.storage.writes, 0); assert.equal(f.credentials.values.size, 0);
  });
}
test('editing omitted/blank password preserves original; replacement uses new ref and cleans old credential', async t => {
  const f = await fixture(t); const id = (await f.call('POST', '/api/v1/connections', draft)).json().data.id;
  for (const payload of [{ expected_version: 1, name: 'renamed' }, { expected_version: 2, password: '' }]) {
    const response = await f.call('PATCH', `/api/v1/connections/${id}`, payload); assert.equal(response.statusCode, 200); clean(response);
    assert.equal(await f.credentials.getCredential(id), draft.password);
  }
  const replaced = await f.call('PATCH', `/api/v1/connections/${id}`, { expected_version: 3, password: 'replacement-synthetic' });
  assert.equal(replaced.json().data.version, 4); clean(replaced);
  const ref = f.storage.data.items[0].credential_ref; assert.notEqual(ref, id);
  assert.equal(await f.credentials.getCredential(id), null); assert.equal(await f.credentials.getCredential(ref), 'replacement-synthetic');
});
test('optimistic conflicts reject update/delete/saved test before side effects; parallel edits have one winner', async t => {
  const f = await fixture(t); const id = (await f.call('POST', '/api/v1/connections', draft)).json().data.id;
  const results = await Promise.all(['a', 'b'].map(name => f.call('PATCH', `/api/v1/connections/${id}`, { expected_version: 1, name })));
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  for (const [method, url, payload] of [
    ['PATCH', `/api/v1/connections/${id}`, { expected_version: 1, password: 'replacement' }],
    ['DELETE', `/api/v1/connections/${id}`, { expected_version: 1 }],
    ['POST', `/api/v1/connections/${id}/test`, { expected_version: 1 }]
  ]) codeError(await f.call(method, url, payload), 409, 'STATE_CONFLICT');
  assert.equal(await f.credentials.getCredential(id), draft.password);
});
test('invalid version/ID/unknown edit fields and missing connections reject deterministically', async t => {
  const f = await fixture(t); const id = (await f.call('POST', '/api/v1/connections', draft)).json().data.id;
  for (const value of [undefined, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    codeError(await f.call('DELETE', `/api/v1/connections/${id}`, { expected_version: value }), 400, 'INVALID_ARGUMENT');
  }
  codeError(await f.call('PATCH', `/api/v1/connections/${id}`, { expected_version: 1, confirmed: true }), 400, 'INVALID_ARGUMENT');
  codeError(await f.call('DELETE', '/api/v1/connections/not-an-id', { expected_version: 1 }), 400, 'INVALID_ARGUMENT');
  codeError(await f.call('DELETE', `/api/v1/connections/${randomUUID()}`, { expected_version: 1 }), 404, 'NOT_FOUND');
});
test('create keyring/storage failures cannot leave a successful connection or plaintext fallback', async t => {
  const f = await fixture(t); f.credentials.failSet = true;
  codeError(await f.call('POST', '/api/v1/connections', draft), 503, 'CREDENTIAL_STORE_UNAVAILABLE');
  f.credentials.failSet = false; f.storage.fail = true;
  codeError(await f.call('POST', '/api/v1/connections', draft), 503, 'SERVICE_UNAVAILABLE');
  assert.deepEqual((await f.call('GET', '/api/v1/connections')).json().data.items, []);
  assert.equal(f.credentials.values.size, 0);
});
test('replacement keyring/storage failures preserve old metadata/version/password', async t => {
  const f = await fixture(t); const id = (await f.call('POST', '/api/v1/connections', draft)).json().data.id;
  const original = structuredClone(f.storage.data); f.credentials.failSet = true;
  codeError(await f.call('PATCH', `/api/v1/connections/${id}`, { expected_version: 1, password: 'new' }), 503, 'CREDENTIAL_STORE_UNAVAILABLE');
  f.credentials.failSet = false; f.storage.fail = true;
  codeError(await f.call('PATCH', `/api/v1/connections/${id}`, { expected_version: 1, password: 'new' }), 503, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(f.storage.data, original); assert.equal(await f.credentials.getCredential(id), draft.password); assert.equal(f.credentials.values.size, 1);
});
test('deletion failure preserves old config; successful deletion only removes local metadata/credential', async t => {
  const f = await fixture(t); const id = (await f.call('POST', '/api/v1/connections', draft)).json().data.id;
  f.storage.fail = true;
  codeError(await f.call('DELETE', `/api/v1/connections/${id}`, { expected_version: 1 }), 503, 'SERVICE_UNAVAILABLE');
  assert.equal(await f.credentials.getCredential(id), draft.password);
  f.storage.fail = false;
  const response = await f.call('DELETE', `/api/v1/connections/${id}`, { expected_version: 1 });
  assert.deepEqual(response.json().data, { id, deleted: true }); clean(response);
  assert.equal(f.credentials.values.size, 0); assert.equal(f.storage.data.items.length, 0);
});
test('failed native cleanup is persisted and retried after service reload without exposing refs', async t => {
  const f = await fixture(t); const id = (await f.call('POST', '/api/v1/connections', draft)).json().data.id;
  f.credentials.failDelete = true;
  assert.equal((await f.call('DELETE', `/api/v1/connections/${id}`, { expected_version: 1 })).statusCode, 200);
  assert.deepEqual(f.storage.data.cleanup_refs, [id]);
  const service = new ConnectionService(f.storage, f.credentials); await service.initialize();
  f.credentials.failDelete = false; await service.create(draft);
  assert.equal(await f.credentials.getCredential(id), null); assert.deepEqual(f.storage.data.cleanup_refs, []);
});
test('draft test is marked simulation, does not save metadata or touch keyring', async t => {
  const f = await fixture(t); const response = await f.call('POST', '/api/v1/connections/test', draft); clean(response);
  assert.equal(response.statusCode, 200); assert.equal(response.json().data.simulated, true); assert.equal(response.json().data.connected, false);
  assert.ok(response.json().data.duration_ms >= 0); assert.equal(f.storage.writes, 0); assert.equal(f.credentials.values.size, 0);
});
test('saved test privately obtains credential; tester extra result fields cannot leak', async t => {
  let seen; const f = await fixture(t, { tester: async config => { seen = config; return { connected: true, simulated: true, password: config.password, credential_ref: 'hidden' }; } });
  const id = (await f.call('POST', '/api/v1/connections', draft)).json().data.id;
  const response = await f.call('POST', `/api/v1/connections/${id}/test`, { expected_version: 1 }); clean(response);
  assert.equal(response.json().data.connected, true); assert.equal(seen.password, draft.password);
  f.credentials.failGet = true;
  codeError(await f.call('POST', `/api/v1/connections/${id}/test`, { expected_version: 1 }), 503, 'CREDENTIAL_STORE_UNAVAILABLE');
});
test('saved test blocks edits/deletes during use and releases lock after test', async t => {
  let release; let entered; const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { tester: async () => { entered(); await new Promise(resolve => { release = resolve; }); return { connected: true, simulated: true }; } });
  const id = (await f.call('POST', '/api/v1/connections', draft)).json().data.id;
  const pending = f.call('POST', `/api/v1/connections/${id}/test`, { expected_version: 1 }); await started;
  codeError(await f.call('PATCH', `/api/v1/connections/${id}`, { expected_version: 1, name: 'new' }), 409, 'STATE_CONFLICT');
  codeError(await f.call('DELETE', `/api/v1/connections/${id}`, { expected_version: 1 }), 409, 'STATE_CONFLICT');
  release(); assert.equal((await pending).statusCode, 200);
  assert.equal((await f.call('DELETE', `/api/v1/connections/${id}`, { expected_version: 1 })).statusCode, 200);
});
test('test timeout aborts and safely releases saved connection; test concurrency is bounded', async t => {
  const signals = []; const f = await fixture(t, { testTimeoutMs: 20, tester: async (_draft, signal) => { signals.push(signal); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); return { connected: false, simulated: true }; } });
  const id = (await f.call('POST', '/api/v1/connections', draft)).json().data.id;
  codeError(await f.call('POST', `/api/v1/connections/${id}/test`, { expected_version: 1 }), 504, 'EXECUTION_TIMEOUT');
  assert.ok(signals[0].aborted);
  const pending = Array.from({ length: 5 }, () => f.call('POST', '/api/v1/connections/test', draft));
  const responses = await Promise.all(pending); assert.equal(responses.filter(r => r.statusCode === 429).length, 1);
  assert.equal(responses.filter(r => r.statusCode === 504).length, 4);
  assert.equal((await f.call('DELETE', `/api/v1/connections/${id}`, { expected_version: 1 })).statusCode, 200);
});
test('raw tester exceptions and unknown errors are replaced, not merely regex-redacted', async t => {
  const f = await fixture(t, { tester: async () => { throw new Error(['synthetic-test-secret C:\\private\\file mysql://user', 'secret@host stack'].join(':')); } });
  codeError(await f.call('POST', '/api/v1/connections/test', draft), 500, 'INTERNAL_ERROR');
  assert.deepEqual(sanitizeError(new Error('secret')), { status: 500, body: { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal service error.' } } });
});
for (const data of [
  { schema_version: 2, items: [], cleanup_refs: [] }, { schema_version: 1, items: [], cleanup_refs: [], password: 'hidden' },
  { schema_version: 1, items: [{}], cleanup_refs: [] }, { schema_version: 1, items: [], cleanup_refs: ['bad'] }
]) {
  test(`invalid metadata fails closed (${JSON.stringify(data).slice(0, 70)})`, async () => {
    const storage = new Storage(); storage.data = data;
    await assert.rejects(createLocalServer({ storage, credentials: new Credentials(), changeStorage: new Storage() }), { code: 'SERVICE_UNAVAILABLE' });
    assert.equal(storage.writes, 0);
  });
}
test('connection capacity is bounded and returned views cannot mutate service state', async () => {
  const storage = new Storage(); const service = new ConnectionService(storage, new Credentials()); await service.initialize();
  for (let i = 0; i < 256; i++) await service.create(draft);
  await assert.rejects(async () => service.create(draft), { code: 'RESOURCE_LIMIT' });
  const list = await service.list(); list[0].name = 'tampered'; assert.equal((await service.list())[0].name, draft.name);
  await service.close(); await assert.rejects(service.list(), { code: 'SERVICE_UNAVAILABLE' });
});
test('JSON store atomically persists/reloads, excludes passwords, enforces writer lease and refuses corrupt data', async () => {
  const directory = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? tmpdir(), 'mysql-mcp-server-'));
  const file = path.join(directory, 'connections.json'); const credentials = new Credentials();
  let service; let storage;
  try {
    storage = new JsonMetadataStorage(file); service = new ConnectionService(storage, credentials); await service.initialize();
    const created = await service.create(draft); const bytes = await readFile(file, 'utf8');
    assert.doesNotMatch(bytes, /"password"|synthetic-test-secret/);
    const competing = new JsonMetadataStorage(file); await assert.rejects(competing.read(), { code: 'SERVICE_UNAVAILABLE' }); await competing.close();
    await service.close(); storage = new JsonMetadataStorage(file); service = new ConnectionService(storage, credentials); await service.initialize();
    assert.deepEqual(await service.list(), [created]);
    await service.update(created.id, { expected_version: 1, password: 'replacement' });
    await service.close(); storage = undefined; service = undefined;
    assert.deepEqual((await readdir(directory)).sort(), ['connections.json']);
    await writeFile(file, '{broken'); storage = new JsonMetadataStorage(file);
    await assert.rejects(storage.read(), { code: 'SERVICE_UNAVAILABLE' });
  } finally { await service?.close(); await storage?.close(); await rm(directory, { recursive: true, force: true }); }
});
test('real HTTP listener uses only 127.0.0.1 and actual ephemeral port, local login is not printed in test', async t => {
  let code; const f = await createLocalServer({ port: 0, storage: new Storage(), changeStorage: new Storage(), credentials: new Credentials(), onLocalCode: value => { code = value; } });
  t.after(() => f.close()); const address = await f.start(); assert.equal(address.host, '127.0.0.1'); assert.ok(address.port > 0);
  const response = await fetch(`http://${address.host}:${address.port}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ local_code: code }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  await assert.rejects(f.start(), { code: 'STATE_CONFLICT' });
  const denied = await fetch(`http://${address.host}:${address.port}/api/v1/connections`, { headers: { origin: 'http://evil.example' } }); assert.equal(denied.status, 403);
});

for (const operation of ['create', 'replace']) {
  test(`durable intent survives metadata commit plus compensation delete failure (${operation})`, async t => {
    const f = await fixture(t);
    const original = operation === 'replace' ? (await f.call('POST', '/api/v1/connections', draft)).json().data : undefined;
    f.storage.failAt = f.storage.writes + 1; f.credentials.failDelete = true;
    const response = original ? await f.call('PATCH', `/api/v1/connections/${original.id}`, { expected_version: 1, password: 'replacement' }) :
      await f.call('POST', '/api/v1/connections', draft);
    codeError(response, 503, 'SERVICE_UNAVAILABLE');
    assert.equal(f.storage.data.cleanup_refs.length, 1);
    const orphan = f.storage.data.cleanup_refs[0]; assert.ok(f.credentials.values.has(orphan));
    if (original) { assert.equal(f.storage.data.items[0].version, 1); assert.equal(await f.credentials.getCredential(original.id), draft.password); }
    else assert.deepEqual(f.storage.data.items, []);
    f.storage.failAt = Infinity; f.credentials.failDelete = false;
    const service = new ConnectionService(f.storage, f.credentials); await service.initialize(); await service.create(draft);
    assert.equal(await f.credentials.getCredential(orphan), null); assert.deepEqual(f.storage.data.cleanup_refs, []);
  });
}
test('hanging credential read times out without blocking metadata and late read never dispatches test', async t => {
  let resolveRead; let dispatched = 0;
  const f = await fixture(t, { testTimeoutMs: 15, tester: async () => { dispatched++; return { connected: true, simulated: true }; } });
  const id = (await f.call('POST', '/api/v1/connections', draft)).json().data.id;
  f.credentials.getCredential = async () => new Promise(resolve => { resolveRead = resolve; });
  codeError(await f.call('POST', `/api/v1/connections/${id}/test`, { expected_version: 1 }), 504, 'EXECUTION_TIMEOUT');
  assert.equal((await f.call('GET', '/api/v1/connections')).statusCode, 200);
  codeError(await f.call('DELETE', `/api/v1/connections/${id}`, { expected_version: 1 }), 409, 'STATE_CONFLICT');
  resolveRead(draft.password); await new Promise(resolve => setImmediate(resolve)); assert.equal(dispatched, 0);
  assert.equal((await f.call('DELETE', `/api/v1/connections/${id}`, { expected_version: 1 })).statusCode, 200);
});
test('timed-out non-cooperative testers keep real concurrency slots until underlying settlement', async t => {
  const releases = []; let active = 0; let maxActive = 0;
  const f = await fixture(t, { testTimeoutMs: 15, tester: async () => {
    active++; maxActive = Math.max(active, maxActive);
    await new Promise(resolve => releases.push(resolve)); active--; return { connected: false, simulated: true };
  } });
  const responses = await Promise.all(Array.from({ length: 4 }, () => f.call('POST', '/api/v1/connections/test', draft)));
  assert.ok(responses.every(response => response.statusCode === 504)); assert.equal(active, 4);
  codeError(await f.call('POST', '/api/v1/connections/test', draft), 429, 'RESOURCE_LIMIT'); assert.equal(maxActive, 4);
  releases.splice(0).forEach(resolve => resolve()); await new Promise(resolve => setImmediate(resolve)); assert.equal(active, 0);
});
