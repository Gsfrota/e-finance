import express, { Express } from 'express';
import dns from 'node:dns';
import { config } from './config';
import { handleMessage, IncomingMessage } from './handlers/message-handler';
import * as wa from './channels/whatsapp';
import * as tg from './channels/telegram';
import { router as schedulerRouter } from './scheduler/briefing-router';
import { downloadMedia } from './channels/whatsapp';
import { downloadFileBuffer } from './channels/telegram';
import { runWithPresence } from './channels/presence';
import { isDuplicateMessage } from './utils/message-dedupe';
import { createInboundBuffer } from './utils/inbound-buffer';
import { logStructuredMessage } from './observability/logger';

dns.setDefaultResultOrder('ipv4first');
logStructuredMessage('runtime_network_config', {
  result: 'ipv4first',
});

// --- Validação de env vars no startup ---
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY'] as const;

function validateEnv(): void {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[startup] FATAL: missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// --- Rate limiting por usuário (janela deslizante em memória) ---
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const windowMs = config.rateLimit.windowMs;
  const entry = rateLimitMap.get(userId) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > windowMs) {
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  rateLimitMap.set(userId, entry);
  return entry.count > config.rateLimit.maxPerWindow;
}

setInterval(() => {
  const cutoff = Date.now() - config.rateLimit.windowMs * 2;
  for (const [k, v] of rateLimitMap) {
    if (v.windowStart < cutoff) rateLimitMap.delete(k);
  }
}, 60_000);

function toTelegramHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped.replace(/\*([^*]+)\*/g, '<b>$1</b>');
}

function toOptionalPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function shouldBypassInboundBuffer(text?: string): boolean {
  const normalized = (text || '').trim();
  if (!normalized) return true;

  if (/^\//.test(normalized)) return true;
  if (/^(sim|s|n[aã]o|nao|cancelar|cancela|mostrar(\s+mais)?|\d{1,2})$/i.test(normalized)) return true;

  return false;
}

async function processWithPresence(message: IncomingMessage, sendReply: (text: string) => Promise<void>) {
  await runWithPresence(
    {
      channel: message.channel,
      messageId: message.messageId,
      chatId: message.channel === 'telegram' ? message.channelUserId : undefined,
      channelUserId: message.channelUserId,
    },
    async () => handleMessage(message),
    async result => {
      if (result.text.trim()) {
        await sendReply(result.text);
      }
    }
  );
}

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const inboundBuffer = createInboundBuffer();

  app.get('/', (_req, res) => {
    res.json({ status: 'ok', service: 'e-finance-bot', version: '1.0.0' });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy' });
  });

  app.use('/scheduler', schedulerRouter);

  app.post('/webhook/whatsapp', async (req, res) => {
    res.sendStatus(200);

    try {
      // Suporta dois formatos de payload da UazAPI:
      // 1. Formato aninhado real: { EventType, message: { fromMe, text, sender_pn, ... }, chat: {...} }
      // 2. Formato flat (testes sintéticos): { fromMe, text, sender, ... }
      const raw = req.body as Record<string, unknown>;
      const body: wa.WaMessage = (raw.message && typeof raw.message === 'object')
        ? (() => {
            const msg = raw.message as Record<string, unknown>;
            const chat = (raw.chat ?? {}) as Record<string, unknown>;
            return {
              chatid: (msg.chatid ?? msg.sender_pn ?? '') as string,
              text: (msg.text ?? (msg.content as Record<string,unknown>)?.text ?? '') as string,
              messageType: (msg.messageType ?? '') as string,
              sender: (msg.sender_pn ?? msg.chatid ?? '') as string,
              senderName: (msg.senderName ?? chat.name ?? 'Usuário') as string,
              fromMe: Boolean(msg.fromMe),
              messageTimestamp: typeof msg.messageTimestamp === 'number'
                ? msg.messageTimestamp
                : parseInt(String(msg.messageTimestamp ?? '0'), 10),
              messageid: (msg.messageid ?? '') as string,
              owner: (msg.owner ?? '') as string,
              isGroup: Boolean(msg.isGroup),
              mimetype: msg.mimetype as string | undefined,
              duration: typeof msg.duration === 'number' ? msg.duration : undefined,
              seconds: typeof msg.seconds === 'number' ? msg.seconds : undefined,
              audioDuration: typeof msg.audioDuration === 'number' ? msg.audioDuration : undefined,
              fileSize: typeof msg.fileSize === 'number' ? msg.fileSize : undefined,
              fileLength: typeof msg.fileLength === 'number' ? msg.fileLength : undefined,
              size: typeof msg.size === 'number' ? msg.size : undefined,
            } as wa.WaMessage;
          })()
        : raw as unknown as wa.WaMessage;

      const isAudioMessage = body.messageType === 'audioMessage' || body.messageType === 'pttMessage';
      const isImageMessage = body.messageType === 'imageMessage';

      if (body.fromMe || body.isGroup || !body.sender) return;
      if (!body.text && !isAudioMessage && !isImageMessage) return;

      const messageId = body.messageid || `${body.chatid}:${body.messageTimestamp}`;
      if (isDuplicateMessage('whatsapp', messageId)) return;

      const channelUserId = wa.extractPhone(body.sender);
      const senderName = body.senderName || 'Usuário';

      if (isRateLimited(`whatsapp:${channelUserId}`)) {
        logStructuredMessage('rate_limit_hit', { channel: 'whatsapp', channelUserId });
        return;
      }

      if (!isAudioMessage && !isImageMessage && body.text?.trim()) {
        void inboundBuffer.enqueue(
          {
            channel: 'whatsapp',
            channelUserId,
            senderName,
            messageId,
            text: body.text,
          },
          async buffered => {
            await processWithPresence(
              {
                messageId: buffered.messageId,
                messageIds: buffered.messageIds,
                channel: 'whatsapp',
                channelUserId,
                senderName,
                text: buffered.text,
              },
              async text => wa.sendText(channelUserId, text),
            );
          },
          { bypass: shouldBypassInboundBuffer(body.text) }
        ).catch(err => {
          console.error('[WA buffer enqueue error]', err);
        });
        return;
      }

      await inboundBuffer.flushKey('whatsapp', channelUserId, 'media_bypass');

      let audioBuffer: Buffer | undefined;
      let audioMimeType: string | undefined;
      let audioDurationSec: number | undefined;
      let audioSizeBytes: number | undefined;
      let audioKind: 'voice_note' | 'audio_file' | undefined;
      let imageBuffer: Buffer | undefined;
      let imageMimeType: string | undefined;

      if (isAudioMessage) {
        const buf = await downloadMedia(body.messageid, body.chatid);
        if (buf) {
          if (buf.length > config.media.maxAudioBytes) {
            logStructuredMessage('media_size_exceeded', { type: 'audio', size: buf.length, channelUserId, channel: 'whatsapp' });
            await wa.sendText(channelUserId, 'Áudio muito grande. Por favor, envie arquivos de no máximo 10 MB.');
            return;
          }
          audioBuffer = buf;
          audioMimeType = body.mimetype || 'audio/ogg';
          audioDurationSec = toOptionalPositiveNumber(
            body.duration ?? body.seconds ?? body.audioDuration
          );
          audioSizeBytes = toOptionalPositiveNumber(
            body.fileSize ?? body.fileLength ?? body.size
          ) || buf.length;
          audioKind = body.messageType === 'pttMessage' ? 'voice_note' : 'audio_file';
        }
      } else if (isImageMessage) {
        const buf = await downloadMedia(body.messageid, body.chatid);
        if (buf) {
          if (buf.length > config.media.maxImageBytes) {
            logStructuredMessage('media_size_exceeded', { type: 'image', size: buf.length, channelUserId, channel: 'whatsapp' });
            await wa.sendText(channelUserId, 'Imagem muito grande. Por favor, envie imagens de no máximo 5 MB.');
            return;
          }
          imageBuffer = buf;
          imageMimeType = body.mimetype || 'image/jpeg';
        }
      }

      await processWithPresence(
        {
          messageId,
          channel: 'whatsapp',
          channelUserId,
          senderName,
          text: body.text,
          audioBuffer,
          audioMimeType,
          audioDurationSec,
          audioSizeBytes,
          audioKind,
          imageBuffer,
          imageMimeType,
        },
        async text => wa.sendText(channelUserId, text),
      );
    } catch (err) {
      console.error('[WA webhook error]', err);
    }
  });

  app.post('/webhook/telegram', async (req, res) => {
    res.sendStatus(200);

    try {
      const update = req.body as { update_id: number; message?: import('./channels/telegram').TgMessage };
      const msg = update.message;
      if (!msg) return;

      const messageId = String(update.update_id || msg.message_id);
      if (isDuplicateMessage('telegram', messageId)) return;

      const chatId = String(msg.chat.id);
      const senderName = msg.from?.first_name || 'Usuário';

      if (isRateLimited(`telegram:${chatId}`)) {
        logStructuredMessage('rate_limit_hit', { channel: 'telegram', channelUserId: chatId });
        return;
      }

      const isAudioMessage = !!(msg.voice || msg.audio);
      const isImageMessage = !!msg.photo;

      if (!isAudioMessage && !isImageMessage && msg.text?.trim()) {
        void inboundBuffer.enqueue(
          {
            channel: 'telegram',
            channelUserId: chatId,
            senderName,
            messageId,
            text: msg.text,
          },
          async buffered => {
            await processWithPresence(
              {
                messageId: buffered.messageId,
                messageIds: buffered.messageIds,
                channel: 'telegram',
                channelUserId: chatId,
                senderName,
                text: buffered.text,
              },
              async text => {
                const htmlText = toTelegramHtml(text);
                await tg.sendText(chatId, htmlText, 'HTML');
              },
            );
          },
          { bypass: shouldBypassInboundBuffer(msg.text) }
        ).catch(err => {
          console.error('[TG buffer enqueue error]', err);
        });
        return;
      }

      await inboundBuffer.flushKey('telegram', chatId, 'media_bypass');

      let audioBuffer: Buffer | undefined;
      let audioMimeType: string | undefined;
      let audioDurationSec: number | undefined;
      let audioSizeBytes: number | undefined;
      let audioKind: 'voice_note' | 'audio_file' | undefined;
      let imageBuffer: Buffer | undefined;
      let imageMimeType: string | undefined;

      if (msg.voice || msg.audio) {
        const fileId = msg.voice?.file_id || msg.audio?.file_id;
        if (fileId) {
          const buf = await downloadFileBuffer(fileId);
          if (buf) {
            if (buf.length > config.media.maxAudioBytes) {
              logStructuredMessage('media_size_exceeded', { type: 'audio', size: buf.length, channelUserId: chatId, channel: 'telegram' });
              await tg.sendText(chatId, 'Áudio muito grande. Por favor, envie arquivos de no máximo 10 MB.', 'HTML');
              return;
            }
            audioBuffer = buf;
            audioMimeType = msg.voice?.mime_type || msg.audio?.mime_type || 'audio/ogg';
            audioDurationSec = msg.voice?.duration || msg.audio?.duration;
            audioSizeBytes = msg.voice?.file_size || msg.audio?.file_size || buf.length;
            audioKind = msg.voice ? 'voice_note' : 'audio_file';
          }
        }
      } else if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        const buf = await downloadFileBuffer(photo.file_id);
        if (buf) {
          if (buf.length > config.media.maxImageBytes) {
            logStructuredMessage('media_size_exceeded', { type: 'image', size: buf.length, channelUserId: chatId, channel: 'telegram' });
            await tg.sendText(chatId, 'Imagem muito grande. Por favor, envie imagens de no máximo 5 MB.', 'HTML');
            return;
          }
          imageBuffer = buf;
          imageMimeType = 'image/jpeg';
        }
      }

      await processWithPresence(
        {
          messageId,
          channel: 'telegram',
          channelUserId: chatId,
          senderName,
          text: msg.text || msg.caption,
          audioBuffer,
          audioMimeType,
          audioDurationSec,
          audioSizeBytes,
          audioKind,
          imageBuffer,
          imageMimeType,
        },
        async text => {
          const htmlText = toTelegramHtml(text);
          await tg.sendText(chatId, htmlText, 'HTML');
        },
      );
    } catch (err) {
      console.error('[TG webhook error]', err);
    }
  });

  app.post('/setup', async (req, res) => {
    const { webhookBaseUrl } = req.body as { webhookBaseUrl?: string };
    const baseUrl = webhookBaseUrl || process.env.BOT_BASE_URL || '';

    if (!baseUrl) {
      return res.status(400).json({ error: 'webhookBaseUrl obrigatório' });
    }

    const results: Record<string, string> = {};

    try {
      await wa.configureWebhook(`${baseUrl}/webhook/whatsapp`);
      results.whatsapp = 'ok';
    } catch (e) {
      results.whatsapp = `error: ${e}`;
    }

    try {
      await tg.setWebhook(`${baseUrl}/webhook/telegram`);
      await tg.setCommands();
      results.telegram = 'ok';
    } catch (e) {
      results.telegram = `error: ${e}`;
    }

    res.json({ status: 'done', results });
  });

  return app;
}

if (require.main === module) {
  validateEnv();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`e-finance-bot rodando na porta ${config.port}`);
    console.log('Endpoints:');
    console.log('  POST /webhook/whatsapp');
    console.log('  POST /webhook/telegram');
    console.log('  POST /setup  (configurar webhooks)');
  });
}
