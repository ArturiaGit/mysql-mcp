#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { git, snapshot, main, hash } from './lib/core.mjs';
import { validate } from './lib/validate.mjs';

function reusableCandidate(root, result) {
  const c = result.collaboration, candidate = c?.lastHandoff;
  // validate() has already replayed the full chain, original TAP and build evidence,
  // checked role/base/contract/modes and matched the actual staged or pushed snapshot.
  if (!candidate || candidate.phase !== 'documentation_delivery' || candidate.details.result !== 'ready' || candidate.next_phase !== 'wait') return false;
  const report = candidate.evidence?.report;
  if (!report || JSON.stringify(candidate.check_definitions) !== JSON.stringify(result.data.checks)) return false;
  const index = c.log.events.findIndex(e => e.id === candidate.id);
  if (report.environment?.node !== process.version || report.environment.platform !== process.platform || report.environment.arch !== process.arch) return false;
  const filename = `governance/handoffs/${result.task.id}.json`;
  // run precedes finish: only this final event (and subsequent receipts/delivery
  // bookkeeping) is absent from its input. Every other byte remains bound.
  const priorLog = JSON.stringify({...c.log,events:c.log.events.slice(0,index)},null,2)+'\n';
  const digest = hash([...new Set(result.names)].filter(n=>!n.startsWith('.governance-evidence/')).sort().map(n => `${n}\0${hash(n === filename ? priorLog : fs.readFileSync(path.join(root,n)))}`).join('\n'));
  return report.input_sha256 === digest;
}

function executeSnapshot(root, tree, branch, base, head, run = false, localGit = false, message) {
  const s = snapshot(root, tree), context = ['--delivery',...(localGit ? ['--local-git'] : [])];
  try {
    const args = [path.join(s.dir,'scripts/governance/check.mjs'),'--snapshot','--branch',branch,...context,...(run ? ['--hook-check'] : [])];
    if (base) args.push('--base',base);
    if (head) args.push('--head',head);
    const env = {...s.env,...(message === undefined ? {} : {GOV_COMMIT_MESSAGE:message})};
    const r = spawnSync(process.execPath,args,{cwd:s.dir,env,stdio:'inherit'});
    if (r.status !== 0) throw new Error('snapshot validation failed');
    // The snapshot's own checker chooses evidence reuse or a full isolated run.
  } finally { s.cleanup(); }
}
main(() => {
  const root = process.cwd(), args = process.argv.slice(2);
  const value = flag => args.includes(flag) ? args[args.indexOf(flag)+1] : undefined;
  const modes = ['--staged','--pre-push','--commit-msg','--snapshot'].filter(x=>args.includes(x));
  if (modes.length > 1) throw new Error('exclusive check modes');
  for (let i=0;i<args.length;i++) {
    if (['--base','--head','--branch','--commit-msg'].includes(args[i])) { if (!args[++i] || args[i].startsWith('--')) throw new Error('missing option value'); }
    else if (!['--staged','--pre-push','--snapshot','--delivery','--local-git','--hook-check'].includes(args[i])) throw new Error(`unknown option: ${args[i]}`);
  }
  if (args.includes('--hook-check') && (!args.includes('--snapshot') || !args.includes('--local-git') || !args.includes('--delivery'))) throw new Error('hook check mode is internal');
  if (args.includes('--pre-push')) {
    const lines = fs.readFileSync(0,'utf8').trim().split('\n').filter(Boolean);
    if (!lines.length) throw new Error('empty pre-push ref input');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 4) throw new Error('invalid pre-push ref input');
      const [localRef,localOid,remoteRef,remoteOid] = parts;
      if (![localOid,remoteOid].every(x=>/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(x))) throw new Error('invalid push OID');
      if (/^0+$/.test(localOid)) throw new Error('ref deletion denied');
      if (!localRef.startsWith('refs/heads/') || remoteRef !== localRef || /^refs\/heads\/(main|master)$/.test(remoteRef)) throw new Error('push ref mismatch or protected branch');
      git(root,['cat-file','-e',`${localOid}^{commit}`]);
      if (git(root,['rev-parse','--verify',localRef]) !== localOid) throw new Error('push OID does not match local ref');
      if (!/^0+$/.test(remoteOid)) { git(root,['cat-file','-e',`${remoteOid}^{commit}`]); git(root,['merge-base','--is-ancestor',remoteOid,localOid]); }
      executeSnapshot(root,localOid,localRef.slice('refs/heads/'.length),undefined,localOid,true,true);
    }
  } else if (args.includes('--staged') || value('--commit-msg')) {
    const branch = git(root,['branch','--show-current']);
    if (!branch || ['main','master'].includes(branch)) throw new Error('staged commit requires task branch, not main/master/detached');
    const message = value('--commit-msg') ? fs.readFileSync(value('--commit-msg'),'utf8') : undefined;
    executeSnapshot(root,git(root,['write-tree']),branch,undefined,undefined,message === undefined,true,message);
  } else if (args.includes('--snapshot')) {
    if (process.env.GOV_SNAPSHOT !== '1') throw new Error('snapshot mode is internal');
    const result = validate(root,{branch:value('--branch'),base:value('--base'),head:value('--head'),delivery:args.includes('--delivery'),localGit:args.includes('--local-git'),message:process.env.GOV_COMMIT_MESSAGE});
    console.log(`governance structure/scope/handoff passed: ${result.task.id}; acceptance remains unverified`);
    if (args.includes('--hook-check')) {
      if (reusableCandidate(root,result)) console.log(`governance hook candidate evidence reused: ${result.task.id}; CI must independently rerun`);
      else {
        console.log('governance hook cold path: no matching candidate input evidence; running registered checks');
        const runArgs = [path.join(root,'scripts/governance/run.mjs'),'--snapshot','--branch',value('--branch'),'--delivery','--local-git',...(value('--base') ? ['--base',value('--base')] : []),...(value('--head') ? ['--head',value('--head')] : [])];
        const r = spawnSync(process.execPath,runArgs,{cwd:root,env:process.env,stdio:'inherit'});
        if (r.status !== 0) throw new Error('snapshot registered checks failed');
      }
    }
  } else if (value('--head')) {
    const branch = value('--branch');
    if (!branch || !value('--base')) throw new Error('--head requires --base and --branch');
    git(root,['cat-file','-e',`${value('--head')}^{commit}`]);
    executeSnapshot(root,value('--head'),branch,value('--base'),value('--head'));
  } else {
    const result = validate(root,{branch:value('--branch'),base:value('--base'),delivery:args.includes('--delivery'),localGit:args.includes('--local-git')});
    console.log(`governance structure/scope/handoff passed: ${result.task.id}; acceptance remains unverified`);
  }
});
