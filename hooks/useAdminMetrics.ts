
import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '../services/supabase';
import { AdminMetrics } from '../types';

export interface AdminMetricsState {
  metricsMap: Map<string, AdminMetrics>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAdminMetrics(
  tenantId: string | null,
  companyId: string | null | undefined
): AdminMetricsState {
  const [metricsMap, setMetricsMap] = useState<Map<string, AdminMetrics>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!tenantId) return;

    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Cliente Supabase não disponível');

      const { data, error: rpcError } = await supabase.rpc('get_admin_metrics', {
        p_tenant_id: tenantId,
        p_company_id: companyId ?? null,
      });

      if (rpcError) throw rpcError;

      const map = new Map<string, AdminMetrics>();
      (data as AdminMetrics[] ?? []).forEach(row => {
        map.set(row.admin_profile_id, row);
      });
      setMetricsMap(map);
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao carregar métricas');
    } finally {
      setLoading(false);
    }
  }, [tenantId, companyId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { metricsMap, loading, error, refetch: fetch };
}
