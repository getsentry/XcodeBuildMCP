import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['src/test-utils/vitest-executor-safety.setup.ts'],
    include: ['src/snapshot-tests/__tests__/json-fixture-schema.test.ts'],
    pool: 'threads',
    maxWorkers: 1,
    env: {
      NODE_OPTIONS: '--max-old-space-size=4096',
    },
    testTimeout: 30000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
  },
  resolve: {
    alias: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
  },
});
