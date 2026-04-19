import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/snapshot-tests/__tests__/**/*.test.ts'],
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 1,
      },
    },
    env: {
      NODE_OPTIONS: '--max-old-space-size=4096',
    },
    testTimeout: 120000,
    hookTimeout: 120000,
    teardownTimeout: 10000,
  },
  resolve: {
    alias: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
  },
});
