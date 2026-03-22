import { useState, useEffect } from 'react';
import { fetchProfileByAuthUserId, getSupabase, withRetry } from '../services/supabase';
import { getCached, setCached } from '../services/cache';

export interface DebtorInstallment {
  id: string;
  number: number;
  due_date: string;
  amount_total: number;
  status: 'pending' | 'paid' | 'late' | 'partial';
  amount_paid: number;
  fine_amount: number;
  interest_delay_amount: number;
  contract_name: string;
  tenant_id: string;
  is_late: boolean;
  days_late: number;
}

export interface DebtorContract {
  id: number;
  asset_name: string;
  tenant_id: string;
  total_value: number;
  paid_value: number;
  balance: number; // Saldo Devedor
  progress: number;
  status: 'ok' | 'late' | 'finished';
  installments: DebtorInstallment[];
}

export interface DebtorMetrics {
  currentBalance: number; // Saldo devedor total global
  hasLatePayment: boolean;
  nextPayment: DebtorInstallment | null;
  userName: string;
  contracts: DebtorContract[]; // Nova estrutura agrupada
}

export const useDebtorFinance = () => {
  const [metrics, setMetrics] = useState<DebtorMetrics>(() => {
    const cached = getCached<DebtorMetrics>('debtor_finance');
    return cached?.data ?? { currentBalance: 0, hasLatePayment: false, nextPayment: null, userName: '', contracts: [] };
  });
  const [loading, setLoading] = useState(true);
  const [isStale, setIsStale] = useState(() => {
    const cached = getCached<DebtorMetrics>('debtor_finance');
    return cached?.stale ?? false;
  });

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const supabase = getSupabase();
      if (!supabase) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const cacheKey = `debtor_finance_${user.id}`;
        const cached = getCached<DebtorMetrics>(cacheKey);
        if (cached) {
          setMetrics(cached.data);
          setIsStale(cached.stale);
        }

        // 1. Busca Perfil
        const { data: profile } = await withRetry(async () =>
          await fetchProfileByAuthUserId<{ id: string; full_name?: string }>(supabase, user.id, 'id, full_name')
        );
        const debtorProfileId = profile?.id || user.id;

        // 2. Busca Contratos e Parcelas
        const { data: investments, error } = await withRetry(async () =>
          await supabase
            .from('investments')
            .select(`
              id,
              tenant_id,
              asset_name,
              current_value,
              loan_installments (
                id, number, due_date, amount_total, status, amount_paid, fine_amount, interest_delay_amount
              )
            `)
            .eq('payer_id', debtorProfileId)
            .order('created_at', { ascending: false })
        );

        if (error) throw error;

        // 3. Processamento Agrupado
        let globalBalance = 0;
        let globalNextPayment: DebtorInstallment | null = null;
        let globalHasLate = false;
        const today = new Date();
        today.setHours(0,0,0,0);

        const contracts: DebtorContract[] = (investments || []).map((inv: any) => {
            let contractTotal = Number(inv.current_value || 0);
            let contractPaid = 0;
            let contractHasLate = false;

            // Processa Parcelas deste contrato
            const insts: DebtorInstallment[] = (inv.loan_installments || []).map((inst: any) => {
                const dueDate = new Date(inst.due_date + 'T00:00:00');
                const isLate = inst.status !== 'paid' && dueDate < today;
                const daysLate = isLate ? Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 3600 * 24)) : 0;
                
                if (inst.status === 'paid') {
                    contractPaid += Number(inst.amount_total);
                } else {
                    contractPaid += Number(inst.amount_paid || 0);
                }

                if (isLate) {
                    contractHasLate = true;
                    globalHasLate = true;
                }

                // Normaliza objeto da parcela
                return {
                    ...inst,
                    contract_name: inv.asset_name,
                    tenant_id: inv.tenant_id,
                    is_late: isLate,
                    days_late: daysLate,
                    status: (inst.status === 'pending' && isLate) ? 'late' : inst.status
                };
            });

            // Ordena parcelas: Atrasadas primeiro, depois data
            insts.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

            // Calcula Métricas do Contrato (inclui multas e juros de atraso no saldo devedor)
            const totalFines = insts.reduce((sum, i) => {
                if (i.status !== 'paid') {
                    sum += Number(i.fine_amount || 0) + Number(i.interest_delay_amount || 0);
                }
                return sum;
            }, 0);
            const balance = Math.max(0, contractTotal + totalFines - contractPaid);
            // progress mede o contrato original (sem encargos): ex. 80% = pagou 80% do principal+juros contratados
            // balance já inclui multas, por isso pode ser > 0 mesmo com progress alto
            const progress = contractTotal > 0 ? (contractPaid / contractTotal) * 100 : 0;
            
            // Status do Contrato
            let status: 'ok' | 'late' | 'finished' = 'ok';
            if (balance <= 0 && insts.every(i => i.status === 'paid')) status = 'finished';
            else if (contractHasLate) status = 'late';

            // Atualiza Global Balance
            globalBalance += balance;

            // Verifica Próximo Pagamento Global (Prioridade para atrasados ou vencimento mais próximo)
            const pending = insts.filter(i => i.status !== 'paid');
            if (pending.length > 0) {
                const nextCandidate = pending[0];
                if (!globalNextPayment) {
                    globalNextPayment = nextCandidate;
                } else {
                    // Se o candidato atual é atrasado e o global não, substitui
                    if (nextCandidate.is_late && !globalNextPayment.is_late) {
                        globalNextPayment = nextCandidate;
                    } 
                    // Se ambos são mesmo status, pega o mais antigo
                    else if (new Date(nextCandidate.due_date) < new Date(globalNextPayment.due_date)) {
                        globalNextPayment = nextCandidate;
                    }
                }
            }

            return {
                id: inv.id,
                asset_name: inv.asset_name,
                tenant_id: inv.tenant_id,
                total_value: contractTotal,
                paid_value: contractPaid,
                balance: balance,
                progress: progress,
                status: status,
                installments: insts
            };
        });

        // Ordena Contratos: Atrasados primeiro
        contracts.sort((a, b) => {
            const score = (s: string) => s === 'late' ? 0 : s === 'ok' ? 1 : 2;
            return score(a.status) - score(b.status);
        });

        const newMetrics: DebtorMetrics = {
            currentBalance: globalBalance,
            hasLatePayment: globalHasLate,
            nextPayment: globalNextPayment,
            userName: profile?.full_name?.split(' ')[0] || 'Cliente',
            contracts: contracts
        };

        const cacheKeyFull = `debtor_finance_${user.id}`;
        setCached(cacheKeyFull, newMetrics);

        setMetrics(newMetrics);
        setIsStale(false);

      } catch (err) {
        console.error("Erro ao carregar finanças do devedor:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  return { metrics, loading, isStale };
};
