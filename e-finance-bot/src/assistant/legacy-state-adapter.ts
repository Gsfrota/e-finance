import type { ConversationWorkingState, LegacyPendingState, ResolvedTimeWindow, WorkingStateV2 } from './contracts';
import type { SessionContext } from '../session/session-manager';

const MIGRATED_CAPABILITIES = new Set(['create_contract', 'mark_installment_paid']);

function clone<T>(value: T): T {
  return value ? structuredClone(value) : value;
}

function toResolvedTimeWindow(state: Partial<WorkingStateV2>): ResolvedTimeWindow | undefined {
  if (state.activeTimeWindow) return state.activeTimeWindow;
  if (state.lastTimeWindow) return state.lastTimeWindow;
  return undefined;
}

function normalizeLegacyPending(context: SessionContext, state: Partial<WorkingStateV2>): LegacyPendingState | undefined {
  if (state.legacyPending?.action || state.legacyPending?.step || state.legacyPending?.data) {
    return clone(state.legacyPending);
  }

  if (!context.pendingAction && !context.pendingStep && !context.pendingData) {
    return undefined;
  }

  return {
    action: context.pendingAction,
    step: context.pendingStep,
    data: clone(context.pendingData) || {},
    actionAt: context.pendingActionAt,
  };
}

export function normalizeWorkingState(context?: SessionContext | null): ConversationWorkingState {
  const raw = (context?.workingStateV2 || context?.workingState || {}) as Partial<WorkingStateV2>;
  const legacyPending = normalizeLegacyPending(context || {}, raw);

  const focusedEntity = raw.focusedEntity || (raw.lastEntity
    ? { type: raw.lastEntity.type, id: raw.lastEntity.id, label: raw.lastEntity.label }
    : undefined);

  const candidateSets = raw.candidateSets || {
    debtors: raw.lastDebtorCandidates,
    companies: raw.lastCompanyCandidates,
  };

  const activeTimeWindow = toResolvedTimeWindow(raw);
  const lastCapability = raw.lastCapability || raw.lastAction;
  const missingSlots = raw.missingSlots || raw.pendingMissingFields || [];
  const lastContractId = raw.lastContractId
    ?? (focusedEntity?.type === 'contract' && focusedEntity.id && /^\d+$/.test(String(focusedEntity.id))
      ? Number(focusedEntity.id)
      : undefined);

  return {
    version: 2,
    updatedAt: raw.updatedAt,
    turnId: raw.turnId,
    lastUserIntent: raw.lastUserIntent || context?.lastIntent,
    lastCapability,
    focusedEntity,
    candidateSets,
    activeTimeWindow,
    pendingConfirmation: raw.pendingConfirmation,
    missingSlots,
    lastResolution: raw.lastResolution,
    lastMutation: raw.lastMutation,
    lastQueryResultRefs: raw.lastQueryResultRefs,
    activeCompany: raw.activeCompany,
    pendingCompanySelection: raw.pendingCompanySelection,
    pendingCapability: raw.pendingCapability,
    pendingOperationInput: clone(raw.pendingOperationInput),
    legacyPending,

    // aliases transitórios
    lastAction: lastCapability,
    lastEntity: focusedEntity && focusedEntity.type !== 'company'
      ? { type: focusedEntity.type, id: String(focusedEntity.id || ''), label: focusedEntity.label || '' }
      : undefined,
    lastFilters: raw.lastFilters,
    lastContractId,
    lastDebtorCandidates: candidateSets?.debtors,
    lastCompanyCandidates: candidateSets?.companies?.map(item => ({ id: item.id, label: item.label })),
    pendingMissingFields: missingSlots,
    lastTimeWindow: activeTimeWindow,
  };
}

export function mirrorWorkingStateToContext(
  context: SessionContext,
  state: ConversationWorkingState,
): SessionContext {
  const shouldMirrorLegacyPending = !!state.legacyPending?.action
    || !state.pendingCapability
    || !MIGRATED_CAPABILITIES.has(state.pendingCapability);
  const next: SessionContext = {
    ...context,
    lastIntent: state.lastUserIntent || context.lastIntent,
    workingStateV2: clone({
      ...state,
      version: 2,
    }),
    workingState: clone({
      ...state,
      version: 2,
    }),
  };

  const legacyPending = shouldMirrorLegacyPending ? state.legacyPending : undefined;
  next.pendingAction = legacyPending?.action;
  next.pendingStep = legacyPending?.step;
  next.pendingData = clone(legacyPending?.data);
  next.pendingActionAt = legacyPending?.actionAt;

  if (!next.pendingAction) delete next.pendingAction;
  if (next.pendingStep === undefined) delete next.pendingStep;
  if (!next.pendingData) delete next.pendingData;
  if (!next.pendingActionAt) delete next.pendingActionAt;

  return next;
}

export function getLegacyPendingState(context?: SessionContext | null): LegacyPendingState {
  return normalizeWorkingState(context).legacyPending || {};
}

export function withLegacyPendingState(
  state: ConversationWorkingState,
  pending: LegacyPendingState | undefined,
): ConversationWorkingState {
  return {
    ...state,
    legacyPending: pending,
  };
}

export function clearLegacyPendingState(state: ConversationWorkingState): ConversationWorkingState {
  const next = { ...state };
  delete next.legacyPending;
  return next;
}
