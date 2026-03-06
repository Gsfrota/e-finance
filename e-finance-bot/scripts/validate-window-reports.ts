import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { handleMessage } from '../src/handlers/message-handler';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://SUPABASE_PROJECT_URL_REMOVED';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente');
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type WindowStart = 'today' | 'tomorrow';

interface ValidationResult {
  daysAhead: number;
  windowStart: WindowStart;
  botReceivablesTotal: number;
  sqlReceivablesTotal: number;
  botCollectionTotal: number;
  sqlCollectionTotal: number;
  ok: boolean;
}

function addDays(base: Date, days: number): Date {
  const out = new Date(base);
  out.setDate(out.getDate() + days);
  return out;
}

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildWindow(daysAhead: number, windowStart: WindowStart): { start: string; end: string } {
  const safeDays = Math.max(1, Math.min(60, Math.trunc(daysAhead)));
  const offset = windowStart === 'tomorrow' ? 1 : 0;
  const startDate = addDays(new Date(), offset);
  const endDate = addDays(startDate, safeDays - 1);
  return {
    start: toYmd(startDate),
    end: toYmd(endDate),
  };
}

function parseBrl(value: string): number {
  const normalized = value.replace(/\./g, '').replace(',', '.').trim();
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function extractTotal(text: string, label: 'previsto' | 'aberto'): number {
  const pattern = label === 'previsto'
    ? /Total\s+previsto:\s*\*?R\$\s*([\d.]+,\d{2})/i
    : /Total\s+em\s+aberto:\s*\*?R\$\s*([\d.]+,\d{2})/i;

  const match = text.match(pattern);
  if (!match?.[1]) return 0;
  return parseBrl(match[1]);
}

async function querySqlTotals(tenantId: string, daysAhead: number, windowStart: WindowStart) {
  const window = buildWindow(daysAhead, windowStart);

  const { data, error } = await sb
    .from('loan_installments')
    .select('amount_total, amount_paid, status, due_date, investments!inner(tenant_id)')
    .eq('investments.tenant_id', tenantId)
    .in('status', ['pending', 'late', 'partial'])
    .gte('due_date', window.start)
    .lte('due_date', window.end);

  if (error) throw new Error(`querySqlTotals error: ${error.message}`);

  const rows = data || [];
  const total = rows.reduce((sum, row) => {
    const due = Math.max(0, Number((row as any).amount_total || 0) - Number((row as any).amount_paid || 0));
    return sum + due;
  }, 0);

  return { total, window };
}

async function seedScenario(tenantId: string, adminProfileId: string, debtorId: string): Promise<void> {
  const { data: createdId, error: rpcError } = await sb.rpc('create_investment_validated', {
    p_tenant_id: tenantId,
    p_user_id: adminProfileId,
    p_payer_id: debtorId,
    p_asset_name: 'Contrato teste validação janela',
    p_amount_invested: 1000,
    p_source_capital: 1000,
    p_source_profit: 0,
    p_current_value: 2000,
    p_interest_rate: 100,
    p_installment_value: 200,
    p_total_installments: 10,
    p_frequency: 'monthly',
    p_due_day: 5,
    p_weekday: null,
    p_start_date: null,
    p_calculation_mode: 'manual',
  });

  if (rpcError || !createdId) {
    throw new Error(`Falha ao criar contrato de cenário: ${rpcError?.message || 'sem id'}`);
  }

  const contractId = Number(createdId);
  const { data: installments, error: installmentsError } = await sb
    .from('loan_installments')
    .select('id, number')
    .eq('investment_id', contractId)
    .order('number', { ascending: true })
    .limit(5);

  if (installmentsError || !installments?.length) {
    throw new Error(`Falha ao buscar parcelas do cenário: ${installmentsError?.message || 'vazio'}`);
  }

  const offsets = [0, 1, 3, 7, 15];
  for (let i = 0; i < installments.length; i += 1) {
    const dueDate = toYmd(addDays(new Date(), offsets[i] || 0));
    const { error: updateError } = await sb
      .from('loan_installments')
      .update({ due_date: dueDate, status: 'pending', amount_paid: 0, paid_at: null })
      .eq('id', installments[i].id);

    if (updateError) {
      throw new Error(`Falha ao ajustar parcela do cenário: ${updateError.message}`);
    }
  }
}

async function main() {
  const now = Date.now();
  const suffix = `${now}`.slice(-6);
  const email = `bot.validate.${now}@example.com`;
  const password = `Temp#${randomUUID().slice(0, 12)}`;
  const fullName = `Bot Validate Admin ${suffix}`;
  const company = `Bot Validate Tenant ${suffix}`;
  const linkCode = `V${suffix.slice(-5)}`.toUpperCase();
  const channelUserId = `telegram-window-validate-${suffix}`;

  let authUserId: string | null = null;
  let tenantId: string | null = null;
  let profileId: string | null = null;
  let debtorId: string | null = null;

  try {
    const { data: createdUser, error: createUserError } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        company_name: company,
      },
    });

    if (createUserError || !createdUser?.user) {
      throw new Error(`Falha ao criar usuário auth: ${createUserError?.message || 'sem usuário'}`);
    }

    authUserId = createdUser.user.id;

    await new Promise(resolve => setTimeout(resolve, 900));

    const { data: profile, error: profileError } = await sb
      .from('profiles')
      .select('id, tenant_id')
      .eq('id', authUserId)
      .single();

    if (profileError || !profile) {
      throw new Error(`Falha ao carregar profile admin: ${profileError?.message || 'não encontrado'}`);
    }

    profileId = String(profile.id);
    tenantId = String(profile.tenant_id);

    const { data: debtor, error: debtorError } = await sb
      .from('profiles')
      .insert({
        id: randomUUID(),
        tenant_id: tenantId,
        role: 'debtor',
        full_name: `Cliente Janela ${suffix}`,
        cpf: '52998224725',
        email: `debtor.${now}@example.com`,
      })
      .select('id')
      .single();

    if (debtorError || !debtor?.id) {
      throw new Error(`Falha ao criar devedor cenário: ${debtorError?.message || 'sem id'}`);
    }

    debtorId = String(debtor.id);

    await seedScenario(tenantId, profileId, debtorId);

    const { error: linkCodeError } = await sb.from('bot_link_codes').insert({
      code: linkCode,
      channel: 'telegram',
      profile_id: profileId,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    if (linkCodeError) {
      throw new Error(`Falha ao inserir link code: ${linkCodeError.message}`);
    }

    let messageCounter = 0;
    const ask = async (text: string): Promise<string> => {
      messageCounter += 1;
      const out = await handleMessage({
        messageId: `validate-${suffix}-${messageCounter}`,
        channel: 'telegram',
        channelUserId,
        senderName: fullName,
        text,
      });
      return out.text;
    };

    await ask('/start');
    await ask(linkCode);

    const windows: Array<{ daysAhead: number; windowStart: WindowStart }> = [
      { daysAhead: 1, windowStart: 'today' },
      { daysAhead: 3, windowStart: 'today' },
      { daysAhead: 7, windowStart: 'today' },
      { daysAhead: 15, windowStart: 'today' },
      { daysAhead: 30, windowStart: 'today' },
      { daysAhead: 3, windowStart: 'tomorrow' },
    ];

    const results: ValidationResult[] = [];

    for (const item of windows) {
      const receivesText = item.windowStart === 'tomorrow'
        ? `a partir de amanhã, quanto vou receber nos próximos ${item.daysAhead} dias?`
        : `quanto vou receber nos próximos ${item.daysAhead} dias?`;

      const collectsText = item.windowStart === 'tomorrow'
        ? `a partir de amanhã, quem devo cobrar nos próximos ${item.daysAhead} dias?`
        : `quem devo cobrar nos próximos ${item.daysAhead} dias?`;

      const botReceivables = await ask(receivesText);
      const botCollection = await ask(collectsText);

      const sql = await querySqlTotals(tenantId, item.daysAhead, item.windowStart);
      const botReceivablesTotal = extractTotal(botReceivables, 'previsto');
      const botCollectionTotal = extractTotal(botCollection, 'aberto');

      const okReceivables = Math.abs(botReceivablesTotal - sql.total) < 0.01;
      const okCollection = Math.abs(botCollectionTotal - sql.total) < 0.01;

      results.push({
        daysAhead: item.daysAhead,
        windowStart: item.windowStart,
        botReceivablesTotal,
        sqlReceivablesTotal: sql.total,
        botCollectionTotal,
        sqlCollectionTotal: sql.total,
        ok: okReceivables && okCollection,
      });
    }

    const hasMismatch = results.some(item => !item.ok);

    console.log('__WINDOW_VALIDATION_START__');
    console.log(JSON.stringify({
      tenantId,
      channelUserId,
      results,
      hasMismatch,
    }, null, 2));
    console.log('__WINDOW_VALIDATION_END__');

    if (hasMismatch) {
      process.exitCode = 1;
    }
  } finally {
    if (channelUserId) {
      const { data: sessions } = await sb
        .from('bot_sessions')
        .select('id')
        .eq('channel', 'telegram')
        .eq('channel_user_id', channelUserId);

      const sessionIds = (sessions || []).map((s: any) => s.id);
      if (sessionIds.length) {
        await sb.from('bot_messages').delete().in('session_id', sessionIds);
      }
      await sb.from('bot_sessions').delete().eq('channel', 'telegram').eq('channel_user_id', channelUserId);
    }

    if (profileId) {
      await sb.from('bot_link_codes').delete().eq('profile_id', profileId);
    }

    if (debtorId) {
      await sb.from('profiles').delete().eq('id', debtorId);
    }

    if (tenantId) {
      await sb.from('loan_installments').delete().eq('tenant_id', tenantId);
      await sb.from('investments').delete().eq('tenant_id', tenantId);
      await sb.from('profiles').delete().eq('tenant_id', tenantId);
      await sb.from('tenants').delete().eq('id', tenantId);
    }

    if (authUserId) {
      await sb.auth.admin.deleteUser(authUserId);
    }
  }
}

main().catch((err) => {
  console.error('__WINDOW_VALIDATION_ERROR_START__');
  console.error(err?.stack || err?.message || String(err));
  console.error('__WINDOW_VALIDATION_ERROR_END__');
  process.exit(1);
});
