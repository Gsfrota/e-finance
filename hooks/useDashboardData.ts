
import { useState, useEffect, useCallback } from 'react';
import { getSupabase, withRetry } from '../services/supabase';
import { getCached, setCached } from '../services/cache';
import { Investment, LoanInstallment, AdminDashboardStats, DashboardKPIs } from '../types';

// --- TYPES ---

export interface DashboardDataState {
  stats: AdminDashboardStats;
  detailedKPIs: DashboardKPIs;
  investments: Investment[];
  installments: LoanInstallment[];
  loading: boolean;
  isStale: boolean;
  error: string | null;
  refetch: () => void;
  monthRange: { start: string; end: string };
}

// --- HELPERS ---

const normalizeNumber = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
};

const getMonthRange = () => {
  // Brasília = UTC-3. Midnight Brasília = 03:00 UTC.
  // Shift "now" back 3h to get the correct local month/year in Brazil.
  const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const brazilNow = new Date(now.getTime() - BRAZIL_OFFSET_MS);
  const year = brazilNow.getUTCFullYear();
  const month = brazilNow.getUTCMonth();

  // Month boundaries anchored at Brazil midnight (= 03:00 UTC)
  const start = new Date(Date.UTC(year, month, 1, 3, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 3, 0, 0));
  const startYMD = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endYMD = new Date(Date.UTC(year, month + 1, 1)).toISOString().split('T')[0];

  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    startYMD,
    endYMD
  };
};

const calculateOutstanding = (inst: any): number => {
  const total = normalizeNumber(inst.amount_total);
  const fine = normalizeNumber(inst.fine_amount);
  const interestDelay = normalizeNumber(inst.interest_delay_amount);
  const paid = normalizeNumber(inst.amount_paid);
  
  return Math.max(0, (total + fine + interestDelay) - paid);
};

// --- KPI BUILDER ENGINE ---
const buildKPIs = (
    investments: Investment[],
    installments: LoanInstallment[], 
    monthRange: { startISO: string; endISO: string; startYMD: string; endYMD: string }
): DashboardKPIs => {
    const kpis: DashboardKPIs = {
        receivedMonth: 0,
        receivedByPaymentMonth: 0,
        receivedByDueMonth: 0,
        expectedMonth: 0,
        totalInvestedHistorical: 0,
        totalPrincipalRepaid: 0,
        totalProfitReceived: 0,
        totalProfitPotential: 0,
        totalProfitReceivable: 0,
        activeStreetMoney: 0,
        activeOwnCapital: 0,        // Inicializa zerado
        activeReinvestedCapital: 0, // Inicializa zerado
        totalOverdue: 0,
        totalReceivable: 0,
        activeContractsCount: investments.length,
        overdueContractsCount: 0,
        receivedToday: 0,
        receivedTodayCount: 0,
    };

    const todayYMD = new Date().toISOString().split('T')[0];
    const overdueContractIds = new Set<number>();

    // Map para acesso rápido aos dados de origem do contrato
    const invMap = new Map<number, { sourceCapital: number, sourceProfit: number, totalInvested: number }>();

    // 1. Processa Contratos (Totais Históricos)
    investments.forEach(inv => {
        const principal = normalizeNumber(inv.amount_invested);
        const totalValue = normalizeNumber(inv.current_value);
        const srcCap = normalizeNumber(inv.source_capital);
        const srcProf = normalizeNumber(inv.source_profit);
        
        kpis.totalInvestedHistorical += principal;
        kpis.totalProfitPotential += Math.max(0, totalValue - principal);

        invMap.set(inv.id, { 
            sourceCapital: srcCap, 
            sourceProfit: srcProf,
            totalInvested: principal
        });
    });

    // Variáveis auxiliares para rastrear quanto de principal foi pago por origem
    let totalRepaidOwn = 0;
    let totalRepaidProfit = 0;

    // 2. Processa Parcelas
    installments.forEach(inst => {
        const amountTotal = normalizeNumber(inst.amount_total);
        const amountPrincipal = normalizeNumber(inst.amount_principal);
        const amountInterest = normalizeNumber(inst.amount_interest);
        const amountPaid = normalizeNumber(inst.amount_paid);
        const fine = normalizeNumber(inst.fine_amount);
        const delayInterest = normalizeNumber(inst.interest_delay_amount);
        
        const totalObligation = amountTotal + fine + delayInterest;
        const outstanding = Math.max(0, totalObligation - amountPaid);
        
        const isPaid = inst.status === 'paid';
        const isOverdue = (inst.due_date < todayYMD) && !isPaid && (outstanding > 0.01);

        if (amountPaid > 0) {
            const contractualTotal = amountPrincipal + amountInterest;
            const principalRatio = contractualTotal > 0 ? amountPrincipal / contractualTotal : 0;
            
            const principalPartPaid = amountPaid * principalRatio;
            const profitPartPaid = amountPaid * (1 - principalRatio);

            kpis.totalPrincipalRepaid += principalPartPaid;
            kpis.totalProfitReceived += profitPartPaid;

            // Lógica de Atribuição da Amortização (Capital Próprio vs Juros Reinvestidos)
            const contractData = invMap.get(inst.investment_id);
            if (contractData && contractData.totalInvested > 0) {
                // Proporção original do contrato
                const ownRatio = contractData.sourceCapital / contractData.totalInvested;
                const profitRatio = contractData.sourceProfit / contractData.totalInvested;

                // Deduz proporcionalmente do que foi pago
                totalRepaidOwn += principalPartPaid * ownRatio;
                totalRepaidProfit += principalPartPaid * profitRatio;
            }
        }

        if (inst.paid_at) {
            if (inst.paid_at.startsWith(todayYMD)) {
                kpis.receivedToday += amountPaid;
                kpis.receivedTodayCount++;
            }
            const paidAt = new Date(inst.paid_at);
            const rangeStart = new Date(monthRange.startISO);
            const rangeEnd = new Date(monthRange.endISO);
            if (!isNaN(paidAt.getTime()) && paidAt >= rangeStart && paidAt < rangeEnd) {
                kpis.receivedMonth += amountPaid;
                kpis.receivedByPaymentMonth += amountPaid;
            }
        }
        if (inst.due_date >= monthRange.startYMD && inst.due_date < monthRange.endYMD && isPaid) {
            kpis.receivedByDueMonth += amountPaid;
        }

        if (
          inst.due_date >= monthRange.startYMD &&
          inst.due_date < monthRange.endYMD &&
          (inst.status === 'pending' || inst.status === 'late' || inst.status === 'partial')
        ) {
            kpis.expectedMonth += outstanding;
        }

        if (outstanding > 0) {
            kpis.totalReceivable += outstanding;
            if (isOverdue) {
                kpis.totalOverdue += outstanding;
                overdueContractIds.add(inst.investment_id);
            }
        }
    });

    kpis.totalProfitReceivable = Math.max(0, kpis.totalProfitPotential - kpis.totalProfitReceived);
    kpis.activeStreetMoney = Math.max(0, kpis.totalInvestedHistorical - kpis.totalPrincipalRepaid);

    // Cálculos Finais de Capital Ativo
    // Total Histórico Aportado (Soma de todos os contratos)
    let totalOwnInvestedHistorical = 0;
    let totalProfitInvestedHistorical = 0;
    
    invMap.forEach(v => {
        totalOwnInvestedHistorical += v.sourceCapital;
        totalProfitInvestedHistorical += v.sourceProfit;
    });

    // O que está na rua = O que entrou - O que já voltou (Amortizado)
    kpis.activeOwnCapital = Math.max(0, totalOwnInvestedHistorical - totalRepaidOwn);
    kpis.activeReinvestedCapital = Math.max(0, totalProfitInvestedHistorical - totalRepaidProfit);
    kpis.overdueContractsCount = overdueContractIds.size;

    return kpis;
};


// --- INITIAL STATES ---

const INITIAL_STATS: AdminDashboardStats = {
  active_portfolio: 0,
  expected_month: 0,
  received_month: 0,
  total_overdue: 0,
  active_contracts: 0
};

const INITIAL_KPIS: DashboardKPIs = {
    receivedMonth: 0,
    receivedByPaymentMonth: 0,
    receivedByDueMonth: 0,
    expectedMonth: 0,
    totalInvestedHistorical: 0,
    totalPrincipalRepaid: 0,
    totalProfitReceived: 0,
    totalProfitPotential: 0,
    totalProfitReceivable: 0,
    activeStreetMoney: 0,
    activeOwnCapital: 0,
    activeReinvestedCapital: 0,
    totalOverdue: 0,
    totalReceivable: 0,
    activeContractsCount: 0,
    overdueContractsCount: 0,
    receivedToday: 0,
    receivedTodayCount: 0,
};

interface CachedDashboard {
  stats: AdminDashboardStats;
  detailedKPIs: DashboardKPIs;
  investments: Investment[];
  installments: LoanInstallment[];
  monthRange: { start: string; end: string };
}

export const useDashboardData = (tenantId?: string) => {
  const [data, setData] = useState<DashboardDataState>(() => {
    const cacheKey = `dashboard_${tenantId ?? 'default'}`;
    const cached = getCached<CachedDashboard>(cacheKey);
    if (cached) {
      return {
        ...cached.data,
        loading: true,
        isStale: true,
        error: null,
        refetch: () => {},
      };
    }
    return {
      stats: INITIAL_STATS,
      detailedKPIs: INITIAL_KPIS,
      investments: [],
      installments: [],
      loading: true,
      isStale: false,
      error: null,
      refetch: () => {},
      monthRange: { start: '', end: '' }
    };
  });

  const fetchData = useCallback(async () => {
    setData(prev => ({ ...prev, loading: true, error: null }));
    const supabase = getSupabase();

    if (!supabase) {
      setData(prev => ({ ...prev, loading: false, error: "Supabase client not initialized" }));
      return;
    }

    try {
      const monthRange = getMonthRange();
      const todayYMD = new Date().toISOString().split('T')[0];

      // 1. Investimentos
      const investmentsPromise = withRetry(async () =>
        await supabase
          .from('investments')
          .select(`
            *,
            investor:profiles!investments_user_id_fkey(id, full_name, email, role),
            payer:profiles!investments_payer_id_fkey(id, full_name, email, photo_url)
          `)
          .order('created_at', { ascending: false })
      );

      // 2. Todas as Parcelas
      const installmentsPromise = withRetry(async () =>
        await supabase
          .from('loan_installments')
          .select(`
            *,
            investment:investments (
              id,
              user_id,
              asset_name,
              interest_rate,
              investor:profiles!investments_user_id_fkey (role),
              payer:profiles!investments_payer_id_fkey (id, full_name, email, photo_url)
            )
          `)
          .order('due_date', { ascending: true })
      );

      const [invRes, instRes] = await Promise.all([investmentsPromise, installmentsPromise]);

      if (invRes.error) throw invRes.error;
      if (instRes.error) throw instRes.error;

      const safeInvestments = (invRes.data || []).map((inv: any) => ({
        ...inv,
        amount_invested: normalizeNumber(inv.amount_invested),
        current_value: normalizeNumber(inv.current_value),
        interest_rate: normalizeNumber(inv.interest_rate),
        investor_name: inv.investor?.full_name || 'N/A',
        payer_name: inv.payer?.full_name || 'N/A',
        source_capital: normalizeNumber(inv.source_capital),
        source_profit: normalizeNumber(inv.source_profit)
      }));

      const uniqueInstallments = instRes.data || [];
      
      const computedKPIs = buildKPIs(safeInvestments, uniqueInstallments, monthRange);

      const uiInstallments: LoanInstallment[] = []; 
      uniqueInstallments.forEach((inst: any) => {
        const outstanding = calculateOutstanding(inst);
        const isPaid = inst.status === 'paid';
        const isOverdue = inst.due_date < todayYMD && !isPaid && outstanding > 0.01;
        
        const paidDate = inst.paid_at ? new Date(inst.paid_at) : null;
        const rStart = new Date(monthRange.startISO);
        const rEnd = new Date(monthRange.endISO);
        const paidThisMonth = isPaid && paidDate && !isNaN(paidDate.getTime()) && paidDate >= rStart && paidDate < rEnd;
        const isRelevantForList =
             inst.status === 'pending' ||
             inst.status === 'late' ||
             inst.status === 'partial' ||
             paidThisMonth;

        if (isRelevantForList) {
            uiInstallments.push({
                ...inst,
                amount_total: normalizeNumber(inst.amount_total),
                amount_principal: normalizeNumber(inst.amount_principal),
                amount_interest: normalizeNumber(inst.amount_interest),
                amount_paid: normalizeNumber(inst.amount_paid),
                status: (inst.status === 'pending' && isOverdue) ? 'late' : inst.status,
                contract_name: inst.investment?.asset_name || 'Desconhecido'
            });
        }
      });

      uiInstallments.sort((a, b) => {
          if (a.due_date === b.due_date) return a.number - b.number;
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      });

      const derivedStats: AdminDashboardStats = {
        active_portfolio: computedKPIs.activeStreetMoney,
        expected_month: computedKPIs.expectedMonth,
        received_month: computedKPIs.receivedByPaymentMonth,
        total_overdue: computedKPIs.totalOverdue,
        active_contracts: safeInvestments.length,
      };

      const newData: CachedDashboard = {
        stats: derivedStats,
        detailedKPIs: computedKPIs,
        investments: safeInvestments,
        installments: uiInstallments,
        monthRange: { start: monthRange.startYMD, end: monthRange.endYMD }
      };

      setCached(`dashboard_${tenantId ?? 'default'}`, newData);

      setData({
        ...newData,
        loading: false,
        isStale: false,
        error: null,
        refetch: fetchData,
      });

    } catch (err: any) {
      console.error('Dashboard Fetch Error:', err);
      setData(prev => ({
        ...prev,
        loading: false,
        error: err.message
      }));
    }
  }, [tenantId]);

  useEffect(() => {
    setData(prev => ({ ...prev, refetch: fetchData }));
    fetchData();
  }, [fetchData]);

  return { ...data };
};
