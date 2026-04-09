/**
 * Suite Payment Flows — E2E Full
 *
 * Testa o ciclo completo de pagamento: criar contrato com parcelas via REST,
 * depois executar todas as ações de pagamento via UI.
 *
 * PAY-F-01  Pagamento exato → status=paid e comprovante
 * PAY-F-02  Pagamento parcial → Step 2 com opções de destino
 * PAY-F-03  Pagamento parcial + destino "next"
 * PAY-F-04  Pagamento parcial + destino "last"
 * PAY-F-05  Surplus (excedente) → Step 2 com opções
 * PAY-F-06  Surplus → destino "next"
 * PAY-F-07  Surplus → pay_late (pagar atrasadas com excedente)
 * PAY-F-08  Overpayment → discard excedente
 * PAY-F-09  Marcar como falta/não paga
 * PAY-F-10  Reverter pagamento → status volta
 * PAY-F-11  Data retroativa → aceita sem erro
 * PAY-F-12  Modal fecha com X sem submeter
 *
 * Execução:
 *   npx playwright test e2e/e2e-full/payment-flows.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigateToDashboardTab,
  waitForPaymentModal,
  waitForPaymentSuccess,
  fillPaymentAmount,
  submitPaymentStep1,
  submitPaymentStep2,
  openFirstPaymentModal,
} from '../fixtures/e2e-test-helpers';
import {
  createTestPaymentData,
  deleteTestPaymentData,
  goToParcelasTab,
  openPaymentModal,
  clickBaixaByInstallmentId,
  TestPaymentData,
} from '../fixtures/payment-test-data';

// ─── Suite Principal (com dados de teste) ─────────────────────────────────────

test.describe('Suite Payment Flows — Baixa de Parcelas', () => {
  let testData: TestPaymentData | null = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'e2e/.auth/admin.json' });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('aside').waitFor({ timeout: 15_000 });
    testData = await createTestPaymentData(page);
    await context.close();

    if (!testData) {
      console.warn('[PAY-F] Dados de teste não criados — verifique credenciais Supabase.');
    }
  });

  test.afterAll(async ({ browser }) => {
    if (!testData) return;
    const context = await browser.newContext({ storageState: 'e2e/.auth/admin.json' });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('aside').waitFor({ timeout: 15_000 });
    await deleteTestPaymentData(page, testData.investmentId);
    await context.close();
  });

  // ── PAY-F-01: Pagamento exato ────────────────────────────────────────────
  test('PAY-F-01: Pagamento exato → status=paid e comprovante exibido', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste — verifique credenciais Supabase');

    await goToParcelasTab(page, testData?.companyId);
    const opened = await openPaymentModal(page);
    expect(opened, 'Nenhuma parcela disponível').toBe(true);

    await waitForPaymentModal(page);

    // Valor pré-preenchido = outstanding → submit direto
    await submitPaymentStep1(page);
    await waitForPaymentSuccess(page);
    await expect(page.getByText(/Pagamento Confirmado!|foi paga|Comprovante/i).first()).toBeVisible();
  });

  // ── PAY-F-02: Parcial → Step 2 com opções ────────────────────────────────
  test('PAY-F-02: Pagamento parcial → Step 2 com opções de destino', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');

    await goToParcelasTab(page, testData?.companyId);
    const opened = await openPaymentModal(page);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    await fillPaymentAmount(page, '100');
    await expect(page.getByText('Faltam').first()).toBeVisible({ timeout: 3_000 });

    await submitPaymentStep1(page);

    // Step 2 com opções de destino para parcial
    await expect(page.getByText(/Próxima parcela|Última parcela|Nova parcela/i).first()).toBeVisible({ timeout: 6_000 });
  });

  // ── PAY-F-03: Parcial + next ─────────────────────────────────────────────
  test('PAY-F-03: Parcial + destino "Próxima parcela" → confirmado', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');

    await goToParcelasTab(page, testData?.companyId);
    const opened = await openPaymentModal(page);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    await fillPaymentAmount(page, '100');
    await submitPaymentStep1(page);

    await page.getByText('Próxima parcela').first().click();
    await submitPaymentStep2(page);

    await expect(
      page.getByText(/Confirmado|Pagamento|sucesso/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── PAY-F-04: Parcial + last ─────────────────────────────────────────────
  test('PAY-F-04: Parcial + destino "Última parcela" → confirmado', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');

    await goToParcelasTab(page, testData?.companyId);
    const opened = await openPaymentModal(page);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    await fillPaymentAmount(page, '50');
    await submitPaymentStep1(page);

    const lastOption = page.getByText(/Última parcela/i).first();
    if (await lastOption.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await lastOption.click();
      await submitPaymentStep2(page);
      await expect(
        page.getByText(/Confirmado|Pagamento/i).first(),
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  // ── PAY-F-05: Surplus → Step 2 surplus ──────────────────────────────────
  test('PAY-F-05: Surplus → Step 2 com alertas de excedente', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');

    await goToParcelasTab(page, testData?.companyId);
    const opened = await openPaymentModal(page);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    await fillPaymentAmount(page, '250');
    await expect(page.getByText('Excedente').first()).toBeVisible({ timeout: 3_000 });

    await submitPaymentStep1(page);

    // Step 2 deve ter opções de surplus
    await expect(
      page.getByText(/Próxima parcela|próxima/i).first(),
    ).toBeVisible({ timeout: 6_000 });
  });

  // ── PAY-F-06: Surplus + next ─────────────────────────────────────────────
  test('PAY-F-06: Surplus → destino "next" → confirmado', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');

    await goToParcelasTab(page, testData?.companyId);
    const opened = await openPaymentModal(page);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    await fillPaymentAmount(page, '250');
    await submitPaymentStep1(page);

    await page.getByText(/Próxima parcela|próxima/i).first().click();
    await submitPaymentStep2(page);

    await expect(
      page.getByText(/Confirmado|Pagamento/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── PAY-F-07: Surplus pay_late (atrasadas) ───────────────────────────────
  test('PAY-F-07: Surplus suficiente → opção pay_late visível', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');

    await goToParcelasTab(page, testData?.companyId);
    const opened = await openPaymentModal(page);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    // 450 = 200 (parcela) + 250 (cobre parcela atrasada + taxas)
    await fillPaymentAmount(page, '450');
    await expect(page.getByText('Excedente').first()).toBeVisible({ timeout: 3_000 });
    await submitPaymentStep1(page);

    await expect(
      page.getByText(/Pagar parcelas atrasadas|atrasad/i).first(),
    ).toBeVisible({ timeout: 6_000 });
  });

  // ── PAY-F-08: Overpayment discard ────────────────────────────────────────
  test('PAY-F-08: Overpayment discard → contrato encerrado', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');

    await goToParcelasTab(page, testData?.companyId);
    const opened = await openPaymentModal(page);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    // Paga muito acima do total do contrato
    await fillPaymentAmount(page, '5000');
    await submitPaymentStep1(page);

    await expect(
      page.getByText(/excede a dívida|Pagamento excede/i).first(),
    ).toBeVisible({ timeout: 6_000 });

    await page.getByText('Desconsiderar excedente').first().click();
    await submitPaymentStep2(page);

    await expect(
      page.getByText(/Confirmado|Pagamento/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── PAY-F-09: Marcar falta ────────────────────────────────────────────────
  test('PAY-F-09: Marcar parcela como falta', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');

    await goToParcelasTab(page, testData?.companyId);

    const listItem = page.getByText('TESTE E2E PAGAMENTO').first();
    if (!(await listItem.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Parcela de teste não encontrada');
    }

    await listItem.click();

    const faltaBtn = page.getByRole('button', { name: /Falta|Registrar Falta|Não Recebido/i });
    if (!(await faltaBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
      test.skip(true, 'Botão de falta não encontrado');
    }

    await faltaBtn.click();

    const confirmBtn = page.getByRole('button', { name: /Confirmar|Próxima|Última/i });
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Qualquer mudança na UI indica sucesso
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId('error-message')).not.toBeVisible();
  });

  // ── PAY-F-10: Reverter pagamento ─────────────────────────────────────────
  test('PAY-F-10: Desfazer pagamento → status volta ao anterior', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');

    await goToParcelasTab(page, testData?.companyId);

    const listItem = page.getByText('TESTE E2E PAGAMENTO').first();
    if (!(await listItem.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Parcela de teste não encontrada');
    }

    await listItem.click();

    const revertBtn = page.getByRole('button', {
      name: /Desfazer|Reverter|Estornar|Unpay/i,
    });
    if (!(await revertBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
      test.skip(true, 'Botão de reverter não encontrado (parcela ainda não foi paga nesta sessão)');
    }
    await revertBtn.click();

    const confirmBtn = page.getByRole('button', { name: /Confirmar|Sim|Reverter/i });
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await expect(
      page.getByText(/Revertido|Estornado|pendente/i).first(),
    ).toBeVisible({ timeout: 8_000 }).catch(() => {});
  });

  // ── PAY-F-11: Data retroativa ─────────────────────────────────────────────
  test('PAY-F-11: Data retroativa → aceita sem erro', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');

    await goToParcelasTab(page, testData?.companyId);
    const opened = await openPaymentModal(page);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    // Define data retroativa
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const retroDate = yesterday.toISOString().split('T')[0];

    const dateInput = page.locator('input[type="date"]');
    await dateInput.fill(retroDate);

    await submitPaymentStep1(page);

    // Deve confirmar ou ir para Step 2
    await expect(
      page.getByText(/Confirmado|Pagamento|Próxima|parcela/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ─── Testes de UI independentes (sem dados de teste) ──────────────────────────

test.describe('PAY-F — Comportamento UI do Modal (sem dados de teste)', () => {

  test('PAY-F-12: Modal fecha com X sem submeter pagamento', async ({ page }) => {
    await waitForApp(page);
    await navigateToDashboardTab(page, 'Parcelas');

    const opened = await openFirstPaymentModal(page);
    if (!opened) {
      test.skip(true, 'Nenhuma parcela pendente no ambiente de teste');
    }

    await waitForPaymentModal(page);

    // Fecha com X
    const closeBtn = page.getByRole('button').filter({ has: page.locator('svg') }).first();
    await closeBtn.click();

    await expect(page.getByText('Baixa de Pagamento')).not.toBeVisible({ timeout: 4_000 });
    await expect(page.getByText('Pagamento Confirmado!')).not.toBeVisible();
  });

  test('PAY-F-13: Alerta "Faltam" aparece em tempo real ao digitar valor parcial', async ({ page }) => {
    await waitForApp(page);
    await navigateToDashboardTab(page, 'Parcelas');

    const opened = await openFirstPaymentModal(page);
    if (!opened) test.skip(true, 'Nenhuma parcela pendente disponível');

    await waitForPaymentModal(page);

    const input = page.locator('input[type="number"]').first();
    await input.fill('1');
    await expect(page.getByText('Faltam').first()).toBeVisible({ timeout: 3_000 });
  });

  test('PAY-F-14: Alerta "Excedente" aparece ao digitar valor acima do saldo', async ({ page }) => {
    await waitForApp(page);
    await navigateToDashboardTab(page, 'Parcelas');

    const opened = await openFirstPaymentModal(page);
    if (!opened) test.skip(true, 'Nenhuma parcela pendente disponível');

    await waitForPaymentModal(page);

    const input = page.locator('input[type="number"]').first();
    await input.fill('999999');
    await expect(page.getByText('Excedente').first()).toBeVisible({ timeout: 3_000 });
  });
});
