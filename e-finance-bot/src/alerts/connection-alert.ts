/**
 * Alertas de desconexão UazAPI.
 *
 * Detecta eventos `connection` enviados pelo UazAPI e dispara notificações
 * para admins de todos os tenants via Telegram (prioridade) e WhatsApp (fallback).
 *
 * Cooldown in-memory de 5 min por instância para evitar flood.
 */
import { config } from '../config';
import { getSupabaseClient } from '../infra/runtime-clients';
import { getAdminProfiles, dispatchBriefing } from '../scheduler/morning-briefing';
import { sendAlertText, sendAlertCall } from '../channels/whatsapp-alert';
import * as tg from '../channels/telegram';
import { logStructuredMessage } from '../observability/logger';

// ---------------------------------------------------------------------------
// Tipos de payload UazAPI para eventos de conexão
// ---------------------------------------------------------------------------

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

const DISCONNECTED_STATUSES = ['disconnected', 'close', 'closed', 'logout', 'banned'];
const CONNECTED_STATUSES = ['connected', 'open', 'ready'];

function normalizeConnectionStatus(raw: Record<string, unknown>): ConnectionStatus | null {
  // Formato A: { EventType: 'connection', status: 'disconnected', owner: '...' }
  const status = (raw.status ?? raw.state ?? '') as string;
  // Formato B: { EventType: 'connection', data: { state: 'close' }, owner: '...' }
  const dataState = (raw.data && typeof raw.data === 'object')
    ? ((raw.data as Record<string, unknown>).state ?? '') as string
    : '';

  const value = (status || dataState).toLowerCase().trim();
  if (!value) return null;

  if (DISCONNECTED_STATUSES.includes(value)) return 'disconnected';
  if (CONNECTED_STATUSES.includes(value)) return 'connected';
  return 'connecting';
}

// ---------------------------------------------------------------------------
// Cooldown in-memory por instância
// ---------------------------------------------------------------------------

const cooldownMap = new Map<string, number>();

function isOnCooldown(owner: string, statusKey: string): boolean {
  const key = `${owner}:${statusKey}`;
  const last = cooldownMap.get(key) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < config.alerts.connectionCooldownMs) return true;
  cooldownMap.set(key, Date.now());
  return false;
}

// ---------------------------------------------------------------------------
// Mensagens de alerta
// ---------------------------------------------------------------------------

function formatTime(): string {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return brt.toTimeString().slice(0, 5);
}

function buildAlertMessage(status: ConnectionStatus, owner: string): string {
  const time = formatTime();
  if (status === 'disconnected') {
    return `🔴 *Bot desconectado do WhatsApp*\nInstância: ${owner}\nHorário: ${time}\n\nAcesse o painel UazAPI para reconectar.`;
  }
  if (status === 'connected') {
    return `✅ *Bot reconectado ao WhatsApp*\nInstância: ${owner}\nHorário: ${time}`;
  }
  return `⚠️ *Bot reconectando ao WhatsApp...*\nInstância: ${owner}\nHorário: ${time}`;
}

// ---------------------------------------------------------------------------
// Despacho para admins de todos os tenants
// ---------------------------------------------------------------------------

async function getAllActiveTenantIds(): Promise<string[]> {
  const { data, error } = await getSupabaseClient()
    .from('bot_tenant_configs')
    .select('tenant_id')
    .eq('active', true);

  if (error) {
    throw new Error(`Erro ao buscar tenants: ${error.message}`);
  }

  const ids = [...new Set((data ?? []).map((r: { tenant_id: string }) => r.tenant_id))];
  return ids;
}

async function dispatchToAllAdmins(message: string, status: ConnectionStatus): Promise<void> {
  const tenantIds = await getAllActiveTenantIds();

  for (const tenantId of tenantIds) {
    const profiles = await getAdminProfiles(tenantId);
    for (const profile of profiles) {
      // Telegram + WhatsApp texto via dispatchBriefing
      await dispatchBriefing(profile, message);

      // Chamada de voz urgente apenas na desconexão, via instância alternativa
      if (status === 'disconnected' && profile.whatsapp_phone && config.alerts.emergencyWaInstanceToken) {
        void sendAlertCall(profile.whatsapp_phone, message).catch(err =>
          console.error('[connection-alert] chamada falhou para', profile.id, err)
        );
      }
    }
  }

  // Ligar para números extras configurados em ALERT_WA_EXTRA_PHONES
  if (status === 'disconnected' && config.alerts.emergencyWaInstanceToken) {
    for (const phone of config.alerts.extraAlertPhones) {
      void sendAlertCall(phone, message).catch(err =>
        console.error('[connection-alert] chamada extra falhou para', phone, err)
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fallback de emergência (sem Supabase)
// ---------------------------------------------------------------------------

async function dispatchEmergencyFallback(message: string): Promise<void> {
  const errors: string[] = [];

  // Fallback 1: Telegram chat_id configurado via env
  if (config.alerts.emergencyTelegramChatId) {
    try {
      const htmlMsg = message
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*([^*]+)\*/g, '<b>$1</b>');
      await tg.sendText(config.alerts.emergencyTelegramChatId, htmlMsg, 'HTML');
    } catch (err) {
      errors.push(`telegram_fallback: ${err}`);
    }
  }

  // Fallback 2: WhatsApp via instância alternativa
  if (config.alerts.emergencyWaPhone && config.alerts.emergencyWaInstanceToken) {
    try {
      await sendAlertText(config.alerts.emergencyWaPhone, message);
    } catch (err) {
      errors.push(`wa_fallback: ${err}`);
    }
  }

  if (errors.length > 0) {
    console.error('[connection-alert] erros no fallback de emergência:', errors.join(' | '));
  }
}

// ---------------------------------------------------------------------------
// Handler principal — chamado pelo webhook /webhook/whatsapp
// ---------------------------------------------------------------------------

export async function handleConnectionEvent(raw: Record<string, unknown>): Promise<void> {
  const owner = (raw.owner ?? '') as string;
  const status = normalizeConnectionStatus(raw);

  logStructuredMessage('wa_connection_event', {
    owner,
    result: status ?? 'unknown',
    reason: JSON.stringify({ rawStatus: raw.status, rawDataState: (raw.data as Record<string, unknown>)?.state }),
  });

  if (!status || status === 'connecting') {
    // Não alertar para status de reconexão intermediária (apenas logar)
    return;
  }

  if (isOnCooldown(owner, status)) {
    logStructuredMessage('wa_connection_alert_skipped', { owner, result: status, reason: 'cooldown' });
    return;
  }

  const message = buildAlertMessage(status, owner);

  try {
    await dispatchToAllAdmins(message, status);
    logStructuredMessage('wa_connection_alert_sent', { owner, result: status });
  } catch (err) {
    console.error('[connection-alert] falha ao buscar admins, usando fallback:', err);
    logStructuredMessage('wa_connection_alert_fallback', { owner, result: status, error: String(err) });
    await dispatchEmergencyFallback(message);
  }
}
