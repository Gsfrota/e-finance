import { getInstallmentsToday, formatCurrency, markInstallmentPaid } from '../actions/admin-actions';
import { getAdminProfiles } from './morning-briefing';
import { getOrCreateSession, saveMessage, updateSessionContext } from '../session/session-manager';
import * as wa from '../channels/whatsapp';
import * as tg from '../channels/telegram';

export interface PendingPaymentFollowupItem {
  id: string;
  debtorName: string;
  amount: number;
  dueDate?: string;
  companyId?: string | null;
  companyName?: string | null;
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

function toBrtMinutes(now = new Date()): number {
  const brtOffset = -3 * 60;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return ((utcMinutes + brtOffset) % (24 * 60) + 24 * 60) % (24 * 60);
}

export function shouldRunPaymentFollowupNow(now = new Date()): boolean {
  const minutes = toBrtMinutes(now);
  return minutes >= (17 * 60) && minutes <= (23 * 60 + 55);
}

export function getReferenceDateBrt(now = new Date()): string {
  const brt = new Date(now.getTime() - (3 * 60 * 60 * 1000));
  return brt.toISOString().slice(0, 10);
}

export function formatPaymentFollowupMessage(items: PendingPaymentFollowupItem[]): string {
  if (items.length === 0) {
    return '✅ Nenhuma cobrança do dia ficou sem baixa.';
  }

  const companyName = items.find(item => item.companyName)?.companyName;
  const companyLine = companyName ? ` da empresa *${companyName}*` : '';

  if (items.length === 1) {
    const item = items[0];
    return `Hoje você ainda não deu baixa${companyLine} em *${item.debtorName}* no valor de *${formatCurrency(item.amount)}*.\n\nDevo dar baixa agora? Responda *sim* ou *não*.`;
  }

  const lines = items.slice(0, 8).map((item, index) =>
    `${index + 1}. *${item.debtorName}* — *${formatCurrency(item.amount)}*`
  );
  const hidden = items.length - lines.length;
  const hiddenLine = hidden > 0 ? `\n...e mais ${hidden} cobrança(s).` : '';

  return `Hoje ainda não houve baixa${companyLine} nestas cobranças do dia:\n\n${lines.join('\n')}${hiddenLine}\n\nPosso dar baixa em *todas* agora?\nSe alguma *não pagou*, responda com os *números que devo manter em aberto*.\nEx.: *2* ou *1,3*.`;
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
    .replace(/\*([^*]+)\*/g, '<b>$1</b>');
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

  if (session.context.pendingAction && session.context.pendingAction !== 'confirmar_baixas_pendentes') {
    return 'skipped_busy';
  }

  const message = formatPaymentFollowupMessage(items);
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

    const installments = await getInstallmentsToday(tenantId, profile.company_id);
    const pendingItems = installments.map(item => ({
      id: item.id,
      debtorName: item.debtorName,
      amount: item.amount,
      dueDate: item.dueDate,
      companyId: profile.company_id,
      companyName: profile.companies?.name || null,
    }));

    if (pendingItems.length === 0) {
      skipped += (profile.whatsapp_phone ? 1 : 0) + (profile.telegram_chat_id ? 1 : 0);
      continue;
    }

    const targets: Array<{ channel: 'whatsapp' | 'telegram'; id: string }> = [];
    if (profile.whatsapp_phone) targets.push({ channel: 'whatsapp', id: profile.whatsapp_phone });
    if (profile.telegram_chat_id) targets.push({ channel: 'telegram', id: profile.telegram_chat_id });

    for (const target of targets) {
      const result = await enqueueProfileFollowup(profile, target.channel, target.id, tenantId, profile.company_id, referenceDate, pendingItems);
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
): Promise<{ paid: PendingPaymentFollowupItem[]; failed: PendingPaymentFollowupItem[] }> {
  const paid: PendingPaymentFollowupItem[] = [];
  const failed: PendingPaymentFollowupItem[] = [];

  for (const item of items) {
    const ok = await markInstallmentPaid(item.id, tenantId);
    if (ok) paid.push(item);
    else failed.push(item);
  }

  return { paid, failed };
}
