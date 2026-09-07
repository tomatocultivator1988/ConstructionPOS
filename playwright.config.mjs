import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './qa/playwright',
  timeout: 180000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'qa/playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.QA_BROWSER_URL || 'https://buildpro-pos.vercel.app',
    headless: process.env.PW_HEADED !== 'true',
    video: 'on',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    launchOptions: { slowMo: Number(process.env.PW_SLOW_MO || 650) },
  },
});
