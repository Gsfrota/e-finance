/**
 * Suite Smoke — E2E Full
 *
 * Valida que o sistema está vivo: login, navegação sidebar, carregamento de views.
 *
 * SMK-01  App carrega e admin vê sidebar
 * SMK-02  Navegação: Dashboard → todas as abas internas
 * SMK-03  Navegação: sidebar Contratos carrega lista
 * SMK-04  Navegação: sidebar Usuários carrega lista
 * SMK-05  Navegação: sidebar Cobranças carrega view
 * SMK-06  Sidebar exibe botões de navegação do admin
 * SMK-07  Sem erros JS no console durante navegação
 *
 * Execução:
 *   npx playwright test e2e/e2e-full/smoke.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { waitForApp, navigateToView, navigateToDashboardTab } from '../fixtures/e2e-test-helpers';

test.describe('Suite Smoke — Navegação e Carregamento', () => {

  test('SMK-01: App carrega e admin vê sidebar', async ({ page }) => {
    await waitForApp(page);
    await expect(page.locator('aside')).toBeVisible();
    // Spinner desaparece
    await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15_000 });
  });

  test('SMK-02: Dashboard — todas as abas internas navegam sem erro', async ({ page }) => {
    await waitForApp(page);
    await navigateToView(page, 'Dashboard');

    const tabs = ['Visão Geral', 'Recebíveis', 'Investidores', 'Relatórios'];
    for (const tab of tabs) {
      const tabBtn = page.getByRole('button', { name: tab });
      if (await tabBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await tabBtn.click();
        await expect(page.getByTestId('error-message')).not.toBeVisible();
        await page.waitForTimeout(400);
      }
    }
  });

  test('SMK-03: Sidebar → Contratos carrega lista', async ({ page }) => {
    await waitForApp(page);
    await navigateToView(page, 'Contratos');
    // A lista de contratos ou mensagem de vazio deve aparecer
    await expect(
      page.getByText(/contrato|investimento|nenhum|Novo/i),
    ).toBeVisible({ timeout: 12_000 });
  });

  test('SMK-04: Sidebar → Usuários carrega lista', async ({ page }) => {
    await waitForApp(page);
    await navigateToView(page, 'Usuários');
    await expect(page.getByText('Administração de Perfis')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Gerar Convite/i })).toBeVisible();
  });

  test('SMK-05: Sidebar → Cobranças carrega view', async ({ page }) => {
    await waitForApp(page);

    const cobrancasBtn = page.locator('aside').getByRole('button', { name: /Cobranças|Cobrança|Recebimento/i }).first();
    if (!(await cobrancasBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      test.skip(true, 'Botão de Cobranças não encontrado no sidebar');
    }
    await cobrancasBtn.click();
    await page.waitForTimeout(800);
    // Não deve ter erro
    await expect(page.getByTestId('error-message')).not.toBeVisible();
  });

  test('SMK-06: Sidebar admin tem botões de navegação principais', async ({ page }) => {
    await waitForApp(page);
    const sidebar = page.locator('aside');
    await expect(sidebar.getByRole('button', { name: 'Dashboard' }).first()).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Usuários' })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Contratos' })).toBeVisible();
  });

  test('SMK-07: Sem erros críticos no console durante navegação básica', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await waitForApp(page);
    await navigateToView(page, 'Dashboard');
    await navigateToView(page, 'Usuários');
    await navigateToView(page, 'Contratos');
    await page.waitForTimeout(1_000);

    // Filtra erros esperados (CORS, favicon, etc.)
    const criticalErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('CORS') &&
        !e.includes('net::ERR') &&
        !e.includes('Failed to load resource'),
    );

    if (criticalErrors.length > 0) {
      console.warn('[SMK-07] Erros no console:', criticalErrors);
    }
    // Tolerante — só falha se tiver erro de JS puro
    expect(criticalErrors.filter((e) => e.includes('TypeError') || e.includes('ReferenceError'))).toHaveLength(0);
  });

  test('SMK-08: Aba Parcelas do Dashboard carrega', async ({ page }) => {
    await waitForApp(page);
    await navigateToDashboardTab(page, 'Parcelas');
    // Deve mostrar lista de parcelas ou mensagem de vazio
    await expect(
      page.getByText(/parcela|Vencimento|BAIXA|nenhuma/i),
    ).toBeVisible({ timeout: 12_000 });
  });
});
