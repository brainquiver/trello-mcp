import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// The smoke suite reads its Trello account from .env. Without one it skips itself.
const dotenvResult = config();

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    env: dotenvResult.parsed,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
});
