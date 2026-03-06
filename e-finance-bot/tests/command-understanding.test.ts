import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routeIntent: vi.fn(),
}));

vi.mock('../src/ai/intent-router', () => ({
  routeIntent: mocks.routeIntent,
}));

import { understandCommand } from '../src/assistant/command-understanding';

describe('command-understanding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.routeIntent.mockResolvedValue({
      intent: 'desconhecido',
      entities: {},
      normalizedEntities: {},
      confidence: 'low',
      source: 'rule',
    });
  });

  it('trata smalltalk de identidade sem chamar roteador', async () => {
    const understanding = await understandCommand({
      text: 'quem é você?',
      tenantId: 'tenant-1',
      channel: 'telegram',
      messageId: 'm-1',
      sessionId: 's-1',
      loadHistory: async () => [],
    });

    expect(understanding.intent).toBe('smalltalk_identity');
    expect(understanding.source).toBe('rule');
    expect(mocks.routeIntent).not.toHaveBeenCalled();
  });

  it('identifica janela em meses para recebíveis', async () => {
    const understanding = await understandCommand({
      text: 'quanto vou receber nos próximos 2 meses?',
      tenantId: 'tenant-1',
      channel: 'telegram',
      messageId: 'm-2',
      sessionId: 's-1',
      loadHistory: async () => [],
    });

    expect(understanding.intent).toBe('recebiveis_periodo');
    expect(understanding.normalizedEntities.time_window).toEqual(expect.objectContaining({
      mode: 'relative_months',
      amount: 2,
    }));
    expect(mocks.routeIntent).not.toHaveBeenCalled();
  });
});
