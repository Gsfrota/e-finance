import { useMemo } from 'react';
import { Investment, LoanInstallment, isInactiveContract } from '../types';
import { getBrazilToday, isoToBrazilYMD } from '../services/dateUtils';

// --- TYPES ---

export type ContractCategory = 'bullet' | 'parcelado';
export type ContractFrequency = 'monthly' | 'weekly' | 'daily' | 'freelancer';
export type ContractTypeKey = `${ContractCategory}_${ContractFrequency}`;
export type YieldTypeFilter = 'all' | ContractCategory | ContractTypeKey;
export type YieldPeriod = 'month' | 'last_month' | 'year' | 'all';

export interface YieldFilter {
  typeFilter: YieldTypeFilter;
  period: YieldPeriod;
}

export interface ContractTypeMetrics {
  key: ContractTypeKey | ContractCategory;
  label: string;
  shortLabel: string;
  category: ContractCategory;
  color: string;
  capitalAllocated: number;
  interestReceived: number;
  activeContracts: number;
  projectedYield: number;
  yieldPercent: number;
  monthlyData: { month: string; interest: number }[];
}

export interface YieldTotals {
  capitalAllocated: number;
  interestReceived: number;
  activeContracts: number;
  projectedYield: number;
  prevInterestReceived: number; // Para variação %
}

export interface YieldMetricsResult {
  summaryMetrics: ContractTypeMetrics[];    // [bullet, parcelado]
  granularMetrics: ContractTypeMetrics[];   // [bullet_monthly, parcelado_daily, ...]
  totals: YieldTotals;
  evolutionData: { name: string; bullet: number; parcelado: number }[];
  compositionData: { name: string; value: number; color: string }[];
}

// --- HELPERS ---

const CATEGORY_COLORS: Record<ContractCategory, string> = {
  bullet: '#cab07a',
  parcelado: '#90a0bd',
};

const TYPE_COLORS: Record<ContractTypeKey, string> = {
  bullet_monthly: '#d4be8e',
  bullet_weekly: '#b89a5e',
  bullet_daily: '#e6a23c',
  bullet_freelancer: '#a07840',
  parcelado_monthly: '#a3c4af',
  parcelado_weekly: '#6d9a7d',
  parcelado_daily: '#5b8c6e',
  parcelado_freelancer: '#4a7560',
};

const FREQUENCY_LABELS: Record<ContractFrequency, string> = {
  monthly: 'Mensal',
  weekly: 'Semanal',
  daily: 'Diário',
  freelancer: 'Freelancer',
};

export function classifyContract(
  calculationMode?: string,
  frequency?: string
): { key: ContractTypeKey; category: ContractCategory; label: string; shortLabel: string; color: string; categoryColor: string } {
  const category: ContractCategory = calculationMode === 'interest_only' ? 'bullet' : 'parcelado';
  const freq = (frequency as ContractFrequency) || 'monthly';
  const key: ContractTypeKey = `${category}_${freq}`;
  const categoryLabel = category === 'bullet' ? 'Bullet' : 'Parcelado';
  const freqLabel = FREQUENCY_LABELS[freq] || 'Mensal';
  return {
    key,
    category,
    label: `${categoryLabel} ${freqLabel}`,
    shortLabel: `${categoryLabel[0]}. ${freqLabel}`,
    color: TYPE_COLORS[key] || CATEGORY_COLORS[category],
    categoryColor: CATEGORY_COLORS[category],
  };
}

// Filtra por período
function filterByPeriod<T extends { paid_at?: string }>(
  items: T[],
  period: YieldPeriod
): T[] {
  if (period === 'all') return items;
  const todayYMD = getBrazilToday();
  const [year, monthStr] = todayYMD.split('-');
  const yearNum = Number(year);
  const monthNum = Number(monthStr); // 1-based

  return items.filter((item) => {
    if (!item.paid_at) return false;
    const paidYMD = isoToBrazilYMD(item.paid_at);
    const [pYear, pMonth] = paidYMD.split('-').map(Number);
    if (period === 'month') return pYear === yearNum && pMonth === monthNum;
    if (period === 'last_month') {
      const prevMonth = monthNum === 1 ? 12 : monthNum - 1;
      const prevYear = monthNum === 1 ? yearNum - 1 : yearNum;
      return pYear === prevYear && pMonth === prevMonth;
    }
    if (period === 'year') return pYear === yearNum;
    return true;
  });
}

// Verifica se investimento corresponde ao filtro de tipo
function matchesTypeFilter(
  calculationMode: string | undefined,
  frequency: string | undefined,
  filter: YieldTypeFilter
): boolean {
  if (filter === 'all') return true;
  const { category, key } = classifyContract(calculationMode, frequency);
  if (filter === 'bullet' || filter === 'parcelado') return category === filter;
  return key === filter;
}

// Formata chave de mês para label legível
function monthKey(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function monthLabel(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

// --- MAIN HOOK ---

export function useYieldMetrics(
  investments: Investment[],
  allPaidInstallments: LoanInstallment[],
  pendingInstallments: LoanInstallment[],
  filter: YieldFilter
): YieldMetricsResult {
  return useMemo(() => {
    // Index investments by id para acesso rápido
    const invMap = new Map<number, Investment>();
    investments.forEach((inv) => invMap.set(inv.id, inv));

    // Contratos ativos por tipo (independe de período)
    const activeByType = new Map<ContractTypeKey, { count: number; capital: number }>();
    const activeByCategory = new Map<ContractCategory, { count: number; capital: number }>();

    investments.forEach((inv) => {
      if (isInactiveContract(inv.status) || inv.status === 'defaulted') return;
      const calcMode = inv.calculation_mode;
      const freq = inv.frequency;
      const { key, category } = classifyContract(calcMode, freq);

      if (!matchesTypeFilter(calcMode, freq, filter.typeFilter)) return;

      const capital = Number(inv.amount_invested || 0);

      const existing = activeByType.get(key) || { count: 0, capital: 0 };
      activeByType.set(key, { count: existing.count + 1, capital: existing.capital + capital });

      const catExisting = activeByCategory.get(category) || { count: 0, capital: 0 };
      activeByCategory.set(category, { count: catExisting.count + 1, capital: catExisting.capital + capital });
    });

    // Juros recebidos por tipo (filtrados por período)
    const filteredPaid = filterByPeriod(allPaidInstallments, filter.period);
    const interestByType = new Map<ContractTypeKey, number>();
    const interestByCategory = new Map<ContractCategory, number>();
    const monthlyByType = new Map<ContractTypeKey, Map<number, number>>();
    const monthlyByCategory = new Map<ContractCategory, Map<number, number>>();

    filteredPaid.forEach((inst) => {
      const inv = invMap.get(inst.investment_id);
      if (!inv) return;

      const calcMode = inv.calculation_mode;
      const freq = (inv as any).frequency || inv.frequency;
      if (!matchesTypeFilter(calcMode, freq, filter.typeFilter)) return;

      const { key, category } = classifyContract(calcMode, freq);

      const amountPaid = Number(inst.amount_paid || 0);
      const amountTotal = Number(inst.amount_total || 1);
      const amountInterest = Number(inst.amount_interest || 0);
      const interest = inst.status === 'paid'
        ? amountInterest
        : (amountPaid / amountTotal) * amountInterest;

      interestByType.set(key, (interestByType.get(key) || 0) + interest);
      interestByCategory.set(category, (interestByCategory.get(category) || 0) + interest);

      if (inst.paid_at) {
        const mk = monthKey(new Date(inst.paid_at));
        if (!monthlyByType.has(key)) monthlyByType.set(key, new Map());
        const typeMap = monthlyByType.get(key)!;
        typeMap.set(mk, (typeMap.get(mk) || 0) + interest);

        if (!monthlyByCategory.has(category)) monthlyByCategory.set(category, new Map());
        const catMap = monthlyByCategory.get(category)!;
        catMap.set(mk, (catMap.get(mk) || 0) + interest);
      }
    });

    // Rendimento projetado por tipo (parcelas pendentes/atrasadas futuras)
    const projectedByType = new Map<ContractTypeKey, number>();
    const projectedByCategory = new Map<ContractCategory, number>();

    pendingInstallments.forEach((inst) => {
      if (inst.status === 'paid') return;
      const inv = invMap.get(inst.investment_id);
      if (!inv) return;

      const calcMode = inv.calculation_mode;
      const freq = (inv as any).frequency || inv.frequency;
      if (!matchesTypeFilter(calcMode, freq, filter.typeFilter)) return;

      const { key, category } = classifyContract(calcMode, freq);
      const interest = Number(inst.amount_interest || 0);

      projectedByType.set(key, (projectedByType.get(key) || 0) + interest);
      projectedByCategory.set(category, (projectedByCategory.get(category) || 0) + interest);
    });

    // --- Montar summaryMetrics (bullet, parcelado) ---
    const categories: ContractCategory[] = ['bullet', 'parcelado'];
    const summaryMetrics: ContractTypeMetrics[] = categories
      .map((cat) => {
        const active = activeByCategory.get(cat) || { count: 0, capital: 0 };
        const interest = interestByCategory.get(cat) || 0;
        const projected = projectedByCategory.get(cat) || 0;
        const monthMap = monthlyByCategory.get(cat) || new Map();
        const sortedMonths = Array.from(monthMap.entries()).sort((a, b) => a[0] - b[0]);

        return {
          key: cat,
          label: cat === 'bullet' ? 'Bullet (todos)' : 'Parcelado (todos)',
          shortLabel: cat === 'bullet' ? 'Bullet' : 'Parcelado',
          category: cat,
          color: CATEGORY_COLORS[cat],
          capitalAllocated: active.capital,
          interestReceived: interest,
          activeContracts: active.count,
          projectedYield: projected,
          yieldPercent: active.capital > 0 ? (interest / active.capital) * 100 : 0,
          monthlyData: sortedMonths.map(([ts, val]) => ({ month: monthLabel(ts), interest: val })),
        } satisfies ContractTypeMetrics;
      })
      .filter((m) => m.activeContracts > 0 || m.interestReceived > 0);

    // --- Montar granularMetrics (bullet_monthly, parcelado_daily, etc.) ---
    const allTypeKeys = new Set<ContractTypeKey>();
    activeByType.forEach((_, k) => allTypeKeys.add(k));
    interestByType.forEach((_, k) => allTypeKeys.add(k));

    const granularMetrics: ContractTypeMetrics[] = Array.from(allTypeKeys)
      .map((key) => {
        const active = activeByType.get(key) || { count: 0, capital: 0 };
        const interest = interestByType.get(key) || 0;
        const projected = projectedByType.get(key) || 0;
        const monthMap = monthlyByType.get(key) || new Map();
        const sortedMonths = Array.from(monthMap.entries()).sort((a, b) => a[0] - b[0]);

        const [catStr, freqStr] = key.split('_') as [ContractCategory, ContractFrequency];
        const { label, shortLabel, color, category } = classifyContract(
          catStr === 'bullet' ? 'interest_only' : 'auto',
          freqStr
        );

        return {
          key,
          label,
          shortLabel,
          category,
          color,
          capitalAllocated: active.capital,
          interestReceived: interest,
          activeContracts: active.count,
          projectedYield: projected,
          yieldPercent: active.capital > 0 ? (interest / active.capital) * 100 : 0,
          monthlyData: sortedMonths.map(([ts, val]) => ({ month: monthLabel(ts), interest: val })),
        } satisfies ContractTypeMetrics;
      })
      .filter((m) => m.activeContracts > 0 || m.interestReceived > 0)
      .sort((a, b) => b.capitalAllocated - a.capitalAllocated);

    // --- Totals ---
    const relevantMetrics = filter.typeFilter === 'all'
      ? summaryMetrics
      : granularMetrics.filter((m) =>
          filter.typeFilter === m.category || filter.typeFilter === m.key
        );

    const totals: YieldTotals = {
      capitalAllocated: relevantMetrics.reduce((s, m) => s + m.capitalAllocated, 0),
      interestReceived: relevantMetrics.reduce((s, m) => s + m.interestReceived, 0),
      activeContracts: relevantMetrics.reduce((s, m) => s + m.activeContracts, 0),
      projectedYield: relevantMetrics.reduce((s, m) => s + m.projectedYield, 0),
      prevInterestReceived: 0, // Calculado abaixo
    };

    // Calcula mês anterior para variação %
    const prevFilter: YieldFilter = {
      ...filter,
      period: filter.period === 'month' ? 'last_month' : filter.period,
    };
    if (filter.period === 'month') {
      const prevPaid = filterByPeriod(allPaidInstallments, 'last_month');
      let prevInterest = 0;
      prevPaid.forEach((inst) => {
        const inv = invMap.get(inst.investment_id);
        if (!inv) return;
        if (!matchesTypeFilter(inv.calculation_mode, (inv as any).frequency || inv.frequency, filter.typeFilter)) return;
        const amountPaid = Number(inst.amount_paid || 0);
        const amountTotal = Number(inst.amount_total || 1);
        const amountInterest = Number(inst.amount_interest || 0);
        prevInterest += inst.status === 'paid' ? amountInterest : (amountPaid / amountTotal) * amountInterest;
      });
      totals.prevInterestReceived = prevInterest;
    }
    // Suppress unused variable warning
    void prevFilter;

    // --- Evolution data para StackedBarChart ---
    // Une os meses de ambas as categorias
    const allMonthKeys = new Set<number>();
    monthlyByCategory.forEach((m) => m.forEach((_, k) => allMonthKeys.add(k)));

    const evolutionData = Array.from(allMonthKeys)
      .sort((a, b) => a - b)
      .map((ts) => ({
        name: monthLabel(ts),
        bullet: Math.round(((monthlyByCategory.get('bullet') || new Map()).get(ts) || 0) * 100) / 100,
        parcelado: Math.round(((monthlyByCategory.get('parcelado') || new Map()).get(ts) || 0) * 100) / 100,
      }));

    // --- Composition data para Donut ---
    const compositionData = summaryMetrics
      .filter((m) => m.capitalAllocated > 0)
      .map((m) => ({
        name: m.shortLabel,
        value: m.capitalAllocated,
        color: m.color,
      }));

    return { summaryMetrics, granularMetrics, totals, evolutionData, compositionData };
  }, [investments, allPaidInstallments, pendingInstallments, filter]);
}

// --- DROPDOWN OPTIONS HELPER ---

export function buildTypeFilterOptions(
  summaryMetrics: ContractTypeMetrics[],
  granularMetrics: ContractTypeMetrics[]
): { value: YieldTypeFilter; label: string; group?: string }[] {
  const options: { value: YieldTypeFilter; label: string; group?: string }[] = [
    { value: 'all', label: 'Todos os tipos' },
  ];

  if (summaryMetrics.some((m) => m.category === 'bullet')) {
    options.push({ value: 'bullet', label: 'Bullet (todos)', group: 'categoria' });
  }
  if (summaryMetrics.some((m) => m.category === 'parcelado')) {
    options.push({ value: 'parcelado', label: 'Parcelado (todos)', group: 'categoria' });
  }

  granularMetrics.forEach((m) => {
    options.push({ value: m.key as ContractTypeKey, label: m.label, group: 'granular' });
  });

  return options;
}
