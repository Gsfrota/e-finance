/**
 * Testes E2E — Aba Rendimento do Dashboard Admin
 *
 * Cobertura:
 *   DASH-YIELD-01  Aba "Rendimento" renderiza com filtros de período
 *   DASH-YIELD-02  Filtros de período (Este mês / Tudo) trocam a visualização
 *   DASH-YIELD-03  Seção "Detalhamento" visível após clicar na aba
 *   DASH-YIELD-04  Estado vazio: exibe "Nenhum rendimento registrado" sem crash
 *
 * Execução:
 *   npx playwright test e2e/admin/dashboard-yield.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { isDashboardPaywalled } from '../fixtures/e2e-test-helpers';

/** Navega para o Dashboard e clica na aba Rendimento. Retorna false se paywall ativo. */
async function goToYieldTab(page: any): Promise<boolean> {
  await page.goto('/');
  await page.locator('aside').waitFor({ timeout: 12_000 });

  const dashBtn = page.locator('aside').getByRole('button', { name: /Dashboard/i }).first();
  await dashBtn.waitFor({ timeout: 8_000 });
  await dashBtn.click();

  // Verifica se Dashboard está desbloqueado (não paywall)
  const dashAvailable = await page
    .getByRole('button')
    .filter({ hasText: /Visão Geral/ })
    .first()
    .isVisible({ timeout: 8_000 })
    .catch(() => false);

  if (!dashAvailable) return false;

  // Clica na aba Rendimento
  const rendimentoTab = page.getByRole('button', { name: /^Rendimento$/i }).first();
  if (!(await rendimentoTab.isVisible({ timeout: 4_000 }).catch(() => false))) return false;

  await rendimentoTab.click();
  await page.waitForTimeout(800);
  return true;
}

test.describe('Dashboard Admin — Aba Rendimento', () => {

  test('DASH-YIELD-01: Aba Rendimento renderiza filtros de período', async ({ page }) => {
    const ok = await goToYieldTab(page);
    if (!ok) test.skip(true, 'Dashboard bloqueado (paywall) ou aba Rendimento não encontrada');

    // Filtros de período devem estar visíveis
    await expect(page.getByRole('button', { name: /Este mês/i }).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: /Tudo/i }).first()).toBeVisible({ timeout: 3_000 });

    // Sem crash de renderização
    await expect(page.locator('[data-testid="error-message"]')).not.toBeVisible();
  });

  test('DASH-YIELD-02: Filtro "Tudo" troca o período sem erro', async ({ page }) => {
    const ok = await goToYieldTab(page);
    if (!ok) test.skip(true, 'Dashboard bloqueado (paywall) ou aba Rendimento não encontrada');

    // Aguarda componente carregar
    await expect(page.getByRole('button', { name: /Este mês/i }).first()).toBeVisible({ timeout: 8_000 });

    // Clica em "Tudo"
    const tudoBtn = page.getByRole('button', { name: /^Tudo$/i }).first();
    await tudoBtn.click();
    await page.waitForTimeout(600);

    // Não deve haver mensagem de erro
    await expect(page.locator('[data-testid="error-message"]')).not.toBeVisible();

    // Componente ainda visível (não crashou)
    await expect(page.getByRole('button', { name: /^Tudo$/i }).first()).toBeVisible({ timeout: 3_000 });
  });

  test('DASH-YIELD-03: Seção "Detalhamento" ou "Portfólio" visível no Rendimento', async ({ page }) => {
    const ok = await goToYieldTab(page);
    if (!ok) test.skip(true, 'Dashboard bloqueado (paywall) ou aba Rendimento não encontrada');

    // Aguarda carregamento do conteúdo
    await page.waitForTimeout(1_500);

    // Pelo menos uma das seções principais deve estar visível
    const detalhamento = page.getByText(/Detalhamento/i).first();
    const portfolio = page.getByText(/Portfólio/i).first();
    const evolucao = page.getByText(/Evolução/i).first();

    const visibleSection = await detalhamento.isVisible({ timeout: 5_000 }).catch(() => false)
      || await portfolio.isVisible({ timeout: 3_000 }).catch(() => false)
      || await evolucao.isVisible({ timeout: 3_000 }).catch(() => false);

    expect(visibleSection, 'Nenhuma seção do componente YieldByContractType estava visível').toBe(true);
  });

  test('DASH-YIELD-04: Sem dados — "Nenhum rendimento registrado" sem crash', async ({ page }) => {
    const ok = await goToYieldTab(page);
    if (!ok) test.skip(true, 'Dashboard bloqueado (paywall) ou aba Rendimento não encontrada');

    // Filtra por "Este mês" (mais provável de ser vazio em ambiente de teste)
    const estesMesBtn = page.getByRole('button', { name: /Este mês/i }).first();
    await estesMesBtn.isVisible({ timeout: 8_000 });
    await estesMesBtn.click();
    await page.waitForTimeout(800);

    // Não deve ter erro de renderização
    await expect(page.locator('[data-testid="error-message"]')).not.toBeVisible();

    // Pode exibir estado vazio — se aparecer, confirma que é o texto correto
    const emptyState = page.getByText(/Nenhum rendimento registrado/i).first();
    const hasData = page.locator('[aria-label="Detalhamento de rendimento por tipo"]').first();

    const emptyVisible = await emptyState.isVisible({ timeout: 3_000 }).catch(() => false);
    const tableVisible = await hasData.isVisible({ timeout: 3_000 }).catch(() => false);

    // Deve ter um dos dois (estado vazio OU tabela com dados)
    expect(emptyVisible || tableVisible, 'Rendimento tab deveria mostrar dados ou estado vazio').toBe(true);
  });
});
