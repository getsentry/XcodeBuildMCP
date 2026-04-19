import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['src/test-utils/vitest-executor-safety.setup.ts'],
    include: [
      'src/**/__tests__/**/*.test.ts', // Only __tests__ directories
    ],
    exclude: [
      'node_modules/**',
      'build/**',
      'coverage/**',
      'bundled/**',
      'example_projects/**',
      '.git/**',
      '**/*.d.ts',
      '**/temp_*',
      '**/full-output.txt',
      '**/experiments/**',
      '**/__pycache__/**',
      '**/dist/**',
      'src/smoke-tests/**',
      'src/snapshot-tests/**',
    ],
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 4,
      },
    },
    env: {
      NODE_OPTIONS: '--max-old-space-size=4096',
    },
    testTimeout: 30000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'build/**',
        'tests/**',
        'example_projects/**',
        '**/*.config.*',
        '**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      // Handle .js imports in TypeScript files
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
  },
});
