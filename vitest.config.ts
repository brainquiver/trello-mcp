import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// The smoke suite reads the test account from .env.ci, so a personal .env never reaches the
// test boards. Without the file the suite skips itself.
const dotenvResult = config({ path: '.env.ci' });

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    // A smoke hook starts a server or archives every card the suite made.
    hookTimeout: 120000,
    env: dotenvResult.parsed,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
});
