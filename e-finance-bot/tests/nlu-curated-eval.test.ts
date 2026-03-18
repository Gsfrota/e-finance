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
  extractDebtorNameSimple: () => null,
  extractAmount: () => null,
  extractRate: () => null,
  extractInstallments: () => null,
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
      // --- ADMIN: dashboard ---
      { text: '/dashboard', expected: 'ver_dashboard' },
      { text: 'dashboard', expected: 'ver_dashboard' },
      { text: 'como tá o mês', expected: 'ver_dashboard' },
      { text: 'como está o mês', expected: 'ver_dashboard' },
      { text: 'resumo', expected: 'ver_dashboard' },
      { text: '1', expected: 'ver_dashboard' },

      // --- ADMIN: listar_recebiveis ---
      { text: '/recebiveis', expected: 'listar_recebiveis' },
      { text: 'recebiveis', expected: 'listar_recebiveis' },
      { text: '2', expected: 'listar_recebiveis' },
      { text: 'quem tá atrasado', expected: 'listar_recebiveis' },
      { text: 'quem está atrasado', expected: 'listar_recebiveis' },
      { text: 'quem ta atrasado', expected: 'listar_recebiveis' },

      // --- ADMIN: criar_contrato ---
      { text: '/contrato', expected: 'criar_contrato' },
      { text: 'contrato', expected: 'criar_contrato' },
      { text: '3', expected: 'criar_contrato' },
      { text: 'novo contrato', expected: 'criar_contrato' },
      { text: 'criar contrato', expected: 'criar_contrato' },
      { text: 'registrar contrato', expected: 'criar_contrato' },

      // --- ADMIN: marcar_pagamento ---
      { text: '/pagamento', expected: 'marcar_pagamento' },
      { text: 'pagamento', expected: 'marcar_pagamento' },
      { text: '4', expected: 'marcar_pagamento' },
      { text: 'dar baixa', expected: 'marcar_pagamento' },
      { text: 'registrar pagamento', expected: 'marcar_pagamento' },
      { text: 'quitar parcela', expected: 'marcar_pagamento' },
      { text: 'baixar contrato 123 parcela 2', expected: 'marcar_pagamento' },
      { text: 'baixar pagamento de João', expected: 'marcar_pagamento' },

      // --- ADMIN: recebiveis_hoje ---
      { text: 'recebíveis de hoje', expected: 'recebiveis_hoje' },
      { text: 'recebiveis de hoje', expected: 'recebiveis_hoje' },
      { text: 'o que vence hoje', expected: 'recebiveis_hoje' },

      // --- ADMIN: cobrar_hoje ---
      { text: 'quem tenho que cobrar hoje?', expected: 'cobrar_hoje' },
      { text: 'quem me deve hoje', expected: 'cobrar_hoje' },
      { text: 'quem tá devendo hoje', expected: 'cobrar_hoje' },

      // --- ADMIN: recebiveis_periodo ---
      { text: 'quanto vou receber nos próximos 7 dias', expected: 'recebiveis_periodo' },
      { text: 'recebíveis dos próximos 15 dias', expected: 'recebiveis_periodo' },

      // --- ADMIN: cobrar_periodo ---
      { text: 'a partir de amanhã, quem devo cobrar nos próximos 3 dias?', expected: 'cobrar_periodo' },
      { text: 'quem devo cobrar nos próximos 7 dias', expected: 'cobrar_periodo' },

      // --- ADMIN: gerar_relatorio ---
      { text: 'gerar relatório mensal', expected: 'gerar_relatorio' },
      { text: 'resumo completo', expected: 'gerar_relatorio' },

      // --- ADMIN: gerar_convite ---
      { text: 'gera um convite', expected: 'gerar_convite' },
      { text: 'gerar convite', expected: 'gerar_convite' },

      // --- ADMIN: buscar_usuario ---
      { text: 'quanto o Carlos deve', expected: 'buscar_usuario' },
      { text: 'qual a dívida de Maria', expected: 'buscar_usuario' },

      // --- ADMIN: desconectar ---
      { text: '/desconectar', expected: 'desconectar' },
      { text: 'desconectar', expected: 'desconectar' },

      // --- SHARED: confirmar / cancelar ---
      { text: 'sim', expected: 'confirmar' },
      { text: 'ok', expected: 'confirmar' },
      { text: 'cancelar', expected: 'cancelar' },
      { text: 'não', expected: 'cancelar' },

      // --- SHARED: ajuda ---
      { text: 'ajuda', expected: 'ajuda' },
      { text: 'bom dia', expected: 'ajuda' },
      { text: 'oi', expected: 'ajuda' },
      { text: '/ajuda', expected: 'ajuda' },

      // --- DEBTOR: ver_minhas_parcelas ---
      { text: 'minhas parcelas', expected: 'ver_minhas_parcelas' },
      { text: 'meus vencimentos', expected: 'ver_minhas_parcelas' },
      { text: 'quando vence minha parcela', expected: 'ver_minhas_parcelas' },

      // --- DEBTOR: ver_meu_saldo_devedor ---
      { text: 'quanto devo', expected: 'ver_meu_saldo_devedor' },
      { text: 'minha dívida', expected: 'ver_meu_saldo_devedor' },
      { text: 'meu saldo devedor', expected: 'ver_meu_saldo_devedor' },

      // --- INVESTOR: ver_meu_portfolio ---
      { text: 'meus contratos', expected: 'ver_meu_portfolio' },
      { text: 'meu portfólio', expected: 'ver_meu_portfolio' },
      { text: 'minha carteira', expected: 'ver_meu_portfolio' },
    ];

    let hits = 0;
    const misses: Array<{ text: string; expected: string; got: string }> = [];

    for (const sample of curated) {
      const routed = await routeIntent(sample.text, []);
      if (routed.intent === sample.expected) {
        hits += 1;
      } else {
        misses.push({ text: sample.text, expected: sample.expected, got: routed.intent });
      }
    }

    if (misses.length > 0) {
      console.warn('NLU misses:', JSON.stringify(misses, null, 2));
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

  it('não gera clarificação para intents de alta confiança', async () => {
    const clearInputs = [
      { text: 'dashboard', expected: 'ver_dashboard' },
      { text: 'sim', expected: 'confirmar' },
      { text: 'cancelar', expected: 'cancelar' },
      { text: 'ajuda', expected: 'ajuda' },
    ];

    for (const sample of clearInputs) {
      const routed = await routeIntent(sample.text, []);
      if (routed.intent === sample.expected) {
        const clarification = getClarificationMessage(routed.intent, routed.confidence);
        expect(clarification).toBeNull();
      }
    }
  });

  it('extrai entidades de período corretamente', async () => {
    const routed = await routeIntent('quanto vou receber nos próximos 7 dias', []);
    expect(routed.intent).toBe('recebiveis_periodo');
    expect(routed.normalizedEntities.days_ahead).toBe(7);
    expect(routed.normalizedEntities.window_start).toBe('today');
  });

  it('extrai window_start=tomorrow quando mensagem menciona amanhã', async () => {
    const routed = await routeIntent('quem devo cobrar nos próximos 3 dias a partir de amanhã', []);
    expect(routed.intent).toBe('cobrar_periodo');
    expect(routed.normalizedEntities.window_start).toBe('tomorrow');
  });
});
