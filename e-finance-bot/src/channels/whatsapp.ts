import axios from 'axios';
import { config } from '../config';

const api = axios.create({
  baseURL: config.uazapi.serverUrl,
  headers: { token: config.uazapi.instanceToken },
});

export interface WaMessage {
  chatid: string;
  text: string;
  messageType: string;
  sender: string;
  senderName: string;
  fromMe: boolean;
  messageTimestamp: number;
  messageid: string;
  owner: string;
  isGroup: boolean;
  // campos de midia
  mediaUrl?: string;
  mimetype?: string;
  fileName?: string;
  duration?: number;
  seconds?: number;
  audioDuration?: number;
  fileSize?: number;
  fileLength?: number;
  size?: number;
}

export type WaPresence = 'available' | 'unavailable';

// Normaliza numero BR de 12 digitos (55 + DDD + 8 digitos) para 13 (insere 9)
function normalizeBrPhone(digits: string): string {
  if (digits.length === 12 && digits.startsWith('55')) {
    return digits.slice(0, 4) + '9' + digits.slice(4);
  }
  return digits;
}

// Extrai numero limpo de qualquer formato (558591318582@s.whatsapp.net ou 5585991318582)
export function extractPhone(chatid: string): string {
  const raw = chatid.replace(/@s\.whatsapp\.net$/, '').replace(/@.*$/, '').split(':')[0];
  const digits = raw.replace(/\D/g, '');
  return normalizeBrPhone(digits);
}

export async function sendText(to: string, text: string): Promise<void> {
  const phone = extractPhone(to);
  await api.post('/send/text', { number: phone, text });
}

export async function sendTextWithDelay(to: string, text: string): Promise<void> {
  const phone = extractPhone(to);
  // UazAPI ja tem msg_delay_min/max configurado (1-3s), entao apenas envia
  await api.post('/send/text', { number: phone, text });
}

export async function setInstancePresence(presence: WaPresence): Promise<void> {
  await api.post('/instance/presence', { presence });
}

export async function downloadMedia(messageid: string, chatid: string): Promise<Buffer | null> {
  try {
    const res = await api.post('/message/download', { messageid, chatid });
    if (res.data?.base64) {
      return Buffer.from(res.data.base64, 'base64');
    }
    return null;
  } catch {
    return null;
  }
}

export async function configureWebhook(webhookUrl: string): Promise<void> {
  await api.post('/webhook', {
    url: webhookUrl,
    enabled: true,
    addUrlEvents: false,
    addUrlTypesMessages: false,
    events: [],
    excludeMessages: [],
  });
}

export async function getInstanceStatus(): Promise<{ connected: boolean; name: string }> {
  const res = await api.get('/instance/status');
  return {
    connected: res.data?.status?.connected ?? false,
    name: res.data?.instance?.profileName || res.data?.instance?.name || 'Desconhecido',
  };
}
