import { getSupabaseClient } from '../infra/runtime-clients';

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
  created_at: string;
  updated_at: string;
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
