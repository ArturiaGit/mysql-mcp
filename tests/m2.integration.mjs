import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import { createServer } from '../apps/admin-api/dist/server.js';
import { createMetadataPool, createMetadataQueryExecutor, readMetadataConfig } from '../packages/core-engine/dist/index.js';
import { hashPassword } from '../packages/security/dist/index.js';

const config = readMetadataConfig(process.env);
assert(config, 'M2 integration requires an isolated Docker MySQL 8.0 database');
const password = () => `Aa1!${randomBytes(18).toString('base64url')}`;
const env = {
  NODE_ENV: 'production', ADMIN_API_SECRET: randomBytes(32).toString('hex'),
  SERVER_PEPPER: process.env.SERVER_PEPPER ?? ('密'.repeat(10) + randomBytes(1).toString('hex')),
  GATEWAY_MASTER_KEYS: JSON.stringify({ active_key_id: 'test', keys: { test: randomBytes(32).toString('hex') } }),
  BOOTSTRAP_ADMIN_USERNAME: 'm2admin', BOOTSTRAP_ADMIN_PASSWORD: password(),
};
const pats = '/api/v1/pats';
const options = '/api/v1/profiles/my-options';
const revoke = (id) => `${pats}/${id}/revoke`;
const day = 86_400_000;
const appendCookies = (response) => response.headers.getSetCookie().map((cookie) => cookie.split(';', 1)[0]).join('; ');
const request = (base, path, { method = 'GET', body, session, token = session?.csrf } = {}) => fetch(`${base}${path}`, {
  method,
  headers: {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(session ? { cookie: session.cookie } : {}), ...(token ? { 'x-csrf-token': token } : {}),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  signal: AbortSignal.timeout(10_000),
});
const post = (base, path, session, body, token) => request(base, path, { method: 'POST', session, body, token });
async function expectCode(response, status, code) {
  assert.equal(response.status, status, `expected ${status} ${code}`);
  assert.equal((await response.json()).code, code);
}
async function login(base, username, loginPassword) {
  const seed = await request(base, '/api/v1/auth/csrf');
  assert.equal(seed.status, 200);
  const anonymous = { cookie: appendCookies(seed), csrf: (await seed.json()).csrfToken };
  const response = await post(base, '/api/v1/auth/login', anonymous, { username, password: loginPassword });
  assert.equal(response.status, 200);
  const cookie = appendCookies(response);
  const fresh = await request(base, '/api/v1/auth/csrf', { session: { cookie } });
  assert.equal(fresh.status, 200);
  return { user: (await response.json()).user, cookie, csrf: (await fresh.json()).csrfToken };
}

async function issue(base, session, input, days) {
  const response = await post(base, pats, session, input);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /\bno-store\b/);
  const document = await response.json();
  assert.deepEqual(Object.keys(document).sort(), ['pat', 'rawToken']);
  const { pat, rawToken } = document;
  assert.deepEqual(Object.keys(pat).sort(), ['created_at', 'expires_at', 'id', 'last_used_at', 'name', 'token_prefix']);
  assert.equal(typeof pat.id, 'string');
  assert.match(pat.id, /^[1-9][0-9]*$/);
  assert.match(rawToken, /^mcp_pat_[0-9a-f]{64}$/);
  assert.equal(pat.token_prefix, rawToken.slice(0, 16));
  assert.equal(pat.last_used_at, null);
  assert(Math.abs(Date.parse(pat.expires_at) - Date.parse(pat.created_at) - days * day) < 1000);
  return document;
}

test('real MySQL 8.0 M2: pepper admission, PAT contracts, commit/rollback hooks and profile projection', async (t) => {
  const fixturePool = createMetadataPool(config);
  t.after(() => fixturePool.close());
  const db = createMetadataQueryExecutor(fixturePool);
  const [[{ version }]] = await db.query('SELECT VERSION() AS version');
  assert.match(version, /^8\.0\./);
  const [[seed]] = await db.query(`SELECT setting_value FROM sys_system_settings WHERE setting_key = 'bootstrap_state'`);
  assert.equal(seed.setting_value, 'PENDING', 'M2 requires a freshly initialized Docker database');

  await t.test('missing and 31 UTF-8 byte SERVER_PEPPER leave probes up but no business routes', async () => {
    const short = '密'.repeat(10) + 'a';
    assert.equal(Buffer.byteLength(short, 'utf8'), 31);
    for (const pepper of [undefined, short]) {
      const app = createServer(config, { ...env, SERVER_PEPPER: pepper });
      try {
        const base = await app.listen({ host: '127.0.0.1', port: 0 });
        const live = await request(base, '/health/live');
        const ready = await request(base, '/health/ready');
        assert.equal(live.status, 200);
        assert.equal(ready.status, 503);
        assert.deepEqual(await live.json(), { status: 'ok' });
        assert.deepEqual(await ready.json(), { status: 'not_ready' });
        for (const [method, url] of [['GET', '/api/v1/auth/csrf'], ['GET', pats], ['POST', pats], ['POST', revoke('1')], ['GET', options]]) {
          assert.equal(app.hasRoute({ method, url: url === revoke('1') ? `${pats}/:id/revoke` : url }), false);
          assert.equal((await request(base, url, { method })).status, 404);
        }
      } finally { await app.close(); }
    }
    const [[unchanged]] = await db.query(`SELECT setting_value FROM sys_system_settings WHERE setting_key = 'bootstrap_state'`);
    assert.equal(unchanged.setting_value, 'PENDING');
  });

  const events = [];
  const app = createServer(config, env, { patRevocationHooks: {
    markPatRevokedSync(id) { events.push({ kind: 'mark', id }); },
    async cancelQueriesByPat(id, reason) {
      events.push({ kind: 'cancel', id, reason });
      // A different connection must already observe BOTH writes, before the route replies.
      const [[state]] = await db.query(`SELECT p.revoked_at, a.operator_id
        FROM sys_pats p JOIN sys_user_approvals a ON a.target_id = p.id
        WHERE p.id = CAST(? AS UNSIGNED) AND a.target_type = 'PAT' AND a.action = 'PAT_REVOKE'`, [id]);
      assert(state?.revoked_at instanceof Date, 'post-commit callback did not observe committed revoke and audit');
      events.push({ kind: 'observed-commit', id, operator: state.operator_id });
    },
  } });
  t.after(() => app.close());
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const ready = await request(base, '/health/ready');
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready' });
  const alicePassword = password();
  const bobPassword = password();
  const aliceId = '9007199254740992';
  const bobId = '9007199254740993';
  for (const [id, name, secret] of [[aliceId, 'alice', alicePassword], [bobId, 'bob', bobPassword]]) {
    await db.query(`INSERT INTO sys_users (id, username, password_hash, status) VALUES (?, ?, ?, 'ACTIVE')`,
      [id, name, await hashPassword(secret)]);
  }
  await db.query(`INSERT INTO sys_user_roles (user_id, role_id)
    SELECT ?, id FROM sys_roles WHERE role_name IN ('DEVELOPER', 'SECURITY_ADMIN')`, [aliceId]);
  await db.query(`INSERT INTO sys_user_roles (user_id, role_id) SELECT ?, id FROM sys_roles WHERE role_name = 'ANALYST'`, [bobId]);
  await db.query('ALTER TABLE sys_pats AUTO_INCREMENT = 9007199254740992');
  const alice = await login(base, 'alice', alicePassword);
  const bob = await login(base, 'bob', bobPassword);
  const firstAdmin = await login(base, env.BOOTSTRAP_ADMIN_USERNAME, env.BOOTSTRAP_ADMIN_PASSWORD);
  const newAdminPassword = password();
  assert.equal((await post(base, '/api/v1/auth/change-password', firstAdmin, {
    oldPassword: env.BOOTSTRAP_ADMIN_PASSWORD, newPassword: newAdminPassword,
  })).status, 200);
  const admin = await login(base, env.BOOTSTRAP_ADMIN_USERNAME, newAdminPassword);
  assert.equal(alice.user.id, aliceId);
  assert.equal(bob.user.id, bobId);

  await t.test('L1, L2 and preValidation CSRF protect all M2 endpoints', async () => {
    for (const path of [pats, options]) await expectCode(await request(base, path), 401, 'ERR_AUTH_UNAUTHORIZED');
    for (const [path, body] of [[pats, { name: 'wrong csrf' }], [revoke('1'), undefined]]) {
      await expectCode(await post(base, path, alice, body, ''), 403, 'ERR_CSRF_INVALID');
      await expectCode(await post(base, path, alice, body, bob.csrf), 403, 'ERR_CSRF_INVALID');
      const seedResponse = await request(base, '/api/v1/auth/csrf');
      const anonymous = { cookie: appendCookies(seedResponse), csrf: (await seedResponse.json()).csrfToken };
      await expectCode(await post(base, path, anonymous, body), 401, 'ERR_AUTH_UNAUTHORIZED');
    }
    await db.query(`UPDATE sys_users SET status = 'PENDING' WHERE id = CAST(? AS UNSIGNED)`, [aliceId]);
    await expectCode(await request(base, pats, { session: alice }), 403, 'ERR_AUTH_ACCOUNT_PENDING');
    await expectCode(await request(base, options, { session: alice }), 403, 'ERR_AUTH_ACCOUNT_PENDING');
    await expectCode(await post(base, pats, alice, { name: 'pending' }), 403, 'ERR_AUTH_ACCOUNT_PENDING');
    await expectCode(await post(base, revoke('1'), alice), 403, 'ERR_AUTH_ACCOUNT_PENDING');
    await db.query(`UPDATE sys_users SET status = 'ACTIVE' WHERE id = CAST(? AS UNSIGNED)`, [aliceId]);
  });

  await t.test('invalid issuance and audit-write failure produce no PAT or audit', async () => {
    for (const body of [{}, { name: '' }, { name: 'x'.repeat(65) }, { name: 'x', expiresDays: 0 },
      { name: 'x', expiresDays: 366 }, { name: 'x', expiresDays: 1.5 }, { name: 'x', expiresDays: '1' },
      { name: 'x', user_id: bobId }]) {
      await expectCode(await post(base, pats, alice, body), 400, 'ERR_VALIDATION_FAILED');
    }
    await db.query(`ALTER TABLE sys_user_approvals ADD CONSTRAINT m2_deny_pat_create CHECK (action <> 'CONFIG_UPDATE' OR target_type <> 'PAT')`);
    try {
      await expectCode(await post(base, pats, alice, { name: 'must rollback' }), 500, 'ERR_INTERNAL_SERVER');
    } finally { await db.query('ALTER TABLE sys_user_approvals DROP CHECK m2_deny_pat_create'); }
    const [[state]] = await db.query(`SELECT (SELECT COUNT(*) FROM sys_pats) AS pats,
      (SELECT COUNT(*) FROM sys_user_approvals WHERE target_type = 'PAT') AS audits`);
    assert.deepEqual(state, { pats: '0', audits: '0' });
  });

  const first = await issue(base, alice, { name: 'developer default' }, 90);
  const second = await issue(base, bob, { name: 'analyst', expiresDays: 1 }, 1);
  const locked = await issue(base, alice, { name: 'developer maximum', expiresDays: 365 }, 365);
  assert.equal(BigInt(second.pat.id) - BigInt(first.pat.id), 1n);
  const hashes = new Map();
  await t.test('issuance, listing, HMAC storage, and exact audit expiry', async () => {
    for (const [created, owner] of [[first, alice], [second, bob], [locked, alice]]) {
      const { pat, rawToken } = created;
      const [[stored]] = await db.query('SELECT * FROM sys_pats WHERE id = CAST(? AS UNSIGNED)', [pat.id]);
      const hash = createHmac('sha256', env.SERVER_PEPPER).update(rawToken, 'utf8').digest('hex');
      hashes.set(pat.id, hash);
      assert.equal(stored.user_id, owner.user.id);
      assert.equal(stored.token_prefix, pat.token_prefix);
      assert(stored.token_hash === hash, 'stored HMAC mismatch');
      assert.equal(stored.expires_at.toISOString(), pat.expires_at);
      assert.equal(stored.revoked_at, null);
      assert(!JSON.stringify(stored).includes(rawToken));
      const [audit] = await db.query(`SELECT action, user_id, operator_id, target_type, target_id, details
        FROM sys_user_approvals WHERE target_type = 'PAT' AND target_id = CAST(? AS UNSIGNED)`, [pat.id]);
      assert.deepEqual(audit, [{ action: 'CONFIG_UPDATE', user_id: owner.user.id, operator_id: owner.user.id,
        target_type: 'PAT', target_id: pat.id,
        details: { operation: 'PAT_CREATE', name: pat.name, tokenPrefix: pat.token_prefix, expiresAt: pat.expires_at } }]);
    }
    // Request query values cannot override the caller's identity, even for same-prefix BIGINT IDs.
    const own = await request(base, `${pats}?user_id=${bobId}`, { session: alice });
    assert.equal(own.status, 200);
    assert.deepEqual(await own.json(), [locked.pat, first.pat]);
    assert.deepEqual(await (await request(base, pats, { session: bob })).json(), [second.pat]);
    assert.deepEqual(await (await request(base, pats, { session: admin })).json(), []);
  });

  await t.test('L3 blocks all four endpoints for forced change and natural expiry, including revoke', async () => {
    await db.query('UPDATE sys_users SET must_change_password = 1 WHERE id = CAST(? AS UNSIGNED)', [aliceId]);
    for (const force of [true, false]) {
      if (!force) await db.query(`UPDATE sys_users SET must_change_password = 0, password_expires_days = 90,
        password_updated_at = TIMESTAMPADD(DAY, -91, UTC_TIMESTAMP(3)) WHERE id = CAST(? AS UNSIGNED)`, [aliceId]);
      for (const path of [pats, options]) await expectCode(await request(base, path, { session: alice }), 403, 'ERR_MUST_CHANGE_PASSWORD');
      await expectCode(await post(base, pats, alice, { name: 'blocked' }), 403, 'ERR_MUST_CHANGE_PASSWORD');
      await expectCode(await post(base, revoke(locked.pat.id), alice), 403, 'ERR_MUST_CHANGE_PASSWORD');
    }
    await db.query(`UPDATE sys_users SET password_updated_at = UTC_TIMESTAMP(3) WHERE id = CAST(? AS UNSIGNED)`, [aliceId]);
    assert.deepEqual(events, []);
  });

  await t.test('my-options is deduplicated, ACTIVE-only, role-scoped and strictly projected', async () => {
    const shared = '9007199254740992';
    const denied = '9007199254740993';
    const inactive = '9007199254740994';
    for (const [id, name, status] of [[shared, 'shared', 'ACTIVE'], [denied, 'other', 'ACTIVE'], [inactive, 'disabled', 'DISABLED']]) {
      await db.query(`INSERT INTO sys_profiles (id, name, display_name, host, username, password_encrypted, default_database,
        tls_config, ssh_config, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, `${name} DB`, 'hidden.internal', 'hidden-user', 'test-ciphertext', 'hidden-db',
        JSON.stringify({ enabled: true }), JSON.stringify({ private_key_encrypted: 'test-private-key' }), status]);
    }
    for (const [id, role] of [[shared, 'DEVELOPER'], [shared, 'SECURITY_ADMIN'], [denied, 'ANALYST'], [inactive, 'DEVELOPER']]) {
      await db.query('INSERT INTO sys_role_profiles (role_id, profile_id) SELECT id, ? FROM sys_roles WHERE role_name = ?', [id, role]);
    }
    for (const [session, expected] of [[alice, [{ id: shared, name: 'shared', displayName: 'shared DB' }]],
      [bob, [{ id: denied, name: 'other', displayName: 'other DB' }]], [admin, []]]) {
      const response = await request(base, options, { session });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), expected);
    }
  });

  await t.test('revoke: forbidden/missing, real rollback without hooks, concurrent owner and admin paths', async () => {
    await expectCode(await post(base, revoke(first.pat.id), bob), 403, 'ERR_RBAC_FORBIDDEN');
    for (const id of ['x', '18446744073709551615', '18446744073709551616', `${first.pat.id}0`]) {
      await expectCode(await post(base, revoke(id), alice), 404, 'ERR_NOT_FOUND');
    }
    await db.query(`ALTER TABLE sys_user_approvals ADD CONSTRAINT m2_deny_pat_revoke CHECK (action <> 'PAT_REVOKE')`);
    try {
      await expectCode(await post(base, revoke(first.pat.id), alice), 500, 'ERR_INTERNAL_SERVER');
    } finally { await db.query('ALTER TABLE sys_user_approvals DROP CHECK m2_deny_pat_revoke'); }
    assert.deepEqual(events, []);
    const [[undone]] = await db.query('SELECT revoked_at FROM sys_pats WHERE id = CAST(? AS UNSIGNED)', [first.pat.id]);
    assert.equal(undone.revoked_at, null);
    const [[before]] = await db.query(`SELECT COUNT(*) AS count FROM sys_user_approvals WHERE action = 'PAT_REVOKE'`);
    assert.equal(before.count, '0');

    const responses = await Promise.all([post(base, revoke(first.pat.id), alice), post(base, revoke(first.pat.id), alice)]);
    responses.sort((a, b) => a.status - b.status);
    const [success, repeated] = responses;
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { success: true });
    await expectCode(repeated, 404, 'ERR_NOT_FOUND');
    const adminSuccess = await post(base, revoke(second.pat.id), admin);
    assert.equal(adminSuccess.status, 200);
    assert.deepEqual(await adminSuccess.json(), { success: true });
    assert.deepEqual(events, [[first.pat.id, aliceId], [second.pat.id, admin.user.id]].flatMap(([id, operator]) => [
      { kind: 'mark', id }, { kind: 'cancel', id, reason: 'PAT_REVOKED' }, { kind: 'observed-commit', id, operator },
    ]));
    const [revocations] = await db.query(`SELECT a.target_id, a.user_id, a.operator_id, a.details, p.revoked_at
      FROM sys_user_approvals a JOIN sys_pats p ON p.id = a.target_id
      WHERE a.target_type = 'PAT' AND a.action = 'PAT_REVOKE' ORDER BY a.target_id`);
    assert.equal(revocations.length, 2);
    assert(revocations.every(({ revoked_at }) => revoked_at instanceof Date));
    assert.deepEqual(revocations.map(({ target_id, user_id, operator_id, details }) => ({ target_id, user_id, operator_id, details })), [
      { target_id: first.pat.id, user_id: aliceId, operator_id: aliceId, details: { operation: 'PAT_REVOKE' } },
      { target_id: second.pat.id, user_id: admin.user.id, operator_id: admin.user.id, details: { operation: 'PAT_REVOKE' } },
    ]);
    assert.deepEqual(await (await request(base, pats, { session: alice })).json(), [locked.pat]);
    assert.deepEqual(await (await request(base, pats, { session: bob })).json(), []);
  });

  const [auditRows] = await db.query(`SELECT * FROM sys_user_approvals WHERE target_type = 'PAT'`);
  assert.equal(auditRows.length, 5);
  const serialized = JSON.stringify(auditRows);
  assert(!serialized.includes('rawToken') && !serialized.includes('token_hash'));
  for (const { pat, rawToken } of [first, second, locked]) {
    const hash = hashes.get(pat.id);
    assert(hash && !serialized.includes(hash) && !serialized.includes(rawToken), 'PAT material in audit');
  }

  await t.test('isolated issuance limiter admits 20 requests, then returns 429 without metadata writes', async (subtest) => {
    const limitedApp = createServer(config, env);
    subtest.after(() => limitedApp.close());
    const limitedBase = await limitedApp.listen({ host: '127.0.0.1', port: 0 });
    assert.equal((await request(limitedBase, '/health/ready')).status, 200);
    const issuer = await login(limitedBase, 'alice', alicePassword);
    const writeCounts = async () => {
      const [[counts]] = await db.query(`SELECT (SELECT COUNT(*) FROM sys_pats) AS pats,
        (SELECT COUNT(*) FROM sys_user_approvals) AS approvals`);
      return counts;
    };
    const before = await writeCounts();
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = await post(limitedBase, pats, issuer, { name: `rate-limit accepted ${attempt}` });
      assert.equal(response.status, 200, `issuance request ${attempt} should be admitted`);
      await response.body?.cancel();
    }
    const admitted = await writeCounts();
    assert.equal(BigInt(admitted.pats) - BigInt(before.pats), 20n);
    assert.equal(BigInt(admitted.approvals) - BigInt(before.approvals), 20n);

    const rejected = await post(limitedBase, pats, issuer, { name: 'rate-limit rejected' });
    assert.equal(rejected.status, 429);
    const retryAfter = rejected.headers.get('retry-after');
    assert.match(retryAfter ?? '', /^[1-9][0-9]*$/);
    assert(Number(retryAfter) <= 60, 'retry-after must be inside the configured minute');
    await rejected.body?.cancel();
    assert.deepEqual(await writeCounts(), admitted, 'the rejected request must not write a PAT or an approval');
  });
  console.log(`MySQL ${version}; M2: four routes, fail-closed probes, audit rollback, post-commit callbacks and field projections verified`);
});
