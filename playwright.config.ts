import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5189',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node --import tsx server/index.ts',
      url: 'http://127.0.0.1:5191/healthz',
      reuseExistingServer: true,
      timeout: 20_000,
    },
    {
      command: 'node node_modules/vite/bin/vite.js',
      url: 'http://127.0.0.1:5189',
      reuseExistingServer: true,
      timeout: 20_000,
    },
  ],
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        channel: 'chrome',
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
});
