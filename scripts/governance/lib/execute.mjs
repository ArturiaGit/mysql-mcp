import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hash } from './core.mjs';

export function parseTap(output) {
  const get = key => {
    const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`invalid TAP ${key} summary`);
    return Number(matches[0][1]);
  };
  const counts = { tests: get('tests'), pass: get('pass'), fail: get('fail'), skipped: get('skipped'), cancelled: get('cancelled'), todo: get('todo') };
  // Node counts an empty test file as a passing file-level test; it is not an executed assertion.
  if (/^# Subtest: .*\.test\.mjs\r?$/m.test(output)) throw new Error('TAP file-only result: no explicit tests registered');
  if (!/^TAP version 13\r?$/m.test(output) || !/^1\.\.\d+\r?$/m.test(output) || !counts.tests || counts.pass !== counts.tests || counts.fail || counts.skipped || counts.cancelled || counts.todo || /^\s*not ok\b|^Bail out!|^\s*(?:ok|not ok)\b[^\n]*#\s*(SKIP|TODO)\b/im.test(output)) throw new Error('TAP zero/skipped/failure/malformed result');
  return counts;
}
export function execute(root, check, outputDir) {
  const started_at = new Date().toISOString();
  const env = { ...process.env };
  // Do not inherit the parent node:test runner or repository redirection into test fixtures.
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST_') || key.startsWith('GIT_') || key.startsWith('GOV_') || key.startsWith('GITHUB_') || key === 'NODE_OPTIONS') delete env[key];
  const result = spawnSync(process.execPath, check.args, { cwd: root, env, encoding: 'utf8', timeout: check.timeout_ms, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
  const stdout = result.stdout || '', stderr = result.stderr || '';
  fs.mkdirSync(outputDir,{recursive:true});
  const artifacts = [];
  for (const [suffix,content] of [['tap',stdout],['stderr.log',stderr]]) {
    const file = `${check.id}.${suffix}`; fs.writeFileSync(path.join(outputDir,file),content); artifacts.push({path:file,sha256:hash(content)});
  }
  let counts = null, error = result.error?.message || null;
  try { counts = parseTap(stdout); } catch (e) { error ||= e.message; }
  if (result.status !== 0) error ||= `exit ${result.status}; signal ${result.signal}`;
  return { check_id:check.id, feature_ids:check.feature_ids, acceptance_ids:check.acceptance_ids, command:check.command,args:check.args,check_definition_sha256:hash(JSON.stringify(check)),started_at,ended_at:new Date().toISOString(),exit_code:result.status,signal:result.signal,timed_out:result.error?.code === 'ETIMEDOUT',counts,artifacts,error,local_result:error ? 'failed' : 'passed' };
}
