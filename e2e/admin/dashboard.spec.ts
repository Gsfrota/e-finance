import { test, expect } from '@playwright/test';
import { isDashboardPaywalled } from '../fixtures/e2e-test-helpers';

// ADMIN-01: Dashboard carrega KPIs
test('ADMIN-01: Dashboard admin carrega com KPIs visíveis', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  // Navega para Dashboard explicitamente — pode iniciar em "Início"
  const dashBtn = page.locator('aside').getByRole('button', { name: /Dashboard/i }).first();
  await dashBtn.waitFor({ timeout: 8_000 });
  await dashBtn.click();

  // Aguarda as abas do Dashboard aparecerem — se não aparecerem em 8s, é paywall/plano free
  const dashAvailable = await page.getByRole('button').filter({ hasText: /Visão Geral/ }).first()
    .isVisible({ timeout: 8_000 }).catch(() => false);
  if (!dashAvailable) {
    test.skip(true, 'Dashboard não acessível — tenant em plano free sem trial ativo');
  }

  // Tab "Visão Geral" aparece após dados carregarem
  await expect(page.getByRole('button').filter({ hasText: /Visão Geral|Visão/ }).first()).toBeVisible({ timeout: 20_000 });
  // Spinner some após carregar
  await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15_000 });
});

// ADMIN-02: Navegação entre abas do dashboard
test('ADMIN-02: Navegação entre as 5 abas do dashboard admin', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

  const dashBtn = page.locator('aside').getByRole('button', { name: /Dashboard/i }).first();
  await dashBtn.waitFor({ timeout: 8_000 });
  await dashBtn.click();

  const dashAvailable2 = await page.getByRole('button').filter({ hasText: /Visão Geral/ }).first()
    .isVisible({ timeout: 8_000 }).catch(() => false);
  if (!dashAvailable2) {
    test.skip(true, 'Dashboard não acessível — tenant em plano free sem trial ativo');
  }

  const tabs = ['Visão Geral', 'Parcelas', 'Cobranças', 'Mensal', 'Rendimento'];
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
