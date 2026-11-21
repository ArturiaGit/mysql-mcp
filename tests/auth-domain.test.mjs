import assert from 'node:assert/strict';
import test from 'node:test';
import { IpAttemptLimiter } from '../apps/admin-api/dist/ip-attempt-limiter.js';
import { assertGuard } from '../apps/admin-api/dist/auth-routes.js';
import { Argon2Semaphore } from '../packages/security/dist/index.js';
import {
  calculateDaysRemaining, csrfToken, equalSecret, hasStrongPassword, passwordPolicyDTO,
} from '../apps/admin-api/dist/auth-domain.js';

test('password policy, CSRF and RD-08 provisional calculation have stable boundaries', () => {
  assert.equal(hasStrongPassword('Password123#'), true);
  assert.equal(hasStrongPassword('password123'), false);
  assert.equal(equalSecret(csrfToken('seed', 'secret'), csrfToken('seed', 'secret')), true);
  assert.equal(equalSecret('short', 'longer'), false);
  const now = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(calculateDaysRemaining(new Date(now.getTime() + 1), now), 1);
  assert.equal(calculateDaysRemaining(new Date(now.getTime() - 1), now), 0);
  assert.equal(calculateDaysRemaining(null, now), -1);
  assert.equal(passwordPolicyDTO(null, now, now).daysRemaining, -1);
});

test('Argon2 semaphore transfers a released slot directly to a queued operation', async () => {
  const semaphore = new Argon2Semaphore(1, 2);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = semaphore.run(async () => gate);
  const order = [];
  const second = semaphore.run(async () => { order.push('second'); });
  const third = semaphore.run(async () => { order.push('third'); });
  await assert.rejects(semaphore.run(async () => {}), /ARGON2_CAPACITY_EXCEEDED/);
  release();
  await Promise.all([first, second, third]);
  assert.deepEqual(order, ['second', 'third']);
});

test('IP admission counts all attempts and resets after the cooldown', () => {
  const limiter = new IpAttemptLimiter(20);
  for (let attempt = 0; attempt < 20; attempt++) limiter.admit('192.0.2.1', 0);
  assert.throws(() => limiter.admit('192.0.2.1', 1), { code: 'ERR_RATE_LIMIT_USER', details: { retry_after_sec: 900 } });
  assert.throws(() => limiter.admit('192.0.2.1', 900_000), { statusCode: 429 });
  limiter.admit('192.0.2.1', 900_001);
});

test('status and password guards precede role checks', () => {
  const policy = { roles: ['SUPER_ADMIN'] };
  const user = { status: 'PENDING', must_change_password: true, is_password_expired: false, roles: [] };
  assert.throws(() => assertGuard(user, policy), { code: 'ERR_AUTH_ACCOUNT_PENDING' });
  assert.throws(() => assertGuard({ ...user, status: 'ACTIVE' }, policy), { code: 'ERR_MUST_CHANGE_PASSWORD' });
  assert.throws(() => assertGuard({ ...user, status: 'ACTIVE', must_change_password: false }, policy), { code: 'ERR_RBAC_FORBIDDEN' });
  assert.doesNotThrow(() => assertGuard({ ...user, status: 'ACTIVE', must_change_password: false, roles: ['SUPER_ADMIN'] }, policy));
});
