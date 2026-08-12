import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['node_modules/**', '.next/**', 'dist/**'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: false,
      }],
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // Worker registration policy: every BullMQ worker must go through
    // createPipelineWorker (lib/pipeline-worker.ts) so error taxonomy,
    // budget gates, and credit release cannot drift apart per worker.
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['node_modules/**', '.next/**', 'dist/**', 'lib/pipeline-worker.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "NewExpression[callee.name='Worker']",
        message: 'Do not instantiate BullMQ Worker directly. Register through createPipelineWorker() in lib/pipeline-worker.ts so error classification, budget enforcement, and credit release stay unified.',
      }],
    },
  },
];
