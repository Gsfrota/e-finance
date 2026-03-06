import { describe, expect, it, vi } from 'vitest';
import { createInboundBuffer } from '../src/utils/inbound-buffer';

vi.mock('../src/observability/logger', () => ({
  logStructuredMessage: vi.fn(),
}));

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('inbound buffer', () => {
  it('agrega 2/3 mensagens dentro da janela com flush por debounce', async () => {
    const received: Array<{ text: string; messageIds: string[] }> = [];

    const buffer = createInboundBuffer({
      enabled: true,
      debounceMs: 40,
      maxWindowMs: 1000,
      maxMessages: 5,
    });

    const onFlush = vi.fn(async message => {
      received.push({ text: message.text, messageIds: message.messageIds });
    });

    await buffer.enqueue({ channel: 'telegram', channelUserId: 'u1', senderName: 'A', messageId: 'm1', text: 'oi' }, onFlush);
    await buffer.enqueue({ channel: 'telegram', channelUserId: 'u1', senderName: 'A', messageId: 'm2', text: 'tudo bom' }, onFlush);
    await buffer.enqueue({ channel: 'telegram', channelUserId: 'u1', senderName: 'A', messageId: 'm3', text: 'preciso de ajuda' }, onFlush);

    await sleep(70);

    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('oi, tudo bom, preciso de ajuda');
    expect(received[0].messageIds).toEqual(['m1', 'm2', 'm3']);
  });

  it('faz bypass de comando e envia em ordem (flush + imediato)', async () => {
    const received: string[] = [];

    const buffer = createInboundBuffer({
      enabled: true,
      debounceMs: 100,
      maxWindowMs: 500,
      maxMessages: 5,
    });

    const onFlush = vi.fn(async message => {
      received.push(message.text);
    });

    await buffer.enqueue({ channel: 'telegram', channelUserId: 'u1', senderName: 'A', messageId: 'm1', text: 'oi' }, onFlush);
    await buffer.enqueue({ channel: 'telegram', channelUserId: 'u1', senderName: 'A', messageId: 'm2', text: '/dashboard' }, onFlush, { bypass: true });

    expect(received).toEqual(['oi', '/dashboard']);
  });

  it('faz flush pelo tempo maximo da janela', async () => {
    const received: string[] = [];

    const buffer = createInboundBuffer({
      enabled: true,
      debounceMs: 500,
      maxWindowMs: 80,
      maxMessages: 5,
    });

    const onFlush = vi.fn(async message => {
      received.push(message.text);
    });

    await buffer.enqueue({ channel: 'telegram', channelUserId: 'u3', senderName: 'C', messageId: 'w1', text: 'primeira' }, onFlush);
    await sleep(50);
    await buffer.enqueue({ channel: 'telegram', channelUserId: 'u3', senderName: 'C', messageId: 'w2', text: 'segunda' }, onFlush);
    await sleep(60);

    expect(received).toEqual(['primeira, segunda']);
  });

  it('faz flush por maxMessages sem esperar debounce', async () => {
    const received: string[] = [];

    const buffer = createInboundBuffer({
      enabled: true,
      debounceMs: 400,
      maxWindowMs: 500,
      maxMessages: 3,
    });

    const onFlush = vi.fn(async message => {
      received.push(message.text);
    });

    await buffer.enqueue({ channel: 'whatsapp', channelUserId: 'u2', senderName: 'B', messageId: 'a1', text: 'um' }, onFlush);
    await buffer.enqueue({ channel: 'whatsapp', channelUserId: 'u2', senderName: 'B', messageId: 'a2', text: 'dois' }, onFlush);
    await buffer.enqueue({ channel: 'whatsapp', channelUserId: 'u2', senderName: 'B', messageId: 'a3', text: 'tres' }, onFlush);

    expect(received).toEqual(['um, dois, tres']);
  });
});
