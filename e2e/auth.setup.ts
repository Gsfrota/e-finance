import { test as setup } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';

function writeEmptyAuth(path: string) {
  mkdirSync('e2e/.auth', { recursive: true });
  writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }));
}

async function loginAs(page: any, email: string, password: string, authPath: string) {
  await page.goto('/');
  await page.getByPlaceholder('seu@email.com').fill(email);
  await page.getByPlaceholder('Senha de acesso').fill(password);
  await page.getByTestId('login-btn').click();
  await page.waitForSelector('aside', { timeout: 15_000 });
  await page.context().storageState({ path: authPath });
}

// Cada role é configurada independentemente.
// Configure em .env.local: TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD,
// TEST_INVESTOR_EMAIL, TEST_INVESTOR_PASSWORD, TEST_DEBTOR_EMAIL, TEST_DEBTOR_PASSWORD

setup('authenticate as admin', async ({ page }) => {
  if (!process.env.TEST_ADMIN_EMAIL || !process.env.TEST_ADMIN_PASSWORD) {
    console.warn('⚠️  TEST_ADMIN_EMAIL/PASSWORD não configurado — auth de admin pulado.');
    writeEmptyAuth('e2e/.auth/admin.json');
    return;
  }
  await loginAs(page, process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD, 'e2e/.auth/admin.json');
});

setup('authenticate as investor', async ({ page }) => {
  if (!process.env.TEST_INVESTOR_EMAIL || !process.env.TEST_INVESTOR_PASSWORD) {
    console.warn('⚠️  TEST_INVESTOR_EMAIL/PASSWORD não configurado — auth de investor pulado.');
    writeEmptyAuth('e2e/.auth/investor.json');
    return;
  }
  await loginAs(page, process.env.TEST_INVESTOR_EMAIL, process.env.TEST_INVESTOR_PASSWORD, 'e2e/.auth/investor.json');
});

setup('authenticate as debtor', async ({ page }) => {
  if (!process.env.TEST_DEBTOR_EMAIL || !process.env.TEST_DEBTOR_PASSWORD) {
    console.warn('⚠️  TEST_DEBTOR_EMAIL/PASSWORD não configurado — auth de debtor pulado.');
    writeEmptyAuth('e2e/.auth/debtor.json');
    return;
  }
  await loginAs(page, process.env.TEST_DEBTOR_EMAIL, process.env.TEST_DEBTOR_PASSWORD, 'e2e/.auth/debtor.json');
});
