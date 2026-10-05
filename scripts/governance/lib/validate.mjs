import fs from 'node:fs';
import path from 'node:path';
import { git, files, load, safePath, requirements, statusMarkdown } from './core.mjs';
import { trustedBase, registryAt, selectMainTask } from './scope.mjs';
import { readPolicy, validateCollaboration, validateBuildDefinitions } from './collaboration.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const list = (x, name) => { assert(Array.isArray(x), `missing array ${name}`); return x; };
const text = x => typeof x === 'string' && x.trim().length > 0;
function unique(items, label, key = x => x.id) {
  const seen = new Set();
  for (const item of items) { const id = key(item); assert(text(id) && !seen.has(id), `duplicate or invalid ${label}: ${id}`); seen.add(id); }
  return seen;
}
export function validate(root, { branch, base, head, checkReport = true, ciMain = false, delivery = false, localGit = false, message } = {}) {
  const data = load(root), { features, tasks, checks } = data;
  const featureIds = unique(features, 'feature ID'); unique(features, 'feature key', f => f.key?.trim().toLowerCase().normalize('NFKC'));
  const taskIds = unique(tasks, 'task ID'), checkIds = unique(checks, 'check ID');
  const criteria = features.flatMap(f => list(f.acceptance, `${f.id} acceptance`));
  const acceptanceIds = unique(criteria, 'acceptance ID');
  const reqs = requirements(fs.readFileSync(path.join(root, 'docs/REQUIREMENTS.md'), 'utf8'));
  assert(reqs.length, 'no requirement definitions');
  const names = process.env.GOV_TREE ? git(root, ['ls-tree', '-r', '--name-only', '-z', process.env.GOV_TREE]).split('\0').filter(Boolean) : files(root);
  const tracked = new Set(git(root, ['ls-files', '-z']).split('\0'));
  function declaredPath(p) {
    assert(safePath(p), `unsafe path: ${p}`);
    const matches = names.filter(n => n === p || (p.endsWith('/') && n.startsWith(p)));
    assert(matches.length && matches.every(n => fs.existsSync(path.join(root, n))), `missing implementation/test path: ${p}`);
    const developmental = !delivery && !head && !process.env.GOV_TREE && readPolicy(root,false) && features.some(f => f.implementation === 'in_progress' && [...f.implementation_paths,...f.test_paths].includes(p));
    assert(matches.every(n => tracked.has(n) || process.env.GOV_TREE || developmental), `untracked implementation/test path: ${p}`);
  }
  for (const f of features) {
    assert(['product','engineering','constraint'].includes(f.kind), `unknown feature kind: ${f.id}`);
    assert(['planned','in_progress','implemented'].includes(f.implementation), `unknown implementation status: ${f.id}`);
    assert(text(f.title) && text(f.behavior), `missing feature description: ${f.id}`);
    assert(list(f.requirements, 'requirements').length && f.requirements.every(r => reqs.includes(r)), `undefined requirement: ${f.id}`);
    for (const d of list(f.dependencies, 'dependencies')) assert(featureIds.has(d), `missing dependency: ${d}`);
    for (const t of list(f.task_ids, 'task_ids')) assert(taskIds.has(t), `missing task: ${t}`);
    for (const key of ['implementation_paths','test_paths']) {
      list(f[key], key).forEach(p => { assert(safePath(p), `unsafe path: ${p}`); if (f.implementation !== 'planned') declaredPath(p); });
      if (f.implementation === 'implemented') assert(f[key].length, `implemented feature missing ${key}: ${f.id}`);
    }
    assert(f.acceptance.length, `missing acceptance: ${f.id}`);
    for (const a of f.acceptance) {
      assert(text(a.description), `missing criterion description: ${a.id}`);
      assert(list(a.evidence_types, 'evidence_types').length && a.evidence_types.every(t => ['automated','manual','real_mysql','client'].includes(t)), `unknown evidence type: ${a.id}`);
      for (const c of list(a.check_ids, 'check_ids')) {
        assert(checkIds.has(c), `missing check: ${c}`);
        const check = checks.find(x => x.id === c);
        assert(check.feature_ids.includes(f.id) && check.acceptance_ids.includes(a.id), `inconsistent check mapping: ${a.id}`);
      }
      if (f.implementation === 'implemented' && a.evidence_types.includes('automated')) assert(a.check_ids.length, `missing automated check: ${a.id}`);
      for (const field of ['status','passed','verified','accepted','completed']) assert(a[field] === undefined, `unauthenticated acceptance claim: ${a.id}`);
    }
    assert(list(f.evidence, 'evidence').length === 0, `external evidence authentication unavailable: ${f.id}; local reports cannot grant acceptance`);
    for (const field of ['status','passed','verified','accepted','completed','verification','delivery']) assert(f[field] === undefined, `unauthenticated completion claim: ${f.id}`);
  }
  for (const r of reqs) assert(features.some(f => f.requirements.includes(r)), `uncovered requirement: ${r}`);
  const visiting = new Set(), done = new Set();
  function visit(id) { assert(!visiting.has(id), `dependency cycle: ${id}`); if (done.has(id)) return; visiting.add(id); features.find(f => f.id === id).dependencies.forEach(visit); visiting.delete(id); done.add(id); }
  features.forEach(f => visit(f.id));
  for (const c of checks) {
    assert(/^[A-Za-z0-9_-]+$/.test(c.id), `unsafe check ID: ${c.id}`);
    assert(c.command === 'node' && c.parser === 'tap', `command/parser not allowed: ${c.id}`);
    assert(Array.isArray(c.args) && c.args.length >= 3 && c.args[0] === '--test' && c.args[1] === '--test-reporter=tap' && c.args.slice(2).every(p => safePath(p) && /^tests\/.+\.test\.mjs$/.test(p) && fs.existsSync(path.join(root,p))), `check args not allowed: ${c.id}`);
    assert(Number.isInteger(c.timeout_ms) && c.timeout_ms > 0 && c.timeout_ms <= 600000, `invalid timeout: ${c.id}`);
    assert(list(c.feature_ids,'feature_ids').length && c.feature_ids.every(id => featureIds.has(id)), `unknown check feature: ${c.id}`);
    assert(list(c.acceptance_ids,'acceptance_ids').length && c.acceptance_ids.every(id => acceptanceIds.has(id)), `unknown check acceptance: ${c.id}`);
    for (const id of c.acceptance_ids) assert(features.some(f => c.feature_ids.includes(f.id) && f.acceptance.some(a => a.id === id && a.check_ids.includes(c.id))), `inconsistent reverse check mapping: ${c.id}`);
  }
  const activeNew = new Set();
  for (const t of tasks) {
    assert(['maintenance','new','fix'].includes(t.kind) && ['in_progress','completed','cancelled'].includes(t.status), `unknown task kind/status: ${t.id}`);
    assert(text(t.branch) && !['main','master'].includes(t.branch) && text(t.authorization) && /^[a-f0-9]{40,64}$/.test(t.base_commit), `invalid task authorization/branch/base: ${t.id}`);
    assert(t.pr === null || (Number.isInteger(t.pr) && t.pr > 0), `invalid PR: ${t.id}`);
    validateBuildDefinitions(t);
    assert(list(t.allowed_paths,'allowed_paths').length && t.allowed_paths.every(safePath), `unsafe allowed path: ${t.id}`);
    list(t.scope_changes,'scope_changes'); assert(typeof t.governance_change === 'boolean', `missing governance_change: ${t.id}`);
    assert(list(t.feature_ids,'feature_ids').length && t.feature_ids.every(id => featureIds.has(id)), `unknown task feature: ${t.id}`);
    for (const id of t.feature_ids) {
      assert(features.find(f => f.id === id).task_ids.includes(t.id), `inconsistent task mapping: ${t.id}`);
      if (t.kind === 'new' && t.status === 'in_progress') { assert(!activeNew.has(id), `active new task collision: ${id}`); activeNew.add(id); assert(features.find(f => f.id === id).implementation !== 'implemented', `new task re-registers implemented feature: ${id}`); }
    }
  }
  for (const n of names) {
    assert(safePath(n), `unsafe tracked path: ${n}`);
    assert(!/(^|\/)(\.pi|\.env(?:\..*)?|mysql-mcp-memory\.md|id_rsa|credentials(?:\.json)?|connections\.json)(\/|$)|\.(pem|key|p12|sql|dump)$/i.test(n) && !n.startsWith('.governance-evidence/'), `confidential tracked path: ${n}`);
    if (!fs.existsSync(path.join(root,n))) continue;
    assert(fs.lstatSync(path.join(root,n)).isFile(), `non-regular input: ${n}`);
    const content = fs.readFileSync(path.join(root,n),'utf8');
    assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|mysql:\/\/[^\s:/]+:[^\s@]+@/.test(content), `secret signature: ${n}`);
    if (/roadmap/i.test(n) && n.endsWith('.md')) assert(!/^\s*[-*]\s+\[[xX]\]/m.test(content), `unauthenticated checked roadmap: ${n}`);
  }
  if (checkReport) assert(fs.existsSync(path.join(root,'docs/FEATURE_STATUS.md')) && fs.readFileSync(path.join(root,'docs/FEATURE_STATUS.md'),'utf8') === statusMarkdown(data), 'derived FEATURE_STATUS.md differs; run report.mjs --write');
  if (!ciMain) branch ||= git(root,['branch','--show-current']);
  if (ciMain) {
    assert(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main' && base && head, 'completed-task inspection requires read-only main CI context');
    const associated = selectMainTask(root, base, head);
    assert(!branch || branch === associated.branch, 'main CI task branch does not match merged delta');
    branch = associated.branch;
  }
  const selected = tasks.filter(t => t.branch === branch && (t.status === 'in_progress' || (ciMain && t.status === 'completed')));
  assert(selected.length === 1, `expected one active task for branch: ${branch}`);
  const task = selected[0];
  const comparisonRef = base && head ? base : 'HEAD';
  base = trustedBase(root, task, { base, head });
  // Completed task metadata is inspected only as an unauthenticated historical label;
  // it grants neither feature completion nor permission to commit/push.
  const oldFeatures = registryAt(root, comparisonRef, 'features');
  for (const old of oldFeatures) {
    const current = features.find(f => f.id === old.id);
    if (JSON.stringify(current) !== JSON.stringify(old)) assert(task.feature_ids.includes(old.id) || task.scope_changes.some(s => s?.id === old.id && s.action === 'modify' && text(s.reason) && text(s.authorization)), `feature outside selected task scope: ${old.id}`);
  }
  const diff = head ? ['diff','--name-only','-z','--no-renames',base,head] : process.env.GOV_TREE ? ['diff','--name-only','-z','--no-renames',base,process.env.GOV_TREE] : ['diff','--name-only','-z','--no-renames',base];
  const changed = new Set(git(root,diff).split('\0').filter(Boolean));
  if (!head && !process.env.GOV_TREE) git(root,['ls-files','--others','--exclude-standard','-z']).split('\0').filter(Boolean).forEach(n => changed.add(n));
  for (const n of changed) assert(task.allowed_paths.some(p => n === p || (p.endsWith('/') && n.startsWith(p))), `out of task scope: ${n}`);
  if ([...changed].some(n => /^(governance\/|scripts\/governance\/|tests\/governance\/|\.githooks\/|\.github\/workflows\/)/.test(n))) assert(task.governance_change, 'explicit governance_change required');
  const oldFeaturesText = git(root,['show',`${comparisonRef}:governance/features.json`],true);
  const removed = [];
  if (oldFeaturesText) {
    const old = JSON.parse(oldFeaturesText).features;
    for (const f of old) { if (!featureIds.has(f.id)) removed.push(f.id); for (const a of f.acceptance) if (!acceptanceIds.has(a.id)) removed.push(a.id); }
  }
  const oldReqs = requirements(git(root,['show',`${comparisonRef}:docs/REQUIREMENTS.md`],true));
  removed.push(...oldReqs.filter(r => !reqs.includes(r)));
  for (const id of removed) assert(task.scope_changes.some(s => s && typeof s === 'object' && s.id === id && s.action === 'remove' && text(s.reason) && text(s.authorization)), `missing authorized scope_changes removal: ${id}`);
  const collaboration = validateCollaboration(root,task,{delivery:delivery || Boolean(head),localGit,base,head,ciMain,message,changed:[...changed]});
  return { data, task, names, collaboration };
}
