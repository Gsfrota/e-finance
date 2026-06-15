import { getInstallmentsToday, getOverdueInstallments, formatCurrency, markInstallmentPaid } from '../actions/admin-actions';
import { getAdminProfiles } from './morning-briefing';
import { getOrCreateSession, saveMessage, updateSessionContext } from '../session/session-manager';
import { getSupabaseClient } from '../infra/runtime-clients';
import * as wa from '../channels/whatsapp';
import * as tg from '../channels/telegram';

export interface PendingPaymentFollowupItem {
  id: string;
  debtorName: string;
  amount: number;
  dueDate?: string;
  /** Dias de atraso (0 = vence hoje). Usado para separar "hoje" de "atrasados" na mensagem. */
  daysLate?: number;
  companyId?: string | null;
  companyName?: string | null;
}

/** Teto de cobranças listadas/acionáveis no alerta de fim de dia (evita mensagem gigante
 *  e contexto de sessão inchado em tenants com centenas de parcelas atrasadas). */
const MAX_EOD_ITEMS = 20;

/** TTL de um pending de wizard legado — alinhado ao handler (30min). */
const PENDING_ACTION_TTL_MS = 30 * 60 * 1000;

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

function toBrtMinutes(now = new Date()): number {
  const brtOffset = -3 * 60;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return ((utcMinutes + brtOffset) % (24 * 60) + 24 * 60) % (24 * 60);
}

export const DEFAULT_EOD_ALERT_TIME = '17:00';
const EOD_WINDOW_TOLERANCE_MIN = 7;

/**
 * Janela de ±7min do horário configurado em BRT.
 * V44 — substitui shouldRunPaymentFollowupNow (janela aberta 17h-23:55) por
 * gating estreito + cooldown de 23h gerenciado pelo router.
 */
export function isWithinEodAlertWindow(now = new Date(), eodAlertTime = DEFAULT_EOD_ALERT_TIME): boolean {
  const [hStr, mStr] = eodAlertTime.split(':');
  const target = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);
  if (Number.isNaN(target)) return false;
  const current = toBrtMinutes(now);
  const diff = Math.abs(current - target);
  return diff <= EOD_WINDOW_TOLERANCE_MIN || diff >= (24 * 60) - EOD_WINDOW_TOLERANCE_MIN;
}

export function getReferenceDateBrt(now = new Date()): string {
  const brt = new Date(now.getTime() - (3 * 60 * 60 * 1000));
  return brt.toISOString().slice(0, 10);
}

/**
 * Mensagem INFORMATIVA de fim de dia (V45): não baixa nada por padrão.
 * Separa "vencendo hoje" de "atrasados", lista numerado, consolida atrasos antigos,
 * e convida o admin a baixar seletivamente (por nome ou número).
 */
export function formatPaymentFollowupMessage(items: PendingPaymentFollowupItem[], olderCount = 0): string {
  if (items.length === 0 && olderCount === 0) {
    return '✅ *Tudo em dia!*\nNenhuma cobrança ficou em aberto hoje. 👏';
  }

  const companyName = items.find(item => item.companyName)?.companyName;
  const companyLine = companyName ? `  ·  _${companyName}_` : '';

  // Ordem de exibição: vencendo hoje primeiro, depois atrasados (mais antigo por último)
  const today = items.filter(i => !i.daysLate || i.daysLate <= 0);
  const overdue = items
    .filter(i => (i.daysLate ?? 0) > 0)
    .sort((a, b) => (a.daysLate ?? 0) - (b.daysLate ?? 0));

  // Numeração contínua e estável para o admin responder por número
  const ordered = [...today, ...overdue];
  const indexOf = new Map(ordered.map((item, i) => [item, i + 1] as const));

  const lines: string[] = [
    `🔔 *Fechamento do dia*${companyLine}`,
    '',
    'Ainda constam *em aberto*:',
  ];

  if (today.length > 0) {
    lines.push('', '📅 *Vencem hoje*');
    today.forEach(item => {
      lines.push(`${indexOf.get(item)}.  ${item.debtorName} — *${formatCurrency(item.amount)}*`);
    });
  }

  if (overdue.length > 0) {
    lines.push('', '⚠️ *Em atraso*');
    overdue.forEach(item => {
      const d = item.daysLate ?? 0;
      lines.push(`${indexOf.get(item)}.  ${item.debtorName} — *${formatCurrency(item.amount)}*  ·  _${d} dia${d > 1 ? 's' : ''}_`);
    });
  }

  if (olderCount > 0) {
    lines.push('', `➕ _e mais ${olderCount} em aberto — veja no painel_`);
  }

  lines.push(
    '',
    '➖➖➖➖➖',
    '💬 Quem já pagou? Eu registro a baixa.',
    'Responda com *nomes* ou *números*:',
    '•  _dar baixa em João e Maria_',
    '•  _ou: 1, 3_',
  );

  return lines.join('\n');
}

async function dispatchToProfileChannel(
  channel: 'whatsapp' | 'telegram',
  channelUserId: string,
  message: string,
): Promise<void> {
  if (channel === 'whatsapp') {
    await wa.sendText(channelUserId, message);
    return;
  }

  const htmlMsg = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>');
  await tg.sendText(channelUserId, htmlMsg, 'HTML');
}

async function enqueueProfileFollowup(
  profile: ProfileChannel,
  channel: 'whatsapp' | 'telegram',
  channelUserId: string,
  tenantId: string,
  companyId: string | null,
  referenceDate: string,
  items: PendingPaymentFollowupItem[],
  olderCount = 0,
): Promise<'sent' | 'skipped_duplicate' | 'skipped_busy'> {
  const session = await getOrCreateSession(channel, channelUserId);
  const currentReferenceDate = String((session.context.pendingData as any)?.referenceDate || '');
  const currentCompanyId = String((session.context.pendingData as any)?.companyId || '');

  if (
    session.context.pendingAction === 'confirmar_baixas_pendentes'
    && currentReferenceDate === referenceDate
    && currentCompanyId === String(companyId || '')
  ) {
    return 'skipped_duplicate';
  }

  // Só considera a sessão "ocupada" se houver um pending NÃO expirado. Wizards travados
  // (ex.: criar_contrato abandonado semanas atrás) não devem bloquear o EOD para sempre —
  // o handler já expira pending com mais de 30min, então aqui aplicamos o mesmo TTL.
  if (session.context.pendingAction && session.context.pendingAction !== 'confirmar_baixas_pendentes') {
    const pendingAtMs = session.context.pendingActionAt
      ? new Date(session.context.pendingActionAt).getTime()
      : 0;
    const pendingExpired = !pendingAtMs || (Date.now() - pendingAtMs) > PENDING_ACTION_TTL_MS;
    if (!pendingExpired) {
      return 'skipped_busy';
    }
  }

  const message = formatPaymentFollowupMessage(items, olderCount);
  await dispatchToProfileChannel(channel, channelUserId, message);
  await updateSessionContext(session.id, {
    ...session.context,
    pendingAction: 'confirmar_baixas_pendentes',
    pendingActionAt: new Date().toISOString(),
    pendingStep: 1,
    pendingData: {
      tenantId,
      companyId,
      profileId: profile.id,
      referenceDate,
      items,
    },
  });
  await saveMessage(session.id, 'assistant', message, 'text', 'confirmar_baixas_pendentes');
  return 'sent';
}

export async function runPaymentFollowupForTenant(
  tenantId: string,
  now = new Date(),
): Promise<{ sent: number; skipped: number; skippedDuplicate: number; skippedBusy: number }> {
  const admins = await getAdminProfiles(tenantId);
  const referenceDate = getReferenceDateBrt(now);
  let sent = 0;
  let skipped = 0;
  let skippedDuplicate = 0;
  let skippedBusy = 0;

  for (const profile of admins) {
    if (!profile.company_id) {
      skipped += 1;
      continue;
    }

    // Vencendo hoje + atrasados (com lookback de 90d e consolidação dos mais antigos)
    const [todayInstallments, overdue] = await Promise.all([
      getInstallmentsToday(tenantId, profile.company_id),
      getOverdueInstallments(tenantId, profile.company_id),
    ]);

    // Dedup por id (defensivo — uma parcela não deve aparecer nas duas listas)
    const byId = new Map<string, PendingPaymentFollowupItem>();
    for (const item of [...todayInstallments, ...overdue.installments]) {
      if (byId.has(item.id)) continue;
      byId.set(item.id, {
        id: item.id,
        debtorName: item.debtorName,
        amount: item.amount,
        dueDate: item.dueDate,
        daysLate: item.daysLate,
        companyId: profile.company_id,
        companyName: profile.companies?.name || null,
      });
    }
    // Ordena (vencendo hoje primeiro, depois atrasos mais recentes) e capa a lista
    // acionável — em tenants com centenas de atrasados, listar tudo geraria mensagem
    // gigante e contexto de sessão inchado. O excedente vai para a linha consolidada.
    const allItems = Array.from(byId.values()).sort((a, b) => (a.daysLate ?? 0) - (b.daysLate ?? 0));
    const pendingItems = allItems.slice(0, MAX_EOD_ITEMS);
    const extraCount = (allItems.length - pendingItems.length) + overdue.olderCount;

    if (pendingItems.length === 0 && extraCount === 0) {
      skipped += (profile.whatsapp_phone ? 1 : 0) + (profile.telegram_chat_id ? 1 : 0);
      continue;
    }

    const targets: Array<{ channel: 'whatsapp' | 'telegram'; id: string }> = [];
    if (profile.whatsapp_phone) targets.push({ channel: 'whatsapp', id: profile.whatsapp_phone });
    if (profile.telegram_chat_id) targets.push({ channel: 'telegram', id: profile.telegram_chat_id });

    for (const target of targets) {
      const result = await enqueueProfileFollowup(profile, target.channel, target.id, tenantId, profile.company_id, referenceDate, pendingItems, extraCount);
      if (result === 'sent') sent += 1;
      else if (result === 'skipped_duplicate') skippedDuplicate += 1;
      else if (result === 'skipped_busy') skippedBusy += 1;
      else skipped += 1;
    }
  }

  return { sent, skipped, skippedDuplicate, skippedBusy };
}

export async function confirmPendingPaymentFollowup(
  tenantId: string,
  items: PendingPaymentFollowupItem[],
): Promise<{ paid: PendingPaymentFollowupItem[]; alreadyPaid: PendingPaymentFollowupItem[]; failed: PendingPaymentFollowupItem[] }> {
  const paid: PendingPaymentFollowupItem[] = [];
  const alreadyPaid: PendingPaymentFollowupItem[] = [];
  const failed: PendingPaymentFollowupItem[] = [];

  // Revalida o status atual de cada parcela (anti-stale): se já foi baixada no painel
  // entre o envio do alerta e a resposta, reporta como "já estava paga", não como erro.
  const ids = items.map(i => i.id);
  const statusById = new Map<string, string>();
  if (ids.length > 0) {
    const { data, error } = await getSupabaseClient()
      .from('loan_installments')
      .select('id, status, investments!inner(tenant_id)')
      .eq('investments.tenant_id', tenantId)
      .in('id', ids);
    if (error) {
      console.error('[confirmPendingPaymentFollowup] status recheck failed', error);
    } else {
      for (const row of (data || []) as Array<{ id: string; status: string }>) {
        statusById.set(row.id, row.status);
      }
    }
  }

  for (const item of items) {
    const current = statusById.get(item.id);
    if (current === 'paid') {
      alreadyPaid.push(item);
      continue;
    }
    const ok = await markInstallmentPaid(item.id, tenantId);
    if (ok) paid.push(item);
    else failed.push(item);
  }

  return { paid, alreadyPaid, failed };
}
