import {
  buildSubscriptionPixBlock,
  cycleOf,
  relevantDueDate,
  getTenantsForSubscriptionReminder,
} from '../actions/billing-actions';
import { getAllBotTenantConfigs, updateSubscriptionReminderCycle } from '../actions/bot-config-actions';
import { getAdminProfiles } from './morning-briefing';
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

/**
 * Lembrete de mensalidade da assinatura (SaaS). Dispara para os admins do
 * tenant quando "hoje" está na janela do vencimento — alguns dias ANTES
 * (antecedência) ou DEPOIS (em atraso, dentro do período de graça).
 *
 * Dedup: carimbo do ciclo 'YYYY-MM' do VENCIMENTO RELEVANTE em
 * bot_tenant_config — só carimba após pelo menos um envio. Como o ciclo é o
 * do vencimento em questão (e não do mês corrente), um aviso de atraso do dia
 * 28 e o aviso de antecedência do mês seguinte são ciclos distintos: cada um
 * sai uma única vez. Respeita pendingAction da sessão (skipped_busy).
 */
export async function runSubscriptionReminders(now = new Date()): Promise<{
  processed: number;
  sent: number;
  skippedBusy: number;
  skippedAlreadyNotified: number;
  skippedOutOfWindow: number;
  skippedUnconfigured: number;
}> {
  const tenants = await getTenantsForSubscriptionReminder();
  const configs = await getAllBotTenantConfigs();
  const cycleByTenant = new Map<string, string | null>(
    configs.map(c => [c.tenant_id, c.last_subscription_reminder_cycle ?? null]),
  );

  let sent = 0;
  let skippedBusy = 0;
  let skippedAlreadyNotified = 0;
  let skippedOutOfWindow = 0;
  let skippedUnconfigured = 0;

  for (const tenant of tenants) {
    const dueDay = tenant.subscription_due_day;
    const due = dueDay ? relevantDueDate(dueDay, now) : null;
    if (!due) {
      skippedOutOfWindow += 1;
      continue;
    }

    const cycle = cycleOf(due);
    if (cycleByTenant.get(tenant.id) === cycle) {
      skippedAlreadyNotified += 1;
      continue;
    }

    const block = buildSubscriptionPixBlock(tenant.plan, dueDay, now);
    if (!block) {
      skippedUnconfigured += 1;
      continue;
    }

    const admins = await getAdminProfiles(tenant.id);
    if (admins.length === 0) {
      skippedUnconfigured += 1;
      continue;
    }

    let dispatchedAtLeastOne = false;
    for (const profile of admins) {
      const targets: Array<{ channel: 'whatsapp' | 'telegram'; id: string }> = [];
      if (profile.whatsapp_phone) targets.push({ channel: 'whatsapp', id: profile.whatsapp_phone });
      if (profile.telegram_chat_id) targets.push({ channel: 'telegram', id: profile.telegram_chat_id });

      for (const target of targets) {
        try {
          const session = await getOrCreateSession(target.channel, target.id);
          if (session.context.pendingAction) {
            skippedBusy += 1;
            continue;
          }
          await dispatch(target.channel, target.id, block.message);
          sent += 1;
          dispatchedAtLeastOne = true;
        } catch (err) {
          console.error(`[subscription-reminder] erro tenant ${tenant.id}:`, err);
        }
      }
    }

    if (dispatchedAtLeastOne) {
      await updateSubscriptionReminderCycle(tenant.id, cycle);
      cycleByTenant.set(tenant.id, cycle);
    }
  }

  return {
    processed: tenants.length,
    sent,
    skippedBusy,
    skippedAlreadyNotified,
    skippedOutOfWindow,
    skippedUnconfigured,
  };
}
