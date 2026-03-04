
import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '../services/supabase';
import { Investment, LoanInstallment, AdminDashboardStats, DashboardKPIs } from '../types';

// --- TYPES ---

export interface DashboardDataState {
  stats: AdminDashboardStats;
  detailedKPIs: DashboardKPIs;
  investments: Investment[];
  installments: LoanInstallment[];
  loading: boolean;
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
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  
  return {
    startISO: start.toISOString(), 
    endISO: end.toISOString(),
    startYMD: start.toISOString().split('T')[0], 
    endYMD: end.toISOString().split('T')[0]
  };
};

const calculateOutstanding = (inst: any): number => {
  const total = normalizeNumber(inst.amount_total);
  const fine = normalizeNumber(inst.fine_amount);
  const interestDelay = normalizeNumber(inst.interest_delay_amount);
  const paid = normalizeNumber(inst.amount_paid);
  
  return Math.max(0, (total + fine + interestDelay) - paid);
};

// Deduplicate Logic (Robust)
const deduplicateInstallments = (list: any[]) => {
  const map = new Map<string, any>();
  list.forEach(inst => {
    const key = `${inst.investment_id}-${inst.number}`;
    if (map.has(key)) {
      const existing = map.get(key);
      // Prioridade 1: Status 'paid'
      if (existing.status !== 'paid' && inst.status === 'paid') {
        map.set(key, inst);
      } 
      // Prioridade 2: Status 'partial'
      else if (existing.status !== 'paid' && existing.status !== 'partial' && inst.status === 'partial') {
        map.set(key, inst);
      }
      // Prioridade 3: Mais recente (created_at) se ambos tiverem mesmo status
      else if (existing.status === inst.status) {
        if (inst.created_at && existing.created_at) {
            // Se o novo é mais recente, substitui
            if (new Date(inst.created_at).getTime() > new Date(existing.created_at).getTime()) {
                map.set(key, inst);
            }
        }
      }
    } else {
      map.set(key, inst);
    }
  });
  return Array.from(map.values());
};

// --- KPI BUILDER ENGINE ---
const buildKPIs = (
    investments: Investment[],
    installments: LoanInstallment[], 
    monthRange: { startISO: string; endISO: string; startYMD: string; endYMD: string }
): DashboardKPIs => {
    const kpis: DashboardKPIs = {
        receivedMonth: 0,
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
        totalReceivable: 0
    };

    const todayYMD = new Date().toISOString().split('T')[0];

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

        if (inst.paid_at && inst.paid_at >= monthRange.startISO && inst.paid_at < monthRange.endISO) {
            kpis.receivedMonth += amountPaid;
        }
        if (inst.due_date >= monthRange.startYMD && inst.due_date < monthRange.endYMD) {
            kpis.expectedMonth += amountTotal;
        }

        if (outstanding > 0) {
            kpis.totalReceivable += outstanding;
            if (isOverdue) {
                kpis.totalOverdue += outstanding;
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
};

export const useDashboardData = (tenantId?: string) => {
  const [data, setData] = useState<DashboardDataState>({
    stats: INITIAL_STATS,
    detailedKPIs: INITIAL_KPIS,
    investments: [],
    installments: [],
    loading: true,
    error: null,
    refetch: () => {},
    monthRange: { start: '', end: '' }
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

      // 1. RPC (Stats Básicos)
      const statsPromise = supabase.rpc('get_admin_dashboard_stats');

      // 2. Investimentos
      const investmentsPromise = supabase
        .from('investments')
        .select(`
          *,
          investor:profiles!investments_user_id_fkey(id, full_name, email, role),
          payer:profiles!investments_payer_id_fkey(id, full_name, email)
        `)
        .order('created_at', { ascending: false });

      // 3. Todas as Parcelas
      const installmentsPromise = supabase
        .from('loan_installments')
        .select(`
          *,
          investment:investments (
            id,
            user_id,
            asset_name,
            interest_rate,
            investor:profiles!investments_user_id_fkey (role)
          )
        `)
        .order('due_date', { ascending: true });

      const [statsRes, invRes, instRes] = await Promise.all([
        statsPromise,
        investmentsPromise,
        installmentsPromise
      ]);

      if (statsRes.error) throw statsRes.error;
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

      // --- DEDUPLICATION STEP ---
      const rawInstallments = instRes.data || [];
      const uniqueInstallments = deduplicateInstallments(rawInstallments);
      
      const computedKPIs = buildKPIs(safeInvestments, uniqueInstallments, monthRange);

      const uiInstallments: LoanInstallment[] = []; 
      uniqueInstallments.forEach((inst: any) => {
        const outstanding = calculateOutstanding(inst);
        const isPaid = inst.status === 'paid';
        const isOverdue = inst.due_date < todayYMD && !isPaid && outstanding > 0.01;
        
        const isRelevantForList = 
             inst.status === 'pending' || 
             inst.status === 'late' || 
             inst.status === 'partial' ||
             (isPaid && inst.paid_at >= monthRange.startISO && inst.paid_at < monthRange.endISO);

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

      setData({
        stats: statsRes.data || INITIAL_STATS, 
        detailedKPIs: computedKPIs, 
        investments: safeInvestments,
        installments: uiInstallments,
        loading: false,
        error: null,
        refetch: fetchData,
        monthRange: { start: monthRange.startYMD, end: monthRange.endYMD }
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
    fetchData();
  }, [fetchData]);

  return { ...data };
};
