import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'no-auth',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /.*\/(auth\/login|edge-cases)\.spec\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'chromium-investor',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/investor.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'chromium-debtor',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/debtor.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
  },
});
