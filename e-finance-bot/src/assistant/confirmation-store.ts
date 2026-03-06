import { createHash } from 'crypto';
import { config } from '../config';
import type { ActionCapability, ConversationWorkingState } from './contracts';
import type { Session } from '../session/session-manager';
import { getWorkingState, patchWorkingState } from './working-state-store';

function createIdempotencyKey(
  sessionId: string,
  capability: ActionCapability,
  argsSnapshot: Record<string, unknown>,
): string {
  const hash = createHash('sha1')
    .update(JSON.stringify(argsSnapshot))
    .digest('hex')
    .slice(0, 12);
  return `${sessionId}:${capability}:${hash}`;
}

export function getPendingConfirmationState(session: Session): ConversationWorkingState['pendingConfirmation'] {
  return getWorkingState(session.context).pendingConfirmation;
}

export function parseConfirmationReply(text: string): 'confirm' | 'cancel' | null {
  const normalized = text.trim().toLowerCase();
  if (/^(sim|confirmo|ok|pode|isso|s|segue|pode seguir)$/.test(normalized)) return 'confirm';
  if (/^(n[aã]o|nao|cancelar|cancela|parar|para|sair)$/.test(normalized)) return 'cancel';
  return null;
}

export async function createPendingConfirmation(
  session: Session,
  capability: ActionCapability,
  argsSnapshot: Record<string, unknown>,
  safePreview: string,
): Promise<{ confirmationId: string; idempotencyKey: string; safeUserMessage: string }> {
  const idempotencyKey = createIdempotencyKey(session.id, capability, argsSnapshot);
  const confirmationId = `${capability}:${Date.now()}`;
  const expiresAt = new Date(Date.now() + config.assistant.confirmationTtlMs).toISOString();

  await patchWorkingState(session, {
    pendingConfirmation: {
      confirmationId,
      capability,
      expiresAt,
      idempotencyKey,
      argsSnapshot,
      safePreview,
    },
    pendingCapability: capability,
  });

  return {
    confirmationId,
    idempotencyKey,
    safeUserMessage: `${safePreview}\n\nSe estiver certo, responda *sim*. Se não, responda *não*.`,
  };
}

export async function clearPendingConfirmation(session: Session): Promise<void> {
  const state = getWorkingState(session.context);
  if (!state.pendingConfirmation) return;

  await patchWorkingState(session, {
    pendingConfirmation: undefined,
    pendingCapability: undefined,
  });
}
