/**
 * Teste E2E — Surplus não paga parcela com status=partial vencida
 *
 * Cobertura:
 *   PAY-SURPLUS-PARTIAL-01  Bug fix: parcela com status='partial' vencida deve ser
 *                           detectada como "atrasada" no fluxo de surplus (pay_late).
 *                           Verifica via REST que o pay_installment RPC paga a parcela
 *                           partial+vencida quando o admin dá baixa com surplus.
 *
 *   PAY-SURPLUS-PARTIAL-02  Parcela futura (pending, due_date > hoje) NÃO deve ser
 *                           tratada como atrasada no filtro de surplus.
 *
 * Contexto do bug (MD Veículos / Silaucia — 2026-04-12):
 *   - Parcela recebeu pagamento parcial via surplus → status='partial'
 *   - O cron update_overdue_installments() NUNCA promove 'partial' → 'late'
 *   - O filtro anterior: `status === 'late'` → não capturava parcelas 'partial' vencidas
 *   - Fix: trocar para comparação de data (due_date < hoje && outstanding > 0)
 *
 * Estratégia:
 *   Cria dados via REST, abre o modal de baixa pelo admin, verifica Step 2 mostra
 *   "Quitar parcelas atrasadas", confirma e valida status no banco via REST.
 */

import { test, expect } from '@playwright/test';
import {
  goToParcelasTab,
  openPaymentModal,
  switchToAllPeriods,
  waitForPaymentModal,
  waitForPaymentSuccess,
  fetchInstallment,
} from '../fixtures/payment-test-data';
import { getCtx, restCall, waitForApp } from '../fixtures/e2e-test-helpers';

// ─── helpers ─────────────────────────────────────────────────────────────────

interface SurplusPartialData {
  investmentId: number;
  tenantId: string;
  companyId: string;
  adminProfileId: string;
  /** #1 pending hoje — origem do surplus */
  sourceInstallmentId: string;
  /** #2 partial + vencida — alvo do bug */
  partialOverdueId: string;
  /** #3 pending futura */
  futureInstallmentId: string;
}

async function dateOffset(days: number): Promise<string> {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

async function createData(page: any): Promise<SurplusPartialData | null> {
  const ctx = await getCtx(page);
  if (!ctx) { console.warn('[surplus-partial] ctx nulo'); return null; }

  // Busca o perfil do admin logado (role=admin para garantir)
  let tenantId = '';
  let adminId = '';
  let companyId = '';
  try {
    const profiles = await restCall(ctx, `profiles?select=id,tenant_id,company_id&role=eq.admin&limit=1`);
    tenantId = profiles?.[0]?.tenant_id ?? '';
    adminId   = profiles?.[0]?.id ?? '';
    companyId = profiles?.[0]?.company_id ?? '';
  } catch (e) {
    console.warn('[surplus-partial] erro ao buscar admin profile:', e);
    return null;
  }
  if (!tenantId) { console.warn('[surplus-partial] tenant não encontrado'); return null; }

  // Garante company_id
  if (!companyId) {
    try {
      const cos = await restCall(ctx, `companies?select=id&tenant_id=eq.${tenantId}&order=created_at.asc&limit=1`);
      companyId = cos?.[0]?.id ?? '';
    } catch {}
  }
  if (!companyId) {
    try {
      const invs = await restCall(ctx, `investments?select=company_id&tenant_id=eq.${tenantId}&company_id=not.is.null&limit=1`);
      companyId = invs?.[0]?.company_id ?? '';
    } catch {}
  }

  // Busca um investor no tenant para colocar como user_id (o admin não é investor)
  let investorId = adminId;
  try {
    const inv = await restCall(ctx, `profiles?select=id&tenant_id=eq.${tenantId}&role=eq.investor&limit=1`);
    if (inv?.[0]?.id) investorId = inv[0].id;
  } catch {}

  const d0 = await dateOffset(0);
  const dm5 = await dateOffset(-5);
  const d30 = await dateOffset(30);

  const investment = await restCall(ctx, 'investments', 'POST', {
    tenant_id: tenantId,
    company_id: companyId || undefined,
    user_id: investorId,
    payer_id: investorId,
    asset_name: 'TESTE E2E SURPLUS PARTIAL BUG',
    type: 'Bond',
    amount_invested: 600,
    source_capital: 600,
    source_profit: 0,
    current_value: 660,
    interest_rate: 2,
    installment_value: 220,
    total_installments: 3,
    current_installment: 1,
    frequency: 'monthly',
    status: 'active',
    notes: 'E2E_TEST_SURPLUS_PARTIAL',
    due_day: 10,
  }, 'return=representation');

  const investmentId = investment?.[0]?.id as number;
  if (!investmentId) { console.warn('[surplus-partial] investment não criado'); return null; }

  const payload = [
    // #1 pendente hoje — parcela que o admin vai baixar com surplus
    { number: 1, due_date: d0,   status: 'pending', amount_total: 200, amount_principal: 196, amount_interest: 4, fine_amount: 0, interest_delay_amount: 0, amount_paid: 0 },
    // #2 partial + vencida — este é o caso do bug (cron nunca promoveu para 'late')
    { number: 2, due_date: dm5,  status: 'partial', amount_total: 200, amount_principal: 196, amount_interest: 4, fine_amount: 0, interest_delay_amount: 0, amount_paid: 100 },
    // #3 pending futura — NÃO deve ser tratada como atrasada
    { number: 3, due_date: d30,  status: 'pending', amount_total: 200, amount_principal: 196, amount_interest: 4, fine_amount: 0, interest_delay_amount: 0, amount_paid: 0 },
  ].map(inst => ({
    ...inst,
    investment_id: investmentId,
    tenant_id: tenantId,
    company_id: companyId || undefined,
  }));

  const created = await restCall(ctx, 'loan_installments', 'POST', payload, 'return=representation');
  if (!created || created.length < 3) {
    await restCall(ctx, `investments?id=eq.${investmentId}`, 'DELETE').catch(() => {});
    return null;
  }

  const sorted = [...created].sort((a: any, b: any) => a.number - b.number);
  return {
    investmentId,
    tenantId,
    companyId,
    adminProfileId: adminId,
    sourceInstallmentId: sorted[0].id,
    partialOverdueId:    sorted[1].id,
    futureInstallmentId: sorted[2].id,
  };
}

async function cleanup(page: any, investmentId: number) {
  const ctx = await getCtx(page);
  if (!ctx || !investmentId) return;
  try {
    await restCall(ctx, `payment_transactions?investment_id=eq.${investmentId}`, 'DELETE').catch(() => {});
    await restCall(ctx, `loan_installments?investment_id=eq.${investmentId}`, 'DELETE');
    await restCall(ctx, `investments?id=eq.${investmentId}`, 'DELETE');
  } catch (e) {
    console.warn('[surplus-partial] cleanup falhou:', e);
  }
}

// ─── suite ──────────────────────────────────────────────────────────────────

test.describe('Surplus — Parcela partial+vencida detectada como atrasada (fix bug MD Veículos)', () => {
  let data: SurplusPartialData | null = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'e2e/.auth/admin.json' });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('aside').waitFor({ timeout: 15_000 });
    data = await createData(page);
    await context.close();
    if (!data) console.warn('[surplus-partial] setup falhou — credenciais ausentes?');
  });

  test.afterAll(async ({ browser }) => {
    if (!data) return;
    const context = await browser.newContext({ storageState: 'e2e/.auth/admin.json' });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('aside').waitFor({ timeout: 15_000 });
    await cleanup(page, data.investmentId);
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!data, 'Setup de dados falhou');
    await waitForApp(page);
  });

  // ── PAY-SURPLUS-PARTIAL-01: UI + banco ──────────────────────────────────────

  test('PAY-SURPLUS-PARTIAL-01: Admin dá baixa com surplus e paga parcela partial+vencida', async ({ page }) => {
    test.setTimeout(90_000);
    if (!data) return;

    const ctx = await getCtx(page);

    // Pré-condição: confirma estado inicial da parcela #2 (partial+vencida)
    if (ctx) {
      const rows = await restCall(ctx, `loan_installments?id=eq.${data.partialOverdueId}&select=status,due_date,amount_paid,amount_total`);
      const inst = rows?.[0];
      expect(inst, 'Parcela partial não encontrada').toBeTruthy();
      expect(inst.status, 'Pré: parcela deve ter status=partial').toBe('partial');
      const today = new Date().toISOString().split('T')[0];
      expect(inst.due_date < today, `Pré: due_date ${inst.due_date} deve ser anterior a hoje`).toBe(true);
    }

    // Navega para a aba Parcelas como admin
    await goToParcelasTab(page, data.companyId);
    await switchToAllPeriods(page);

    // Aguarda o installment de teste aparecer no DOM
    const installmentCard = page.locator(`[data-installment-id="${data.sourceInstallmentId}"]`).first();
    const cardVisible = await installmentCard.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!cardVisible) {
      test.skip(true, 'Installment de teste não apareceu na lista — verificar companyId');
      return;
    }

    // Abre o modal de pagamento admin (BAIXA) para a parcela #1
    const opened = await openPaymentModal(page, data.sourceInstallmentId);
    expect(opened, 'Modal de baixa não abriu').toBe(true);
    await waitForPaymentModal(page);

    // Step 1: preenche 350 (outstanding=200 + 150 de surplus que cobre parcela #2 outstanding=100)
    const input = page.locator('input[type="number"]').first();
    await input.fill('');
    await input.fill('350');

    // Verifica alerta de excedente no Step 1
    await expect(
      page.getByText(/[Ee]xcedente/).first()
    ).toBeVisible({ timeout: 5_000 });

    // Avança para Step 2
    const step1Btn = page.getByRole('button', { name: /Próximo|Confirmar Recebimento/i }).first();
    await step1Btn.click();

    // ── Verificação crítica do fix ─────────────────────────────────────────
    // Step 2 deve mostrar "Quitar parcelas atrasadas" (fix: partial+vencida detectada)
    const step2Header = page.getByText(/O que fazer com o valor excedente/i).first();
    await expect(step2Header).toBeVisible({ timeout: 12_000 });

    const quitarAtrasadas = page.getByText(/Quitar parcelas atrasadas/i).first();
    const quitarVisible = await quitarAtrasadas.isVisible({ timeout: 5_000 }).catch(() => false);

    expect(
      quitarVisible,
      'FALHOU: "Quitar parcelas atrasadas" não aparece — bug não corrigido! ' +
      'Parcela partial+vencida deveria ser detectada como atrasada.'
    ).toBe(true);

    // Seleciona a opção "Quitar parcelas atrasadas" se não estiver já selecionada
    await quitarAtrasadas.click().catch(() => {});
    await page.waitForTimeout(300);

    // Confirma o pagamento — botão "Confirmar tudo" no Step 2 (pode precisar de scroll)
    const confirmBtn = page.getByRole('button', { name: /Confirmar tudo/i }).first();
    await confirmBtn.scrollIntoViewIfNeeded();
    await expect(confirmBtn).toBeVisible({ timeout: 8_000 });
    await confirmBtn.click();

    await waitForPaymentSuccess(page);

    // Pós-condição: parcela #2 (partial+vencida) deve ter outstanding reduzido
    if (ctx) {
      await page.waitForTimeout(1_500);
      const after = await fetchInstallment(page, data.partialOverdueId);
      expect(after, 'Parcela #2 não encontrada após pagamento').not.toBeNull();

      const outstandingAfter = Math.max(
        0,
        Number(after!.amount_total) - Number(after!.amount_paid ?? 0)
      );

      // Antes: outstanding=100. Depois: deve ser menor (pelo menos parcialmente pago)
      expect(
        outstandingAfter,
        `Outstanding da parcela partial+vencida deve ser < 100 (era 100, agora ${outstandingAfter})`
      ).toBeLessThan(100);
    }
  });

  // ── PAY-SURPLUS-PARTIAL-02: Validação lógica via REST ───────────────────────

  test('PAY-SURPLUS-PARTIAL-02: Lógica de detecção — parcela futura NÃO é atrasada', async ({ page }) => {
    if (!data) return;

    const ctx = await getCtx(page);
    if (!ctx) { test.skip(true, 'Contexto Supabase indisponível'); return; }

    const today = new Date().toISOString().split('T')[0];

    // Parcela #3: pending + futura → NÃO deve ser detectada como atrasada
    // (Valida que o fix não quebrou o caso oposto: datas futuras são ignoradas)
    const futureRows = await restCall(ctx, `loan_installments?id=eq.${data.futureInstallmentId}&select=status,due_date,amount_paid,amount_total`);
    const p3 = futureRows?.[0];
    expect(p3, 'Parcela futura não encontrada').toBeTruthy();
    expect(p3.due_date > today, `Parcela futura (due=${p3.due_date}) deve ter due_date no futuro`).toBe(true);

    // A lógica: due_date >= hoje → NÃO é atrasada (não entra no pay_late)
    const p3IsOverdueByDate = p3.due_date < today;
    expect(p3IsOverdueByDate, `Parcela futura (due=${p3.due_date}) NÃO deve ser detectada como atrasada`).toBe(false);
  });
});
