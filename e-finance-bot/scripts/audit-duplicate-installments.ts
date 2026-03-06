import { createClient } from '@supabase/supabase-js';

type InstallmentRow = {
  id: string;
  tenant_id: string;
  investment_id: number;
  number: number;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  if (!url || !key) {
    console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
    process.exit(2);
  }

  const sb = createClient(url, key);

  const { data, error } = await sb
    .from('loan_installments')
    .select('id, tenant_id, investment_id, number, status, created_at, updated_at')
    .order('tenant_id', { ascending: true })
    .order('investment_id', { ascending: true })
    .order('number', { ascending: true });

  if (error) {
    console.error('Falha ao consultar loan_installments:', error.message);
    process.exit(2);
  }

  const rows = (data || []) as InstallmentRow[];
  const grouped = new Map<string, InstallmentRow[]>();

  for (const row of rows) {
    const groupKey = `${row.tenant_id}:${row.investment_id}:${row.number}`;
    const list = grouped.get(groupKey) || [];
    list.push(row);
    grouped.set(groupKey, list);
  }

  const duplicates = Array.from(grouped.entries())
    .filter(([, list]) => list.length > 1)
    .map(([groupKey, list]) => ({
      key: groupKey,
      tenantId: list[0]?.tenant_id,
      investmentId: list[0]?.investment_id,
      number: list[0]?.number,
      count: list.length,
      statuses: list.map(item => item.status || 'pending'),
      ids: list.map(item => item.id),
    }));

  if (duplicates.length === 0) {
    console.log(JSON.stringify({ ok: true, duplicateGroups: 0 }, null, 2));
    return;
  }

  console.error(JSON.stringify({
    ok: false,
    duplicateGroups: duplicates.length,
    duplicates,
  }, null, 2));
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
