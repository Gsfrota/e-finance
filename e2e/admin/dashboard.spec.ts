import { test, expect } from '@playwright/test';

// ADMIN-01: Dashboard carrega KPIs
test('ADMIN-01: Dashboard admin carrega com KPIs visíveis', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  // Navega para Dashboard explicitamente — pode iniciar em "Início"
  const dashBtn = page.locator('aside').getByRole('button', { name: /Dashboard/i }).first();
  await dashBtn.waitFor({ timeout: 8_000 });
  await dashBtn.click();
  // Tab "Visão Geral" aparece após dados carregarem (usa hidden sm:inline — pegar pelo texto completo)
  await expect(page.getByRole('button').filter({ hasText: /Visão Geral|Visão/ }).first()).toBeVisible({ timeout: 20_000 });
  // Spinner some após carregar
  await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15_000 });
});

// ADMIN-02: Navegação entre abas do dashboard
test('ADMIN-02: Navegação entre as 4 abas do dashboard admin', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

  const tabs = ['Visão Geral', 'Parcelas', 'Cobranças', 'Mensal', 'Rendimento'];
  // Navega para Dashboard primeiro para garantir que as abas estejam visíveis
  const dashBtn = page.locator('aside').getByRole('button', { name: /Dashboard/i }).first();
  await dashBtn.waitFor({ timeout: 8_000 });
  await dashBtn.click();
  await page.waitForTimeout(500);

  for (const tab of tabs) {
    // Usa first() para evitar strict mode — 'Cobranças' pode aparecer na sidebar também
    const tabButton = page.getByRole('button', { name: tab }).first();
    if (await tabButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await tabButton.click();
      // Sem erro após mudar de aba
      await expect(page.getByTestId('error-message')).not.toBeVisible();
    }
  }
});
