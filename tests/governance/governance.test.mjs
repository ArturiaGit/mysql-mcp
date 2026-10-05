import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { statusMarkdown, inputHash, snapshot } from '../../scripts/governance/lib/core.mjs';
import { execute } from '../../scripts/governance/lib/execute.mjs';
import { selectMainTask } from '../../scripts/governance/lib/scope.mjs';
import './dependencies.test.mjs';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const env = {...process.env};
for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k.startsWith('GOV_') || k.startsWith('NODE_TEST_') || k.startsWith('GITHUB_')) delete env[k];
let baseline;
after(() => { if (baseline) fs.rmSync(baseline.root,{recursive:true,force:true}); });
function baselineRepository() {
  if (baseline) return baseline;
  const root = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(),'gov-baseline-'));
  const write = (p,s) => { fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true}); fs.writeFileSync(path.join(root,p),s); };
  const git = (...args) => { const r=spawnSync('git',['-C',root,...args],{env,encoding:'utf8'}); assert.equal(r.status,0,r.stderr); return r.stdout.trim(); };
  try {
    git('init','-b','docs/test'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid'); git('config','core.autocrlf','false');
    write('.gitignore','.governance-evidence/\n'); git('add','.'); git('commit','-m','baseline');
    const base = git('rev-parse','HEAD');
    fs.cpSync(path.join(source,'scripts/governance'),path.join(root,'scripts/governance'),{recursive:true});
  write('docs/REQUIREMENTS.md','| R01 | fixture requirement |\n');
  write('tests/example.test.mjs',"import test from 'node:test'; test('real execution',()=>{});\n");
  const data = {
    features:[{id:'G01',key:'governance',title:'Governance',kind:'engineering',requirements:['R01'],behavior:'Enforce gates',dependencies:[],implementation_paths:[],test_paths:[],task_ids:['TASK'],implementation:'planned',acceptance:[{id:'G01-A1',description:'Runs tests',evidence_types:['automated'],check_ids:['unit']}],evidence:[]}],
    tasks:[{id:'TASK',kind:'maintenance',status:'in_progress',feature_ids:['G01'],branch:'docs/test',base_commit:base,authorization:'fixture authorization',allowed_paths:['scripts/','tests/','docs/','governance/'],pr:1,scope_changes:[],governance_change:true}],
    checks:[{id:'unit',command:'node',args:['--test','--test-reporter=tap','tests/example.test.mjs'],timeout_ms:10000,parser:'tap',feature_ids:['G01'],acceptance_ids:['G01-A1']}]
  };
    for (const k of ['features','tasks','checks']) write(`governance/${k}.json`,JSON.stringify({schema_version:1,[k]:data[k]},null,2)+'\n');
    write('docs/FEATURE_STATUS.md',statusMarkdown(data)); git('add','.');
    baseline = {root,base,data}; return baseline;
  } catch (e) { fs.rmSync(root,{recursive:true,force:true}); throw e; }
}
function fixture(t) {
  const seed = baselineRepository(), root = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(),'gov-test-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  // Copy immutable setup, including independent refs/index/config/objects, never run evidence.
  fs.cpSync(seed.root,root,{recursive:true});
  const base = seed.base, data = structuredClone(seed.data);
  const write = (p,s) => { fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true}); fs.writeFileSync(path.join(root,p),s); };
  const git = (...args) => { const r=spawnSync('git',['-C',root,...args],{env,encoding:'utf8'}); assert.equal(r.status,0,r.stderr); return r.stdout.trim(); };
  const save = () => { for (const k of ['features','tasks','checks']) write(`governance/${k}.json`,JSON.stringify({schema_version:1,[k]:data[k]},null,2)+'\n'); write('docs/FEATURE_STATUS.md',statusMarkdown(data)); };
  const cli = (script='check',args=[],input,extraEnv={}) => spawnSync(process.execPath,[path.join(root,`scripts/governance/${script}.mjs`),...args],{cwd:root,env:{...env,...extraEnv},encoding:'utf8',input,timeout:120000});
  return {root,write,git,base,data,save,cli};
}
const failure = (r,re) => { assert.notEqual(r.status,0); assert.match(r.stdout+r.stderr,re); };
test('valid planned feature and deterministic report',t=>{const f=fixture(t);assert.equal(f.cli().status,0);assert.equal(f.cli('report',['--check']).status,0);});
for (const [name,mutate,re] of [
  ['duplicate feature ID',d=>d.features.push({...d.features[0]}),/duplicate.*feature ID/],
  ['duplicate normalized key',d=>d.features.push({...d.features[0],id:'G02',key:' GOVERNANCE '}),/duplicate.*feature key/],
  ['duplicate acceptance ID',d=>d.features[0].acceptance.push({...d.features[0].acceptance[0]}),/duplicate.*acceptance/],
  ['duplicate task ID',d=>d.tasks.push({...d.tasks[0]}),/duplicate.*task ID/],
  ['undefined requirement',d=>d.features[0].requirements=['R99'],/undefined requirement/],
  ['missing dependency',d=>d.features[0].dependencies=['absent'],/missing dependency/],
  ['dependency cycle',d=>d.features[0].dependencies=['G01'],/dependency cycle/],
  ['unknown status',d=>d.features[0].implementation='done',/unknown implementation/],
  ['path traversal',d=>d.features[0].implementation_paths=['../outside'],/unsafe path/],
  ['missing implementation',d=>d.features[0].implementation='implemented',/missing implementation_paths/],
  ['forged passed evidence',d=>d.features[0].evidence=[{passed:true}],/authentication unavailable/],
  ['mock masquerading as real mysql',d=>{d.features[0].acceptance[0].evidence_types=['real_mysql'];d.features[0].evidence=[{type:'real_mysql',passed:true,mock:true}];},/authentication unavailable/],
  ['manual acceptance claim',d=>d.features[0].acceptance[0].passed=true,/unauthenticated acceptance/],
  ['feature completion claim',d=>d.features[0].completed=true,/unauthenticated completion/],
  ['unapproved governance modification',d=>d.tasks[0].governance_change=false,/governance_change required/],
  ['scope violation',d=>d.tasks[0].allowed_paths=['docs/'],/out of task scope/],
  ['shell command',d=>d.checks[0].command='sh',/command\/parser not allowed/],
  ['node eval injection',d=>d.checks[0].args=['-e','process.exit(0)'],/args not allowed/],
  ['task collision',d=>{d.tasks[0].kind='new';d.tasks.push({...d.tasks[0],id:'OTHER'});d.features[0].task_ids.push('OTHER');},/active new task collision/]
]) test(name,t=>{const f=fixture(t);mutate(f.data);f.save();failure(f.cli(),re);});
test('uncovered confirmed requirement',t=>{const f=fixture(t);f.write('docs/REQUIREMENTS.md','| R01 | a |\n| R02 | b |\n');failure(f.cli(),/uncovered requirement/);});
test('checked roadmap cannot grant completion',t=>{const f=fixture(t);f.write('docs/ROADMAP.md','- [x] completed\n');failure(f.cli(),/checked roadmap/);});
test('tracked confidential path',t=>{const f=fixture(t);f.write('.pi/private.md','private fixture');f.git('add','-f','.pi/private.md');failure(f.cli(),/confidential tracked path/);});
test('staged invalid record cannot be masked by unstaged repair',t=>{const f=fixture(t);f.data.features[0].requirements=['R99'];f.save();f.git('add','.');f.data.features[0].requirements=['R01'];f.save();assert.equal(f.cli().status,0);failure(f.cli('check',['--staged']),/undefined requirement/);});
test('staged checker, not unstaged checker, is executed',t=>{const f=fixture(t);f.write('scripts/governance/check.mjs',"console.error('STAGED_CHECKER_SENTINEL');process.exit(1);\n");f.git('add','scripts/governance/check.mjs');fs.copyFileSync(path.join(source,'scripts/governance/check.mjs'),path.join(f.root,'scripts/governance/check.mjs'));failure(f.cli('check',['--staged']),/STAGED_CHECKER_SENTINEL/);});
test('valid staged snapshot executes registered tests',t=>{const f=fixture(t);const r=f.cli('check',['--staged']);assert.equal(r.status,0,r.stdout+r.stderr);});
test('main staged commit rejected',t=>{const f=fixture(t);f.git('checkout','-b','main');failure(f.cli('check',['--staged']),/not main/);});
for (const [name,make,re] of [
  ['remote branch mismatch',(f,h)=>`refs/heads/docs/test ${h} refs/heads/other ${'0'.repeat(40)}`,/ref mismatch/],
  ['main push',(f,h)=>`refs/heads/main ${h} refs/heads/main ${'0'.repeat(40)}`,/protected branch/],
  ['delete push',()=>`(delete) ${'0'.repeat(40)} refs/heads/docs/test ${'1'.repeat(40)}`,/deletion denied/],
  ['oid mismatch',(f)=>`refs/heads/docs/test ${f.base} refs/heads/docs/test ${'0'.repeat(40)}`,/OID does not match/],
  ['unknown commit',()=>`refs/heads/docs/test ${'1'.repeat(40)} refs/heads/docs/test ${'0'.repeat(40)}`,/git cat-file failed/]
]) test(name,t=>{const f=fixture(t);f.git('commit','-m','fixture');const h=f.git('rev-parse','HEAD');failure(f.cli('check',['--pre-push'],make(f,h)+'\n'),re);});
test('push validates object rather than repaired worktree',t=>{const f=fixture(t);f.data.features[0].requirements=['R99'];f.save();f.git('add','.');f.git('commit','-m','invalid object');const h=f.git('rev-parse','HEAD');f.data.features[0].requirements=['R01'];f.save();failure(f.cli('check',['--pre-push'],`refs/heads/docs/test ${h} refs/heads/docs/test ${'0'.repeat(40)}\n`),/undefined requirement/);});
test('valid actual push object',t=>{const f=fixture(t);f.git('commit','-m','fixture');const h=f.git('rev-parse','HEAD');const r=f.cli('check',['--pre-push'],`refs/heads/docs/test ${h} refs/heads/docs/test ${'0'.repeat(40)}\n`);assert.equal(r.status,0,r.stdout+r.stderr);});
for (const [name,code,timeout] of [
  ['failure',"import test from 'node:test';test('bad',()=>{throw Error('bad')});",10000],
  ['skipped',"import test from 'node:test';test.skip('skipped',()=>{});",10000],
  ['zero tests','',10000],
  ['timeout',"import test from 'node:test';test('hang',async()=>{await new Promise(r=>setTimeout(r,10000))});",100]
]) test(`actual execution rejects ${name}`,t=>{const f=fixture(t);f.write('tests/example.test.mjs',code);const r=execute(f.root,{...f.data.checks[0],timeout_ms:timeout},path.join(f.root,'.governance-evidence'));assert.equal(r.local_result,'failed');if(name==='timeout')assert.equal(r.timed_out,true);});
test('run report verifies artifacts, detects tampering and stale inputs',t=>{const f=fixture(t);const r=f.cli('run');assert.equal(r.status,0,r.stdout+r.stderr);const args=['--run','.governance-evidence/run.json'];assert.equal(f.cli('report',args).status,0);f.write('.governance-evidence/unit.tap','tampered');failure(f.cli('report',args),/hash mismatch/);const again=f.cli('run');assert.equal(again.status,0,again.stderr);f.write('tests/example.test.mjs','// changed\n');failure(f.cli('report',args),/stale/);});
test('input digest changes with source content',t=>{const f=fixture(t);const before=inputHash(f.root);f.write('tests/example.test.mjs','changed');assert.notEqual(inputHash(f.root),before);});
test('deleted criterion requires explicit authorized scope record',t=>{const f=fixture(t);f.data.features[0].acceptance.push({id:'OLD',description:'old',evidence_types:['manual'],check_ids:[]});f.save();f.git('add','.');f.git('commit','-m','old criterion');f.data.features[0].acceptance.pop();f.save();failure(f.cli(),/scope_changes removal: OLD/);f.data.tasks[0].scope_changes=[{id:'OLD',action:'remove',reason:'approved revision',authorization:'fixture permission'}];f.save();assert.equal(f.cli().status,0);});
test('hook installer refuses existing hooksPath without modification',t=>{const f=fixture(t);f.git('config','core.hooksPath','custom-hooks');failure(f.cli('install-hooks'),/existing hooksPath retained/);assert.equal(f.git('config','--get','core.hooksPath'),'custom-hooks');});
test('CI compares actual base/head scope despite clean checkout',t=>{const f=fixture(t);f.write('outside.txt','unauthorized');f.git('add','.');f.git('commit','-m','outside scope');const h=f.git('rev-parse','HEAD');failure(f.cli('check',['--base',f.base,'--head',h,'--branch','docs/test']),/out of task scope: outside.txt/);});
test('push wrong task branch rejected even with matching refs',t=>{const f=fixture(t);f.git('commit','-m','fixture');f.git('checkout','-b','docs/wrong');const h=f.git('rev-parse','HEAD');failure(f.cli('check',['--pre-push'],`refs/heads/docs/wrong ${h} refs/heads/docs/wrong ${'0'.repeat(40)}\n`),/active task for branch/);});
test('implemented feature paths must exist and be tracked',t=>{const f=fixture(t);f.data.features[0].implementation='implemented';f.data.features[0].implementation_paths=['scripts/governance/'];f.data.features[0].test_paths=['tests/missing.test.mjs'];f.save();failure(f.cli(),/missing implementation\/test path/);f.write('tests/missing.test.mjs','export {};');failure(f.cli(),/untracked implementation\/test path/);});
test('mutable base cannot hide committed out-of-scope path from origin main',t=>{const f=fixture(t);f.git('update-ref','refs/remotes/origin/main',f.base);f.write('outside.txt','not allowed');f.git('add','.');f.git('commit','-m','unauthorized');f.data.tasks[0].base_commit=f.git('rev-parse','HEAD');f.save();failure(f.cli(),/unauthorized task base|beyond verified/);f.data.tasks[0].base_commit=f.base;f.save();failure(f.cli(),/out of task scope: outside.txt/);});
test('HEAD task baseline cannot be advanced without remote',t=>{const f=fixture(t);f.git('commit','-m','registry');f.data.tasks[0].base_commit=f.git('rev-parse','HEAD');f.save();failure(f.cli(),/unauthorized task base/);});
test('nonancestor task base rejected',t=>{const f=fixture(t);f.git('commit','-m','registry');const head=f.git('rev-parse','HEAD');f.git('checkout','-b','docs/side',f.base);f.write('side.txt','side');f.git('add','.');f.git('commit','-m','side');const side=f.git('rev-parse','HEAD');f.git('checkout','docs/test');assert.equal(f.git('rev-parse','HEAD'),head);f.data.tasks[0].base_commit=side;f.save();failure(f.cli(),/not an ancestor/);});
for (const mode of ['local','staged','CI']) test(`existing feature scope checked against trusted registry: ${mode}`,t=>{const f=fixture(t);f.data.features.push({...structuredClone(f.data.features[0]),id:'P01',key:'product',task_ids:[],acceptance:[{id:'P01-A1',description:'manual',evidence_types:['manual'],check_ids:[]}]});f.save();f.git('add','.');f.git('commit','-m','bootstrap registry');const base=f.git('rev-parse','HEAD');f.data.features[1].behavior='unauthorized product change';f.save();if(mode==='local')failure(f.cli(),/feature outside selected task scope: P01/);else {f.git('add','.');if(mode==='staged')failure(f.cli('check',['--staged']),/feature outside selected task scope: P01/);else {f.git('commit','-m','outside feature');failure(f.cli('check',['--base',base,'--head',f.git('rev-parse','HEAD'),'--branch','docs/test']),/feature outside selected task scope: P01/);}}});
test('explicit feature scope authorization permits reviewed change',t=>{const f=fixture(t);f.data.features.push({...structuredClone(f.data.features[0]),id:'P01',key:'product',task_ids:[],acceptance:[{id:'P01-A1',description:'manual',evidence_types:['manual'],check_ids:[]}]});f.save();f.git('add','.');f.git('commit','-m','registry');f.data.features[1].acceptance[0].description='approved revision';f.data.tasks[0].scope_changes=[{id:'P01',action:'modify',reason:'approved expansion',authorization:'explicit fixture approval'}];f.save();assert.equal(f.cli().status,0);});
test('main CI selects completed delta task despite unrelated active branches; no push permission',t=>{const f=fixture(t);f.data.tasks.push({...structuredClone(f.data.tasks[0]),id:'OTHER',branch:'docs/other',allowed_paths:['other/']});f.data.features[0].task_ids.push('OTHER');f.save();f.git('add','.');f.git('commit','-m','two tasks');const base=f.git('rev-parse','HEAD');f.data.tasks[0].status='completed';f.data.features[0].behavior='merged governance change';f.save();f.git('add','.');f.git('commit','-m','merge delta');const head=f.git('rev-parse','HEAD');const args=['--base',base,'--head',head,'--ci-main'];failure(f.cli('run',args),/main CI context/);const r=f.cli('run',args,undefined,{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main'});assert.equal(r.status,0,r.stdout+r.stderr);const report=JSON.parse(fs.readFileSync(path.join(f.root,'.governance-evidence/run.json')));assert.equal(report.task_id,'TASK');assert.equal(report.task_completion,'unauthenticated');assert.equal(report.acceptance,'unverified');failure(f.cli('check',['--pre-push'],`refs/heads/docs/test ${head} refs/heads/docs/test ${'0'.repeat(40)}\n`),/active task for branch/);});
test('report requires exact artifacts and execution metadata, never just passed',t=>{const f=fixture(t);const r=f.cli('run');assert.equal(r.status,0,r.stdout+r.stderr);const file=path.join(f.root,'.governance-evidence/run.json'),original=JSON.parse(fs.readFileSync(file));const mutations=[
  [r=>r.checks[0].artifacts=[r.checks[0].artifacts[1],r.checks[0].artifacts[1]],/artifacts/],
  [r=>r.checks[0].artifacts[0].path='other.log',/artifacts/],
  [r=>r.local_result='failed',/overall local execution failed/],
  [r=>r.error='failure',/overall local execution failed/],
  [r=>r.checks[0].signal='SIGTERM',/invalid\/failed local/],
  [r=>delete r.checks[0].timed_out,/invalid\/failed local/],
  [r=>r.checks[0].exit_code=1,/invalid\/failed local/],
  [r=>r.checks[0].error='failed',/invalid\/failed local/],
  [r=>r.checks[0].counts.tests=900,/TAP metadata mismatch/],
  [r=>r.checks.push(structuredClone(r.checks[0])),/check set mismatch/],
  [r=>r.checks[0].feature_ids=['P99'],/invalid\/failed local/],
  [r=>r.checks[0].check_id='unknown',/check set mismatch/]
];for(const [mutate,re] of mutations){const report=structuredClone(original);mutate(report);fs.writeFileSync(file,JSON.stringify(report));failure(f.cli('report',['--run',file]),re);}fs.writeFileSync(file,JSON.stringify(original));assert.equal(f.cli('report',['--run',file]).status,0);});
test('registered tests do not inherit parent GitHub CI context',t=>{
  const f=fixture(t), keys=['GITHUB_ACTIONS','GITHUB_EVENT_NAME','GITHUB_REF'];
  const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  t.after(()=>{for(const k of keys)if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];});
  process.env.GITHUB_ACTIONS='true';process.env.GITHUB_EVENT_NAME='push';process.env.GITHUB_REF='refs/heads/main';
  f.write('tests/example.test.mjs',"import test from 'node:test';import assert from 'node:assert/strict';test('isolated context',()=>{for(const k of ['GITHUB_ACTIONS','GITHUB_EVENT_NAME','GITHUB_REF'])assert.equal(process.env[k],undefined);});");
  const r=execute(f.root,f.data.checks[0],path.join(f.root,'.governance-evidence'));
  assert.equal(r.local_result,'passed',r.error);assert.equal(r.counts.tests,1);
});
for(const mode of ['shared-feature','multiple-delta','out-of-scope']) test(`main task delta selection: ${mode}`,t=>{
  const f=fixture(t);f.git('commit','-m','historical task');const base=f.git('rev-parse','HEAD');
  f.data.tasks.push({...structuredClone(f.data.tasks[0]),id:'NEW',kind:'fix',branch:'fix/new',base_commit:base});
  f.data.features[0].task_ids.push('NEW');f.data.features[0].behavior='new repair';
  if(mode==='multiple-delta')f.data.tasks[0].authorization+=' changed';
  if(mode==='out-of-scope')f.data.tasks[1].allowed_paths=['docs/'];
  f.save();f.git('add','.');f.git('commit','-m','repair delta');const head=f.git('rev-parse','HEAD');
  if(mode==='shared-feature')assert.equal(selectMainTask(f.root,base,head).id,'NEW');
  else assert.throws(()=>selectMainTask(f.root,base,head),/exactly one associated task/);
});
for(const mode of ['pr-backfill','allowed_paths','base_commit','authorization','status','feature_ids','extra-field','new-noncandidate','multiple-candidates','no-changed-candidate']) test(`main historical metadata selection: ${mode}`,t=>{
  const f=fixture(t);
  f.data.tasks[0].allowed_paths=['governance/','docs/history/'];f.data.tasks[0].pr=null;
  f.save();f.git('add','.');f.git('commit','-m','historical narrow task');const base=f.git('rev-parse','HEAD');
  const current={...structuredClone(f.data.tasks[0]),id:'NEW',kind:'fix',branch:'fix/new',base_commit:base,allowed_paths:['governance/','docs/','scripts/','tests/']};
  if(mode==='no-changed-candidate') {
    f.data.tasks.push(current);f.save();f.git('add','.');f.git('commit','-m','existing current task');
  }
  const comparisonBase=f.git('rev-parse','HEAD');
  if(mode!=='no-changed-candidate')f.data.tasks.push(current);
  f.data.tasks[0].pr=4;
  if(mode==='allowed_paths')f.data.tasks[0].allowed_paths.push('other/');
  if(mode==='base_commit')f.data.tasks[0].base_commit=base;
  if(mode==='authorization')f.data.tasks[0].authorization+=' changed';
  if(mode==='status')f.data.tasks[0].status='completed';
  if(mode==='feature_ids')f.data.tasks[0].feature_ids=[];
  if(mode==='extra-field')f.data.tasks[0].unexpected=true;
  if(mode==='new-noncandidate')f.data.tasks.push({...structuredClone(f.data.tasks[0]),id:'OTHER',branch:'fix/other'});
  if(mode==='multiple-candidates')f.data.tasks.push({...structuredClone(current),id:'OTHER',branch:'fix/other'});
  f.data.features[0].task_ids.push('NEW');f.data.features[0].behavior='current repair';
  f.write('docs/current/change.md','current task change\n');
  f.save();f.git('add','.');f.git('commit','-m','repair with historical metadata');const head=f.git('rev-parse','HEAD');
  if(mode==='pr-backfill') {
    assert.equal(selectMainTask(f.root,comparisonBase,head).id,'NEW');
    const r=f.cli('run',['--base',comparisonBase,'--head',head,'--ci-main'],undefined,{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main'});
    assert.equal(r.status,0,r.stdout+r.stderr);
  } else assert.throws(()=>selectMainTask(f.root,comparisonBase,head),/exactly one associated task|non-candidate task/);
});
test('baseline fixture cache isolates files, index, refs, config and registry data',t=>{
  const first=fixture(t); first.write('tests/example.test.mjs','mutated'); first.data.features[0].behavior='mutated'; first.save(); first.git('add','.'); first.git('commit','-m','isolated change'); first.git('config','user.name','Changed');
  const second=fixture(t); assert.equal(second.git('rev-parse','HEAD'),second.base); assert.equal(second.git('config','user.name'),'Fixture'); assert.equal(second.data.features[0].behavior,'Enforce gates'); assert.match(fs.readFileSync(path.join(second.root,'tests/example.test.mjs'),'utf8'),/real execution/); assert.equal(second.cli().status,0);
});
for (const timeout of [600000,600001,0,1.5]) test(`registered check timeout boundary: ${timeout}`,t=>{
  const f=fixture(t);f.data.checks[0].timeout_ms=timeout;f.save();const r=f.cli();if(timeout===600000)assert.equal(r.status,0,r.stdout+r.stderr);else failure(r,/invalid timeout/);
});
test('batch snapshot preserves binary, empty, quoted-path bytes and executable modes',t=>{
  const f=fixture(t), binary=Buffer.from([0,255,10,13,0,42]), name='tests/quoted name-中文.bin';
  f.write(name,binary);f.write('tests/empty.bin','');f.write('tests/executable.mjs','export {};\n');f.git('add','.');f.git('update-index','--chmod=+x','tests/executable.mjs');
  const s=snapshot(f.root,f.git('write-tree'));try {assert.deepEqual(fs.readFileSync(path.join(s.dir,name)),binary);assert.equal(fs.readFileSync(path.join(s.dir,'tests/empty.bin')).length,0);assert.equal(fs.readFileSync(path.join(s.dir,'tests/executable.mjs'),'utf8'),'export {};\n');if(process.platform!=='win32')assert.ok(fs.statSync(path.join(s.dir,'tests/executable.mjs')).mode&0o111);}finally{s.cleanup();}
});
test('batch snapshot rejects non-regular Git tree entries',t=>{
  const f=fixture(t), blob=f.git('hash-object','tests/example.test.mjs');f.git('update-index','--add','--cacheinfo','120000',blob,'tests/link');
  assert.throws(()=>snapshot(f.root,f.git('write-tree')),/non-regular tracked input/);
});
