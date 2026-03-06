import { config } from '../config';
import { logStructuredMessage } from '../observability/logger';
import * as tg from './telegram';
import * as wa from './whatsapp';

export interface PresenceContext {
  channel: 'whatsapp' | 'telegram';
  messageId: string;
  sessionId?: string;
  chatId?: string;
  channelUserId?: string;
}

let activeWhatsappPresenceCount = 0;
let whatsappPresenceQueue: Promise<void> = Promise.resolve();

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function getPresenceMode(ctx: PresenceContext): 'telegram_strict' | 'whatsapp_slow_only' | 'whatsapp_strict' | 'disabled' {
  if (!config.presence.enabled) return 'disabled';
  if (ctx.channel === 'telegram') return 'telegram_strict';
  if (config.presence.whatsappSlowOnly) return 'whatsapp_slow_only';
  return 'whatsapp_strict';
}

async function setWhatsappPresenceSerialized(
  presence: wa.WaPresence,
  ctx: PresenceContext,
  reason: string,
): Promise<void> {
  whatsappPresenceQueue = whatsappPresenceQueue
    .then(() => wa.setInstancePresence(presence))
    .catch((error: unknown) => {
      logStructuredMessage('presence_failed', {
        channel: 'whatsapp',
        messageId: ctx.messageId,
        sessionId: ctx.sessionId,
        result: 'error',
        reason,
        error: toErrorMessage(error),
      });
    });

  await whatsappPresenceQueue;
}

async function acquireWhatsappPresence(ctx: PresenceContext): Promise<void> {
  activeWhatsappPresenceCount += 1;
  if (activeWhatsappPresenceCount === 1) {
    await setWhatsappPresenceSerialized('available', ctx, 'whatsapp_presence_available');
  }
}

async function releaseWhatsappPresence(ctx: PresenceContext): Promise<void> {
  if (activeWhatsappPresenceCount > 0) {
    activeWhatsappPresenceCount -= 1;
  }

  if (activeWhatsappPresenceCount === 0) {
    await setWhatsappPresenceSerialized('unavailable', ctx, 'whatsapp_presence_unavailable');
  }
}

export async function runWithPresence<T>(
  ctx: PresenceContext,
  work: () => Promise<T>,
  sendReply: (result: T) => Promise<void>,
): Promise<T> {
  if (!config.presence.enabled) {
    const result = await work();
    await sendReply(result);
    return result;
  }

  const mode = getPresenceMode(ctx);
  const startDelayMs = Math.max(0, config.presence.startDelayMs);
  const minVisibleMs = Math.max(0, config.presence.minVisibleMs);
  const pulseMs = Math.max(1000, config.presence.telegramPulseMs);
  const waSlowThresholdMs = Math.max(0, config.presence.whatsappSlowThresholdMs);

  const startedAt = Date.now();
  let presenceStartedAt = 0;
  let presenceAcquired = false;
  let startRequested = false;

  let typingPulseTimer: ReturnType<typeof setInterval> | null = null;
  let delayedStartTimer: ReturnType<typeof setTimeout> | null = null;

  const startPresence = async (): Promise<void> => {
    if (startRequested) return;
    startRequested = true;

    try {
      if (ctx.channel === 'telegram') {
        const chatId = ctx.chatId || ctx.channelUserId;
        if (chatId) {
          await tg.sendChatAction(chatId, 'typing');
          typingPulseTimer = setInterval(() => {
            void tg.sendChatAction(chatId, 'typing');
          }, pulseMs);
          presenceAcquired = true;
        }
      } else if (ctx.channel === 'whatsapp' && config.presence.whatsappUseInstancePresence) {
        await acquireWhatsappPresence(ctx);
        presenceAcquired = true;
      }

      if (presenceAcquired) {
        presenceStartedAt = Date.now();
        logStructuredMessage('presence_started', {
          channel: ctx.channel,
          messageId: ctx.messageId,
          sessionId: ctx.sessionId,
          presenceMode: mode,
          delayMs: presenceStartedAt - startedAt,
          result: 'success',
        });
      }
    } catch (error) {
      logStructuredMessage('presence_failed', {
        channel: ctx.channel,
        messageId: ctx.messageId,
        sessionId: ctx.sessionId,
        presenceMode: mode,
        result: 'error',
        reason: 'start_presence_failed',
        error: toErrorMessage(error),
      });
    }
  };

  logStructuredMessage('presence_scheduled', {
    channel: ctx.channel,
    messageId: ctx.messageId,
    sessionId: ctx.sessionId,
    presenceMode: mode,
    delayMs: ctx.channel === 'telegram' ? startDelayMs : waSlowThresholdMs,
    visibleMs: minVisibleMs,
    result: 'scheduled',
  });

  if (ctx.channel === 'telegram') {
    delayedStartTimer = setTimeout(() => {
      void startPresence();
    }, startDelayMs);
  } else if (!config.presence.whatsappSlowOnly && config.presence.whatsappUseInstancePresence) {
    delayedStartTimer = setTimeout(() => {
      void startPresence();
    }, startDelayMs);
  }

  try {
    if (ctx.channel === 'whatsapp' && config.presence.whatsappUseInstancePresence && config.presence.whatsappSlowOnly) {
      const workPromise = work();
      const thresholdReached = waSlowThresholdMs === 0
        ? true
        : await Promise.race([
            workPromise.then(() => false),
            wait(waSlowThresholdMs).then(() => true),
          ]);

      if (thresholdReached) {
        await startPresence();
      }

      const result = await workPromise;

      if (presenceStartedAt > 0) {
        const visibleElapsed = Date.now() - presenceStartedAt;
        if (visibleElapsed < minVisibleMs) {
          await wait(minVisibleMs - visibleElapsed);
        }
      }

      await sendReply(result);
      return result;
    }

    const result = await work();

    const elapsed = Date.now() - startedAt;
    if (elapsed < startDelayMs) {
      await wait(startDelayMs - elapsed);
    }

    await startPresence();

    if (presenceStartedAt > 0) {
      const visibleElapsed = Date.now() - presenceStartedAt;
      if (visibleElapsed < minVisibleMs) {
        await wait(minVisibleMs - visibleElapsed);
      }
    }

    await sendReply(result);
    return result;
  } finally {
    if (delayedStartTimer) {
      clearTimeout(delayedStartTimer);
    }

    if (typingPulseTimer) {
      clearInterval(typingPulseTimer);
    }

    if (presenceAcquired && ctx.channel === 'whatsapp' && config.presence.whatsappUseInstancePresence) {
      await releaseWhatsappPresence(ctx);
    }

    if (presenceAcquired) {
      const endedAt = Date.now();
      logStructuredMessage('presence_stopped', {
        channel: ctx.channel,
        messageId: ctx.messageId,
        sessionId: ctx.sessionId,
        presenceMode: mode,
        durationMs: endedAt - presenceStartedAt,
        result: 'success',
      });
    }
  }
}

export function __resetPresenceStateForTests(): void {
  activeWhatsappPresenceCount = 0;
  whatsappPresenceQueue = Promise.resolve();
}
