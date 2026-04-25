import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'dist/**',
      'coverage/**',
      'src/core/generated-plugins.ts',
      'src/core/generated-resources.ts',
      'src/version.ts',
    ],
  },
  {
    // TypeScript files in src/ directory (covered by tsconfig.json)
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.json'],
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: 'never',
          varsIgnorePattern: 'never',
        },
      ],
      'no-console': ['warn', { allow: ['error'] }],

      // Prevent dangerous type casting anti-patterns (errors)
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        {
          assertionStyle: 'as',
          objectLiteralTypeAssertions: 'never',
        },
      ],
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // Prevent specific anti-patterns we found
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],

      // Encourage best practices (warnings - can be gradually fixed)
      '@typescript-eslint/prefer-as-const': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',

      // Prevent barrel imports to maintain architectural improvements
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/utils/index.js',
                '../utils/index.js',
                '../../utils/index.js',
                '../../../utils/index.js',
                '**/utils/index.ts',
                '../utils/index.ts',
                '../../utils/index.ts',
                '../../../utils/index.ts',
              ],
              message:
                'Barrel imports from utils/index are prohibited. Use focused facade imports instead (e.g., utils/logging/index.ts, utils/execution/index.ts).',
            },
            {
              group: ['./**/*.js', '../**/*.js'],
              message:
                'Import TypeScript files with .ts extension, not .js. This ensures compatibility with native TypeScript runtimes like Bun and Deno. Change .js to .ts in your import path.',
            },
          ],
        },
      ],
    },
  },
  {
    // JavaScript and TypeScript files outside the main project (scripts/, etc.)
    files: ['**/*.{js,ts}'],
    ignores: ['src/**/*', '**/*.test.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: tseslint.parser,
      // No project reference for scripts - use standalone parsing
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      // Relaxed TypeScript rules for scripts since they're not in the main project
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: 'never',
          varsIgnorePattern: 'never',
        },
      ],
      'no-console': 'off', // Scripts are allowed to use console

      // Disable project-dependent rules for scripts
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
    },
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.test.json',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'prefer-const': 'off',

      // Relax unsafe rules for tests - tests often need more flexibility
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
];
