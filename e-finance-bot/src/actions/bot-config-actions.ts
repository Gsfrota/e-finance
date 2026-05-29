import { getSupabaseClient } from '../infra/runtime-clients';
import { isPhoneInWhitelist } from '../utils/phone-normalizer';

function db() {
  return getSupabaseClient();
}

export interface BotTenantConfig {
  id: string;
  tenant_id: string;
  morning_briefing_enabled: boolean;
  morning_briefing_time: string;
  morning_briefing_targets: string[];
  followup_enabled: boolean;
  followup_style: 'natural' | 'direto' | 'disabled';
  whitelist_enabled: boolean;   // V21
  whitelist_phones: string[];   // V21
  created_at: string;
  updated_at: string;
  last_briefing_sent_at: string | null;
  // V44 — EOD alert (parcelas vencendo hoje sem baixa)
  eod_alert_enabled: boolean;
  eod_alert_time: string;                    // 'HH:MM' BRT
  last_eod_alert_sent_at: string | null;
  eod_alert_promoted_at: string | null;      // NULL = feature nunca promovida
  // Lembrete de mensalidade SaaS — ciclo 'YYYY-MM' já notificado (dedup mensal)
  last_subscription_reminder_cycle: string | null;
}

export const EOD_ALERT_DEFAULT_TIME = '17:00';

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHHMM(value: unknown): value is string {
  return typeof value === 'string' && HHMM_REGEX.test(value);
}

export type BotTenantConfigPatch = Partial<Omit<BotTenantConfig, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>;

export async function getBotTenantConfig(tenantId: string): Promise<BotTenantConfig | null> {
  const { data, error } = await db()
    .from('bot_tenant_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    console.error('[getBotTenantConfig] erro:', error.message);
    return null;
  }

  return data as BotTenantConfig | null;
}

export async function upsertBotTenantConfig(tenantId: string, patch: BotTenantConfigPatch): Promise<void> {
  const { error } = await db()
    .from('bot_tenant_config')
    .upsert(
      { tenant_id: tenantId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id' }
    );

  if (error) {
    console.error('[upsertBotTenantConfig] erro:', error.message);
    throw new Error(`Falha ao salvar config do bot: ${error.message}`);
  }
}

export async function getAllTenantsWithBriefingEnabled(): Promise<BotTenantConfig[]> {
  const { data, error } = await db()
    .from('bot_tenant_config')
    .select('*')
    .eq('morning_briefing_enabled', true);

  if (error) {
    console.error('[getAllTenantsWithBriefingEnabled] erro:', error.message);
    return [];
  }

  return (data ?? []) as BotTenantConfig[];
}

export async function getAllTenantsWithFollowupEnabled(): Promise<BotTenantConfig[]> {
  const { data, error } = await db()
    .from('bot_tenant_config')
    .select('*')
    .eq('followup_enabled', true);

  if (error) {
    console.error('[getAllTenantsWithFollowupEnabled] erro:', error.message);
    return [];
  }

  return (data ?? []) as BotTenantConfig[];
}

export async function updateBriefingSentAt(tenantId: string): Promise<void> {
  const { error } = await db()
    .from('bot_tenant_config')
    .update({ last_briefing_sent_at: new Date().toISOString() })
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[updateBriefingSentAt] erro:', error.message);
    // Non-fatal: briefing already sent, timestamp write failure is acceptable
  }
}

export async function getAllTenantsWithEodAlertEnabled(): Promise<BotTenantConfig[]> {
  const { data, error } = await db()
    .from('bot_tenant_config')
    .select('*')
    .eq('eod_alert_enabled', true);

  if (error) {
    console.error('[getAllTenantsWithEodAlertEnabled] erro:', error.message);
    return [];
  }

  return (data ?? []) as BotTenantConfig[];
}

export async function updateEodAlertSentAt(tenantId: string): Promise<void> {
  const { error } = await db()
    .from('bot_tenant_config')
    .update({ last_eod_alert_sent_at: new Date().toISOString() })
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[updateEodAlertSentAt] erro:', error.message);
  }
}

export async function getAllBotTenantConfigs(): Promise<BotTenantConfig[]> {
  const { data, error } = await db()
    .from('bot_tenant_config')
    .select('*');

  if (error) {
    console.error('[getAllBotTenantConfigs] erro:', error.message);
    return [];
  }

  return (data ?? []) as BotTenantConfig[];
}

export async function markFeaturePromoted(
  tenantId: string,
  promotedAtColumn: 'eod_alert_promoted_at',
): Promise<void> {
  const { error } = await db()
    .from('bot_tenant_config')
    .update({ [promotedAtColumn]: new Date().toISOString() })
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[markFeaturePromoted] erro:', error.message);
  }
}

/**
 * Carimba o ciclo de mensalidade já notificado (dedup mensal).
 * Upsert porque nem todo tenant possui linha em bot_tenant_config.
 */
export async function updateSubscriptionReminderCycle(tenantId: string, cycle: string): Promise<void> {
  const { error } = await db()
    .from('bot_tenant_config')
    .upsert(
      { tenant_id: tenantId, last_subscription_reminder_cycle: cycle, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id' }
    );

  if (error) {
    console.error('[updateSubscriptionReminderCycle] erro:', error.message);
  }
}

export interface WhitelistCheckResult {
  blocked: boolean;
  reason: 'whitelist_disabled' | 'phone_allowed' | 'phone_not_in_whitelist';
}

export async function checkWhitelistBlock(phone: string, tenantId?: string): Promise<WhitelistCheckResult> {
  // Sem tenant_id conhecido não há como escopar a whitelist — permite passar
  if (!tenantId) return { blocked: false, reason: 'whitelist_disabled' };

  const { data } = await db()
    .from('bot_tenant_config')
    .select('whitelist_enabled, whitelist_phones')
    .eq('tenant_id', tenantId);

  const activeRows = (data ?? []).filter((r: { whitelist_enabled: boolean }) => r.whitelist_enabled);
  if (activeRows.length === 0) return { blocked: false, reason: 'whitelist_disabled' };

  for (const row of activeRows as { whitelist_enabled: boolean; whitelist_phones: string[] }[]) {
    if (isPhoneInWhitelist(phone, row.whitelist_phones)) {
      return { blocked: false, reason: 'phone_allowed' };
    }
  }
  return { blocked: true, reason: 'phone_not_in_whitelist' };
}
