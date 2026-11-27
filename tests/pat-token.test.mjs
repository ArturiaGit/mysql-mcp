import assert from 'node:assert/strict';
import test from 'node:test';
import { isDuplicateActivePatNameError } from '../apps/admin-api/dist/pat-service.js';
import { createPatToken, hashPatToken } from '../packages/security/dist/index.js';

test('PAT generation uses a 32-byte lowercase hex suffix and a 16-character display prefix', () => {
  const first = createPatToken();
  const second = createPatToken();
  assert.match(first, /^mcp_pat_[0-9a-f]{64}$/);
  assert.match(second, /^mcp_pat_[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.match(first.slice(0, 16), /^mcp_pat_[0-9a-f]{8}$/);
});

test('PAT digest matches an independent HMAC-SHA-256 test vector', () => {
  const token = `mcp_pat_${'ab'.repeat(32)}`;
  const digest = hashPatToken(token, 'test pepper: 32 bytes fixture arbitrary');
  assert.equal(digest, 'a9ef2cb76bbdd1cdc96b1a87f0eb5a70b1ac9b6c653dce1909a4520d991e5782');
  assert.notEqual(hashPatToken(token, 'another fixture: 32 bytes or longer'), digest);
});

test('duplicate active PAT name detection only matches uk_user_active_name and ignores uk_token_hash', () => {
  assert.equal(isDuplicateActivePatNameError({
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlMessage: "Duplicate entry '1-dev-token' for key 'sys_pats.uk_user_active_name'",
  }), true);
  assert.equal(isDuplicateActivePatNameError({
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlMessage: "Duplicate entry '1-dev-token' for key 'uk_user_active_name'",
  }), true);
  assert.equal(isDuplicateActivePatNameError({
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlMessage: "Duplicate entry 'uk_user_active_name' for key 'sys_pats.uk_token_hash'",
  }), false);
  assert.equal(isDuplicateActivePatNameError({
    code: 'ER_LOCK_DEADLOCK',
    errno: 1213,
    sqlMessage: "Deadlock on key 'sys_pats.uk_user_active_name'",
  }), false);
});
