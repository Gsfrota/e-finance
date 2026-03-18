/**
 * Teste manual do PTT de alerta.
 * Uso: npx tsx scripts/test-alert-ptt.ts
 */
import { sendAlertPtt } from '../src/channels/whatsapp-alert';

const TO = process.env.TEST_WA_PHONE || '5585991318582';
const TTS = 'Atenção! Salomão fora do ar! O bot WhatsApp está desconectado. Acesse urgente!';
const FALLBACK = '🔴 *Bot desconectado do WhatsApp*\nTESTE — acesse o painel UazAPI para reconectar.';

// Injetar env vars manualmente para teste local
process.env.ALERT_WA_INSTANCE_TOKEN = process.env.ALERT_WA_INSTANCE_TOKEN || '09e19f9a-7760-418b-89ad-dac7c23601a0';
process.env.UAZAPI_SERVER_URL = process.env.UAZAPI_SERVER_URL || 'https://processai.uazapi.com';

async function main() {
  console.log(`Gerando PTT e enviando para ${TO}...`);
  await sendAlertPtt(TO, TTS, FALLBACK);
  console.log('Enviado!');
}

main().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
