import fs from 'node:fs';
import path from 'node:path';
import { hash, safePath, inputHash } from './core.mjs';
import { parseTap } from './execute.mjs';

// Local diagnostics, not authentication. Reused by report and handoff; original TAP is mandatory.
export function verifyReport(root, data, report, readArtifact, { current = true } = {}) {
  if (report.schema_version !== 1 || report.trust !== 'local-diagnostic-only' || !report.started_at || !report.ended_at || !report.source_commit || !report.environment || !Array.isArray(report.checks)) throw new Error('invalid local execution metadata');
  if (report.local_result !== 'passed' || report.error != null) throw new Error('overall local execution failed');
  if (report.checks.length !== data.checks.length || new Set(report.checks.map(r => r.check_id)).size !== data.checks.length || report.checks.some(r => !data.checks.some(c => c.id === r.check_id))) throw new Error('execution check set mismatch');
  if (current && report.input_sha256 !== inputHash(root)) throw new Error('local evidence stale: input snapshot changed');
  for (const c of data.checks) {
    const r = report.checks.find(x => x.check_id === c.id);
    if (!r || r.check_definition_sha256 !== hash(JSON.stringify(c)) || r.command !== c.command || JSON.stringify(r.args) !== JSON.stringify(c.args) || JSON.stringify(r.feature_ids) !== JSON.stringify(c.feature_ids) || JSON.stringify(r.acceptance_ids) !== JSON.stringify(c.acceptance_ids) || !r.started_at || !r.ended_at || r.exit_code !== 0 || r.signal !== null || r.timed_out !== false || r.error !== null || r.local_result !== 'passed' || !r.counts || !Array.isArray(r.artifacts) || r.artifacts.length !== 2) throw new Error(`invalid/failed local execution: ${c.id}`);
    const expected = [`${c.id}.tap`, `${c.id}.stderr.log`];
    if (new Set(r.artifacts.map(a => a.path)).size !== 2 || !expected.every(p => r.artifacts.some(a => a.path === p))) throw new Error(`missing/extraneous execution artifacts: ${c.id}`);
    for (const a of r.artifacts) {
      if (!safePath(a.path)) throw new Error('unsafe artifact path');
      const bytes = readArtifact(a.path);
      if (hash(bytes) !== a.sha256) throw new Error('artifact hash mismatch');
      if (a.path === `${c.id}.tap` && JSON.stringify(parseTap(bytes.toString())) !== JSON.stringify(r.counts)) throw new Error('TAP metadata mismatch');
    }
  }
  if (!data.checks.length) throw new Error('no registered checks');
  return report;
}
export function readEvidence(root, data, filename) {
  const file = path.resolve(filename), report = JSON.parse(fs.readFileSync(file, 'utf8')), artifacts = {};
  verifyReport(root, data, report, p => {
    const bytes = fs.readFileSync(path.join(path.dirname(file), p));
    artifacts[p] = bytes.toString('utf8');
    return bytes;
  });
  return { report, artifacts };
}
export function verifyEmbedded(root, data, evidence) {
  if (!evidence || !evidence.artifacts || !evidence.report) throw new Error('missing original execution evidence');
  verifyReport(root, data, evidence.report, p => {
    if (typeof evidence.artifacts[p] !== 'string') throw new Error('missing original TAP/artifact');
    return Buffer.from(evidence.artifacts[p]);
  }, { current: false });
}
