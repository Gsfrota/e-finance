import { z } from 'zod';
import type { Intent, NormalizedEntities } from '../ai/intent-classifier';
import type { Session } from '../session/session-manager';

export type CapabilityKind = 'query' | 'mutation' | 'utility';
export type PlanDecision = 'execute' | 'ask_clarification' | 'request_confirmation' | 'reject' | 'smalltalk';
export type ReplyMode = 'raw' | 'rewrite';
export type ConfidenceLabel = 'low' | 'medium' | 'high';
export type ResolutionSource = 'rule' | 'llm' | 'followup';

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
  | 'greet'
  | 'help'
  | 'smalltalk_identity'
  | 'smalltalk_datetime'
  | 'generate_report'
  | 'generate_invite'
  | 'view_my_installments'
  | 'view_my_debt_summary'
  | 'view_my_portfolio'
  | 'configure_briefing'
  | 'set_eod_alert_hour'
  | 'preview_lembrete';

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

export interface CandidateOption {
  id: string;
  label: string;
  meta?: string;
  cpfMasked?: string;
}

export interface PendingConfirmationState {
  confirmationId: string;
  capability: ActionCapability;
  expiresAt: string;
  idempotencyKey: string;
  argsSnapshot: Record<string, unknown>;
  safePreview: string;
}

export interface LegacyPendingState {
  action?: string;
  step?: number;
  data?: Record<string, unknown>;
  actionAt?: string;
}

export interface WorkingStateV2 {
  version?: 2;
  updatedAt?: string;
  turnId?: string;
  lastUserIntent?: string;
  lastCapability?: ActionCapability;
  focusedEntity?: {
    type: 'debtor' | 'contract' | 'installment' | 'company';
    id?: string;
    label?: string;
  };
  candidateSets?: {
    debtors?: CandidateOption[];
    contracts?: CandidateOption[];
    installments?: CandidateOption[];
    companies?: CandidateOption[];
  };
  activeTimeWindow?: ResolvedTimeWindow;
  pendingConfirmation?: PendingConfirmationState;
  missingSlots?: string[];
  lastResolution?: {
    source: ResolutionSource;
    confidence: number;
    evidence?: string[];
  };
  lastMutation?: {
    capability: ActionCapability;
    idempotencyKey: string;
    completedAt: string;
    confirmationId?: string;
  };
  lastQueryResultRefs?: Array<{ type: string; id: string }>;
  activeCompany?: { id: string; label: string };
  pendingCompanySelection?: boolean;
  pendingCapability?: ActionCapability;
  pendingOperationInput?: Record<string, unknown>;
  legacyPending?: LegacyPendingState;

  // Aliases transitórios para compatibilidade com o legado.
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
  lastCompanyCandidates?: Array<{ id: string; label: string }>;
  pendingMissingFields?: string[];
  lastTimeWindow?: ResolvedTimeWindow;
}

export type ConversationWorkingState = WorkingStateV2;

export interface ActionPlan {
  decision: PlanDecision;
  intent: OperationalIntent | 'desconhecido';
  capability: ActionCapability;
  args: Record<string, unknown>;
  missingArgs: string[];
  missingFields: string[];
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  source: ResolutionSource;
  evidence: string[];
  dependsOnContext: boolean;
  requiresConfirmation: boolean;
  userFacingQuestion?: string;
  ambiguity?: {
    type: 'debtor' | 'contract' | 'installment' | 'time_window' | 'intent' | 'company';
    candidates: CandidateOption[];
  };
}

export interface StructuredResponse {
  status: 'ok' | 'clarify' | 'confirm' | 'error' | 'blocked';
  title: string;
  facts: string[];
  nextActions?: string[];
  safePreview?: string;
}

export interface ContextPack {
  tenantScoped: boolean;
  userRole: 'admin' | 'investor' | 'debtor';
  lastIntent?: string;
  lastCapability?: ActionCapability;
  focusedEntity?: string;
  activeTimeWindow?: string;
  pendingConfirmation?: boolean;
  candidateHints: string[];
  recentTurnsSummary: string;
}

export interface CapabilityRuntimeContext {
  session: Session;
  tenantId: string;
  profileId: string;
  role: 'admin' | 'investor' | 'debtor';
  requestId: string;
  channel: 'telegram' | 'whatsapp';
  rawText: string;
  confirmed?: boolean;
  idempotencyKey?: string;
  confirmationId?: string;
  workingState: ConversationWorkingState;
}

export type CapabilityResolveResult<I> =
  | {
      status: 'ready';
      input: I;
      confirmationPreview?: string;
      workingStatePatch?: Partial<ConversationWorkingState>;
    }
  | {
      status: 'needs_clarification' | 'error';
      safeUserMessage: string;
      structuredResponse?: StructuredResponse;
      workingStatePatch?: Partial<ConversationWorkingState>;
    };

export type CapabilityExecuteResult<O> =
  | {
      status: 'ok';
      output: O;
      workingStatePatch?: Partial<ConversationWorkingState>;
    }
  | {
      status: 'needs_clarification' | 'error';
      safeUserMessage: string;
      structuredResponse?: StructuredResponse;
      workingStatePatch?: Partial<ConversationWorkingState>;
    };

export interface CapabilityDefinition<I = Record<string, unknown>, O = unknown> {
  name: ActionCapability;
  kind: CapabilityKind;
  rolesAllowed: Array<'admin' | 'investor' | 'debtor'>;
  requiredArgs: string[];
  optionalArgs: string[];
  requiresConfirmation: boolean;
  idempotencyScope?: 'none' | 'session' | 'tenant' | 'mutation';
  legacyIntent?: Intent;
  inputSchema: z.ZodType<I>;
  replyMode: ReplyMode;
  resolve?: (ctx: CapabilityRuntimeContext, input: I) => Promise<CapabilityResolveResult<I>> | CapabilityResolveResult<I>;
  authorize?: (ctx: CapabilityRuntimeContext, input: I) => Promise<void> | void;
  execute?: (ctx: CapabilityRuntimeContext, input: I) => Promise<CapabilityExecuteResult<O> | O> | CapabilityExecuteResult<O> | O;
  formatResult?: (output: O, ctx: CapabilityRuntimeContext, input: I) => StructuredResponse;
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
  structuredResponse?: StructuredResponse;
  audit: {
    requestId: string;
    capability: ActionCapability;
    tenantId: string;
    profileId?: string;
    role?: string;
    confirmed: boolean;
    executor: string;
    resolutionMode?: ResolutionSource;
    conversationKey?: string;
  };
}

export interface ToolExecutionResult<T = unknown> extends ExecutionResult<T> {
  workingStatePatch?: Partial<ConversationWorkingState>;
}

export interface CommandUnderstanding {
  intent: OperationalIntent;
  source: ResolutionSource;
  confidence: ConfidenceLabel;
  dependsOnContext: boolean;
  normalizedEntities: NormalizedEntities & {
    months_ahead?: number;
    debtor_profile_id?: string;
    time_window?: ResolvedTimeWindow;
  };
  candidates?: Intent[];
  fallbackReason?: string;
}

export const ResolvedTimeWindowSchema = z.object({
  mode: z.enum(['relative_days', 'relative_months', 'calendar_month']),
  amount: z.number().int().positive(),
  windowStart: z.enum(['today', 'tomorrow']),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  label: z.string().min(1),
});

export const StructuredResponseSchema = z.object({
  status: z.enum(['ok', 'clarify', 'confirm', 'error', 'blocked']),
  title: z.string().min(1),
  facts: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).optional(),
  safePreview: z.string().optional(),
});

export const ActionPlanSchema = z.object({
  decision: z.enum(['execute', 'ask_clarification', 'request_confirmation', 'reject', 'smalltalk']),
  intent: z.string().min(1),
  capability: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  missingArgs: z.array(z.string()),
  missingFields: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  confidenceLabel: z.enum(['low', 'medium', 'high']),
  source: z.enum(['rule', 'llm', 'followup']),
  evidence: z.array(z.string()),
  dependsOnContext: z.boolean(),
  requiresConfirmation: z.boolean(),
  userFacingQuestion: z.string().optional(),
  ambiguity: z.object({
    type: z.enum(['debtor', 'contract', 'installment', 'time_window', 'intent', 'company']),
    candidates: z.array(z.object({
      id: z.string(),
      label: z.string(),
      meta: z.string().optional(),
      cpfMasked: z.string().optional(),
    })),
  }).optional(),
});

export function labelToConfidenceScore(label: ConfidenceLabel): number {
  if (label === 'high') return 0.95;
  if (label === 'medium') return 0.7;
  return 0.35;
}

export function validateActionPlan(plan: ActionPlan): ActionPlan {
  return ActionPlanSchema.parse(plan) as ActionPlan;
}

export function buildStructuredResponse(input: StructuredResponse): StructuredResponse {
  return StructuredResponseSchema.parse(input);
}
