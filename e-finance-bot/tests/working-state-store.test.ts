import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config', () => ({
  config: {
    assistant: {
      workingStateTtlMs: 30 * 60 * 1000,
    },
  },
}));

import { getWorkingState } from '../src/assistant/working-state-store';

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
});
