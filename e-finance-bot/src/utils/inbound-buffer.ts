import { config } from '../config';
import { logStructuredMessage } from '../observability/logger';

export interface InboundBufferMessage {
  channel: 'whatsapp' | 'telegram';
  channelUserId: string;
  senderName: string;
  messageId: string;
  text: string;
}

export interface BufferedDispatchMessage extends InboundBufferMessage {
  messageIds: string[];
}

export interface InboundBufferConfig {
  enabled: boolean;
  debounceMs: number;
  maxWindowMs: number;
  maxMessages: number;
}

type FlushReason =
  | 'debounce'
  | 'max_window'
  | 'max_messages'
  | 'manual_flush'
  | 'bypass_flush'
  | 'bypass_immediate'
  | 'media_bypass';

type FlushHandler = (message: BufferedDispatchMessage) => Promise<void>;

interface BufferedItem {
  message: InboundBufferMessage;
  receivedAt: number;
}

interface BufferState {
  key: string;
  items: BufferedItem[];
  firstAt: number;
  debounceTimer: NodeJS.Timeout | null;
  maxWindowTimer: NodeJS.Timeout | null;
  chain: Promise<void>;
  onFlush: FlushHandler | null;
}

interface EnqueueOptions {
  bypass?: boolean;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function resolveConfig(custom?: Partial<InboundBufferConfig>): InboundBufferConfig {
  return {
    enabled: custom?.enabled ?? config.inboundBuffer.enabled,
    debounceMs: Math.max(1, custom?.debounceMs ?? config.inboundBuffer.debounceMs),
    maxWindowMs: Math.max(1, custom?.maxWindowMs ?? config.inboundBuffer.maxWindowMs),
    maxMessages: Math.max(1, custom?.maxMessages ?? config.inboundBuffer.maxMessages),
  };
}

function buildKey(channel: 'whatsapp' | 'telegram', channelUserId: string): string {
  return `${channel}:${channelUserId}`;
}

export function createInboundBuffer(custom?: Partial<InboundBufferConfig>) {
  const settings = resolveConfig(custom);
  const states = new Map<string, BufferState>();

  function ensureState(key: string): BufferState {
    const existing = states.get(key);
    if (existing) return existing;

    const state: BufferState = {
      key,
      items: [],
      firstAt: 0,
      debounceTimer: null,
      maxWindowTimer: null,
      chain: Promise.resolve(),
      onFlush: null,
    };

    states.set(key, state);
    return state;
  }

  function clearTimers(state: BufferState): void {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }

    if (state.maxWindowTimer) {
      clearTimeout(state.maxWindowTimer);
      state.maxWindowTimer = null;
    }
  }

  function cleanupState(state: BufferState): void {
    if (state.items.length > 0) return;
    if (state.debounceTimer || state.maxWindowTimer) return;
    states.delete(state.key);
  }

  function runSerialized(state: BufferState, task: () => Promise<void>): Promise<void> {
    state.chain = state.chain
      .catch(() => undefined)
      .then(task)
      .catch(error => {
        logStructuredMessage('inbound_buffer_flushed', {
          channel: state.items[0]?.message.channel,
          messageId: state.items[state.items.length - 1]?.message.messageId,
          result: 'error',
          reason: 'inbound_buffer_unhandled_error',
          error: normalizeError(error),
        });
      });

    return state.chain;
  }

  async function dispatchItems(
    state: BufferState,
    handler: FlushHandler,
    reason: FlushReason,
  ): Promise<void> {
    if (state.items.length === 0) {
      clearTimers(state);
      cleanupState(state);
      return;
    }

    const items = state.items.slice();
    state.items = [];
    clearTimers(state);

    const text = items
      .map(item => item.message.text.trim())
      .filter(Boolean)
      .join(', ');

    const first = items[0];
    const last = items[items.length - 1];
    const bufferWindowMs = Math.max(0, last.receivedAt - first.receivedAt);
    const messageIds = items.map(item => item.message.messageId);

    logStructuredMessage('inbound_buffer_flushed', {
      channel: last.message.channel,
      messageId: last.message.messageId,
      bufferedCount: items.length,
      bufferWindowMs,
      result: 'flushed',
      reason,
    });

    const dispatchMessage: BufferedDispatchMessage = {
      ...last.message,
      text,
      messageIds,
      messageId: last.message.messageId,
    };

    try {
      await handler(dispatchMessage);
    } catch (error) {
      logStructuredMessage('inbound_buffer_flushed', {
        channel: last.message.channel,
        messageId: last.message.messageId,
        bufferedCount: items.length,
        bufferWindowMs,
        result: 'error',
        reason: 'dispatch_failed',
        error: normalizeError(error),
      });
    } finally {
      cleanupState(state);
    }
  }

  function scheduleTimers(state: BufferState): void {
    if (!state.items[0]) return;

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }

    state.debounceTimer = setTimeout(() => {
      void runSerialized(state, async () => {
        const handler = state.onFlush;
        if (!handler) return;
        await dispatchItems(state, handler, 'debounce');
      });
    }, settings.debounceMs);

    if (!state.maxWindowTimer) {
      const elapsed = Date.now() - state.firstAt;
      const timeoutMs = Math.max(0, settings.maxWindowMs - elapsed);
      state.maxWindowTimer = setTimeout(() => {
        void runSerialized(state, async () => {
          const handler = state.onFlush;
          if (!handler) return;
          await dispatchItems(state, handler, 'max_window');
        });
      }, timeoutMs);
    }
  }

  async function enqueue(
    message: InboundBufferMessage,
    onFlush: FlushHandler,
    options: EnqueueOptions = {},
  ): Promise<void> {
    if (!settings.enabled) {
      await onFlush({ ...message, messageIds: [message.messageId] });
      return;
    }

    const key = buildKey(message.channel, message.channelUserId);
    const state = ensureState(key);

    await runSerialized(state, async () => {
      if (options.bypass) {
        logStructuredMessage('inbound_buffer_bypassed', {
          channel: message.channel,
          messageId: message.messageId,
          bufferedCount: state.items.length,
          result: 'bypass',
          reason: 'explicit_bypass',
        });

        if (state.items.length > 0 && state.onFlush) {
          await dispatchItems(state, state.onFlush, 'bypass_flush');
        }

        await onFlush({
          ...message,
          text: message.text.trim(),
          messageIds: [message.messageId],
        });
        return;
      }

      const text = (message.text || '').trim();
      if (!text) {
        return;
      }

      const now = Date.now();
      if (state.items.length === 0) {
        state.firstAt = now;
        logStructuredMessage('inbound_buffer_started', {
          channel: message.channel,
          messageId: message.messageId,
          bufferedCount: 1,
          bufferWindowMs: 0,
          result: 'started',
        });
      } else {
        const bufferWindowMs = now - state.firstAt;
        logStructuredMessage('inbound_buffer_appended', {
          channel: message.channel,
          messageId: message.messageId,
          bufferedCount: state.items.length + 1,
          bufferWindowMs,
          result: 'appended',
        });
      }

      state.items.push({
        message: {
          ...message,
          text,
        },
        receivedAt: now,
      });
      state.onFlush = onFlush;

      if (state.items.length >= settings.maxMessages) {
        await dispatchItems(state, onFlush, 'max_messages');
        return;
      }

      scheduleTimers(state);
    });
  }

  async function flushKey(
    channel: 'whatsapp' | 'telegram',
    channelUserId: string,
    reason: FlushReason = 'manual_flush'
  ): Promise<void> {
    const key = buildKey(channel, channelUserId);
    const state = states.get(key);
    if (!state) return;

    await runSerialized(state, async () => {
      if (!state.onFlush) {
        state.items = [];
        clearTimers(state);
        cleanupState(state);
        return;
      }

      await dispatchItems(state, state.onFlush, reason);
    });
  }

  function resetForTests(): void {
    for (const state of states.values()) {
      clearTimers(state);
    }
    states.clear();
  }

  return {
    enqueue,
    flushKey,
    resetForTests,
  };
}
