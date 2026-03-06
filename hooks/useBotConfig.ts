import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '../services/supabase';

export interface BotConfig {
  morning_briefing_enabled: boolean;
  morning_briefing_time: string;
  morning_briefing_targets: string[];
  followup_enabled: boolean;
  followup_style: 'natural' | 'direto' | 'disabled';
}

const DEFAULT_CONFIG: BotConfig = {
  morning_briefing_enabled: false,
  morning_briefing_time: '08:00',
  morning_briefing_targets: ['admin'],
  followup_enabled: true,
  followup_style: 'natural',
};

export function useBotConfig(tenantId: string) {
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();
      if (!supabase) return;
      const { data, error: dbError } = await supabase
        .from('bot_tenant_config')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (dbError) throw dbError;
      if (data) {
        setConfig({
          morning_briefing_enabled: data.morning_briefing_enabled,
          morning_briefing_time: data.morning_briefing_time,
          morning_briefing_targets: data.morning_briefing_targets,
          followup_enabled: data.followup_enabled,
          followup_style: data.followup_style,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar configuração');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const saveConfig = useCallback(async (updates: Partial<BotConfig>) => {
    if (!tenantId) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = getSupabase();
      if (!supabase) return;
      const { error: dbError } = await supabase
        .from('bot_tenant_config')
        .upsert(
          { tenant_id: tenantId, ...updates, updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id' }
        );
      if (dbError) throw dbError;
      setConfig(prev => ({ ...prev, ...updates }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar configuração');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [tenantId]);

  return { config, loading, saving, error, saveConfig, refetch: fetchConfig };
}
