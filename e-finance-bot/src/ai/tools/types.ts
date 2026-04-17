import { z } from 'zod';
import type { ActionCapability, CapabilityKind } from '../../assistant/contracts';
import type { Session } from '../../session/session-manager';

export interface ToolContext {
  session: Session;
  tenantId: string;
  userId?: string;
  role: 'admin' | 'investor' | 'debtor';
  companyId?: string | null;
  turnId: string;
  now: Date;
}

export type ToolOutcome =
  | { kind: 'text'; text: string }
  | { kind: 'data'; summary: string; data: unknown }
  | { kind: 'preview'; preview: string; idempotencyKey: string; confirmationId: string; argsSnapshot: Record<string, unknown> }
  | { kind: 'mutation_applied'; summary: string; data?: unknown }
  | { kind: 'error'; message: string; retryable: boolean };

export type ToolHandler<I = Record<string, unknown>> = (
  input: I,
  ctx: ToolContext,
) => Promise<ToolOutcome>;

export interface ToolDefinition<I extends Record<string, unknown> = Record<string, unknown>> {
  name: ActionCapability;
  kind: CapabilityKind;
  description: string;
  rolesAllowed: Array<'admin' | 'investor' | 'debtor'>;
  requiresConfirmation: boolean;
  parameters: GeminiFunctionParameters;
  inputSchema: z.ZodType<I>;
  handler: ToolHandler<I>;
  fastPathEligible?: boolean;
}

export interface GeminiFunctionParameters {
  type: 'object';
  properties: Record<string, GeminiFunctionProperty>;
  required?: string[];
}

export interface GeminiFunctionProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: GeminiFunctionProperty;
  properties?: Record<string, GeminiFunctionProperty>;
  required?: string[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: GeminiFunctionParameters;
}
