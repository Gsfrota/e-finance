/**
 * Read-only helpers para consultar bot_turn_traces (BR-BOT-009).
 * Usado pelo endpoint /debug/traces e pelo CLI scripts/diag-trace.ts.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

let _supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return _supabase;
}

export interface TraceFilters {
  sessionId?: string;
  channelUserId?: string;
  tenantId?: string;
  since?: string;
  limit?: number;
}

export async function fetchTraces(filters: TraceFilters): Promise<unknown[]> {
  const limit = Math.max(1, Math.min(200, filters.limit ?? 20));
  let q = db()
    .from('bot_turn_traces')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filters.sessionId) q = q.eq('session_id', filters.sessionId);
  if (filters.channelUserId) q = q.eq('channel_user_id', filters.channelUserId);
  if (filters.tenantId) q = q.eq('tenant_id', filters.tenantId);
  if (filters.since) q = q.gte('created_at', filters.since);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
