import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/smoke-tests/__tests__/**/*.test.ts'],
    pool: 'forks',
    maxWorkers: 1,
    env: {
      NODE_OPTIONS: '--max-old-space-size=4096',
    },
    testTimeout: 60000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
  },
  resolve: {
    alias: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
  },
});
