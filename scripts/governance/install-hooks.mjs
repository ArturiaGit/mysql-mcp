#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { git, main } from './lib/core.mjs';
main(() => {
  if (process.argv.length > 2) throw new Error('no options supported; invocation explicitly opts in to local hook installation');
  const root = process.cwd();
  const current = git(root,['config','--get','core.hooksPath'],true);
  if (current && current !== '.githooks') throw new Error(`existing hooksPath retained: ${current}`);
  const old = path.join(git(root,['rev-parse','--absolute-git-dir']),'hooks');
  if (!current && fs.existsSync(old) && fs.readdirSync(old).some(n => !n.endsWith('.sample'))) throw new Error('existing hooks retained; manual integration required');
  for (const name of ['pre-commit','commit-msg','pre-push']) {
    const file = path.join(root,'.githooks',name);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error(`missing hook: ${name}`);
    fs.chmodSync(file,0o755);
  }
  git(root,['config','--local','core.hooksPath','.githooks']);
  console.log('Repository-local hooksPath=.githooks; hooks remain bypassable and do not replace remote protection.');
});
