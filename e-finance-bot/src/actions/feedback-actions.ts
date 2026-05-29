import { config } from '../config';
import { getSupabaseClient } from '../infra/runtime-clients';
import { logStructuredMessage } from '../observability/logger';
import * as wa from '../channels/whatsapp';

function db() {
  return getSupabaseClient();
}

export interface FeedbackInput {
  tenantId: string | null;
  profileId: string | null;
  channel: 'whatsapp' | 'telegram';
  channelUserId: string;
  senderName: string | null;
  senderPhone: string | null;
  messageText: string;
}

export interface FeedbackResult {
  recorded: boolean;
  forwarded: boolean;
}

/** Busca o nome do tenant (best-effort) para enriquecer a mensagem ao suporte. */
async function getTenantName(tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  const { data } = await db().from('tenants').select('name').eq('id', tenantId).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

function buildSupportMessage(input: FeedbackInput, tenantName: string | null): string {
  const when = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
  const linhas = [
    '⚠️ *Feedback/Reclamação recebida pelo bot*',
    '',
    `*De:* ${input.senderName || 'Cliente'} (${input.senderPhone || input.channelUserId})`,
    `*Empresa:* ${tenantName || input.tenantId || '—'}`,
    `*Canal:* ${input.channel}`,
    `*Quando:* ${when}`,
    '',
    `*Mensagem:*`,
    input.messageText,
  ];
  return linhas.join('\n');
}

/**
 * Registra o feedback e encaminha ao suporte.
 *
 * Garantia (auditoria): o registro em bot_feedback é persistido SEMPRE, mesmo
 * que o encaminhamento ao suporte falhe (forwarded_ok=false) — assim nenhuma
 * reclamação se perde. A confirmação ao cliente (a cargo do chamador) não
 * depende do sucesso do envio.
 */
export async function recordAndForwardFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  const supportPhone = config.support.forwardPhone;
  const tenantName = await getTenantName(input.tenantId);

  // 1) Encaminhar ao suporte (best-effort — falha não bloqueia o registro).
  let forwarded = false;
  if (supportPhone) {
    try {
      await wa.sendText(supportPhone, buildSupportMessage(input, tenantName));
      forwarded = true;
    } catch (err) {
      logStructuredMessage('feedback_forward_failed', {
        channel: input.channel,
        result: 'error',
        reason: 'support_forward_failed',
        tenantId: input.tenantId ?? undefined,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logStructuredMessage('feedback_forward_skipped', {
      channel: input.channel,
      result: 'error',
      reason: 'support_phone_unconfigured',
      tenantId: input.tenantId ?? undefined,
    });
  }

  // 2) Persistir SEMPRE (mesmo com forwarded=false).
  let recorded = false;
  const { error } = await db().from('bot_feedback').insert({
    tenant_id: input.tenantId,
    profile_id: input.profileId,
    channel: input.channel,
    channel_user_id: input.channelUserId,
    sender_name: input.senderName,
    sender_phone: input.senderPhone,
    message_text: input.messageText,
    forwarded_to: supportPhone || null,
    forwarded_ok: forwarded,
  });

  if (error) {
    logStructuredMessage('feedback_persist_failed', {
      channel: input.channel,
      result: 'error',
      reason: 'bot_feedback_insert_failed',
      tenantId: input.tenantId ?? undefined,
      error: error.message,
    });
  } else {
    recorded = true;
  }

  return { recorded, forwarded };
}
