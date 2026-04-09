/**
 * Helpers compartilhados para testes E2E completos.
 *
 * Reutiliza padrões de payment-test-data.ts e adiciona helpers
 * de navegação e criação de dados via UI e Supabase REST.
 */

import { Page, expect } from '@playwright/test';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SupabaseCtx {
  url: string;
  anon: string;
  token: string;
  userId: string;
  tenantId?: string;
  companyId?: string;
}

export interface ClientData {
  full_name: string;
  email: string;
  phone_number?: string;
  cpf?: string;
  role: 'investor' | 'debtor' | 'admin';
}

export interface ContractData {
  /** Nome do contrato/ativo */
  asset_name: string;
  /** Valor principal em R$ */
  amount_invested: number;
  /** Total de parcelas */
  total_installments: number;
  /** Taxa de juros mensal % */
  interest_rate: number;
  /** Modo de cálculo */
  calculation_mode: 'auto' | 'manual' | 'interest_only';
  /** Frequência */
  frequency: 'monthly' | 'weekly' | 'daily' | 'freelancer';
  /** Dia de vencimento (para monthly) */
  due_day?: number;
  /** Valor manual da parcela (para mode=manual) */
  installment_value?: number;
}

// ─── Supabase REST ─────────────────────────────────────────────────────────────

/** Extrai configuração Supabase do localStorage do browser. */
export async function getCtx(page: Page): Promise<SupabaseCtx | null> {
  return await page.evaluate(() => {
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

/** Chama API REST do Supabase. */
export async function restCall(
  ctx: SupabaseCtx,
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

/** Resolve tenantId e companyId do admin logado. */
export async function resolveScope(ctx: SupabaseCtx): Promise<{ tenantId: string; companyId: string }> {
  const profiles = await restCall(ctx, `profiles?select=id,tenant_id,company_id&limit=1`);
  return {
    tenantId: profiles?.[0]?.tenant_id ?? '',
    companyId: profiles?.[0]?.company_id ?? '',
  };
}

/** Cria data YYYY-MM-DD com offset em dias. */
export function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ─── Navegação ────────────────────────────────────────────────────────────────

/** Aguarda o app carregar: sidebar visível + spinner desapareceu. */
export async function waitForApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('aside').waitFor({ timeout: 15_000 });
  // Aguarda spinner de autenticação desaparecer antes de interagir
  await page.locator('.animate-spin').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
}

/**
 * Navega para uma view via botão na sidebar e aguarda o conteúdo principal carregar.
 * @param viewName Texto do botão (ex: 'Dashboard', 'Contratos', 'Usuários')
 */
export async function navigateToView(page: Page, viewName: string): Promise<void> {
  const btn = page.locator('aside').getByRole('button', { name: new RegExp(viewName, 'i') }).first();
  await btn.waitFor({ state: 'visible', timeout: 8_000 });
  await btn.click();
  // Aguarda conteúdo principal renderizar (main ou section dentro do layout)
  await page.locator('main, [role="main"], #content, .flex-1').first()
    .waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

/**
 * Seleciona uma empresa específica (não a visão agregada) no combobox do header.
 * Necessário antes de acessar views operacionais como Usuários, que exigem empresa ativa.
 */
export async function selectSpecificCompany(page: Page): Promise<void> {
  const combobox = page.getByRole('combobox').first();
  const visible = await combobox.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!visible) return;

  // Seleciona a segunda opção (a primeira empresa específica, pulando "Todas as empresas")
  const options = await combobox.locator('option').all();
  if (options.length < 2) return;

  const secondValue = await options[1].getAttribute('value');
  if (secondValue) {
    await combobox.selectOption(secondValue);
    await page.waitForTimeout(400);
  }
}

/** Navega para aba interna do Dashboard e aguarda conteúdo renderizar. */
export async function navigateToDashboardTab(page: Page, tabName: string): Promise<void> {
  await navigateToView(page, 'Dashboard');
  // Usa getByRole com accessible name — mais robusto que filter(hasText regex)
  const tab = page.getByRole('button', { name: tabName }).first();
  await expect(tab).toBeVisible({ timeout: 45_000 });
  await tab.click();
  await page.waitForTimeout(600);
}

// ─── Contratos ───────────────────────────────────────────────────────────────

/**
 * Cria um contrato via Supabase REST (mais rápido que via UI para setup de dados).
 * Usa o RPC create_investment_validated quando possível; senão cria diretamente.
 */
export async function createContractViaREST(
  page: Page,
  opts: Partial<ContractData> & { investorId?: string; debtorId?: string },
): Promise<number | null> {
  const ctx = await getCtx(page);
  if (!ctx) return null;

  const { tenantId, companyId } = await resolveScope(ctx);
  if (!tenantId) return null;

  const profiles = await restCall(ctx, `profiles?select=id&tenant_id=eq.${tenantId}&limit=2`);
  const investorId = opts.investorId || profiles?.[0]?.id;
  const debtorId = opts.debtorId || profiles?.[1]?.id || investorId;

  const investment = await restCall(
    ctx,
    'investments',
    'POST',
    {
      tenant_id: tenantId,
      company_id: companyId || undefined,
      user_id: investorId,
      payer_id: debtorId,
      asset_name: opts.asset_name ?? 'TESTE E2E CONTRATO',
      type: 'Bond',
      amount_invested: opts.amount_invested ?? 1000,
      source_capital: opts.amount_invested ?? 1000,
      source_profit: 0,
      current_value: opts.amount_invested ?? 1000,
      interest_rate: opts.interest_rate ?? 2,
      installment_value: opts.installment_value ?? 220,
      total_installments: opts.total_installments ?? 5,
      current_installment: 1,
      frequency: opts.frequency ?? 'monthly',
      calculation_mode: opts.calculation_mode ?? 'auto',
      status: 'active',
      notes: 'E2E_TEST',
      due_day: opts.due_day ?? 10,
    },
    'return=representation',
  );

  return investment?.[0]?.id ?? null;
}

/** Remove contrato e dados relacionados. */
export async function deleteContractViaREST(page: Page, investmentId: number): Promise<void> {
  const ctx = await getCtx(page);
  if (!ctx || !investmentId) return;
  try {
    await restCall(ctx, `loan_installments?investment_id=eq.${investmentId}`, 'DELETE');
    await restCall(ctx, `payment_transactions?investment_id=eq.${investmentId}`, 'DELETE');
    await restCall(ctx, `investments?id=eq.${investmentId}`, 'DELETE');
  } catch (e) {
    console.warn('[e2e-helpers] Cleanup de contrato falhou:', e);
  }
}

// ─── Modal de Pagamento ────────────────────────────────────────────────────────

/** Aguarda modal "Baixa de Pagamento" abrir. */
export async function waitForPaymentModal(page: Page): Promise<void> {
  await page.getByText('Baixa de Pagamento').waitFor({ timeout: 8_000 });
}

/** Aguarda confirmação de sucesso. */
export async function waitForPaymentSuccess(page: Page): Promise<void> {
  await page.getByText('Pagamento Confirmado!').waitFor({ timeout: 15_000 });
}

/** Preenche valor no Step 1 do modal de pagamento. */
export async function fillPaymentAmount(page: Page, value: string): Promise<void> {
  const input = page.locator('input[type="number"]').first();
  await input.fill('');
  await input.fill(value);
}

/** Clica no botão de submit do Step 1. */
export async function submitPaymentStep1(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: /Confirmar Recebimento|Próximo/ }).first();
  await btn.click();
}

/** Clica no botão de confirmação do Step 2. */
export async function submitPaymentStep2(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: /Confirmar|Quitar|Aplicar|Encerrar/ }).first();
  await btn.click();
}

/** Abre o botão BAIXA da primeira parcela pendente visível. */
export async function openFirstPaymentModal(page: Page): Promise<boolean> {
  const btn = page.locator('[data-action="pay"]').first();
  if (!(await btn.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
  await btn.click();
  return true;
}
