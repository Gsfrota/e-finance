import { useState, useEffect, useRef } from 'react';
import { fetchProfileByAuthUserId, getSupabase, withRetry } from '../services/supabase';
import { getCached, setCached } from '../services/cache';
import { Investment, MonthlyViewData, MonthlyDebtorSummary, MonthlyOverdueEntry } from '../types';

// Tipagem local enriquecida para o frontend
export interface EnrichedInvestment extends Investment {
  roi: number;
  healthStatus: 'ok' | 'late' | 'ended' | 'waiting';
  nextPaymentDate?: string;
}

export type InvestorPeriod = 'month' | 'last_month' | 'year' | 'all';

export interface InvestorFilter {
  period: InvestorPeriod;
  investmentId?: string; // undefined = todos
}

export interface InvestorMetrics {
  totalAllocated: number;
  grossReceived: number;
  interestProfit: number;
  expectedThisMonth: number;
  totalProjectedProfit: number;
  nextPaymentDate: string | null;
  nextPaymentValue: number;
  chartData: { name: string; projected: number; received: number; rawDate: number }[];
  activeContracts: number;
  userName: string;
}

interface RawInstallment {
  due_date: string;
  amount_total: number;
  amount_interest: number;
  amount_paid: number;
  status: string;
  paid_at: string | null;
  fine_amount: number;
  interest_delay_amount: number;
}

interface RawInvestment extends Omit<Investment, 'loan_installments'> {
  loan_installments: RawInstallment[];
  payer?: { id: string; full_name: string } | null;
}

interface CachedRawData {
  invData: RawInvestment[];
  userName: string;
}

interface CachedInvestorData {
  metrics: InvestorMetrics;
  investments: EnrichedInvestment[];
}

// --- Helpers puros ---

export function monthKeyToDate(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

export function dateToMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getPeriodBounds(period: InvestorPeriod): { start: Date; end: Date } {
  const now = new Date();
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { start, end };
  }
  if (period === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { start, end };
  }
  if (period === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    return { start, end };
  }
  // 'all'
  return { start: new Date(0), end: new Date(8640000000000000) };
}

function inPeriod(dateStr: string | null | undefined, bounds: { start: Date; end: Date }): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= bounds.start && d <= bounds.end;
}

function computeMetrics(
  invData: RawInvestment[],
  userName: string,
  filter: InvestorFilter
): { metrics: InvestorMetrics; investments: EnrichedInvestment[] } {
  const bounds = getPeriodBounds(filter.period);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let totalAllocated = 0;
  let grossReceived = 0;
  let interestProfit = 0;
  let expectedThisMonth = 0;
  let totalProjectedProfit = 0;
  let nextPayment: { date: Date; val: number } | null = null;

  const chartMap = new Map<string, { projected: number; received: number; sortDate: number }>();

  const enrichedInvestments: EnrichedInvestment[] = invData.map((inv: RawInvestment) => {
    const matchesContract = !filter.investmentId || String(inv.id) === filter.investmentId;

    if (matchesContract) {
      totalAllocated += Number(inv.amount_invested || 0);
    }

    // BR-REL-002: omite parcelas fantasmas (deferidas via mark_installment_missed)
    const installments = (inv.loan_installments || []).filter(
      i => !(Number(i.amount_total) === 0 && Number(i.amount_paid) === 0 && i.status === 'paid')
    );
    let hasLatePayment = false;
    const isEnded = installments.length > 0 && installments.every((i) => i.status === 'paid');
    let assetNextPaymentStr: string | undefined = undefined;

    installments.forEach((inst) => {
      const dueDate = new Date(inst.due_date + 'T00:00:00');
      const monthKey = dueDate.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      const sortKey = new Date(dueDate.getFullYear(), dueDate.getMonth(), 1).getTime();

      if (inst.status !== 'paid' && dueDate < today) {
        hasLatePayment = true;
      }

      // Chart data — respeita filtro de contrato selecionado
      if (matchesContract) {
        if (!chartMap.has(monthKey)) {
          chartMap.set(monthKey, { projected: 0, received: 0, sortDate: sortKey });
        }
        const chartEntry = chartMap.get(monthKey)!;
        chartEntry.projected += Number(inst.amount_total || 0);
        if (inst.status === 'paid' || inst.status === 'partial') {
          chartEntry.received += Number(inst.amount_paid || 0);
        }
      }

      // Métricas filtradas por contrato
      if (matchesContract) {
        const amountPaid = Number(inst.amount_paid || 0);
        const amountTotal = Number(inst.amount_total || 1);
        const amountInterest = Number(inst.amount_interest || 0);

        // Lucro Bruto: paid/partial com paid_at no período selecionado
        if ((inst.status === 'paid' || inst.status === 'partial') && inPeriod(inst.paid_at, bounds)) {
          grossReceived += amountPaid;
        }

        // Lucro de Juros: proporcional para partial
        if (inst.status === 'paid') {
          interestProfit += amountInterest;
        } else if (inst.status === 'partial') {
          interestProfit += (amountPaid / amountTotal) * amountInterest;
        }

        // Previsto no Período: respeita período selecionado pelo filtro
        if ((inst.status === 'pending' || inst.status === 'late') && inPeriod(inst.due_date + 'T00:00:00', bounds)) {
          expectedThisMonth += Number(inst.amount_total || 0);
        }

        // Total projetado (para gráfico e referência)
        totalProjectedProfit += amountInterest;

        // Próximo pagamento global
        if (inst.status !== 'paid') {
          if (!nextPayment || dueDate < nextPayment.date) {
            nextPayment = { date: dueDate, val: Number(inst.amount_total) };
          }
          if (!assetNextPaymentStr) assetNextPaymentStr = dueDate.toLocaleDateString('pt-BR');
        }
      }
    });

    const invested = Number(inv.amount_invested) || 1;
    const totalReceivable = Number(inv.current_value) || 0;
    const roi = ((totalReceivable - invested) / invested) * 100;

    let healthStatus: 'ok' | 'late' | 'ended' | 'waiting' = 'ok';
    if (isEnded) healthStatus = 'ended';
    else if (hasLatePayment) healthStatus = 'late';
    else if (installments.length === 0) healthStatus = 'waiting';

    return { ...inv, roi, healthStatus, nextPaymentDate: assetNextPaymentStr } as unknown as EnrichedInvestment;
  });

  const chartArray = Array.from(chartMap.values())
    .sort((a, b) => a.sortDate - b.sortDate)
    .map((item) => ({
      name: new Date(item.sortDate).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      projected: item.projected,
      received: item.received,
      rawDate: item.sortDate,
    }));

  const newMetrics: InvestorMetrics = {
    totalAllocated,
    grossReceived: Math.round(grossReceived * 100) / 100,
    interestProfit: Math.round(interestProfit * 100) / 100,
    expectedThisMonth: Math.round(expectedThisMonth * 100) / 100,
    totalProjectedProfit,
    nextPaymentDate: nextPayment ? (nextPayment as { date: Date; val: number }).date.toLocaleDateString('pt-BR') : null,
    nextPaymentValue: nextPayment ? (nextPayment as { date: Date; val: number }).val : 0,
    chartData: chartArray,
    activeContracts: enrichedInvestments.length,
    userName,
  };

  const sortedInvestments = enrichedInvestments.sort((a, b) => {
    const score = (s: string) => (s === 'late' ? 0 : s === 'ok' ? 1 : s === 'waiting' ? 2 : 3);
    return score(a.healthStatus) - score(b.healthStatus);
  });

  return { metrics: newMetrics, investments: sortedInvestments };
}

// --- Visão Mensal (BR-REL-007) ---

export function computeMonthlyView(invData: RawInvestment[], targetMonth: Date): MonthlyViewData {
  const monthStart = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
  const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthLabel = monthStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  let totalExpected = 0;
  let totalPaid = 0;
  let interestReceived = 0;
  let interestExpected = 0;
  let capitalAllocated = 0;

  const overdueEntries: MonthlyOverdueEntry[] = [];
  const debtorMap = new Map<string, MonthlyDebtorSummary>();

  const capitalSet = new Set<number>();

  invData.forEach((inv) => {
    const debtorName = inv.payer?.full_name || inv.asset_name;

    // BR-REL-002: excluir parcelas fantasma
    const installments = (inv.loan_installments || []).filter(
      (i) => !(Number(i.amount_total) === 0 && Number(i.amount_paid) === 0 && i.status === 'paid')
    );

    const monthInstallments = installments.filter((inst) => {
      const d = new Date(inst.due_date + 'T00:00:00');
      return d >= monthStart && d <= monthEnd;
    });

    if (monthInstallments.length === 0) return;

    // Capital alocado: contar cada contrato apenas uma vez
    if (!capitalSet.has(inv.id)) {
      capitalSet.add(inv.id);
      capitalAllocated += Number(inv.amount_invested || 0);
    }

    let debtorDue = 0;
    let debtorPaid = 0;
    let debtorOverdueCount = 0;
    let debtorOverdueAmount = 0;

    monthInstallments.forEach((inst) => {
      const amountTotal = Number(inst.amount_total || 0);
      const amountPaid = Number(inst.amount_paid || 0);
      const amountInterest = Number(inst.amount_interest || 0);

      totalExpected += amountTotal;
      debtorDue += amountTotal;

      if (inst.status === 'paid' || inst.status === 'partial') {
        totalPaid += amountPaid;
        debtorPaid += amountPaid;

        // Juros recebidos: proporcional para partial
        if (inst.status === 'paid') {
          interestReceived += amountInterest;
        } else {
          interestReceived += amountTotal > 0 ? (amountPaid / amountTotal) * amountInterest : 0;
        }
      }

      if (inst.status === 'pending' || inst.status === 'late') {
        interestExpected += amountInterest;
      }

      // Atrasados do mês
      if (inst.status === 'late') {
        const dueDate = new Date(inst.due_date + 'T00:00:00');
        const daysLate = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        const overdueAmt = amountTotal - amountPaid;
        debtorOverdueCount++;
        debtorOverdueAmount += overdueAmt;
        overdueEntries.push({ debtorName, amount: overdueAmt, daysLate: Math.max(0, daysLate) });
      }
    });

    const instRows = monthInstallments.map((inst) => ({
      id: (inst as any).id ?? `${inv.id}-${inst.due_date}`,
      number: (inst as any).number ?? 0,
      due_date: inst.due_date,
      amount_total: Number(inst.amount_total || 0),
      amount_paid: Number(inst.amount_paid || 0),
      amount_interest: Number(inst.amount_interest || 0),
      fine_amount: Number(inst.fine_amount || 0),
      interest_delay_amount: Number(inst.interest_delay_amount || 0),
      status: inst.status,
      contractName: inv.asset_name,
    }));

    const existing = debtorMap.get(debtorName);
    if (existing) {
      existing.totalDue += debtorDue;
      existing.totalPaid += debtorPaid;
      existing.installmentCount += monthInstallments.length;
      existing.overdueCount += debtorOverdueCount;
      existing.overdueAmount += debtorOverdueAmount;
      existing.installments.push(...instRows);
    } else {
      debtorMap.set(debtorName, {
        debtorName,
        totalDue: debtorDue,
        totalPaid: debtorPaid,
        installmentCount: monthInstallments.length,
        overdueCount: debtorOverdueCount,
        overdueAmount: debtorOverdueAmount,
        installments: instRows,
      });
    }
  });

  const paymentPercent = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 10000) / 100 : 0;
  const overdueCount = overdueEntries.length;
  const overdueAmount = overdueEntries.reduce((s, e) => s + e.amount, 0);

  // Agrupa múltiplos contratos do mesmo devedor nos atrasados
  const overdueByDebtorMap = new Map<string, MonthlyOverdueEntry>();
  overdueEntries.forEach((e) => {
    const ex = overdueByDebtorMap.get(e.debtorName);
    if (ex) {
      ex.amount += e.amount;
      ex.daysLate = Math.max(ex.daysLate, e.daysLate);
    } else {
      overdueByDebtorMap.set(e.debtorName, { ...e });
    }
  });

  const debtors = Array.from(debtorMap.values()).sort((a, b) => b.overdueCount - a.overdueCount);

  return {
    month: monthStart,
    monthLabel: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
    totalExpected: Math.round(totalExpected * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    paymentPercent,
    interestReceived: Math.round(interestReceived * 100) / 100,
    interestExpected: Math.round(interestExpected * 100) / 100,
    capitalAllocated: Math.round(capitalAllocated * 100) / 100,
    overdueCount,
    overdueAmount: Math.round(overdueAmount * 100) / 100,
    overdueByDebtor: Array.from(overdueByDebtorMap.values()).sort((a, b) => b.amount - a.amount),
    debtors,
  };
}

// --- Hook ---

const defaultFilter: InvestorFilter = { period: 'month' };

export const useInvestorMetrics = (filter: InvestorFilter = defaultFilter) => {
  const [metricsState, setMetricsState] = useState<InvestorMetrics>(() => ({
    totalAllocated: 0, grossReceived: 0, interestProfit: 0, expectedThisMonth: 0,
    totalProjectedProfit: 0, nextPaymentDate: null, nextPaymentValue: 0,
    chartData: [], activeContracts: 0, userName: '',
  }));
  const [investments, setInvestments] = useState<EnrichedInvestment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);

  // Visão Mensal (BR-REL-007) — usa string "YYYY-MM" para evitar comparação por referência em deps
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(() => dateToMonthKey(new Date()));
  const [monthlyView, setMonthlyView] = useState<MonthlyViewData | null>(null);

  // Guarda o userId para a chave do cache raw
  const userIdRef = useRef<string | null>(null);

  // Effect 1: busca dados do Supabase e cacheia raw
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const supabase = getSupabase();
      if (!supabase) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        userIdRef.current = user.id;
        const rawCacheKey = `investor_raw_${user.id}`;
        const cachedRaw = getCached<CachedRawData>(rawCacheKey);

        if (cachedRaw) {
          const result = computeMetrics(cachedRaw.data.invData, cachedRaw.data.userName, filter);
          setMetricsState(result.metrics);
          setInvestments(result.investments);
          setIsStale(cachedRaw.stale);
        }

        // Busca perfil
        const { data: profile } = await withRetry(async () =>
          await fetchProfileByAuthUserId<{ id: string; full_name?: string }>(supabase, user.id, 'id, full_name')
        );
        const investmentOwnerId = profile?.id || user.id;

        // Busca investimentos com parcelas e devedor
        const { data: invData, error } = await withRetry(async () =>
          await supabase
            .from('investments')
            .select(`
              *,
              payer:profiles!investments_payer_id_fkey(id, full_name),
              loan_installments (
                due_date,
                amount_total,
                amount_interest,
                amount_paid,
                status,
                paid_at,
                fine_amount,
                interest_delay_amount
              )
            `)
            .eq('user_id', investmentOwnerId)
            .order('created_at', { ascending: false })
        );

        if (error) throw error;

        const userName = profile?.full_name?.split(' ')[0] || 'Investidor';
        const rawData: CachedRawData = { invData: invData || [], userName };

        setCached<CachedRawData>(rawCacheKey, rawData);

        const result = computeMetrics(rawData.invData, rawData.userName, filter);
        setMetricsState(result.metrics);
        setInvestments(result.investments);
        setMonthlyView(computeMonthlyView(rawData.invData, monthKeyToDate(selectedMonthKey)));
        setIsStale(false);
      } catch (err) {
        console.error('Erro ao carregar métricas do investidor:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect 2: recomputa quando o filtro muda (sem re-fetch)
  useEffect(() => {
    if (!userIdRef.current) return;
    const rawCacheKey = `investor_raw_${userIdRef.current}`;
    const cachedRaw = getCached<CachedRawData>(rawCacheKey);
    if (!cachedRaw) return;

    const result = computeMetrics(cachedRaw.data.invData, cachedRaw.data.userName, filter);
    setMetricsState(result.metrics);
    setInvestments(result.investments);
  }, [filter.period, filter.investmentId]);

  // Effect 3: recomputa visão mensal quando o mês muda (sem re-fetch)
  useEffect(() => {
    if (!userIdRef.current) return;
    const rawCacheKey = `investor_raw_${userIdRef.current}`;
    const cachedRaw = getCached<CachedRawData>(rawCacheKey);
    if (!cachedRaw) return;
    setMonthlyView(computeMonthlyView(cachedRaw.data.invData, monthKeyToDate(selectedMonthKey)));
  }, [selectedMonthKey]);

  return { metrics: metricsState, investments, loading, isStale, monthlyView, selectedMonthKey, setSelectedMonthKey };
};
