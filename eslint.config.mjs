import tseslint from 'typescript-eslint';
import { moduleBoundaries, typesOnly } from './scripts/m0/eslint-rules.mjs';

export default [
  { ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/.runtime_*/**', '**/.*_*/**', 'docs/reviews/**'] },
  ...tseslint.configs.recommended,
  { linterOptions: { noInlineConfig: true } },
  {
    files: ['**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}'],
    plugins: { foundation: { rules: { 'module-boundaries': moduleBoundaries } } },
    rules: { 'foundation/module-boundaries': 'error', '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.{ts,cts,mts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-ignore': true, 'ts-expect-error': true, 'ts-nocheck': true,
      }],
    },
  },
  {
    files: ['packages/shared-types/**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}'],
    plugins: { contract: { rules: { 'types-only': typesOnly } } },
    rules: { 'contract/types-only': 'error' },
  },
];
