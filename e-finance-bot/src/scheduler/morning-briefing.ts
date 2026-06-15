import { getSupabaseClient } from '../infra/runtime-clients';
import {
  getDebtorsToCollectToday, getOverdueDebtors, formatCurrency,
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
  company_id?: string | null;
  companies?: {
    name?: string | null;
  } | null;
}

export async function getAdminProfiles(tenantId: string): Promise<ProfileChannel[]> {
  const { data, error } = await db()
    .from('profiles')
    .select('id, full_name, whatsapp_phone, telegram_chat_id, company_id, companies(name)')
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
    const [collection, overdue] = await Promise.all([
      getDebtorsToCollectToday(tenantId),
      getOverdueDebtors(tenantId),
    ]);

    const totalToday = collection.reduce((sum, d) => sum + d.totalDue, 0);
    const totalOverdue = overdue.reduce((sum, d) => sum + d.totalDue, 0);

    // Nada hoje e nada atrasado → tudo em dia
    if (collection.length === 0 && overdue.length === 0) {
      return [
        `Bom dia, ${firstName}.`,
        '',
        'Hoje não há cobranças programadas e não há atrasados. Tudo em dia. 👍',
        '',
        'Posso te mostrar o resumo do mês — é só pedir.',
      ].join('\n');
    }

    const formatDebtor = (d: { name: string; totalDue: number; installmentCount: number; daysLate?: number }) => {
      const parcelas = d.installmentCount > 1 ? `  ·  ${d.installmentCount} parcelas` : '';
      return `• ${d.name}  ·  *${formatCurrency(d.totalDue)}*${parcelas}`;
    };

    const sections: string[] = [
      `Bom dia, ${firstName}.`,
      `Você tem *${formatCurrency(totalToday + totalOverdue)}* a receber.`,
    ];

    if (collection.length > 0) {
      const lines = collection.slice(0, 5).map(formatDebtor);
      const extra = collection.length - 5;
      sections.push('', `*Vencendo hoje* — ${formatCurrency(totalToday)}:`, lines.join('\n'));
      if (extra > 0) sections.push(`_…e mais ${extra} cobrança${extra > 1 ? 's' : ''}._`);
    }

    if (overdue.length > 0) {
      const lines = overdue.slice(0, 5).map(d => {
        const dias = d.daysLate && d.daysLate > 0 ? `  ·  ${d.daysLate} dia${d.daysLate > 1 ? 's' : ''}` : '';
        return `• ${d.name}  ·  *${formatCurrency(d.totalDue)}*${dias}`;
      });
      const extra = overdue.length - 5;
      sections.push('', `⚠️ *Atrasados* — ${formatCurrency(totalOverdue)}:`, lines.join('\n'));
      if (extra > 0) sections.push(`_…e mais ${extra} atrasado${extra > 1 ? 's' : ''}._`);
    }

    sections.push('', 'Quer ver o dashboard completo?');
    return sections.filter(s => s !== undefined).join('\n');
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
