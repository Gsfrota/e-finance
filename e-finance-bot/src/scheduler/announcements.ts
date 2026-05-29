import {
  getActiveAnnouncements,
  getAllAdminProfiles,
  getDeliveredProfileIds,
  recordDelivery,
  type Announcement,
} from '../actions/announcement-actions';
import { getOrCreateSession } from '../session/session-manager';
import * as wa from '../channels/whatsapp';
import * as tg from '../channels/telegram';

async function dispatch(
  channel: 'whatsapp' | 'telegram',
  channelUserId: string,
  message: string,
): Promise<void> {
  if (channel === 'whatsapp') {
    await wa.sendText(channelUserId, message);
    return;
  }
  const html = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*]+)\*/g, '<b>$1</b>');
  await tg.sendText(channelUserId, html, 'HTML');
}

function formatAnnouncement(a: Announcement): string {
  return `📣 *${a.title}*\n\n${a.body}`;
}

/**
 * Anúncios de novas funcionalidades para admins. Cada admin recebe cada
 * anúncio UMA vez (dedup persistente via announcement_deliveries — sobrevive a
 * restart). A entrega é "reivindicada" (insert) ANTES do envio: a constraint
 * UNIQUE(announcement_id, profile_id) impede envio duplo em execuções
 * concorrentes. Envia por um único canal (WhatsApp preferencial) por pessoa.
 */
export async function runAnnouncements(now = new Date()): Promise<{
  announcements: number;
  sent: number;
  skippedAlready: number;
  skippedBusy: number;
  skippedNoChannel: number;
}> {
  const announcements = await getActiveAnnouncements(now);
  const admins = await getAllAdminProfiles();

  let sent = 0;
  let skippedAlready = 0;
  let skippedBusy = 0;
  let skippedNoChannel = 0;

  for (const announcement of announcements) {
    if (!announcement.target_roles?.includes('admin')) continue;

    const delivered = await getDeliveredProfileIds(announcement.id);
    const message = formatAnnouncement(announcement);

    // Alvo opcional por tenant: NULL = global; preenchido = só admins do tenant.
    const targetAdmins = announcement.tenant_id
      ? admins.filter(a => a.tenant_id === announcement.tenant_id)
      : admins;

    for (const admin of targetAdmins) {
      if (delivered.has(admin.id)) {
        skippedAlready += 1;
        continue;
      }

      const target: { channel: 'whatsapp' | 'telegram'; id: string } | null =
        admin.whatsapp_phone
          ? { channel: 'whatsapp', id: admin.whatsapp_phone }
          : admin.telegram_chat_id
            ? { channel: 'telegram', id: admin.telegram_chat_id }
            : null;

      if (!target) {
        skippedNoChannel += 1;
        continue;
      }

      try {
        const session = await getOrCreateSession(target.channel, target.id);
        if (session.context.pendingAction) {
          skippedBusy += 1;
          continue;
        }

        // Reivindica a entrega antes de enviar (anti-duplicação em corrida).
        const claimed = await recordDelivery(announcement.id, admin.id, target.channel);
        if (!claimed) {
          skippedAlready += 1;
          continue;
        }

        await dispatch(target.channel, target.id, message);
        sent += 1;
      } catch (err) {
        console.error(`[announcements] erro ao enviar anúncio ${announcement.id} para ${admin.id}:`, err);
      }
    }
  }

  return { announcements: announcements.length, sent, skippedAlready, skippedBusy, skippedNoChannel };
}
