import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, failed, check, rehash } from './collaboration-fixture.mjs';
import { finish, receive, saveLog, readLog, readPolicy, manifest, owner, prompt, developmentHash, runBuilds } from '../../scripts/governance/lib/collaboration.mjs';

test('valid dual prompts, explicit acceptance, development and delivery candidate',t=>{
  const f=fixture(t);f.start('antigravity','planning');const p=f.end('antigravity');
  assert.match(prompt(f.task,p),/PI-Desktop/);assert.equal(readLog(f.root,f.task).events.length,2);
  assert.throws(()=>f.start('pi-desktop','implementation'),/explicit handoff acceptance/);
  f.accept(p);f.start('pi-desktop','implementation');f.write('mysql-mcp/src/value.mjs','export const value = 1;\n');
  const h=f.end('pi-desktop',{report:f.run()});assert.match(prompt(f.task,h),/Antigravity/);assert.equal(prompt(f.task,h),prompt(f.task,h));
  f.accept(h);f.start('antigravity','documentation_delivery');f.write('docs/result.md','# Finished\n');
  const e=f.end('antigravity',{report:f.run(),commit_message:'chore(collaboration): synthetic delivery'});
  assert.equal(check(f,{delivery:true}).lastHandoff.id,e.id);assert.match(prompt(f.task,e),/tests\/pass=1\/1/);
});
test('document-only workflow has no fabricated PI development',t=>{const f=fixture(t,'docs');f.candidate();assert.equal(check(f,{delivery:true}).latestCode,null);assert(!readLog(f.root,f.task).events.some(e=>e.role==='pi-desktop'));});
for (const [role,phase] of [['pi-desktop','planning'],['antigravity','implementation'],['pi-desktop','bootstrap'],['pi-desktop','implementation']]) test(`reject wrong/missing planning role ${role}/${phase}`,t=>{const f=fixture(t);assert.throws(()=>f.start(role,phase),/illegal begin/);});
for(const action of ['add','delete','rename']) test(`Antigravity cannot ${action} code in planning`,t=>{
  const f=fixture(t);f.start('antigravity','planning');
  if(action==='add')f.write('mysql-mcp/src/value.mjs','code');
  if(action==='delete')fs.unlinkSync(path.join(f.root,'tests/governance/example.test.mjs'));
  if(action==='rename')fs.renameSync(path.join(f.root,'tests/governance/example.test.mjs'),path.join(f.root,'tests/governance/renamed.test.mjs'));
  assert.throws(()=>check(f),/responsibility boundary/);
});
for(const action of ['add','delete','rename','registry']) test(`PI cannot ${action} documentation/registry`,t=>{
  const f=fixture(t);f.planning();f.start('pi-desktop','implementation');
  if(action==='add')f.write('mysql-mcp/README.md','# Docs');
  if(action==='delete')fs.unlinkSync(path.join(f.root,'docs/ACCEPTANCE.md'));
  if(action==='rename')fs.renameSync(path.join(f.root,'docs/plans/test.md'),path.join(f.root,'docs/plans/other.md'));
  if(action==='registry'){f.task.pr=10;f.save();}
  assert.throws(()=>check(f),/responsibility boundary/);
});
test('unclassified and overlapping path policies rejected',t=>{const f=fixture(t);f.start('antigravity','planning');f.write('outside.bin','x');assert.throws(()=>check(f),/unclassified/);assert.throws(()=>owner(f.policy,'../escape'),/unsafe/);f.policy.roles.antigravity.push('mysql-mcp/');f.save();assert.throws(()=>readPolicy(f.root),/overlapping/);});
for(const kind of ['role','digest','duplicate']) test(`bad receiver ${kind}`,t=>{const f=fixture(t);f.start('antigravity','planning');const h=f.end('antigravity');if(kind==='role')assert.throws(()=>f.accept(h,'antigravity'),/receiver role/);if(kind==='digest')assert.throws(()=>f.persist(receive(f.root,f.task,h.receiver,h.id,'0'.repeat(64))),/digest/);if(kind==='duplicate'){f.accept(h);assert.throws(()=>f.accept(h),/out-of-order/);}});
for(const decision of ['reject','cancel']) test(`${decision} kept and requires replanning`,t=>{const f=fixture(t);f.start('antigravity','planning');const h=f.end('antigravity');f.persist(receive(f.root,f.task,decision==='cancel'?h.role:h.receiver,h.id,h.digest,decision,'Synthetic user-forwarded rejection.'));f.start('antigravity','planning');assert.equal(check(f).active.phase,'planning');});
for(const [name,mutate,re] of [
  ['goal',d=>delete d.goal,/incomplete/],['placeholder',d=>d.next_actions=['TODO'],/placeholder/],['next actions',d=>d.next_actions=[],/incomplete/],['limitations',d=>d.limitations=[],/incomplete/],['build reason',d=>d.build.reason='',/build/],['blocker ready',d=>d.blockers=['Blocked.'],/blocked/],['verification reference',d=>d.verification=[{check_id:'unknown',reason:'Actually checked.'}],/verification/],['missing verification',d=>d.verification=[],/required verification/],['PI commit message',d=>d.commit_message='chore: forbidden',/commit message/]
]) test(`handoff content rejects ${name}`,t=>{const f=fixture(t);f.planning();f.start('pi-desktop','implementation');const d=f.details({report:f.run()});mutate(d);assert.throws(()=>f.persist(finish(f.root,f.task,'pi-desktop',d)),re);});
for(const [name,fn,re] of [
  ['digest',l=>l.events[0].digest='0'.repeat(64),/digest/],
  ['role',l=>l.events[0].role='pi-desktop',/transition|role/],
  ['branch',l=>l.events[0].branch='wrong',/branch/],
  ['base',l=>l.events[0].base_commit='0'.repeat(40),/base/],
  ['features',l=>l.events[0].feature_ids=['wrong'],/features/],
  ['acceptance',l=>l.events[1].acceptance_ids=['wrong'],/acceptance/],
  ['receiver',l=>l.events[1].receiver='antigravity',/receiver/],
  ['omission',l=>l.events[1].changes=[],/omission/],
  ['manifest',l=>l.events[1].after['../escape']='0'.repeat(64),/manifest/],
  ['chain',l=>l.events[1].sequence=1,/order/]
]) test(`tampered handoff ${name} rejected`,t=>{const f=fixture(t);f.start('antigravity','planning');f.end('antigravity');const l=readLog(f.root,f.task);fn(l);saveLog(f.root,f.task,name==='digest'?l:rehash(l));assert.throws(()=>check(f),re);});
for(const kind of ['code','plan']) test(`post-handoff ${kind} drift rejected`,t=>{const f=fixture(t);f.implementation();f.write(kind==='code'?'mysql-mcp/src/value.mjs':'docs/plans/test.md','drift');assert.throws(()=>check(f),/snapshot changed/);});
test('plan change in documentation requires replanning/rework, not old evidence',t=>{const f=fixture(t);f.implementation();f.start('antigravity','documentation_delivery');f.write('docs/plans/test.md','# New plan\n');assert.throws(()=>f.end('antigravity',{report:f.run(),commit_message:'chore: invalid old implementation'}),/plan\/code drift/);});
test('rework retains previous failures and executes new code checks',t=>{const f=fixture(t);f.implementation();f.start('antigravity','documentation_delivery');const request=f.end('antigravity',{result:'blocked',blockers:['Concrete synthetic defect.'],next_phase:'rework'});f.accept(request);f.start('pi-desktop','rework');f.write('mysql-mcp/src/value.mjs','export const value = 2;\n');const result=f.end('pi-desktop',{report:f.run()});f.accept(result);f.start('antigravity','documentation_delivery');f.end('antigravity',{report:f.run(),commit_message:'fix(collaboration): synthetic regression'});assert.equal(check(f,{delivery:true}).latestCode.phase,'rework');});
for(const kind of ['TAP','counts','source','task','stale','failed']) test(`evidence ${kind} cannot grant handoff`,t=>{const f=fixture(t);f.planning();f.start('pi-desktop','implementation');const report=f.run();const r=JSON.parse(fs.readFileSync(report));if(kind==='TAP')f.write('.governance-evidence/unit.tap','tampered');if(kind==='counts')r.checks[0].counts.tests=99;if(kind==='source')r.source_commit='0'.repeat(40);if(kind==='task')r.task_id='WRONG';if(kind==='stale')f.write('mysql-mcp/src/value.mjs','new source');if(kind==='failed')r.local_result='failed';if(!['TAP','stale'].includes(kind))fs.writeFileSync(report,JSON.stringify(r));assert.throws(()=>f.end('pi-desktop',{report}),/hash mismatch|TAP metadata|HEAD|task|stale|failed/);});
test('saved prompt mismatch and strict CLI options rejected',t=>{const f=fixture(t);f.start('antigravity','planning');const h=f.end('antigravity');const file=path.join(f.root,'.governance-evidence/prompt.txt');f.write('.governance-evidence/prompt.txt',prompt(f.task,h));const args=['prompt','--task','TASK','--handoff',h.id,'--prompt-file',file];assert.equal(f.cli('handoff',args).status,0);fs.writeFileSync(file,'tampered');failed(f.cli('handoff',args),/saved prompt differs/);failed(f.cli('handoff',['begin','--task','TASK','--role','pi-desktop','--role','antigravity']),/duplicate/);});
test('copied bootstrap and historical task cannot bypass policy',t=>{const f=fixture(t);f.policy.bootstrap={task_id:'TASK',branch:f.task.branch,base_commit:f.base,documentation_paths:['docs/'],authorization:'copy'};f.save();assert.throws(()=>readPolicy(f.root),/restricted/);});
test('new task without handoff log fails closed',t=>{const f=fixture(t);failed(f.cli('check'),/missing handoff log/);});
test('required future build and compilation actually execute without shell',t=>{const f=fixture(t);f.task.build_checks=[{id:'build',kind:'build',command:'node',args:['mysql-mcp/build.mjs'],timeout_ms:10000},{id:'compile',kind:'compile',command:'node',args:['mysql-mcp/compile.mjs'],timeout_ms:10000}];f.save();f.planning();f.start('pi-desktop','implementation');f.write('mysql-mcp/build.mjs',"console.log('synthetic build');\n");f.write('mysql-mcp/compile.mjs',"console.log('synthetic compile');\n");const report=runBuilds(f.root,f.task);assert.equal(report.checks.length,2);assert.equal(report.development_sha256,developmentHash(f.root,f.task));f.write('mysql-mcp/compile.mjs','process.exit(1);\n');assert.throws(()=>runBuilds(f.root,f.task),/failed/);});
test('unsafe/missing build definition cannot claim compilation',t=>{const f=fixture(t);f.task.build_checks=[{id:'build',kind:'build',command:'sh',args:['mysql-mcp/build.mjs'],timeout_ms:10000}];assert.throws(()=>runBuilds(f.root,f.task),/unsafe/);});
test('manifest is portable across Git LF and Windows CRLF checkout',t=>{const f=fixture(t);const a=manifest(f.root,f.base);f.write('docs/ACCEPTANCE.md','# Immutable acceptance\r\n');const b=manifest(f.root);assert.equal(a['docs/ACCEPTANCE.md'],b['docs/ACCEPTANCE.md']);});
test('task authorization changes can be replanned but invalidate old delivery',t=>{
  const f=fixture(t);f.implementation();f.start('antigravity','documentation_delivery');f.task.authorization+=' Additional reviewed boundary.';f.save();
  assert.throws(()=>f.end('antigravity',{report:f.run(),commit_message:'chore: stale authorization'}),/plan\/code drift/);
  const replanning=f.end('antigravity',{result:'blocked',blockers:['Updated authorization requires new implementation verification.'],next_phase:'planning'});f.accept(replanning);f.start('antigravity','planning');
  const planned=f.end('antigravity');f.accept(planned);f.start('pi-desktop','implementation');const code=f.end('pi-desktop',{report:f.run()});f.accept(code);f.start('antigravity','documentation_delivery');
  f.end('antigravity',{report:f.run(),commit_message:'chore: updated authorized scope'});assert(check(f,{delivery:true}).latestCode);
});
test('application package cannot silently declare build not applicable',t=>{const f=fixture(t);f.planning();f.start('pi-desktop','implementation');f.write('mysql-mcp/package.json','{}\n');assert.throws(()=>f.end('pi-desktop',{report:f.run()}),/requires registered build/);});
test('failed original tests cannot produce ready handoff',t=>{const f=fixture(t);f.planning();f.start('pi-desktop','implementation');f.write('tests/governance/example.test.mjs',"import test from 'node:test';test('bad',()=>{throw Error('synthetic failure');});\n");failed(f.cli('run'),/registered checks failed/);assert.throws(()=>f.end('pi-desktop',{report:path.join(f.root,'.governance-evidence/run.json')}),/overall local execution failed/);});
test('missing declared plan cannot grant ready planning',t=>{const f=fixture(t);f.task.plan_path='docs/plans/missing.md';f.save();f.start('antigravity','planning');assert.throws(()=>f.end('antigravity'),/existing declared plan/);});
test('finish and receive require actual active task branch',t=>{const f=fixture(t);f.start('antigravity','planning');f.git('switch','-c','chore/wrong');assert.throws(()=>f.end('antigravity'),/active task branch/);f.git('switch',f.task.branch);const h=f.end('antigravity');f.git('switch','chore/wrong');assert.throws(()=>f.accept(h),/active task branch/);});
test('copied baseline isolates worktree, index, refs, config and evidence',t=>{
  const a=fixture(t), b=fixture(t);
  assert.notEqual(a.root,b.root);assert.equal(a.base,b.base);
  a.write('docs/ACCEPTANCE.md','# Changed only in A\n');a.git('add','docs/ACCEPTANCE.md');
  a.git('commit','-m','fixture: isolated mutation');a.git('config','fixture.marker','only-a');
  a.git('update-ref','refs/remotes/origin/main','HEAD');a.write('.governance-evidence/private.txt','only-a');
  a.planning();
  for(const f of [b,fixture(t)]) {
    assert.equal(f.git('rev-parse','HEAD'),f.base);
    assert.equal(f.git('rev-parse','refs/remotes/origin/main'),f.base);
    assert.equal(f.git('diff','--cached','--name-only'),'');
    assert.equal(f.shell(['config','--get','fixture.marker']).status,1);
    assert.equal(fs.readFileSync(path.join(f.root,'docs/ACCEPTANCE.md'),'utf8'),'# Immutable acceptance\n');
    assert(!fs.existsSync(path.join(f.root,'.governance-evidence/private.txt')));
    assert(!fs.existsSync(path.join(f.root,'governance/handoffs/TASK.json')));
  }
});
