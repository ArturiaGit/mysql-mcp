import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareDependencies, resolveNpmCli } from '../../scripts/governance/lib/dependencies.mjs';
import { fixture as collaborationFixture } from './collaboration-fixture.mjs';

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-dependencies-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'mysql-mcp');
  fs.mkdirSync(app);
  const pkg = { name: 'synthetic-scaffold', version: '1.0.0', private: true };
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': { name: pkg.name, version: pkg.version } } };
  const write = (name, content) => fs.writeFileSync(path.join(app, name), typeof content === 'string' ? content : JSON.stringify(content) + '\n');
  write('package.json', pkg);
  write('package-lock.json', lock);
  return { root, app, pkg, lock, write };
}
const ok = { status: 0, signal: null, stdout: '', stderr: '' };
const cli = () => '/synthetic/npm-cli.js';

test('dependency preparation skips governance-only repositories without invoking npm', () => {
  const result = prepareDependencies(path.join(os.tmpdir(), 'missing-synthetic-application'), { npmCli: () => assert.fail('npm should not resolve'), runner: () => assert.fail('npm should not run') });
  assert.equal(result.status, 'not_applicable');
});

for (const missing of ['package.json', 'package-lock.json']) test(`dependency preparation rejects missing ${missing}`, t => {
  const f = project(t);
  fs.unlinkSync(path.join(f.app, missing));
  assert.throws(() => prepareDependencies(f.root, { npmCli: cli, runner: () => assert.fail('invalid inputs must not run npm') }), /requires regular package/);
});

test('dependency preparation rejects a directory masquerading as a lockfile', t => {
  const f = project(t);
  fs.unlinkSync(path.join(f.app, 'package-lock.json'));
  fs.mkdirSync(path.join(f.app, 'package-lock.json'));
  assert.throws(() => prepareDependencies(f.root, { npmCli: cli }), /requires regular package/);
});

test('dependency preparation is local, shell-free, dev-inclusive and strips snapshot context', t => {
  const f = project(t);
  const previous = process.env.GOV_DEPENDENCY_SENTINEL;
  process.env.GOV_DEPENDENCY_SENTINEL = 'parent';
  try {
    const report = prepareDependencies(f.root, { npmCli: cli, runner: (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.equal(args[0], cli());
      assert.ok(args.includes('ci'));
      for (const flag of ['--ignore-scripts', '--include=dev', '--global=false', '--workspaces=false']) assert.ok(args.includes(flag));
      assert.equal(options.cwd, f.app);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 180000);
      assert.equal(options.env.GOV_DEPENDENCY_SENTINEL, undefined);
      for (const key of Object.keys(options.env)) assert.ok(!/^(GIT_|GOV_|GITHUB_|NODE_TEST_)/.test(key) && key !== 'NODE_OPTIONS');
      return ok;
    } });
    assert.equal(report.status, 'passed');
    assert.equal(report.exit_code, 0);
    assert.match(report.lockfile_sha256, /^[a-f0-9]{64}$/);
  } finally {
    if (previous === undefined) delete process.env.GOV_DEPENDENCY_SENTINEL;
    else process.env.GOV_DEPENDENCY_SENTINEL = previous;
  }
});

for (const [name, result] of [
  ['nonzero exit', { ...ok, status: 1, stderr: 'synthetic lock mismatch' }],
  ['timeout', { ...ok, status: null, signal: 'SIGKILL', error: { code: 'ETIMEDOUT', message: 'synthetic timeout' } }],
  ['signal', { ...ok, status: null, signal: 'SIGTERM' }],
  ['spawn failure', { ...ok, status: null, error: { code: 'ENOENT', message: 'synthetic missing npm' } }]
]) test(`dependency preparation rejects ${name} with failed execution metadata`, t => {
  const f = project(t);
  assert.throws(() => prepareDependencies(f.root, { npmCli: cli, runner: () => result }), error => {
    assert.match(error.message, /npm ci failed/);
    assert.equal(error.dependencies.status, 'failed');
    assert.equal(error.dependencies.exit_code, result.status);
    assert.equal(error.dependencies.timed_out, name === 'timeout');
    return true;
  });
});

for (const name of ['package.json', 'package-lock.json']) test(`dependency preparation rejects mutations of ${name}`, t => {
  const f = project(t);
  assert.throws(() => prepareDependencies(f.root, { npmCli: cli, runner: () => { f.write(name, '{}'); return ok; } }), /mutated application package or lockfile/);
});

test('real offline npm ci in an isolated application disables lifecycle scripts and leaves inputs unchanged', t => {
  const f = project(t);
  f.pkg.scripts = { postinstall: 'node -e "require(\'node:fs\').writeFileSync(\'unexpected-lifecycle\',\'unsafe\')"' };
  f.write('package.json', f.pkg);
  const before = ['package.json', 'package-lock.json'].map(name => fs.readFileSync(path.join(f.app, name), 'utf8'));
  const result = prepareDependencies(f.root, { runner: (command, args, options) => spawnSync(command, [...args, '--offline'], options) });
  assert.equal(result.status, 'passed');
  assert.ok(fs.statSync(resolveNpmCli()).isFile());
  assert.equal(fs.existsSync(path.join(f.app, 'unexpected-lifecycle')), false);
  assert.deepEqual(['package.json', 'package-lock.json'].map(name => fs.readFileSync(path.join(f.app, name), 'utf8')), before);
});

function applicationFixture(t) {
  const f = collaborationFixture(t);
  f.task.allowed_paths.push('.gitignore');
  // The offline dependency fixture owns this synthetic backend-only vendor directory.
  f.policy.roles['pi-desktop'].push('mysql-mcp/vendor/');
  f.task.build_checks = ['build', 'compile'].map(kind => ({
    id: `app-${kind}`, kind, command: 'node', args: [`mysql-mcp/scripts/${kind}.mjs`], timeout_ms: 10000
  }));
  f.write('.gitignore', '.governance-evidence/\nnode_modules/\ndist/\n');
  f.save();
  f.planning();
  f.start('pi-desktop', 'implementation');
  const pkg = { name: 'synthetic-scaffold', version: '1.0.0', type: 'module', private: true, devDependencies: { 'synthetic-tool': 'file:vendor/tool' } };
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: {
    '': { name: pkg.name, version: pkg.version, devDependencies: pkg.devDependencies },
    'node_modules/synthetic-tool': { resolved: 'vendor/tool', link: true },
    'vendor/tool': { name: 'synthetic-tool', version: '1.0.0' }
  } };
  f.write('mysql-mcp/package.json', JSON.stringify(pkg) + '\n');
  f.write('mysql-mcp/package-lock.json', JSON.stringify(lock) + '\n');
  f.write('mysql-mcp/vendor/tool/package.json', JSON.stringify({ name: 'synthetic-tool', version: '1.0.0', type: 'module' }) + '\n');
  f.write('mysql-mcp/vendor/tool/index.js', 'export const marker = "installed-from-snapshot";\n');
  f.write('mysql-mcp/node_modules/synthetic-tool/package.json', '{"type":"module"}\n');
  f.write('mysql-mcp/node_modules/synthetic-tool/index.js', 'export const marker = "stale-worktree-dependency";\n');
  const check = "import assert from 'node:assert/strict'; import { marker } from '../node_modules/synthetic-tool/index.js'; assert.equal(marker, 'installed-from-snapshot'); console.log(marker);\n";
  f.write('mysql-mcp/scripts/build.mjs', check + "import fs from 'node:fs'; fs.mkdirSync('mysql-mcp/dist',{recursive:true}); fs.writeFileSync('mysql-mcp/dist/index.js','export const value = 1;\\n');\n");
  f.write('mysql-mcp/scripts/compile.mjs', check);
  return { ...f, pkg };
}

test('full snapshot run installs offline dev dependencies rather than copying stale worktree modules', t => {
  const f = applicationFixture(t);
  const before = inputApplication(f.root);
  const result = f.cli('run', [], undefined, { npm_config_offline: 'true', NODE_ENV: 'production' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(f.root, '.governance-evidence/run.json'), 'utf8'));
  assert.equal(report.local_result, 'passed');
  assert.equal(report.dependencies.status, 'passed');
  assert.equal(report.builds.checks.length, 2);
  for (const build of report.builds.checks) {
    assert.equal(build.exit_code, 0);
    assert.match(build.stdout, /installed-from-snapshot/);
  }
  assert.deepEqual(inputApplication(f.root), before);
  assert.equal(fs.existsSync(path.join(f.root, 'mysql-mcp/dist')), false);
  assert.match(fs.readFileSync(path.join(f.root, 'mysql-mcp/node_modules/synthetic-tool/index.js'), 'utf8'), /stale-worktree/);
});

test('full snapshot run rejects mismatched lockfiles before executing tests or builds', t => {
  const f = applicationFixture(t);
  f.pkg.devDependencies['synthetic-tool'] = 'file:vendor/missing-tool';
  f.write('mysql-mcp/package.json', JSON.stringify(f.pkg) + '\n');
  const result = f.cli('run', [], undefined, { npm_config_offline: 'true' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /dependency preparation: npm ci failed/);
  const report = JSON.parse(fs.readFileSync(path.join(f.root, '.governance-evidence/run.json'), 'utf8'));
  assert.equal(report.local_result, 'failed');
  assert.equal(report.dependencies.status, 'failed');
  assert.deepEqual(report.checks, []);
  assert.equal(report.builds, undefined);
});

function inputApplication(root) {
  return ['package.json', 'package-lock.json'].map(name => fs.readFileSync(path.join(root, 'mysql-mcp', name), 'utf8'));
}
