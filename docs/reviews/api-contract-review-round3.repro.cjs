'use strict';
// Bounded round-3 re-review: API-R1-02/03/04/05/12 only.
// Executes only the documented guard in isolation; not a server or DB integration test.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, '');
function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => l.startsWith(heading));
  if (start < 0) throw new Error('Missing reviewed section: ' + heading);
  const level = lines[start].match(/^#+/)[0].length;
  let end = start + 1;
  while (end < lines.length) {
    const m = lines[end].match(/^(#+) /);
    if (m && m[1].length <= level) break;
    end++;
  }
  return lines.slice(start, end).join('\n');
}
function table(text, name) {
  const m = text.match(new RegExp('CREATE TABLE `' + name + '` \\([\\s\\S]+?\\) ENGINE='));
  if (!m) throw new Error('Missing table: ' + name);
  return m[0];
}
async function main() {
  const contract = read('docs/API_CONTRACT_SPEC.md');
  const backend = read('docs/BACKEND_ARCHITECTURE_SPEC.md');
  const previous = read('docs/reviews/API_CONTRACT_REVIEW_ROUND2.md');
  const ids = ['API-R1-02', 'API-R1-03', 'API-R1-04', 'API-R1-05', 'API-R1-12'];
  if (!ids.every(id => previous.includes(id))) throw new Error('Scope mismatch');
  const tls = contract.match(/export interface TlsConfig \{[\s\S]+?\n  \}/)[0];
  const lifecycle = section(contract, '### 4.4 ');
  const migration = lifecycle.match(/```sql\n([\s\S]+?)```/)[1];
  const pwdChange = section(backend, '### 5.3 ');
  const guardSection = section(backend, '### 5.5 ');
  const guardBlock = guardSection.match(/```typescript\n([\s\S]+?)```/)[1];
  const guardSource = guardBlock.replace(/^import .*;\s*$/gm, '')
    .replace('export async function fourTierSecurityGuard', 'async function fourTierSecurityGuard');
  const js = stripTypeScriptTypes(guardSource, { mode: 'strip' });
  class AppError extends Error {
    constructor(fields) { super(fields.message); Object.assign(this, fields); }
  }
  const fixedNow = Date.parse('2026-11-09T00:00:00.000Z');
  class FixedDate extends Date { static now() { return fixedNow; } }
  const context = vm.createContext({ AppError, Date: FixedDate });
  vm.runInContext(js + '\nglobalThis.reviewedGuard = fourTierSecurityGuard;', context);
  const probes = [];
  // Original expiry/allowlist issue: positive cases plus minimal L1/L2 negative controls.
  for (const [name, route, expected, account] of [
    ['expired_business_is_blocked_control', '/api/v1/pats', 'ERR_MUST_CHANGE_PASSWORD'],
    ['expired_change_password_is_allowed_control', '/api/v1/auth/change-password', 'ALLOW'],
    ['expired_password_policy_is_allowed', '/api/v1/auth/password-policy', 'ALLOW'],
    ['password_policy_still_requires_session_control', '/api/v1/auth/password-policy', 'ERR_AUTH_UNAUTHORIZED', 'anonymous'],
    ['password_policy_still_requires_active_control', '/api/v1/auth/password-policy', 'ERR_AUTH_ACCOUNT_PENDING', 'pending'],
  ]) {
    const req = {
      routeOptions: { url: route, config: {} }, url: route,
      method: route.endsWith('/change-password') ? 'POST' : 'GET',
      currentUser: {
        id: '1001', status: 'ACTIVE', roles: ['DEVELOPER'],
        must_change_password: false, password_expires_days: 90,
        password_updated_at: '2026-01-01T00:00:00.000Z',
      },
    };
    if (account === 'anonymous') delete req.currentUser;
    if (account === 'pending') req.currentUser.status = 'PENDING';
    let actual = 'ALLOW';
    try { await context.reviewedGuard(req, {}); }
    catch (error) { actual = error.code || error.message; }
    probes.push({ name, route, expected, actual, matches_expected: expected === actual });
  }
  const userServiceBlock = (backend.match(/export class UserService \{[\s\S]+?\n```/) || [])[0];
  if (!userServiceBlock) throw new Error('Missing original reviewed UserService');
  const combine = read('scripts/combine_contract.js');
  const parts = [...combine.matchAll(/'(part[^']+\.md)'/g)].map(m => m[1]);
  const generated = parts.map(p => read('scripts/contract_parts/' + p).trim()).join('\n\n---\n\n');
  const files = ['docs/API_CONTRACT_SPEC.md', 'docs/BACKEND_ARCHITECTURE_SPEC.md', 'docs/reviews/API_CONTRACT_REVIEW_ROUND2.md'];
  const result = {
    review_date: '2026-11-09', scope: ids,
    verification_kind: 'static_review_and_five_isolated_documented_guard_probes',
    integration_tests_executed: false,
    inputs: files.map(rel => {
      const data = fs.readFileSync(path.join(root, rel));
      return { path: rel, bytes: data.length, lines: data.toString('utf8').split(/\r?\n/).filter((_, i, a) => i < a.length - 1 || a[i] !== '').length,
        sha256: crypto.createHash('sha256').update(data).digest('hex').toUpperCase() };
    }),
    observations: {
      contract_matches_generated_parts: generated === contract,
      tls_definition: tls,
      migration_sql: migration.trim(),
      backend_password_change_mentions_password_updated_at: pwdChange.includes('password_updated_at'),
      password_policy_in_public_paths: /PUBLIC_PATHS = new Set\(\[[\s\S]*?'\/api\/v1\/auth\/password-policy'[\s\S]*?\]\);/.test(guardBlock),
      backend_user_table_has_edit_version: /\n\s*`version`\s+INT/.test(table(backend, 'sys_users')),
      user_service_accepts_expected_version: /expectedVersion|submittedVersion/.test(userServiceBlock),
      user_service_has_version_where_predicate: /WHERE\s+id\s*=\s*\?\s+AND\s+version\s*=\s*\?/i.test(userServiceBlock),
      user_service_increments_edit_version: /\bversion\s*=\s*version\s*\+\s*1/.test(userServiceBlock),
      approval_accept_statement: section(contract, '#### 6.2.2 ').match(/UPDATE sys_user_approvals[\s\S]+?;/)[0],
      approval_reject_statement: section(contract, '#### 6.2.3 ').match(/UPDATE sys_user_approvals[\s\S]+?;/)[0],
      role_update_rules: section(contract, '#### 6.6.3 ').split('\n').slice(4, 8),
    },
    guard_probe_constraints: {
      fixed_time_utc: '2026-11-09T00:00:00.000Z',
      source: 'backend §5.5 guards.ts code block',
      modifications: 'remove imports/export, erase TS-only syntax, supply AppError stand-in and fixed Date.now; guard logic unchanged',
      actual_http_or_database_used: false,
    },
    guard_probes: probes,
    recorded_review_decisions_not_automated_proofs: {
      'API-R1-02': 'substantive_rules_resolved',
      'API-R1-03': 'partially_resolved',
      'API-R1-04': 'substantive_storage_condition_resolved',
      'API-R1-05': 'partially_resolved',
      'API-R1-12': 'resolved_at_document_level',
    },
    summary: { scoped_items: 5, substantively_resolved: 3, partially_resolved: 2,
      remaining_p1: ['API-R1-03'], remaining_p2: ['API-R1-05'],
      guard_observations: 5, guard_expectations_met: probes.filter(p => p.matches_expected).length },
  };
  const output = path.join(__dirname, 'api-contract-review-round3.evidence.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
