import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/snapshot-tests/__tests__/**/*.flowdeck.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1,
      },
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
