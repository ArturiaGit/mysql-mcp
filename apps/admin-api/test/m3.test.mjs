import assert from 'node:assert/strict';
import test from 'node:test';
import { errorBody, ApiError } from '../dist/errors.js';
import { hasStrongPassword } from '../dist/auth-domain.js';
import { entityParams } from '../dist/request-validation.js';
import { generateTemporaryPassword } from '../dist/user-administration-service.js';

test('governance request identifiers cover the unsigned 64-bit range exactly', () => {
  for (const id of ['1', '9007199254740993', '18446744073709551615']) {
    assert.deepEqual(entityParams.parse({ id }), { id });
  }
  for (const id of ['0', '01', '-1', '1e3', '18446744073709551616', 1]) {
    assert.equal(entityParams.safeParse({ id }).success, false);
  }
});

test('temporary password generation always satisfies the 16-character policy', () => {
  for (let index = 0; index < 48; index++) {
    const value = generateTemporaryPassword();
    assert.equal(value.length, 16);
    assert.equal(hasStrongPassword(value), true);
  }
});

test('conflict errors serialize only the two version fields', () => {
  const details = { current_version: 3, submitted_version: 2, validation_errors: [] };
  const body = errorBody(new ApiError(409, 'ERR_CONCURRENCY_CONFLICT', details));
  assert.deepEqual(body.details, { current_version: 3, submitted_version: 2 });
  assert.match(body.message, /管理员/);
  assert.match(body.action_guidance, /草稿/);
  assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);
});
