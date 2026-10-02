#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { load, statusMarkdown, main } from './lib/core.mjs';
import { readEvidence } from './lib/evidence.mjs';

main(() => {
  const root = process.cwd(), args = process.argv.slice(2), data = load(root);
  for (let i=0;i<args.length;i++) {
    if (args[i] === '--run') { if (!args[++i]) throw new Error('--run requires report path'); }
    else if (!['--write','--check'].includes(args[i])) throw new Error(`unknown option: ${args[i]}`);
  }
  if (args.includes('--write') && args.includes('--check')) throw new Error('--write and --check are exclusive');
  const markdown = statusMarkdown(data), target = path.join(root,'docs/FEATURE_STATUS.md');
  if (args.includes('--write')) fs.writeFileSync(target,markdown);
  else if (args.includes('--check')) { if (fs.readFileSync(target,'utf8') !== markdown) throw new Error('derived FEATURE_STATUS.md differs'); }
  else console.log(markdown);
  if (args.includes('--run')) {
    readEvidence(root, data, args[args.indexOf('--run')+1]);
    console.log('Local verification: recorded executions and artifacts consistent (unauthenticated diagnostic, NOT independent CI proof). Acceptance: unverified; manual/real MySQL/client acceptance NOT granted.');
  }
});
