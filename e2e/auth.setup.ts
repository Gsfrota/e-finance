import { test as setup, expect } from '@playwright/test';

setup('authenticate as admin', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('E-mail Corporativo').fill(process.env.TEST_ADMIN_EMAIL!);
  await page.getByPlaceholder('Senha de Acesso').fill(process.env.TEST_ADMIN_PASSWORD!);
  await page.getByTestId('login-btn').click();
  await page.waitForSelector('aside', { timeout: 15_000 });
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});

setup('authenticate as investor', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('E-mail Corporativo').fill(process.env.TEST_INVESTOR_EMAIL!);
  await page.getByPlaceholder('Senha de Acesso').fill(process.env.TEST_INVESTOR_PASSWORD!);
  await page.getByTestId('login-btn').click();
  await page.waitForSelector('aside', { timeout: 15_000 });
  await page.context().storageState({ path: 'e2e/.auth/investor.json' });
});

setup('authenticate as debtor', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('E-mail Corporativo').fill(process.env.TEST_DEBTOR_EMAIL!);
  await page.getByPlaceholder('Senha de Acesso').fill(process.env.TEST_DEBTOR_PASSWORD!);
  await page.getByTestId('login-btn').click();
  await page.waitForSelector('aside', { timeout: 15_000 });
  await page.context().storageState({ path: 'e2e/.auth/debtor.json' });
});
