import { getSupabaseClient } from '../infra/runtime-clients';
import {
  getDashboardSummary, getDebtorsToCollectToday, formatCurrency,
} from '../actions/admin-actions';
import * as wa from '../channels/whatsapp';
import * as tg from '../channels/telegram';

function db() {
  return getSupabaseClient();
}

interface ProfileChannel {
  id: string;
  full_name: string;
  whatsapp_phone: string | null;
  telegram_chat_id: string | null;
}

async function getAdminProfiles(tenantId: string): Promise<ProfileChannel[]> {
  const { data, error } = await db()
    .from('profiles')
    .select('id, full_name, whatsapp_phone, telegram_chat_id')
    .eq('tenant_id', tenantId)
    .eq('role', 'admin')
    .or('whatsapp_phone.not.is.null,telegram_chat_id.not.is.null');

  if (error) {
    console.error('[morning-briefing] erro ao buscar admins:', error.message);
    return [];
  }
  return (data ?? []) as ProfileChannel[];
}

async function getInvestorProfiles(tenantId: string): Promise<ProfileChannel[]> {
  const { data, error } = await db()
    .from('profiles')
    .select('id, full_name, whatsapp_phone, telegram_chat_id')
    .eq('tenant_id', tenantId)
    .eq('role', 'investor')
    .or('whatsapp_phone.not.is.null,telegram_chat_id.not.is.null');

  if (error) {
    console.error('[morning-briefing] erro ao buscar investidores:', error.message);
    return [];
  }
  return (data ?? []) as ProfileChannel[];
}

export async function buildBriefingMessage(profile: ProfileChannel, tenantId: string): Promise<string> {
  const firstName = profile.full_name?.split(' ')[0] || 'Gestor';

  try {
    const [dashboard, collection] = await Promise.all([
      getDashboardSummary(tenantId),
      getDebtorsToCollectToday(tenantId),
    ]);

    const totalReceivable = dashboard.expectedMonth - dashboard.receivedMonth;

    if (collection.length === 0) {
      return `Bom dia ${firstName}! 🌅\nHoje não há cobranças programadas.\n\nSaldo a receber no mês: *${formatCurrency(totalReceivable)}*\n\nQuer ver o resumo completo?`;
    }

    const lines = collection.slice(0, 5).map(d =>
      `• *${d.name}* — ${d.installmentCount} parcela(s) — *${formatCurrency(d.totalDue)}*`
    );

    const extraCount = collection.length - 5;
    const extraLine = extraCount > 0 ? `\n_...e mais ${extraCount} cobrança(s)_` : '';

    return `Bom dia ${firstName}! 🌅\nHoje você tem *${formatCurrency(totalReceivable)}* para receber.\n\n📋 *Cobranças do dia:*\n${lines.join('\n')}${extraLine}\n\nQuer ver o detalhamento completo?`;
  } catch (err) {
    console.error('[buildBriefingMessage] erro:', err);
    return `Bom dia ${firstName}! 🌅\nOcorreu um problema ao carregar seu resumo. Tente acessar o dashboard.`;
  }
}

export async function dispatchBriefing(profile: ProfileChannel, message: string): Promise<void> {
  const errors: string[] = [];

  if (profile.whatsapp_phone) {
    try {
      await wa.sendText(profile.whatsapp_phone, message);
    } catch (err) {
      errors.push(`whatsapp: ${err}`);
    }
  }

  if (profile.telegram_chat_id) {
    try {
      const htmlMsg = message
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*([^*]+)\*/g, '<b>$1</b>');
      await tg.sendText(profile.telegram_chat_id, htmlMsg, 'HTML');
    } catch (err) {
      errors.push(`telegram: ${err}`);
    }
  }

  if (errors.length > 0) {
    console.warn(`[dispatchBriefing] profile ${profile.id} erros:`, errors.join(' | '));
  }
}

export async function runMorningBriefingForTenant(
  tenantId: string,
  targets: string[]
): Promise<{ sent: number; errors: number }> {
  const profiles: ProfileChannel[] = [];

  if (targets.includes('admin')) {
    profiles.push(...await getAdminProfiles(tenantId));
  }
  if (targets.includes('investor')) {
    profiles.push(...await getInvestorProfiles(tenantId));
  }

  // Dedup por profile id
  const unique = [...new Map(profiles.map(p => [p.id, p])).values()];

  let sent = 0;
  let errors = 0;

  for (const profile of unique) {
    try {
      const message = await buildBriefingMessage(profile, tenantId);
      await dispatchBriefing(profile, message);
      sent++;
    } catch (err) {
      console.error(`[morning-briefing] falha para profile ${profile.id}:`, err);
      errors++;
    }
  }

  return { sent, errors };
}

/** Verifica se o horário configurado (HH:MM BRT) bate com a hora atual ±7 minutos */
export function isTimeWindowMatch(configuredTime: string): boolean {
  const now = new Date();
  const brtOffset = -3 * 60; // UTC-3
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const brtMinutes = ((utcMinutes + brtOffset) % (24 * 60) + 24 * 60) % (24 * 60);

  const [hStr, mStr] = configuredTime.split(':');
  const targetMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);

  const diff = Math.abs(brtMinutes - targetMinutes);
  return diff <= 7 || diff >= 24 * 60 - 7;
}
