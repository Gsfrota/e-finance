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
 * SMK-08  Aba Parcelas do Dashboard carrega
 *
 * Execução:
 *   npx playwright test e2e/e2e-full/smoke.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { waitForApp, navigateToView, navigateToDashboardTab, selectSpecificCompany, isDashboardPaywalled } from '../fixtures/e2e-test-helpers';

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

    const dashAvailable = await page.getByRole('button').filter({ hasText: /Visão Geral/ }).first()
      .isVisible({ timeout: 8_000 }).catch(() => false);
    if (!dashAvailable) {
      test.skip(true, 'Dashboard não acessível — tenant em plano free sem trial ativo');
    }

    const tabs = ['Visão Geral', 'Parcelas', 'Cobranças', 'Mensal', 'Rendimento'];
    for (const tab of tabs) {
      // Usa first() — 'Cobranças' pode aparecer na sidebar e nas abas
      const tabBtn = page.getByRole('button', { name: tab }).first();
      if (await tabBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await tabBtn.click();
        await expect(page.getByTestId('error-message')).not.toBeVisible();
        await page.waitForTimeout(400);
      }
    }
  });

  test('SMK-03: Sidebar → Contratos carrega lista', async ({ page }) => {
    await waitForApp(page);
    // Contratos é operacional e exige empresa ativa — selecionar antes de navegar
    await selectSpecificCompany(page);
    await navigateToView(page, 'Contratos');

    // Aceita: dados carregaram, empty state, ou nenhum erro visível
    // Falha apenas se a view crashar (error-message visível)
    await expect(page.getByTestId('error-message')).not.toBeVisible({ timeout: 25_000 });

    // Confirma que algum conteúdo renderizou (dados, empty state, ou botão de ação)
    const hasContent = await page.getByText(/contrato|investimento|nenhum|Novo/i)
      .isVisible({ timeout: 25_000 }).catch(() => false);
    const hasEmptyState = await page.getByText(/nenhum resultado|sem contratos|sem investimentos/i)
      .isVisible({ timeout: 3_000 }).catch(() => false);
    const hasActionButton = await page.getByRole('button', { name: /novo|adicionar|criar/i })
      .isVisible({ timeout: 3_000 }).catch(() => false);

    expect(hasContent || hasEmptyState || hasActionButton,
      'Contratos: nenhum conteúdo renderizou após 25s — possível crash'
    ).toBeTruthy();
  });

  test('SMK-04: Sidebar → Usuários carrega lista', async ({ page }) => {
    await waitForApp(page);
    // Usuários é operacional e exige empresa ativa — selecionar antes de navegar
    await selectSpecificCompany(page);
    await navigateToView(page, 'Usuários');

    await expect(page.getByTestId('error-message')).not.toBeVisible({ timeout: 25_000 });

    const hasTitle = await page.getByText('Administração de Perfis')
      .isVisible({ timeout: 25_000 }).catch(() => false);
    const hasContent = await page.getByText(/usuário|perfil|email|nenhum/i)
      .isVisible({ timeout: 3_000 }).catch(() => false);

    expect(hasTitle || hasContent,
      'Usuários: view não renderizou após 25s — possível crash'
    ).toBeTruthy();
  });

  test('SMK-05: Sidebar → Cobranças carrega view', async ({ page }) => {
    await waitForApp(page);

    const cobrancasBtn = page.locator('aside').getByRole('button', { name: /Cobranças|Cobrança|Recebimento/i }).first();
    const btnVisible = await cobrancasBtn.isVisible({ timeout: 5_000 }).catch(() => false);

    expect(btnVisible, 'Botão Cobranças não encontrado no sidebar — sidebar incompleto').toBeTruthy();

    await cobrancasBtn.click();
    await page.waitForTimeout(800);
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
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Captura erros JS não tratados (unhandled exceptions)
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await waitForApp(page);
    // Usuários e Contratos exigem empresa ativa — selecionar ANTES de navegar
    await selectSpecificCompany(page);
    await navigateToView(page, 'Usuários');
    await navigateToView(page, 'Contratos');
    // Dashboard pode redirecionar para Settings em plano free — não é erro crítico
    await navigateToView(page, 'Dashboard').catch(() => {});
    await page.waitForTimeout(1_000);

    // Filtra erros esperados (CORS, favicon, etc.)
    const criticalConsoleErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('CORS') &&
        !e.includes('net::ERR') &&
        !e.includes('Failed to load resource'),
    );

    if (criticalConsoleErrors.length > 0) {
      console.warn('[SMK-07] Erros console:', criticalConsoleErrors);
    }
    if (pageErrors.length > 0) {
      console.warn('[SMK-07] Erros JS não tratados:', pageErrors);
    }

    // Erros de JS puro (console)
    const jsErrors = ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'EvalError'];
    expect(
      criticalConsoleErrors.filter((e) => jsErrors.some((t) => e.includes(t))),
      'Erros JS críticos no console'
    ).toHaveLength(0);

    // Unhandled exceptions sempre falham
    expect(pageErrors, 'Exceções JS não tratadas na página').toHaveLength(0);
  });

  test('SMK-08: Aba Parcelas do Dashboard carrega', async ({ page }) => {
    // Fluxo real: usuário abre app → clica Dashboard na sidebar → aguarda dados → clica aba Parcelas
    await waitForApp(page);
    await navigateToView(page, 'Dashboard');
    await page.waitForTimeout(1_500);

    // Detecta paywall pela ausência das abas — tela em branco quando plano free
    const dashAvailable = await page.getByRole('button').filter({ hasText: /Visão Geral/ }).first()
      .isVisible({ timeout: 8_000 }).catch(() => false);
    if (!dashAvailable) {
      test.skip(true, 'Dashboard não acessível — tenant em plano free sem trial ativo');
    }

    // Aguarda diretamente o botão Parcelas ficar visível (tabs aparecem após dados carregarem).
    // Usa getByRole + accessible name para evitar falhas por whitespace no texto.
    const tabBtn = page.getByRole('button', { name: 'Parcelas' });
    await expect(tabBtn, 'Aba Parcelas não encontrada no Dashboard após 45s').toBeVisible({ timeout: 45_000 });

    await tabBtn.click();
    await page.waitForTimeout(500);

    await expect(page.getByTestId('error-message')).not.toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByText(/parcela|vencimento|baixa|nenhuma|pendente/i).first(),
      'Aba Parcelas não renderizou conteúdo após 25s'
    ).toBeVisible({ timeout: 25_000 });
  });
});

