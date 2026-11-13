import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import parser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  {
    files: ['**/*.ts', '**/*.js'],
    plugins: {
      '@typescript-eslint': tseslint,
    },
    languageOptions: {
      parser: parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...eslint.configs.recommended.rules,
      // TypeScript already reports undefined identifiers, and no-undef cannot
      // resolve type-only names such as the NodeJS namespace.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // The base rule cannot see TypeScript parameter properties, so
      // `constructor(protected instances: string[])` is reported as unused.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      // stdout is the MCP transport, so console.log would corrupt the protocol.
      // console.error/warn write to stderr and are the correct logging channel.
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      indent: ['error', 2],
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
    },
  },
  {
    // Standalone CLI scripts: their console output is the whole point.
    files: ['test/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
];
