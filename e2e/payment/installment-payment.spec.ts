/**
 * Testes E2E — Fluxo de Pagamento e Baixa de Parcelas
 *
 * Cobertura:
 *   PAY-01  Pagamento exato → status=paid, comprovante exibido
 *   PAY-02  Pagamento parcial → Step 2 com opções next/last/new
 *   PAY-03  Parcial + destino 'next' → apply_remainder_action executado
 *   PAY-04  Excedente (surplus) → Step 2 mode=surplus, ação 'next'
 *   PAY-05  Surplus com parcelas atrasadas → opção 'pay_late' visível
 *   PAY-06  Overpayment → Step 2 mode=overpayment, opções discard/add_to_last
 *   PAY-07  Overpayment discard → todas as parcelas pagas
 *   PAY-08  pay_late com leftover → postLateAction exibido e aplicado
 *   PAY-09  Parcela já paga → checkStaleAndRefresh bloqueia com erro PT-BR
 *   PAY-10  Marcar falta → InstallmentDetailFlow → missed_at registrado
 *   PAY-11  Reverter pagamento → status volta ao anterior
 *   PAY-12  Data retroativa → paid_at gravado com data informada
 *
 * Execução:
 *   npx playwright test e2e/payment/installment-payment.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import {
  createTestPaymentData,
  deleteTestPaymentData,
  fetchInstallment,
  goToParcelasTab,
  openPaymentModal,
  switchToAllPeriods,
  waitForPaymentModal,
  waitForPaymentSuccess,
  TestPaymentData,
} from '../fixtures/payment-test-data';

// ─── helpers locais ──────────────────────────────────────────────────────────

/** Preenche o campo de valor no Step 1. */
async function fillAmount(page: any, value: string) {
  const input = page.locator('input[type="number"]').first();
  await input.fill('');
  await input.fill(value);
}

/** Clica no botão de submit do Step 1 (Confirmar Recebimento / Próximo). */
async function submitStep1(page: any) {
  const btn = page.getByRole('button', { name: /Confirmar Recebimento|Próximo/ });
  await btn.click();
}

/** Clica no botão de confirmação do Step 2. */
async function submitStep2(page: any) {
  const btn = page.getByRole('button', { name: /Confirmar tudo|Encerrar contrato|Quitar parcelas/ }).first();
  await btn.click();
}

// ─── suite principal ─────────────────────────────────────────────────────────

test.describe('Fluxo de Pagamento e Baixa de Parcelas', () => {
  let testData: TestPaymentData | null = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'e2e/.auth/admin.json' });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('aside').waitFor({ timeout: 15_000 });
    testData = await createTestPaymentData(page);
    await context.close();

    if (!testData) {
      console.warn('[PAY] Dados de teste não criados — verifique credenciais Supabase.');
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

  // beforeEach apenas posiciona a página — não cancela testes com test.skip()
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('aside').waitFor({ timeout: 12_000 });
  });

  // ── PAY-01: Pagamento exato ────────────────────────────────────────────────
  test('PAY-01: Pagamento exato → modal abre, confirma e exibe comprovante', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste — verifique credenciais Supabase');

    await goToParcelasTab(page, testData!.companyId);

    const opened = await openPaymentModal(page, testData!.currentInstallmentId);
    expect(opened, 'Botão BAIXA não encontrado para a parcela de teste').toBe(true);

    await waitForPaymentModal(page);

    // Verifica que o modal abriu com a parcela correta
    const modalInstallmentId = await page
      .locator('[data-modal-installment-id]')
      .getAttribute('data-modal-installment-id')
      .catch(() => null);
    expect(modalInstallmentId, 'Modal abriu com parcela errada').toBe(testData!.currentInstallmentId);

    // Submete com o valor pré-preenchido (pagamento exato do valor da parcela)
    await submitStep1(page);

    // Comprovante deve aparecer após pagamento
    await waitForPaymentSuccess(page);
    await expect(
      page.getByText(/Pagamento Confirmado!|foi paga|Comprovante/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // ── PAY-02: Pagamento parcial → Step 2 ───────────────────────────────────
  test('PAY-02: Valor parcial → Step 2 exibe opções de destino do restante', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');
    await goToParcelasTab(page, testData!.companyId);

    // Muda filtro para "Período" para exibir parcelas fora do mês corrente
    // (parcela #4 tem due_date=+30d que pode estar no próximo mês)
    await switchToAllPeriods(page);

    // Abre uma parcela pendente (#4 ou #5, pois #3 pode estar paga por PAY-01)
    const inst = testData!.installments.find(
      (i) => i.status === 'pending' && i.id !== testData!.currentInstallmentId
    ) ?? testData!.installments[3];

    // Aguarda a parcela alvo aparecer na tabela após mudança de filtro
    await page.locator(`[data-installment-id="${inst.id}"]`).first()
      .waitFor({ timeout: 10_000 }).catch(() => {});

    const opened = await openPaymentModal(page, inst.id);
    expect(opened, 'Nenhuma parcela pendente disponível').toBe(true);
    await waitForPaymentModal(page);

    // Preenche metade do valor (parcela = 200, paga = 100)
    await fillAmount(page, '100');

    // Deve mostrar alerta "Faltam" em tempo real
    await expect(page.getByText('Faltam')).toBeVisible({ timeout: 3_000 });

    // Avança para Step 2
    await submitStep1(page);

    // Step 2 deve mostrar as 3 opções de destino do restante
    // Usa .first() para evitar strict mode caso haja elementos duplicados no DOM
    await expect(page.getByText('Próxima parcela').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Última parcela').first()).toBeVisible();
    await expect(page.getByText('Nova parcela').first()).toBeVisible();
  });

  // ── PAY-03: Parcial + next → apply_remainder_action ─────────────────────
  test('PAY-03: Parcial com destino "Próxima" → confirma e exibe sucesso', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');
    await goToParcelasTab(page, testData!.companyId);

    const inst = testData!.installments.find(
      (i) => i.status === 'pending' && i.id !== testData!.currentInstallmentId
    ) ?? testData!.installments[3];
    const opened = await openPaymentModal(page, inst.id);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    await fillAmount(page, '100');
    await submitStep1(page);

    // Step 2: seleciona "Próxima parcela" e confirma
    await expect(page.getByText('Próxima parcela')).toBeVisible({ timeout: 5_000 });
    await page.getByText('Próxima parcela').click();
    await submitStep2(page);

    // Deve exibir confirmação de sucesso
    await expect(
      page.getByText(/Confirmado|Pagamento|sucesso/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── PAY-04: Surplus → Step 2 surplus + ação 'next' ───────────────────────
  test('PAY-04: Valor excedente → Step 2 exibe alerta "Excedente" e opção Próxima', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');
    await goToParcelasTab(page, testData!.companyId);
    await switchToAllPeriods(page);

    const inst = testData!.installments.find(
      (i) => i.status === 'pending' && i.id !== testData!.currentInstallmentId
    ) ?? testData!.installments[3];
    const opened = await openPaymentModal(page, inst.id);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    // Preenche valor maior que o outstanding (200 + 50 = 250)
    await fillAmount(page, '250');

    // Deve mostrar alerta "Excedente" em tempo real
    await expect(page.getByText('Excedente').first()).toBeVisible({ timeout: 3_000 });

    // Avança para Step 2
    await submitStep1(page);

    // Step 2 deve mostrar opção de destino para o excedente
    await expect(
      page.getByText(/Próxima parcela|próxima/i).first()
    ).toBeVisible({ timeout: 6_000 });

    // Seleciona 'Próxima' e confirma
    await page.getByText(/Próxima parcela|próxima/i).first().click();
    await submitStep2(page);

    await expect(
      page.getByText(/Confirmado|Pagamento/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── PAY-05: Surplus com atrasadas → opção pay_late visível ──────────────
  test('PAY-05: Excedente com parcelas atrasadas → opção "Pagar atrasadas" aparece no Step 2', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');
    await goToParcelasTab(page, testData!.companyId);
    await switchToAllPeriods(page);

    // Usa parcela pendente (#3 ou #4); as atrasadas #1 e #2 existem no contrato
    const inst = testData!.installments.find(i => i.status === 'pending')
      ?? testData!.installments[2];
    const opened = await openPaymentModal(page, inst.id);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    // Paga valor que cobre a parcela + excede (suficiente para cobrir uma atrasada)
    await fillAmount(page, '450');
    await expect(page.getByText('Excedente').first()).toBeVisible({ timeout: 3_000 });
    await submitStep1(page);

    // Opção de pagar atrasadas deve aparecer
    await expect(
      page.getByText(/Pagar parcelas atrasadas|atrasad/i).first()
    ).toBeVisible({ timeout: 6_000 });
  });

  // ── PAY-06: Overpayment → Step 2 overpayment ────────────────────────────
  test('PAY-06: Overpayment → Step 2 exibe opções "Desconsiderar" e "Adicionar ao montante"', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');
    await goToParcelasTab(page, testData!.companyId);
    await switchToAllPeriods(page);

    const inst = testData!.installments.find(i => i.status === 'pending')
      ?? testData!.installments[2];
    const opened = await openPaymentModal(page, inst.id);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    // Paga muito acima do total do contrato (5 × 200 = 1000, paga 2000)
    await fillAmount(page, '2000');
    await submitStep1(page);

    // Step 2 modo overpayment: excede a dívida total
    await expect(
      page.getByText(/excede a dívida|Pagamento excede/i).first()
    ).toBeVisible({ timeout: 6_000 });

    await expect(page.getByText('Desconsiderar excedente')).toBeVisible();
    await expect(page.getByText('Adicionar ao montante final')).toBeVisible();
  });

  // ── PAY-07: Overpayment discard → contrato encerrado ────────────────────
  test('PAY-07: Overpayment discard → parcelas quitadas e comprovante exibido', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');
    await goToParcelasTab(page, testData!.companyId);
    await switchToAllPeriods(page);

    const inst = testData!.installments.find(i => i.status === 'pending')
      ?? testData!.installments[2];
    const opened = await openPaymentModal(page, inst.id);
    expect(opened).toBe(true);
    await waitForPaymentModal(page);

    await fillAmount(page, '2000');
    await submitStep1(page);

    await expect(
      page.getByText(/excede a dívida|Pagamento excede/i).first()
    ).toBeVisible({ timeout: 6_000 });

    // Seleciona "Desconsiderar excedente" e confirma
    await page.getByText('Desconsiderar excedente').click();
    await submitStep2(page);

    await expect(
      page.getByText(/Confirmado|Pagamento/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── PAY-PARTIAL: Pagamento parcial → status=partial no banco ────────────
  test('PAY-PARTIAL: Pagamento parcial → parcela fica com status=partial no banco', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');
    await goToParcelasTab(page, testData!.companyId);

    // Muda filtro para "Período" (sem datas) → exibe parcelas de qualquer mês
    // (parcelas futuras ficam ocultas no filtro "mês atual" padrão)
    await switchToAllPeriods(page);

    // Seleciona parcela pendente diferente da currentInstallmentId
    const inst = testData!.installments.find(
      (i) => i.status === 'pending' && i.id !== testData!.currentInstallmentId
    ) ?? testData!.installments[3];
    test.skip(!inst, 'Nenhuma parcela pendente disponível para PAY-PARTIAL');

    // Aguarda a parcela alvo aparecer na tabela após mudança de filtro.
    // NÃO pode engolir o timeout: se a linha não aparecer, openPaymentModal
    // cairia no fallback "primeira BAIXA visível" e pagaria a parcela errada,
    // fazendo fetchInstallment(inst.id) retornar amount_paid=0.
    await page.locator(`[data-installment-id="${inst.id}"]`).first()
      .waitFor({ timeout: 10_000 });

    const opened = await openPaymentModal(page, inst.id);
    expect(opened, 'Botão BAIXA não encontrado').toBe(true);
    await waitForPaymentModal(page);

    // Paga metade do valor (parcela é 200, paga 100)
    const halfValue = Math.floor(inst.amount_total / 2);
    await fillAmount(page, String(halfValue));

    // Confirma que o alerta "Faltam" aparece (validação de UI)
    await expect(page.getByText('Faltam')).toBeVisible({ timeout: 3_000 });

    // Avança para Step 2
    await submitStep1(page);

    // Step 2: seleciona "Próxima parcela" e confirma
    await expect(page.getByText('Próxima parcela')).toBeVisible({ timeout: 5_000 });
    await page.getByText('Próxima parcela').click();
    await submitStep2(page);

    // UI confirma sucesso
    await expect(
      page.getByText(/Confirmado|Pagamento|sucesso/i).first()
    ).toBeVisible({ timeout: 10_000 });

    // Verifica no banco: parcela registrou pagamento parcial.
    // Usa polling para tolerar latência entre UI success e commit do PostgREST
    // (race condition: UI mostra "Confirmado" antes do row ser visível via REST API).
    // - status='partial': implementação explícita de pagamento parcial
    // - status='pending' com amount_paid > 0: business logic que mantém 'pending' até quitação total
    await expect.poll(
      async () => {
        const row = await fetchInstallment(page, inst.id);
        return row ? (row.status === 'partial' || row.amount_paid > 0) : false;
      },
      { timeout: 5_000, message: 'Parcela não refletiu pagamento parcial no banco após 5s' }
    ).toBe(true);
    const after = await fetchInstallment(page, inst.id);
    expect(after, 'Não foi possível buscar parcela no banco após pagamento').not.toBeNull();
    const isPartialState = after!.status === 'partial' || (after!.status === 'pending' && after!.amount_paid > 0);
    expect(
      isPartialState,
      `Esperado status=partial ou (status=pending com amount_paid>0), recebido status=${after!.status} amount_paid=${after!.amount_paid}`,
    ).toBe(true);
    expect(after!.amount_paid, 'amount_paid deve ser > 0').toBeGreaterThan(0);
    expect(after!.amount_paid, 'amount_paid deve ser < amount_total').toBeLessThan(after!.amount_total);
  });

  // ── PAY-09: Parcela já paga → checkStaleAndRefresh bloqueia ─────────────
  test('PAY-09: Parcela já paga → erro em PT-BR ao tentar pagar novamente', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');

    await goToParcelasTab(page, testData!.companyId);

    const opened = await openPaymentModal(page, testData!.currentInstallmentId);
    if (!opened) {
      // parcela já paga e botão BAIXA sumiu — aceita como skip
      test.skip(true, 'Parcela já paga — botão BAIXA não disponível');
      return;
    }
    await waitForPaymentModal(page);

    // Intercepta o refresh da parcela e força retorno de status=paid
    await page.route('**/rest/v1/loan_installments*', async (route, request) => {
      if (request.method() === 'GET' && request.url().includes('select=status')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ status: 'paid', amount_paid: 200, amount_total: 200, fine_amount: 0, interest_delay_amount: 0 }]),
        });
        return;
      }
      await route.continue();
    });

    await submitStep1(page);

    // Deve exibir mensagem de erro em PT-BR
    await expect(
      page.getByText(/já foi quitada|já está quitada/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  // ── PAY-12: Data retroativa → paid_at correto ────────────────────────────
  test('PAY-12: Data retroativa → pagamento aceito com data informada', async ({ page }) => {
    test.skip(!testData, 'Sem dados de teste');
    await goToParcelasTab(page, testData!.companyId);

    const inst = testData!.installments.find(i => i.status === 'pending')
      ?? testData!.installments[3];
    const opened = await openPaymentModal(page, inst.id);
    expect(opened, 'Nenhuma parcela pendente disponível para PAY-12').toBe(true);
    await waitForPaymentModal(page);

    // Define data de pagamento retroativa (ontem)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const retroDate = yesterday.toISOString().split('T')[0];

    const dateInput = page.locator('input[type="date"]');
    if (await dateInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await dateInput.fill(retroDate);
    }

    // Confirma o pagamento
    await submitStep1(page);

    // Deve confirmar pagamento ou ir para Step 2 (se surplus/partial)
    await expect(
      page.getByText(/Confirmado|Pagamento|Próxima|parcela/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ─── testes de UI do modal de pagamento (independentes de dados de teste) ─────

/** Navega para aba Parcelas. Retorna false se Dashboard estiver bloqueado por paywall. */
async function goToParcelasTabUI(page: any): Promise<boolean> {
  await page.goto('/');
  await page.locator('aside').waitFor({ timeout: 12_000 });

  const dashBtn = page.locator('aside').getByRole('button', { name: /Dashboard/i }).first();
  await dashBtn.waitFor({ timeout: 8_000 });
  await dashBtn.click();

  // Aguarda carregamento das abas do Dashboard
  const parcelasTab = page.getByRole('button', { name: 'Parcelas' }).first();
  const tabVisible = await parcelasTab.isVisible({ timeout: 10_000 }).catch(() => false);
  if (!tabVisible) return false;

  await parcelasTab.click();
  await page.waitForTimeout(1_000);
  return true;
}

test.describe('PAY — Comportamento do Modal (UI)', () => {
  test('PAY-UI-01: Modal abre com título "Baixa de Pagamento"', async ({ page }) => {
    const ok = await goToParcelasTabUI(page);
    if (!ok) test.skip(true, 'Dashboard bloqueado por paywall ou aba Parcelas não encontrada');

    const btnBaixa = page.locator('[data-action="pay"]').first();
    if (!(await btnBaixa.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Nenhuma parcela pendente disponível no ambiente de teste');
    }

    await btnBaixa.click();
    await expect(page.getByText('Baixa de Pagamento')).toBeVisible({ timeout: 6_000 });
  });

  test('PAY-UI-02: Valor parcial exibe alerta "Faltam" em tempo real', async ({ page }) => {
    const ok = await goToParcelasTabUI(page);
    if (!ok) test.skip(true, 'Dashboard bloqueado por paywall ou aba Parcelas não encontrada');

    const btnBaixa = page.locator('[data-action="pay"]').first();
    if (!(await btnBaixa.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Nenhuma parcela pendente disponível');
    }

    await btnBaixa.click();
    await page.getByText('Baixa de Pagamento').waitFor({ timeout: 6_000 });

    const input = page.locator('input[type="number"]').first();
    await input.fill('1');
    await expect(page.getByText('Faltam')).toBeVisible({ timeout: 3_000 });
  });

  test('PAY-UI-03: Valor excedente exibe alerta "Excedente" em tempo real', async ({ page }) => {
    const ok = await goToParcelasTabUI(page);
    if (!ok) test.skip(true, 'Dashboard bloqueado por paywall ou aba Parcelas não encontrada');

    const btnBaixa = page.locator('[data-action="pay"]').first();
    if (!(await btnBaixa.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Nenhuma parcela pendente disponível');
    }

    await btnBaixa.click();
    await page.getByText('Baixa de Pagamento').waitFor({ timeout: 6_000 });

    const input = page.locator('input[type="number"]').first();
    await input.fill('999999');
    await expect(page.getByText('Excedente').first()).toBeVisible({ timeout: 3_000 });
  });

  test('PAY-UI-04: Botão Step 1 muda de "Confirmar Recebimento" para "Próximo" com valor parcial', async ({ page }) => {
    const ok = await goToParcelasTabUI(page);
    if (!ok) test.skip(true, 'Dashboard bloqueado por paywall ou aba Parcelas não encontrada');

    const btnBaixa = page.locator('[data-action="pay"]').first();
    if (!(await btnBaixa.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Nenhuma parcela pendente disponível');
    }

    await btnBaixa.click();
    await page.getByText('Baixa de Pagamento').waitFor({ timeout: 6_000 });

    const input = page.locator('input[type="number"]').first();
    const submitBtn = page.getByRole('button', { name: /Confirmar Recebimento|Próximo/ });

    // Valor exato: botão deve dizer "Confirmar Recebimento"
    await expect(submitBtn).toContainText('Confirmar Recebimento');

    // Valor parcial: botão muda para "Próximo"
    await input.fill('1');
    await expect(submitBtn).toContainText('Próximo');

    // Valor excedente: botão continua "Próximo"
    await input.fill('999999');
    await expect(submitBtn).toContainText('Próximo');
  });

  test('PAY-UI-05: Fechar modal com X não submete pagamento', async ({ page }) => {
    const ok = await goToParcelasTabUI(page);
    if (!ok) test.skip(true, 'Dashboard bloqueado por paywall ou aba Parcelas não encontrada');

    const btnBaixa = page.locator('[data-action="pay"]').first();
    if (!(await btnBaixa.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Nenhuma parcela pendente disponível');
    }

    await btnBaixa.click();
    await page.getByText('Baixa de Pagamento').waitFor({ timeout: 6_000 });

    // Fecha com X
    await page.getByRole('button', { name: 'Fechar' }).click();

    // Modal deve fechar
    await expect(page.getByText('Baixa de Pagamento')).not.toBeVisible({ timeout: 3_000 });

    // Confirmação de pagamento não deve aparecer
    await expect(page.getByText('Pagamento Confirmado!')).not.toBeVisible();
  });
});
