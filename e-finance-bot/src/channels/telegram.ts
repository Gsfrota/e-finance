import axios from 'axios';
import { config } from '../config';

const api = axios.create({ baseURL: config.telegram.apiBase });

export interface TgMessage {
  message_id: number;
  from: { id: number; first_name: string; username?: string; is_bot: boolean };
  chat: { id: number; type: string; first_name?: string; username?: string };
  date: number;
  text?: string;
  voice?: { file_id: string; duration: number; mime_type: string; file_size: number };
  audio?: { file_id: string; duration: number; mime_type: string; file_size: number };
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number }>;
  document?: { file_id: string; file_name: string; mime_type: string };
  caption?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export async function sendText(chatId: number | string, text: string, parseMode?: 'HTML' | 'Markdown'): Promise<void> {
  await api.post('/sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
  });
}

export async function sendChatAction(chatId: number | string, action: string): Promise<void> {
  await api.post('/sendChatAction', { chat_id: chatId, action }).catch(() => {});
}

export async function downloadFileBuffer(fileId: string): Promise<Buffer | null> {
  try {
    const res = await api.get(`/getFile?file_id=${fileId}`);
    const filePath = res.data?.result?.file_path;
    if (!filePath) return null;
    const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;
    const fileRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    return Buffer.from(fileRes.data);
  } catch {
    return null;
  }
}

export async function setWebhook(webhookUrl: string): Promise<void> {
  await api.post('/setWebhook', {
    url: webhookUrl,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
}

export async function deleteWebhook(): Promise<void> {
  await api.post('/deleteWebhook', { drop_pending_updates: true });
}

export async function setCommands(): Promise<void> {
  await api.post('/setMyCommands', {
    commands: [
      { command: 'start', description: 'Iniciar o assistente e-finance' },
      { command: 'ajuda', description: 'Ver comandos disponíveis' },
      { command: 'dashboard', description: 'Resumo do dashboard' },
      { command: 'recebiveis', description: 'Parcelas a receber' },
      { command: 'contrato', description: 'Criar novo contrato' },
    ],
  });
}
