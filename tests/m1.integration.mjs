import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createServer } from '../apps/admin-api/dist/server.js';
import { createMetadataPool, createMetadataQueryExecutor, readMetadataConfig } from '../packages/core-engine/dist/index.js';

const config = readMetadataConfig(process.env);
assert(config, 'M1 integration requires the isolated Docker MySQL 8.0 database');
const testEnv = { NODE_ENV: 'production', ADMIN_API_SECRET: randomBytes(32).toString('hex'),
  GATEWAY_MASTER_KEYS: JSON.stringify({ active_key_id: 'test', keys: { test: randomBytes(32).toString('hex') } }) };
const testPassword = () => 'Aa1!' + randomBytes(18).toString('base64url');
const cookiePair = (response) => {
  const setCookie = response.headers.getSetCookie();
  const sid = setCookie.find((value) => value.startsWith('mcp_admin_sid='));
  const csrf = setCookie.find((value) => value.startsWith('mcp_csrf_seed='));
  assert(sid && csrf, `expected session and CSRF cookies`);
  for (const cookie of [sid, csrf]) {
    assert(/; Path=\/api\/v1; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/.test(cookie), 'expected secure cookie attributes');
  }
  return { sid: sid.split(';', 1)[0], csrf: csrf.split(';', 1)[0] };
};
const csrfCookie = (response) => {
  const value = response.headers.getSetCookie().find((entry) => entry.startsWith('mcp_csrf_seed='));
  assert(value, 'expected CSRF seed cookie');
  return value.split(';', 1)[0];
};
const cookieHeader = (...cookies) => cookies.join('; ');
const request = (base, path, method = 'GET', body, cookies = [], token) => fetch(`${base}${path}`, {
  method,
  headers: {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(cookies.length ? { cookie: cookieHeader(...cookies) } : {}),
    ...(token ? { 'x-csrf-token': token } : {}),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  signal: AbortSignal.timeout(15_000),
});
const csrfFor = async (base, { sid, csrf }) => {
  const response = await request(base, '/api/v1/auth/csrf', 'GET', undefined, [sid, csrf]);
  return (await response.json()).csrfToken;
};

test('real MySQL 8.0 M1 bootstrap and auth guard contract including TC-BE-16', async (t) => {
  const fixturePool = createMetadataPool(config);
  t.after(() => fixturePool.close());
  const fixtureDb = createMetadataQueryExecutor(fixturePool);
  const [[version]] = await fixtureDb.query('SELECT VERSION() AS version');
  assert.match(version.version, /^8\.0\./);
  const ddl = readFileSync(new URL('../docs/sql/001_metadata_schema.sql', import.meta.url), 'utf8');
  assert.equal([...ddl.matchAll(/^CREATE TABLE `([^`]+)`/gm)].length, 14);

  const [[seedState]] = await fixtureDb.query('SELECT setting_value FROM sys_system_settings WHERE setting_key = ?', ['bootstrap_state']);
  assert.equal(seedState.setting_value, 'PENDING', 'M1 integration requires a freshly initialized database');
  const [[startingUsers]] = await fixtureDb.query('SELECT COUNT(*) AS count FROM sys_users');
  assert.equal(startingUsers.count, '0', 'M1 integration requires an empty fixture database');
  const initialPassword = testPassword();
  const newPassword = testPassword();
  const pendingPassword = testPassword();
  const lockPassword = testPassword();
  const rejectedPassword = testPassword();
  const app = createServer(config, { ...testEnv, BOOTSTRAP_ADMIN_USERNAME: 'm1admin',
    BOOTSTRAP_ADMIN_PASSWORD: initialPassword, BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test' });
  t.after(() => app.close());
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  assert.equal((await request(base, '/health/ready')).status, 200);
  const csrfResponse = await request(base, '/api/v1/auth/csrf');
  assert.equal(csrfResponse.status, 200);
  assert.match(csrfResponse.headers.get('cache-control'), /no-store/);
  const anonymous = { csrf: csrfCookie(csrfResponse) };
  const { csrfToken } = await csrfResponse.json();
  assert(csrfToken);

  const login = await request(base, '/api/v1/auth/login', 'POST', { username: 'm1admin', password: initialPassword }, [anonymous.csrf], csrfToken);
  assert.equal(login.status, 200);
  const adminCookies = cookiePair(login);
  const admin = await login.json();
  assert.equal(admin.user.id, '1');
  assert.equal(admin.user.must_change_password, true);
  assert.equal(admin.user.email, 'admin@example.test');
  assert.deepEqual(admin.user.roles, ['SUPER_ADMIN']);
  const [[roles]] = await fixtureDb.query('SELECT COUNT(*) AS count FROM sys_roles WHERE is_builtin = 1');
  assert.equal(roles.count, '5');
  const [[notification]] = await fixtureDb.query('SELECT is_encrypted FROM sys_system_settings WHERE setting_key = ?', ['notification_channels']);
  assert.equal(notification.is_encrypted, 1);
  const restart = createServer(config, testEnv);
  t.after(() => restart.close());
  assert.equal((await restart.inject('/health/ready')).statusCode, 200);
  const rotatedCsrfCookie = adminCookies.csrf;
  const refreshedCsrfResponse = await request(base, '/api/v1/auth/csrf', 'GET', undefined, [adminCookies.sid, rotatedCsrfCookie]);
  const { csrfToken: adminToken } = await refreshedCsrfResponse.json();

  const me = await request(base, '/api/v1/auth/me', 'GET', undefined, [adminCookies.sid]);
  assert.equal(me.status, 200);
  const user = await me.json();
  assert.equal(user.id, '1');
  assert.equal(user.status, 'ACTIVE');

  const [[beforeCsrfCount]] = await fixtureDb.query("SELECT COUNT(*) AS count FROM sys_users WHERE username = 'no-csrf-user'");
  const rejectedCsrfWrite = await request(base, '/api/v1/auth/register', 'POST', {
    username: 'no-csrf-user', password: testPassword(),
  });
  assert.equal(rejectedCsrfWrite.status, 403);
  const [[afterCsrfCount]] = await fixtureDb.query("SELECT COUNT(*) AS count FROM sys_users WHERE username = 'no-csrf-user'");
  assert.equal(String(beforeCsrfCount.count), String(afterCsrfCount.count), 'preValidation CSRF rejection has no business side effect');

  const noCsrf = await request(base, '/api/v1/auth/logout', 'POST', {}, [adminCookies.sid]);
  assert.equal(noCsrf.status, 403);
  assert.equal((await noCsrf.json()).code, 'ERR_CSRF_INVALID');
  const wrongOld = await request(base, '/api/v1/auth/change-password', 'POST', {
    oldPassword: 'incorrect', newPassword: newPassword,
  }, [adminCookies.sid, rotatedCsrfCookie], adminToken);
  assert.equal(wrongOld.status, 400);
  assert.equal((await wrongOld.json()).code, 'ERR_OLD_PASSWORD_INVALID');
  assert.equal((await request(base, '/api/v1/auth/me', 'GET', undefined, [adminCookies.sid])).status, 200);

  const l3 = await request(base, '/api/v1/auth/password-policy', 'PUT', { passwordExpiresDays: null }, [adminCookies.sid, adminCookies.csrf], adminToken);
  assert.equal(l3.status, 403);
  assert.equal((await l3.json()).code, 'ERR_MUST_CHANGE_PASSWORD');
  assert.equal((await request(base, '/api/v1/auth/password-policy', 'GET', undefined, [adminCookies.sid])).status, 200);
  const secondLogin = await request(base, '/api/v1/auth/login', 'POST', { username: 'm1admin', password: initialPassword }, [anonymous.csrf], csrfToken);
  assert.equal(secondLogin.status, 200);
  const otherCookies = cookiePair(secondLogin);
  await fixtureDb.query('INSERT INTO sys_pats (user_id, name, token_prefix, token_hash) VALUES (?, ?, ?, ?)',
    [user.id, 'revocation fixture', 'mcp_pat_fixture', randomBytes(32).toString('hex')]);
  const changed = await request(base, '/api/v1/auth/change-password', 'POST', {
    oldPassword: initialPassword, newPassword: newPassword,
  }, [adminCookies.sid, rotatedCsrfCookie], adminToken);
  assert.equal(changed.status, 200);
  const changedCookies = cookiePair(changed);
  assert(changedCookies.sid !== adminCookies.sid, 'session ID must rotate');
  assert(changedCookies.csrf !== rotatedCsrfCookie, 'CSRF seed must rotate');
  assert.equal((await request(base, '/api/v1/auth/me', 'GET', undefined, [adminCookies.sid])).status, 401);
  assert.equal((await request(base, '/api/v1/auth/me', 'GET', undefined, [otherCookies.sid])).status, 401);
  const [[pat]] = await fixtureDb.query('SELECT revoked_at FROM sys_pats WHERE user_id = ?', [user.id]);
  assert(pat.revoked_at instanceof Date);
  const [[authState]] = await fixtureDb.query('SELECT auth_version, must_change_password FROM sys_users WHERE id = ?', [user.id]);
  assert.deepEqual({ ...authState }, { auth_version: 2, must_change_password: 0 });
  const [[audit]] = await fixtureDb.query("SELECT COUNT(*) AS count FROM sys_user_approvals WHERE user_id = ? AND details->>'$.event' = 'PASSWORD_CHANGED'", [user.id]);
  assert.equal(audit.count, '1');
  const changedCsrf = await request(base, '/api/v1/auth/csrf', 'GET', undefined, [changedCookies.sid, changedCookies.csrf]);
  const { csrfToken: changedToken } = await changedCsrf.json();

  const staleToken = await request(base, '/api/v1/auth/logout', 'POST', undefined, [changedCookies.sid, changedCookies.csrf], adminToken);
  assert.equal(staleToken.status, 403);
  assert.equal((await staleToken.json()).code, 'ERR_CSRF_INVALID');
  const registration = await request(base, '/api/v1/auth/register', 'POST', {
    username: 'pendinguser', password: pendingPassword, email: null, department: 'QA', reason: 'Integration request',
  }, [anonymous.csrf], csrfToken);
  assert.equal(registration.status, 200);
  const pendingLogin = await request(base, '/api/v1/auth/login', 'POST', {
    username: 'pendinguser', password: pendingPassword,
  }, [anonymous.csrf], csrfToken);
  assert.equal(pendingLogin.status, 200);
  const pendingCookies = cookiePair(pendingLogin);
  await fixtureDb.query("UPDATE sys_users SET must_change_password=1 WHERE username='pendinguser'");
  const pendingProfile = await request(base, '/api/v1/auth/me', 'GET', undefined, [pendingCookies.sid]);
  assert.equal(pendingProfile.status, 200);
  const pendingView = await pendingProfile.json();
  assert.equal(pendingView.status, 'PENDING');
  assert.equal(pendingView.email, null);
  assert(!Object.hasOwn(pendingView, 'roles'));
  const patsGuard = await request(base, '/api/v1/pats', 'GET', undefined, [pendingCookies.sid]);
  assert.equal(patsGuard.status, 403);
  assert.equal((await patsGuard.json()).code, 'ERR_AUTH_ACCOUNT_PENDING');

  const policy = await request(base, '/api/v1/auth/password-policy', 'GET', undefined, [changedCookies.sid]);
  assert.equal(policy.status, 200);
  const policyBody = await policy.json();
  assert.equal(policyBody.daysRemaining, 90);
  const disabledPolicy = await request(base, '/api/v1/auth/password-policy', 'PUT', { passwordExpiresDays: null }, [changedCookies.sid, changedCookies.csrf], changedToken);
  assert.equal(disabledPolicy.status, 200);
  assert.equal((await disabledPolicy.json()).passwordExpiresDays, null);
  const badPolicy = await request(base, '/api/v1/auth/password-policy', 'PUT', { passwordExpiresDays: 10 }, [changedCookies.sid, changedCookies.csrf], changedToken);
  assert.equal(badPolicy.status, 400);

  const users = await request(base, '/api/v1/auth/register', 'POST', {
    username: 'lockuser', password: lockPassword, reason: 'Lock test',
  }, [anonymous.csrf], csrfToken);
  assert.equal(users.status, 200);
  const [[lockUser]] = await fixtureDb.query("SELECT id FROM sys_users WHERE username = 'lockuser'");
  await fixtureDb.query("UPDATE sys_users SET status='ACTIVE' WHERE id=?", [String(lockUser.id)]);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const failed = await request(base, '/api/v1/auth/login', 'POST', { username: 'lockuser', password: 'wrong' }, [anonymous.csrf], csrfToken);
    assert.equal(failed.status, attempt === 5 ? 429 : 401);
    const error = await failed.json();
    assert.equal(error.code, attempt === 5 ? 'ERR_AUTH_ACCOUNT_LOCKED' : 'ERR_AUTH_FAILED');
    if (attempt < 5) assert.equal(error.remaining_attempts, 5 - attempt);
    else assert.equal(error.retry_after_sec, 900);
  }

  const [[locked]] = await fixtureDb.query('SELECT failed_login_count, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), locked_until) AS seconds_left FROM sys_users WHERE id = ?', [lockUser.id]);
  assert.equal(locked.failed_login_count, 5);
  assert(Number(locked.seconds_left) >= 895 && Number(locked.seconds_left) <= 900);
  const correctButLocked = await request(base, '/api/v1/auth/login', 'POST', { username: 'lockuser', password: lockPassword }, [anonymous.csrf], csrfToken);
  assert.equal(correctButLocked.status, 429);
  assert.equal((await correctButLocked.json()).code, 'ERR_AUTH_ACCOUNT_LOCKED');
  const rejected = await request(base, '/api/v1/auth/register', 'POST', {
    username: 'rejecteduser', password: rejectedPassword, reason: 'Resubmit test',
  }, [anonymous.csrf], csrfToken);
  assert.equal(rejected.status, 200);
  await fixtureDb.query("UPDATE sys_users SET status='REJECTED' WHERE username='rejecteduser'");
  await fixtureDb.query("UPDATE sys_user_approvals SET action = 'REJECT', reason = ?, decided_at = UTC_TIMESTAMP(3) WHERE user_id = (SELECT id FROM sys_users WHERE username = ?) AND action = 'SUBMIT'", ['Needs context', 'rejecteduser']);
  const rejectedLogin = await request(base, '/api/v1/auth/login', 'POST', { username: 'rejecteduser', password: rejectedPassword }, [anonymous.csrf], csrfToken);
  assert.equal(rejectedLogin.status, 200);
  const rejectedCookies = cookiePair(rejectedLogin);
  assert.equal((await (await request(base, '/api/v1/auth/me', 'GET', undefined, [rejectedCookies.sid])).json()).reject_reason, 'Needs context');
  const rejectedCsrfToken = await csrfFor(base, rejectedCookies);
  const resubmitted = await request(base, '/api/v1/approvals/resubmit', 'POST', { email: null, department: 'Revised', reason: 'Additional context' }, [rejectedCookies.sid, rejectedCookies.csrf], rejectedCsrfToken);
  assert.equal(resubmitted.status, 200);
  assert.equal((await (await request(base, '/api/v1/auth/me', 'GET', undefined, [rejectedCookies.sid])).json()).status, 'PENDING');
  const [[resubmitRow]] = await fixtureDb.query("SELECT action, application_reason FROM sys_user_approvals WHERE user_id = (SELECT id FROM sys_users WHERE username = ?) AND action = 'RESUBMIT'", ['rejecteduser']);
  assert.equal(resubmitRow.application_reason, 'Additional context');
  const repeated = await request(base, '/api/v1/approvals/resubmit', 'POST', { reason: 'Repeat' }, [rejectedCookies.sid, rejectedCookies.csrf], rejectedCsrfToken);
  assert.equal(repeated.status, 403);
  assert.equal((await repeated.json()).code, 'ERR_AUTH_ACCOUNT_PENDING');
  await fixtureDb.query("UPDATE sys_users SET status='DISABLED', auth_version = auth_version + 1 WHERE username='rejecteduser'");
  assert.equal((await (await request(base, '/api/v1/auth/me', 'GET', undefined, [rejectedCookies.sid])).json()).status, 'DISABLED');

  const badRegister = await request(base, '/api/v1/auth/register', 'POST', { username: 'bad' }, [anonymous.csrf], csrfToken);
  assert.equal(badRegister.status, 400);
  const duplicate = await request(base, '/api/v1/auth/register', 'POST', { username: 'pendinguser', password: pendingPassword }, [anonymous.csrf], csrfToken);
  assert.equal(duplicate.status, 409);
  const loggedOut = await request(base, '/api/v1/auth/logout', 'POST', {}, [changedCookies.sid, changedCookies.csrf], changedToken);
  assert.equal(loggedOut.status, 200);
  assert.equal((await request(base, '/api/v1/auth/me', 'GET', undefined, [changedCookies.sid])).status, 401);
  await fixtureDb.query("UPDATE sys_users SET status='DISABLED' WHERE username='m1admin'");
  assert.equal((await request(base, '/health/ready')).status, 503);
  const unsafeRestart = createServer(config, { ...testEnv, INITIAL_ADMIN_PASSWORD: testPassword() });
  t.after(() => unsafeRestart.close());
  assert.equal((await unsafeRestart.inject('/health/ready')).statusCode, 503);
  const [[adminCount]] = await fixtureDb.query("SELECT COUNT(*) AS count FROM sys_users WHERE username='admin'");
  assert.equal(adminCount.count, '0');
  await fixtureDb.query("UPDATE sys_system_settings SET setting_value='PENDING' WHERE setting_key='bootstrap_state'");
  const nonEmpty = createServer(config, { ...testEnv, INITIAL_ADMIN_PASSWORD: testPassword() });
  t.after(() => nonEmpty.close());
  assert.equal((await nonEmpty.inject('/health/live')).statusCode, 200);
  assert.equal((await nonEmpty.inject('/health/ready')).statusCode, 503);
  assert.equal((await nonEmpty.inject('/api/v1/auth/csrf')).statusCode, 503);
  const [[state]] = await fixtureDb.query("SELECT setting_value FROM sys_system_settings WHERE setting_key='bootstrap_state'");
  assert.equal(state.setting_value, 'PENDING');
  console.log(`MySQL ${version.version}; bootstrap READY; 9 M1 route contracts, CSRF preValidation, Session Regeneration, brute-force lockout and TC-BE-16 PASS`);
});
