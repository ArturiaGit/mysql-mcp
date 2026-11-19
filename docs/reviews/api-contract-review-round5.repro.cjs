'use strict';
// Scope: only the final API-R1-03 residual, password-policy GET vs PUT L3 exemption.
// Runs the current documented guard in isolation. No HTTP/DB/handler execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, '');
const hash = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex').toUpperCase();
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
async function main() {
  const files = ['docs/API_CONTRACT_SPEC.md', 'docs/BACKEND_ARCHITECTURE_SPEC.md', 'docs/reviews/API_CONTRACT_REVIEW_ROUND4.md'];
  const ownFiles = new Set(['api-contract-review-round5.repro.cjs', 'api-contract-review-round5.evidence.json', 'API_CONTRACT_REVIEW_ROUND5.md']);
  const prior = fs.readdirSync(__dirname).filter(n => !ownFiles.has(n) && fs.statSync(path.join(__dirname, n)).isFile()).map(n => 'docs/reviews/' + n);
  const protectedFiles = [...new Set([...files, ...prior])];
  const before = Object.fromEntries(protectedFiles.map(f => [f, hash(f)]));
  const api = read(files[0]);
  const backend = read(files[1]);
  const guardSection = section(backend, '### 5.5 ');
  const match = guardSection.match(/```typescript\r?\n([\s\S]+?)```/);
  assert(match, 'Missing guard code block');
  const source = match[1];
  const sourceForExecution = source.replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
  const js = stripTypeScriptTypes(sourceForExecution, { mode: 'strip' });
  class AppError extends Error { constructor(fields) { super(fields.message); Object.assign(this, fields); } }
  const fixedTime = '2026-11-09T00:00:00.000Z';
  class FixedDate extends Date { static now() { return Date.parse(fixedTime); } }
  const context = vm.createContext({ AppError, Date: FixedDate });
  vm.runInContext(js + '\nglobalThis.guard = fourTierSecurityGuard;', context);
  const cases = [
    ['expired_policy_get', 'GET', '/api/v1/auth/password-policy', 'expired', 'ALLOW', null],
    ['expired_policy_put', 'PUT', '/api/v1/auth/password-policy', 'expired', 'ERR_MUST_CHANGE_PASSWORD', 403],
    ['forced_change_policy_get', 'GET', '/api/v1/auth/password-policy', 'forced', 'ALLOW', null],
    ['forced_change_policy_put', 'PUT', '/api/v1/auth/password-policy', 'forced', 'ERR_MUST_CHANGE_PASSWORD', 403],
    ['anonymous_policy_get', 'GET', '/api/v1/auth/password-policy', 'anonymous', 'ERR_AUTH_UNAUTHORIZED', 401],
    ['pending_policy_get', 'GET', '/api/v1/auth/password-policy', 'pending', 'ERR_AUTH_ACCOUNT_PENDING', 403],
    ['fresh_policy_put', 'PUT', '/api/v1/auth/password-policy', 'fresh', 'ALLOW', null],
    ['expired_business', 'GET', '/api/v1/pats', 'expired', 'ERR_MUST_CHANGE_PASSWORD', 403],
    ['expired_change_password', 'POST', '/api/v1/auth/change-password', 'expired', 'ALLOW', null],
  ];
  const probes = [];
  for (const [name, method, route, account, expected, expectedStatus] of cases) {
    const req = { method, url: route, routeOptions: { url: route, config: {} }, currentUser: {
      id: '1001', status: 'ACTIVE', roles: ['DEVELOPER'], must_change_password: account === 'forced',
      password_expires_days: 90,
      password_updated_at: account === 'fresh' || account === 'forced' ? '2026-11-08T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
    } };
    if (account === 'anonymous') delete req.currentUser;
    if (account === 'pending') req.currentUser.status = 'PENDING';
    if (method === 'PUT') req.body = { passwordExpiresDays: null };
    let actual = 'ALLOW'; let actualStatus = null;
    try { await context.guard(req, {}); } catch (e) { actual = e.code || e.message; actualStatus = e.statusCode ?? null; }
    probes.push({ name, method, route, account, expected, expected_status: expectedStatus, actual, actual_status: actualStatus,
      matches_expected: actual === expected && actualStatus === expectedStatus });
  }
  const publicList = source.match(/const PUBLIC_PATHS = new Set\(\[([\s\S]*?)\]\);/);
  const l3List = source.match(/const MUST_CHANGE_PWD_ALLOWED_PATHS = new Set\(\[([\s\S]*?)\]\);/);
  assert(publicList && l3List, 'Missing reviewed allowlists');
  const observations = {
    password_policy_absent_from_public_paths: !publicList[1].includes('/api/v1/auth/password-policy'),
    password_policy_absent_from_path_only_l3_allowlist: !l3List[1].includes('/api/v1/auth/password-policy'),
    method_specific_get_exemption_present: /req\.method === 'GET' && routePath === '\/api\/v1\/auth\/password-policy'/.test(source),
    api_explicitly_prohibits_put_exemption: api.split(/\r?\n/).some(l => l.includes('严禁豁免 `PUT /api/v1/auth/password-policy`')),
  };
  assert(protectedFiles.every(f => before[f] === hash(f)), 'Protected source/prior review changed during probes');
  const result = {
    review_date: '2026-11-09', scope: ['API-R1-03: password-policy GET-only L3 exemption'],
    baseline: 'Fourth-round report text; closed items not reopened and prior evidence not overwritten.',
    inputs: files.map(f => ({ path: f, bytes: fs.statSync(path.join(root, f)).size, sha256: before[f] })),
    static_observations: observations,
    verification_boundary: {
      source: 'Current backend section 5.5 documented fourTierSecurityGuard; control flow unchanged.',
      adaptations: 'Remove import/export, erase TypeScript syntax, supply AppError stand-in and fixed Date.now.',
      fixed_time_utc: fixedTime, real_http_handler_or_mysql_execution: false, full_build_or_semantic_typecheck: false,
      put_body: { passwordExpiresDays: null },
    },
    guard_probes: probes,
    summary: {
      guard_observations: probes.length, guard_expectations_met: probes.filter(p => p.matches_expected).length,
      static_checks_met: Object.values(observations).every(Boolean),
      protected_sources_and_prior_review_files_unchanged: true,
      recorded_review_decision_not_automated_proof: 'API-R1-03 resolved at document level; no remaining issue within this final residual scope.',
    },
  };
  fs.writeFileSync(path.join(__dirname, 'api-contract-review-round5.evidence.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  assert(Object.values(observations).every(Boolean) && probes.every(p => p.matches_expected), 'Scoped expectation failed; inspect evidence rather than retaining closure decision');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
