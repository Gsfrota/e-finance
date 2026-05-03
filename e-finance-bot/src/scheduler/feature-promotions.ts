import {
  type BotTenantConfig,
  getAllBotTenantConfigs,
  markFeaturePromoted,
} from '../actions/bot-config-actions';
import { getAdminProfiles } from './morning-briefing';
import { getOrCreateSession, saveMessage, updateSessionContext } from '../session/session-manager';
import * as wa from '../channels/whatsapp';
import * as tg from '../channels/telegram';

interface ProfileChannel {
  id: string;
  full_name: string;
  whatsapp_phone: string | null;
  telegram_chat_id: string | null;
}

interface FeaturePromotion {
  key: string;
  promotedAtColumn: 'eod_alert_promoted_at';
  pendingAction: string;
  isAlreadyEnabled: (cfg: BotTenantConfig) => boolean;
  buildMessage: (firstName: string) => string;
}

export const FEATURE_PROMOTIONS: FeaturePromotion[] = [
  {
    key: 'eod_alert',
    promotedAtColumn: 'eod_alert_promoted_at',
    pendingAction: 'ativar_eod_alert',
    isAlreadyEnabled: (c) => c.eod_alert_enabled,
    buildMessage: (firstName) =>
      `Oi, ${firstName}! Notei que você não tem o aviso de fim de dia ativo. Posso te lembrar todo dia às *17h* sobre cobranças do dia que ainda não tiveram baixa, pra você não perder nada antes de virar atraso.\n\nQuer que eu ative? Responda *sim* ou *não*.`,
  },
];

const TENANT_AGE_MIN_DAYS = 7;
const SAME_DAY_MS = 24 * 60 * 60 * 1000;

function isEligibleForPromotion(cfg: BotTenantConfig, feature: FeaturePromotion, now: number): boolean {
  if (feature.isAlreadyEnabled(cfg)) return false;
  if (cfg[feature.promotedAtColumn]) return false;

  const createdAt = cfg.created_at ? new Date(cfg.created_at).getTime() : now;
  const ageMs = now - createdAt;
  if (ageMs < TENANT_AGE_MIN_DAYS * SAME_DAY_MS) return false;

  // Cooldown: nada de promoção no mesmo dia em que já enviamos morning briefing ou EOD
  const lastBrief = cfg.last_briefing_sent_at ? new Date(cfg.last_briefing_sent_at).getTime() : 0;
  const lastEod = cfg.last_eod_alert_sent_at ? new Date(cfg.last_eod_alert_sent_at).getTime() : 0;
  if (now - lastBrief < SAME_DAY_MS) return false;
  if (now - lastEod < SAME_DAY_MS) return false;

  return true;
}

async function dispatchPromotion(
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

async function promoteToProfile(
  profile: ProfileChannel,
  channel: 'whatsapp' | 'telegram',
  channelUserId: string,
  tenantId: string,
  feature: FeaturePromotion,
  message: string,
): Promise<'sent' | 'skipped_busy'> {
  const session = await getOrCreateSession(channel, channelUserId);
  if (session.context.pendingAction && session.context.pendingAction !== feature.pendingAction) {
    return 'skipped_busy';
  }

  await dispatchPromotion(channel, channelUserId, message);
  await updateSessionContext(session.id, {
    ...session.context,
    pendingAction: feature.pendingAction,
    pendingActionAt: new Date().toISOString(),
    pendingStep: 1,
    pendingData: { tenantId, feature: feature.key, profileId: profile.id },
  });
  await saveMessage(session.id, 'assistant', message, 'text', feature.pendingAction);
  return 'sent';
}

export async function runFeaturePromotions(now = new Date()): Promise<{
  processed: number;
  sent: number;
  skippedBusy: number;
  skippedIneligible: number;
}> {
  const configs = await getAllBotTenantConfigs();
  const nowMs = now.getTime();
  let sent = 0;
  let skippedBusy = 0;
  let skippedIneligible = 0;

  for (const cfg of configs) {
    const eligible = FEATURE_PROMOTIONS.find(f => isEligibleForPromotion(cfg, f, nowMs));
    if (!eligible) {
      skippedIneligible += 1;
      continue;
    }

    const admins = await getAdminProfiles(cfg.tenant_id);
    if (admins.length === 0) {
      skippedIneligible += 1;
      continue;
    }

    let dispatchedAtLeastOne = false;
    for (const profile of admins) {
      const firstName = profile.full_name?.split(' ')[0] || 'Gestor';
      const message = eligible.buildMessage(firstName);

      const targets: Array<{ channel: 'whatsapp' | 'telegram'; id: string }> = [];
      if (profile.whatsapp_phone) targets.push({ channel: 'whatsapp', id: profile.whatsapp_phone });
      if (profile.telegram_chat_id) targets.push({ channel: 'telegram', id: profile.telegram_chat_id });

      for (const target of targets) {
        try {
          const result = await promoteToProfile(profile, target.channel, target.id, cfg.tenant_id, eligible, message);
          if (result === 'sent') {
            sent += 1;
            dispatchedAtLeastOne = true;
          } else {
            skippedBusy += 1;
          }
        } catch (err) {
          console.error(`[feature-promotions] erro tenant ${cfg.tenant_id}:`, err);
        }
      }
    }

    if (dispatchedAtLeastOne) {
      await markFeaturePromoted(cfg.tenant_id, eligible.promotedAtColumn);
    }
  }

  return { processed: configs.length, sent, skippedBusy, skippedIneligible };
}
