import { spawnSync } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const compiler = path.join(root, 'node_modules/typescript/bin/tsc');

try {
  // Clear stale output even if the compiler is unavailable or compilation fails.
  await rm(output, { recursive: true, force: true });
  await access(compiler);
  const result = spawnSync(process.execPath, [
    compiler, '--project', path.join(root, 'tsconfig.json'),
    '--outDir', output, '--noEmit', 'false', '--noEmitOnError',
    '--incremental', 'false', '--pretty', 'false'
  ], {
    cwd: root,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 55000
  });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(result.error?.message ?? `compiler failed (${result.signal ?? result.status})`);
  }

  // Run deterministic application checks; Windows adds synthetic native CRUD.
  const smoke = spawnSync(process.execPath, [
    '--test', '--test-reporter=tap',
    path.join(root, 'tests/smoke.test.mjs'),
    path.join(root, 'tests/sql-policy.test.mjs'),
    path.join(root, 'tests/keyring.test.mjs'),
    path.join(root, 'tests/mcp.test.mjs')
  ], { cwd: root, shell: false, stdio: 'inherit', timeout: 20000 });
  if (smoke.error || smoke.signal || smoke.status !== 0) {
    throw new Error(smoke.error?.message ?? `application tests failed (${smoke.signal ?? smoke.status})`);
  }
} catch (error) {
  await rm(output, { recursive: true, force: true });
  console.error(`Build failed. Install locked dependencies with npm ci in mysql-mcp/. ${error.message}`);
  process.exitCode = 1;
}
