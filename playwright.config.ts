import { defineConfig, devices } from '@playwright/test';
import { config as dotenv } from 'dotenv';
dotenv({ path: '.env.local' });

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
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
      // auth/login usa browser.newContext() mas Playwright aplica storageState ao contexto
      // → usuário já logado, login page não aparece → excluir deste projeto
      testIgnore: /.*\/auth\/login\.spec\.ts/,
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
    command: 'npx vite --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
  },
});
