import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'src',
  testMatch: '*.spec.ts',
  retries: 0,
  use: {
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
