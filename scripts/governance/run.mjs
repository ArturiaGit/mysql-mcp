#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { git, snapshot, inputHash, main } from './lib/core.mjs';
import { validate } from './lib/validate.mjs';
import { execute } from './lib/execute.mjs';
import { developmentHash, readPolicy, runBuilds } from './lib/collaboration.mjs';
import { prepareDependencies } from './lib/dependencies.mjs';

main(() => {
  const root = process.cwd(), args = process.argv.slice(2);
  const value = flag => args.includes(flag) ? args[args.indexOf(flag)+1] : undefined;
  for (let i=0;i<args.length;i++) {
    if (['--branch','--base','--head'].includes(args[i])) { if (!args[++i] || args[i].startsWith('--')) throw new Error('missing option value'); }
    else if (!['--snapshot','--ci-main','--delivery','--local-git'].includes(args[i])) throw new Error(`unknown option: ${args[i]}`);
  }
  const output = path.resolve(process.env.GOV_ARTIFACT_DIR || (args.includes('--snapshot') ? fs.mkdtempSync(path.join(os.tmpdir(),'governance-evidence-')) : path.join(root,'.governance-evidence')));
  if (!process.env.GOV_ARTIFACT_DIR && !args.includes('--snapshot') && !git(root,['check-ignore','.governance-evidence/run.json'],true)) throw new Error('.governance-evidence/ must be ignored before running');
  if (!args.includes('--snapshot')) {
    const s = snapshot(root,value('--head'));
    try {
      const result = spawnSync(process.execPath,[path.join(s.dir,'scripts/governance/run.mjs'),'--snapshot',...args],{cwd:s.dir,env:{...s.env,GOV_ARTIFACT_DIR:output},stdio:'inherit'});
      if (result.status !== 0) throw new Error('snapshot execution failed');
    } finally { s.cleanup(); }
    return;
  }
  if (process.env.GOV_SNAPSHOT !== '1') throw new Error('snapshot mode is internal');
  fs.mkdirSync(output,{recursive:true});
  const report = {schema_version:1,trust:'local-diagnostic-only',started_at:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch},checks:[],acceptance:'unverified'};
  try {
    const {data,task,names,collaboration} = validate(root,{branch:value('--branch'),base:value('--base'),head:value('--head'),ciMain:args.includes('--ci-main'),delivery:args.includes('--delivery'),localGit:args.includes('--local-git')});
    report.task_id = task.id; report.feature_ids = task.feature_ids; report.task_status_claim = task.status; report.task_completion = 'unauthenticated';
    report.source_commit = value('--head') || git(root,['rev-parse','HEAD']);
    report.snapshot_tree = process.env.GOV_TREE || null;
    report.input_sha256 = inputHash(root,names);
    report.development_sha256 = developmentHash(root,task,collaboration?.policy || readPolicy(root,false));
    if (!data.checks.length) throw new Error('no registered checks');
    report.dependencies = prepareDependencies(root);
    if (inputHash(root,names) !== report.input_sha256) throw new Error('dependency preparation mutated snapshot inputs');
    report.checks = data.checks.map(c => execute(root,c,output));
    if (task.build_checks?.length) report.builds = runBuilds(root,task);
    if (inputHash(root,names) !== report.input_sha256) throw new Error('execution mutated snapshot inputs');
    if (report.checks.some(c => c.local_result !== 'passed')) throw new Error('registered checks failed');
    report.local_result = 'passed';
  } catch (e) { report.error = e.message; if (e.dependencies) report.dependencies = e.dependencies; report.local_result = 'failed'; process.exitCode = 1; }
  report.ended_at = new Date().toISOString();
  fs.writeFileSync(path.join(output,'run.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`local diagnostic ${report.local_result}: ${path.join(output,'run.json')}; acceptance unverified`);
  if (report.error) console.error(report.error);
});
