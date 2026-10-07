#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, load, main } from './lib/core.mjs';
import { validate } from './lib/validate.mjs';
import { append, begin, finish, receive, readLog, readPolicy, validateLog, saveLog, prompt, runBuilds } from './lib/collaboration.mjs';

main(() => {
  const root = process.cwd(), [command,...args] = process.argv.slice(2);
  const commands = {
    begin:['role','phase'], finish:['role','details'], accept:['role','handoff','digest'],
    reject:['role','handoff','digest','reason'], cancel:['role','handoff','digest','reason'],
    check:[], prompt:['handoff','prompt-file'], builds:['role'], 'record-delivery':['role','details']
  };
  if (command === '--help') {
    console.log('Manual relay only; no commit/push/PR or automatic messages.\nCommands: begin, finish, accept, reject, cancel, check, prompt, builds, record-delivery\nAll require --task ID. begin: --role ROLE --phase PHASE; finish/record-delivery: --role ROLE --details JSON_FILE; accept/reject/cancel: --role ROLE --handoff ID --digest SHA256 [--reason TEXT]; prompt: --handoff ID [--prompt-file FILE] validates an existing saved prompt; builds: --role pi-desktop (code) or antigravity (frontend).\nRoles: antigravity, pi-desktop. Phases: planning, implementation, documentation_delivery, rework; bootstrap only TASK-GOV-004.\nDetails: goal, outcome, result ready|blocked, next_actions[], forbidden[], documentation_requests[], limitations[], blockers[], build{status,reason,check_ids}, verification[{check_id,reason}], report (required for ready non-planning), optional build_report; documentation_delivery adds next_phase wait|rework|planning and commit_message only for ready wait.\nBuild definitions: task.build_checks = [{id,kind:build|compile,command:node,args:[project-script,...],timeout_ms}]. Commands run without shell.'); return;
  }
  if (!commands[command]) throw new Error('unknown handoff command; use --help');
  const options = {};
  for (let i=0;i<args.length;i+=2) {
    const name = args[i].slice(2);
    if (!args[i].startsWith('--') || !['task',...commands[command]].includes(name) || options[name] !== undefined || !args[i+1] || args[i+1].startsWith('--')) throw new Error('invalid/duplicate/missing handoff option');
    options[name] = args[i+1];
  }
  const t = load(root).tasks.find(t=>t.id === options.task);
  if (!t) throw new Error('unknown task');
  let result;
  if (command === 'begin') result = begin(root,t,options.role,options.phase);
  else if (command === 'finish') result = finish(root,t,options.role,JSON.parse(fs.readFileSync(options.details,'utf8')));
  else if (['accept','reject','cancel'].includes(command)) result = receive(root,t,options.role,options.handoff,options.digest,command,options.reason);
  else if (command === 'check' || command === 'prompt') {
    const {collaboration} = validate(root,{branch:t.branch});
    if (!collaboration) throw new Error('missing collaboration enforcement');
    if (command === 'check') console.log(`handoff chain passed: ${t.id}; active=${collaboration.active?.phase || 'none'}; human transfer/acceptance not authenticated`);
    else {
      const e = collaboration.log.events.find(e=>e.id === options.handoff);
      if (!e) throw new Error('unknown handoff event');
      const text = prompt(t,e);
      if (options['prompt-file'] && fs.readFileSync(options['prompt-file'],'utf8').replaceAll('\r\n','\n').trimEnd() !== text.trimEnd()) throw new Error('saved prompt differs from validated JSON rendering');
      console.log(text);
    }
  } else if (command === 'builds') {
    const {collaboration} = validate(root,{branch:t.branch});
    const buildRole = t.mode === 'frontend' ? 'antigravity' : 'pi-desktop';
    if (options.role !== buildRole || collaboration?.active?.role !== options.role || !['implementation','rework','bootstrap'].includes(collaboration?.active?.phase)) throw new Error('builds require active development phase owner');
    const report = runBuilds(root,t), output = path.join(root,'.governance-evidence','builds.json');
    fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(`build/compile diagnostics: ${output}`);
  } else if (command === 'record-delivery') {
    if (options.role !== 'antigravity') throw new Error('Git delivery metadata belongs to Antigravity');
    const p = readPolicy(root), log = readLog(root,t), state = validateLog(root,t,p,log,{delivery:true});
    const d = JSON.parse(fs.readFileSync(options.details,'utf8'));
    if (git(root,['branch','--show-current']) !== t.branch || git(root,['remote','get-url','origin']) !== p.repository || d.commit !== git(root,['rev-parse','HEAD'])) throw new Error('delivery must identify actual HEAD/branch/origin');
    const repo = p.repository.match(/github\.com\/(.+)\.git$/)[1];
    const gh = args => {
      const r = spawnSync('gh',args,{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});
      if (r.status !== 0) throw new Error(`cannot verify GitHub delivery: ${r.stderr || r.error?.message}`);
      return JSON.parse(r.stdout);
    };
    const pr = gh(['pr','view',String(d.pr),'--repo',repo,'--json','number,url,headRefName,baseRefName,headRefOid,state']);
    if (pr.number !== d.pr || pr.headRefName !== t.branch || pr.baseRefName !== 'main' || pr.headRefOid !== d.commit || pr.state !== 'OPEN') throw new Error('actual PR head/base/state mismatch');
    if (d.ci?.status === 'not_configured') {
      const workflows = gh(['api',`repos/${repo}/actions/workflows`]);
      if (workflows.total_count !== 0 || d.ci.url !== null) throw new Error('CI is configured; cannot report not_configured');
    } else {
      const id = d.ci?.url?.match(/\/actions\/runs\/(\d+)$/)?.[1];
      if (!id) throw new Error('missing CI run URL');
      const run = gh(['run','view',id,'--repo',repo,'--json','headSha,status,conclusion,url,workflowName']);
      const status = run.status !== 'completed' ? 'pending' : run.conclusion === 'success' ? 'success' : 'failure';
      if (run.headSha !== d.commit || run.url !== d.ci.url || status !== d.ci.status || run.workflowName !== 'Governance') throw new Error('actual governance CI version/result mismatch');
    }
    const next_phase = d.ci.status === 'failure' ? 'rework' : 'wait';
    const event = append(log,{type:'delivery',role:'antigravity',candidate:state.lastHandoff.id,source_head:d.commit,commit:d.commit,pr:pr.number,pr_url:pr.url,branch:t.branch,base:'main',ci:d.ci,next_actions:d.next_actions,next_phase,receiver:t.mode === 'frontend' && next_phase === 'rework' ? 'antigravity' : 'pi-desktop'});
    validateLog(root,t,p,log,{delivery:true}); result = {log,event};
  }
  if (result) {
    saveLog(root,t,result.log);
    console.log(`Recorded ${result.event.type}: ${result.event.id}; sha256=${result.event.digest}`);
    if (['handoff','delivery'].includes(result.event.type)) console.log(prompt(t,result.event));
  }
});
