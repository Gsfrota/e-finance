import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  classifyIntentCompact: vi.fn(),
}));

vi.mock('../src/ai/intent-classifier', async () => {
  const actual = await vi.importActual<typeof import('../src/ai/intent-classifier')>('../src/ai/intent-classifier');
  return {
    ...actual,
    classifyIntentCompact: mocks.classifyIntentCompact,
  };
});

vi.mock('../src/session/session-manager', () => ({
  getOrCreateSession: vi.fn(),
  updateSessionContext: vi.fn(),
  clearSessionContext: vi.fn(),
  linkProfileToSession: vi.fn(),
  saveMessage: vi.fn(),
  getRecentMessages: vi.fn(),
  syncSessionProfileFromChannelBinding: vi.fn(),
}));

vi.mock('../src/actions/admin-actions', () => ({
  getDashboardSummary: vi.fn(),
  getInstallments: vi.fn(),
  getInstallmentsToday: vi.fn(),
  getDebtorsToCollectToday: vi.fn(),
  getInstallmentsInWindow: vi.fn(),
  getDebtorsToCollectInWindow: vi.fn(),
  getInstallmentsByDateRange: vi.fn(),
  getDebtorsToCollectByDateRange: vi.fn(),
  buildDateWindow: vi.fn(),
  generateMonthlyReport: vi.fn(),
  parseContractTextWithMeta: vi.fn(),
  createContract: vi.fn(),
  markInstallmentPaid: vi.fn(),
  searchUser: vi.fn(),
  getUserDebt: vi.fn(),
  generateInvite: vi.fn(),
  validateLinkCode: vi.fn(),
  disconnectBot: vi.fn(),
  getContractOpenInstallments: vi.fn(),
  getContractOpenInstallmentByNumber: vi.fn(),
  normalizeCpf: (value?: string | null) => {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    return digits.length === 11 ? digits : null;
  },
  isValidCpf: () => true,
  formatCurrency: (value: number) => `R$ ${value.toFixed(2)}`,
  formatDate: (value: string) => value,
}));

vi.mock('../src/observability/logger', () => ({
  logStructuredMessage: vi.fn(),
}));

import { routeIntent } from '../src/ai/intent-router';
import { getClarificationMessage } from '../src/handlers/message-handler';

describe('NLU curated offline evaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.classifyIntentCompact.mockResolvedValue({
      intent: 'desconhecido',
      entities: {},
      normalizedEntities: {},
      confidence: 'low',
    });
  });

  it('mantém acurácia >= 90% no dataset curado de comandos naturais', async () => {
    const curated: Array<{ text: string; expected: string }> = [
      { text: '/dashboard', expected: 'ver_dashboard' },
      { text: 'como tá o mês', expected: 'ver_dashboard' },
      { text: '/recebiveis', expected: 'listar_recebiveis' },
      { text: '2', expected: 'listar_recebiveis' },
      { text: 'quem tá atrasado', expected: 'listar_recebiveis' },
      { text: '/contrato', expected: 'criar_contrato' },
      { text: 'contrato', expected: 'criar_contrato' },
      { text: 'novo contrato', expected: 'criar_contrato' },
      { text: '/pagamento', expected: 'marcar_pagamento' },
      { text: 'dar baixa', expected: 'marcar_pagamento' },
      { text: 'baixar contrato 123 parcela 2', expected: 'marcar_pagamento' },
      { text: 'recebíveis de hoje', expected: 'recebiveis_hoje' },
      { text: 'quem tenho que cobrar hoje?', expected: 'cobrar_hoje' },
      { text: 'quanto vou receber nos próximos 7 dias', expected: 'recebiveis_periodo' },
      { text: 'a partir de amanhã, quem devo cobrar nos próximos 3 dias?', expected: 'cobrar_periodo' },
      { text: 'gerar relatório mensal', expected: 'gerar_relatorio' },
      { text: 'gera um convite', expected: 'gerar_convite' },
      { text: 'quanto o Carlos deve', expected: 'buscar_usuario' },
      { text: '/desconectar', expected: 'desconectar' },
      { text: 'sim', expected: 'confirmar' },
      { text: 'cancelar', expected: 'cancelar' },
      { text: 'ajuda', expected: 'ajuda' },
      { text: 'bom dia', expected: 'ajuda' },
    ];

    let hits = 0;

    for (const sample of curated) {
      const routed = await routeIntent(sample.text, []);
      if (routed.intent === sample.expected) hits += 1;
    }

    const accuracy = hits / curated.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('gera clarificação em 100% dos casos de baixa confiança', async () => {
    const ambiguousInputs = [
      'faz aquele negócio lá',
      'resolve isso',
      'o de sempre',
    ];

    let clarificationCount = 0;

    for (const text of ambiguousInputs) {
      const routed = await routeIntent(text, []);
      const clarification = getClarificationMessage(routed.intent, routed.confidence);
      if (clarification) clarificationCount += 1;
    }

    expect(clarificationCount).toBe(ambiguousInputs.length);
  });
});
