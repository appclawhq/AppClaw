import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@appclaw/core/agent-runtime': resolve(__dirname, '../core/src/agent-runtime/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
