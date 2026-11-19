import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The official image imports the mounted SQL on an empty data volume. Never delete/reset a volume here.
const result = spawnSync('docker', ['compose', 'up', '-d', '--wait', '--wait-timeout', '120', 'mysql'], {
  cwd: fileURLToPath(new URL('../../', import.meta.url)),
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
