import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

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
