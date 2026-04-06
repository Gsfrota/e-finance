import { test, expect } from '@playwright/test';
import { selectSpecificCompany } from '../fixtures/e2e-test-helpers';

// ADMIN-03: Admin visualiza página de usuários
test('ADMIN-03: Admin acessa gerenciamento de usuários', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  await selectSpecificCompany(page);

  await page.getByRole('button', { name: 'Usuários' }).click();
  await expect(page.getByText('Administração de Perfis')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Gerar Convite/i })).toBeVisible();
});

// ADMIN-04: Admin abre modal de convite
test('ADMIN-04: Modal de geração de convite abre corretamente', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  await selectSpecificCompany(page);

  await page.getByRole('button', { name: 'Usuários' }).click();
  await expect(page.getByText('Administração de Perfis')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Gerar Convite/i }).click();

  await expect(page.getByText('Gerar Convite de Acesso')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByPlaceholder('Nome Completo')).toBeVisible();
  await expect(page.getByPlaceholder('E-mail')).toBeVisible();
});

// ADMIN-05: Filtros de busca funcionam
test('ADMIN-05: Filtro de busca por nome funciona', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  await selectSpecificCompany(page);

  await page.getByRole('button', { name: 'Usuários' }).click();
  await expect(page.getByText('Administração de Perfis')).toBeVisible({ timeout: 10_000 });

  // Digitar nome inexistente deve resultar em lista vazia
  await page.getByPlaceholder(/Buscar/i).fill('UsuarioQueNaoExiste12345');
  // Cards de usuário devem desaparecer
  await expect(page.getByTestId('edit-user-btn')).not.toBeVisible();
});

// EDGE: Devedor não vê menu de admin
test('EDGE-01: Usuário admin vê menus de Usuários e Contratos', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Usuários' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Contratos' })).toBeVisible();
});
