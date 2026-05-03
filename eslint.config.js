import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'node_modules', 'tests/fixtures/**', 'index.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUSTRA.md: "Strict TS, no any. Use unknown + narrowing."
      '@typescript-eslint/no-explicit-any': 'error',

      // CLAUSTRA.md: "Const arrow functions only." → require function expressions everywhere.
      'func-style': ['error', 'expression'],
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',

      // Catch-bug rules — every one of these has burned someone before
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Loosen one rule the codebase legitimately needs
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',

      // Style preferences
      'no-console': 'off', // CLI legitimately uses console for output
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'error',
      'object-shorthand': ['error', 'always'],
    },
  },
  {
    // Tests: relax the strict-promise rules — vi.spyOn etc. are awkward to type-check
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // Config files: skip type-aware rules (they aren't in the TS project)
    files: ['*.config.{ts,js,mjs}', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
