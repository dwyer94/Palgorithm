import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/rls/**/*.test.ts'],
    testTimeout: 30000,
  },
});
