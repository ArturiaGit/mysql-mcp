import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createServer } from '../dist/server.js';
import { createMetadataPool, createMetadataQueryExecutor, readMetadataConfig, withMetadataTransaction } from '@mysql-mcp/core-engine';
import { hashPassword } from '@mysql-mcp/security';
import { hasStrongPassword } from '../dist/auth-domain.js';

const config = readMetadataConfig(process.env);
assert(config, 'M3 requires a fresh, isolated Docker MySQL 8.0 database');
const password = () => `Aa1!${randomBytes(18).toString('base64url')}`;
const base = '/api/v1';
const users = `${base}/users`;
const approvals = `${base}/approvals`;
const roles = `${base}/roles`;
const me = `${base}/auth/me`;
const highId = '18446744073709551614';
const firstUserId = '9223372036854775808';
const nextUserId = '9223372036854775809';
let loginClient = 1;

async function call(app, method, url, session, payload, csrf = session?.csrf, remoteAddress = '127.0.0.1') {
  return app.inject({ method, url, remoteAddress, headers: {
    ...(session ? { cookie: session.cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}),
  }, ...(payload === undefined ? {} : { payload }) });
}
function cookie(response) {
  return [response.headers['set-cookie']].flat().map((value) => value.split(';', 1)[0]).join('; ');
}
function ok(response) {
  assert.equal(response.statusCode, 200, `expected HTTP 200, received ${response.statusCode}`);
  return response.json();
}
function error(response, status, code) {
  assert.equal(response.statusCode, status, `expected HTTP ${status} ${code}`);
  const body = response.json();
  assert.equal(body.code, code);
  return body.details;
}
async function csrf(app, session) {
  const response = await call(app, 'GET', `${base}/auth/csrf`, session);
  return { cookie: session?.cookie ?? cookie(response), csrf: ok(response).csrfToken };
}
async function login(app, username, credential) {
  const anonymous = await csrf(app);
  const response = await call(app, 'POST', `${base}/auth/login`, anonymous,
    { username, password: credential }, anonymous.csrf, `127.0.1.${loginClient++}`);
  const { user } = ok(response);
  return { ...await csrf(app, { cookie: cookie(response) }), user };
}

async function userState(db, id) {
  const [[row]] = await db.query(`SELECT status, version, auth_version, must_change_password, failed_login_count,
    locked_until, password_updated_at FROM sys_users WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)`, [id]);
  return row;
}
async function assignedRoles(db, id) {
  const [rows] = await db.query('SELECT role_id FROM sys_user_roles WHERE user_id = CAST(CAST(? AS CHAR) AS UNSIGNED) ORDER BY role_id', [id]);
  return rows.map(({ role_id }) => role_id);
}
async function waitForRoleLockReaders(db, expected = 2) {
  for (let check = 0; check < 70; check++) {
    const [processes] = await db.query('SHOW FULL PROCESSLIST');
    if (processes.filter(({ Info }) => Info?.includes("WHERE role_name = 'SUPER_ADMIN' FOR UPDATE")).length === expected) return;
    await delay(15);
  }
  assert.fail(`Expected ${expected} HTTP transaction(s) waiting on the real MySQL SUPER_ADMIN lock`);
}
async function concurrentMutations(pool, db, invoke) {
  let calls;
  await withMetadataTransaction(pool, async (tx) => {
    await tx.query("SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE");
    calls = invoke();
    await waitForRoleLockReaders(db);
  });
  return Promise.all(calls);
}

test('M3 governance on real MySQL 8.0', async (t) => {
  const pool = createMetadataPool(config);
  t.after(() => pool.close());
  const db = createMetadataQueryExecutor(pool);
  const [[{ version }]] = await db.query('SELECT VERSION() AS version');
  assert.match(version, /^8\.0\./);
  const [[seed]] = await db.query("SELECT setting_value FROM sys_system_settings WHERE setting_key = 'bootstrap_state'");
  assert.equal(seed.setting_value, 'PENDING');
  t.diagnostic(`Docker MySQL ${version}`);
  const bootstrapPassword = password();
  const fixturePassword = password();
  const encoded = await hashPassword(fixturePassword);
  const events = [];
  const app = createServer(config, {
    NODE_ENV: 'production', ADMIN_API_SECRET: randomBytes(32).toString('hex'), SERVER_PEPPER: randomBytes(32).toString('hex'),
    GATEWAY_MASTER_KEYS: JSON.stringify({ active_key_id: 'test', keys: { test: randomBytes(32).toString('hex') } }),
    BOOTSTRAP_ADMIN_USERNAME: 'm3admin', BOOTSTRAP_ADMIN_PASSWORD: bootstrapPassword,
  }, {
    userInvalidationHooks: {
      markUserInvalidatedSync(id) { events.push(['user-mark', id]); },
      async cancelQueriesByUser(id, reason) {
        events.push(['user-cancel', id, reason]);
        const observed = await userState(db, id);
        if (reason === 'USER_DELETED') assert.equal(observed, undefined);
        if (reason === 'ACCOUNT_DISABLED') assert.equal(observed?.status, 'DISABLED');
        events.push(['user-cancel-committed', id]);
      },
    },
    patRevocationHooks: {
      markPatRevokedSync(id) { events.push(['pat-mark', id]); },
      cancelQueriesByPat(id, reason) { events.push(['pat-cancel', id, reason]); },
    },
  });
  t.after(() => app.close());
  ok(await call(app, 'GET', '/health/ready'));
  const initial = await login(app, 'm3admin', bootstrapPassword);
  const adminPassword = password();
  ok(await call(app, 'POST', `${base}/auth/change-password`, initial, { oldPassword: bootstrapPassword, newPassword: adminPassword }));
  const admin = await login(app, 'm3admin', adminPassword);
  const directory = ok(await call(app, 'GET', roles, admin));
  const roleId = (name) => directory.find(({ role_name }) => role_name === name).id;
  const superRole = roleId('SUPER_ADMIN');
  const securityRole = roleId('SECURITY_ADMIN');
  const developer = roleId('DEVELOPER');
  await db.query("INSERT INTO sys_roles (id, role_name, display_name) VALUES (?, 'QA_READ', 'QA')", [highId]);
  await db.query(`INSERT INTO sys_profiles (id, name, display_name, host, username, password_encrypted, default_database)
    VALUES (?, 'm3profile', 'Fixture', 'db.example.test', 'reader', 'test-ciphertext', 'fixture_db')`, [highId]);
  await db.query('INSERT INTO sys_role_profiles (role_id, profile_id) VALUES (?, ?)', [highId, highId]);
  await db.query('ALTER TABLE sys_users AUTO_INCREMENT = 9223372036854775808');
  await db.query('ALTER TABLE sys_user_approvals AUTO_INCREMENT = 9223372036854775808');
  await db.query('ALTER TABLE sys_pats AUTO_INCREMENT = 18446744073709551600');

  async function fixture(username, role, status = 'ACTIVE') {
    await db.query('INSERT INTO sys_users (username, password_hash, status) VALUES (?, ?, ?)', [username, encoded, status]);
    const [[{ id }]] = await db.query('SELECT id FROM sys_users WHERE username = ?', [username]);
    await db.query('INSERT INTO sys_user_roles (user_id, role_id) VALUES (?, ?)', [id, role]);
    return id;
  }
  const securityId = await fixture('securityadmin', securityRole);
  assert.equal(securityId, firstUserId);
  const basicId = await fixture('basicuser', developer);
  assert.equal(basicId, nextUserId);
  const security = await login(app, 'securityadmin', fixturePassword);
  const basic = await login(app, 'basicuser', fixturePassword);
  async function register(username, details = {}) {
    const credential = password();
    ok(await call(app, 'POST', `${base}/auth/register`, await csrf(app), { username, password: credential, ...details }));
    const { items } = ok(await call(app, 'GET', `${approvals}/pending`, admin));
    const row = items.find((item) => item.username === username);
    assert(row);
    return { ...row, credential };
  }

  await t.test('9 route guards, CSRF, read-only role directory and exact high IDs', async () => {
    const all = [
      ['GET', `${approvals}/pending`], ['POST', `${approvals}/1/approve`, { roleIds: [developer] }],
      ['POST', `${approvals}/1/reject`, { reason: 'test' }], ['GET', users],
      ['PUT', `${users}/${basicId}/status`, { status: 'DISABLED', version: 1 }],
      ['PUT', `${users}/${basicId}/roles`, { roleIds: [], version: 1 }], ['DELETE', `${users}/${basicId}`],
      ['POST', `${users}/${basicId}/reset-password`, { version: 1 }], ['GET', roles],
    ];
    for (const [method, url, body] of all) {
      error(await call(app, method, url, basic, body), 403, 'ERR_RBAC_FORBIDDEN');
      if (method !== 'GET') error(await call(app, method, url, admin, body, 'bad-token'), 403, 'ERR_CSRF_INVALID');
    }
    for (const [method, url, body] of all.filter((entry) => entry[1].startsWith(users))) {
      error(await call(app, method, url, security, body), 403, 'ERR_RBAC_FORBIDDEN');
    }
    const roleRows = ok(await call(app, 'GET', roles, security));
    const custom = roleRows.find(({ id }) => id === highId);
    assert.deepEqual(Object.keys(custom).sort(), [
      'created_at', 'default_limit', 'description', 'display_name', 'id', 'max_inflight_concurrency', 'max_limit',
      'max_timeout_ms', 'profileIds', 'role_name', 'updated_at', 'user_qpm_limit', 'version',
    ]);
    assert.deepEqual(custom.profileIds, [highId]);
    assert.equal(custom.description, null);
    assert.equal(app.hasRoute({ method: 'POST', url: roles }), false);
    assert.equal((await userState(db, basicId)).version, 1);
    assert.deepEqual(events, []);
  });

  await t.test('registration, rejection, resubmission, approval, login and conflicting final decisions', async () => {
    const row = await register('m3applicant', { email: 'a@example.test', reason: 'Original reason' });
    assert.match(row.id, /^9223372036854775\d{3}$/);
    assert.notEqual(row.id, row.user_id);
    assert.equal(row.reason, 'Original reason');
    const legacy = await register('legacyrequest', { reason: 'Account reason' });
    await db.query("UPDATE sys_user_approvals SET application_reason = NULL, reason = 'Legacy reason' WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)", [legacy.id]);
    assert.equal(ok(await call(app, 'GET', `${approvals}/pending`, security)).items.find(({ id }) => id === legacy.id).reason, 'Legacy reason');
    await db.query('UPDATE sys_user_approvals SET reason = NULL WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)', [legacy.id]);
    assert.equal(ok(await call(app, 'GET', `${approvals}/pending`, security)).items.find(({ id }) => id === legacy.id).reason, 'Account reason');
    await db.query("UPDATE sys_user_approvals SET action = 'CANCELED' WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)", [legacy.id]);
    const page = ok(await call(app, 'GET', `${approvals}/pending?page=2&pageSize=1`, security));
    assert.deepEqual(page, { items: [], page: 2, pageSize: 1, total: 1, totalPages: 1 });
    error(await call(app, 'GET', `${approvals}/pending?pageSize=101`, admin), 400, 'ERR_VALIDATION_FAILED');
    for (const roleIds of [[], ['01'], ['18446744073709551616'], ['18446744073709551615']]) {
      error(await call(app, 'POST', `${approvals}/${row.id}/approve`, admin, { roleIds }), 400, 'ERR_VALIDATION_FAILED');
    }
    error(await call(app, 'POST', `${approvals}/${row.id}/approve`, security, { roleIds: [developer, superRole] }), 403, 'ERR_RBAC_FORBIDDEN');
    error(await call(app, 'POST', `${approvals}/${row.id}/reject`, security, { reason: '  ' }), 400, 'ERR_VALIDATION_FAILED');
    assert.deepEqual(ok(await call(app, 'POST', `${approvals}/${row.id}/reject`, security, { reason: '  Add scope  ' })), { success: true });
    const rejected = await login(app, row.username, row.credential);
    assert.equal(ok(await call(app, 'GET', me, rejected)).reject_reason, 'Add scope');
    assert.deepEqual(error(await call(app, 'PUT', `${users}/${row.user_id}/status`, admin,
      { status: 'ACTIVE', version: 2 }), 400, 'ERR_INVALID_STATUS_TRANSITION'), { current_status: 'REJECTED' });
    ok(await call(app, 'POST', `${approvals}/resubmit`, rejected, { reason: 'Revised scope' }));
    const reopened = ok(await call(app, 'GET', `${approvals}/pending?pageSize=1`, security)).items[0];
    assert.notEqual(reopened.id, row.id);
    assert.equal(reopened.user_id, row.user_id);
    assert.equal(reopened.reason, 'Revised scope');
    error(await call(app, 'POST', `${approvals}/${row.id}/approve`, admin, { roleIds: [developer] }), 409, 'ERR_APPROVAL_STATE_CONFLICT');
    const approvalsResult = await concurrentMutations(pool, db, () => [admin, security].map((session) =>
      call(app, 'POST', `${approvals}/${reopened.id}/approve`, session, { roleIds: [highId, developer, highId] })));
    assert.deepEqual(approvalsResult.map((response) => response.statusCode).sort(), [200, 409]);
    ok(approvalsResult.find((response) => response.statusCode === 200));
    error(approvalsResult.find((response) => response.statusCode === 409), 409, 'ERR_APPROVAL_STATE_CONFLICT');
    const active = await login(app, row.username, row.credential);
    assert.equal(active.user.status, 'ACTIVE');
    assert.equal(active.user.must_change_password, false);
    assert.equal(active.user.version, 4);
    assert.deepEqual(await assignedRoles(db, row.user_id), [developer, highId]);
    assert.equal((await userState(db, row.user_id)).auth_version, 3);
    const [history] = await db.query(`SELECT action, reason, application_reason, operator_id, decided_at FROM sys_user_approvals
      WHERE user_id = CAST(CAST(? AS CHAR) AS UNSIGNED) ORDER BY id`, [row.user_id]);
    assert.deepEqual(history.map(({ action, reason, application_reason }) => [action, reason, application_reason]), [
      ['REJECT', 'Add scope', 'Original reason'], ['APPROVE', null, 'Revised scope'],
    ]);
    assert.equal(history[0].operator_id, securityId);
    assert(history.every(({ decided_at }) => decided_at instanceof Date));
    assert.deepEqual(events.splice(0), [['user-mark', row.user_id], ['user-mark', row.user_id]]);
  });

  await t.test('user projection, escaped search, role and status filters and version conflicts', async () => {
    const special = await register('m3_under', { email: 'test@example.test' });
    assert.deepEqual(error(await call(app, 'PUT', `${users}/${special.user_id}/status`, admin,
      { status: 'ACTIVE', version: 1 }), 400, 'ERR_INVALID_STATUS_TRANSITION'), { current_status: 'PENDING' });
    await db.query('UPDATE sys_users SET email = ? WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)', ['percent%literal@example.test', special.user_id]);
    for (const search of ['_', '%', 'literal@']) {
      const list = ok(await call(app, 'GET', `${users}?search=${encodeURIComponent(search)}&status=PENDING`, admin));
      assert.equal(list.total, 1);
      assert.deepEqual(list.items.map(({ id }) => id), [special.user_id]);
    }
    assert.equal(ok(await call(app, 'GET', `${users}?search=${encodeURIComponent("!%' OR 1=1")}`, admin)).total, 0);
    const unfilteredUniqueSuperAdminList = ok(await call(app, 'GET', `${users}?page=1&pageSize=20`, admin));
    assert.equal(unfilteredUniqueSuperAdminList.items.find(({ id }) => id === admin.user.id)?.is_last_super_admin, true);
    const superList = ok(await call(app, 'GET', `${users}?role=SUPER_ADMIN&page=1&pageSize=1`, admin));
    assert.equal(superList.total, 1);
    assert.equal(superList.items[0].id, admin.user.id);
    assert.equal(superList.items[0].is_last_super_admin, true);
    const row = ok(await call(app, 'GET', `${users}?search=basicuser`, admin)).items[0];
    assert.equal(row.id, basicId);
    assert.equal(row.is_last_super_admin, false);
    assert.deepEqual(row.roles.map(({ id }) => id), [developer]);
    assert.deepEqual(Object.keys(row).sort(), [
      'created_at', 'department', 'email', 'id', 'is_last_super_admin', 'is_password_expired', 'must_change_password',
      'password_expires_days', 'roles', 'status', 'updated_at', 'username', 'version',
    ]);
    for (const [method, path, body] of [
      ['PUT', 'status', { status: 'DISABLED' }], ['PUT', 'roles', { roleIds: [] }], ['POST', 'reset-password', {}],
    ]) {
      const result = await call(app, method, `${users}/${basicId}/${path}`, admin, { ...body, version: 2 });
      assert.deepEqual(error(result, 409, 'ERR_CONCURRENCY_CONFLICT'), { current_version: 1, submitted_version: 2 });
    }
    for (const [method, path, body] of [
      ['PUT', '/status', { status: 'DISABLED', version: admin.user.version }],
      ['PUT', '/roles', { roleIds: [developer], version: admin.user.version }], ['DELETE', '', undefined],
    ]) error(await call(app, method, `${users}/${admin.user.id}${path}`, admin, body), 400, 'ERR_SELF_ACTION_PROHIBITED');
    error(await call(app, 'PUT', `${users}/${basicId}/roles`, admin, { roleIds: ['18446744073709551615'], version: 1 }), 400, 'ERR_VALIDATION_FAILED');
    error(await call(app, 'DELETE', `${users}/18446744073709551615`, admin), 404, 'ERR_NOT_FOUND');
    error(await call(app, 'POST', `${approvals}/18446744073709551615/reject`, admin, { reason: 'missing' }), 404, 'ERR_NOT_FOUND');
    assert.deepEqual(events, []);
  });

  function statusChange(id, session, status, version) {
    return call(app, 'PUT', `${users}/${id}/status`, session, { status, version });
  }
  function roleChange(id, session, roleIds, version) {
    return call(app, 'PUT', `${users}/${id}/roles`, session, { roleIds, version });
  }
  async function rateLimit(id) {
    await db.query("INSERT INTO sys_rate_limit_revisions (scope_type, scope_id, last_revision) VALUES ('USER', ?, 5)", [id]);
    await db.query("INSERT INTO sys_rate_limits (scope_type, scope_id, revision, version) VALUES ('USER', ?, 5, 5)", [id]);
  }
  async function rateState(id) {
    const [[state]] = await db.query(`SELECT (SELECT revision FROM sys_rate_limits WHERE scope_type = 'USER' AND scope_id = CAST(CAST(? AS CHAR) AS UNSIGNED)) AS revision,
      (SELECT last_revision FROM sys_rate_limit_revisions WHERE scope_type = 'USER' AND scope_id = CAST(CAST(? AS CHAR) AS UNSIGNED)) AS last_revision`, [id, id]);
    return state;
  }
  async function issue(session, name) {
    const { pat } = ok(await call(app, 'POST', `${base}/pats`, session, { name }));
    return pat.id;
  }

  await t.test('status and role CAS, audit, session revocation and cancellation reasons', async () => {
    const secondSession = await login(app, 'basicuser', fixturePassword);
    assert.deepEqual(ok(await statusChange(basicId, admin, 'DISABLED', 1)), { success: true, version: 2 });
    for (const session of [basic, secondSession]) error(await call(app, 'GET', me, session), 401, 'ERR_AUTH_UNAUTHORIZED');
    assert.deepEqual(events.splice(0), [
      ['user-mark', basicId], ['user-cancel', basicId, 'ACCOUNT_DISABLED'], ['user-cancel-committed', basicId],
    ]);
    assert.deepEqual(ok(await statusChange(basicId, admin, 'ACTIVE', 2)), { success: true, version: 3 });
    assert.deepEqual(events.splice(0), [['user-mark', basicId]]);
    error(await statusChange(basicId, admin, 'ACTIVE', 3), 400, 'ERR_INVALID_STATUS_TRANSITION');
    const active = await login(app, 'basicuser', fixturePassword);
    assert.deepEqual(ok(await roleChange(basicId, admin, [highId], 3)), { success: true, version: 4 });
    error(await call(app, 'GET', me, active), 401, 'ERR_AUTH_UNAUTHORIZED');
    assert.deepEqual(events.splice(0), [
      ['user-mark', basicId], ['user-cancel', basicId, 'USER_ROLES_CHANGED'], ['user-cancel-committed', basicId],
    ]);
    assert.deepEqual(await assignedRoles(db, basicId), [highId]);
    assert.deepEqual(ok(await roleChange(basicId, admin, [], 4)), { success: true, version: 5 });
    assert.deepEqual(await assignedRoles(db, basicId), []);
    assert.equal((await userState(db, basicId)).auth_version, 5);
    events.length = 0;
    const [audits] = await db.query(`SELECT action, operator_id, target_id FROM sys_user_approvals
      WHERE target_id = CAST(CAST(? AS CHAR) AS UNSIGNED) ORDER BY id`, [basicId]);
    assert.deepEqual(audits.map(({ action }) => action), ['STATUS_CHANGE', 'STATUS_CHANGE', 'ROLE_CHANGE', 'ROLE_CHANGE']);
    assert(audits.every(({ operator_id, target_id }) => operator_id === admin.user.id && target_id === basicId));
  });

  await t.test('reset default and optional password, 401 for all old sessions, retained PAT and rate limit, redacted audit', async (subtest) => {
    const id = await fixture('resetuser', developer);
    const old = await login(app, 'resetuser', fixturePassword);
    const oldOther = await login(app, 'resetuser', fixturePassword);
    const patId = await issue(old, 'kept across reset');
    assert.equal(patId, '18446744073709551600');
    await rateLimit(id);
    await db.query('UPDATE sys_users SET failed_login_count = 5, locked_until = TIMESTAMPADD(MINUTE, 15, UTC_TIMESTAMP(3)) WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)', [id]);
    const warnings = [];
    subtest.mock.method(console, 'warn', (...args) => warnings.push(args));
    const url = `${users}/${id}/reset-password`;
    for (const invalid of ['', 'weak', 'A'.repeat(65)]) {
      error(await call(app, 'POST', url, admin, { version: 1, newTemporaryPassword: invalid }), 400, 'ERR_PASSWORD_POLICY_VIOLATED');
    }
    const response = await call(app, 'POST', url, admin, { version: 1 });
    assert.match(response.headers['cache-control'], /no-store/);
    const generated = ok(response);
    assert.deepEqual(Object.keys(generated).sort(), ['success', 'temporaryPassword', 'version']);
    assert.equal(generated.success, true);
    assert.equal(generated.version, 2);
    assert.equal(generated.temporaryPassword.length, 16);
    assert.equal(hasStrongPassword(generated.temporaryPassword), true);
    for (const session of [old, oldOther]) error(await call(app, 'GET', me, session), 401, 'ERR_AUTH_UNAUTHORIZED');
    error(await call(app, 'POST', `${base}/auth/login`, await csrf(app), { username: 'resetuser', password: fixturePassword }), 401, 'ERR_AUTH_FAILED');
    const forced = await login(app, 'resetuser', generated.temporaryPassword);
    assert.equal(forced.user.must_change_password, true);
    error(await call(app, 'GET', `${base}/pats`, forced), 403, 'ERR_MUST_CHANGE_PASSWORD');
    const chosen = password();
    assert.deepEqual(ok(await call(app, 'POST', url, admin, { version: 2, newTemporaryPassword: chosen, mustChangePassword: false })),
      { success: true, temporaryPassword: chosen, version: 3 });
    error(await call(app, 'GET', me, forced), 401, 'ERR_AUTH_UNAUTHORIZED');
    const unrestricted = await login(app, 'resetuser', chosen);
    assert.equal(unrestricted.user.must_change_password, false);
    assert.equal(ok(await call(app, 'GET', `${base}/pats`, unrestricted))[0].id, patId);
    const state = await userState(db, id);
    assert.equal(state.auth_version, 3);
    assert.equal(state.failed_login_count, 0);
    assert.equal(state.locked_until, null);
    assert(state.password_updated_at instanceof Date);
    assert.deepEqual(await rateState(id), { revision: 5, last_revision: 5 });
    assert.deepEqual(events.splice(0), Array.from({ length: 2 }, () => [
      ['user-mark', id], ['user-cancel', id, 'PASSWORD_RESET'], ['user-cancel-committed', id],
    ]).flat());
    const [audits] = await db.query(`SELECT action, details, reason FROM sys_user_approvals
      WHERE target_type = 'USER' AND target_id = CAST(CAST(? AS CHAR) AS UNSIGNED) ORDER BY id`, [id]);
    assert.deepEqual(audits, [
      { action: 'CONFIG_UPDATE', details: { operation: 'PASSWORD_RESET', mustChangePassword: true, version: 2 }, reason: null },
      { action: 'CONFIG_UPDATE', details: { operation: 'PASSWORD_RESET', mustChangePassword: false, version: 3 }, reason: null },
    ]);
    const safeTrace = JSON.stringify({ audits, warnings });
    assert.equal(safeTrace.includes(chosen) || safeTrace.includes(generated.temporaryPassword) || safeTrace.includes('$argon2id'), false);
    assert.deepEqual(warnings, []);
  });

  await t.test('delete cascades, cancels the pending approval, preserves counter and audit, and revokes only live PATs', async () => {
    const id = await fixture('deletable', developer);
    const session = await login(app, 'deletable', fixturePassword);
    const patId = await issue(session, 'live');
    const revoked = await issue(session, 'already revoked');
    await db.query('UPDATE sys_pats SET revoked_at = UTC_TIMESTAMP(3) WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)', [revoked]);
    await rateLimit(id);
    ok(await call(app, 'DELETE', `${users}/${id}`, admin));
    assert.equal(await userState(db, id), undefined);
    assert.deepEqual(await assignedRoles(db, id), []);
    assert.deepEqual(await rateState(id), { revision: null, last_revision: 5 });
    assert.equal((await db.query('SELECT id FROM sys_pats WHERE user_id = CAST(CAST(? AS CHAR) AS UNSIGNED)', [id]))[0].length, 0);
    error(await call(app, 'GET', me, session), 401, 'ERR_AUTH_UNAUTHORIZED');
    assert.deepEqual(events.splice(0), [
      ['user-mark', id], ['pat-mark', patId], ['user-cancel', id, 'USER_DELETED'],
      ['pat-cancel', patId, 'PAT_REVOKED'], ['user-cancel-committed', id],
    ]);
    const [[audit]] = await db.query("SELECT action, details FROM sys_user_approvals WHERE user_id = CAST(CAST(? AS CHAR) AS UNSIGNED) AND target_type = 'USER'", [id]);
    assert.deepEqual(audit, { action: 'CONFIG_UPDATE', details: { operation: 'USER_DELETE' } });

    const pending = await register('pendingdelete', { reason: 'History to retain' });
    ok(await call(app, 'DELETE', `${users}/${pending.user_id}`, admin));
    const [[canceled]] = await db.query(`SELECT action, application_reason, decided_at FROM sys_user_approvals
      WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)`, [pending.id]);
    assert.equal(canceled.action, 'CANCELED');
    assert.equal(canceled.application_reason, 'History to retain');
    assert(canceled.decided_at instanceof Date);
    error(await call(app, 'POST', `${approvals}/${pending.id}/approve`, admin, { roleIds: [developer] }), 409, 'ERR_APPROVAL_STATE_CONFLICT');
    events.length = 0;
  });

  for (const operation of ['freeze', 'demote', 'delete']) {
    await t.test(`TC-BE-17: simultaneous mutual ${operation} leaves one ACTIVE super admin`, async () => {
      const sessionA = await login(app, 'm3admin', adminPassword);
      const username = `second_${operation}`;
      const idB = await fixture(username, superRole);
      const sessionB = await login(app, username, fixturePassword);
      const idA = sessionA.user.id;
      const unfilteredDualSuperAdminList = ok(await call(app, 'GET', `${users}?page=1&pageSize=20`, sessionA));
      assert.equal(unfilteredDualSuperAdminList.items.filter(({ is_last_super_admin }) => is_last_super_admin).length, 0);
      assert.equal(ok(await call(app, 'GET', `${users}?role=SUPER_ADMIN`, sessionA)).items.filter(({ is_last_super_admin }) => is_last_super_admin).length, 0);
      const mutate = (target, actor) => {
        if (operation === 'freeze') return statusChange(target.user.id, actor, 'DISABLED', target.user.version);
        if (operation === 'demote') return roleChange(target.user.id, actor, [developer], target.user.version);
        return call(app, 'DELETE', `${users}/${target.user.id}`, actor);
      };
      const results = await concurrentMutations(pool, db, () => [mutate(sessionA, sessionB), mutate(sessionB, sessionA)]);
      assert.deepEqual(results.map((response) => response.statusCode).sort(), [200, 400]);
      error(results.find((response) => response.statusCode === 400), 400, 'ERR_LAST_SUPER_ADMIN');
      const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM sys_users u JOIN sys_user_roles ur ON ur.user_id = u.id
        WHERE u.status = 'ACTIVE' AND ur.role_id = CAST(CAST(? AS CHAR) AS UNSIGNED)`, [superRole]);
      assert.equal(total, '1');
      assert.equal(events.filter(([event]) => event === 'user-mark').length, 1);
      events.length = 0;
      // Restore the original bootstrap operator between independent race fixtures.
      if (await userState(db, idA)) {
        await db.query("UPDATE sys_users SET status = 'ACTIVE' WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)", [idA]);
      } else {
        await db.query("INSERT INTO sys_users (id, username, password_hash, status) VALUES (?, 'm3admin', ?, 'ACTIVE')", [idA, await hashPassword(adminPassword)]);
      }
      await db.query('INSERT IGNORE INTO sys_user_roles (user_id, role_id) VALUES (?, ?)', [idA, superRole]);
      await db.query('DELETE FROM sys_users WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)', [idB]);
    });
  }

  await t.test('governance rechecks the operator after waiting for the role lock', async () => {
    const currentAdmin = await login(app, 'm3admin', adminPassword);
    const operatorId = await fixture('staleoperator', superRole);
    const operator = await login(app, 'staleoperator', fixturePassword);
    let queued;
    await withMetadataTransaction(pool, async (tx) => {
      await tx.query("SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE");
      queued = roleChange(basicId, operator, [developer], 5);
      await waitForRoleLockReaders(db, 1);
      await tx.query("UPDATE sys_users SET status = 'DISABLED', auth_version = auth_version + 1 WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)", [operatorId]);
    });
    error(await queued, 401, 'ERR_AUTH_UNAUTHORIZED');
    assert.deepEqual(await assignedRoles(db, basicId), []);
    assert.equal((await userState(db, basicId)).version, 5);
    assert.deepEqual(events, []);
    ok(await call(app, 'DELETE', `${users}/${operatorId}`, currentAdmin));
    events.length = 0;
  });

  await t.test('TC-BE-17: audit INSERT failure rolls back status, roles, reset and deletion before invalidation', async () => {
    const currentAdmin = await login(app, 'm3admin', adminPassword);
    const id = await fixture('auditrollback', developer);
    const target = await login(app, 'auditrollback', fixturePassword);
    const patId = await issue(target, 'survives rollback');
    await rateLimit(id);
    const baseline = await userState(db, id);
    await db.query(`ALTER TABLE sys_user_approvals ADD CONSTRAINT m3_fail_admin_audit CHECK (
      target_type <> 'USER' OR action NOT IN ('STATUS_CHANGE', 'ROLE_CHANGE', 'CONFIG_UPDATE') OR target_id <> ${id}
    )`);
    try {
      for (const mutate of [
        () => statusChange(id, currentAdmin, 'DISABLED', 1),
        () => roleChange(id, currentAdmin, [highId], 1),
        () => call(app, 'POST', `${users}/${id}/reset-password`, currentAdmin, { version: 1 }),
        () => call(app, 'DELETE', `${users}/${id}`, currentAdmin),
      ]) {
        error(await mutate(), 500, 'ERR_INTERNAL_SERVER');
        assert.deepEqual(await userState(db, id), baseline);
        assert.deepEqual(await assignedRoles(db, id), [developer]);
        assert.deepEqual(await rateState(id), { revision: 5, last_revision: 5 });
        assert.equal(ok(await call(app, 'GET', `${base}/pats`, target))[0].id, patId);
        assert.deepEqual(events, []);
      }
      await login(app, 'auditrollback', fixturePassword);
      const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM sys_user_approvals WHERE target_type = 'USER' AND target_id = CAST(CAST(? AS CHAR) AS UNSIGNED)", [id]);
      assert.equal(total, '0');
    } finally {
      await db.query('ALTER TABLE sys_user_approvals DROP CHECK m3_fail_admin_audit');
    }
  });
});
