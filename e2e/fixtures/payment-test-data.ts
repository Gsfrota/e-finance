/**
 * Fixtures para testes de pagamento e baixa de parcelas.
 *
 * Estratégia: usa page.evaluate() para criar/destruir dados de teste
 * diretamente pela API REST do Supabase, usando o token de auth do admin
 * já presente no localStorage após login.
 *
 * Pré-requisito: a página deve estar carregada e o admin autenticado
 * (storageState com sessão válida).
 */

import { Page } from '@playwright/test';

export interface TestInstallment {
  id: string;
  number: number;
  amount_total: number;
  status: 'pending' | 'paid' | 'late' | 'partial';
  due_date: string;
}

export interface TestPaymentData {
  investmentId: number;
  tenantId: string;
  installments: TestInstallment[];
  /** Parcela atual (#3, vencimento hoje, pending) */
  currentInstallmentId: string;
  /** Parcela atrasada (#1, vencida, status=late) */
  lateInstallmentId: string;
  /** Última parcela (#5) */
  lastInstallmentId: string;
}

interface SupabaseContext {
  url: string;
  anon: string;
  token: string;
  userId: string;
}

/** Extrai configuração Supabase do contexto do browser após login. */
async function getSupabaseContext(page: Page): Promise<SupabaseContext | null> {
  return await page.evaluate(() => {
    // URL e chave anon — várias fontes possíveis
    const env = (window as any)._env_ || {};
    const url =
      env.VITE_SUPABASE_URL ||
      env.SUPABASE_URL ||
      localStorage.getItem('EF_EXTERNAL_SUPABASE_URL') ||
      '';
    const anon =
      env.VITE_SUPABASE_ANON_KEY ||
      env.VITE_SUPABASE_KEY ||
      env.SUPABASE_ANON_KEY ||
      localStorage.getItem('EF_EXTERNAL_SUPABASE_ANON_KEY') ||
      localStorage.getItem('EF_EXTERNAL_SUPABASE_KEY') ||
      '';

    // Token de sessão — Supabase armazena com padrão sb-*-auth-token
    // A app usa storageKey customizado: 'ef_dev_session' (dev) ou 'ef_prod_session' (prod)
    const sessionKey = Object.keys(localStorage).find(
      (k) =>
        k === 'ef_dev_session' ||
        k === 'ef_prod_session' ||
        k.includes('-auth-token') ||
        k === 'supabase.auth.token',
    );
    const sessionRaw = sessionKey ? localStorage.getItem(sessionKey) : null;
    let token = anon;
    let userId = '';
    if (sessionRaw) {
      try {
        const parsed = JSON.parse(sessionRaw);
        // Supabase v2: { access_token, user: { id } }
        // Supabase v1: { currentSession: { access_token } }
        const session = parsed?.currentSession || parsed;
        token = session?.access_token || anon;
        userId = session?.user?.id || '';
      } catch {
        // ignorar
      }
    }

    if (!url || !anon) return null;
    return { url, anon, token, userId };
  });
}

/** Chama a API REST do Supabase a partir do Node.js (contexto de teste). */
async function restCall(
  ctx: SupabaseContext,
  path: string,
  method: string = 'GET',
  body?: object,
  prefer?: string,
): Promise<any> {
  const resp = await fetch(`${ctx.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ctx.anon,
      Authorization: `Bearer ${ctx.token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase REST ${method} ${path} → ${resp.status}: ${text}`);
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

/** Calcula data no formato YYYY-MM-DD com offset em dias a partir de hoje. */
function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Cria um contrato de teste com 5 parcelas em estados variados.
 *
 * Layout:
 *   #1 status=late  due_date=-60d  amount_total=200   (atrasada)
 *   #2 status=late  due_date=-30d  amount_total=200   (atrasada)
 *   #3 status=pending due_date=hoje amount_total=200  (parcela atual)
 *   #4 status=pending due_date=+30d amount_total=200
 *   #5 status=pending due_date=+60d amount_total=200  (última)
 *
 * Requer admin autenticado na página.
 */
export async function createTestPaymentData(page: Page): Promise<TestPaymentData | null> {
  const ctx = await getSupabaseContext(page);
  if (!ctx || !ctx.url) {
    console.warn('[payment-test-data] Credenciais Supabase não encontradas — pulando setup.');
    return null;
  }

  // Busca o perfil do admin para obter tenant_id e profile id
  let tenantId = '';
  let investorId = '';
  let companyId = '';
  try {
    const profiles = await restCall(
      ctx,
      `profiles?select=id,tenant_id,company_id&limit=1`,
    );
    tenantId = profiles?.[0]?.tenant_id ?? '';
    investorId = profiles?.[0]?.id ?? '';
    companyId = profiles?.[0]?.company_id ?? '';
  } catch {
    console.warn('[payment-test-data] Não foi possível buscar profile do admin.');
    return null;
  }

  if (!tenantId) return null;

  // Cria investment de teste
  const investment = await restCall(
    ctx,
    'investments',
    'POST',
    {
      tenant_id: tenantId,
      company_id: companyId || undefined,
      user_id: investorId,
      payer_id: investorId,
      asset_name: 'TESTE E2E PAGAMENTO',
      type: 'Bond',
      amount_invested: 1000,
      source_capital: 1000,
      source_profit: 0,
      current_value: 1100,
      interest_rate: 2,
      installment_value: 220,
      total_installments: 5,
      current_installment: 1,
      frequency: 'monthly',
      status: 'active',
      notes: 'E2E_TEST_PAYMENT',
      due_day: 10,
    },
    'return=representation',
  );
  const investmentId = investment?.[0]?.id as number;
  if (!investmentId) return null;

  // Cria as 5 parcelas
  const installmentsPayload = [
    { number: 1, due_date: dateOffset(-60), status: 'late',    amount_total: 200, amount_principal: 196, amount_interest: 4,  fine_amount: 4,   interest_delay_amount: 2,   amount_paid: 0 },
    { number: 2, due_date: dateOffset(-30), status: 'late',    amount_total: 200, amount_principal: 196, amount_interest: 4,  fine_amount: 4,   interest_delay_amount: 1,   amount_paid: 0 },
    { number: 3, due_date: dateOffset(0),   status: 'pending', amount_total: 200, amount_principal: 196, amount_interest: 4,  fine_amount: 0,   interest_delay_amount: 0,   amount_paid: 0 },
    { number: 4, due_date: dateOffset(30),  status: 'pending', amount_total: 200, amount_principal: 196, amount_interest: 4,  fine_amount: 0,   interest_delay_amount: 0,   amount_paid: 0 },
    { number: 5, due_date: dateOffset(60),  status: 'pending', amount_total: 200, amount_principal: 196, amount_interest: 4,  fine_amount: 0,   interest_delay_amount: 0,   amount_paid: 0 },
  ].map((inst) => ({
    ...inst,
    investment_id: investmentId,
    tenant_id: tenantId,
    company_id: companyId || undefined,
  }));

  const createdInsts = await restCall(
    ctx,
    'loan_installments',
    'POST',
    installmentsPayload,
    'return=representation',
  );

  if (!createdInsts || createdInsts.length < 5) {
    // Cleanup investment se não criou parcelas
    await restCall(ctx, `investments?id=eq.${investmentId}`, 'DELETE');
    return null;
  }

  const sorted: TestInstallment[] = createdInsts.sort(
    (a: any, b: any) => a.number - b.number,
  );

  return {
    investmentId,
    tenantId,
    installments: sorted,
    lateInstallmentId: sorted[0].id,
    currentInstallmentId: sorted[2].id,
    lastInstallmentId: sorted[4].id,
  };
}

/**
 * Remove todos os dados de teste criados por createTestPaymentData.
 * Deve ser chamado em afterEach/afterAll.
 */
export async function deleteTestPaymentData(
  page: Page,
  investmentId: number,
): Promise<void> {
  const ctx = await getSupabaseContext(page);
  if (!ctx || !investmentId) return;

  try {
    await restCall(ctx, `loan_installments?investment_id=eq.${investmentId}`, 'DELETE');
    await restCall(ctx, `payment_transactions?investment_id=eq.${investmentId}`, 'DELETE');
    await restCall(ctx, `investments?id=eq.${investmentId}`, 'DELETE');
  } catch (e) {
    console.warn('[payment-test-data] Cleanup falhou:', e);
  }
}

/** Navega para a aba "Parcelas" no dashboard admin. */
export async function goToParcelasTab(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('aside').waitFor({ timeout: 12_000 });

  // A aba "Parcelas" fica dentro de AppView.DASHBOARD.
  // Clica no item "Dashboard" da sidebar para chegar lá.
  const dashboardBtn = page.locator('aside').getByRole('button', { name: /Dashboard/i }).first();
  await dashboardBtn.waitFor({ timeout: 8_000 });
  await dashboardBtn.click();

  // Agora busca a aba "Parcelas" dentro do Dashboard
  const parcelasTab = page.getByRole('button', { name: /^Parcelas$/i });
  await parcelasTab.waitFor({ timeout: 10_000 });
  await parcelasTab.click();
  // Aguarda lista de parcelas carregar
  await page.waitForTimeout(800);
}

/**
 * Encontra o botão "✓ BAIXA" de uma parcela pelo ID da parcela
 * (via busca no DOM — usa data-installment-id se disponível, ou busca por valor).
 */
export async function clickBaixaByInstallmentId(
  page: Page,
  installmentId: string,
): Promise<boolean> {
  // Tenta clicar via evaluate (mais robusto para listas longas)
  const found = await page.evaluate((id: string) => {
    // Percorre cards de parcela no DOM procurando pelo ID
    const cards = document.querySelectorAll('[data-installment-id]');
    for (const card of Array.from(cards)) {
      if (card.getAttribute('data-installment-id') === id) {
        const btn = card.querySelector('[data-action="pay"]') as HTMLButtonElement;
        if (btn) { btn.click(); return true; }
      }
    }
    return false;
  }, installmentId);

  if (!found) {
    // Fallback: procura pelo primeiro botão BAIXA visível
    const btnBaixa = page.getByRole('button', { name: /✓\s*BAIXA/ }).first();
    if (await btnBaixa.isVisible()) {
      await btnBaixa.click();
      return true;
    }
    return false;
  }
  return true;
}

/** Abre o modal de pagamento para a parcela "TESTE E2E PAGAMENTO" mais recente. */
export async function openPaymentModal(page: Page): Promise<boolean> {
  // Procura texto "TESTE E2E PAGAMENTO" na lista e clica no botão BAIXA da linha
  const linhaTeste = page.getByText('TESTE E2E PAGAMENTO').first();
  if (!(await linhaTeste.isVisible({ timeout: 5_000 }).catch(() => false))) {
    // Fallback: qualquer parcela pending
    const btn = page.getByRole('button', { name: /✓\s*BAIXA/ }).first();
    if (!(await btn.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
    await btn.click();
    return true;
  }
  // Clica no botão BAIXA mais próximo do item de teste
  const container = linhaTeste.locator('..').locator('..').locator('..');
  const btnBaixa = container.getByRole('button', { name: /✓\s*BAIXA/ }).first();
  await btnBaixa.click();
  return true;
}

/** Aguarda o modal de baixa abrir (verifica header "Baixa de Pagamento"). */
export async function waitForPaymentModal(page: Page): Promise<void> {
  await page.getByText('Baixa de Pagamento').waitFor({ timeout: 8_000 });
}

/** Aguarda confirmação de sucesso ("Pagamento Confirmado!"). */
export async function waitForPaymentSuccess(page: Page): Promise<void> {
  await page.getByText('Pagamento Confirmado!').waitFor({ timeout: 15_000 });
}
