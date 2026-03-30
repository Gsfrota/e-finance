import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config', () => ({
  config: {
    assistant: {
      workingStateTtlMs: 30 * 60 * 1000,
    },
  },
}));

import { buildContextWithWorkingState, getWorkingState } from '../src/assistant/working-state-store';

describe('working-state-store', () => {
  it('remove pendingConfirmation expirado e também limpa pendingCapability residual', () => {
    const state = getWorkingState({
      workingState: {
        updatedAt: new Date().toISOString(),
        pendingCapability: 'disconnect_bot',
        pendingConfirmation: {
          confirmationId: 'disconnect_bot:1',
          capability: 'disconnect_bot',
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
          idempotencyKey: 'session:disconnect',
          argsSnapshot: {},
          safePreview: 'preview',
        },
      },
    } as any);

    expect(state.pendingConfirmation).toBeUndefined();
    expect(state.pendingCapability).toBeUndefined();
  });

  it('não espelha create_contract e mark_installment_paid para pendingAction legado', () => {
    const createContractContext = buildContextWithWorkingState({} as any, {
      version: 2,
      pendingCapability: 'create_contract',
      pendingOperationInput: { debtor_name: 'Maria' },
    });

    expect(createContractContext.pendingAction).toBeUndefined();
    expect(createContractContext.pendingStep).toBeUndefined();
    expect(createContractContext.pendingData).toBeUndefined();

    const paymentContext = buildContextWithWorkingState({} as any, {
      version: 2,
      pendingCapability: 'mark_installment_paid',
      pendingOperationInput: { contract_id: 123, installment_number: 2 },
    });

    expect(paymentContext.pendingAction).toBeUndefined();
    expect(paymentContext.pendingStep).toBeUndefined();
    expect(paymentContext.pendingData).toBeUndefined();
  });
});
