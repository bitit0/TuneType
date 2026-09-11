import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  /*
   * Where the app is served from.
   *
   * Root in development and on any host that owns its domain. A GitHub project page lives under
   * /<repo>/, so the Pages workflow sets BASE_PATH and every emitted asset URL picks it up. The
   * router reads the same value back through import.meta.env.BASE_URL, so the two cannot disagree.
   */
  base: process.env.BASE_PATH ?? '/',

  plugins: [react()],
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Keeps the YouTube API key server-side and avoids CORS in dev.
      '/api': 'http://localhost:8787',
    },
  },
});
