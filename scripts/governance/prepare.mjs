#!/usr/bin/env node
import { main } from './lib/core.mjs';
import { prepareDependencies } from './lib/dependencies.mjs';

main(() => {
  if (process.argv.length !== 2) throw new Error('dependency preparation takes no arguments; run from repository root');
  const result = prepareDependencies(process.cwd());
  console.log(`application dependency preparation: ${result.status}; lifecycle scripts disabled`);
});
