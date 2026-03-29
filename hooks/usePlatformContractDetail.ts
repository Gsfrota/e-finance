import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '../services/supabase';
import { ContractDetailData, computeMetrics } from './useContractDetail';

export function usePlatformContractDetail(investmentId: number | null) {
  const [data, setData] = useState<ContractDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!investmentId) return;
    setLoading(true);
    setError(null);
    try {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase não disponível');
      const { data: raw, error: rpcErr } = await sb.rpc('platform_view_tenant_contract_detail', {
        p_investment_id: investmentId,
      });
      if (rpcErr) throw rpcErr;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed?.investment) throw new Error('Contrato não encontrado');
      const installments = parsed.installments ?? [];
      setData({
        investment: parsed.investment,
        installments,
        renegotiations: parsed.renegotiations ?? [],
        renewals: parsed.renewals ?? [],
        parent: parsed.parent ?? null,
        metrics: computeMetrics(installments),
      });
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao carregar contrato');
    } finally {
      setLoading(false);
    }
  }, [investmentId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
