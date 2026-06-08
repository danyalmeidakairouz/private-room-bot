// ESLint v9 flat config for this TypeScript (CommonJS) Discord bot.
  // Named .mjs so Node always parses it as ESM regardless of package.json type.
  // Uses only already-installed packages (@eslint/js, @typescript-eslint/*,
  // globals) so `npm run lint` needs no extra dependencies.
  import js from '@eslint/js';
  import tsParser from '@typescript-eslint/parser';
  import tsPlugin from '@typescript-eslint/eslint-plugin';
  import globals from 'globals';

  export default [
    { ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs'] },
    js.configs.recommended,
    {
      files: ['src/**/*.ts'],
      languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: { ...globals.node },
      },
      plugins: { '@typescript-eslint': tsPlugin },
      rules: {
        ...tsPlugin.configs.recommended.rules,
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
      },
    },
  ];
