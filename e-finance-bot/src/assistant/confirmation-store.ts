import { createHash, randomBytes } from 'crypto';
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

// BOT-001: léxico de confirmação para mutações sensíveis (criar contrato / baixar
// parcela). Regex ANCORADA (^...$) — equilibra recall × falso-positivo: aceita
// coloquiais exatas ("beleza", "pode ser"), mas frases tentativas com mais tokens
// ("pode ser que sim", "acho que sim", "talvez") NÃO casam e nunca confirmam.
const CONFIRM_LEXICON = /^(sim|sim sim|s|claro|confirmo|confirma|confirmar|confirmado|ok|okay|okey|beleza|blz|bora|bora la|certo|combinado|isso|isso mesmo|isso ai|perfeito|pode|pode confirmar|pode seguir|pode sim|pode ser|segue|seguir|fechado|fechou|positivo|exato|exatamente|com certeza|manda|manda ver|manda ai|yes|aham|uhum|ta|ta bom|ta bem|ta certo|tabom|de boa)$/;
const CANCEL_LEXICON = /^(nao|cancelar|cancela|parar|para|sair|negativo|nope|deixa|deixa pra la|deixa pra depois|melhor nao|agora nao|nem|para tudo|cancelado)$/;

export function parseConfirmationReply(text: string): 'confirm' | 'cancel' | null {
  // Normaliza: minúsculas, sem acento (NFD) e sem pontuação/espaço final ("Sim!", "OK." , "tá").
  const normalized = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[!.,…\s]+$/g, '')
    .trim();
  if (CANCEL_LEXICON.test(normalized)) return 'cancel';
  if (CONFIRM_LEXICON.test(normalized)) return 'confirm';
  return null;
}

export async function createPendingConfirmation(
  session: Session,
  capability: ActionCapability,
  argsSnapshot: Record<string, unknown>,
  safePreview: string,
): Promise<{ confirmationId: string; idempotencyKey: string; safeUserMessage: string }> {
  const idempotencyKey = createIdempotencyKey(session.id, capability, argsSnapshot);
  // Sufixo aleatório elimina colisão se duas confirmações forem criadas no mesmo ms.
  const confirmationId = `${capability}:${Date.now()}:${randomBytes(3).toString('hex')}`;
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

  const hasInlineConfirmationInstruction = /confirma\?\s*\(sim\/n[aã]o\)|responda\s+\*?sim\*/i.test(safePreview);

  return {
    confirmationId,
    idempotencyKey,
    safeUserMessage: hasInlineConfirmationInstruction
      ? safePreview
      : `${safePreview}\n\nSe estiver certo, responda *sim*. Se não, responda *não*.`,
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
