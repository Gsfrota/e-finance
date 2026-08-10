/**
 * Harness da Camada 2 — contrato de banco (PostgREST + RPC), sem browser.
 *
 * Regras que este harness impõe, e por quê:
 *
 * 1. FIXTURE PELO CAMINHO LEGÍTIMO. Contrato nasce por `create_investment_validated`
 *    (a RPC que `AdminContracts.tsx:585` chama), com os mesmos parâmetros que o
 *    wizard envia. Nunca `POST /rest/v1/investments` montando `amount_total` à mão —
 *    um teste não pode verificar um número que ele mesmo inventou.
 *
 * 2. CADA TESTE TEM A SUA PRÓPRIA FIXTURE, IDENTIFICADA POR ID. Nada de `.first()`,
 *    `profiles[0]` ou "pega um contrato qualquer da lista".
 *
 * 3. CLEANUP QUE FALHA ALTO. `cleanupAll()` apaga na ordem de FK e depois RELÊ o
 *    banco; se sobrou linha, lança. É o oposto do `payment-test-data.ts:322`, que
 *    usava sintaxe inválida de PostgREST dentro de `.catch(() => {})` e por isso
 *    deixou 171 profiles `@e2e.test` acumulados em produção desde fevereiro/2026.
 *
 * 4. TRAVA DE TENANT. Estes testes escrevem em PRODUÇÃO. O harness recusa rodar se
 *    o tenant do usuário autenticado não parecer um tenant de QA/sandbox.
 */

const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'TEST_ADMIN_EMAIL', 'TEST_ADMIN_PASSWORD'] as const;

/**
 * Motivo real (ou null) para a suíte não poder rodar. É a ÚNICA condição de skip
 * aceita nesta camada: ausência genuína de credencial. Qualquer outra falha reprova.
 */
export function missingCredentials(): string | null {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length === 0) return null;
  return (
    `faltam variáveis em .env.local: ${missing.join(', ')}. ` +
    'Rode com `npm run test:db-contract` (a senha tem "#" e o dotenv trunca; o script usa `set -a; . ./.env.local`).'
  );
}

export interface DbCtx {
  url: string;
  anonKey: string;
  accessToken: string;
  authUserId: string;
  profileId: string;
  tenantId: string;
  tenantName: string;
  companyId: string;
}

interface RestOptions {
  method?: string;
  body?: unknown;
  /** Omite o Authorization para exercitar o papel `anon` (chave pública). */
  asAnon?: boolean;
  headers?: Record<string, string>;
}

export interface RestResult<T = any> {
  status: number;
  ok: boolean;
  data: T;
  raw: string;
}

export async function rest<T = any>(ctx: DbCtx, path: string, opts: RestOptions = {}): Promise<RestResult<T>> {
  const headers: Record<string, string> = {
    apikey: ctx.anonKey,
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
  };
  if (!opts.asAnon) headers.Authorization = `Bearer ${ctx.accessToken}`;

  const res = await fetch(`${ctx.url}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const raw = await res.text();
  let data: any = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }
  return { status: res.status, ok: res.ok, data: data as T, raw };
}

/** Chama uma RPC. Lança com a mensagem do Postgres se falhar (nada de erro engolido). */
export async function rpc<T = any>(ctx: DbCtx, fn: string, args: Record<string, unknown>, opts: RestOptions = {}): Promise<T> {
  const res = await rest<T>(ctx, `/rest/v1/rpc/${fn}`, { ...opts, method: 'POST', body: args });
  if (!res.ok) throw new Error(`RPC ${fn} falhou (HTTP ${res.status}): ${res.raw}`);
  return res.data;
}

/** Versão que devolve o resultado bruto, para testes que ESPERAM erro. */
export function rpcRaw(ctx: DbCtx, fn: string, args: Record<string, unknown>, opts: RestOptions = {}) {
  return rest(ctx, `/rest/v1/rpc/${fn}`, { ...opts, method: 'POST', body: args });
}

function decodeJwtSub(token: string): string {
  const payload = token.split('.')[1];
  const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return json.sub as string;
}

const SANDBOX_TENANT_PATTERN = /qa|smoke|sandbox|teste?\b/i;

/**
 * Autentica com TEST_ADMIN_* e resolve a identidade real (profile/tenant/company).
 * Nunca imprime credencial.
 */
export async function signInQaAdmin(): Promise<DbCtx> {
  const url = process.env.VITE_SUPABASE_URL!.replace(/\/+$/, '');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!;

  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.TEST_ADMIN_EMAIL, password: process.env.TEST_ADMIN_PASSWORD }),
  });
  if (!authRes.ok) {
    throw new Error(`Login do admin de QA falhou (HTTP ${authRes.status}). Confira TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD.`);
  }
  const auth = await authRes.json();
  const accessToken: string = auth.access_token;
  const authUserId: string = auth.user?.id ?? decodeJwtSub(accessToken);

  const base: DbCtx = {
    url,
    anonKey,
    accessToken,
    authUserId,
    profileId: '',
    tenantId: '',
    tenantName: '',
    companyId: '',
  };

  // Identidade DE VERDADE: filtrada pelo usuário logado, nunca `limit=1` solto.
  let profiles = (
    await rest(base, `/rest/v1/profiles?select=id,tenant_id,company_id,role&auth_user_id=eq.${authUserId}`)
  ).data;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    profiles = (await rest(base, `/rest/v1/profiles?select=id,tenant_id,company_id,role&id=eq.${authUserId}`)).data;
  }
  if (!Array.isArray(profiles) || profiles.length !== 1) {
    throw new Error(`Esperava exatamente 1 profile para o usuário autenticado, veio ${JSON.stringify(profiles)}`);
  }
  const profile = profiles[0];
  if (profile.role !== 'admin') throw new Error(`Usuário de teste precisa ser admin, é '${profile.role}'`);

  const tenants = (await rest(base, `/rest/v1/tenants?select=id,name&id=eq.${profile.tenant_id}`)).data;
  const tenantName: string = Array.isArray(tenants) && tenants[0] ? tenants[0].name : '';

  if (!SANDBOX_TENANT_PATTERN.test(tenantName) && process.env.EF_DB_CONTRACT_ALLOW_ANY_TENANT !== '1') {
    throw new Error(
      `RECUSANDO ESCREVER: o tenant '${tenantName}' não parece um sandbox de QA. ` +
        'Esta suíte cria e apaga contratos em PRODUÇÃO. Aponte TEST_ADMIN_* para o tenant de QA ' +
        'ou exporte EF_DB_CONTRACT_ALLOW_ANY_TENANT=1 se souber o que está fazendo.'
    );
  }

  const companies = (
    await rest(base, `/rest/v1/companies?select=id,is_primary&tenant_id=eq.${profile.tenant_id}&order=is_primary.desc&limit=1`)
  ).data;
  if (!Array.isArray(companies) || companies.length !== 1) {
    throw new Error(`Tenant '${tenantName}' não tem empresa primária — fixture não pode passar company_id (a RLS barra NULL).`);
  }

  return {
    ...base,
    profileId: profile.id,
    tenantId: profile.tenant_id,
    tenantName,
    companyId: companies[0].id,
  };
}

export interface InstallmentRow {
  id: string;
  number: number;
  due_date: string;
  amount_principal: number;
  amount_interest: number;
  amount_total: number;
  amount_paid: number;
  fine_amount: number;
  interest_delay_amount: number;
  interest_payments_total: number | null;
  status: string;
  paid_at: string | null;
}

export interface ContractFixture {
  investmentId: number;
  debtorId: string;
  installments: InstallmentRow[];
}

/** Registro do lixo criado nesta execução; `cleanupAll` esvazia e VERIFICA. */
const trash: { investmentIds: number[]; profileIds: string[] } = { investmentIds: [], profileIds: [] };

const stamp = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export interface CreateContractSpec {
  label: string;
  amountInvested: number;
  currentValue: number;
  installmentValue: number;
  totalInstallments: number;
  interestRate: number;
  calculationMode: 'auto' | 'manual' | 'interest_only';
  /** Só bullet. */
  lateFinePercent?: number | null;
  defaultAfterDays?: number;
}

/**
 * Cria devedor + contrato pelo caminho de produção e devolve o que a RPC GEROU
 * (relido do banco), nunca o que a fixture supôs.
 */
export async function createContract(ctx: DbCtx, spec: CreateContractSpec): Promise<ContractFixture> {
  const tag = stamp();
  const debtorId = await rpc<string>(ctx, 'create_client_direct', {
    p_full_name: `DBCONTRACT ${spec.label} ${tag}`,
    p_email: `dbcontract-${tag}@e2e.test`,
    p_role: 'debtor',
    p_company_id: ctx.companyId,
  });
  trash.profileIds.push(debtorId);

  const isBullet = spec.calculationMode === 'interest_only';
  const investmentId = await rpc<number>(ctx, 'create_investment_validated', {
    p_tenant_id: ctx.tenantId,
    p_user_id: ctx.profileId,
    p_payer_id: debtorId,
    p_asset_name: `DBCONTRACT ${spec.label} ${tag}`,
    p_amount_invested: spec.amountInvested,
    p_source_capital: spec.amountInvested,
    p_source_profit: 0,
    p_current_value: spec.currentValue,
    p_interest_rate: spec.interestRate,
    p_installment_value: spec.installmentValue,
    p_total_installments: spec.totalInstallments,
    p_frequency: 'monthly',
    p_due_day: 10,
    p_calculation_mode: spec.calculationMode,
    p_company_id: ctx.companyId,
    p_bullet_principal_mode: null,
    p_capitalize_interest: true,
    p_break_fee_percent: isBullet ? 0 : null,
    p_default_after_days: spec.defaultAfterDays ?? 20,
    p_late_fine_percent: isBullet ? (spec.lateFinePercent ?? null) : null,
    p_parent_investment_id: null,
  });
  trash.investmentIds.push(investmentId);

  return { investmentId, debtorId, installments: await fetchInstallments(ctx, investmentId) };
}

export async function fetchInstallments(ctx: DbCtx, investmentId: number): Promise<InstallmentRow[]> {
  const res = await rest<InstallmentRow[]>(
    ctx,
    `/rest/v1/loan_installments?investment_id=eq.${investmentId}&select=*&order=number.asc`
  );
  if (!res.ok) throw new Error(`Falha ao ler parcelas do contrato ${investmentId}: ${res.raw}`);
  return res.data;
}

export async function fetchInvestment(ctx: DbCtx, investmentId: number): Promise<any> {
  const res = await rest<any[]>(ctx, `/rest/v1/investments?id=eq.${investmentId}&select=*`);
  if (!res.ok || res.data.length !== 1) throw new Error(`Falha ao ler contrato ${investmentId}: ${res.raw}`);
  return res.data[0];
}

export async function fetchPaymentTransactions(ctx: DbCtx, investmentId: number): Promise<any[]> {
  const res = await rest<any[]>(
    ctx,
    `/rest/v1/payment_transactions?investment_id=eq.${investmentId}&select=*&order=created_at.asc`
  );
  if (!res.ok) throw new Error(`Falha ao ler payment_transactions de ${investmentId}: ${res.raw}`);
  return res.data;
}

/** `numeric` do PostgREST pode vir como number ou string; normaliza sem esconder null. */
export const num = (v: unknown): number => (v === null || v === undefined ? NaN : Number(v));

/**
 * Apaga tudo que esta execução criou, na ordem de FK, e CONFIRMA que sumiu.
 * Lança se sobrou qualquer linha — cleanup silencioso é como o repo acumulou lixo.
 */
export async function cleanupAll(ctx: DbCtx): Promise<void> {
  const problems: string[] = [];

  for (const id of trash.investmentIds) {
    // payment_transactions -> investments é NO ACTION: precisa sair antes.
    const tx = await rest(ctx, `/rest/v1/payment_transactions?investment_id=eq.${id}`, { method: 'DELETE' });
    if (!tx.ok) problems.push(`DELETE payment_transactions(investment_id=${id}) HTTP ${tx.status}: ${tx.raw}`);
    // loan_installments / avulso_payments / contract_renegotiations / payment_events são CASCADE.
    const inv = await rest(ctx, `/rest/v1/investments?id=eq.${id}`, { method: 'DELETE' });
    if (!inv.ok) problems.push(`DELETE investments(${id}) HTTP ${inv.status}: ${inv.raw}`);
  }
  for (const id of trash.profileIds) {
    const p = await rest(ctx, `/rest/v1/profiles?id=eq.${id}`, { method: 'DELETE' });
    if (!p.ok) problems.push(`DELETE profiles(${id}) HTTP ${p.status}: ${p.raw}`);
  }

  // Verificação: reler o banco. Não confiar no status HTTP do DELETE.
  for (const id of trash.investmentIds) {
    const inv = await rest<any[]>(ctx, `/rest/v1/investments?id=eq.${id}&select=id`);
    if (inv.data?.length) problems.push(`investments ${id} SOBREVIVEU ao cleanup`);
    const inst = await rest<any[]>(ctx, `/rest/v1/loan_installments?investment_id=eq.${id}&select=id`);
    if (inst.data?.length) problems.push(`${inst.data.length} loan_installments do contrato ${id} SOBREVIVERAM`);
    const tx = await rest<any[]>(ctx, `/rest/v1/payment_transactions?investment_id=eq.${id}&select=id`);
    if (tx.data?.length) problems.push(`${tx.data.length} payment_transactions do contrato ${id} SOBREVIVERAM`);
  }
  for (const id of trash.profileIds) {
    const p = await rest<any[]>(ctx, `/rest/v1/profiles?id=eq.${id}&select=id`);
    if (p.data?.length) problems.push(`profile ${id} SOBREVIVEU ao cleanup`);
  }

  trash.investmentIds = [];
  trash.profileIds = [];

  if (problems.length) {
    throw new Error(`CLEANUP INCOMPLETO — lixo deixado em produção:\n  ${problems.join('\n  ')}`);
  }
  // LIMITAÇÃO CONHECIDA: `audit_events` não tem política de escrita para
  // `authenticated` (só SELECT), então as linhas gravadas pelas RPCs
  // SECURITY DEFINER ficam órfãs. Não há FK para investments, então nada quebra.
  // Removê-las exige service role — fora do escopo desta suíte.
}
