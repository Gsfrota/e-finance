import express, { Express, NextFunction, Request, Response } from 'express';
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
import { handleConnectionEvent } from './alerts/connection-alert';

dns.setDefaultResultOrder('ipv4first');
logStructuredMessage('runtime_network_config', {
  result: 'ipv4first',
});

// --- Validação de env vars no startup ---
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GEMINI_API_KEY',
  'UAZAPI_INSTANCE_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'SETUP_SECRET',
  'TELEGRAM_WEBHOOK_SECRET_TOKEN',
  'UAZAPI_WEBHOOK_SECRET',
] as const;

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

function normalizeBaseUrl(value?: string | null): string {
  return (value || '').trim().replace(/\/+$/, '');
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE || !!process.env.K_REVISION;
}

function resolveWebhookBaseUrl(webhookBaseUrl?: string): string {
  if (isProductionRuntime()) {
    return normalizeBaseUrl(config.bot.baseUrl);
  }

  return normalizeBaseUrl(webhookBaseUrl || config.bot.baseUrl);
}

function buildWhatsAppWebhookUrl(baseUrl: string): string {
  const secret = encodeURIComponent(config.security.whatsappWebhookSecret);
  return `${baseUrl}/webhook/whatsapp/${secret}`;
}

function requireSetupSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = (req.get('x-setup-secret') || '').trim();
  if (!provided || provided !== config.security.setupSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

function requireTelegramWebhookSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = (req.get('x-telegram-bot-api-secret-token') || '').trim();
  if (!provided || provided !== config.security.telegramWebhookSecretToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

function requireWhatsAppWebhookSecret(req: Request, res: Response, next: NextFunction): void {
  const providedHeader = (req.get('x-uazapi-webhook-secret') || req.get('x-webhook-secret') || '').trim();
  const providedPath = (req.params.secret || '').trim();
  const expected = config.security.whatsappWebhookSecret;

  if ((providedHeader && providedHeader === expected) || (providedPath && providedPath === expected)) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
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
  const webhookJson = express.json({ limit: '10mb' });
  const setupJson = express.json({ limit: '256kb' });

  const inboundBuffer = createInboundBuffer();

  app.get('/', (_req, res) => {
    res.json({ status: 'ok', service: 'e-finance-bot', version: '1.0.0' });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy' });
  });

  app.use('/scheduler', schedulerRouter);

  app.post('/webhook/whatsapp/:secret?', requireWhatsAppWebhookSecret, webhookJson, async (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Payload inválido' });
    }

    res.sendStatus(200);

    try {
      // Detectar connection events (estrutura diferente de message events)
      const rawEvent = req.body as Record<string, unknown>;
      const eventType = (rawEvent.EventType ?? rawEvent.eventType ?? rawEvent.event) as string | undefined;
      if (eventType === 'connection' || (!rawEvent.message && rawEvent.status && !rawEvent.sender)) {
        void handleConnectionEvent(rawEvent);
        return;
      }

      // Suporta dois formatos de payload da UazAPI:
      // 1. Formato aninhado real: { EventType, message: { fromMe, text, sender_pn, ... }, chat: {...} }
      // 2. Formato flat (testes sintéticos): { fromMe, text, sender, ... }
      const raw = req.body as Record<string, unknown>;
      const body: wa.WaMessage = (raw.message && typeof raw.message === 'object')
        ? (() => {
            const msg = raw.message as Record<string, unknown>;
            const chat = (raw.chat ?? {}) as Record<string, unknown>;
            const content = ((msg.content && typeof msg.content === 'object')
              ? msg.content
              : {}) as Record<string, unknown>;
            return {
              chatid: (msg.chatid ?? msg.sender_pn ?? '') as string,
              text: (msg.text ?? content.text ?? '') as string,
              messageType: (msg.messageType ?? msg.type ?? content.type ?? '') as string,
              sender: (msg.sender_pn ?? msg.chatid ?? '') as string,
              senderName: (msg.senderName ?? chat.name ?? 'Usuário') as string,
              fromMe: Boolean(msg.fromMe),
              messageTimestamp: typeof msg.messageTimestamp === 'number'
                ? msg.messageTimestamp
                : parseInt(String(msg.messageTimestamp ?? '0'), 10),
              messageid: (msg.messageid ?? '') as string,
              owner: (msg.owner ?? '') as string,
              isGroup: Boolean(msg.isGroup),
              mimetype: (msg.mimetype ?? content.mimetype ?? content.mimeType) as string | undefined,
              duration: typeof (msg.duration ?? content.duration) === 'number' ? Number(msg.duration ?? content.duration) : undefined,
              seconds: typeof (msg.seconds ?? content.seconds) === 'number' ? Number(msg.seconds ?? content.seconds) : undefined,
              audioDuration: typeof (msg.audioDuration ?? content.audioDuration) === 'number' ? Number(msg.audioDuration ?? content.audioDuration) : undefined,
              fileSize: typeof (msg.fileSize ?? content.fileSize) === 'number' ? Number(msg.fileSize ?? content.fileSize) : undefined,
              fileLength: typeof (msg.fileLength ?? content.fileLength) === 'number' ? Number(msg.fileLength ?? content.fileLength) : undefined,
              size: typeof (msg.size ?? content.size) === 'number' ? Number(msg.size ?? content.size) : undefined,
            } as wa.WaMessage;
          })()
        : raw as unknown as wa.WaMessage;

      const normalizedMessageType = String(body.messageType || '').toLowerCase();
      const isAudioMessage = ['audiomessage', 'pttmessage', 'audio', 'myaudio', 'ptt'].includes(normalizedMessageType);
      const isImageMessage = ['imagemessage', 'image'].includes(normalizedMessageType);

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
          audioKind = ['pttmessage', 'ptt'].includes(normalizedMessageType) ? 'voice_note' : 'audio_file';
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

  app.post('/webhook/telegram', requireTelegramWebhookSecret, webhookJson, async (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Payload inválido' });
    }

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

  app.post('/setup', requireSetupSecret, setupJson, async (req, res) => {
    const { webhookBaseUrl } = req.body as { webhookBaseUrl?: string };
    const baseUrl = resolveWebhookBaseUrl(webhookBaseUrl);

    if (!baseUrl) {
      return res.status(400).json({ error: 'BOT_BASE_URL obrigatório' });
    }

    const results: Record<string, string> = {};

    try {
      await wa.configureWebhook(buildWhatsAppWebhookUrl(baseUrl));
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

    const hasErrors = Object.values(results).some(value => value !== 'ok');
    if (hasErrors) {
      return res.status(502).json({ status: 'error', results });
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
    console.log('  POST /webhook/whatsapp/:secret?');
    console.log('  POST /webhook/telegram');
    console.log('  POST /setup  (configurar webhooks)');
  });
}
