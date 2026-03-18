/**
 * Canal WhatsApp alternativo para alertas de emergência.
 * Usa instância UazAPI separada da instância principal do bot,
 * para que funcione mesmo quando o bot estiver desconectado.
 */
import axios from 'axios';
import { config } from '../config';

function buildAlertApi() {
  return axios.create({
    baseURL: config.alerts.emergencyWaInstanceServer,
    headers: { token: config.alerts.emergencyWaInstanceToken },
    timeout: 8000,
  });
}

export async function sendAlertText(to: string, text: string): Promise<void> {
  if (!config.alerts.emergencyWaInstanceToken || !to) {
    throw new Error('ALERT_WA_INSTANCE_TOKEN ou ALERT_WA_PHONE não configurados');
  }
  const api = buildAlertApi();
  await api.post('/send/text', { number: to, text });
}

/**
 * Inicia uma chamada de voz via UazAPI.
 * O celular do destinatário tocará — ao atender, a chamada fica muda (comportamento do UazAPI).
 * Usado como alerta urgente de desconexão.
 * Fallback: envia texto se a chamada falhar.
 */
export async function sendAlertCall(to: string, fallbackText: string): Promise<void> {
  if (!config.alerts.emergencyWaInstanceToken || !to) {
    throw new Error('ALERT_WA_INSTANCE_TOKEN ou ALERT_WA_PHONE não configurados');
  }

  try {
    const api = buildAlertApi();
    await api.post('/call/make', { number: to });
  } catch (err) {
    console.error('[whatsapp-alert] chamada falhou, enviando texto:', err);
    await sendAlertText(to, fallbackText);
  }
}
