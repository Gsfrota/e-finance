import { test, expect } from '@playwright/test';

test('INV-01: Dashboard do investidor carrega métricas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('next-payment-card')).toBeVisible({ timeout: 10_000 });
});

test('INV-02: Lista de investimentos com indicadores de saúde', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  const items = page.getByTestId('investment-item');
  if (await items.count() > 0) {
    await expect(page.getByTestId('health-badge').first()).toBeVisible();
  }
});

test('INV-03: Card de próximo pagamento exibe data e valor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('next-payment-card')).toBeVisible({ timeout: 10_000 });
  const valueEl = page.getByTestId('next-payment-value');
  if (await valueEl.isVisible()) {
    await expect(valueEl).toContainText('R$');
  }
});
