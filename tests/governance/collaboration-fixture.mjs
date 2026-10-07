import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { after } from 'node:test';
import { hash, statusMarkdown } from '../../scripts/governance/lib/core.mjs';
import { begin, finish, receive, saveLog, readLog, readPolicy, validateLog } from '../../scripts/governance/lib/collaboration.mjs';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const env = {...process.env};
for (const k of Object.keys(env)) if (/^(GIT_|GOV_|GITHUB_|NODE_TEST_)/.test(k) || k === 'NODE_OPTIONS') delete env[k];
let baseline;
// Reuse only immutable setup, never a working repository or execution evidence.
// cpSync copies .git as well: refs, index, objects and config remain test-local.
after(() => { if (baseline) fs.rmSync(baseline.root,{recursive:true,force:true}); });
function baselineRepository() {
  if (baseline) return baseline;
  const root = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(),'collab-baseline-'));
  const write = (n,content) => { fs.mkdirSync(path.dirname(path.join(root,n)),{recursive:true}); fs.writeFileSync(path.join(root,n),content); };
  const git = (...args) => { const r = spawnSync('git',['-C',root,...args],{env,encoding:'utf8',timeout:120000}); assert.equal(r.status,0,r.stdout+r.stderr); return r.stdout.trim(); };
  try {
    git('init','-b','main'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid'); git('config','core.autocrlf','false');
    git('config','core.filemode','false');
    write('.gitignore','.governance-evidence/\n');
    fs.cpSync(path.join(source,'scripts/governance'),path.join(root,'scripts/governance'),{recursive:true});
    fs.cpSync(path.join(source,'.githooks'),path.join(root,'.githooks'),{recursive:true});
    write('docs/REQUIREMENTS.md','| R01 | Synthetic collaboration |\n');
    write('docs/ACCEPTANCE.md','# Immutable acceptance\n'); write('docs/PROJECT_CONSTRAINTS.md','# Safety\n');
    write('docs/plans/test.md','# Approved synthetic scope\n');
    write('mysql-mcp/web/index.html','<!doctype html><title>Synthetic fixture</title>\n');
    write('mysql-mcp/tests/web/ui.mjs','export const synthetic = true;\n');
    write('mysql-mcp/src/existing.mjs','export const backend = true;\n');
    write('tests/governance/example.test.mjs',"import test from 'node:test';import assert from 'node:assert/strict';test('explicit assertion',()=>assert.equal(1,1));\n");
    git('add','.'); git('commit','-m','fixture: pre-policy baseline');
    baseline = {root,base:git('rev-parse','HEAD')};
    return baseline;
  } catch (e) { fs.rmSync(root,{recursive:true,force:true}); throw e; }
}
export function fixture(t,mode = 'code') {
  const root = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(),'collab-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write = (n,content) => { fs.mkdirSync(path.dirname(path.join(root,n)),{recursive:true}); fs.writeFileSync(path.join(root,n),content); };
  const shell = (args,extra = {}) => spawnSync('git',['-C',root,...args],{env:{...env,...extra},encoding:'utf8',timeout:120000});
  const git = (...args) => { const r = shell(args); assert.equal(r.status,0,r.stdout+r.stderr); return r.stdout.trim(); };
  const seed = baselineRepository();
  fs.cpSync(seed.root,root,{recursive:true});
  const base = seed.base;
  const policy = JSON.parse(fs.readFileSync(path.join(source,'governance/collaboration.json'),'utf8'));
  policy.enabled_base = base; delete policy.bootstrap;
  // Inherit the production role paths unchanged so regressions cannot be masked by fixture overrides.
  const task = {id:'TASK',kind:'maintenance',status:'in_progress',feature_ids:['G03'],branch:'chore/test',base_commit:base,authorization:'Explicit synthetic authorization; no real database.',allowed_paths:['docs/','governance/','mysql-mcp/','scripts/','tests/','.githooks/','outside.bin'],plan_path:'docs/plans/test.md',mode,pr:null,scope_changes:[],governance_change:true};
  const data = {
    tasks:[task], features:[{id:'G03',key:'collaboration',title:'Collaboration',kind:'engineering',requirements:['R01'],behavior:'Explicit collaboration gates',dependencies:[],implementation_paths:[],test_paths:[],task_ids:['TASK'],implementation:'planned',acceptance:[{id:'G03-A1',description:'Synthetic stage checks',evidence_types:['automated'],check_ids:['unit']}],evidence:[]}],
    checks:[{id:'unit',command:'node',args:['--test','--test-reporter=tap','tests/governance/example.test.mjs'],parser:'tap',timeout_ms:10000,feature_ids:['G03'],acceptance_ids:['G03-A1']}]
  };
  const save = () => { for (const k of ['tasks','features','checks']) write(`governance/${k}.json`,JSON.stringify({schema_version:1,[k]:data[k]},null,2)+'\n'); write('governance/collaboration.json',JSON.stringify(policy,null,2)+'\n'); write('docs/FEATURE_STATUS.md',statusMarkdown(data)); };
  save();git('switch','-c',task.branch);git('update-ref','refs/remotes/origin/main',base);git('remote','add','origin',policy.repository);
  const cli = (name,args = [],input,extra = {}) => spawnSync(process.execPath,[path.join(root,`scripts/governance/${name}.mjs`),...args],{cwd:root,env:{...env,...extra},encoding:'utf8',input,timeout:120000});
  const persist = r => {saveLog(root,task,r.log);return r.event;};
  const start = (role,phase) => persist(begin(root,task,role,phase));
  const details = extras => ({goal:'Complete the authorized synthetic scope.',outcome:'Actual synthetic changes and checks recorded.',next_actions:['Validate and perform only the next authorized phase.'],forbidden:['No automatic merge, database access or unrelated changes.'],documentation_requests:[],limitations:['Local diagnostics do not authenticate a human or agent identity.'],blockers:[],result:'ready',build:{status:'not_applicable',reason:'This fixture has only directly executed mjs; no application compilation.',check_ids:[]},verification:data.checks.map(c=>({check_id:c.id,reason:'Actual registered execution with original TAP.'})),...extras});
  const end = (role,extras = {}) => persist(finish(root,task,role,details(extras)));
  const accept = (event,role = event.receiver) => persist(receive(root,task,role,event.id,event.digest));
  const run = () => { const r = cli('run'); assert.equal(r.status,0,r.stdout+r.stderr); return path.join(root,'.governance-evidence/run.json'); };
  const planning = () => {start('antigravity','planning');const e = end('antigravity');accept(e);return e;};
  const implementation = () => {planning();const role = mode === 'frontend' ? 'antigravity' : 'pi-desktop';start(role,'implementation');write(mode === 'frontend' ? 'mysql-mcp/web/value.mjs' : 'mysql-mcp/src/value.mjs','export const value = 1;\n');const e = end(role,{report:run()});accept(e);return e;};
  const candidate = () => { if(mode === 'docs')planning();else implementation();start('antigravity','documentation_delivery');write('docs/result.md','# Actual synthetic results\n');return end('antigravity',{report:run(),commit_message:'chore(collaboration): synthetic delivery'}); };
  return {root,write,git,shell,base,policy,task,data,save,cli,persist,start,end,accept,details,run,planning,implementation,candidate};
}
export function failed(r,re) {assert.notEqual(r.status,0,r.stdout+r.stderr);assert.match(r.stdout+r.stderr,re);}
export function check(f,options = {}) {return validateLog(f.root,f.task,readPolicy(f.root),readLog(f.root,f.task),options);}
export function rehash(log) {let previous = null;const digests=new Map();for(const e of log.events){e.previous=previous;if(e.type==='receipt')e.handoff_digest=digests.get(e.handoff);const {digest,...body}=e;e.digest=hash(JSON.stringify(body));previous=e.digest;digests.set(e.id,e.digest);}return log;}
export function mutateLog(f,fn) {const log=readLog(f.root,f.task);fn(log);saveLog(f.root,f.task,rehash(log));}
