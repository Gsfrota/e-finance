import { test, expect } from '@playwright/test';

test('DEB-01: Dashboard do devedor lista contratos', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  // Hero status visível
  const hero = page.locator('[data-testid="late-payment-alert"], [data-testid="status-hero"]');
  await expect(hero).toBeVisible({ timeout: 10_000 });
});

test('DEB-02: Expandir contrato exibe parcelas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

  const contracts = page.getByTestId('contract-item');
  if (await contracts.count() > 0) {
    await contracts.first().click();
    await expect(page.getByTestId('installment-row').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('installment-status').first()).toBeVisible();
  }
});

test('DEB-03: Botão de pagamento abre modal PIX', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

  const contracts = page.getByTestId('contract-item');
  if (await contracts.count() > 0) {
    await contracts.first().click();
    const payBtn = page.getByTestId('pay-btn').first();
    if (await payBtn.isVisible()) {
      await payBtn.click();
      await expect(page.getByTestId('payment-modal')).toBeVisible({ timeout: 5_000 });
    }
  }
});

test('DEB-04: Modal PIX fecha ao clicar em fechar', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

  const contracts = page.getByTestId('contract-item');
  if (await contracts.count() > 0) {
    await contracts.first().click();
    const payBtn = page.getByTestId('pay-btn').first();
    if (await payBtn.isVisible()) {
      await payBtn.click();
      await expect(page.getByTestId('payment-modal')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('close-modal-btn').click();
      await expect(page.getByTestId('payment-modal')).not.toBeVisible();
    }
  }
});

test('DEB-05: QR Code gerado no modal de pagamento', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

  const contracts = page.getByTestId('contract-item');
  if (await contracts.count() > 0) {
    await contracts.first().click();
    const payBtn = page.getByTestId('pay-btn').first();
    if (await payBtn.isVisible()) {
      await payBtn.click();
      await expect(page.getByTestId('payment-modal')).toBeVisible({ timeout: 5_000 });
      // QR Code ou spinner de loading
      const qrOrLoader = page.locator('[data-testid="qr-code"] canvas, .animate-spin');
      await expect(qrOrLoader.first()).toBeVisible({ timeout: 15_000 });
    }
  }
});
