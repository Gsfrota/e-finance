/**
 * Serviço de auditoria de ações do cliente (BR-SYS-008).
 * Grava entradas na tabela tenant_events — non-blocking, fire-and-forget.
 * Pattern idêntico ao paymentAudit.ts.
 */
import { getSupabase } from './supabase';

export type EventCategory = 'auth' | 'contract' | 'payment' | 'installment_admin';

export interface EventPayload {
  tenant_id: string;
  user_id: string;
  event_category: EventCategory;
  event_type: string;
  entity_type?: string;
  entity_id?: string;
  /** Estado anterior da entidade (para operações de edição/exclusão) */
  before?: Record<string, unknown>;
  /** Estado posterior da entidade (para operações de criação/edição) */
  after?: Record<string, unknown>;
  /** Contexto adicional: method, user_agent, receipt_id, etc. */
  context?: Record<string, unknown>;
}

/** Registra uma ação do cliente em tenant_events (non-blocking). */
export const logEvent = async (payload: EventPayload): Promise<void> => {
  try {
    const supabase = getSupabase();
    if (!supabase) return;

    const metadata: Record<string, unknown> = {};
    if (payload.before  !== undefined) metadata.before  = payload.before;
    if (payload.after   !== undefined) metadata.after   = payload.after;
    if (payload.context !== undefined) metadata.context = payload.context;

    await supabase.from('tenant_events').insert({
      tenant_id:      payload.tenant_id,
      user_id:        payload.user_id,
      event_category: payload.event_category,
      event_type:     payload.event_type,
      entity_type:    payload.entity_type  ?? null,
      entity_id:      payload.entity_id    ?? null,
      metadata,
    });
  } catch { /* non-blocking — não bloqueia o fluxo principal */ }
};

/**
 * Variante para contextos onde user_id não está pré-carregado (ex: InstallmentDetailFlow).
 * Busca o user_id da sessão ativa e delega ao logEvent.
 */
export const logEventFromSession = async (payload: Omit<EventPayload, 'user_id'>): Promise<void> => {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    await logEvent({ ...payload, user_id: userId });
  } catch { /* non-blocking */ }
};
