import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, failed, check, mutateLog, env } from './collaboration-fixture.mjs';
import { append, receive, saveLog, readLog, readPolicy, validateCollaboration, prompt } from '../../scripts/governance/lib/collaboration.mjs';

test('history rewrite detected against committed prefix',t=>{const f=fixture(t);f.candidate();f.git('add','.');f.git('commit','-m','chore(collaboration): synthetic delivery');mutateLog(f,l=>l.events[1].details.outcome='Rewritten historical claim.');assert.throws(()=>check(f),/rewritten/);});
test('policy cannot be removed after deployment',t=>{const f=fixture(t);f.candidate();f.git('add','.');f.git('commit','-m','chore(collaboration): synthetic delivery');fs.unlinkSync(path.join(f.root,'governance/collaboration.json'));assert.throws(()=>readPolicy(f.root,false),/removed/);});
test('actual Hooks reject PI commit, wrong message and actual push; allow Antigravity',t=>{
  const f=fixture(t);f.candidate();f.git('add','.');assert.equal(f.cli('install-hooks').status,0);
  failed(f.shell(['commit','-m','chore(collaboration): synthetic delivery'],{GOV_ROLE:'pi-desktop'}),/GOV_ROLE=antigravity/);
  failed(f.shell(['commit','-m','chore: wrong message'],{GOV_ROLE:'antigravity'}),/commit message differs/);
  const r=f.shell(['commit','-m','chore(collaboration): synthetic delivery'],{GOV_ROLE:'antigravity'});assert.equal(r.status,0,r.stdout+r.stderr);
  const bare=path.join(f.root,'.governance-evidence/remote.git');const init=spawnSync('git',['init','--bare',bare],{env,encoding:'utf8'});assert.equal(init.status,0,init.stderr);f.git('remote','add','sink',bare);
  failed(f.shell(['push','sink',f.task.branch],{GOV_ROLE:'pi-desktop'}),/GOV_ROLE=antigravity/);
  const pushed=f.shell(['push','sink',f.task.branch],{GOV_ROLE:'antigravity'});assert.equal(pushed.status,0,pushed.stdout+pushed.stderr);
});
test('staged bad snapshot cannot be masked by unstaged repair',t=>{const f=fixture(t);f.candidate();f.write('mysql-mcp/src/value.mjs','bad');f.git('add','.');f.write('mysql-mcp/src/value.mjs','export const value = 1;\n');failed(f.cli('check',['--staged'],undefined,{GOV_ROLE:'antigravity'}),/snapshot changed|candidate/);});
test('old committed object cannot be masked by repaired working copy',t=>{const f=fixture(t);f.candidate();f.write('mysql-mcp/src/value.mjs','bad');f.git('add','.');f.git('commit','-m','chore: bad object');const head=f.git('rev-parse','HEAD');f.write('mysql-mcp/src/value.mjs','export const value = 1;\n');failed(f.cli('check',['--pre-push'],`refs/heads/chore/test ${head} refs/heads/chore/test ${'0'.repeat(40)}\n`,{GOV_ROLE:'antigravity'}),/snapshot changed|candidate/);});
test('PR exact base/head and squash main independent context both pass',t=>{
  const f=fixture(t);f.candidate();f.git('add','.');f.git('commit','-m','chore(collaboration): synthetic delivery');const head=f.git('rev-parse','HEAD');
  const pr=f.cli('run',['--base',f.base,'--head',head,'--branch',f.task.branch,'--delivery']);assert.equal(pr.status,0,pr.stdout+pr.stderr);
  f.git('switch','main');f.git('merge','--squash',f.task.branch);f.git('commit','-m','GitHub squash merge (#99)');const squash=f.git('rev-parse','HEAD');
  const args=['--base',f.base,'--head',squash,'--ci-main','--delivery'];failed(f.cli('run',args),/main CI context/);
  const r=f.cli('run',args,undefined,{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main'});assert.equal(r.status,0,r.stdout+r.stderr);
});
for(const status of ['success','failure']) test(`delivery ${status} produces next PI prompt; failure explicitly accepts rework`,t=>{
  const f=fixture(t);const candidate=f.candidate();f.git('add','.');f.git('commit','-m',candidate.details.commit_message);const commit=f.git('rev-parse','HEAD');
  const log=readLog(f.root,f.task);const e=append(log,{type:'delivery',role:'antigravity',candidate:candidate.id,source_head:commit,commit,pr:99,pr_url:'https://github.com/ArturiaGit/mysql-mcp/pull/99',branch:f.task.branch,base:'main',ci:{status,reason:'Synthetic CI fixture; not real remote evidence.',url:'https://github.com/ArturiaGit/mysql-mcp/actions/runs/99'},next_actions:[status==='failure'?'Fix the concrete synthetic CI failure, rerun registered checks, return to Antigravity.':'Wait for user merge authorization; no new development.'],receiver:'pi-desktop',next_phase:status==='failure'?'rework':'wait'});saveLog(f.root,f.task,log);
  assert.match(prompt(f.task,e),/PI-Desktop/);check(f,{delivery:true});
  if(status==='failure'){assert.throws(()=>f.start('pi-desktop','rework'),/illegal begin/);f.accept(e);f.start('pi-desktop','rework');assert.equal(check(f).active.phase,'rework');}
  else {f.start('antigravity','documentation_delivery');f.task.pr=99;f.save();f.end('antigravity',{report:f.run(),commit_message:'docs: record real delivery fixture'});check(f,{delivery:true});}
});
test('historical task cannot authorize new task branch changes',t=>{
  const f=fixture(t);f.candidate();f.git('add','.');f.git('commit','-m','chore(collaboration): synthetic delivery');f.policy.enabled_base=f.git('rev-parse','HEAD');f.save();
  assert.throws(()=>validateCollaboration(f.root,f.task),/historical task/);
});
test('missing Git role is rejected even for valid candidate',t=>{const f=fixture(t);f.candidate();f.git('add','.');failed(f.cli('check',['--staged']),/GOV_ROLE=antigravity/);});
for(const decision of ['reject','cancel']) test(`${decision} revokes completed Git candidate until fresh planning`,t=>{
  const f=fixture(t);const h=f.candidate();f.persist(receive(f.root,f.task,decision==='cancel'?h.role:h.receiver,h.id,h.digest,decision,'Withdraw the synthetic delivery candidate.'));
  assert.throws(()=>check(f,{delivery:true}),/cancelled\/rejected/);f.git('add','.');failed(f.cli('check',['--staged'],undefined,{GOV_ROLE:'antigravity'}),/cancelled\/rejected/);f.start('antigravity','planning');
});
test('Git mode-only change is subject to role and candidate snapshot',t=>{
  const f=fixture(t);f.start('antigravity','planning');f.git('update-index','--chmod=+x','tests/governance/example.test.mjs');assert.throws(()=>check(f),/responsibility boundary/);
  f.git('update-index','--chmod=-x','tests/governance/example.test.mjs');const h=f.end('antigravity');f.accept(h);f.start('pi-desktop','implementation');const result=f.end('pi-desktop',{report:f.run()});f.accept(result);f.start('antigravity','documentation_delivery');f.end('antigravity',{report:f.run(),commit_message:'chore: mode-bound candidate'});
  f.git('update-index','--chmod=+x','tests/governance/example.test.mjs');assert.throws(()=>check(f,{delivery:true}),/snapshot changed/);
});
test('Hook candidate evidence reuses staged and pushed objects without rerunning tests',t=>{
  const f=fixture(t,'docs');f.candidate();f.git('add','.');
  const start=performance.now(), staged=f.cli('check',['--staged'],undefined,{GOV_ROLE:'antigravity'});
  assert.equal(staged.status,0,staged.stdout+staged.stderr);assert.match(staged.stdout,/candidate evidence reused/);assert.doesNotMatch(staged.stdout,/local diagnostic passed/);
  t.diagnostic(`staged fast path: ${(performance.now()-start).toFixed(1)} ms`);
  f.git('commit','-m','chore(collaboration): synthetic delivery');const head=f.git('rev-parse','HEAD');
  const pushed=f.cli('check',['--pre-push'],`refs/heads/chore/test ${head} refs/heads/chore/test ${'0'.repeat(40)}\n`,{GOV_ROLE:'antigravity'});
  assert.equal(pushed.status,0,pushed.stdout+pushed.stderr);assert.match(pushed.stdout,/candidate evidence reused/);
});
test('candidate with changed execution input digest falls back to registered checks',t=>{
  const f=fixture(t,'docs');f.candidate();mutateLog(f,l=>{l.events.at(-1).evidence.report.input_sha256='0'.repeat(64);});f.git('add','.');
  const r=f.cli('check',['--staged'],undefined,{GOV_ROLE:'antigravity'});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/hook cold path/);assert.match(r.stdout,/local diagnostic passed/);
});
test('candidate original TAP tampering never enters fast path',t=>{
  const f=fixture(t,'docs');f.candidate();mutateLog(f,l=>{l.events.at(-1).evidence.artifacts['unit.tap']='tampered';});f.git('add','.');
  failed(f.cli('check',['--staged'],undefined,{GOV_ROLE:'antigravity'}),/artifact hash mismatch/);
});
test('candidate check definition drift never enters fast path',t=>{
  const f=fixture(t,'docs');f.candidate();f.data.checks[0].timeout_ms+=1;f.save();f.git('add','.');
  failed(f.cli('check',['--staged'],undefined,{GOV_ROLE:'antigravity'}),/snapshot changed|changed|drift|candidate/);
});
test('CI snapshot runner does not reuse local candidate execution',t=>{
  const f=fixture(t,'docs');f.candidate();f.git('add','.');f.git('commit','-m','chore(collaboration): synthetic delivery');const head=f.git('rev-parse','HEAD');
  const r=f.cli('run',['--base',f.base,'--head',head,'--branch',f.task.branch,'--delivery']);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/local diagnostic passed/);assert.doesNotMatch(r.stdout,/candidate evidence reused/);
});
test('candidate execution from another Node runtime falls back to registered checks',t=>{
  const f=fixture(t,'docs');f.candidate();mutateLog(f,l=>{l.events.at(-1).evidence.report.environment.node='v0.0.0';});f.git('add','.');
  const r=f.cli('check',['--staged'],undefined,{GOV_ROLE:'antigravity'});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/hook cold path/);assert.match(r.stdout,/local diagnostic passed/);
});
test('cold path registered failure still blocks the Hook',t=>{
  const f=fixture(t);f.planning();f.start('pi-desktop','implementation');f.write('tests/governance/example.test.mjs',"import test from 'node:test';test('conditional synthetic failure',()=>{if(process.env.SYNTHETIC_FAIL_CHECK)throw Error('cold path failure');});\n");
  f.accept(f.end('pi-desktop',{report:f.run()}));f.start('antigravity','documentation_delivery');f.end('antigravity',{report:f.run(),commit_message:'chore(collaboration): synthetic delivery'});
  mutateLog(f,l=>{l.events.at(-1).evidence.report.input_sha256='0'.repeat(64);});f.git('add','.');
  const r=f.cli('check',['--staged'],undefined,{GOV_ROLE:'antigravity',SYNTHETIC_FAIL_CHECK:'1'});failed(r,/registered checks failed/);assert.match(r.stdout,/hook cold path/);
});
