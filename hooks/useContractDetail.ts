import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '../services/supabase';
import { Investment, LoanInstallment, ContractRenegotiation, ContractMetrics } from '../types';

export interface ContractDetailData {
  investment: Investment;
  installments: LoanInstallment[];
  renegotiations: ContractRenegotiation[];
  renewals: Investment[]; // contratos filhos (renovações deste)
  parent: Investment | null;  // contrato pai (se este for uma renovação)
  metrics: ContractMetrics;
}

const calculateOutstanding = (i: LoanInstallment): number => {
  const total = Number(i.amount_total) || 0;
  const fine = Number(i.fine_amount) || 0;
  const delay = Number(i.interest_delay_amount) || 0;
  const paid = Number(i.amount_paid) || 0;
  return Math.max(0, total + fine + delay - paid);
};

export function computeMetrics(installments: LoanInstallment[]): ContractMetrics {
  let jurosPagos = 0;
  let principalRecuperado = 0;
  let totalRecebido = 0;
  let jurosAReceber = 0;
  let principalAReceber = 0;
  let fineAcumulada = 0;
  let parcelasPagas = 0;
  let parcelasPartiais = 0;
  let parcelasPendentes = 0;
  let parcelasAtrasadas = 0;

  for (const i of installments) {
    const fine = Number(i.fine_amount) || 0;
    const delay = Number(i.interest_delay_amount) || 0;
    fineAcumulada += fine + delay;

    if (i.status === 'paid') {
      jurosPagos += Number(i.amount_interest) || 0;
      principalRecuperado += Number(i.amount_principal) || 0;
      totalRecebido += Number(i.amount_paid) || 0;
      parcelasPagas++;
    } else if (i.status === 'partial') {
      // parcialmente paga: crédito proporcional
      const pago = Number(i.amount_paid) || 0;
      const total = Number(i.amount_total) || 1;
      const ratio = pago / total;
      jurosPagos += (Number(i.amount_interest) || 0) * ratio;
      principalRecuperado += (Number(i.amount_principal) || 0) * ratio;
      totalRecebido += pago;
      jurosAReceber += (Number(i.amount_interest) || 0) * (1 - ratio);
      principalAReceber += (Number(i.amount_principal) || 0) * (1 - ratio);
      parcelasPartiais++;
    } else if (i.status === 'late') {
      jurosAReceber += Number(i.amount_interest) || 0;
      principalAReceber += Number(i.amount_principal) || 0;
      parcelasAtrasadas++;
    } else {
      // pending
      jurosAReceber += Number(i.amount_interest) || 0;
      principalAReceber += Number(i.amount_principal) || 0;
      parcelasPendentes++;
    }
  }

  const parcelasTotal = installments.length;
  const emDia = parcelasPagas;
  const saudeContrato = parcelasTotal > 0 ? Math.round((emDia / parcelasTotal) * 100) : 100;

  // Rentabilidade real = juros efetivamente recebidos sobre o principal investido
  // Não temos o amount_invested aqui — será calculado no componente com investment.amount_invested
  const rentabilidadeReal = 0; // preenchido no componente

  return {
    jurosPagos,
    principalRecuperado,
    totalRecebido,
    jurosAReceber,
    principalAReceber,
    fineAcumulada,
    rentabilidadeReal,
    parcelasPagas,
    parcelasPartiais,
    parcelasPendentes,
    parcelasAtrasadas,
    parcelasTotal,
    saudeContrato,
  };
}

export function useContractDetail(investmentId: number | null) {
  const [data, setData] = useState<ContractDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!investmentId) return;
    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase não configurado');

      // 1. Busca o contrato principal com partes relacionadas
      const { data: inv, error: invErr } = await supabase
        .from('investments')
        .select(`
          *,
          investor:profiles!investments_user_id_fkey(full_name, cpf, email, role),
          payer:profiles!investments_payer_id_fkey(full_name, cpf, email),
          loan_installments(*)
        `)
        .eq('id', investmentId)
        .single();

      if (invErr) throw invErr;

      // 2. Busca renegociações
      const { data: reneg, error: renegErr } = await supabase
        .from('contract_renegotiations')
        .select('*')
        .eq('investment_id', investmentId)
        .order('renegotiated_at', { ascending: false });

      if (renegErr) throw renegErr;

      // 3. Busca renovações (contratos filhos)
      const { data: renewals, error: renewalsErr } = await supabase
        .from('investments')
        .select(`
          *,
          payer:profiles!investments_payer_id_fkey(full_name)
        `)
        .eq('parent_investment_id', investmentId)
        .order('created_at', { ascending: false });

      if (renewalsErr) throw renewalsErr;

      // 4. Busca contrato pai (se existir)
      let parent: Investment | null = null;
      if (inv.parent_investment_id) {
        const { data: parentData } = await supabase
          .from('investments')
          .select('*, payer:profiles!investments_payer_id_fkey(full_name)')
          .eq('id', inv.parent_investment_id)
          .single();
        parent = parentData;
      }

      const installments: LoanInstallment[] = (inv.loan_installments || []).sort(
        (a: LoanInstallment, b: LoanInstallment) => a.number - b.number
      );

      const metrics = computeMetrics(installments);
      // Preenche rentabilidade com o principal do contrato
      const amountInvested = Number(inv.amount_invested) || 1;
      metrics.rentabilidadeReal = parseFloat(((metrics.jurosPagos / amountInvested) * 100).toFixed(2));

      setData({
        investment: inv as Investment,
        installments,
        renegotiations: reneg || [],
        renewals: (renewals || []) as Investment[],
        parent,
        metrics,
      });
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar contrato');
    } finally {
      setLoading(false);
    }
  }, [investmentId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
