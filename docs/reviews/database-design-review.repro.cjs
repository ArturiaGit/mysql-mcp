'use strict';
// Read-only document review probes. No HTTP, database, Docker, or application service.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const sources = [
  'docs/ARCHITECTURE_SPEC.md', 'docs/BACKEND_ARCHITECTURE_SPEC.md',
  'docs/FRONTEND_ARCHITECTURE_SPEC.md', 'docs/API_CONTRACT_SPEC.md',
  'docs/DATABASE_DESIGN_SPEC.md', 'docs/sql/001_metadata_schema.sql',
  'scripts/validate_database_design.py',
];
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
const before = Object.fromEntries(sources.map(p => [p, hash(p)]));
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const db = read('docs/DATABASE_DESIGN_SPEC.md');
const be = read('docs/BACKEND_ARCHITECTURE_SPEC.md');
const api = read('docs/API_CONTRACT_SPEC.md');
const ddl = read('docs/sql/001_metadata_schema.sql');
function extract(text, start, end) {
  const a = text.indexOf(start);
  assert(a >= 0, `Missing start marker: ${start}`);
  const b = text.indexOf(end, a + start.length);
  assert(b >= 0, `Missing end marker: ${end}`);
  return text.slice(a, b);
}
function line(text, fragment) {
  const at = text.indexOf(fragment);
  assert(at >= 0, `Missing evidence: ${fragment}`);
  return text.slice(0, at).split('\n').length;
}
function matrixRow(route) {
  const row = db.split('\n').find(l => l.startsWith('| `' + route + '` |'));
  assert(row, `Missing route: ${route}`);
  const cells = row.split('|').map(x => x.trim());
  return { route, tables: cells[2], behavior: cells[3], line: line(db, row) };
}
// Execute the original backend quota expressions; erase two TypeScript type annotations only.
const qpmOriginal = extract(be, '    const roleQpms = roles', '    const normProfileId =');
const quotaOriginal = extract(be, "    const quotas: RequestContextSnapshot['quotas'] = {", '    return {\n      requestId: params.requestId');
const qpmJs = qpmOriginal.replace('.filter((q): q is number =>', '.filter((q) =>');
const quotaJs = quotaOriginal.replace("const quotas: RequestContextSnapshot['quotas'] =", 'const quotas =');
assert.notEqual(qpmJs, qpmOriginal);
assert.notEqual(quotaJs, quotaOriginal);
function evaluateQuota(roleQpm, userSpecificQpmLimit, globalQpm, globalBurst) {
  const context = {
    roles: [{userQpmLimit: roleQpm}],
    params: { userSpecificQpmLimit, globalRateLimit: {
      qpmLimit: globalQpm, burstCapacity: globalBurst,
      loopBreakerThreshold: 3, loopBreakerWindowSec: 30,
    }},
    defaultLimit: 50, maxLimit: 500, maxTimeoutMs: 15000, maxInflightConcurrency: 5,
  };
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(() => {\n${qpmJs}\n${quotaJs}\nreturn quotas;\n})()`, context, {timeout: 1000})));
}
const signature = extract(be, '    userSpecificQpmLimit: number | null;', '  }): RequestContextSnapshot {');
assert(!signature.includes('burstCapacity') && !signature.includes('userSpecificBurst'));
const userRule = { qpm_limit: 30, burst_capacity: 1, revision: 1, version: 1 };
const burst = evaluateQuota(60, userRule.qpm_limit, 60, 500);
assert.equal(burst.userQpmLimit, 30);
assert.equal(burst.userBurstCapacity, 500);
assert.notEqual(burst.userBurstCapacity, userRule.burst_capacity);
assert(api.includes('专属突发容量'));
assert(ddl.includes('`burst_capacity` INT NOT NULL DEFAULT 10'));
const inheritedBefore = evaluateQuota(60, null, 100, 10);
const inheritedAfter = evaluateQuota(60, null, 20, 10);
assert.equal(inheritedBefore.userQpmLimit, 60);
assert.equal(inheritedAfter.userQpmLimit, 60);
assert(api.includes('后续全局限流变更将对该用户自动联动生效'));
assert(db.includes('USER 覆盖 > 实际角色合并配额 > GLOBAL 兜底'));
const csrf = matrixRow('GET /api/v1/auth/csrf');
assert(csrf.behavior.includes('注销会话'));
assert(api.includes('返回 { csrfToken: "a8f3c..." } (无副作用)'));
const userLimits = ['GET', 'PUT', 'DELETE'].map(m => matrixRow(`${m} /api/v1/rate-limits/users/:id`));
for (const r of userLimits) {
  assert(!r.tables.includes('rate_limits'));
  assert(!r.tables.includes('rate_limit_revisions'));
  assert(r.behavior.includes('用户CAS'));
}
const baseline = spawnSync('python', [path.join(root, 'scripts/validate_database_design.py')], {cwd: root, encoding: 'utf8'});
assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);
const controls = {
  userQpmOverride: evaluateQuota(60, 30, 100, 10).userQpmLimit,
  unlimitedRole: evaluateQuota(-1, null, 100, 10).userQpmLimit,
  staticValidatorPassed: baseline.status === 0,
};
assert.equal(controls.userQpmOverride, 30);
assert.equal(controls.unlimitedRole, -1);
for (const p of sources) assert.equal(hash(p), before[p], `Source changed during review: ${p}`);
const evidence = {
  reviewDate: '2026-11-11', timezone: 'Asia/Shanghai',
  scope: 'Current source documents and DDL, not a running application',
  sources: sources.map(p => ({path: p, bytes: fs.statSync(path.join(root,p)).size, sha256: before[p]})),
  method: {
    runtime: process.version,
    execution: 'Two original backend quota snippets evaluated in a VM after erasing two TS annotations; route rows inspected as text.',
    extractedLines: {qpm: line(be, qpmOriginal), quotas: line(be, quotaOriginal)},
    baselineValidator: baseline.stdout.trim(),
    notRun: ['MySQL DDL execution', 'actual Repository mapping', 'HTTP or browser integration', 'InnoDB concurrency', 'migration/restore', 'load testing'],
  },
  findings: [
    {id:'DB-R1-01', priority:'P1', kind:'cross-document integration gap', storedUserRule:userRule,
      globalBurstCapacity:500, expectedUserBurstCapacity:1, observedSnapshot:burst,
      note:'The documented builder accepts user QPM but not user burst capacity. This is a documented execution-path counterexample, not a production observation.'},
    {id:'DB-R1-02', priority:'P2', kind:'unresolved external contract semantics', roleQpm:60,
      userOverride:null, globalQpmBefore:100, globalQpmAfter:20,
      effectiveBefore:inheritedBefore.userQpmLimit, effectiveAfter:inheritedAfter.userQpmLimit,
      note:'The database design agrees with backend USER > ROLE > GLOBAL, but API promises subsequent global changes apply after override removal.'},
    {id:'DB-R1-03', priority:'P2', kind:'incorrect route semantics', observed:csrf,
      expected:'Issue/reuse CSRF seed/token without logging out or invalidating the authenticated context.'},
    {id:'DB-R1-04', priority:'P2', kind:'incorrect table and concurrency mapping', observed:userLimits,
      expected:'Read USER rule; mutate rule and persistent counter using revision; delete only rule, retaining counter. Do not use sys_users.version as the limit CAS.'},
  ],
  positiveControls: controls,
  sourceHashesUnchanged:true,
};
const out = path.join(__dirname, 'database-design-review.evidence.json');
fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({findings:evidence.findings, controls, output:out, sourceHashesUnchanged:true}, null, 2));

