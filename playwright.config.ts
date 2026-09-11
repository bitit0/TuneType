import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end config.
 *
 * One browser, one project. The unit suite already covers the parsing, scoring and matching
 * arithmetic in isolation; what it cannot cover is whether those pieces are wired to each other,
 * which is the only thing these tests are for.
 *
 * Every external service is intercepted in the tests themselves rather than reached. LRCLIB,
 * YouTube and Firebase are all third parties this project does not control, and a suite that goes
 * red because someone else had a bad morning teaches nobody anything.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /*
   * The client alone. Every /api call is stubbed at the browser, so the Express server would only
   * sit there unused — and starting it would drag Firebase credentials and an API key into a suite
   * that is supposed to run on a fresh clone.
   */
  webServer: {
    command: 'npm run dev:client',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
