import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ESLint } from 'eslint';
import { checkMilestoneProgress } from '../scripts/m0/check-workspace.mjs';

const cases = [
  ['apps/gateway/src/example.ts', "import mysql from 'mysql2/promise'; export { mysql };", 'foundation/module-boundaries'],
  ['apps/gateway/src/example.ts', "export type Driver = import('mysql2/promise').Pool;", 'foundation/module-boundaries'],
  ['packages/core-engine/src/example.ts', "export * from '../../../apps/gateway/src/server.js';", 'foundation/module-boundaries'],
  ['packages/core-engine/src/example.ts', "export * from '@mysql-mcp/admin-api';", 'foundation/module-boundaries'],
  ['apps/admin-ui/src/example.ts', "await import('@mysql-mcp/core-engine');", 'foundation/module-boundaries'],
  ['apps/admin-ui/src/example.ts', "require('../../gateway/src/server.js');", 'foundation/module-boundaries'],
  ['packages/shared-types/src/example.ts', "import type { ZodType } from 'zod'; export type T = ZodType;", 'foundation/module-boundaries'],
  ['packages/shared-types/src/example.ts', "export type { MetadataPool } from '../../core-engine/src/index.js';", 'foundation/module-boundaries'],
  ['packages/shared-types/src/example.ts', 'export enum State { Active }', 'contract/types-only'],
  ['packages/shared-types/src/example.ts', 'export const enum State { Active }', 'contract/types-only'],
  ['packages/shared-types/src/example.ts', 'export const state = 1;', 'contract/types-only'],
  ['apps/gateway/src/example.ts', 'export const unsafe = 1 as any;', '@typescript-eslint/no-explicit-any'],
  ['apps/gateway/src/example.ts', '// @ts-ignore\nexport const value = 1;', '@typescript-eslint/ban-ts-comment'],
  ['apps/gateway/src/example.ts', '// @ts-expect-error: test guard\nexport const value = 1;', '@typescript-eslint/ban-ts-comment'],
];
const eslint = new ESLint();
for (const [filePath, code, rule] of cases) {
  test(`reject ${filePath}: ${code.replaceAll('\n', ' ')}`, async () => {
    const [result] = await eslint.lintText(code, { filePath });
    assert(result.messages.some(({ ruleId }) => ruleId === rule), JSON.stringify(result.messages));
  });
}
test('permit a type-only public contract and the sole driver module', async () => {
  const [contract] = await eslint.lintText("export type { EntityId } from './index.js';", { filePath: 'packages/shared-types/src/example.ts' });
  const [driver] = await eslint.lintText("export { default as mysql } from 'mysql2/promise';", { filePath: 'packages/core-engine/src/metadata-pool.ts' });
  assert.equal(contract.errorCount + driver.errorCount, 0);
});

const todo = readFileSync(new URL('../TODO.md', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const latestCompleted = [...todo.matchAll(/^\| \*\*(M[0-7])\*\* \|[^\r\n]*\| `\[x\]` \|/gm)].at(-1)[1];

test('accept synchronized milestone status and badge in LF and CRLF documents', () => {
  const lf = (text) => text.replaceAll('\r\n', '\n');
  const crlf = (text) => lf(text).replaceAll('\n', '\r\n');
  assert.deepEqual(checkMilestoneProgress(lf(todo), lf(readme)), []);
  assert.deepEqual(checkMilestoneProgress(crlf(todo), crlf(readme)), []);
});

test('reject a README roadmap that misses a completed milestone', () => {
  const outdated = readme.replace(`- [x] **${latestCompleted}**`, `- [ ] **${latestCompleted}**`);
  assert.deepEqual(checkMilestoneProgress(todo, outdated), [
    `README.md Roadmap ${latestCompleted}: expected [x] from TODO.md, found [ ]`,
  ]);
});

test('reject missing or duplicate milestone rows', () => {
  const missingRow = todo.replace(/^\| \*\*M7\*\* \|[^\r\n]*\r?\n/m, '');
  assert.deepEqual(checkMilestoneProgress(missingRow, readme), ['TODO.md milestone table: missing valid M7 status']);
  const duplicateRow = readme.replace(/^- \[[x ]\] \*\*M7\*\*[^\r\n]*/m, '$&\n$&');
  assert.deepEqual(checkMilestoneProgress(todo, duplicateRow), ['README.md Roadmap: duplicate M7']);
});

test('reject a missing, duplicated or stale milestone badge and the old version marker', () => {
  const milestoneBadge = /^\[!\[Milestone\][^\r\n]*\r?\n/m;
  const expected = `README.md badges: expected exactly one milestone badge for ${latestCompleted} Done from TODO.md`;
  const staleId = latestCompleted === 'M0' ? 'M1' : 'M0';
  for (const outdated of [
    readme.replace(milestoneBadge, ''),
    readme.replace(milestoneBadge, '$&$&'),
    readme.replace(`milestone-${latestCompleted}%20Done-`, `milestone-${staleId}%20Done-`),
  ]) {
    assert.deepEqual(checkMilestoneProgress(todo, outdated), [expected]);
  }
  const legacyVersion = readme.replace(/(\/badge\/version-[\d.]+)-/, '$1--m0-');
  assert.deepEqual(checkMilestoneProgress(todo, legacyVersion), ['README.md badges: remove the obsolete --m0 marker']);
});
