/**
 * Lint for a package that promises zero runtime dependencies and no `any`.
 *
 * Deliberately much smaller and much stricter than the sibling packages' configs. Those inherited a
 * large codebase and had to downgrade the type-aware rules to warnings to get green; this package
 * was written under `strict` from its first file, so the same rules can be errors, and a rule that
 * is an error is the only kind that stays true.
 *
 * `no-explicit-any` is an error rather than a warning because the package has none today. A promise
 * a project can currently keep should be enforced while that is still cheap.
 */

import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

const globals = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  fetch: 'readonly',
  Response: 'readonly',
  ReadableStream: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/__tests__/fixtures/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', project: './tsconfig.json' },
      globals,
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...eslint.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      // An unawaited promise in a CLI is output that arrives after the process decided to exit.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      // The CLI writes to stdout through `process.stdout.write` and `console.log`; everything else
      // returns data. A stray log from a library function is output somebody has to pipe away.
      'no-console': ['error', { allow: ['log', 'warn', 'error'] }],
    },
  },
  {
    files: ['src/__tests__/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', project: './tsconfig.json' },
      globals: { ...globals, describe: 'readonly', it: 'readonly', expect: 'readonly' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...eslint.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      // Tests build deliberately malformed inputs to prove the guards reject them, which is the
      // one place a cast earns its keep.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
];
