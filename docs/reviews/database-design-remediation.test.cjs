'use strict';
// Node.js 24+; no packages/network/DB required. Execute current documented code,
// not a hand-copied quota model. Writes only a new remediation evidence file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const sources = ['docs/DATABASE_DESIGN_SPEC.md', 'docs/BACKEND_ARCHITECTURE_SPEC.md',
  'docs/API_CONTRACT_SPEC.md', 'docs/FRONTEND_ARCHITECTURE_SPEC.md',
  'docs/sql/001_metadata_schema.sql', 'scripts/validate_database_design.py'];
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
const before = Object.fromEntries(sources.map(p => [p, hash(p)]));
const be = read(sources[1]), api = read(sources[2]), fe = read(sources[3]);
const observations = [];
function test(id, fn) { const actual = fn(); observations.push({id, passed: true, actual}); }
function block(heading, name) {
  const start = be.indexOf(heading); assert(start >= 0);
  const text = be.slice(start, be.indexOf('\n### ', start + 1));
  const found = [...text.matchAll(/```typescript\n([\s\S]*?)```/g)].find(m => m[1].includes(name));
  assert(found, name); return found[1];
}
class AppError extends Error { constructor(p) { super(p.message); Object.assign(this, p); } }
class FrozenDate extends Date { static now() { return 1000000; } }
function load(code, names) {
  const js = stripTypeScriptTypes(code, {mode: 'transform'})
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  return vm.runInNewContext(`${js}\n;({${names.join(',')}})`,
    {AppError, crypto, Date: FrozenDate, AbortController, setTimeout, clearTimeout}, {timeout: 2000});
}
const snapshotCode = block('### 6.2 ', 'class SnapshotBuilder');
const { SnapshotBuilder, mapUserRateLimit } = load(snapshotCode, ['SnapshotBuilder', 'mapUserRateLimit']);
const { DualBucketRateLimiter } = load(block('### 6.4 ', 'class DualBucketRateLimiter'), ['DualBucketRateLimiter']);
function snapshot(row = null, roleQpms = [60], globalQpm = 100, globalBurst = 10) {
  return SnapshotBuilder.buildSnapshot({
    requestId: 'db-r1-test', user: {id: '1', username: 'fixture', status: 'ACTIVE',
      mustChangePassword: false, authVersion: 1, roleIds: roleQpms.map((_, i) => String(i + 1))},
    pat: {id: '2', expiresAt: null, isRevoked: false},
    roles: roleQpms.map((q, i) => ({id: String(i + 1), roleName: 'ROLE_' + i,
      defaultLimit: 5, maxLimit: 10, maxTimeoutMs: 1000, userQpmLimit: q, maxInflightConcurrency: 2})),
    userRateLimit: mapUserRateLimit(row),
    globalRateLimit: {qpmLimit: globalQpm, burstCapacity: globalBurst, loopBreakerThreshold: 3, loopBreakerWindowSec: 30},
    profile: {id: '3', name: 'fixture', defaultDatabase: 'fixture', capacityQpm: 10000,
      maxPoolSize: 5, maxInflightConcurrency: 2, queueTimeoutMs: 1000, status: 'ACTIVE'},
    dbAclRows: [], tableAclRows: [], globalPolicyVersion: 1,
  });
}
function acquire(limiter, s, profileQpm = 10000) {
  limiter.acquireOrThrow({userId: s.userId, userQpmLimit: s.quotas.userQpmLimit,
    userBurstCapacity: s.quotas.userBurstCapacity, profileId: s.effectiveProfile.id, profileCapacityQpm: profileQpm});
}
test('DB-R1-01 USER=1/GLOBAL=500 reaches bucket', () => {
  const s = snapshot({qpm_limit: 30, burst_capacity: 1}, [60], 100, 500);
  assert.equal(s.quotas.userQpmLimit, 30); assert.equal(s.quotas.userBurstCapacity, 1);
  const limiter = new DualBucketRateLimiter(); acquire(limiter, s);
  assert.throws(() => acquire(limiter, s), e => e.code === 'ERR_RATE_LIMIT_USER');
  return s.quotas;
});
test('DB-R1-01 USER=20/GLOBAL=10 is not min-capped', () => {
  const s = snapshot({qpm_limit: 30, burst_capacity: 20});
  const limiter = new DualBucketRateLimiter();
  for (let i = 0; i < 20; i++) acquire(limiter, s);
  assert.throws(() => acquire(limiter, s), e => e.code === 'ERR_RATE_LIMIT_USER');
  assert.equal(s.quotas.userBurstCapacity, 20); return s.quotas;
});
test('DB-R1-01 update reloads both values and clamps existing bucket', () => {
  const limiter = new DualBucketRateLimiter();
  const old = snapshot({qpm_limit: 60, burst_capacity: 20}); acquire(limiter, old);
  const fresh = snapshot({qpm_limit: 30, burst_capacity: 1}); acquire(limiter, fresh);
  assert.equal(fresh.quotas.userQpmLimit, 30);
  assert.throws(() => acquire(limiter, fresh), e => e.code === 'ERR_RATE_LIMIT_USER');
  return {before: old.quotas, after: fresh.quotas};
});
test('DB-R1-01 deletion reloads role QPM and GLOBAL burst', () => {
  const before = snapshot({qpm_limit: 30, burst_capacity: 1}, [60], 100, 500);
  const after = snapshot(null, [60], 100, 500);
  assert.equal(mapUserRateLimit(null), null);
  assert.equal(after.quotas.userQpmLimit, 60); assert.equal(after.quotas.userBurstCapacity, 500);
  return {before: before.quotas, after: after.quotas};
});
test('DB-R1-02 GLOBAL QPM change does not replace role quota', () => {
  const a = snapshot(null, [60], 100, 10), b = snapshot(null, [60], 20, 20);
  assert.equal(a.quotas.userQpmLimit, 60); assert.equal(b.quotas.userQpmLimit, 60);
  assert.equal(a.quotas.userBurstCapacity, 10); assert.equal(b.quotas.userBurstCapacity, 20);
  return {before: a.quotas, after: b.quotas};
});
test('DB-R1-02 multi-role maximum without inflating smaller quotas', () => {
  const a = snapshot(null, [5, 30], 100); assert.equal(a.quotas.userQpmLimit, 30);
  assert.equal(a.quotas.defaultLimit, 5); assert.equal(a.quotas.maxLimit, 10); return a.quotas;
});
test('DB-R1-02 unlimited role and USER override priority', () => {
  assert.equal(snapshot(null, [30, -1]).quotas.userQpmLimit, -1);
  assert.equal(snapshot({qpm_limit: 5, burst_capacity: 1}, [30, -1]).quotas.userQpmLimit, 5);
  assert.equal(snapshot({qpm_limit: -1, burst_capacity: 1}, [30]).quotas.userQpmLimit, -1);
  return 'unlimited role wins among roles; USER still has higher priority';
});
test('Profile protection remains for unlimited USER QPM', () => {
  const s = snapshot({qpm_limit: -1, burst_capacity: 1});
  const limiter = new DualBucketRateLimiter(); acquire(limiter, s, 1);
  assert.throws(() => acquire(limiter, s, 1), e => e.code === 'ERR_RATE_LIMIT_PROFILE');
  return 'second same-instant request blocked by Profile bucket';
});
test('Empty roles remain default deny', () => {
  assert.throws(() => snapshot(null, []), e => e.code === 'ERR_RBAC_FORBIDDEN'); return '403';
});
test('Compatibility fallback is GLOBAL only without usable role QPM', () => {
  assert.equal(snapshot(null, [undefined], 20).quotas.userQpmLimit, 20);
  return 'synthetic legacy fixture; valid current database roles always have QPM';
});
test('USER burst does not override GLOBAL breaker settings', () => {
  const q = snapshot({qpm_limit: 30, burst_capacity: 1}).quotas;
  assert.equal(q.loopBreakerThreshold, 3); assert.equal(q.loopBreakerWindowSec, 30); return q;
});
test('Explicit revised API and frontend inheritance contracts', () => {
  assert(!api.includes('后续全局限流变更将对该用户自动联动生效'));
  assert(!api.includes('继承全局默认')); assert(!api.includes('继承全局基准'));
  for (const text of [api, fe]) {
    assert(text.includes('无用户覆盖，按角色/全局策略计算'));
    assert(text.includes('user_quota_qpm'));
  }
  assert(api.includes('`USER > ROLE > GLOBAL`')); assert(api.includes('`USER > GLOBAL`'));
  assert(api.includes('GLOBAL QPM 变更不会覆盖已有的角色配额'));
  assert(fe.includes('不能从 USER 配置接口的 null 或全局默认推算'));
  return 'configuration DTO remains nullable; dashboard displays effective quota';
});
test('Original static checks plus critical route semantics', () => {
  const p = spawnSync('python', ['scripts/validate_database_design.py'], {cwd: root, encoding: 'utf8'});
  assert.equal(p.status, 0, p.stderr || p.stdout); return p.stdout.trim();
});
test('Generation fragments match all three changed specifications', () => {
  const result = [];
  for (const [doc, generator, dir] of [
    ['BACKEND_ARCHITECTURE_SPEC.md', 'combine_be_spec.js', 'be_parts'],
    ['API_CONTRACT_SPEC.md', 'combine_contract.js', 'contract_parts'],
    ['FRONTEND_ARCHITECTURE_SPEC.md', 'combine_fe_spec.js', 'fe_parts']]) {
    const parts = [...read('scripts/' + generator).matchAll(/["'](part[^"']+\.md)["']/g)].map(m => m[1]);
    const built = parts.map(p => read(`scripts/${dir}/${p}`).trim()).join('\n\n---\n\n');
    assert.equal(built, read('docs/' + doc)); result.push({doc, matches: true});
  }
  return result;
});
// Optional strict semantic check using an already installed TypeScript package.
// Run with --typecheck and configure NODE_PATH if dependencies are outside this repo.
if (process.argv.includes('--typecheck')) test('Snapshot block strict TypeScript semantic check', () => {
  const ts = require('typescript');
  const code = snapshotCode.replace("import { AppError } from './app-error';",
    'class AppError extends Error { constructor(p: {code:string;statusCode:number;message:string;[key:string]:unknown}) {super(p.message);} }');
  const virtual = path.join(path.dirname(path.dirname(require.resolve('typescript/package.json'))), 'db-r1-snapshot-check.ts');
  const options = {strict: true, noEmit: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, skipLibCheck: true, types: ['node'],
    typeRoots: [path.dirname(path.dirname(require.resolve('@types/node/package.json')))]};
  const host = ts.createCompilerHost(options), getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, v, ...rest) => path.normalize(f) === path.normalize(virtual)
    ? ts.createSourceFile(f, code, v, true) : getSourceFile(f, v, ...rest);
  const program = ts.createProgram([virtual], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(d => ({code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n')}));
  assert.deepEqual(diagnostics, []);
  return {typescript: ts.version, diagnostics, adaptation: 'Only AppError import replaced with typed stub; not a whole-project build'};
});
for (const p of sources) assert.equal(hash(p), before[p], `Test changed source: ${p}`);
const evidence = {date: '2026-11-12', timezone: 'Asia/Shanghai', runtime: process.version,
  scope: 'Document code, mapping fixture and token bucket; not actual Repository or HTTP handlers',
  boundaries: {realMySQL: false, realRepository: false, realHTTP: false, automaticCacheInvalidation: false,
    sourceCode: 'complete current TypeScript blocks with native type erasure', clock: 'frozen to test burst deterministically'},
  sources: before, sourceHashesUnchanged: true, observations,
  summary: {total: observations.length, passed: observations.length}};
const output = path.join(__dirname, 'database-design-remediation.evidence.json');
fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence.summary)); console.log(output);
