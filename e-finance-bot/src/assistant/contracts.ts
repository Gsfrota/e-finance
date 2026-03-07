import type { Intent, NormalizedEntities } from '../ai/intent-classifier';

export type CapabilityKind = 'query' | 'mutation' | 'utility';

export type ActionCapability =
  | 'show_dashboard'
  | 'list_receivables'
  | 'list_collection_targets'
  | 'query_debtor_balance'
  | 'query_receivables_window'
  | 'query_collection_window'
  | 'create_contract'
  | 'mark_installment_paid'
  | 'disconnect_bot'
  | 'help'
  | 'smalltalk_identity'
  | 'smalltalk_datetime'
  | 'generate_report'
  | 'generate_invite'
  | 'view_my_installments'
  | 'view_my_debt_summary'
  | 'view_my_portfolio';

export type OperationalIntent = Intent | 'smalltalk_identity' | 'smalltalk_datetime';

export type TimeWindowMode = 'relative_days' | 'relative_months' | 'calendar_month';

export interface ResolvedTimeWindow {
  mode: TimeWindowMode;
  amount: number;
  windowStart: 'today' | 'tomorrow';
  startDate: string;
  endDate: string;
  label: string;
}

export interface ActionPlan {
  capability: ActionCapability;
  confidence: 'low' | 'medium' | 'high';
  source: 'rule' | 'llm' | 'followup';
  args: Record<string, unknown>;
  missingFields: string[];
  dependsOnContext: boolean;
  requiresConfirmation: boolean;
  ambiguity?: {
    type: 'debtor' | 'contract' | 'installment' | 'time_window' | 'intent';
    candidates: Array<{ id: string; label: string; meta?: string }>;
  };
}

export interface ConversationWorkingState {
  updatedAt?: string;
  lastAction?: ActionCapability;
  lastEntity?: { type: 'debtor' | 'contract' | 'installment'; id: string; label: string };
  lastFilters?: {
    daysAhead?: number;
    monthsAhead?: number;
    windowStart?: 'today' | 'tomorrow';
    month?: number;
    year?: number;
    filter?: 'pending' | 'late' | 'week' | 'all';
  };
  lastContractId?: number;
  lastDebtorCandidates?: Array<{ id: string; label: string; cpfMasked?: string }>;
  pendingConfirmation?: {
    confirmationId: string;
    capability: ActionCapability;
    expiresAt: string;
    idempotencyKey: string;
    argsSnapshot: Record<string, unknown>;
    safePreview: string;
  };
  pendingCapability?: ActionCapability;
  pendingMissingFields?: string[];
  lastTimeWindow?: ResolvedTimeWindow;
  lastQueryResultRefs?: Array<{ type: string; id: string }>;
}

export interface CapabilityDefinition {
  name: ActionCapability;
  kind: CapabilityKind;
  rolesAllowed: Array<'admin' | 'investor' | 'debtor'>;
  requiredArgs: string[];
  optionalArgs: string[];
  requiresConfirmation: boolean;
  idempotencyScope?: 'none' | 'session' | 'tenant' | 'mutation';
  legacyIntent?: Intent;
}

export interface PolicyCheckInput {
  tenantId: string;
  profileId: string;
  role: string;
  requestId: string;
  channel: 'telegram' | 'whatsapp';
  idempotencyKey?: string;
  capability: ActionCapability;
  args: Record<string, unknown>;
  confirmed?: boolean;
}

export interface PolicyCheckResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  idempotencyKey: string;
  reason?: string;
}

export interface ExecutionResult<T = unknown> {
  status: 'ok' | 'needs_clarification' | 'needs_confirmation' | 'forbidden' | 'error';
  payload?: T;
  warnings?: string[];
  safeUserMessage: string;
  audit: {
    requestId: string;
    capability: ActionCapability;
    tenantId: string;
    confirmed: boolean;
    executor: string;
  };
}

export interface ToolExecutionResult<T = unknown> extends ExecutionResult<T> {
  workingStatePatch?: Partial<ConversationWorkingState>;
}

export interface CommandUnderstanding {
  intent: OperationalIntent;
  source: 'rule' | 'llm' | 'followup';
  confidence: 'low' | 'medium' | 'high';
  dependsOnContext: boolean;
  normalizedEntities: NormalizedEntities & {
    months_ahead?: number;
    debtor_profile_id?: string;
    time_window?: ResolvedTimeWindow;
  };
  candidates?: Intent[];
  fallbackReason?: string;
}
