import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
    env: {
      DATABASE_URL: process.env.CI
        ? process.env.DATABASE_URL!
        : 'postgresql://apple@localhost:5432/dignity9_test?schema=public',
      NODE_ENV: 'test',
    },
  },
});
