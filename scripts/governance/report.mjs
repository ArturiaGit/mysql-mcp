#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { load, statusMarkdown, inputHash, hash, safePath, main } from './lib/core.mjs';
import { parseTap } from './lib/execute.mjs';

main(() => {
  const root = process.cwd(), args = process.argv.slice(2), data = load(root);
  for (let i=0;i<args.length;i++) {
    if (args[i] === '--run') { if (!args[++i]) throw new Error('--run requires report path'); }
    else if (!['--write','--check'].includes(args[i])) throw new Error(`unknown option: ${args[i]}`);
  }
  if (args.includes('--write') && args.includes('--check')) throw new Error('--write and --check are exclusive');
  const markdown = statusMarkdown(data), target = path.join(root,'docs/FEATURE_STATUS.md');
  if (args.includes('--write')) fs.writeFileSync(target,markdown);
  else if (args.includes('--check')) { if (fs.readFileSync(target,'utf8') !== markdown) throw new Error('derived FEATURE_STATUS.md differs'); }
  else console.log(markdown);
  if (args.includes('--run')) {
    const filename = path.resolve(args[args.indexOf('--run')+1]);
    const report = JSON.parse(fs.readFileSync(filename,'utf8'));
    if (report.schema_version !== 1 || report.trust !== 'local-diagnostic-only' || !report.started_at || !report.ended_at || !report.source_commit || !report.environment || !Array.isArray(report.checks)) throw new Error('invalid local execution metadata');
    if (report.local_result !== 'passed' || report.error != null) throw new Error('overall local execution failed');
    if (report.checks.length !== data.checks.length || new Set(report.checks.map(r => r.check_id)).size !== data.checks.length || report.checks.some(r => !data.checks.some(c => c.id === r.check_id))) throw new Error('execution check set mismatch');
    if (report.input_sha256 !== inputHash(root)) throw new Error('local evidence stale: input snapshot changed');
    for (const c of data.checks) {
      const r = report.checks.find(x => x.check_id === c.id);
      if (!r || r.check_definition_sha256 !== hash(JSON.stringify(c)) || r.command !== c.command || JSON.stringify(r.args) !== JSON.stringify(c.args) || JSON.stringify(r.feature_ids) !== JSON.stringify(c.feature_ids) || JSON.stringify(r.acceptance_ids) !== JSON.stringify(c.acceptance_ids) || !r.started_at || !r.ended_at || r.exit_code !== 0 || r.signal !== null || r.timed_out !== false || r.error !== null || r.local_result !== 'passed' || !r.counts || !Array.isArray(r.artifacts) || r.artifacts.length !== 2) throw new Error(`invalid/failed local execution: ${c.id}`);
      const expected = [`${c.id}.tap`, `${c.id}.stderr.log`];
      if (new Set(r.artifacts.map(a => a.path)).size !== 2 || !expected.every(p => r.artifacts.some(a => a.path === p))) throw new Error(`missing/extraneous execution artifacts: ${c.id}`);
      for (const artifact of r.artifacts) {
        if (!safePath(artifact.path)) throw new Error('unsafe artifact path');
        const content = fs.readFileSync(path.join(path.dirname(filename),artifact.path));
        if (hash(content) !== artifact.sha256) throw new Error('artifact hash mismatch');
        if (artifact.path === `${c.id}.tap` && JSON.stringify(parseTap(content.toString())) !== JSON.stringify(r.counts)) throw new Error('TAP metadata mismatch');
      }
    }
    if (!data.checks.length) throw new Error('no registered checks');
    console.log('Local verification: recorded executions and artifacts consistent (unauthenticated diagnostic, NOT independent CI proof). Acceptance: unverified; manual/real MySQL/client acceptance NOT granted.');
  }
});
