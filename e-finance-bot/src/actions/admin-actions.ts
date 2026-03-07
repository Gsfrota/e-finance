import { randomUUID } from 'crypto';
import { config } from '../config';
import { getGeminiClient, getSupabaseClient } from '../infra/runtime-clients';

function db() {
  return getSupabaseClient();
}

function ai() {
  return getGeminiClient();
}

export interface DashboardSummary {
  receivedMonth: number;
  receivedByPaymentMonth: number;
  receivedByDueMonth: number;
  expectedMonth: number;
  totalOverdue: number;
  activeContracts: number;
  overdueContracts: number;
}

export interface Installment {
  id: string;
  investmentId: string;
  debtorName: string;
  amount: number;
  dueDate: string;
  status: string;
  daysLate: number;
}

export interface ContractDraft {
  debtor_name: string;
  debtor_cpf?: string;
  amount: number;
  rate: number;
  installments: number;
  frequency: string;
  start_date?: string;
  total_repayment?: number;
  due_day?: number;
  derived_rate_source?: 'period_total';
}

export interface ContractParseResult {
  draft: ContractDraft | null;
  mode: 'deterministic' | 'llm_fallback' | 'failed';
  reason?: string;
}

export type DebtorRenameMode = 'ask' | 'use_existing' | 'replace_existing';

export type DebtorResolutionResult =
  | {
      status: 'reused';
      profileId: string;
      debtorName: string;
      debtorCpf: string;
      renameApplied: boolean;
    }
  | {
      status: 'created';
      profileId: string;
      debtorName: string;
      debtorCpf: string;
    }
  | {
      status: 'name_conflict';
      profileId: string;
      debtorCpf: string;
      existingName: string;
      requestedName: string;
    }
  | {
      status: 'error';
      reason:
        | 'invalid_cpf'
        | 'missing_cpf'
        | 'lookup_failed'
        | 'create_failed'
        | 'update_failed'
        | 'requery_failed'
        | 'unexpected_exception';
    };

export type CreateContractResult =
  | {
      status: 'success';
      id: number;
      debtorName: string;
      debtorCpf: string;
      firstInstallment: string;
      debtorResolution: 'created' | 'reused';
      renameApplied?: boolean;
    }
  | {
      status: 'conflict_name';
      debtorCpf: string;
      existingName: string;
      requestedName: string;
    }
  | {
      status: 'error';
      reason: string;
    };

export interface ContractOpenInstallment {
  id: string;
  number: number;
  contractId: number;
  debtorName: string;
  amount: number;
  dueDate: string;
  status: string;
}

export type ContractEditField = 'invested_amount' | 'installment_amount' | 'installment_due_date';

export interface ContractEditSummary {
  contractId: number;
  assetName: string;
  debtorName: string;
  amountInvested: number;
  currentValue: number;
  openInstallments: number;
}

export type EditContractResult =
  | {
      status: 'success';
      field: ContractEditField;
      summary: ContractEditSummary;
      installmentNumber?: number;
      updatedInstallmentCount?: number;
      newAmount?: number;
      newDueDate?: string;
    }
  | {
      status: 'not_found';
      reason: 'contract_not_found' | 'installment_not_found';
    }
  | {
      status: 'invalid_input';
      reason: 'invalid_amount' | 'invalid_due_date' | 'installment_closed' | 'amount_below_paid' | 'missing_installments';
      message: string;
    }
  | {
      status: 'error';
      reason: string;
    };

export interface ContractInstallmentsPage {
  items: ContractOpenInstallment[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface UserDebtDetails {
  totalDebt: number;
  pendingInstallments: number;
  nextDueDate: string | null;
  nextDueAmount: number;
  activeContracts: number;
  totalProjectedProfit: number;
  totalReceivedAmount: number;
  contracts: UserDebtContractSummary[];
}

export interface UserDebtContractSummary {
  contractId: number;
  assetName: string;
  amountInvested: number;
  currentValue: number;
  projectedProfit: number;
  projectedReturnPct: number;
  receivedAmount: number;
  openBalance: number;
  pendingInstallments: number;
  totalInstallments: number;
  nextDueDate: string | null;
  nextDueAmount: number;
}

export type WindowStart = 'today' | 'tomorrow';

export interface DateWindow {
  daysAhead: number;
  windowStart: WindowStart;
  startDate: string;
  endDate: string;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

interface DashboardInstallmentRow {
  investment_id: string;
  amount_total: number | string;
  amount_paid: number | string | null;
  status: string;
  due_date: string;
  paid_at: string | null;
}

const OPERATION_TIMEZONE = 'America/Fortaleza';

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseYmd(value?: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = String(value).split('T')[0].split('-').map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildCanonicalInstallmentSchedule(input: {
  amountInvested: number;
  currentValue: number;
  installmentValue: number;
  totalInstallments: number;
  frequency: string;
  dueDay?: number | null;
  weekday?: number | null;
  startDate?: string | null;
  now?: Date;
}): Array<{
  number: number;
  dueDate: string;
  amountPrincipal: number;
  amountInterest: number;
  amountTotal: number;
}> {
  const totalInstallments = Math.max(1, Math.trunc(input.totalInstallments || 1));
  const amountPrincipal = roundCurrency(input.amountInvested / totalInstallments);
  const amountInterest = roundCurrency((input.currentValue - input.amountInvested) / totalInstallments);
  const amountTotal = roundCurrency(input.installmentValue);
  const dueDay = Math.max(1, Math.min(31, Number(input.dueDay || 1)));
  const weekday = Number.isFinite(input.weekday as number) ? Number(input.weekday) : 1;
  const now = input.now ? new Date(input.now) : new Date();
  let cursorDate = parseYmd(input.startDate) || new Date(now);

  if (input.frequency === 'monthly') {
    if (!parseYmd(input.startDate)) {
      cursorDate = new Date(now);
      cursorDate.setDate(dueDay);
      if (now.getDate() >= dueDay) {
        cursorDate.setMonth(cursorDate.getMonth() + 1);
      }
    }
  } else if (input.frequency === 'weekly') {
    if (!parseYmd(input.startDate)) {
      cursorDate = new Date(now);
      const currentDay = now.getDay();
      let diff = weekday - currentDay;
      if (diff <= 0) diff += 7;
      cursorDate.setDate(now.getDate() + diff);
    }
  }

  const rows: Array<{
    number: number;
    dueDate: string;
    amountPrincipal: number;
    amountInterest: number;
    amountTotal: number;
  }> = [];

  for (let i = 0; i < totalInstallments; i += 1) {
    const due = new Date(cursorDate);

    if (input.frequency === 'monthly') {
      const anchorDay = parseYmd(input.startDate)?.getDate() || dueDay;
      due.setMonth(due.getMonth() + i);
      if (due.getDate() !== anchorDay) due.setDate(0);
    } else if (input.frequency === 'weekly') {
      due.setDate(due.getDate() + (i * 7));
    } else {
      due.setDate(due.getDate() + i);
    }

    rows.push({
      number: i + 1,
      dueDate: formatYmd(due.getFullYear(), due.getMonth() + 1, due.getDate()),
      amountPrincipal,
      amountInterest,
      amountTotal,
    });
  }

  return rows;
}

function formatYmd(year: number, month: number, day: number): string {
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function getDatePartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find(p => p.type === 'year')?.value || 0);
  const month = Number(parts.find(p => p.type === 'month')?.value || 0);
  const day = Number(parts.find(p => p.type === 'day')?.value || 0);

  return { year, month, day };
}

function toYmdInTimeZone(date: Date, timeZone: string): string {
  const parts = getDatePartsInTimeZone(date, timeZone);
  return formatYmd(parts.year, parts.month, parts.day);
}

function getMonthBoundariesInTimeZone(now: Date, timeZone: string): { today: string; monthStart: string; nextMonthStart: string } {
  const { year, month, day } = getDatePartsInTimeZone(now, timeZone);
  const today = formatYmd(year, month, day);
  const monthStart = formatYmd(year, month, 1);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthStart = formatYmd(nextYear, nextMonth, 1);

  return { today, monthStart, nextMonthStart };
}

function addDays(baseDate: Date, days: number): Date {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

function clampDaysAhead(daysAhead?: number): number {
  if (!Number.isFinite(daysAhead || NaN)) return 7;
  return Math.max(1, Math.min(60, Math.trunc(daysAhead as number)));
}

export function buildDateWindow(
  daysAhead = 7,
  windowStart: WindowStart = 'today',
  now: Date = new Date(),
  timeZone = OPERATION_TIMEZONE,
): DateWindow {
  const safeDaysAhead = clampDaysAhead(daysAhead);
  const offset = windowStart === 'tomorrow' ? 1 : 0;

  const startDate = addDays(now, offset);
  const endDate = addDays(startDate, safeDaysAhead - 1);

  return {
    daysAhead: safeDaysAhead,
    windowStart,
    startDate: toYmdInTimeZone(startDate, timeZone),
    endDate: toYmdInTimeZone(endDate, timeZone),
  };
}

function isOpenStatus(status: string): boolean {
  return ['pending', 'late', 'partial'].includes((status || '').toLowerCase());
}

interface UserDebtInvestmentRow {
  id: string | number;
  asset_name?: string | null;
  amount_invested?: number | string | null;
  current_value?: number | string | null;
}

interface UserDebtInstallmentRow {
  investment_id: string | number;
  amount_total?: number | string | null;
  amount_paid?: number | string | null;
  due_date?: string | null;
  status?: string | null;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function roundPct(value: number): number {
  return Number(value.toFixed(2));
}

function emptyUserDebtDetails(activeContracts = 0): UserDebtDetails {
  return {
    totalDebt: 0,
    pendingInstallments: 0,
    nextDueDate: null,
    nextDueAmount: 0,
    activeContracts,
    totalProjectedProfit: 0,
    totalReceivedAmount: 0,
    contracts: [],
  };
}

export function summarizeUserDebtContracts(
  investments: UserDebtInvestmentRow[],
  installments: UserDebtInstallmentRow[],
): UserDebtDetails {
  if (!investments || investments.length === 0) {
    return emptyUserDebtDetails(0);
  }

  const installmentsByContract = new Map<string, UserDebtInstallmentRow[]>();
  for (const row of installments || []) {
    const investmentId = String(row.investment_id || '');
    if (!investmentId) continue;
    const current = installmentsByContract.get(investmentId) || [];
    current.push(row);
    installmentsByContract.set(investmentId, current);
  }

  const contracts: UserDebtContractSummary[] = investments.map(investment => {
    const contractId = Number(investment.id || 0);
    const assetName = String((investment as any).asset_name || `Contrato #${contractId}`);
    const amountInvested = roundMoney(Number((investment as any).amount_invested || 0));
    const currentValueRaw = Number((investment as any).current_value || 0);
    const contractInstallments = installmentsByContract.get(String(investment.id)) || [];

    let receivedAmount = 0;
    let openBalance = 0;
    let pendingInstallments = 0;
    let totalInstallments = 0;
    let nextDueDate: string | null = null;
    let nextDueAmount = 0;
    let fallbackCurrentValue = 0;

    for (const row of contractInstallments) {
      totalInstallments += 1;
      const amountTotal = Number((row as any).amount_total || 0);
      const amountPaid = Number((row as any).amount_paid || 0);
      const dueDate = String((row as any).due_date || '').split('T')[0] || null;
      const remaining = Math.max(0, amountTotal - amountPaid);

      fallbackCurrentValue += amountTotal;
      receivedAmount += amountPaid;

      if (remaining > 0) {
        pendingInstallments += 1;
        openBalance += remaining;
        if (!nextDueDate || (dueDate && dueDate < nextDueDate)) {
          nextDueDate = dueDate;
          nextDueAmount = remaining;
        }
      }
    }

    const currentValue = roundMoney(currentValueRaw > 0 ? currentValueRaw : fallbackCurrentValue);
    const projectedProfit = roundMoney(currentValue - amountInvested);
    const projectedReturnPct = amountInvested > 0
      ? roundPct(((currentValue / amountInvested) - 1) * 100)
      : 0;

    return {
      contractId,
      assetName,
      amountInvested,
      currentValue,
      projectedProfit,
      projectedReturnPct,
      receivedAmount: roundMoney(receivedAmount),
      openBalance: roundMoney(openBalance),
      pendingInstallments,
      totalInstallments,
      nextDueDate,
      nextDueAmount: roundMoney(nextDueAmount),
    };
  }).sort((left, right) => {
    if (left.nextDueDate && right.nextDueDate) {
      return left.nextDueDate.localeCompare(right.nextDueDate) || left.contractId - right.contractId;
    }
    if (left.nextDueDate) return -1;
    if (right.nextDueDate) return 1;
    return left.contractId - right.contractId;
  });

  const totalDebt = roundMoney(contracts.reduce((sum, contract) => sum + contract.openBalance, 0));
  const pendingInstallments = contracts.reduce((sum, contract) => sum + contract.pendingInstallments, 0);
  const totalProjectedProfit = roundMoney(contracts.reduce((sum, contract) => sum + contract.projectedProfit, 0));
  const totalReceivedAmount = roundMoney(contracts.reduce((sum, contract) => sum + contract.receivedAmount, 0));
  const nextContract = contracts.find(contract => !!contract.nextDueDate);

  return {
    totalDebt,
    pendingInstallments,
    nextDueDate: nextContract?.nextDueDate || null,
    nextDueAmount: nextContract?.nextDueAmount || 0,
    activeContracts: contracts.length,
    totalProjectedProfit,
    totalReceivedAmount,
    contracts,
  };
}

export function summarizeDashboardRows(
  rows: DashboardInstallmentRow[],
  activeContracts: number,
  now: Date = new Date(),
  timeZone = OPERATION_TIMEZONE
): DashboardSummary {
  const { today, monthStart, nextMonthStart } = getMonthBoundariesInTimeZone(now, timeZone);

  let receivedByPaymentMonth = 0;
  let receivedByDueMonth = 0;
  let expectedMonth = 0;
  let totalOverdue = 0;
  const overdueInvestmentIds = new Set<string>();

  for (const row of rows) {
    const dueDate = String(row.due_date || '').split('T')[0];
    const paidAt = row.paid_at ? new Date(row.paid_at) : null;
    const paidDate = paidAt && !Number.isNaN(paidAt.getTime())
      ? toYmdInTimeZone(paidAt, timeZone)
      : '';

    const amountTotal = Number(row.amount_total || 0);
    const amountPaid = Number(row.amount_paid || 0);
    const remaining = Math.max(0, amountTotal - amountPaid);
    const status = (row.status || '').toLowerCase();

    if (status === 'paid' && paidDate >= monthStart && paidDate < nextMonthStart) {
      receivedByPaymentMonth += amountPaid;
    }

    if (status === 'paid' && dueDate >= monthStart && dueDate < nextMonthStart) {
      receivedByDueMonth += amountPaid;
    }

    if (isOpenStatus(status) && dueDate >= monthStart && dueDate < nextMonthStart) {
      expectedMonth += remaining;
    }

    if (isOpenStatus(status) && dueDate < today && remaining > 0) {
      totalOverdue += remaining;
      if (row.investment_id) overdueInvestmentIds.add(String(row.investment_id));
    }
  }

  return {
    receivedMonth: receivedByPaymentMonth,
    receivedByPaymentMonth,
    receivedByDueMonth,
    expectedMonth,
    totalOverdue,
    activeContracts,
    overdueContracts: overdueInvestmentIds.size,
  };
}

export async function getDashboardSummary(tenantId: string): Promise<DashboardSummary> {
  const { data: investments, error: investmentsError } = await db()
    .from('investments')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active');

  if (investmentsError) {
    console.error('[dashboard] investments query failed', investmentsError);
    return {
      receivedMonth: 0,
      receivedByPaymentMonth: 0,
      receivedByDueMonth: 0,
      expectedMonth: 0,
      totalOverdue: 0,
      activeContracts: 0,
      overdueContracts: 0,
    };
  }

  const investmentIds = (investments || []).map(i => i.id);

  if (investmentIds.length === 0) {
    return {
      receivedMonth: 0,
      receivedByPaymentMonth: 0,
      receivedByDueMonth: 0,
      expectedMonth: 0,
      totalOverdue: 0,
      activeContracts: 0,
      overdueContracts: 0,
    };
  }

  const { data: installments, error: installmentsError } = await db()
    .from('loan_installments')
    .select('investment_id, amount_total, amount_paid, status, due_date, paid_at')
    .in('investment_id', investmentIds);

  if (installmentsError) {
    console.error('[dashboard] installments query failed', installmentsError);
    return {
      receivedMonth: 0,
      receivedByPaymentMonth: 0,
      receivedByDueMonth: 0,
      expectedMonth: 0,
      totalOverdue: 0,
      activeContracts: investmentIds.length,
      overdueContracts: 0,
    };
  }

  return summarizeDashboardRows((installments || []) as DashboardInstallmentRow[], investmentIds.length);
}

// ─── Recebíveis ───────────────────────────────────────────────────────────────

export async function getInstallments(
  tenantId: string,
  filter: 'pending' | 'late' | 'week' | 'all' = 'pending'
): Promise<Installment[]> {
  let query = db()
    .from('loan_installments')
    .select(`
      id, investment_id, amount_total, amount_paid, due_date, status,
      investments!inner(tenant_id, debtor:profiles!investments_payer_id_fkey(full_name))
    `)
    .eq('investments.tenant_id', tenantId)
    .order('due_date', { ascending: true })
    .limit(10);

  const today = new Date().toISOString().split('T')[0];

  if (filter === 'pending') {
    query = query.in('status', ['pending', 'partial']);
  } else if (filter === 'late') {
    query = query.in('status', ['late', 'pending', 'partial']).lt('due_date', today);
  } else if (filter === 'week') {
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    query = query
      .in('status', ['pending', 'late', 'partial'])
      .gte('due_date', today)
      .lte('due_date', weekEnd.toISOString().split('T')[0]);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getInstallments] query failed', error);
    return [];
  }

  return (data || []).map(row => {
    const dueDate = row.due_date?.split('T')[0] || '';
    const daysLate = dueDate < today
      ? Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000)
      : 0;
    return {
      id: row.id,
      investmentId: row.investment_id,
      debtorName: (row as any).investments?.debtor?.full_name || 'Desconhecido',
      amount: Math.max(0, Number(row.amount_total) - Number(row.amount_paid || 0)),
      dueDate,
      status: row.status,
      daysLate,
    };
  });
}

function mapContractOpenInstallmentRow(row: any, contractId: number): ContractOpenInstallment {
  return {
    id: String(row.id),
    number: Number(row.number || 0),
    contractId,
    debtorName: row?.investments?.debtor?.full_name || 'Desconhecido',
    amount: Math.max(0, Number(row.amount_total || 0) - Number(row.amount_paid || 0)),
    dueDate: String(row.due_date || '').split('T')[0],
    status: String(row.status || 'pending'),
  };
}

export async function getContractOpenInstallments(
  tenantId: string,
  contractId: number,
  page = 0,
  pageSize = 3
): Promise<ContractInstallmentsPage> {
  const safePage = Math.max(0, Math.trunc(page));
  const safePageSize = Math.max(1, Math.min(10, Math.trunc(pageSize)));
  const from = safePage * safePageSize;

  const { data, error } = await db()
    .from('loan_installments')
    .select(`
      id, number, investment_id, amount_total, amount_paid, due_date, status,
      investments!inner(tenant_id, debtor:profiles!investments_payer_id_fkey(full_name))
    `)
    .eq('investments.tenant_id', tenantId)
    .eq('investment_id', contractId)
    .in('status', ['pending', 'late', 'partial'])
    .order('number', { ascending: true })
    .order('due_date', { ascending: true });

  if (error) {
    console.error('[getContractOpenInstallments] query failed', error);
    return { items: [], page: safePage, pageSize: safePageSize, total: 0, hasMore: false };
  }

  const allInstallments = (data || []).map(row => mapContractOpenInstallmentRow(row, Number(contractId)));
  const items = allInstallments.slice(from, from + safePageSize);
  const total = allInstallments.length;
  const hasMore = total > (from + items.length);

  return {
    items,
    page: safePage,
    pageSize: safePageSize,
    total,
    hasMore,
  };
}

export async function getContractOpenInstallmentByNumber(
  tenantId: string,
  contractId: number,
  installmentNumber: number
): Promise<ContractOpenInstallment | null> {
  const safeNumber = Math.max(1, Math.trunc(installmentNumber));

  const { data, error } = await db()
    .from('loan_installments')
    .select(`
      id, number, investment_id, amount_total, amount_paid, due_date, status,
      investments!inner(tenant_id, debtor:profiles!investments_payer_id_fkey(full_name))
    `)
    .eq('investments.tenant_id', tenantId)
    .eq('investment_id', contractId)
    .eq('number', safeNumber)
    .in('status', ['pending', 'late', 'partial'])
    .order('due_date', { ascending: true });

  if (error) {
    console.error('[getContractOpenInstallmentByNumber] query failed', error);
    return null;
  }

  if (!data || data.length === 0) return null;

  return mapContractOpenInstallmentRow(data[0], Number(contractId));
}

// ─── Criar Contrato ───────────────────────────────────────────────────────────

function parsePtBrNumber(raw: string): number | null {
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');

  const n = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractDebtorName(text: string): string | null {
  const byKeyword = text.match(/(?:para|pro|pra|devedor)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{2,80})/i);
  if (byKeyword?.[1]) {
    const cleaned = byKeyword[1]
      .replace(/\s+(cpf\s*:?\s*\d.*)$/i, '')
      .replace(/\s+(r\$|\d.*)$/i, '')
      .trim()
      .replace(/\s+(de|da|do|das|dos)$/i, '')
      .replace(/\s{2,}/g, ' ');
    if (cleaned.length >= 3) return cleaned;
  }

  const firstChunk = text.split(',')[0].trim();
  if (
    firstChunk.length >= 3
    && firstChunk.split(/\s+/).length >= 2
    && !/(contrato|emprest|emprést|valor|taxa|parcel|juros|cpf)/i.test(firstChunk)
  ) {
    return firstChunk;
  }

  return null;
}

function parseAmountCandidate(raw: string, unit?: string): number | null {
  const value = parsePtBrNumber(raw);
  if (value === null) return null;
  const multiplier = unit ? 1000 : 1;
  const amount = value * multiplier;
  return amount >= 1 ? amount : null;
}

function extractPrincipalAndTotal(text: string): { principal: number; total: number } | null {
  const patterns = [
    /(?:receber|pegar|emprestar|emprestimo|empr[eé]stimo)?[^0-9]{0,30}([0-9][0-9.,]*)\s*(mil|k)?\s*(?:reais?|r\$)?\s*por\s*([0-9][0-9.,]*)\s*(mil|k)?\s*(?:reais?|r\$)?/i,
    /([0-9][0-9.,]*)\s*(mil|k)?\s*(?:reais?|r\$)?\s*(?:para\s+pagar|pra\s+pagar|vai\s+pagar|pagar)\s*([0-9][0-9.,]*)\s*(mil|k)?\s*(?:reais?|r\$)?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const principal = parseAmountCandidate(match[1], match[2]);
    const total = parseAmountCandidate(match[3], match[4]);

    if (!principal || !total || total <= principal) continue;
    return { principal, total };
  }

  return null;
}

function extractAmount(text: string): number | null {
  const candidates = [
    text.match(/r\$\s*([0-9][0-9.]*[0-9](?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*(mil|k)?/i),
    text.match(/(?:valor|total|emprestimo|empréstimo|contrato\s+de)\s*(?:de)?\s*([0-9][0-9.]*[0-9](?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*(mil|k)?/i),
    text.match(/([0-9]+(?:[.,][0-9]+)?)\s*(mil|k)\b/i),
    text.match(/([0-9][0-9.]*[0-9](?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*(mil|k)?\s*reais?/i),
  ];

  for (const match of candidates) {
    if (!match?.[1]) continue;
    const value = parseAmountCandidate(match[1], match[2]);
    if (value !== null && value >= 100) return value;
  }

  return null;
}

function extractRate(text: string): number | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!match?.[1]) return null;
  return parsePtBrNumber(match[1]);
}

function extractInstallments(text: string): number | null {
  const match = text.match(/(\d{1,3})\s*(?:x|parcelas?|vezes)/i);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.round(n);
}

function extractDueDay(text: string): number | null {
  const match = text.match(/(?:todo\s+dia|dia\s+de\s+vencimento\s*:?|vence\s+todo\s+dia)\s*(\d{1,2})/i);
  if (!match?.[1]) return null;
  const day = Number(match[1]);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  return day;
}

function extractFrequency(text: string): 'monthly' | 'weekly' | 'biweekly' {
  const normalized = text.toLowerCase();
  if (/biweekly|quinzenal|quinzena|15\s*dias|fortnight/.test(normalized)) return 'biweekly';
  if (/weekly|semanal|semana/.test(normalized)) return 'weekly';
  if (/monthly|mensal/.test(normalized)) return 'monthly';
  return 'monthly';
}

function extractJsonBlock(raw: string): string {
  const cleaned = raw.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) return cleaned.slice(start, end + 1);
  return '{}';
}

export function normalizeCpf(cpf: string | null | undefined): string | null {
  if (!cpf) return null;
  const digits = String(cpf).replace(/\D/g, '');
  if (digits.length !== 11) return null;
  return digits;
}

export function isValidCpf(cpf: string | null | undefined): boolean {
  const normalized = normalizeCpf(cpf);
  if (!normalized) return false;

  if (/^(\d)\1{10}$/.test(normalized)) return false;

  const digits = normalized.split('').map(Number);

  const calcDigit = (slice: number, factorStart: number) => {
    let sum = 0;
    for (let i = 0; i < slice; i += 1) {
      sum += digits[i] * (factorStart - i);
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const d1 = calcDigit(9, 10);
  const d2 = calcDigit(10, 11);

  return d1 === digits[9] && d2 === digits[10];
}

function extractCpf(text: string): string | undefined {
  const match = text.match(/(?:cpf\s*[:\-]?\s*)?(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i);
  if (!match?.[1]) return undefined;
  const normalized = normalizeCpf(match[1]);
  if (!normalized || !isValidCpf(normalized)) return undefined;
  return normalized;
}

function normalizeNameForCompare(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function parseContractTextDeterministic(text: string): ContractDraft | null {
  const debtor_name = extractDebtorName(text);
  const principalTotal = extractPrincipalAndTotal(text);
  const amount = principalTotal?.principal ?? extractAmount(text);

  if (!debtor_name || !amount) return null;

  const explicitRate = extractRate(text);
  const installments = extractInstallments(text) ?? 1;
  const frequency = extractFrequency(text);
  const due_day = extractDueDay(text) ?? undefined;
  const debtor_cpf = extractCpf(text);

  let rate = explicitRate ?? 0;
  let total_repayment: number | undefined;
  let derived_rate_source: 'period_total' | undefined;

  if (principalTotal) {
    total_repayment = principalTotal.total;
    if (explicitRate === null && amount > 0) {
      rate = Number((((principalTotal.total / amount) - 1) * 100).toFixed(4));
      derived_rate_source = 'period_total';
    }
  }

  return {
    debtor_name,
    debtor_cpf,
    amount,
    rate,
    installments,
    frequency,
    due_day,
    total_repayment,
    derived_rate_source,
  };
}

export async function parseContractTextWithMeta(text: string): Promise<ContractParseResult> {
  const deterministic = parseContractTextDeterministic(text);
  if (deterministic) {
    return { draft: deterministic, mode: 'deterministic' };
  }

  try {
    const prompt = 'Extraia dados de um contrato de empréstimo do texto abaixo.\n' +
      'Retorne APENAS JSON com os campos:\n' +
      '- debtor_name: string (nome completo do devedor)\n' +
      '- debtor_cpf: string (CPF com ou sem máscara, se houver)\n' +
      '- amount: number (valor principal em reais, número puro)\n' +
      '- total_repayment: number (valor total a pagar se houver, número puro)\n' +
      '- rate: number (taxa de juros do período total em %, número puro ex: 100)\n' +
      '- installments: number (quantidade de parcelas)\n' +
      '- frequency: "monthly" | "weekly" | "biweekly"\n' +
      '- due_day: number (dia do mês de vencimento, 1-31, se houver)\n\n' +
      'Texto: "' + text + '"';

    const result = await ai().models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const parsed = JSON.parse(extractJsonBlock(result.text?.trim() || '{}'));

    if (!parsed.debtor_name || !parsed.amount) {
      return { draft: null, mode: 'failed', reason: 'llm_missing_required_fields' };
    }

    const parsedAmount = typeof parsed.amount === 'number'
      ? parsed.amount
      : parsePtBrNumber(String(parsed.amount));

    if (!parsedAmount) {
      return { draft: null, mode: 'failed', reason: 'llm_invalid_amount' };
    }

    const dueDay = parsed.due_day === undefined
      ? undefined
      : Math.max(1, Math.min(31, Number(parsed.due_day)));

    const draft: ContractDraft = {
      debtor_name: String(parsed.debtor_name).trim(),
      debtor_cpf: normalizeCpf(parsed.debtor_cpf),
      amount: parsedAmount,
      rate: Number(parsed.rate || 0),
      installments: Math.max(1, Number(parsed.installments || 1)),
      frequency: extractFrequency(String(parsed.frequency || 'monthly')),
      total_repayment: parsed.total_repayment ? Number(parsed.total_repayment) : undefined,
      due_day: Number.isFinite(dueDay) ? dueDay : undefined,
    };

    if (draft.total_repayment && !parsed.rate && draft.total_repayment > draft.amount) {
      draft.rate = Number((((draft.total_repayment / draft.amount) - 1) * 100).toFixed(4));
      draft.derived_rate_source = 'period_total';
    }

    return { draft, mode: 'llm_fallback' };
  } catch {
    return { draft: null, mode: 'failed', reason: 'llm_exception' };
  }
}

export async function parseContractText(text: string): Promise<ContractDraft | null> {
  const parsed = await parseContractTextWithMeta(text);
  return parsed.draft;
}

export async function resolveDebtorForContract(
  tenantId: string,
  debtorName: string,
  debtorCpf: string | undefined,
  renameMode: DebtorRenameMode = 'ask'
): Promise<DebtorResolutionResult> {
  try {
    const normalizedCpf = normalizeCpf(debtorCpf);
    if (!normalizedCpf) return { status: 'error', reason: 'missing_cpf' };
    if (!isValidCpf(normalizedCpf)) return { status: 'error', reason: 'invalid_cpf' };

    const requestedName = (debtorName || '').trim();

    const queryByCpf = async () => db()
      .from('profiles')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .eq('cpf', normalizedCpf)
      .maybeSingle();

    const handleExisting = async (existing: any): Promise<DebtorResolutionResult> => {
      const existingName = String(existing?.full_name || '').trim() || 'Sem nome';
      const sameName = normalizeNameForCompare(existingName) === normalizeNameForCompare(requestedName);

      if (sameName || renameMode === 'use_existing') {
        return {
          status: 'reused',
          profileId: String(existing.id),
          debtorName: existingName,
          debtorCpf: normalizedCpf,
          renameApplied: false,
        };
      }

      if (renameMode === 'replace_existing') {
        const { error: updateError } = await db()
          .from('profiles')
          .update({ full_name: requestedName })
          .eq('id', existing.id)
          .eq('tenant_id', tenantId);

        if (updateError) {
          return { status: 'error', reason: 'update_failed' };
        }

        return {
          status: 'reused',
          profileId: String(existing.id),
          debtorName: requestedName,
          debtorCpf: normalizedCpf,
          renameApplied: true,
        };
      }

      return {
        status: 'name_conflict',
        profileId: String(existing.id),
        debtorCpf: normalizedCpf,
        existingName,
        requestedName,
      };
    };

    const { data: existing, error: existingError } = await queryByCpf();
    if (existingError) {
      console.error('[resolveDebtorForContract] lookup failed', existingError);
      return { status: 'error', reason: 'lookup_failed' };
    }

    if (existing) {
      return handleExisting(existing);
    }

    const { data: created, error: createError } = await db()
      .from('profiles')
      .insert({
        id: randomUUID(),
        full_name: requestedName,
        role: 'debtor',
        tenant_id: tenantId,
        cpf: normalizedCpf,
      })
      .select('id, full_name')
      .single();

    if (createError) {
      // corrida: outro processo pode ter criado o CPF logo antes
      if ((createError as any).code === '23505') {
        const { data: afterConflict, error: afterConflictError } = await queryByCpf();
        if (afterConflictError || !afterConflict) {
          console.error('[resolveDebtorForContract] requery after 23505 failed', afterConflictError);
          return { status: 'error', reason: 'requery_failed' };
        }
        return handleExisting(afterConflict);
      }

      console.error('[resolveDebtorForContract] create failed', createError);
      return { status: 'error', reason: 'create_failed' };
    }

    return {
      status: 'created',
      profileId: String((created as any).id),
      debtorName: String((created as any).full_name || requestedName),
      debtorCpf: normalizedCpf,
    };
  } catch {
    return { status: 'error', reason: 'unexpected_exception' };
  }
}

export async function createContract(
  tenantId: string,
  investorId: string,
  draft: ContractDraft,
  renameMode: DebtorRenameMode = 'ask'
): Promise<CreateContractResult> {
  const debtorResolution = await resolveDebtorForContract(
    tenantId,
    draft.debtor_name,
    draft.debtor_cpf,
    renameMode
  );

  if (debtorResolution.status === 'name_conflict') {
    return {
      status: 'conflict_name',
      debtorCpf: debtorResolution.debtorCpf,
      existingName: debtorResolution.existingName,
      requestedName: debtorResolution.requestedName,
    };
  }

  if (debtorResolution.status === 'error') {
    return { status: 'error', reason: debtorResolution.reason };
  }

  const debtorId = debtorResolution.profileId;
  const resolvedDebtorName = debtorResolution.debtorName;
  const resolvedDebtorCpf = debtorResolution.debtorCpf;

  const startDate = draft.start_date || new Date().toISOString().split('T')[0];
  const currentValue = draft.total_repayment && draft.total_repayment > 0
    ? draft.total_repayment
    : Number((draft.amount * (1 + (draft.rate || 0) / 100)).toFixed(2));
  const installmentValue = Number((currentValue / Math.max(1, draft.installments)).toFixed(2));

  const { data, error } = await db().rpc('create_investment_validated', {
    p_tenant_id: tenantId,
    p_user_id: investorId,
    p_payer_id: debtorId,
    p_asset_name: `Contrato - ${(resolvedDebtorName.split(' ')[0] || 'Devedor').trim()}`,
    p_amount_invested: draft.amount,
    p_source_capital: draft.amount,
    p_source_profit: 0,
    p_current_value: currentValue,
    p_interest_rate: draft.rate,
    p_installment_value: installmentValue,
    p_total_installments: draft.installments,
    p_frequency: draft.frequency,
    p_due_day: draft.due_day ?? null,
    p_start_date: startDate,
  });

  if (error || !data) {
    if (error) console.error('[createContract] rpc failed', error);
    return { status: 'error', reason: 'rpc_failed' };
  }

  const contractId = Number(data);

  const firstName = (resolvedDebtorName.split(' ')[0] || 'Devedor').trim();
  const { error: assetNameUpdateError } = await db()
    .from('investments')
    .update({ asset_name: 'Contrato #' + contractId + ' - ' + firstName })
    .eq('id', data)
    .eq('tenant_id', tenantId);

  if (assetNameUpdateError) {
    console.error('[createContract] asset_name update failed', assetNameUpdateError);
  }

  const { data: firstInstallment, error: firstInstallmentError } = await db()
    .from('loan_installments')
    .select('due_date, amount_total')
    .eq('investment_id', data)
    .order('number', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (firstInstallmentError) {
    console.error('[createContract] firstInstallment query failed', firstInstallmentError);
  }

  return {
    status: 'success',
    id: Number(data),
    debtorName: resolvedDebtorName,
    debtorCpf: resolvedDebtorCpf,
    firstInstallment: firstInstallment
      ? `${formatDate(firstInstallment.due_date)} - ${formatCurrency(Number(firstInstallment.amount_total || 0))}`
      : 'N/A',
    debtorResolution: debtorResolution.status,
    renameApplied: debtorResolution.status === 'reused' ? debtorResolution.renameApplied : undefined,
  };
}

// ─── Editar Contrato ──────────────────────────────────────────────────────────

export async function getContractEditSummary(
  tenantId: string,
  contractId: number,
): Promise<ContractEditSummary | null> {
  const { data: investment, error: investmentError } = await db()
    .from('investments')
    .select('id, asset_name, amount_invested, current_value, payer_id')
    .eq('tenant_id', tenantId)
    .eq('id', contractId)
    .maybeSingle();

  if (investmentError) {
    console.error('[getContractEditSummary] investment query failed', investmentError);
    return null;
  }

  if (!investment) return null;

  const payerId = String((investment as any).payer_id || '');
  const { data: debtor, error: debtorError } = await db()
    .from('profiles')
    .select('full_name')
    .eq('id', payerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (debtorError) {
    console.error('[getContractEditSummary] debtor query failed', debtorError);
    return null;
  }

  const { count, error: countError } = await db()
    .from('loan_installments')
    .select('id', { count: 'exact', head: true })
    .eq('investment_id', contractId)
    .in('status', ['pending', 'late', 'partial']);

  if (countError) {
    console.error('[getContractEditSummary] installments count failed', countError);
    return null;
  }

  return {
    contractId,
    assetName: String((investment as any).asset_name || `Contrato #${contractId}`),
    debtorName: String((debtor as any)?.full_name || 'Devedor'),
    amountInvested: Number((investment as any).amount_invested || 0),
    currentValue: Number((investment as any).current_value || 0),
    openInstallments: Number(count || 0),
  };
}

async function recalculateContractFinancials(
  tenantId: string,
  contractId: number,
): Promise<boolean> {
  const { data: investment, error: investmentError } = await db()
    .from('investments')
    .select('amount_invested')
    .eq('tenant_id', tenantId)
    .eq('id', contractId)
    .single();

  if (investmentError || !investment) {
    console.error('[recalculateContractFinancials] investment query failed', investmentError);
    return false;
  }

  const { data: installments, error: installmentsError } = await db()
    .from('loan_installments')
    .select('amount_total')
    .eq('investment_id', contractId);

  if (installmentsError) {
    console.error('[recalculateContractFinancials] installments query failed', installmentsError);
    return false;
  }

  const currentValue = Number((installments || []).reduce(
    (sum, row) => sum + Number((row as any).amount_total || 0),
    0,
  ).toFixed(2));
  const amountInvested = Number((investment as any).amount_invested || 0);
  const interestRate = amountInvested > 0
    ? Number((((currentValue / amountInvested) - 1) * 100).toFixed(4))
    : 0;

  const { error: updateError } = await db()
    .from('investments')
    .update({
      current_value: currentValue,
      source_capital: amountInvested,
      interest_rate: interestRate,
    })
    .eq('tenant_id', tenantId)
    .eq('id', contractId);

  if (updateError) {
    console.error('[recalculateContractFinancials] update failed', updateError);
    return false;
  }

  return true;
}

export async function editContract(
  tenantId: string,
  input: {
    contractId: number;
    field: ContractEditField;
    newAmount?: number;
    installmentNumber?: number;
    newDueDate?: string;
  },
): Promise<EditContractResult> {
  const summary = await getContractEditSummary(tenantId, input.contractId);
  if (!summary) {
    return { status: 'not_found', reason: 'contract_not_found' };
  }

  if (input.field === 'invested_amount') {
    const newAmount = Number(input.newAmount || 0);
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      return {
        status: 'invalid_input',
        reason: 'invalid_amount',
        message: 'O novo valor emprestado precisa ser maior que zero.',
      };
    }

    const { error } = await db()
      .from('investments')
      .update({
        amount_invested: newAmount,
        source_capital: newAmount,
      })
      .eq('tenant_id', tenantId)
      .eq('id', input.contractId);

    if (error) {
      console.error('[editContract] update invested amount failed', error);
      return { status: 'error', reason: 'update_invested_amount_failed' };
    }

    if (!await recalculateContractFinancials(tenantId, input.contractId)) {
      return { status: 'error', reason: 'recalculate_failed' };
    }

    const refreshedSummary = await getContractEditSummary(tenantId, input.contractId);
    if (!refreshedSummary) {
      return { status: 'error', reason: 'summary_reload_failed' };
    }

    return {
      status: 'success',
      field: input.field,
      summary: refreshedSummary,
      newAmount,
    };
  }

  if (input.field === 'installment_amount') {
    const newAmount = Number(input.newAmount || 0);
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      return {
        status: 'invalid_input',
        reason: 'invalid_amount',
        message: 'O novo valor da parcela precisa ser maior que zero.',
      };
    }

    const { data: installments, error: installmentsError } = await db()
      .from('loan_installments')
      .select('id, amount_paid, status')
      .eq('investment_id', input.contractId)
      .in('status', ['pending', 'late', 'partial']);

    if (installmentsError) {
      console.error('[editContract] open installments query failed', installmentsError);
      return { status: 'error', reason: 'load_open_installments_failed' };
    }

    if (!installments || installments.length === 0) {
      return {
        status: 'invalid_input',
        reason: 'missing_installments',
        message: 'Não encontrei parcelas em aberto para ajustar neste contrato.',
      };
    }

    const invalidPartial = installments.find(row => Number((row as any).amount_paid || 0) > newAmount);
    if (invalidPartial) {
      return {
        status: 'invalid_input',
        reason: 'amount_below_paid',
        message: 'Existe parcela parcialmente paga com valor recebido maior que o novo valor informado.',
      };
    }

    const { error: updateError } = await db()
      .from('loan_installments')
      .update({ amount_total: newAmount })
      .eq('investment_id', input.contractId)
      .in('status', ['pending', 'late', 'partial']);

    if (updateError) {
      console.error('[editContract] update installment amount failed', updateError);
      return { status: 'error', reason: 'update_installment_amount_failed' };
    }

    if (!await recalculateContractFinancials(tenantId, input.contractId)) {
      return { status: 'error', reason: 'recalculate_failed' };
    }

    const refreshedSummary = await getContractEditSummary(tenantId, input.contractId);
    if (!refreshedSummary) {
      return { status: 'error', reason: 'summary_reload_failed' };
    }

    return {
      status: 'success',
      field: input.field,
      summary: refreshedSummary,
      updatedInstallmentCount: installments.length,
      newAmount,
    };
  }

  if (input.field === 'installment_due_date') {
    const installmentNumber = Number(input.installmentNumber || 0);
    const newDueDate = String(input.newDueDate || '').trim();

    if (!installmentNumber || installmentNumber <= 0) {
      return {
        status: 'invalid_input',
        reason: 'installment_closed',
        message: 'Me diga o número da parcela que você quer ajustar.',
      };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDueDate)) {
      return {
        status: 'invalid_input',
        reason: 'invalid_due_date',
        message: 'A nova data da parcela está inválida.',
      };
    }

    const { data: installment, error: installmentError } = await db()
      .from('loan_installments')
      .select('id, status')
      .eq('investment_id', input.contractId)
      .eq('number', installmentNumber)
      .maybeSingle();

    if (installmentError) {
      console.error('[editContract] installment lookup failed', installmentError);
      return { status: 'error', reason: 'installment_lookup_failed' };
    }

    if (!installment) {
      return { status: 'not_found', reason: 'installment_not_found' };
    }

    if (!['pending', 'late', 'partial'].includes(String((installment as any).status || ''))) {
      return {
        status: 'invalid_input',
        reason: 'installment_closed',
        message: 'Só posso editar a data de parcelas em aberto.',
      };
    }

    const { error: updateError } = await db()
      .from('loan_installments')
      .update({ due_date: newDueDate })
      .eq('id', String((installment as any).id));

    if (updateError) {
      console.error('[editContract] installment due date update failed', updateError);
      return { status: 'error', reason: 'update_installment_due_date_failed' };
    }

    return {
      status: 'success',
      field: input.field,
      summary,
      installmentNumber,
      newDueDate,
    };
  }

  return { status: 'error', reason: 'unsupported_field' };
}

// ─── Marcar Pagamento ─────────────────────────────────────────────────────────

export async function markInstallmentPaid(
  installmentId: string,
  tenantId: string
): Promise<boolean> {
  const { data, error: fetchError } = await db()
    .from('loan_installments')
    .select('id, amount_total, investments!inner(tenant_id)')
    .eq('id', installmentId)
    .eq('investments.tenant_id', tenantId)
    .single();

  if (fetchError) {
    console.error('[markInstallmentPaid] fetch failed', fetchError);
    return false;
  }

  if (!data) return false;

  const { error } = await db()
    .from('loan_installments')
    .update({
      status: 'paid',
      amount_paid: Number((data as any).amount_total || 0),
      paid_at: new Date().toISOString(),
    })
    .eq('id', installmentId);

  if (error) {
    console.error('[markInstallmentPaid] update failed', error);
    return false;
  }

  return true;
}

// ─── Buscar Parcela por Devedor e Mês ─────────────────────────────────────────

export interface InstallmentByMonthResult {
  installments: ContractOpenInstallment[];
  debtorName: string;
  debtorId: string;
}

export async function getInstallmentByDebtorAndMonth(
  tenantId: string,
  debtorNameQuery: string,
  month: number,
  year?: number,
): Promise<InstallmentByMonthResult | null> {
  const { data: debtors } = await db()
    .from('profiles')
    .select('id, full_name')
    .eq('tenant_id', tenantId)
    .ilike('full_name', `%${debtorNameQuery}%`)
    .eq('role', 'debtor')
    .limit(3);

  if (!debtors || debtors.length === 0) return null;

  const debtor = debtors[0];
  const debtorId = String(debtor.id);
  const debtorName = String(debtor.full_name);

  const { data: investments } = await db()
    .from('investments')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('payer_id', debtorId)
    .eq('status', 'active');

  if (!investments || investments.length === 0) return null;

  const investmentIds = investments.map(i => i.id);

  let query = db()
    .from('loan_installments')
    .select(`
      id,
      number,
      amount_total,
      due_date,
      status,
      investment_id,
      investments!inner(id, tenant_id, payer_id, profiles!payer_id(full_name))
    `)
    .in('investment_id', investmentIds)
    .in('status', ['pending', 'late', 'partial']);

  if (year) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${endDay}`;
    query = query.gte('due_date', startDate).lte('due_date', endDate);
  } else {
    query = query.filter('due_date', 'ilike', `%-${String(month).padStart(2, '0')}-%`);
  }

  const { data: rows } = await query.order('due_date', { ascending: true }).limit(5);

  if (!rows || rows.length === 0) return null;

  const installments: ContractOpenInstallment[] = rows.map(row => ({
    id: String(row.id),
    number: Number(row.number),
    contractId: Number(row.investment_id),
    debtorName,
    amount: Number((row as any).amount_total || 0),
    dueDate: String(row.due_date),
    status: String(row.status),
  }));

  return { installments, debtorName, debtorId };
}

// ─── Buscar Usuário ───────────────────────────────────────────────────────────

export async function searchUser(tenantId: string, query: string) {
  const { data } = await db()
    .from('profiles')
    .select('id, full_name, role, cpf')
    .eq('tenant_id', tenantId)
    .ilike('full_name', `%${query}%`)
    .limit(5);

  return data || [];
}

export async function getUserDebtDetails(tenantId: string, profileId: string): Promise<UserDebtDetails> {
  const { data: investments, error: investmentsError } = await db()
    .from('investments')
    .select('id, asset_name, amount_invested, current_value')
    .eq('tenant_id', tenantId)
    .eq('payer_id', profileId)
    .eq('status', 'active');

  if (investmentsError) {
    console.error('[getUserDebtDetails] investments query failed', investmentsError);
    return emptyUserDebtDetails();
  }

  if (!investments || investments.length === 0) {
    return emptyUserDebtDetails();
  }

  const ids = investments.map(i => i.id);
  const { data: installments, error: installmentsError } = await db()
    .from('loan_installments')
    .select('investment_id, due_date, amount_total, amount_paid, status')
    .in('investment_id', ids)
    .order('due_date', { ascending: true });

  if (installmentsError) {
    console.error('[getUserDebtDetails] installments query failed', installmentsError);
    return emptyUserDebtDetails(ids.length);
  }

  return summarizeUserDebtContracts(investments as UserDebtInvestmentRow[], installments as UserDebtInstallmentRow[]);
}

export async function getUserDebt(tenantId: string, profileId: string): Promise<number> {
  const { data: investments, error: investmentsError } = await db()
    .from('investments')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('payer_id', profileId);

  if (investmentsError) {
    console.error('[getUserDebt] investments query failed', investmentsError);
    return 0;
  }

  if (!investments || investments.length === 0) return 0;

  const ids = investments.map(i => i.id);
  const { data: installments, error: installmentsError } = await db()
    .from('loan_installments')
    .select('amount_total, amount_paid')
    .in('investment_id', ids)
    .in('status', ['pending', 'late', 'partial']);

  if (installmentsError) {
    console.error('[getUserDebt] installments query failed', installmentsError);
    return 0;
  }

  return (installments || []).reduce(
    (acc, row) => acc + Math.max(0, Number(row.amount_total) - Number(row.amount_paid || 0)),
    0
  );
}

// ─── Gerar Convite ────────────────────────────────────────────────────────────

export async function generateInvite(tenantId: string): Promise<string | null> {
  const { data, error } = await db().rpc('generate_invite_code', {
    p_tenant_id: tenantId,
  });
  if (error || !data) return null;
  return data;
}

// ─── Auth: Vincular conta via magic code ──────────────────────────────────────

export type LinkValidationResult =
  | { status: 'success'; profileId: string; name: string }
  | {
      status: 'already_linked_to_other_profile';
      currentProfileId: string;
      currentProfileName: string;
      codeProfileId: string;
    }
  | { status: 'invalid_or_expired' }
  | { status: 'db_error'; reason: string };

export async function validateLinkCode(
  code: string,
  channel: 'whatsapp' | 'telegram',
  channelUserId: string
): Promise<LinkValidationResult> {
  try {
    const normalizedCode = code.toUpperCase();
    const phoneField = channel === 'whatsapp' ? 'whatsapp_phone' : 'telegram_chat_id';

    const { data: codeData, error: codeError } = await db()
      .from('bot_link_codes')
      .select('id, profile_id, profiles(full_name)')
      .eq('code', normalizedCode)
      .eq('channel', channel)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (codeError || !codeData) {
      return { status: 'invalid_or_expired' };
    }

    const codeProfileId = String(codeData.profile_id);

    const { data: boundProfile, error: boundProfileError } = await db()
      .from('profiles')
      .select('id, full_name')
      .eq(phoneField, channelUserId)
      .maybeSingle();

    if (boundProfileError) {
      return { status: 'db_error', reason: 'lookup_channel_binding_failed' };
    }

    if (boundProfile && String(boundProfile.id) !== codeProfileId) {
      return {
        status: 'already_linked_to_other_profile',
        currentProfileId: String(boundProfile.id),
        currentProfileName: String(boundProfile.full_name || 'usuário atual'),
        codeProfileId,
      };
    }

    const { error: updateProfileError } = await db()
      .from('profiles')
      .update({ [phoneField]: channelUserId })
      .eq('id', codeProfileId);

    if (updateProfileError) {
      return { status: 'db_error', reason: 'update_profile_channel_failed' };
    }

    const { error: markUsedError } = await db()
      .from('bot_link_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', codeData.id)
      .is('used_at', null);

    if (markUsedError) {
      return { status: 'db_error', reason: 'mark_code_used_failed' };
    }

    return {
      status: 'success',
      profileId: codeProfileId,
      name: (codeData as any).profiles?.full_name || 'Usuário',
    };
  } catch {
    return { status: 'db_error', reason: 'unexpected_exception' };
  }
}

// ─── Desconectar Bot ──────────────────────────────────────────────────────────

export async function disconnectBot(
  channel: 'whatsapp' | 'telegram',
  channelUserId: string
): Promise<boolean> {
  const field = channel === 'whatsapp' ? 'whatsapp_phone' : 'telegram_chat_id';

  const { error: profileError } = await db()
    .from('profiles')
    .update({ [field]: null })
    .eq(field, channelUserId);

  if (profileError) return false;

  const { data: sessions, error: sessionsError } = await db()
    .from('bot_sessions')
    .select('id')
    .eq('channel', channel)
    .eq('channel_user_id', channelUserId);

  if (sessionsError) return false;

  const sessionIds = (sessions || []).map(s => s.id);

  if (sessionIds.length > 0) {
    const { error: messagesError } = await db()
      .from('bot_messages')
      .delete()
      .in('session_id', sessionIds);

    if (messagesError) return false;
  }

  const { error: clearSessionError } = await db()
    .from('bot_sessions')
    .update({
      profile_id: null,
      context: {},
      last_active_at: new Date().toISOString(),
    })
    .eq('channel', channel)
    .eq('channel_user_id', channelUserId);

  if (clearSessionError) return false;

  return true;
}

// ─── Recebíveis por Janela ─────────────────────────────────────────────────────

export async function getInstallmentsInWindow(
  tenantId: string,
  daysAhead = 7,
  windowStart: WindowStart = 'today',
): Promise<Installment[]> {
  const window = buildDateWindow(daysAhead, windowStart);
  return getInstallmentsByDateRange(tenantId, window.startDate, window.endDate);
}

export async function getInstallmentsByDateRange(
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<Installment[]> {
  const today = toYmdInTimeZone(new Date(), OPERATION_TIMEZONE);

  const { data, error } = await db()
    .from('loan_installments')
    .select(
      `
      id, investment_id, amount_total, amount_paid, due_date, status,
      investments!inner(tenant_id, debtor:profiles!investments_payer_id_fkey(full_name))
    `
    )
    .eq('investments.tenant_id', tenantId)
    .gte('due_date', startDate)
    .lte('due_date', endDate)
    .in('status', ['pending', 'late', 'partial'])
    .order('due_date', { ascending: true })
    .order('amount_total', { ascending: false });

  if (error) {
    console.error('[getInstallmentsByDateRange] query failed', error);
    return [];
  }

  return (data || []).map(row => {
    const dueDate = row.due_date?.split('T')[0] || '';
    const daysLate = dueDate < today
      ? Math.floor((Date.now() - new Date(`${dueDate}T00:00:00`).getTime()) / 86400000)
      : 0;

    return {
      id: row.id,
      investmentId: row.investment_id,
      debtorName: (row as any).investments?.debtor?.full_name || 'Desconhecido',
      amount: Math.max(0, Number(row.amount_total) - Number(row.amount_paid || 0)),
      dueDate,
      status: row.status,
      daysLate,
    };
  });
}

export async function getInstallmentsToday(tenantId: string): Promise<Installment[]> {
  return getInstallmentsInWindow(tenantId, 1, 'today');
}

// ─── Devedores para Cobrar por Janela ────────────────────────────────────────

export interface DebtorToCollect {
  name: string;
  totalDue: number;
  installmentCount: number;
  oldestDueDate: string;
  daysLate: number;
}

function mapDebtorsToCollect(
  rows: Array<{
    amount_total: number | string;
    amount_paid: number | string | null;
    due_date: string;
    investments?: unknown;
  }>,
  today: string
): DebtorToCollect[] {
  if (!rows || rows.length === 0) return [];

  const byDebtor = new Map<string, { total: number; count: number; oldest: string; daysLate: number }>();
  for (const row of rows) {
    const name = (row as any).investments?.debtor?.full_name || 'Desconhecido';
    const dueDate = String(row.due_date || '').split('T')[0] || today;
    const daysLate = Math.max(
      0,
      Math.floor((Date.now() - new Date(`${dueDate}T00:00:00`).getTime()) / 86400000)
    );
    const value = Math.max(0, Number(row.amount_total) - Number(row.amount_paid || 0));
    const cur = byDebtor.get(name) || { total: 0, count: 0, oldest: dueDate, daysLate: 0 };
    byDebtor.set(name, {
      total: cur.total + value,
      count: cur.count + 1,
      oldest: cur.oldest < dueDate ? cur.oldest : dueDate,
      daysLate: Math.max(cur.daysLate, daysLate),
    });
  }

  return Array.from(byDebtor.entries())
    .map(([name, v]) => ({ name, totalDue: v.total, installmentCount: v.count, oldestDueDate: v.oldest, daysLate: v.daysLate }))
    .sort((a, b) => b.totalDue - a.totalDue);
}

export async function getDebtorsToCollectInWindow(
  tenantId: string,
  daysAhead = 7,
  windowStart: WindowStart = 'today',
): Promise<DebtorToCollect[]> {
  const window = buildDateWindow(daysAhead, windowStart);
  return getDebtorsToCollectByDateRange(tenantId, window.startDate, window.endDate);
}

export async function getDebtorsToCollectByDateRange(
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<DebtorToCollect[]> {
  const today = toYmdInTimeZone(new Date(), OPERATION_TIMEZONE);

  const { data, error } = await db()
    .from('loan_installments')
    .select(
      `
      amount_total, amount_paid, due_date, status,
      investments!inner(tenant_id, debtor:profiles!investments_payer_id_fkey(full_name))
    `
    )
    .eq('investments.tenant_id', tenantId)
    .in('status', ['pending', 'late', 'partial'])
    .gte('due_date', startDate)
    .lte('due_date', endDate)
    .order('due_date', { ascending: true });

  if (error) {
    console.error('[getDebtorsToCollectByDateRange] query failed', error);
    return [];
  }

  return mapDebtorsToCollect(data || [], today);
}

export async function getDebtorsToCollectToday(tenantId: string): Promise<DebtorToCollect[]> {
  return getDebtorsToCollectInWindow(tenantId, 1, 'today');
}

async function getOverdueDebtors(tenantId: string): Promise<DebtorToCollect[]> {
  const today = toYmdInTimeZone(new Date(), OPERATION_TIMEZONE);
  const { data, error } = await db()
    .from('loan_installments')
    .select(`
      amount_total, amount_paid, due_date, status,
      investments!inner(tenant_id, debtor:profiles!investments_payer_id_fkey(full_name))
    `)
    .eq('investments.tenant_id', tenantId)
    .in('status', ['pending', 'late', 'partial'])
    .lt('due_date', today)
    .order('due_date', { ascending: true });

  if (error) {
    console.error('[getOverdueDebtors] query failed', error);
    return [];
  }

  return mapDebtorsToCollect(data || [], today);
}

// ─── Relatório Mensal ─────────────────────────────────────────────────────────

export interface MonthlyReport {
  dashboard: DashboardSummary;
  overdueDebtors: DebtorToCollect[];
  todayInstallments: Installment[];
  topDebtors: Array<{ name: string; totalDebt: number }>;
}

async function getTopDebtors(tenantId: string, limit = 5): Promise<Array<{ name: string; totalDebt: number }>> {
  const { data, error } = await db()
    .from('loan_installments')
    .select(`
      amount_total, amount_paid,
      investments!inner(tenant_id, payer_id, debtor:profiles!investments_payer_id_fkey(full_name))
    `)
    .eq('investments.tenant_id', tenantId)
    .in('status', ['pending', 'late', 'partial']);

  if (error) {
    console.error('[getTopDebtors] query failed', error);
    return [];
  }

  const byDebtor = new Map<string, { name: string; totalDebt: number }>();
  for (const row of data || []) {
    const payerId = String((row as any).investments?.payer_id || '');
    if (!payerId) continue;

    const name = (row as any).investments?.debtor?.full_name || 'Desconhecido';
    const remaining = Math.max(0, Number((row as any).amount_total || 0) - Number((row as any).amount_paid || 0));
    if (remaining <= 0) continue;

    const current = byDebtor.get(payerId) || { name, totalDebt: 0 };
    current.totalDebt += remaining;
    byDebtor.set(payerId, current);
  }

  return Array.from(byDebtor.values())
    .sort((a, b) => b.totalDebt - a.totalDebt)
    .slice(0, Math.max(1, limit));
}

export async function generateMonthlyReport(tenantId: string): Promise<MonthlyReport> {
  const [dashboard, overdueDebtors, todayInstallments, topDebtors] = await Promise.all([
    getDashboardSummary(tenantId),
    getOverdueDebtors(tenantId),
    getInstallmentsToday(tenantId),
    getTopDebtors(tenantId, 5),
  ]);

  return { dashboard, overdueDebtors, todayInstallments, topDebtors };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export interface InvestorPortfolioSummary {
  totalContracts: number;
  totalReceivable: number;
  totalReceived: number;
  nextDueDate: string | null;
  nextDueAmount: number;
  contracts: Array<{
    contractId: number;
    assetName: string;
    openBalance: number;
    receivedAmount: number;
    pendingInstallments: number;
    nextDueDate: string | null;
    nextDueAmount: number;
  }>;
}

export async function getInvestorPortfolio(tenantId: string, investorProfileId: string): Promise<InvestorPortfolioSummary> {
  const { data: investments, error: invError } = await db()
    .from('investments')
    .select('id, asset_name, amount_invested')
    .eq('tenant_id', tenantId)
    .eq('user_id', investorProfileId)
    .eq('status', 'active');

  if (invError || !investments || investments.length === 0) {
    return { totalContracts: 0, totalReceivable: 0, totalReceived: 0, nextDueDate: null, nextDueAmount: 0, contracts: [] };
  }

  const ids = investments.map(i => i.id);
  const { data: installments, error: instError } = await db()
    .from('loan_installments')
    .select('investment_id, due_date, amount_total, amount_paid, status')
    .in('investment_id', ids)
    .order('due_date', { ascending: true });

  if (instError) {
    return { totalContracts: investments.length, totalReceivable: 0, totalReceived: 0, nextDueDate: null, nextDueAmount: 0, contracts: [] };
  }

  const byContract = new Map<number, typeof installments>();
  for (const row of installments || []) {
    const cid = Number(row.investment_id);
    const list = byContract.get(cid) || [];
    list.push(row);
    byContract.set(cid, list);
  }

  let totalReceivable = 0;
  let totalReceived = 0;
  let nextDueDate: string | null = null;
  let nextDueAmount = 0;

  const contracts = investments.map(inv => {
    const cid = Number(inv.id);
    const rows = byContract.get(cid) || [];
    let openBalance = 0;
    let received = 0;
    let pendingInstallments = 0;
    let contractNextDue: string | null = null;
    let contractNextAmount = 0;

    for (const row of rows) {
      const total = Number(row.amount_total || 0);
      const paid = Number(row.amount_paid || 0);
      const remaining = Math.max(0, total - paid);
      received += paid;
      if (remaining > 0) {
        openBalance += remaining;
        pendingInstallments += 1;
        const dd = String(row.due_date || '').split('T')[0];
        if (!contractNextDue || dd < contractNextDue) {
          contractNextDue = dd;
          contractNextAmount = remaining;
        }
      }
    }

    totalReceivable += openBalance;
    totalReceived += received;

    if (contractNextDue && (!nextDueDate || contractNextDue < nextDueDate)) {
      nextDueDate = contractNextDue;
      nextDueAmount = contractNextAmount;
    }

    return {
      contractId: cid,
      assetName: String(inv.asset_name || `Contrato #${cid}`),
      openBalance: roundMoney(openBalance),
      receivedAmount: roundMoney(received),
      pendingInstallments,
      nextDueDate: contractNextDue,
      nextDueAmount: roundMoney(contractNextAmount),
    };
  });

  return {
    totalContracts: investments.length,
    totalReceivable: roundMoney(totalReceivable),
    totalReceived: roundMoney(totalReceived),
    nextDueDate,
    nextDueAmount: roundMoney(nextDueAmount),
    contracts,
  };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('T')[0].split('-');
  return `${day}/${month}/${year}`;
}
