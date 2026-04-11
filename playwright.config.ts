import { defineConfig, devices } from '@playwright/test';
import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' });

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
    baseURL: 'http://localhost:4173',
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
      // Exclui: login (sem auth), debtor/investor (auth próprio), role-views (requer roles), screenshot (porta 3001)
      // Exclui deprecated: payment-flows (→ payment/installment-payment.spec.ts)
      // Exclui por role: payment-debtor-pix (→ chromium-debtor), role-isolation (→ chromium-investor/debtor)
      testIgnore: [
        /.*\/auth\/login\.spec\.ts/,
        /.*\/debtor\/.*/,
        /.*\/investor\/.*/,
        /.*\/e2e-full\/role-views\.spec\.ts/,
        /.*screenshot-header\.spec\.ts/,
        /.*\/e2e-full\/payment-flows\.spec\.ts/,
        /.*\/payment\/payment-debtor-pix\.spec\.ts/,
        /.*\/auth\/role-isolation\.spec\.ts/,
      ],
    },
    {
      name: 'chromium-investor',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/investor.json',
      },
      dependencies: ['setup'],
      testMatch: [
        /.*\/investor\/(?!dashboard).*\.spec\.ts/,
        /.*\/e2e-full\/role-views\.spec\.ts/,
        /.*\/reports\/investor-monthly\.spec\.ts/,
        /.*\/auth\/role-isolation\.spec\.ts/,
      ],
    },
    {
      name: 'chromium-debtor',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/debtor.json',
      },
      dependencies: ['setup'],
      testMatch: [
        /.*\/debtor\/(?!dashboard).*\.spec\.ts/,
        /.*\/e2e-full\/role-views\.spec\.ts/,
        /.*\/payment\/payment-debtor-pix\.spec\.ts/,
        /.*\/auth\/role-isolation\.spec\.ts/,
      ],
    },
  ],
  webServer: {
    command: 'npx vite --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
  },
});
