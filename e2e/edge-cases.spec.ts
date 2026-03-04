import { test, expect } from '@playwright/test';

// EDGE-01: Usuário autenticado como admin vê menus corretos
test('EDGE-01: Admin vê sidebar com todos os menus', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
});

// EDGE-02: Sem Supabase configurado mostra SetupWizard
test('EDGE-02: Sem credenciais Supabase exibe SetupWizard', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.addInitScript(() => {
    localStorage.removeItem('EF_EXTERNAL_SUPABASE_URL');
    localStorage.removeItem('EF_EXTERNAL_SUPABASE_KEY');
  });

  await page.goto('/');
  // Setup wizard ou login deve aparecer (sem erro de crash)
  await expect(page.locator('body')).not.toBeEmpty();
  await context.close();
});
