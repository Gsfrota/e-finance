import { getCapabilityDefinition } from './capability-registry';
import type { PolicyCheckInput, PolicyCheckResult } from './contracts';

export function runPolicyCheck(input: PolicyCheckInput): PolicyCheckResult {
  const capability = getCapabilityDefinition(input.capability);
  const idempotencyKey = input.idempotencyKey || `${input.requestId}:${input.capability}`;

  if (!capability.rolesAllowed.includes(input.role as any)) {
    return {
      allowed: false,
      requiresConfirmation: false,
      idempotencyKey,
      reason: 'role_forbidden',
    };
  }

  if (capability.kind !== 'utility' && !input.tenantId) {
    return {
      allowed: false,
      requiresConfirmation: false,
      idempotencyKey,
      reason: 'missing_tenant',
    };
  }

  if (capability.kind !== 'utility' && !input.profileId) {
    return {
      allowed: false,
      requiresConfirmation: false,
      idempotencyKey,
      reason: 'missing_profile',
    };
  }

  return {
    allowed: true,
    requiresConfirmation: capability.requiresConfirmation && !input.confirmed,
    idempotencyKey,
  };
}
