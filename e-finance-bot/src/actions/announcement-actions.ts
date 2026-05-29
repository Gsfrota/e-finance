import { getSupabaseClient } from '../infra/runtime-clients';

function db() {
  return getSupabaseClient();
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  target_roles: string[];
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  tenant_id: string | null; // NULL = global; preenchido = só admins desse tenant
}

export interface AdminProfileChannel {
  id: string;
  full_name: string | null;
  whatsapp_phone: string | null;
  telegram_chat_id: string | null;
  tenant_id: string;
}

/** Anúncios ativos dentro da janela de validade (starts_at..ends_at). */
export async function getActiveAnnouncements(now = new Date()): Promise<Announcement[]> {
  const iso = now.toISOString();
  const { data, error } = await db()
    .from('announcements')
    .select('*')
    .eq('active', true)
    .or(`starts_at.is.null,starts_at.lte.${iso}`)
    .or(`ends_at.is.null,ends_at.gte.${iso}`)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[announcement-actions] erro ao buscar anúncios:', error.message);
    return [];
  }
  return (data ?? []) as Announcement[];
}

/** IDs de perfis que já receberam o anúncio (dedup persistente por destinatário). */
export async function getDeliveredProfileIds(announcementId: string): Promise<Set<string>> {
  const { data, error } = await db()
    .from('announcement_deliveries')
    .select('profile_id')
    .eq('announcement_id', announcementId);

  if (error) {
    console.error('[announcement-actions] erro ao buscar entregas:', error.message);
    // Em caso de erro, devolve "todos entregues" implícito via fail-safe no chamador.
    return new Set<string>();
  }
  return new Set((data ?? []).map((r: { profile_id: string }) => r.profile_id));
}

/**
 * Grava a entrega. A constraint UNIQUE(announcement_id, profile_id) garante
 * idempotência: se já existir, o insert falha silenciosamente e retorna false.
 */
export async function recordDelivery(
  announcementId: string,
  profileId: string,
  channel: string,
): Promise<boolean> {
  const { error } = await db()
    .from('announcement_deliveries')
    .insert({ announcement_id: announcementId, profile_id: profileId, channel });

  if (error) {
    // 23505 = unique_violation → já entregue, não é erro real
    if (error.code !== '23505') {
      console.error('[announcement-actions] erro ao gravar entrega:', error.message);
    }
    return false;
  }
  return true;
}

/** Todos os admins (qualquer tenant) com algum canal vinculado. */
export async function getAllAdminProfiles(): Promise<AdminProfileChannel[]> {
  const { data, error } = await db()
    .from('profiles')
    .select('id, full_name, whatsapp_phone, telegram_chat_id, tenant_id')
    .eq('role', 'admin')
    .or('whatsapp_phone.not.is.null,telegram_chat_id.not.is.null');

  if (error) {
    console.error('[announcement-actions] erro ao buscar admins:', error.message);
    return [];
  }
  return (data ?? []) as AdminProfileChannel[];
}
