#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { git, snapshot, main } from './lib/core.mjs';
import { validate } from './lib/validate.mjs';

function executeSnapshot(root, tree, branch, base, head, run = false) {
  const s = snapshot(root, tree);
  try {
    const args = [path.join(s.dir, 'scripts/governance/check.mjs'), '--snapshot', '--branch', branch];
    if (base) args.push('--base', base);
    if (head) args.push('--head', head);
    const r = spawnSync(process.execPath, args, { cwd: s.dir, env: s.env, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('snapshot validation failed');
    if (run) {
      const result = spawnSync(process.execPath, [path.join(s.dir,'scripts/governance/run.mjs'),'--snapshot','--branch',branch,...(base ? ['--base',base] : []),...(head ? ['--head',head] : [])], { cwd: s.dir, env: s.env, stdio: 'inherit' });
      if (result.status !== 0) throw new Error('snapshot registered checks failed');
    }
  } finally { s.cleanup(); }
}
main(() => {
  const root = process.cwd(), args = process.argv.slice(2);
  const value = flag => args.includes(flag) ? args[args.indexOf(flag)+1] : undefined;
  for (let i=0; i<args.length; i++) {
    if (['--base','--head','--branch'].includes(args[i])) { if (!args[++i] || args[i].startsWith('--')) throw new Error('missing option value'); }
    else if (!['--staged','--pre-push','--snapshot'].includes(args[i])) throw new Error(`unknown option: ${args[i]}`);
  }
  if (args.includes('--pre-push')) {
    const lines = fs.readFileSync(0,'utf8').trim().split('\n').filter(Boolean);
    if (!lines.length) throw new Error('empty pre-push ref input');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 4) throw new Error('invalid pre-push ref input');
      const [localRef, localOid, remoteRef, remoteOid] = parts;
      if (![localOid,remoteOid].every(x => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(x))) throw new Error('invalid push OID');
      if (/^0+$/.test(localOid)) throw new Error('ref deletion denied');
      if (!localRef.startsWith('refs/heads/') || remoteRef !== localRef || /^refs\/heads\/(main|master)$/.test(remoteRef)) throw new Error('push ref mismatch or protected branch');
      git(root,['cat-file','-e',`${localOid}^{commit}`]);
      if (git(root,['rev-parse','--verify',localRef]) !== localOid) throw new Error('push OID does not match local ref');
      if (!/^0+$/.test(remoteOid)) {
        git(root,['cat-file','-e',`${remoteOid}^{commit}`]);
        git(root,['merge-base','--is-ancestor',remoteOid,localOid]);
      }
      executeSnapshot(root,localOid,localRef.slice('refs/heads/'.length),undefined,localOid,true);
    }
  } else if (args.includes('--staged')) {
    const branch = git(root,['branch','--show-current']);
    if (!branch || ['main','master'].includes(branch)) throw new Error('staged commit requires task branch, not main/master/detached');
    executeSnapshot(root,git(root,['write-tree']),branch,undefined,undefined,true);
  } else if (args.includes('--snapshot')) {
    if (process.env.GOV_SNAPSHOT !== '1') throw new Error('snapshot mode is internal');
    const result = validate(root,{branch:value('--branch'),base:value('--base'),head:value('--head')});
    console.log(`governance structure/scope passed: ${result.task.id}; acceptance remains unverified`);
  } else if (value('--head')) {
    const branch = value('--branch');
    if (!branch || !value('--base')) throw new Error('--head requires --base and --branch');
    git(root,['cat-file','-e',`${value('--head')}^{commit}`]);
    executeSnapshot(root,value('--head'),branch,value('--base'),value('--head'));
  } else {
    const result = validate(root,{branch:value('--branch'),base:value('--base')});
    console.log(`governance structure/scope passed: ${result.task.id}; acceptance remains unverified`);
  }
});
