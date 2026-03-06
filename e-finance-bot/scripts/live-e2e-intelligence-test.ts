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

type TranscriptEntry = { role: 'user' | 'bot'; text: string };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function ymdOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function main() {
  const now = Date.now();
  const suffix = `${now}`.slice(-6);
  const email = `bot.intel.${now}@example.com`;
  const password = `Temp#${randomUUID().slice(0, 12)}`;
  const fullName = `Bot Intel Admin ${suffix}`;
  const company = `Bot Intel Tenant ${suffix}`;
  const linkCode = `B${suffix.slice(-5)}`.toUpperCase();
  const channelUserId = `telegram-intel-${suffix}`;

  let authUserId: string | null = null;
  let tenantId: string | null = null;
  let profileId: string | null = null;
  const transcript: TranscriptEntry[] = [];
  let step = 0;

  const ask = async (text: string): Promise<string> => {
    step += 1;
    transcript.push({ role: 'user', text });
    const out = await handleMessage({
      messageId: `intel-${suffix}-${step}`,
      channel: 'telegram',
      channelUserId,
      senderName: fullName,
      text,
    });
    transcript.push({ role: 'bot', text: out.text });
    return out.text;
  };

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
      throw new Error(`Falha ao criar auth user: ${createUserError?.message || 'sem usuário'}`);
    }

    authUserId = createdUser.user.id;
    await sleep(900);

    const { data: profile, error: profileError } = await sb
      .from('profiles')
      .select('id, tenant_id')
      .eq('id', authUserId)
      .single();

    if (profileError || !profile) {
      throw new Error(`Falha ao carregar profile criado: ${profileError?.message || 'não encontrado'}`);
    }

    profileId = String(profile.id);
    tenantId = String(profile.tenant_id);

    const { error: linkCodeError } = await sb.from('bot_link_codes').insert({
      code: linkCode,
      channel: 'telegram',
      profile_id: profileId,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    if (linkCodeError) {
      throw new Error(`Falha ao inserir bot_link_code: ${linkCodeError.message}`);
    }

    await ask('/start');
    await ask(linkCode);

    await ask('/contrato');
    await ask('Emprestimo para Icaro Alves, CPF 529.982.247-25, ele vai receber 1000 reais por 2000, vai pagar 10 parcelas todo dia 5');
    const create1 = await ask('sim');
    const id1 = Number((create1.match(/Contrato #(\d+)/i) || [])[1] || 0);

    await ask('/contrato');
    await ask('Emprestimo para Icaro Soares, CPF 123.456.789-09, ele vai receber 1500 reais por 3000, vai pagar 10 parcelas todo dia 6');
    const create2 = await ask('sim');
    const id2 = Number((create2.match(/Contrato #(\d+)/i) || [])[1] || 0);

    if (!id1 || !id2) {
      throw new Error(`Falha ao criar contratos. id1=${id1}, id2=${id2}`);
    }

    const { data: firstA } = await sb
      .from('loan_installments')
      .select('id')
      .eq('investment_id', id1)
      .in('status', ['pending', 'late', 'partial'])
      .order('due_date', { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: firstB } = await sb
      .from('loan_installments')
      .select('id')
      .eq('investment_id', id2)
      .in('status', ['pending', 'late', 'partial'])
      .order('due_date', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstA?.id) {
      await sb.from('loan_installments').update({ due_date: ymdOffset(0), status: 'pending', amount_paid: 0, paid_at: null }).eq('id', firstA.id);
    }

    if (firstB?.id) {
      await sb.from('loan_installments').update({ due_date: ymdOffset(1), status: 'pending', amount_paid: 0, paid_at: null }).eq('id', firstB.id);
    }

    const cobrarHoje = await ask('quem tenho que cobrar hoje?');
    const buscarIcaro = await ask('quanto o Icaro me deve?');
    let detalheSelecionado = '';
    if (/qual deles\?/i.test(buscarIcaro)) {
      detalheSelecionado = await ask('2');
    }

    const assertions = {
      cobrarHojeOnlyToday: cobrarHoje.includes('Icaro Alves') && !cobrarHoje.includes('Icaro Soares'),
      asksDisambiguation: /qual deles\?/i.test(buscarIcaro),
      disambiguationShowsCpf: buscarIcaro.includes('CPF'),
      selectedShowsDebtDetails: detalheSelecionado
        ? /débito|parcela|Próxima parcela/i.test(detalheSelecionado)
        : false,
    };

    console.log('__INTEL_E2E_SUMMARY_START__');
    console.log(JSON.stringify({
      created: { id1, id2 },
      assertions,
      replies: { cobrarHoje, buscarIcaro, detalheSelecionado },
      transcript,
    }, null, 2));
    console.log('__INTEL_E2E_SUMMARY_END__');
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
  console.error('__INTEL_E2E_ERROR_START__');
  console.error(err?.stack || err?.message || String(err));
  console.error('__INTEL_E2E_ERROR_END__');
  process.exit(1);
});
