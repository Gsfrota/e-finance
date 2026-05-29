import { config } from '../config';
import { getSupabaseClient } from '../infra/runtime-clients';
import { generatePixString } from '../services/pix';
import { formatCurrency } from './admin-actions';

function db() {
  return getSupabaseClient();
}

export interface SubscriptionTenant {
  id: string;
  name: string | null;
  plan: string | null;
  plan_status: string | null;
  subscription_due_day: number | null;
}

const PLAN_LABELS: Record<string, string> = {
  caderneta: 'Caderneta',
  empresarial: 'Empresarial',
};

const PAID_PLANS = new Set(['caderneta', 'empresarial']);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Data atual em BRT (UTC-3), zerada à meia-noite, como timestamp UTC. */
function brtMidnight(now = new Date()): Date {
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()));
}

function clampDayOfMonth(year: number, month: number, dueDay: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.min(dueDay, lastDay);
}

/** Vencimento de um dia fixo no mês de `ref` (com clamp p/ meses curtos). */
function dueDateInMonth(ref: Date, dueDay: number): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), clampDayOfMonth(ref.getUTCFullYear(), ref.getUTCMonth(), dueDay)));
}

/**
 * Próximo vencimento (>= hoje) para um dia fixo do mês, em BRT.
 * Se o dia já passou neste mês, retorna o vencimento do próximo mês.
 */
export function nextDueDate(dueDay: number, now = new Date()): Date {
  const today = brtMidnight(now);
  let due = dueDateInMonth(today, dueDay);
  if (due.getTime() < today.getTime()) {
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    due = dueDateInMonth(nextMonth, dueDay);
  }
  return due;
}

/**
 * Vencimento RELEVANTE para o lembrete: o mais próximo de hoje considerando
 * que o do mês atual pode ter acabado de passar e ainda estar no período de
 * graça (cobrança em atraso). Retorna o vencimento que cai na janela
 * [-graceDays .. +leadDays] em relação a hoje, ou null se nenhum cai.
 *
 * Prioriza o vencimento PASSADO em atraso (regularização) sobre o futuro.
 */
export function relevantDueDate(
  dueDay: number,
  now = new Date(),
  leadDays = config.billing.reminderLeadDays,
  graceDays = config.billing.reminderGraceDays,
): Date | null {
  const today = brtMidnight(now);
  const thisMonthDue = dueDateInMonth(today, dueDay);
  const daysFromThisMonth = Math.round((thisMonthDue.getTime() - today.getTime()) / DAY_MS);

  // Vencimento do mês corrente já passou mas ainda dentro da graça → em atraso.
  if (daysFromThisMonth < 0 && -daysFromThisMonth <= graceDays) return thisMonthDue;
  // Vencimento do mês corrente está chegando dentro da antecedência.
  if (daysFromThisMonth >= 0 && daysFromThisMonth <= leadDays) return thisMonthDue;

  // Próximo vencimento (mês seguinte) chegando dentro da antecedência.
  const next = nextDueDate(dueDay, now);
  const daysUntilNext = Math.round((next.getTime() - today.getTime()) / DAY_MS);
  if (daysUntilNext >= 0 && daysUntilNext <= leadDays) return next;

  return null;
}

/** Ciclo de cobrança 'YYYY-MM' de um vencimento específico. */
export function cycleOf(due: Date): string {
  return `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** O ciclo de cobrança atual no formato 'YYYY-MM' (mês do próximo vencimento). */
export function dueCycle(dueDay: number, now = new Date()): string {
  return cycleOf(nextDueDate(dueDay, now));
}

/** Inteiro de dias em atraso de um vencimento (0 se ainda não venceu). */
export function daysOverdue(due: Date, now = new Date()): number {
  const today = brtMidnight(now);
  const diff = Math.round((today.getTime() - due.getTime()) / DAY_MS);
  return diff > 0 ? diff : 0;
}

/**
 * Está na janela de lembrete? Cobre antecedência (antes) E período de graça
 * (em atraso, depois do vencimento).
 */
export function isWithinReminderWindow(
  dueDay: number,
  now = new Date(),
  leadDays = config.billing.reminderLeadDays,
  graceDays = config.billing.reminderGraceDays,
): boolean {
  return relevantDueDate(dueDay, now, leadDays, graceDays) !== null;
}

function formatDueDateBr(due: Date): string {
  return `${String(due.getUTCDate()).padStart(2, '0')}/${String(due.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface SubscriptionPixBlock {
  message: string;
  copyPaste: string;
  amount: number;
  due: Date;
}

/**
 * Monta o bloco de pagamento da mensalidade (texto + copia-e-cola PIX).
 * Fonte única usada pelo lembrete proativo e pela consulta on-demand.
 * Retorna `null` se faltar configuração (chave/cidade/valor do plano) — o
 * chamador decide a mensagem de fallback.
 */
export function buildSubscriptionPixBlock(
  plan: string | null,
  dueDay: number | null,
  now = new Date()
): SubscriptionPixBlock | null {
  const { pixKey, pixName, pixCity, amountByPlan } = config.billing;
  if (!pixKey || !pixName || !pixCity) return null;
  if (!plan || !dueDay) return null;

  const amount = amountByPlan[plan] || 0;
  if (amount <= 0) return null;

  // Vencimento relevante (em atraso na graça, ou o próximo a chegar). Fora de
  // qualquer janela, cai no próximo vencimento (usado pela consulta on-demand).
  const due = relevantDueDate(dueDay, now) ?? nextDueDate(dueDay, now);
  const overdue = daysOverdue(due, now);
  const planLabel = PLAN_LABELS[plan] || plan;
  const copyPaste = generatePixString(pixKey, pixName, pixCity, amount, '***');
  if (!copyPaste) return null;

  const statusLine = overdue > 0
    ? `Valor: *${formatCurrency(amount)}* · *venceu em ${formatDueDateBr(due)}* (há ${overdue} dia${overdue > 1 ? 's' : ''}) — regularize pra não perder o acesso. 🙏`
    : `Valor: *${formatCurrency(amount)}* · vence em *${formatDueDateBr(due)}*`;

  const message =
    `💳 *Mensalidade do Juros Certo* — plano *${planLabel}*\n` +
    `${statusLine}\n\n` +
    `Pague pelo PIX (copia e cola):\n` +
    `${copyPaste}\n\n` +
    `Beneficiário: *${pixName}*. É só colar no app do seu banco. 🙂`;

  return { message, copyPaste, amount, due };
}

/**
 * Tenants com dia de vencimento configurado e plano pago — candidatos ao
 * lembrete de mensalidade. A janela e o dedup ficam a cargo do chamador.
 */
export async function getTenantsForSubscriptionReminder(): Promise<SubscriptionTenant[]> {
  const { data, error } = await db()
    .from('tenants')
    .select('id, name, plan, plan_status, subscription_due_day')
    .not('subscription_due_day', 'is', null);

  if (error) {
    console.error('[billing-actions] erro ao buscar tenants:', error.message);
    return [];
  }

  return ((data ?? []) as SubscriptionTenant[]).filter(
    t => t.plan != null && PAID_PLANS.has(t.plan)
  );
}

/** Dados de assinatura de um único tenant (para a consulta on-demand). */
export async function getSubscriptionTenant(tenantId: string): Promise<SubscriptionTenant | null> {
  const { data, error } = await db()
    .from('tenants')
    .select('id, name, plan, plan_status, subscription_due_day')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) {
    console.error('[billing-actions] erro ao buscar tenant:', error.message);
    return null;
  }
  return (data as SubscriptionTenant | null) ?? null;
}
