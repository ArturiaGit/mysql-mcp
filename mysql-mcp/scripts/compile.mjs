import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = path.join(root, 'node_modules/typescript/bin/tsc');

try {
  await access(compiler);
  const result = spawnSync(process.execPath, [
    compiler, '--project', path.join(root, 'tsconfig.json'),
    '--noEmit', '--incremental', 'false', '--pretty', 'false'
  ], {
    cwd: root,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 55000
  });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.signal) {
    throw new Error(result.error?.message ?? `compiler terminated by ${result.signal}`);
  }
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`Type check failed. Install locked dependencies with npm ci in mysql-mcp/. ${error.message}`);
  process.exitCode = 1;
}
