import type { ConversationWorkingState } from './contracts';
import type { Session, SessionContext } from '../session/session-manager';
import { config } from '../config';
import { updateSessionContext } from '../session/session-manager';
import { mirrorWorkingStateToContext, normalizeWorkingState } from './legacy-state-adapter';

const EMPTY_STATE: ConversationWorkingState = { version: 2 };

function cloneState(state?: ConversationWorkingState | null): ConversationWorkingState {
  return state ? structuredClone(state) : structuredClone(EMPTY_STATE);
}

function isExpired(state: ConversationWorkingState): boolean {
  if (!state.updatedAt) return false;
  const updatedAt = new Date(state.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) return false;
  return Date.now() - updatedAt > config.assistant.workingStateTtlMs;
}

function withTimestamp(state: ConversationWorkingState): ConversationWorkingState {
  return {
    ...state,
    version: 2,
    updatedAt: new Date().toISOString(),
    turnId: state.turnId || `${Date.now()}`,
  };
}

export function getWorkingState(context?: SessionContext | null): ConversationWorkingState {
  const state = cloneState(normalizeWorkingState(context));
  if (isExpired(state)) return { version: 2 };

  if (state.pendingConfirmation?.expiresAt) {
    const expiresAt = new Date(state.pendingConfirmation.expiresAt).getTime();
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      const expiredCapability = state.pendingConfirmation.capability;
      delete state.pendingConfirmation;
      if (state.pendingCapability === expiredCapability) {
        delete state.pendingCapability;
      }
      if (state.missingSlots?.length) {
        state.pendingMissingFields = [...state.missingSlots];
      }
    }
  }

  return state;
}

export function buildContextWithWorkingState(
  context: SessionContext,
  nextState: ConversationWorkingState,
): SessionContext {
  return mirrorWorkingStateToContext(context, withTimestamp(nextState));
}

export async function patchWorkingState(
  session: Session,
  patch: Partial<ConversationWorkingState>,
  extraContext: Partial<SessionContext> = {},
): Promise<SessionContext> {
  const current = getWorkingState(session.context);
  const next = withTimestamp({
    ...current,
    ...patch,
  });
  const nextContext = {
    ...mirrorWorkingStateToContext(session.context, next),
    ...extraContext,
  };
  await updateSessionContext(session.id, nextContext);
  session.context = nextContext;
  return nextContext;
}

export async function replaceWorkingState(
  session: Session,
  nextState: ConversationWorkingState,
  extraContext: Partial<SessionContext> = {},
): Promise<SessionContext> {
  const nextContext = {
    ...mirrorWorkingStateToContext(session.context, withTimestamp(nextState)),
    ...extraContext,
  };
  await updateSessionContext(session.id, nextContext);
  session.context = nextContext;
  return nextContext;
}

export async function clearWorkingState(
  session: Session,
  extraContext: Partial<SessionContext> = {},
): Promise<SessionContext> {
  return replaceWorkingState(session, { version: 2 }, extraContext);
}
