import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['client/src/**/*.test.ts', 'server/src/**/*.test.ts', 'shared/src/**/*.test.ts'],
  },
});
