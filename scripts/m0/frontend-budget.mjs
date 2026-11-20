import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const app = new URL('../../apps/admin-ui/', import.meta.url);
const json = (file) => JSON.parse(readFileSync(new URL(file, app), 'utf8'));
const strict = process.argv.includes('--require-frontend');
const { scripts = {} } = json('package.json');
const scaffold = readdirSync(app).every((file) => ['package.json', 'node_modules'].includes(file));
if (!scripts.build && scaffold && !strict) {
  console.log('SKIP: admin-ui is the M0 Step 1 package-only scaffold; no bundle or browser E2E to validate.');
} else {
  assert(scripts.build, 'admin-ui must define a build script');
  const pnpmCli = process.env.npm_execpath;
  assert(pnpmCli, 'Run this check via pnpm ci:frontend');
  function run(script) {
    const result = spawnSync(process.execPath, [pnpmCli, 'run', script], { cwd: fileURLToPath(app), stdio: 'inherit' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${script} failed`);
  }
  run('build');
  const manifest = json('dist/.vite/manifest.json');
  const entries = Object.values(manifest);
  const gzipBytes = (files) => [...new Set(files)].reduce((sum, file) => {
    const base = new URL('dist/', app);
    const resolved = new URL(file, base);
    assert(resolved.href.startsWith(base.href) && existsSync(resolved), 'Manifest references an invalid build path');
    return sum + gzipSync(readFileSync(resolved)).length;
  }, 0);
  function check(label, size, budget) {
    console.log(`${label}: ${size} gzip bytes (max ${budget})`);
    assert(size <= budget, `${label} exceeds budget`);
  }
  for (const [name, limit] of [['vendors', 140_000], ['admin-ui-core', 40_000]]) {
    const chunks = entries.filter((entry) => entry.name === name || entry.file.split('/').at(-1).startsWith(`${name}-`));
    assert(chunks.length > 0, `Vite manifest must contain ${name}`);
    check(name, gzipBytes(chunks.flatMap(({ file, css = [] }) => [file, ...css])), limit);
  }
  for (const { file, css = [] } of entries.filter(({ isDynamicEntry }) => isDynamicEntry)) {
    check(file, gzipBytes([file, ...css]), 60_000);
  }
  assert(scripts['test:e2e'], 'admin-ui must define test:e2e');
  run('test:e2e');
}
