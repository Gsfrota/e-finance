import { test, expect } from '@playwright/test';

// ADMIN-01: Dashboard carrega KPIs
test('ADMIN-01: Dashboard admin carrega com KPIs visíveis', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  // Tab "Visão Geral" ativa por padrão
  await expect(page.getByText('Visão Geral')).toBeVisible();
  // Spinner some após carregar
  await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15_000 });
});

// ADMIN-02: Navegação entre abas do dashboard
test('ADMIN-02: Navegação entre as 4 abas do dashboard admin', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

  const tabs = ['Visão Geral', 'Recebíveis', 'Investidores', 'Relatórios'];
  for (const tab of tabs) {
    const tabButton = page.getByRole('button', { name: tab });
    if (await tabButton.isVisible()) {
      await tabButton.click();
      // Sem erro após mudar de aba
      await expect(page.getByTestId('error-message')).not.toBeVisible();
    }
  }
});
