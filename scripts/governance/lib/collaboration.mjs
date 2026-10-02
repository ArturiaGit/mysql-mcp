import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { files, git, hash, load, safePath, snapshotContentHash, worktreeModes } from './core.mjs';
import { readEvidence, verifyEmbedded } from './evidence.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(`collaboration: ${message}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const oid = s => typeof s === 'string' && /^[a-f0-9]{40,64}$/.test(s);
const roles = ['antigravity', 'pi-desktop'];
const phases = { planning:'antigravity', implementation:'pi-desktop', documentation_delivery:'antigravity', rework:'pi-desktop' };
const codePhases = ['implementation', 'rework', 'bootstrap'];
const policyPath = 'governance/collaboration.json';
const bootstrapBase = 'ed631a2201e6b439bc79ca6d241176db68ddad82';
const matches = (n, p) => n === p || (p.endsWith('/') && n.startsWith(p)) || (p === '*.md' && n.endsWith('.md'));
const machine = n => n.startsWith('governance/handoffs/') || n.startsWith('.governance-evidence/');
const regular = (root, n) => { const s = fs.lstatSync(path.join(root, n)); assert(s.isFile() && !s.isSymbolicLink(), `non-regular file: ${n}`); };
const manifestCache = new Map(); // Only immutable object IDs, never working files or HEAD.
export function manifest(root, ref) {
  const cached = oid(ref) ? manifestCache.get(root+'\0'+ref) : null;
  if (cached) return {...cached};
  const result = {};
  const workNames = !ref ? [...new Set(files(root))].sort() : [];
  const modes = !ref ? worktreeModes(root,workNames) : {};
  if (!ref) {
    for (const n of workNames) {
      assert(safePath(n), `unsafe manifest path: ${n}`);
      if (machine(n) || !fs.existsSync(path.join(root, n))) continue;
      regular(root, n); result[n] = snapshotContentHash(fs.readFileSync(path.join(root, n)),modes[n]);
    }
  } else {
    const entries = git(root, ['ls-tree','-r','-z',ref]).split('\0').filter(Boolean).map(s => {
      const [meta, n] = s.split('\t'), [mode, type, object] = meta.split(' ');
      assert(safePath(n) && type === 'blob' && ['100644','100755'].includes(mode), `unsafe/non-regular ref path: ${n}`);
      return { n, object, mode };
    }).filter(e => !machine(e.n));
    const r = spawnSync('git', ['-C',root,'cat-file','--batch'], { input:entries.map(e => e.object).join('\n')+'\n', maxBuffer:64*1024*1024 });
    assert(r.status === 0, 'cannot read ref manifest');
    let pos = 0;
    for (const e of entries) {
      const end = r.stdout.indexOf(10,pos), header = r.stdout.subarray(pos,end).toString().split(' '), length = Number(header[2]);
      assert(header[1] === 'blob' && Number.isInteger(length), 'invalid blob manifest');
      result[e.n] = snapshotContentHash(r.stdout.subarray(end+1,end+1+length),e.mode); pos = end+2+length;
    }
  }
  const ordered = Object.fromEntries(Object.entries(result).sort(([a],[b]) => a.localeCompare(b,'en')));
  if (oid(ref)) { if (manifestCache.size >= 16) manifestCache.clear(); manifestCache.set(root+'\0'+ref,ordered); }
  return ordered;
}
function validManifest(m) {
  assert(m && typeof m === 'object' && !Array.isArray(m), 'missing manifest');
  assert(Object.entries(m).every(([n,h]) => safePath(n) && !machine(n) && /^(100644|100755):[a-f0-9]{64}$/.test(h)), 'invalid manifest entry');
  assert(eq(Object.keys(m), Object.keys(m).sort((a,b) => a.localeCompare(b,'en'))), 'unsorted manifest');
}
export function changes(before, after) {
  return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(n => before[n] !== after[n]).map(n => ({ path:n, before:before[n] || null, after:after[n] || null, action:!before[n] ? 'add' : !after[n] ? 'delete' : 'modify' }));
}
export function readPolicy(root, required = true) {
  if (!fs.existsSync(path.join(root,policyPath))) {
    const anchors = ['HEAD',git(root,['rev-parse','--verify','refs/remotes/origin/main'],true)].filter(Boolean);
    assert(!anchors.some(ref => git(root,['show',`${ref}:${policyPath}`],true)), 'collaboration policy removed from enforced repository');
    assert(!required, 'missing collaboration policy'); return null;
  }
  const p = JSON.parse(fs.readFileSync(path.join(root,policyPath),'utf8'));
  assert(p.schema_version === 1 && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(p.repository) && oid(p.enabled_base), 'invalid policy schema/repository/baseline');
  assert(p.git_role === 'antigravity' && eq(p.phases,phases) && eq(Object.keys(p.roles).sort(),[...roles].sort()), 'invalid responsibility policy');
  for (const role of roles) assert(Array.isArray(p.roles[role]) && p.roles[role].length && p.roles[role].every(n => n === '*.md' || safePath(n)), 'invalid role path');
  // Prefix overlaps and duplicate rules fail closed; *.md is an explicit documentation override.
  const rules = roles.flatMap(role => p.roles[role].filter(n => n !== '*.md').map(n => ({role,n})));
  for (let i=0;i<rules.length;i++) for (let j=i+1;j<rules.length;j++) if (rules[i].role !== rules[j].role) assert(!matches(rules[i].n,rules[j].n) && !matches(rules[j].n,rules[i].n), 'overlapping role paths');
  if (p.bootstrap) assert(p.bootstrap.task_id === 'TASK-GOV-004' && p.bootstrap.branch === 'chore/antigravity-pi-handoff' && p.bootstrap.base_commit === bootstrapBase && p.enabled_base === bootstrapBase && goodText(p.bootstrap.authorization) && Array.isArray(p.bootstrap.documentation_paths) && p.bootstrap.documentation_paths.every(safePath), 'bootstrap is restricted to approved TASK-GOV-004');
  return p;
}
export function owner(p, n) {
  assert(safePath(n) && !machine(n), `unsafe/unclassified path: ${n}`);
  // Markdown is documentation even when kept alongside source.
  const owners = n.endsWith('.md') && p.roles.antigravity.includes('*.md') ? ['antigravity'] : roles.filter(r => p.roles[r].some(x => matches(n,x)));
  assert(owners.length === 1, `unclassified/ambiguous responsibility path: ${n}`);
  return owners[0];
}
function isBootstrap(p,t) { return p.bootstrap && t.id === p.bootstrap.task_id && t.branch === p.bootstrap.branch && t.base_commit === p.bootstrap.base_commit; }
function permitted(p,t,phase,role,diff) {
  assert(role === (phase === 'bootstrap' ? 'pi-desktop' : phases[phase]), 'wrong phase role');
  if (phase === 'bootstrap') assert(isBootstrap(p,t), 'bootstrap exception does not apply to task');
  for (const c of diff) {
    assert(t.allowed_paths.some(n => matches(c.path,n)), `out of task scope: ${c.path}`);
    const r = owner(p,c.path);
    assert(r === role || (phase === 'bootstrap' && p.bootstrap.documentation_paths.includes(c.path) && r === 'antigravity'), `responsibility boundary: ${role}/${phase} cannot change ${c.path}`);
    if (/^(scripts\/governance\/|tests\/governance\/|\.githooks\/|\.github\/workflows\/|governance\/)/.test(c.path)) assert(t.governance_change, 'explicit governance_change required');
    if (t.mode === 'docs') assert(r === 'antigravity', 'document-only task cannot change code');
  }
}
export function contractHash(t,m) {
  assert(safePath(t.plan_path) && t.plan_path.startsWith('docs/plans/'), 'task must declare a plan_path');
  const names = [policyPath,'governance/features.json','governance/checks.json','docs/REQUIREMENTS.md','docs/ACCEPTANCE.md','docs/PROJECT_CONSTRAINTS.md',t.plan_path];
  const {pr,status,...authorization} = t;
  return hash(JSON.stringify({authorization,files:names.map(n => [n,m[n] || null])}));
}
export function developmentHash(root,t,p = readPolicy(root),m = manifest(root)) {
  if (!p) return null;
  return hash(JSON.stringify({ contract:contractHash(t,m), code:Object.entries(m).filter(([n]) => owner(p,n) === 'pi-desktop') }));
}
function goodText(s) { return typeof s === 'string' && s.trim().length > 0 && !/(?:\bTODO\b|\bTBD\b|<[^>]+>|待填写|占位符)/i.test(s); }
function texts(a, nonempty = false) { return Array.isArray(a) && (!nonempty || a.length > 0) && a.every(goodText); }
export const recordPath = t => { assert(/^[A-Za-z0-9_-]+$/.test(t.id), 'unsafe task ID'); return `governance/handoffs/${t.id}.json`; };
export function readLog(root,t, optional = false) {
  const file = path.join(root,recordPath(t));
  if (!fs.existsSync(file) && optional) return {schema_version:1,task_id:t.id,events:[]};
  assert(fs.existsSync(file), `missing handoff log for ${t.id}`); regular(root,recordPath(t));
  const log = JSON.parse(fs.readFileSync(file,'utf8'));
  assert(log.schema_version === 1 && log.task_id === t.id && Array.isArray(log.events), 'invalid handoff log'); return log;
}
export function append(log,payload) {
  const event = {schema_version:1,id:`${log.task_id}-E${log.events.length+1}`,sequence:log.events.length+1,previous:log.events.at(-1)?.digest || null,at:new Date().toISOString(),...payload};
  event.digest = hash(JSON.stringify(event)); log.events.push(event); return event;
}
function eventDigest(e) { const {digest,...body} = e; return hash(JSON.stringify(body)); }
function expectedStart(t,events,p) {
  const last = events.at(-1);
  if (!last) return {phase:isBootstrap(p,t) ? 'bootstrap' : 'planning',role:isBootstrap(p,t) ? 'pi-desktop' : 'antigravity'};
  if (last.type === 'delivery') return {phase:'documentation_delivery',role:'antigravity'}; // local Git bookkeeping; not message acceptance
  assert(last.type === 'receipt', 'next stage requires explicit handoff acceptance');
  const h = events.find(e => e.id === last.handoff);
  if (last.decision !== 'accept') return {phase:'planning',role:'antigravity'};
  assert(h && ['handoff','delivery'].includes(h.type), 'missing accepted handoff');
  return {phase:h.next_phase,role:phases[h.next_phase]};
}
function detailsCheck(d,e,t,data,p,root,currentContract) {
  assert(d && goodText(d.goal) && goodText(d.outcome) && texts(d.next_actions,true) && texts(d.forbidden,true) && texts(d.documentation_requests) && texts(d.limitations,true) && texts(d.blockers), 'incomplete/placeholder handoff details');
  assert(['ready','blocked'].includes(d.result) && (d.result !== 'ready' || d.blockers.length === 0) && (d.result !== 'blocked' || d.blockers.length > 0), 'blocked handoff cannot claim ready');
  assert(d.build && ['not_applicable','passed','failed'].includes(d.build.status) && goodText(d.build.reason) && Array.isArray(d.build.check_ids), 'missing build/compile result or reason');
  const checks = e.check_definitions.filter(c => c.feature_ids.some(id => t.feature_ids.includes(id)));
  assert(Array.isArray(d.verification) && d.verification.every(v => checks.some(c => c.id === v.check_id) && goodText(v.reason)) && new Set(d.verification.map(v => v.check_id)).size === d.verification.length, 'wrong/duplicate verification references');
  if (d.result === 'ready' && e.phase !== 'planning') {
    assert(checks.every(c => d.verification.some(v => v.check_id === c.id)), 'required verification missing');
    const boundChecks = e.check_definitions;
    assert(Array.isArray(boundChecks), 'missing check definitions');
    verifyEmbedded(root,{checks:boundChecks},e.evidence);
    if (e.contract_sha256 === currentContract) assert(eq(e.check_definitions,data.checks), 'check definitions drift');
    assert(e.evidence.report.task_id === t.id && eq(e.evidence.report.feature_ids,t.feature_ids), 'wrong evidence task/features/check definitions');
    assert(e.evidence.report.development_sha256 === developmentHash(root,t,p,e.after), 'stale development execution evidence');
    assert(e.evidence.report.source_commit === e.source_head, 'wrong source HEAD in evidence');
    assert(d.build.status !== 'failed', 'failed build cannot be delivered');
    const builds = t.build_checks || [];
    if (!builds.length) {
      assert(!Object.keys(e.after).some(n => /(^|\/)package\.json$/.test(n)) || t.mode === 'docs', 'application code requires registered build/compile checks');
      assert(d.build.status === 'not_applicable' && d.build.check_ids.length === 0, 'no registered build: declare not_applicable honestly');
    } else {
      assert(d.build.status === 'passed' && eq(d.build.check_ids,builds.map(b => b.id)), 'missing required build/compile checks');
      verifyBuilds(t,e.build_evidence,developmentHash(root,t,p,e.after));
    }
  }
  if (e.phase === 'documentation_delivery' && d.result === 'ready' && e.next_phase === 'wait') assert(goodText(d.commit_message) && /^(feat|fix|docs|test|refactor|build|chore)(\([a-z0-9-]+\))?!?: [^\r\n]+/.test(d.commit_message), 'Antigravity must provide Conventional Commit message');
  else assert(d.commit_message === undefined, 'commit message only belongs to ready documentation_delivery');
}
function legalNext(e,t) {
  if (e.details.result === 'blocked') return e.phase === 'documentation_delivery' ? (['rework','planning'].includes(e.next_phase) ? e.next_phase : null) : 'planning';
  if (e.phase === 'planning') return t.mode === 'docs' ? 'documentation_delivery' : 'implementation';
  if (codePhases.includes(e.phase)) return 'documentation_delivery';
  return ['wait','rework','planning'].includes(e.next_phase) ? e.next_phase : null;
}
function prefixCheck(root,t,log,ref) {
  const old = git(root,['show',`${ref}:${recordPath(t)}`],true);
  if (old) {
    const previous = JSON.parse(old).events;
    assert(eq(log.events.slice(0,previous.length),previous), 'existing handoff history rewritten/truncated');
  }
}
export function validateLog(root,t,p,log,{current = true,delivery = false,base,head,ciMain = false,message} = {}) {
  assert(['code','docs'].includes(t.mode) && safePath(t.plan_path), 'task missing collaboration mode/plan');
  assert(log.task_id === t.id && log.schema_version === 1 && Array.isArray(log.events) && log.events.length, 'missing handoff events');
  let previous = null, active = null, end = manifest(root,t.base_commit), lastHandoff = null, latestCode = null, candidateRevoked = false;
  const anchorManifest = end;
  const actual = manifest(root), currentContract = contractHash(t,actual), taskData = dataForTask(root,t), checkedHeads = new Set();
  for (let i=0;i<log.events.length;i++) {
    const e = log.events[i], preceding = log.events.slice(0,i);
    // The untransferred bootstrap E1 was recorded before mode binding was added.
    // Its content-only baseline must exactly match this immutable Git base; infer modes only there.
    const bootstrapLegacy = i === 0 && e.phase === 'bootstrap' && isBootstrap(p,t) && e.source_head === t.base_commit && Object.values(e.before).every(sha);
    const effectiveBefore = bootstrapLegacy ? anchorManifest : e.before;
    if (bootstrapLegacy) assert(eq(e.before,Object.fromEntries(Object.entries(anchorManifest).map(([n,h])=>[n,h.slice(7)]))), 'legacy bootstrap baseline mismatch');
    const stageTask = ['begin','handoff'].includes(e.type) ? e.task_definition : t;
    if (['begin','handoff'].includes(e.type)) assert(stageTask && stageTask.id === t.id && stageTask.branch === t.branch && stageTask.base_commit === t.base_commit && Array.isArray(stageTask.feature_ids) && Array.isArray(stageTask.allowed_paths) && stageTask.allowed_paths.every(safePath) && ['code','docs'].includes(stageTask.mode), 'invalid/frozen task definition');
    assert(e.schema_version === 1 && e.id === `${t.id}-E${i+1}` && e.sequence === i+1 && e.previous === previous && e.digest === eventDigest(e) && !Number.isNaN(Date.parse(e.at)), 'invalid event digest/order/chain');
    assert(roles.includes(e.role), 'wrong event role'); previous = e.digest;
    if (e.type === 'begin') {
      assert(!active, 'overlapping active phases');
      const expected = expectedStart(stageTask,preceding,p);
      assert(e.phase === expected.phase && e.role === expected.role, 'missing planning/illegal stage transition or role');
      validManifest(effectiveBefore); assert(eq(effectiveBefore,end), 'stage manifest discontinuity');
      assert(oid(e.source_head), 'invalid source HEAD');
      if (!checkedHeads.has(e.source_head)) { assert(git(root,['merge-base',t.base_commit,e.source_head]) === t.base_commit, 'wrong/nonancestor source HEAD'); checkedHeads.add(e.source_head); }
      assert(e.branch === stageTask.branch && e.base_commit === stageTask.base_commit && e.repository === p.repository && eq(e.feature_ids,stageTask.feature_ids), 'wrong handoff task/branch/base/repository/features');
      assert(e.contract_sha256 === contractHash(stageTask,e.before), 'wrong start contract'); active = {...e,before:effectiveBefore};
    } else if (e.type === 'handoff') {
      assert(active && e.begin === active.id && e.phase === active.phase && e.role === active.role && e.source_head === active.source_head, 'handoff without matching phase');
      validManifest(e.after); assert(eq(e.before,active.before) && eq(e.changes,changes(e.before,e.after)), 'handoff file omission/change mismatch');
      permitted(p,stageTask,e.phase,e.role,e.changes);
      assert(e.contract_sha256 === contractHash(stageTask,e.after), 'wrong handoff plan/standard contract');
      assert(eq(e.acceptance_ids,e.acceptance_definitions.map(a=>a.id).sort()), 'wrong handoff acceptance IDs');
      if (e.contract_sha256 === currentContract) assert(eq(e.acceptance_ids,taskData.acceptance_ids), 'wrong current acceptance IDs');
      assert(e.next_phase === legalNext(e,stageTask), 'invalid next stage');
      const receiver = e.next_phase === 'planning' || e.next_phase === 'documentation_delivery' ? 'antigravity' : 'pi-desktop';
      if (e.details.result === 'ready') assert(e.after[stageTask.plan_path], 'ready handoff requires existing declared plan');
      assert(e.receiver === receiver, 'wrong handoff receiver');
      detailsCheck(e.details,e,stageTask,taskData.data,p,root,currentContract);
      if (codePhases.includes(e.phase)) latestCode = e;
      if (e.phase === 'documentation_delivery' && e.details.result === 'ready' && e.next_phase === 'wait' && stageTask.mode === 'code') {
        assert(latestCode && latestCode.details.result === 'ready' && latestCode.contract_sha256 === e.contract_sha256 && developmentHash(root,latestCode.task_definition,p,latestCode.after) === developmentHash(root,stageTask,p,e.after), 'plan/code drift: replan and rework before delivery');
      }
      if (e.phase === 'documentation_delivery' && e.details.result === 'ready' && e.next_phase === 'wait') candidateRevoked = false;
      end = e.after; active = null; lastHandoff = e;
    } else if (e.type === 'receipt') {
      const h = preceding.at(-1);
      assert(!active && ['handoff','delivery'].includes(h?.type) && h.id === e.handoff && e.handoff_digest === h.digest, 'duplicate/out-of-order/wrong handoff receipt');
      assert(['accept','reject','cancel'].includes(e.decision) && goodText(e.reason), 'invalid handoff decision');
      if (h.phase === 'documentation_delivery' && e.decision !== 'accept') candidateRevoked = true;
      assert(e.role === (e.decision === 'cancel' ? h.role : h.receiver), 'wrong handoff receiver role');
      assert(e.snapshot_sha256 === hash(JSON.stringify(end)), 'receipt snapshot mismatch');
    } else if (e.type === 'delivery') {
      assert(!candidateRevoked, 'cancelled/rejected candidate cannot be delivered');
      assert(!active && lastHandoff?.phase === 'documentation_delivery' && lastHandoff.details.result === 'ready' && lastHandoff.next_phase === 'wait' && e.role === 'antigravity' && e.candidate === lastHandoff.id, 'delivery requires Antigravity candidate');
      assert(oid(e.commit) && e.commit === e.source_head && Number.isInteger(e.pr) && e.pr > 0 && e.pr_url === p.repository.replace(/\.git$/,'')+`/pull/${e.pr}` && e.base === 'main' && e.branch === t.branch && ['pending','success','failure','not_configured'].includes(e.ci.status) && texts(e.next_actions,true) && goodText(e.ci.reason), 'invalid real Git/PR/CI delivery metadata');
      assert(eq(manifest(root,e.commit),end) && git(root,['show','-s','--format=%B',e.commit]).trim() === lastHandoff.details.commit_message.trim(), 'delivery commit/candidate mismatch');
      assert(e.receiver === 'pi-desktop' && e.next_phase === (e.ci.status === 'failure' ? 'rework' : 'wait'), 'delivery next action/receiver mismatch');
      assert(e.ci.status === 'not_configured' ? e.ci.url === null : /^https:\/\/github\.com\/.+\/actions\/runs\/\d+$/.test(e.ci.url), 'missing CI run URL');
    } else assert(false, 'unknown event type');
  }
  // The first phase must cover the exact authorized base, including newly created files.
  const first = log.events[0];
  const legacyFirst = first.phase === 'bootstrap' && isBootstrap(p,t) && Object.values(first.before).every(sha);
  assert(eq(first.before,legacyFirst ? Object.fromEntries(Object.entries(anchorManifest).map(([n,h])=>[n,h.slice(7)])) : anchorManifest), 'incorrect baseline manifest');
  prefixCheck(root,t,log,base || 'HEAD');
  if (!head) prefixCheck(root,t,log,'HEAD');
  if (current) {
    // actual was captured once before replay; no check executes or mutates inputs here.
    if (active) permitted(p,active.task_definition,active.phase,active.role,changes(active.before,actual));
    else assert(eq(actual,end), 'snapshot changed after handoff; begin next authorized phase');
  }
  if (delivery) {
    assert(!candidateRevoked, 'cancelled/rejected candidate cannot be committed/pushed');
    assert(!active && lastHandoff?.phase === 'documentation_delivery' && lastHandoff.details.result === 'ready' && lastHandoff.next_phase === 'wait', 'Git delivery requires completed Antigravity documentation_delivery');
    assert(lastHandoff.contract_sha256 === currentContract, 'delivery task/authorization changed; replan and reverify');
    assert(eq(actual,lastHandoff.after), 'delivery candidate snapshot mismatch');
    if (message !== undefined) assert(message.trim() === lastHandoff.details.commit_message.trim(), 'commit message differs from Antigravity candidate');
    if (head && !ciMain) validateCommits(root,t,p,base || t.base_commit,head);
  }
  return { active, lastHandoff, end, latestCode };
}
function dataForTask(root,t) { const data = load(root); return { data, acceptance_ids:data.features.filter(f => t.feature_ids.includes(f.id)).flatMap(f => f.acceptance.map(a => a.id)).sort() }; }
function validateCommits(root,t,p,base,head) {
  const commits = git(root,['rev-list','--reverse',`${base}..${head}`]).split('\n').filter(Boolean);
  for (const commit of commits) {
    const raw = git(root,['show',`${commit}:${recordPath(t)}`],true);
    assert(raw, 'commit has no handoff delivery candidate');
    const log = JSON.parse(raw), m = manifest(root,commit), msg = git(root,['show','-s','--format=%B',commit]).trim();
    assert(log.events.some(e => e.type === 'handoff' && e.phase === 'documentation_delivery' && e.role === 'antigravity' && e.details?.result === 'ready' && eq(e.after,m) && e.details.commit_message?.trim() === msg), 'actual commit differs from registered Antigravity candidate/message');
  }
}
export function validateCollaboration(root,t,{delivery = false,localGit = false,base,head,ciMain = false,message,changed = []} = {}) {
  const p = readPolicy(root,false);
  if (!p) {
    assert(![base,head].filter(Boolean).some(ref=>git(root,['show',`${ref}:${policyPath}`],true)), 'collaboration policy removed from CI/push baseline');
    return null; // A genuinely pre-policy historical baseline only.
  }
  assert(git(root,['merge-base',p.enabled_base,t.base_commit]) === p.enabled_base, 'historical task cannot authorize new collaboration changes');
  assert(!localGit || process.env.GOV_ROLE === 'antigravity', 'Git actions require GOV_ROLE=antigravity; PI-Desktop cannot commit/push');
  if (!head && !process.env.GOV_TREE && !ciMain) assert(git(root,['branch','--show-current']) === t.branch, 'wrong current task branch');
  assert(changed.filter(machine).every(n => n === recordPath(t)), 'cannot modify another task handoff/machine artifact');
  const log = readLog(root,t);
  const result = validateLog(root,t,p,log,{delivery,base,head,ciMain,message});
  return { policy:p, log, ...result };
}
export function begin(root,t,role,phase) {
  const p = readPolicy(root), log = readLog(root,t,true);
  if (log.events.length) validateLog(root,t,p,log);
  const next = expectedStart(t,log.events,p);
  assert(next.role === role && next.phase === phase, 'illegal begin: role/stage/acceptance');
  assert(t.status === 'in_progress' && git(root,['branch','--show-current']) === t.branch, 'wrong/inactive task branch');
  assert(git(root,['remote','get-url','origin']) === p.repository, 'unconfirmed repository origin');
  const before = log.events.length ? manifest(root) : manifest(root,t.base_commit);
  const e = append(log,{type:'begin',role,phase,task_definition:structuredClone(t),repository:p.repository,branch:t.branch,base_commit:t.base_commit,feature_ids:t.feature_ids,source_head:git(root,['rev-parse','HEAD']),before,contract_sha256:contractHash(t,before)});
  permitted(p,t,phase,role,changes(before,manifest(root))); return {log,event:e};
}
export function finish(root,t,role,details) {
  assert(t.status === 'in_progress' && git(root,['branch','--show-current']) === t.branch, 'finish requires active task branch');
  const p = readPolicy(root), log = readLog(root,t), state = validateLog(root,t,p,log);
  assert(state.active?.role === role, 'finish requires active phase owner');
  const a = state.active, after = manifest(root), {report,build_report,...d} = details;
  const evidence = report ? readEvidence(root,load(root),report) : null;
  const build_evidence = build_report ? JSON.parse(fs.readFileSync(build_report,'utf8')) : evidence?.report.builds || null;
  const next_phase = d.result === 'blocked' && a.phase !== 'documentation_delivery' ? 'planning' : a.phase === 'planning' ? (t.mode === 'docs' ? 'documentation_delivery' : 'implementation') : codePhases.includes(a.phase) ? 'documentation_delivery' : details.next_phase || 'wait';
  delete d.next_phase;
  const e = append(log,{type:'handoff',role,phase:a.phase,task_definition:structuredClone(t),begin:a.id,source_head:a.source_head,before:a.before,after,changes:changes(a.before,after),contract_sha256:contractHash(t,after),acceptance_ids:dataForTask(root,t).acceptance_ids,acceptance_definitions:load(root).features.filter(f=>t.feature_ids.includes(f.id)).flatMap(f=>f.acceptance),next_phase,receiver:['planning','documentation_delivery'].includes(next_phase) ? 'antigravity' : 'pi-desktop',details:d,check_definitions:load(root).checks,evidence,build_evidence});
  validateLog(root,t,p,log); return {log,event:e};
}
export function receive(root,t,role,id,digest,decision = 'accept',reason = '用户转交后显式核验准确交接 ID、摘要和当前快照。') {
  assert(t.status === 'in_progress' && git(root,['branch','--show-current']) === t.branch, 'receive requires active task branch');
  const p = readPolicy(root), log = readLog(root,t), state = validateLog(root,t,p,log), h = log.events.at(-1);
  assert(!state.active && ['handoff','delivery'].includes(h?.type) && h.id === id && h.digest === digest, 'wrong/out-of-order handoff ID/digest');
  const e = append(log,{type:'receipt',role,handoff:id,handoff_digest:digest,decision,reason,snapshot_sha256:hash(JSON.stringify(manifest(root)))});
  validateLog(root,t,p,log); return {log,event:e};
}
export function saveLog(root,t,log) {
  const filename = path.join(root,recordPath(t)); fs.mkdirSync(path.dirname(filename),{recursive:true});
  // Atomic replacement. No concurrent writers are supported; prefix validation detects history edits.
  const temp = filename+'.tmp'; assert(!fs.existsSync(temp), 'concurrent/stale handoff write');
  fs.writeFileSync(temp,JSON.stringify(log,null,2)+'\n',{flag:'wx'});
  fs.renameSync(temp,filename);
}
export function prompt(t,e) {
  assert(['handoff','delivery'].includes(e.type), 'only finished handoff/delivery can generate prompt');
  const common = `交接事件：${e.id}\nSHA256：${e.digest}\n任务：${t.id}；分支：${t.branch}；基线：${t.base_commit}\n记录：${recordPath(t)}\n由用户手动转交；生成此 prompt 不等于已转交或已接受。角色声明不是工具身份认证。\n`;
  if (e.type === 'delivery') return `请交给 PI-Desktop：\n${common}Antigravity 已记录实际交付：commit ${e.commit}；PR ${e.pr_url}；CI ${e.ci.status}（${e.ci.reason}），${e.ci.url || '未配置'}。\n下一步：\n${e.next_actions.map(s=>'- '+s).join('\n')}\n禁止自行合并、发布或启动新功能。若无明确 rework 交接，等待用户授权，不开始开发。\n`;
  const d = e.details, roleText = e.receiver === 'antigravity' ? '负责规划、各类文档、提交信息、暂存、commit/push/PR 和 CI；不自行修复源码/构建。' : '负责授权代码、测试、构建和编译；不修改规范/台账，不 commit/push/PR。';
  const evidence = e.evidence?.report;
  return `请交给 ${e.receiver === 'antigravity' ? 'Antigravity' : 'PI-Desktop'}：\n${common}发送方：${e.role}；阶段：${e.phase}；结果：${d.result}；后续阶段：${e.next_phase}\n接收方职责：${roleText}\n先读取 AGENTS.md、docs/COLLABORATION_WORKFLOW.md 及需求/安全/Git/验收规范，核对工作区。\n显式接收命令：\nnode scripts/governance/handoff.mjs accept --task ${t.id} --role ${e.receiver} --handoff ${e.id} --digest ${e.digest}\n目标：${d.goal}\n授权：${t.authorization}\n功能：${t.feature_ids.join(', ')}；验收：${e.acceptance_ids.join(', ')}\n规划/标准摘要：${e.contract_sha256}\n开发快照：${evidence?.development_sha256 || 'planning 尚无开发结果'}；源 HEAD：${e.source_head}\n实际结果：${d.outcome}\n变更文件：\n${e.changes.length ? e.changes.map(c=>`- ${c.action} ${c.path} ${c.after || c.before}`).join('\n') : '- 无文件变化'}\n实际检查：\n${evidence ? evidence.checks.map(c=>`- ${c.command} ${c.args.join(' ')}；exit=${c.exit_code}；tests/pass=${c.counts.tests}/${c.counts.pass}；fail/skipped/cancelled/todo=${c.counts.fail}/${c.counts.skipped}/${c.counts.cancelled}/${c.counts.todo}`).join('\n') : '- planning：未执行开发检查，不宣称通过'}\n构建/编译：${d.build.status}；${d.build.reason}\n文档同步请求：\n${d.documentation_requests.length ? d.documentation_requests.map(s=>'- '+s).join('\n') : '- 无新增请求'}\n下一步：\n${d.next_actions.map(s=>'- '+s).join('\n')}\n禁止事项：\n${d.forbidden.map(s=>'- '+s).join('\n')}\n限制：\n${d.limitations.map(s=>'- '+s).join('\n')}\n阻塞：\n${d.blockers.length ? d.blockers.map(s=>'- '+s).join('\n') : '- 无；未执行项不因此变成通过'}\n阶段完成后使用 handoff finish/prompt（Git 交付后 record-delivery）生成下一步 prompt，由用户转交；不要自动发送或自动开始未授权任务。\n`;
}

// Future application build/compile checks are registered by Antigravity; no arbitrary shell strings.
export function validateBuildDefinitions(t) {
  const list = t.build_checks || [];
  assert(Array.isArray(list) && new Set(list.map(b=>b.id)).size === list.length, 'invalid build definitions');
  for (const b of list) assert(/^[\w-]+$/.test(b.id) && ['build','compile'].includes(b.kind) && b.command === 'node' && Array.isArray(b.args) && b.args.length && safePath(b.args[0]) && b.args[0].startsWith('mysql-mcp/') && b.args.every(s=>typeof s === 'string' && !s.includes('\0')) && Number.isInteger(b.timeout_ms) && b.timeout_ms > 0 && b.timeout_ms <= 300000, 'unsafe build/compile command definition');
  if (list.length) assert(list.some(b=>b.kind === 'build') && list.some(b=>b.kind === 'compile'), 'register both build and compile checks');
  return list;
}
export function runBuilds(root,t) {
  const p = readPolicy(root), before = developmentHash(root,t,p), checks = validateBuildDefinitions(t);
  const report = {schema_version:1,trust:'local-diagnostic-only',task_id:t.id,development_sha256:before,checks:[]};
  for (const c of checks) {
    regular(root,c.args[0]);
    const env = {...process.env}; for (const k of Object.keys(env)) if (/^(GIT_|GOV_|GITHUB_|NODE_TEST_)/.test(k) || k === 'NODE_OPTIONS') delete env[k];
    const start = new Date().toISOString(), r = spawnSync(process.execPath,c.args,{cwd:root,env,encoding:'utf8',timeout:c.timeout_ms,maxBuffer:16*1024*1024});
    report.checks.push({id:c.id,definition_sha256:hash(JSON.stringify(c)),started_at:start,ended_at:new Date().toISOString(),exit_code:r.status,signal:r.signal,timed_out:r.error?.code === 'ETIMEDOUT',error:r.error?.message || null,stdout:r.stdout || '',stderr:r.stderr || ''});
  }
  assert(developmentHash(root,t,p) === before, 'build mutated source inputs');
  verifyBuilds(t,report,before); return report;
}
function verifyBuilds(t,r,expected) {
  const defs = validateBuildDefinitions(t);
  assert(r?.schema_version === 1 && r.trust === 'local-diagnostic-only' && r.task_id === t.id && r.development_sha256 === expected && Array.isArray(r.checks) && r.checks.length === defs.length, 'stale/missing build evidence');
  for (const c of defs) {
    const matches = r.checks.filter(v=>v.id === c.id), v = matches[0];
    assert(matches.length === 1 && v.definition_sha256 === hash(JSON.stringify(c)) && v.started_at && v.ended_at && v.exit_code === 0 && v.signal === null && v.error === null && v.timed_out === false && typeof v.stdout === 'string' && typeof v.stderr === 'string', 'failed/timed-out/malformed build execution');
  }
}
