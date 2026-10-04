import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hash } from './core.mjs';

// Invoke npm through Node rather than npm.cmd or a shell (Windows and POSIX).
export function resolveNpmCli(node = process.execPath) {
  const bin = path.dirname(fs.realpathSync(node));
  const candidates = [
    path.join(bin, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(bin, '../lib/node_modules/npm/bin/npm-cli.js'),
    path.resolve(bin, '../share/nodejs/npm/bin/npm-cli.js')
  ];
  const cli = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  if (!cli) throw new Error('dependency preparation: npm CLI not found beside Node.js; install Node.js with npm');
  return cli;
}

export function prepareDependencies(root, { runner = spawnSync, npmCli = resolveNpmCli } = {}) {
  const project = path.join(root, 'mysql-mcp');
  const manifest = path.join(project, 'package.json');
  const lock = path.join(project, 'package-lock.json');
  if (!fs.existsSync(manifest) && !fs.existsSync(lock)) return { status: 'not_applicable', reason: 'no application package or lockfile' };
  if (!fs.lstatSync(project).isDirectory() || fs.lstatSync(project).isSymbolicLink()) throw new Error('dependency preparation: application directory must be regular');
  for (const file of [manifest, lock]) {
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error('dependency preparation: application requires regular package.json and package-lock.json');
  }
  const before = [manifest, lock].map(file => hash(fs.readFileSync(file)));
  const cli = npmCli();
  const args = ['ci', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund', '--prefer-offline', '--global=false', '--workspaces=false'];
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(GIT_|GOV_|GITHUB_|NODE_TEST_)/.test(key) || key === 'NODE_OPTIONS') delete env[key];
  }
  const started_at = new Date().toISOString();
  const result = runner(process.execPath, [cli, ...args], {
    cwd: project, env, shell: false, encoding: 'utf8',
    timeout: 180000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024
  });
  const report = {
    status: 'passed', command: 'npm', args,
    package_sha256: before[0], lockfile_sha256: before[1],
    started_at, ended_at: new Date().toISOString(),
    exit_code: result.status, signal: result.signal,
    timed_out: result.error?.code === 'ETIMEDOUT', error: result.error?.message || null
  };
  let failure;
  if (result.status !== 0 || result.signal || result.error) {
    failure = `npm ci failed (exit=${result.status}, signal=${result.signal}, timeout=${report.timed_out}): ${result.stderr || result.stdout || report.error || 'no diagnostic output'}`;
  } else if ([manifest, lock].some((file, i) => !fs.existsSync(file) || hash(fs.readFileSync(file)) !== before[i])) {
    failure = 'npm ci mutated application package or lockfile';
  }
  if (failure) {
    report.status = 'failed';
    const error = new Error(`dependency preparation: ${failure}`);
    error.dependencies = report;
    throw error;
  }
  return report;
}
