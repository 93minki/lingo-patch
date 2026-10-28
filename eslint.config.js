import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat';

export default [
  {
    ignores: [
      'node_modules/**',
      '.output/**',
      '.wxt/**',
      'dist/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
];
