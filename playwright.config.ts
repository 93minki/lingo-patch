import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.output/playwright-results',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: 'http://127.0.0.1:4174/stats',
    reuseExistingServer: false,
  },
});
