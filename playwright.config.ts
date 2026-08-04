import { defineConfig, devices } from '@playwright/test';
import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' });

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';
const usesExternalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['json', { outputFile: `test-results/${process.env.PLAYWRIGHT_JSON_TIER ?? 'ci'}-results.json` }],
      ]
    : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'on',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'no-auth',
      use: { ...devices['Desktop Chrome'] },
      // auth/login testa fluxo de login — não precisa de auth
      // edge-cases precisa de auth (EDGE-01 verifica sidebar) → roda só em chromium
      testMatch: /.*\/auth\/login\.spec\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
      dependencies: ['setup'],
      // Exclui: login (sem auth), screenshot (porta 3001)
      // Exclui deprecated: payment-flows (→ payment/installment-payment.spec.ts)
      testIgnore: [
        /.*\/auth\/login\.spec\.ts/,
        /.*screenshot-header\.spec\.ts/,
        /.*\/e2e-full\/payment-flows\.spec\.ts/,
      ],
    },
  ],
  webServer: usesExternalServer
    ? undefined
    : {
        command: 'npx vite --port 4173',
        url: baseURL,
        reuseExistingServer: true,
      },
});
