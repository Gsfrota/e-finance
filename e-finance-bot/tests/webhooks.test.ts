import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handleMessage: vi.fn(),

  waSendText: vi.fn(),
  waDownloadMedia: vi.fn(),
  waConfigureWebhook: vi.fn(),
  waGetInstanceStatus: vi.fn(),

  tgSendText: vi.fn(),
  tgSendChatAction: vi.fn(),
  tgDownloadFileBuffer: vi.fn(),
  tgSetWebhook: vi.fn(),
  tgSetCommands: vi.fn(),
  tgDeleteWebhook: vi.fn(),

  runWithPresence: vi.fn(),
  bufferEnqueue: vi.fn(),
  bufferFlushKey: vi.fn(),
}));

vi.mock('../src/handlers/message-handler', () => ({
  handleMessage: mocks.handleMessage,
}));

vi.mock('../src/channels/whatsapp', () => ({
  extractPhone: (chatid: string) => chatid.replace('@s.whatsapp.net', '').replace('@g.us', '').split(':')[0],
  sendText: mocks.waSendText,
  sendTextWithDelay: mocks.waSendText,
  downloadMedia: mocks.waDownloadMedia,
  configureWebhook: mocks.waConfigureWebhook,
  getInstanceStatus: mocks.waGetInstanceStatus,
  setInstancePresence: vi.fn(),
}));

vi.mock('../src/channels/telegram', () => ({
  sendText: mocks.tgSendText,
  sendChatAction: mocks.tgSendChatAction,
  downloadFileBuffer: mocks.tgDownloadFileBuffer,
  setWebhook: mocks.tgSetWebhook,
  deleteWebhook: mocks.tgDeleteWebhook,
  setCommands: mocks.tgSetCommands,
}));

vi.mock('../src/channels/presence', () => ({
  runWithPresence: mocks.runWithPresence,
}));

vi.mock('../src/utils/inbound-buffer', () => ({
  createInboundBuffer: vi.fn(() => ({
    enqueue: mocks.bufferEnqueue,
    flushKey: mocks.bufferFlushKey,
    resetForTests: vi.fn(),
  })),
}));

let createApp: () => any;
let resetMessageDedupeCache: () => void;

beforeAll(async () => {
  ({ createApp } = await import('../src/index'));
  ({ resetMessageDedupeCache } = await import('../src/utils/message-dedupe'));
});

beforeEach(() => {
  vi.clearAllMocks();
  resetMessageDedupeCache();

  mocks.handleMessage.mockResolvedValue({ text: 'ok' });
  mocks.waDownloadMedia.mockResolvedValue(Buffer.from('audio'));
  mocks.tgDownloadFileBuffer.mockResolvedValue(Buffer.from('file'));
  mocks.tgSendChatAction.mockResolvedValue(undefined);
  mocks.waSendText.mockResolvedValue(undefined);
  mocks.tgSendText.mockResolvedValue(undefined);

  mocks.runWithPresence.mockImplementation(async (_ctx: unknown, work: () => Promise<unknown>, sendReply: (result: any) => Promise<void>) => {
    const result = await work();
    await sendReply(result);
    return result;
  });

  mocks.bufferFlushKey.mockResolvedValue(undefined);
  mocks.bufferEnqueue.mockImplementation(async (message: any, onFlush: (payload: any) => Promise<void>) => {
    await onFlush({
      ...message,
      text: message.text,
      messageIds: [message.messageId],
    });
  });
});

describe('webhooks', () => {
  it('processa pttMessage no WhatsApp', async () => {
    const app = createApp();

    await request(app)
      .post('/webhook/whatsapp')
      .send({
        chatid: '558599999999@s.whatsapp.net',
        text: '',
        messageType: 'pttMessage',
        sender: '558599999999@s.whatsapp.net',
        senderName: 'User',
        fromMe: false,
        messageTimestamp: 123,
        messageid: 'wa-ptt-1',
        owner: 'bot',
        isGroup: false,
      })
      .expect(200);

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(mocks.waDownloadMedia).toHaveBeenCalledWith('wa-ptt-1', '558599999999@s.whatsapp.net');
    expect(mocks.handleMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'wa-ptt-1',
      channel: 'whatsapp',
      audioBuffer: expect.any(Buffer),
      audioKind: 'voice_note',
      audioSizeBytes: expect.any(Number),
    }));
  });

  it('processa audioMessage no WhatsApp', async () => {
    const app = createApp();

    await request(app)
      .post('/webhook/whatsapp')
      .send({
        chatid: '558588888888@s.whatsapp.net',
        text: '',
        messageType: 'audioMessage',
        sender: '558588888888@s.whatsapp.net',
        senderName: 'User',
        fromMe: false,
        messageTimestamp: 124,
        messageid: 'wa-audio-1',
        owner: 'bot',
        isGroup: false,
        mimetype: 'audio/ogg',
        duration: 18,
        fileSize: 2048,
      })
      .expect(200);

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(mocks.handleMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'wa-audio-1',
      channel: 'whatsapp',
      audioMimeType: 'audio/ogg',
      audioDurationSec: 18,
      audioSizeBytes: 2048,
      audioKind: 'audio_file',
    }));
  });

  it('escapa HTML no Telegram e mantem *bold*', async () => {
    const app = createApp();
    mocks.handleMessage.mockResolvedValue({ text: 'Use <script> *ok* & fim' });

    await request(app)
      .post('/webhook/telegram')
      .send({
        update_id: 321,
        message: {
          message_id: 11,
          from: { id: 1, first_name: 'User', is_bot: false },
          chat: { id: 999, type: 'private' },
          date: 123,
          text: 'oi',
        },
      })
      .expect(200);

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(mocks.tgSendText).toHaveBeenCalledWith(
      '999',
      'Use &lt;script&gt; <b>ok</b> &amp; fim',
      'HTML'
    );
  });

  it('processa voice do Telegram', async () => {
    const app = createApp();

    await request(app)
      .post('/webhook/telegram')
      .send({
        update_id: 322,
        message: {
          message_id: 12,
          from: { id: 1, first_name: 'User', is_bot: false },
          chat: { id: 999, type: 'private' },
          date: 123,
          voice: { file_id: 'voice-1', duration: 3, mime_type: 'audio/ogg', file_size: 1000 },
        },
      })
      .expect(200);

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(mocks.tgDownloadFileBuffer).toHaveBeenCalledWith('voice-1');
    expect(mocks.handleMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: '322',
      channel: 'telegram',
      audioMimeType: 'audio/ogg',
      audioBuffer: expect.any(Buffer),
      audioDurationSec: 3,
      audioSizeBytes: 1000,
      audioKind: 'voice_note',
    }));
  });

  it('processa photo do Telegram', async () => {
    const app = createApp();

    await request(app)
      .post('/webhook/telegram')
      .send({
        update_id: 323,
        message: {
          message_id: 13,
          from: { id: 1, first_name: 'User', is_bot: false },
          chat: { id: 999, type: 'private' },
          date: 123,
          photo: [
            { file_id: 'ph-small', file_unique_id: 'u1', width: 100, height: 100 },
            { file_id: 'ph-big', file_unique_id: 'u2', width: 800, height: 800 },
          ],
        },
      })
      .expect(200);

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(mocks.tgDownloadFileBuffer).toHaveBeenCalledWith('ph-big');
    expect(mocks.handleMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: '323',
      channel: 'telegram',
      imageMimeType: 'image/jpeg',
      imageBuffer: expect.any(Buffer),
    }));
  });


  it('agrega texto pelo buffer antes de processar', async () => {
    const app = createApp();

    await request(app)
      .post('/webhook/telegram')
      .send({
        update_id: 990,
        message: {
          message_id: 40,
          from: { id: 1, first_name: 'User', is_bot: false },
          chat: { id: 999, type: 'private' },
          date: 123,
          text: 'oi',
        },
      })
      .expect(200);

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(mocks.bufferEnqueue).toHaveBeenCalled();
    expect(mocks.handleMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: 'oi',
      messageIds: ['990'],
    }));
  });

  it('evita reprocessar update duplicado do Telegram', async () => {
    const app = createApp();

    const payload = {
      update_id: 777,
      message: {
        message_id: 12,
        from: { id: 1, first_name: 'User', is_bot: false },
        chat: { id: 888, type: 'private' },
        date: 123,
        text: 'oi',
      },
    };

    await request(app).post('/webhook/telegram').send(payload).expect(200);
    await request(app).post('/webhook/telegram').send(payload).expect(200);

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(mocks.handleMessage).toHaveBeenCalledTimes(1);
  });
});
