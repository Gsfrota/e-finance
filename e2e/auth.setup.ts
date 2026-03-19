import { test as setup, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';

const E2E_CREDS_MISSING =
  !process.env.TEST_ADMIN_EMAIL ||
  !process.env.TEST_ADMIN_PASSWORD ||
  !process.env.TEST_INVESTOR_EMAIL ||
  !process.env.TEST_INVESTOR_PASSWORD ||
  !process.env.TEST_DEBTOR_EMAIL ||
  !process.env.TEST_DEBTOR_PASSWORD;

// Skips gracefully when TEST_* env vars aren't configured.
// Configure in .env.local: TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD,
// TEST_INVESTOR_EMAIL, TEST_INVESTOR_PASSWORD, TEST_DEBTOR_EMAIL, TEST_DEBTOR_PASSWORD
setup('authenticate as admin', async ({ page }) => {
  if (E2E_CREDS_MISSING) {
    console.warn('⚠️  TEST_ADMIN_EMAIL/PASSWORD não configurado — setup de auth pulado.');
    mkdirSync('e2e/.auth', { recursive: true });
    writeFileSync('e2e/.auth/admin.json', JSON.stringify({ cookies: [], origins: [] }));
    return;
  }
  await page.goto('/');
  await page.getByPlaceholder('seu@email.com').fill(process.env.TEST_ADMIN_EMAIL!);
  await page.getByPlaceholder('Senha de acesso').fill(process.env.TEST_ADMIN_PASSWORD!);
  await page.getByTestId('login-btn').click();
  await page.waitForSelector('aside', { timeout: 15_000 });
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});

setup('authenticate as investor', async ({ page }) => {
  if (E2E_CREDS_MISSING) {
    mkdirSync('e2e/.auth', { recursive: true });
    writeFileSync('e2e/.auth/investor.json', JSON.stringify({ cookies: [], origins: [] }));
    return;
  }
  await page.goto('/');
  await page.getByPlaceholder('seu@email.com').fill(process.env.TEST_INVESTOR_EMAIL!);
  await page.getByPlaceholder('Senha de acesso').fill(process.env.TEST_INVESTOR_PASSWORD!);
  await page.getByTestId('login-btn').click();
  await page.waitForSelector('aside', { timeout: 15_000 });
  await page.context().storageState({ path: 'e2e/.auth/investor.json' });
});

setup('authenticate as debtor', async ({ page }) => {
  if (E2E_CREDS_MISSING) {
    mkdirSync('e2e/.auth', { recursive: true });
    writeFileSync('e2e/.auth/debtor.json', JSON.stringify({ cookies: [], origins: [] }));
    return;
  }
  await page.goto('/');
  await page.getByPlaceholder('seu@email.com').fill(process.env.TEST_DEBTOR_EMAIL!);
  await page.getByPlaceholder('Senha de acesso').fill(process.env.TEST_DEBTOR_PASSWORD!);
  await page.getByTestId('login-btn').click();
  await page.waitForSelector('aside', { timeout: 15_000 });
  await page.context().storageState({ path: 'e2e/.auth/debtor.json' });
});
