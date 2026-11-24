import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/cdk.out/**', '**/next-env.d.ts', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  { files: ['**/*.mjs', 'apps/api/api/*.js'], languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', module: 'writable', require: 'readonly' } }, rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    files: ['packages/domain/src/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@prisma/*', '@rr/*', 'node:*', 'pino*'] }],
      'no-restricted-globals': ['error', { name: 'process', message: 'The domain is given what it needs.' }],
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[object.name='Date'][property.name='now']", message: 'Pass the time in.' },
        { selector: "MemberExpression[object.name='Math'][property.name='random']", message: 'Decisions are repeatable.' },
      ],
    },
  },
);
