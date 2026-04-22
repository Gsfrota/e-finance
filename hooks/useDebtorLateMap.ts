
import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '../services/supabase';
import { getBrazilToday } from '../services/dateUtils';

export function useDebtorLateMap(
  tenantId: string | null | undefined,
  companyId: string | null | undefined
): Map<string, number> {
  const [lateMap, setLateMap] = useState<Map<string, number>>(new Map());

  const fetch = useCallback(async () => {
    if (!tenantId) return;
    const supabase = getSupabase();
    if (!supabase) return;

    const today = getBrazilToday();

    let query = supabase
      .from('loan_installments')
      .select('investments!inner(payer_id, status, tenant_id, company_id)')
      .lt('due_date', today)
      .neq('status', 'paid')
      .gt('amount_total', 0.01)
      .eq('investments.tenant_id', tenantId)
      .not('investments.status', 'in', '(completed,renewed)');

    if (companyId) query = query.eq('investments.company_id', companyId);

    const { data } = await query;
    if (!data) return;

    const map = new Map<string, number>();
    for (const row of data as any[]) {
      const payerId: string | undefined = row.investments?.payer_id;
      if (payerId) map.set(payerId, (map.get(payerId) ?? 0) + 1);
    }
    setLateMap(map);
  }, [tenantId, companyId]);

  useEffect(() => { fetch(); }, [fetch]);

  return lateMap;
}
