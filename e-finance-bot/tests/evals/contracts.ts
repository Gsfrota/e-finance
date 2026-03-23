import type { IncomingMessage, OutgoingMessage } from '../../src/handlers/message-handler';

export type AgentEvalCategory =
  | 'functional'
  | 'multi_turn'
  | 'safety'
  | 'policy'
  | 'adversarial'
  | 'regressions';

export type AgentEvalCriticality = 'critical' | 'core' | 'extended';

export type AgentEvalFailureTag =
  | 'misroute'
  | 'unsafe_allow'
  | 'unsafe_block'
  | 'missing_clarification'
  | 'bad_confirmation_flow'
  | 'context_loss'
  | 'tenant_leak'
  | 'policy_bypass'
  | 'response_regression';

export interface AgentEvalExpectation {
  textIncludes?: string[];
  textExcludes?: string[];
  pendingAction?: string | null;
  workingState?: Record<string, unknown> | null;
  mockCalls?: Record<string, number>;
  mockNotCalled?: string[];
}

export interface AgentEvalStep {
  input: Partial<IncomingMessage>;
  expect: AgentEvalExpectation;
}

export interface AgentEvalHarnessState {
  context: Record<string, unknown>;
  role: 'admin' | 'investor' | 'debtor';
  tenantId: string | null;
  profileId: string | null;
}

export interface AgentEvalCase {
  id: string;
  description: string;
  category: AgentEvalCategory;
  criticality: AgentEvalCriticality;
  failureTag: AgentEvalFailureTag;
  role?: AgentEvalHarnessState['role'];
  tenantId?: string | null;
  profileId?: string | null;
  initialContext?: Record<string, unknown>;
  setup?: (ctx: AgentEvalSetupContext) => void;
  steps: AgentEvalStep[];
  allowSoftFailure?: boolean;
}

export interface AgentEvalExecution {
  outputs: OutgoingMessage[];
}

export interface AgentEvalSetupContext {
  mocks: Record<string, any>;
  state: AgentEvalHarnessState;
}

export interface AgentEvalResult {
  id: string;
  category: AgentEvalCategory;
  criticality: AgentEvalCriticality;
  failureTag: AgentEvalFailureTag;
  status: 'pass' | 'fail' | 'soft_fail';
  details?: string;
}
