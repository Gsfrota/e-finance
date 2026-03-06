import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';

const mocks = vi.hoisted(() => ({
  tgSendChatAction: vi.fn(),
  waSetInstancePresence: vi.fn(),
  logStructuredMessage: vi.fn(),
}));

vi.mock('../src/channels/telegram', () => ({
  sendChatAction: mocks.tgSendChatAction,
}));

vi.mock('../src/channels/whatsapp', () => ({
  setInstancePresence: mocks.waSetInstancePresence,
}));

vi.mock('../src/observability/logger', () => ({
  logStructuredMessage: mocks.logStructuredMessage,
}));

import { __resetPresenceStateForTests, runWithPresence } from '../src/channels/presence';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  vi.clearAllMocks();
  __resetPresenceStateForTests();

  config.presence.enabled = true;
  config.presence.startDelayMs = 3000;
  config.presence.minVisibleMs = 1000;
  config.presence.telegramPulseMs = 4000;
  config.presence.whatsappUseInstancePresence = true;
  config.presence.whatsappSlowOnly = true;
  config.presence.whatsappSlowThresholdMs = 2500;

  mocks.tgSendChatAction.mockResolvedValue(undefined);
  mocks.waSetInstancePresence.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runWithPresence', () => {
  it('inicia typing no Telegram apos 3s e espera 1s visivel antes de responder', async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);

    const task = runWithPresence(
      { channel: 'telegram', messageId: 'msg-1', chatId: 'chat-1' },
      async () => ({ text: 'ok' }),
      sendReply,
    );

    await vi.advanceTimersByTimeAsync(2999);
    expect(mocks.tgSendChatAction).not.toHaveBeenCalled();
    expect(sendReply).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.tgSendChatAction).toHaveBeenCalledWith('chat-1', 'typing');
    expect(sendReply).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(999);
    expect(sendReply).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await task;

    expect(sendReply).toHaveBeenCalledTimes(1);
  });

  it('nao bloqueia resposta quando iniciar presenca falha', async () => {
    mocks.tgSendChatAction.mockRejectedValueOnce(new Error('telegram down'));
    const sendReply = vi.fn().mockResolvedValue(undefined);

    const task = runWithPresence(
      { channel: 'telegram', messageId: 'msg-2', chatId: 'chat-2' },
      async () => ({ text: 'ok' }),
      sendReply,
    );

    await vi.advanceTimersByTimeAsync(3000);
    await task;

    expect(sendReply).toHaveBeenCalledTimes(1);
  });

  it('whatsapp slow-only nao ativa presenca quando resposta eh rapida', async () => {
    config.presence.whatsappSlowOnly = true;
    config.presence.whatsappSlowThresholdMs = 2500;

    await runWithPresence(
      { channel: 'whatsapp', messageId: 'wa-fast', channelUserId: '5585' },
      async () => ({ text: 'ok' }),
      async () => {},
    );

    expect(mocks.waSetInstancePresence).not.toHaveBeenCalled();
  });

  it('whatsapp slow-only ativa available/unavailable quando ultrapassa threshold', async () => {
    const hold = deferred<void>();

    const task = runWithPresence(
      { channel: 'whatsapp', messageId: 'wa-slow', channelUserId: '5585' },
      async () => {
        await hold.promise;
        return { text: 'ok' };
      },
      async () => {},
    );

    await vi.advanceTimersByTimeAsync(2499);
    expect(mocks.waSetInstancePresence).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.waSetInstancePresence).toHaveBeenCalledWith('available');

    hold.resolve();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(1000);
    await task;

    expect(mocks.waSetInstancePresence.mock.calls.map(call => call[0])).toEqual(['available', 'unavailable']);
  });

  it('controla concorrencia do WhatsApp com available/unavailable uma vez por lote', async () => {
    config.presence.whatsappSlowOnly = false;
    config.presence.startDelayMs = 0;
    config.presence.minVisibleMs = 0;

    const d1 = deferred<void>();
    const d2 = deferred<void>();

    const task1 = runWithPresence(
      { channel: 'whatsapp', messageId: 'wa-1', channelUserId: '5585' },
      async () => {
        await d1.promise;
        return { text: 'ok1' };
      },
      async () => {},
    );

    const task2 = runWithPresence(
      { channel: 'whatsapp', messageId: 'wa-2', channelUserId: '5586' },
      async () => {
        await d2.promise;
        return { text: 'ok2' };
      },
      async () => {},
    );

    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.waSetInstancePresence).toHaveBeenCalledTimes(1);
    expect(mocks.waSetInstancePresence).toHaveBeenCalledWith('available');

    d1.resolve();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.waSetInstancePresence).toHaveBeenCalledTimes(1);

    d2.resolve();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([task1, task2]);

    expect(mocks.waSetInstancePresence).toHaveBeenCalledTimes(2);
    expect(mocks.waSetInstancePresence.mock.calls.map(call => call[0])).toEqual(['available', 'unavailable']);
  });
});
