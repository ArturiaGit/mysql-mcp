'use strict';
// Round 4: only API-R1-03's timestamp/L3 exemption and API-R1-05's two CAS entries.
// Execute documented functions in isolation. The transaction adapter is a test double,
// NOT MySQL, an HTTP server, or a real concurrent-database correctness proof.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, '');
const digest = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex').toUpperCase();
function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => l.startsWith(heading));
  assert(start >= 0, `Missing section: ${heading}`);
  const level = lines[start].match(/^#+/)[0].length;
  let end = start + 1;
  while (end < lines.length) {
    const m = lines[end].match(/^(#+) /);
    if (m && m[1].length <= level) break;
    end++;
  }
  return lines.slice(start, end).join('\n');
}
function block(text) {
  const m = text.match(/```typescript\r?\n([\s\S]+?)```/);
  assert(m, 'Missing TypeScript code block');
  return m[1];
}
function compile(source, mode = 'strip') {
  return stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm, '').replace(/^export /gm, ''), { mode });
}
class AppError extends Error {
  constructor(fields) { super(fields.message); Object.assign(this, fields); }
}
async function main() {
  const files = ['docs/API_CONTRACT_SPEC.md', 'docs/BACKEND_ARCHITECTURE_SPEC.md', 'docs/reviews/API_CONTRACT_REVIEW_ROUND3.md'];
  const prior = fs.readdirSync(__dirname).filter(n => !n.includes('round4')).map(n => 'docs/reviews/' + n);
  const protectedFiles = [...files, ...prior];
  const before = Object.fromEntries(protectedFiles.map(f => [f, digest(f)]));
  const api = read(files[0]);
  const backend = read(files[1]);
  const guardSource = block(section(backend, '### 5.5 '));
  const fixedTime = '2026-11-09T00:00:00.000Z';
  class FixedDate extends Date { static now() { return Date.parse(fixedTime); } }
  const guardContext = vm.createContext({ AppError, Date: FixedDate });
  vm.runInContext(compile(guardSource) + '\nglobalThis.guard = fourTierSecurityGuard;', guardContext);
  const guardCases = [
    ['expired_business', 'GET', '/api/v1/pats', 'expired', 'ERR_MUST_CHANGE_PASSWORD'],
    ['expired_change_password', 'POST', '/api/v1/auth/change-password', 'expired', 'ALLOW'],
    ['expired_policy_get', 'GET', '/api/v1/auth/password-policy', 'expired', 'ALLOW'],
    ['anonymous_policy_get', 'GET', '/api/v1/auth/password-policy', 'anonymous', 'ERR_AUTH_UNAUTHORIZED'],
    ['pending_policy_get', 'GET', '/api/v1/auth/password-policy', 'pending', 'ERR_AUTH_ACCOUNT_PENDING'],
    ['expired_policy_put', 'PUT', '/api/v1/auth/password-policy', 'expired', 'ERR_MUST_CHANGE_PASSWORD'],
    ['forced_change_policy_put', 'PUT', '/api/v1/auth/password-policy', 'forced', 'ERR_MUST_CHANGE_PASSWORD'],
    ['fresh_policy_put', 'PUT', '/api/v1/auth/password-policy', 'fresh', 'ALLOW'],
  ];
  const guardProbes = [];
  for (const [name, method, route, account, expected] of guardCases) {
    const req = { method, url: route, routeOptions: { url: route, config: {} }, currentUser: {
      id: '1001', status: 'ACTIVE', roles: ['DEVELOPER'], must_change_password: account === 'forced',
      password_expires_days: 90,
      password_updated_at: account === 'fresh' || account === 'forced' ? '2026-11-08T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
    } };
    if (account === 'anonymous') delete req.currentUser;
    if (account === 'pending') req.currentUser.status = 'PENDING';
    if (method === 'PUT') req.body = { passwordExpiresDays: null };
    let actual = 'ALLOW';
    try { await guardContext.guard(req, {}); } catch (e) { actual = e.code || e.message; }
    guardProbes.push({ name, method, route, account, expected, actual, matches_expected: expected === actual });
  }
  const txSource = block(section(backend, '### 4.3 '));
  const serviceSource = block(section(backend, '#### 4.4.1 '));
  const serviceContext = vm.createContext({ AppError, toEntityId: String });
  vm.runInContext(compile(txSource) + '\n' + compile(serviceSource, 'transform') + '\nglobalThis.Service = UserService;', serviceContext);
  const casProbes = [];
  for (const method of ['updateUserStatus', 'updateUserRoles']) {
    for (const stale of [false, true]) {
      let state = { version: stale ? 2 : 1, authVersion: 7, status: 'ACTIVE', roles: ['10'], audit: [] };
      const initial = JSON.stringify(state);
      const events = [];
      const queries = [];
      let working;
      const conn = {
        async beginTransaction() { events.push('begin'); working = structuredClone(state); },
        async commit() { events.push('commit'); state = working; },
        async rollback() { events.push('rollback'); working = undefined; },
        release() { events.push('release'); },
        async query(sql, args = []) {
          const q = sql.replace(/\s+/g, ' ').trim(); queries.push({ sql: q, args });
          if (q.startsWith('SELECT u.id')) return [[{ id: '9999' }]];
          if (q.startsWith('SELECT id FROM sys_roles')) return [[{ id: '1' }]];
          if (q.startsWith('DELETE FROM sys_user_roles')) { working.roles = []; return [{ affectedRows: 1 }]; }
          if (q.startsWith('INSERT INTO sys_user_roles')) { working.roles = args[0].map(pair => pair[1]); return [{ affectedRows: working.roles.length }]; }
          if (q.startsWith('UPDATE sys_users')) {
            assert(/WHERE id = \? AND version = \?/.test(q), 'Missing CAS predicate');
            assert(/\bversion = version \+ 1/.test(q), 'Missing edit-version increment');
            const expected = args.at(-1);
            if (expected !== working.version) return [{ affectedRows: 0 }];
            working.version++; working.authVersion++;
            if (q.includes('SET status = ?')) working.status = args[0];
            return [{ affectedRows: 1 }];
          }
          if (q.startsWith('INSERT INTO sys_user_approvals')) { working.audit.push(args); return [{ affectedRows: 1 }]; }
          throw Error('Unexpected SQL in bounded adapter: ' + q);
        },
      };
      const pool = { async getConnection() { return conn; } };
      const hub = { markUserInvalidatedSync() { events.push('invalidate'); }, async reloadUserAuthFromDb() { events.push('reload'); } };
      const lifecycle = { cancelQueriesByUser() { events.push('cancel'); } };
      const service = new serviceContext.Service(pool, hub, lifecycle);
      let actual = 'SUCCESS'; let statusCode;
      try { await service[method]('1001', method === 'updateUserStatus' ? 'DISABLED' : ['20'], 1, '9999'); }
      catch (e) { actual = e.code || e.message; statusCode = e.statusCode; }
      const expected = stale ? 'ERR_CONCURRENCY_CONFLICT' : 'SUCCESS';
      const checks = stale ? {
        error_is_409: statusCode === 409,
        state_unchanged: JSON.stringify(state) === initial,
        rollback_without_commit: events.includes('rollback') && !events.includes('commit'),
        no_post_commit_side_effects: !events.includes('invalidate') && !events.includes('cancel') && !events.includes('reload'),
      } : {
        version_incremented_once: state.version === 2,
        mutation_applied: method === 'updateUserStatus' ? state.status === 'DISABLED' : JSON.stringify(state.roles) === '["20"]',
        audit_committed: state.audit.length === 1,
        commit_without_rollback: events.includes('commit') && !events.includes('rollback'),
      };
      checks.connection_released = events.at(-1) === 'release' || events.includes('release');
      casProbes.push({ method, stale, expected, actual, checks, matches_expected: actual === expected && Object.values(checks).every(Boolean), state, events, queries });
    }
  }
  assert(protectedFiles.every(f => digest(f) === before[f]), 'Read-only input changed during probes');
  const passwordStep = section(backend, '### 5.3 ').split('\n').find(l => l.includes('password_hash') && l.includes('同一个元数据库事务'));
  const evidence = {
    review_date: '2026-11-09', scope: ['API-R1-03: timestamp refresh and method-specific L3 exemption', 'API-R1-05: updateUserStatus/updateUserRoles CAS'],
    inputs: files.map(f => ({ path: f, bytes: fs.statSync(path.join(root, f)).size, sha256: before[f] })),
    static_observations: {
      backend_password_change_step: passwordStep,
      timestamp_refresh_present: Boolean(passwordStep && passwordStep.includes('password_updated_at = NOW()')),
      policy_not_public: !guardSource.match(/const PUBLIC_PATHS = new Set\(\[([\s\S]*?)\]\);/)[1].includes('/api/v1/auth/password-policy'),
      policy_in_path_only_l3_allowlist: guardSource.match(/const MUST_CHANGE_PWD_ALLOWED_PATHS = new Set\(\[([\s\S]*?)\]\);/)[1].includes('/api/v1/auth/password-policy'),
      guard_checks_request_method: /req\.method/.test(guardSource),
      api_requires_get_l2_put_l4: section(api, '#### 6.1.7 ').includes('L2 账号状态级') && section(api, '#### 6.1.8 ').includes('L4 角色守卫'),
    },
    verification_boundary: {
      guard: 'Actual documented guard, imports/export and TS syntax removed; AppError stand-in, fixed Date.now.',
      cas: 'Actual documented UserService and withTransaction; in-memory SQL/transaction adapter, no actual DB locking or concurrent scheduling.',
      fixed_time_utc: fixedTime, real_http_mysql_integration: false, full_build_or_semantic_typecheck: false,
    },
    guard_probes: guardProbes, cas_probes: casProbes,
    summary: {
      guard_observations: guardProbes.length, guard_expectations_met: guardProbes.filter(p => p.matches_expected).length,
      cas_observations: casProbes.length, cas_expectations_met: casProbes.filter(p => p.matches_expected).length,
      recorded_review_decisions_not_automated_proofs: { 'API-R1-03': 'partially_resolved_method_specific_L3_exemption_missing', 'API-R1-05': 'resolved_at_document_level' },
      protected_inputs_and_prior_review_artifacts_unchanged_during_run: true,
    },
  };
  fs.writeFileSync(path.join(__dirname, 'api-contract-review-round4.evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ inputs: evidence.inputs, static_observations: evidence.static_observations, guard_probes: guardProbes, cas_probes: casProbes.map(({queries, ...p}) => p), summary: evidence.summary }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
