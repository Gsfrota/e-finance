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

export interface WhitelistCheckResult {
  blocked: boolean;
  reason: 'whitelist_disabled' | 'phone_allowed' | 'phone_not_in_whitelist';
}

export async function checkWhitelistBlock(phone: string): Promise<WhitelistCheckResult> {
  const { data } = await db()
    .from('bot_tenant_config')
    .select('whitelist_enabled, whitelist_phones');

  const activeRows = (data ?? []).filter((r: { whitelist_enabled: boolean }) => r.whitelist_enabled);
  if (activeRows.length === 0) return { blocked: false, reason: 'whitelist_disabled' };

  for (const row of activeRows as { whitelist_enabled: boolean; whitelist_phones: string[] }[]) {
    if (isPhoneInWhitelist(phone, row.whitelist_phones)) {
      return { blocked: false, reason: 'phone_allowed' };
    }
  }
  return { blocked: true, reason: 'phone_not_in_whitelist' };
}
