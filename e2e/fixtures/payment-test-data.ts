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
  /** ID da empresa associada ao contrato de teste */
  companyId: string;
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
  // Garante que a página está em um contexto com acesso ao localStorage.
  // Se a URL for about:blank, navega para o app primeiro.
  const currentUrl = page.url();
  if (!currentUrl || currentUrl === 'about:blank' || currentUrl.startsWith('about:')) {
    await page.goto('/');
    await page.locator('aside').waitFor({ timeout: 15_000 }).catch(() => {});
  }

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

  // Admin pode não ter company_id — tenta várias fontes para obter o company_id do tenant.
  // O company_id é necessário para o contrato aparecer na aba Parcelas (que filtra por empresa).

  // Tentativa 1: companies table
  if (!companyId) {
    try {
      const companies = await restCall(
        ctx,
        `companies?select=id&tenant_id=eq.${tenantId}&order=created_at.asc&limit=1`,
      );
      companyId = companies?.[0]?.id ?? '';
    } catch {
      console.warn('[payment-test-data] Não foi possível buscar empresa via /companies.');
    }
  }

  // Tentativa 2: outro perfil no tenant com company_id (investidores/devedores)
  if (!companyId) {
    try {
      const profilesWithCo = await restCall(
        ctx,
        `profiles?select=company_id&tenant_id=eq.${tenantId}&company_id=not.is.null&limit=1`,
      );
      companyId = profilesWithCo?.[0]?.company_id ?? '';
    } catch {
      console.warn('[payment-test-data] Não foi possível buscar company via /profiles.');
    }
  }

  // Tentativa 3: busca company_id de um investimento existente no tenant
  if (!companyId) {
    try {
      const existingInvs = await restCall(
        ctx,
        `investments?select=company_id&tenant_id=eq.${tenantId}&company_id=not.is.null&order=created_at.desc&limit=1`,
      );
      companyId = existingInvs?.[0]?.company_id ?? '';
    } catch {
      console.warn('[payment-test-data] Não foi possível buscar company via /investments.');
    }
  }

  // Tentativa 3: busca company_id de uma parcela existente no tenant
  if (!companyId) {
    try {
      const existingInst = await restCall(
        ctx,
        `loan_installments?select=company_id&tenant_id=eq.${tenantId}&company_id=not.is.null&order=created_at.desc&limit=1`,
      );
      companyId = existingInst?.[0]?.company_id ?? '';
    } catch {
      console.warn('[payment-test-data] Não foi possível buscar company via /loan_installments.');
    }
  }

  if (!companyId) {
    console.warn('[payment-test-data] company_id não encontrado — contrato criado sem empresa (pode não aparecer na aba Parcelas).');
  }

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
    companyId,
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
  let ctx: Awaited<ReturnType<typeof getSupabaseContext>>;
  try {
    ctx = await getSupabaseContext(page);
  } catch {
    // página pode estar fechada após timeout — cleanup ignorado
    return;
  }
  if (!ctx || !investmentId) return;

  try {
    // Ordem correta respeitando FKs:
    // payment_event_installments → payment_events → payment_transactions → loan_installments → investments
    await restCall(ctx, `payment_event_installments?installment_id=in.(select id from loan_installments where investment_id=${investmentId})`, 'DELETE').catch(() => {});
    await restCall(ctx, `payment_events?investment_id=eq.${investmentId}`, 'DELETE').catch(() => {});
    await restCall(ctx, `payment_transactions?investment_id=eq.${investmentId}`, 'DELETE');
    await restCall(ctx, `loan_installments?investment_id=eq.${investmentId}`, 'DELETE');
    await restCall(ctx, `investments?id=eq.${investmentId}`, 'DELETE');
  } catch (e) {
    console.warn('[payment-test-data] Cleanup falhou:', e);
  }
}

/**
 * Navega para a aba "Parcelas" no dashboard admin.
 * @param preferCompanyId - ID da empresa a selecionar no combobox; se omitido, usa options[1].
 */
export async function goToParcelasTab(page: Page, preferCompanyId?: string): Promise<void> {
  await page.goto('/');
  await page.locator('aside').waitFor({ timeout: 12_000 });

  // Seleciona empresa específica para ativar operações (Contratos, Parcelas)
  const combobox = page.getByRole('combobox').first();
  if (await combobox.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const options = await combobox.locator('option').all();
    if (preferCompanyId && options.length >= 1) {
      // Seleciona a empresa exata usada na criação dos dados de teste
      for (const opt of options) {
        const val = await opt.getAttribute('value');
        if (val === preferCompanyId) {
          await combobox.selectOption(val);
          await page.waitForTimeout(300);
          break;
        }
      }
    } else if (options.length >= 2) {
      const val = await options[1].getAttribute('value');
      if (val) { await combobox.selectOption(val); await page.waitForTimeout(300); }
    }
  }

  // Navega para Dashboard e clica na aba Parcelas
  const dashboardBtn = page.locator('aside').getByRole('button', { name: /Dashboard/i }).first();
  await dashboardBtn.waitFor({ timeout: 8_000 });
  await dashboardBtn.click();
  await page.waitForTimeout(1_500);

  // Detecta paywall pela ausência das abas (tela em branco = plano free bloqueado)
  const dashAvailable = await page.getByRole('button').filter({ hasText: /Visão Geral/ }).first()
    .isVisible({ timeout: 6_000 }).catch(() => false);
  if (!dashAvailable) {
    // Dashboard paywalled ou ainda carregando — retorna sem navegar para parcelas
    return;
  }

  // Usa .first() para evitar strict mode com múltiplos botões "Parcelas" na página
  const parcelasTab = page.getByRole('button', { name: 'Parcelas' }).first();
  await parcelasTab.waitFor({ timeout: 45_000 });
  await parcelasTab.click();
  await page.waitForTimeout(800);
}

/**
 * Encontra o botão "✓ BAIXA" de uma parcela pelo ID e clica via Playwright locator
 * (evita problemas de timing e elementos ocultos do page.evaluate nativo).
 */
export async function clickBaixaByInstallmentId(
  page: Page,
  installmentId: string,
): Promise<boolean> {
  // Cada parcela tem 2 elementos [data-installment-id]: desktop (<tr>) e mobile (<div>).
  // O desktop vem primeiro no DOM e é visível; usamos .filter({ hasText: ... }) não,
  // mas sim localizamos o botão data-action="pay" dentro de cada um e clicamos no visível.
  const cards = page.locator(`[data-installment-id="${installmentId}"]`);
  const count = await cards.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const payBtn = card.locator('[data-action="pay"]').first();
    const visible = await payBtn.isVisible({ timeout: 1_000 }).catch(() => false);
    if (visible) {
      await payBtn.click();
      return true;
    }
  }

  return false;
}

/**
 * Abre o modal de pagamento para um installment específico ou o primeiro disponível.
 * @param targetInstallmentId - Se fornecido, abre exatamente esse installment (evita órfãos).
 */
export async function openPaymentModal(page: Page, targetInstallmentId?: string): Promise<boolean> {
  // Prioridade: ID específico do installment recém-criado
  if (targetInstallmentId) {
    const found = await clickBaixaByInstallmentId(page, targetInstallmentId);
    if (found) return true;
  }

  // Fallback: qualquer botão BAIXA visível (data-action="pay")
  const btn = page.locator('[data-action="pay"]').first();
  if (!(await btn.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
  await btn.click();
  return true;
}

/** Aguarda o modal de baixa abrir (verifica header "Baixa de Pagamento"). */
export async function waitForPaymentModal(page: Page): Promise<void> {
  await page.getByText('Baixa de Pagamento').waitFor({ timeout: 8_000 });
}

/** Aguarda confirmação de sucesso (comprovante ou fallback sem tenant). */
export async function waitForPaymentSuccess(page: Page): Promise<void> {
  await page.getByText(/Pagamento Confirmado!|foi paga|Comprovante/i).first().waitFor({ timeout: 15_000 });
}

// ─── Bullet Contract Fixtures ─────────────────────────────────────────────────

export interface BulletContractData {
  investmentId: number;
  tenantId: string;
  companyId: string;
  /** ID da parcela de juros pendente (mês atual) */
  installmentId: string;
  remainingBalance: number;
  interestRate: number;
}

/**
 * Cria um contrato bullet (interest_only) com 1 parcela de juros pendente no mês atual.
 * Usado para testar PAG-015, PAG-022, PAG-023.
 */
export async function createBulletContractViaREST(page: Page): Promise<BulletContractData | null> {
  const ctx = await getSupabaseContext(page);
  if (!ctx || !ctx.url) {
    console.warn('[payment-test-data] Credenciais não encontradas — pulando bullet setup.');
    return null;
  }

  let tenantId = '';
  let investorId = '';
  let companyId = '';
  try {
    const profiles = await restCall(ctx, `profiles?select=id,tenant_id,company_id&limit=1`);
    tenantId = profiles?.[0]?.tenant_id ?? '';
    investorId = profiles?.[0]?.id ?? '';
    companyId = profiles?.[0]?.company_id ?? '';
  } catch {
    return null;
  }
  if (!tenantId) return null;

  if (!companyId) {
    try {
      const cos = await restCall(ctx, `companies?select=id&tenant_id=eq.${tenantId}&order=created_at.asc&limit=1`);
      companyId = cos?.[0]?.id ?? '';
    } catch {}
  }

  const remainingBalance = 5000;
  const interestRate = 3; // 3% ao mês

  const investment = await restCall(
    ctx,
    'investments',
    'POST',
    {
      tenant_id: tenantId,
      company_id: companyId || undefined,
      user_id: investorId,
      payer_id: investorId,
      asset_name: 'TESTE E2E BULLET',
      type: 'Bond',
      amount_invested: remainingBalance,
      source_capital: remainingBalance,
      source_profit: 0,
      current_value: remainingBalance,
      interest_rate: interestRate,
      remaining_balance: remainingBalance,
      total_installments: 12,
      current_installment: 1,
      frequency: 'monthly',
      calculation_mode: 'interest_only',
      status: 'active',
      notes: 'E2E_TEST_BULLET',
      due_day: 10,
    },
    'return=representation',
  );
  const investmentId = investment?.[0]?.id as number;
  if (!investmentId) return null;

  // Parcela de juros do mês atual
  const interestAmt = remainingBalance * interestRate / 100;
  const today = dateOffset(0);
  const [year, month] = today.split('-');
  const dueDate = `${year}-${month}-10`;

  const insts = await restCall(
    ctx,
    'loan_installments',
    'POST',
    [{
      investment_id: investmentId,
      tenant_id: tenantId,
      company_id: companyId || undefined,
      number: 1,
      due_date: dueDate,
      status: 'pending',
      amount_total: interestAmt,
      amount_principal: 0,
      amount_interest: interestAmt,
      fine_amount: 0,
      interest_delay_amount: 0,
      amount_paid: 0,
    }],
    'return=representation',
  );

  if (!insts || insts.length < 1) {
    await restCall(ctx, `investments?id=eq.${investmentId}`, 'DELETE').catch(() => {});
    return null;
  }

  return {
    investmentId,
    tenantId,
    companyId,
    installmentId: insts[0].id,
    remainingBalance,
    interestRate,
  };
}

/**
 * Cria uma parcela com vencimento no passado e status=pending para testar
 * marcação automática de atraso (BR-PAG-017).
 */
export async function createLateInstallmentViaREST(
  page: Page,
  daysOverdue: number = 2,
): Promise<{ investmentId: number; installmentId: string } | null> {
  const ctx = await getSupabaseContext(page);
  if (!ctx || !ctx.url) return null;

  let tenantId = '';
  let investorId = '';
  let companyId = '';
  try {
    const profiles = await restCall(ctx, `profiles?select=id,tenant_id,company_id&limit=1`);
    tenantId = profiles?.[0]?.tenant_id ?? '';
    investorId = profiles?.[0]?.id ?? '';
    companyId = profiles?.[0]?.company_id ?? '';
  } catch {
    return null;
  }
  if (!tenantId) return null;

  if (!companyId) {
    try {
      const cos = await restCall(ctx, `companies?select=id&tenant_id=eq.${tenantId}&order=created_at.asc&limit=1`);
      companyId = cos?.[0]?.id ?? '';
    } catch {}
  }

  const investment = await restCall(
    ctx,
    'investments',
    'POST',
    {
      tenant_id: tenantId,
      company_id: companyId || undefined,
      user_id: investorId,
      payer_id: investorId,
      asset_name: 'TESTE E2E LATE',
      type: 'Bond',
      amount_invested: 1000,
      source_capital: 1000,
      source_profit: 0,
      current_value: 1000,
      interest_rate: 2,
      installment_value: 200,
      total_installments: 3,
      current_installment: 1,
      frequency: 'monthly',
      calculation_mode: 'auto',
      status: 'active',
      notes: 'E2E_TEST_LATE',
      due_day: 10,
    },
    'return=representation',
  );
  const investmentId = investment?.[0]?.id as number;
  if (!investmentId) return null;

  const insts = await restCall(
    ctx,
    'loan_installments',
    'POST',
    [{
      investment_id: investmentId,
      tenant_id: tenantId,
      company_id: companyId || undefined,
      number: 1,
      due_date: dateOffset(-daysOverdue),
      status: 'pending',
      amount_total: 200,
      amount_principal: 196,
      amount_interest: 4,
      fine_amount: 0,
      interest_delay_amount: 0,
      amount_paid: 0,
    }],
    'return=representation',
  );

  if (!insts || insts.length < 1) {
    await restCall(ctx, `investments?id=eq.${investmentId}`, 'DELETE').catch(() => {});
    return null;
  }

  return { investmentId, installmentId: insts[0].id };
}
