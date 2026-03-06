import type { ConversationWorkingState } from './contracts';
import type { Session, SessionContext } from '../session/session-manager';
import { config } from '../config';
import { updateSessionContext } from '../session/session-manager';

const EMPTY_STATE: ConversationWorkingState = {};

function cloneState(state?: ConversationWorkingState | null): ConversationWorkingState {
  return state ? { ...state } : { ...EMPTY_STATE };
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
    updatedAt: new Date().toISOString(),
  };
}

export function getWorkingState(context?: SessionContext | null): ConversationWorkingState {
  const state = cloneState(context?.workingState);
  if (isExpired(state)) return {};

  if (state.pendingConfirmation?.expiresAt) {
    const expiresAt = new Date(state.pendingConfirmation.expiresAt).getTime();
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      delete state.pendingConfirmation;
    }
  }

  return state;
}

export function buildContextWithWorkingState(
  context: SessionContext,
  nextState: ConversationWorkingState,
): SessionContext {
  return {
    ...context,
    workingState: withTimestamp(nextState),
  };
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
    ...session.context,
    ...extraContext,
    workingState: next,
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
    ...session.context,
    ...extraContext,
    workingState: withTimestamp(nextState),
  };
  await updateSessionContext(session.id, nextContext);
  session.context = nextContext;
  return nextContext;
}

export async function clearWorkingState(
  session: Session,
  extraContext: Partial<SessionContext> = {},
): Promise<SessionContext> {
  return replaceWorkingState(session, {}, extraContext);
}
