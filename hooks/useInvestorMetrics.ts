import { useState, useEffect } from 'react';
import { getSupabase } from '../services/supabase';
import { Investment } from '../types';

// Tipagem local enriquecida para o frontend
export interface EnrichedInvestment extends Investment {
  roi: number;
  healthStatus: 'ok' | 'late' | 'ended' | 'waiting';
  nextPaymentDate?: string;
}

export interface InvestorMetrics {
  totalAllocated: number;
  totalProfit: number;
  nextPaymentDate: string | null;
  nextPaymentValue: number;
  chartData: { name: string; projected: number; received: number; rawDate: number }[];
  activeContracts: number;
  userName: string;
}

export const useInvestorMetrics = () => {
  const [metrics, setMetrics] = useState<InvestorMetrics>({
    totalAllocated: 0,
    totalProfit: 0,
    nextPaymentDate: null,
    nextPaymentValue: 0,
    chartData: [],
    activeContracts: 0,
    userName: ''
  });
  const [investments, setInvestments] = useState<EnrichedInvestment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const supabase = getSupabase();
      if (!supabase) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // 1. Busca Perfil (Nome)
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();

        // 2. Busca Investimentos com as Parcelas
        const { data: invData, error } = await supabase
          .from('investments')
          .select(`
            *,
            loan_installments (
              due_date,
              amount_total,
              amount_interest,
              amount_paid,
              status
            )
          `)
          .eq('user_id', user.id) 
          .order('created_at', { ascending: false });

        if (error) throw error;

        // 3. Processamento de Dados
        let totalAllocated = 0;
        let totalProfit = 0;
        let nextPayment: { date: Date; val: number } | null = null;
        
        const chartMap = new Map<string, { projected: number; received: number; sortDate: number }>();
        const today = new Date();
        today.setHours(0,0,0,0);

        const enrichedInvestments: EnrichedInvestment[] = (invData || []).map((inv: any) => {
          totalAllocated += Number(inv.amount_invested || 0);
          
          const installments = inv.loan_installments || [];
          let hasLatePayment = false;
          let isEnded = installments.length > 0 && installments.every((i: any) => i.status === 'paid');
          let assetNextPaymentStr = undefined;

          installments.forEach((inst: any) => {
             const dueDate = new Date(inst.due_date + 'T00:00:00'); // Fix timezone issue
             const monthKey = dueDate.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
             const sortKey = new Date(dueDate.getFullYear(), dueDate.getMonth(), 1).getTime(); // Normalize month start

             // Status Check
             if (inst.status !== 'paid' && dueDate < today) {
                 hasLatePayment = true;
             }

             // Chart Data Aggregation
             if (!chartMap.has(monthKey)) {
                chartMap.set(monthKey, { projected: 0, received: 0, sortDate: sortKey });
             }
             const chartEntry = chartMap.get(monthKey)!;

             chartEntry.projected += Number(inst.amount_total || 0);
             if (inst.status === 'paid') {
                 chartEntry.received += Number(inst.amount_paid || 0);
                 totalProfit += Number(inst.amount_interest || 0);
             }

             // Global Next Payment Logic
             if (inst.status !== 'paid') {
                 if (!nextPayment || dueDate < nextPayment.date) {
                     nextPayment = { date: dueDate, val: Number(inst.amount_total) };
                 }
                 // Local Asset Next Payment (for sorting/display if needed)
                 if (!assetNextPaymentStr) assetNextPaymentStr = dueDate.toLocaleDateString('pt-BR');
             }
          });

          // ROI Calculation
          const invested = Number(inv.amount_invested) || 1; // avoid division by zero
          const totalReceivable = Number(inv.current_value) || 0;
          const roi = ((totalReceivable - invested) / invested) * 100;

          // Health Status Logic
          let healthStatus: 'ok' | 'late' | 'ended' | 'waiting' = 'ok';
          if (isEnded) healthStatus = 'ended';
          else if (hasLatePayment) healthStatus = 'late';
          else if (installments.length === 0) healthStatus = 'waiting';

          return {
              ...inv,
              roi,
              healthStatus,
              nextPaymentDate: assetNextPaymentStr
          };
        });

        // 4. Formata Gráfico
        // Ordena por data e garante que mostramos o futuro próximo se houver dados
        const chartArray = Array.from(chartMap.values())
            .sort((a, b) => a.sortDate - b.sortDate)
            .map(item => ({
                name: new Date(item.sortDate).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
                projected: item.projected,
                received: item.received,
                rawDate: item.sortDate
            }));

        setMetrics({
            totalAllocated,
            totalProfit,
            nextPaymentDate: nextPayment ? nextPayment.date.toLocaleDateString('pt-BR') : null,
            nextPaymentValue: nextPayment ? nextPayment.val : 0,
            chartData: chartArray,
            activeContracts: enrichedInvestments.length,
            userName: profile?.full_name?.split(' ')[0] || 'Investidor'
        });

        // Ordena investimentos: Atrasados primeiro, depois ativos, depois finalizados
        setInvestments(enrichedInvestments.sort((a, b) => {
            const score = (s: string) => s === 'late' ? 0 : s === 'ok' ? 1 : s === 'waiting' ? 2 : 3;
            return score(a.healthStatus) - score(b.healthStatus);
        }));

      } catch (err) {
        console.error("Erro ao carregar métricas do investidor:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  return { metrics, investments, loading };
};