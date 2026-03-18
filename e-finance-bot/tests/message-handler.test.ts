import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routeIntent: vi.fn(),
  transcribeAudioDetailed: vi.fn(),
  analyzeImage: vi.fn(),
  inferInstallmentMonth: vi.fn(),

  getOrCreateSession: vi.fn(),
  syncSessionProfileFromChannelBinding: vi.fn(),
  updateSessionContext: vi.fn(),
  clearSessionContext: vi.fn(),
  linkProfileToSession: vi.fn(),
  saveMessage: vi.fn(),
  getRecentMessages: vi.fn(),

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
  getUserDebtDetails: vi.fn(),
  generateInvite: vi.fn(),
  validateLinkCode: vi.fn(),
  disconnectBot: vi.fn(),
  getContractOpenInstallments: vi.fn(),
  getContractOpenInstallmentByNumber: vi.fn(),
  getInstallmentByDebtorAndMonth: vi.fn(),

  logStructuredMessage: vi.fn(),
}));

vi.mock('../src/ai/intent-router', () => ({
  routeIntent: mocks.routeIntent,
}));

vi.mock('../src/ai/intent-classifier', () => ({
  analyzeImage: mocks.analyzeImage,
  inferInstallmentMonth: mocks.inferInstallmentMonth,
}));

vi.mock('../src/ai/audio-pipeline', () => ({
  transcribeAudioDetailed: mocks.transcribeAudioDetailed,
}));

vi.mock('../src/session/session-manager', () => ({
  getOrCreateSession: mocks.getOrCreateSession,
  syncSessionProfileFromChannelBinding: mocks.syncSessionProfileFromChannelBinding,
  updateSessionContext: mocks.updateSessionContext,
  clearSessionContext: mocks.clearSessionContext,
  linkProfileToSession: mocks.linkProfileToSession,
  saveMessage: mocks.saveMessage,
  getRecentMessages: mocks.getRecentMessages,
}));

vi.mock('../src/actions/admin-actions', () => ({
  getDashboardSummary: mocks.getDashboardSummary,
  getInstallments: mocks.getInstallments,
  getInstallmentsToday: mocks.getInstallmentsToday,
  getDebtorsToCollectToday: mocks.getDebtorsToCollectToday,
  getInstallmentsInWindow: mocks.getInstallmentsInWindow,
  getDebtorsToCollectInWindow: mocks.getDebtorsToCollectInWindow,
  getInstallmentsByDateRange: mocks.getInstallmentsByDateRange,
  getDebtorsToCollectByDateRange: mocks.getDebtorsToCollectByDateRange,
  buildDateWindow: mocks.buildDateWindow,
  generateMonthlyReport: mocks.generateMonthlyReport,
  parseContractTextWithMeta: mocks.parseContractTextWithMeta,
  createContract: mocks.createContract,
  markInstallmentPaid: mocks.markInstallmentPaid,
  searchUser: mocks.searchUser,
  getUserDebt: mocks.getUserDebt,
  getUserDebtDetails: mocks.getUserDebtDetails,
  generateInvite: mocks.generateInvite,
  validateLinkCode: mocks.validateLinkCode,
  disconnectBot: mocks.disconnectBot,
  getContractOpenInstallments: mocks.getContractOpenInstallments,
  getContractOpenInstallmentByNumber: mocks.getContractOpenInstallmentByNumber,
  getInstallmentByDebtorAndMonth: mocks.getInstallmentByDebtorAndMonth,
  normalizeCpf: (value?: string | null) => {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    return digits.length === 11 ? digits : null;
  },
  isValidCpf: (value?: string | null) => value === '52998224725',
  formatCurrency: (value: number) => `R$ ${value.toFixed(2)}`,
  formatDate: (value: string) => value,
  extractDebtorNameSimple: (text: string) => {
    const cleaned = text.replace(/cpf\s*[:\-]?\s*\d[\d.\-]*/gi, '').replace(/r\$\s*[\d.,]+\s*(mil|k)?/gi, '').replace(/\d+\s*(%|por\s*cento|parcelas?|x|vezes)/gi, '').trim();
    const match = cleaned.match(/^([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)*)/);
    return match?.[1] && match[1].length >= 3 ? match[1] : null;
  },
  extractAmount: (text: string) => {
    const m = text.match(/r\$\s*([0-9][0-9.]*[0-9](?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*(mil|k)?/i)
      || text.match(/([0-9]+(?:[.,][0-9]+)?)\s*(mil|k)\b/i)
      || text.match(/([0-9][0-9.]*[0-9](?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*(mil|k)?\s*reais?/i);
    if (!m?.[1]) return null;
    const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * (/mil|k/i.test(m[2] || '') ? 1000 : 1);
    return v >= 100 ? v : null;
  },
  extractRate: (text: string) => {
    const m = text.match(/(\d+(?:[.,]\d+)?)\s*%/) || text.match(/(\d+(?:[.,]\d+)?)\s*(?:por\s*cento|porcento)/i);
    return m?.[1] ? parseFloat(m[1].replace(',', '.')) : null;
  },
  extractInstallments: (text: string) => {
    const m = text.match(/(\d{1,3})\s*(?:x|parcelas?|vezes)/i);
    if (!m?.[1]) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
  },
}));

vi.mock('../src/observability/logger', () => ({
  logStructuredMessage: mocks.logStructuredMessage,
}));

import { handleMessage } from '../src/handlers/message-handler';

function buildAdminSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    profile_id: 'profile-1',
    channel: 'telegram',
    channel_user_id: 'chat-1',
    context: {},
    profile: {
      id: 'profile-1',
      name: 'Admin',
      role: 'admin',
      tenant_id: 'tenant-1',
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.getOrCreateSession.mockResolvedValue(buildAdminSession());
  mocks.syncSessionProfileFromChannelBinding.mockImplementation(async (session: any) => ({
    session,
    changed: false,
    oldProfileId: session.profile_id || null,
    newProfileId: session.profile_id || null,
    reason: 'matched',
  }));
  mocks.getRecentMessages.mockResolvedValue([]);
  mocks.saveMessage.mockResolvedValue(undefined);
  mocks.updateSessionContext.mockResolvedValue(undefined);
  mocks.clearSessionContext.mockResolvedValue(undefined);
  mocks.linkProfileToSession.mockResolvedValue(undefined);

  mocks.routeIntent.mockResolvedValue({
    intent: 'ver_dashboard',
    entities: {},
    normalizedEntities: {},
    confidence: 'high',
    source: 'rule',
  });

  mocks.getDashboardSummary.mockResolvedValue({
    receivedMonth: 1000,
    receivedByPaymentMonth: 1000,
    receivedByDueMonth: 800,
    expectedMonth: 1500,
    totalOverdue: 300,
    activeContracts: 4,
    overdueContracts: 1,
  });

  mocks.getInstallments.mockResolvedValue([]);
  mocks.getInstallmentsToday.mockResolvedValue([]);
  mocks.getDebtorsToCollectToday.mockResolvedValue([]);
  mocks.getInstallmentsInWindow.mockResolvedValue([]);
  mocks.getDebtorsToCollectInWindow.mockResolvedValue([]);
  mocks.getInstallmentsByDateRange.mockResolvedValue([]);
  mocks.getDebtorsToCollectByDateRange.mockResolvedValue([]);
  mocks.buildDateWindow.mockReturnValue({
    daysAhead: 7,
    windowStart: 'today',
    startDate: '2026-03-05',
    endDate: '2026-03-11',
  });
  mocks.generateMonthlyReport.mockResolvedValue({
    dashboard: {
      receivedMonth: 0,
      receivedByPaymentMonth: 0,
      receivedByDueMonth: 0,
      expectedMonth: 0,
      totalOverdue: 0,
      activeContracts: 0,
      overdueContracts: 0,
    },
    overdueDebtors: [],
    todayInstallments: [],
    topDebtors: [],
  });

  mocks.parseContractTextWithMeta.mockResolvedValue({ draft: null, mode: 'failed', reason: 'missing_fields' });
  mocks.createContract.mockResolvedValue({
    status: 'success',
    id: 42,
    debtorName: 'Maria',
    debtorCpf: '52998224725',
    firstInstallment: '2026-04-01 - R$ 1000',
    debtorResolution: 'created',
  });
  mocks.markInstallmentPaid.mockResolvedValue(true);
  mocks.searchUser.mockResolvedValue([]);
  mocks.getUserDebt.mockResolvedValue(0);
  mocks.getUserDebtDetails.mockResolvedValue({
    totalDebt: 0,
    pendingInstallments: 0,
    nextDueDate: null,
    nextDueAmount: 0,
    activeContracts: 0,
  });
  mocks.generateInvite.mockResolvedValue('ABC123');
  mocks.validateLinkCode.mockResolvedValue({ status: 'invalid_or_expired' });
  mocks.disconnectBot.mockResolvedValue(true);
  mocks.getContractOpenInstallments.mockResolvedValue({
    items: [
      { id: 'inst-1', number: 1, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-03-10', status: 'pending' },
      { id: 'inst-2', number: 2, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-04-10', status: 'pending' },
      { id: 'inst-3', number: 3, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-05-10', status: 'pending' },
    ],
    page: 0,
    pageSize: 3,
    total: 5,
    hasMore: true,
  });
  mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
    id: 'inst-2',
    number: 2,
    contractId: 123,
    debtorName: 'Carlos',
    amount: 900,
    dueDate: '2026-04-10',
    status: 'pending',
  });
  mocks.getInstallmentByDebtorAndMonth.mockResolvedValue(null);
  mocks.transcribeAudioDetailed.mockResolvedValue({
    text: 'audio transcrito',
    quality: 'ok',
    usedFilesApi: false,
    durationMs: 120,
  });
  mocks.inferInstallmentMonth.mockReturnValue({});
});

describe('handleMessage', () => {
  it('faz clarificação quando confiança é baixa', async () => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'desconhecido',
      entities: {},
      normalizedEntities: {},
      confidence: 'low',
      source: 'llm',
    });

    const out = await handleMessage({
      messageId: 'm-low',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'faz aquele negócio lá',
    });

    expect(out.text).toContain('Ainda não fechei sua ação com segurança');
    expect(mocks.getDashboardSummary).not.toHaveBeenCalled();
  });

  it('fluxo criar contrato exige CPF quando não veio nas entidades', async () => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'criar_contrato',
      entities: {},
      normalizedEntities: {
        debtor_name: 'João Silva',
        amount: 5000,
        rate: 3,
        installments: 12,
        frequency: 'monthly',
      },
      confidence: 'high',
      source: 'rule',
    });

    const out = await handleMessage({
      messageId: 'm-contract-cpf',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'criar contrato',
    });

    expect(out.text).toContain('CPF do devedor');
    expect(mocks.updateSessionContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ pendingAction: 'criar_contrato', pendingStep: 11 })
    );
  });

  it('entra na confirmação de contrato quando entidades completas incluem CPF', async () => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'criar_contrato',
      entities: {},
      normalizedEntities: {
        debtor_name: 'João Silva',
        debtor_cpf: '52998224725',
        amount: 5000,
        rate: 3,
        installments: 12,
        frequency: 'monthly',
      },
      confidence: 'high',
      source: 'llm',
    });

    const out = await handleMessage({
      messageId: 'm-contract-ready',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'cria contrato',
    });

    expect(out.text).toContain('Confirma?');
    expect(mocks.updateSessionContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ pendingAction: 'criar_contrato', pendingStep: 2 })
    );
  });

  it('captura CPF em step 11 e avança para confirmação', async () => {
    mocks.getOrCreateSession.mockResolvedValue(buildAdminSession({
      context: {
        pendingAction: 'criar_contrato',
        pendingStep: 11,
        pendingData: {
          debtor_name: 'Maria',
          amount: 3000,
          rate: 2,
          installments: 6,
          frequency: 'monthly',
        },
      },
    }));

    const out = await handleMessage({
      messageId: 'm-cpf-step',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'CPF 529.982.247-25',
    });

    expect(out.text).toContain('Confirma?');
    expect(mocks.updateSessionContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        pendingAction: 'criar_contrato',
        pendingStep: 2,
        pendingData: expect.objectContaining({ debtor_cpf: '52998224725' }),
      })
    );
  });

  it('quando há conflito CPF/nome entra no estado resolver_nome_cpf', async () => {
    mocks.getOrCreateSession.mockResolvedValue(buildAdminSession({
      context: {
        pendingAction: 'criar_contrato',
        pendingStep: 2,
        pendingData: {
          debtor_name: 'Novo Nome',
          debtor_cpf: '52998224725',
          amount: 3000,
          rate: 2,
          installments: 6,
          frequency: 'monthly',
        },
      },
    }));

    mocks.createContract.mockResolvedValueOnce({
      status: 'conflict_name',
      debtorCpf: '52998224725',
      existingName: 'Nome Antigo',
      requestedName: 'Novo Nome',
    });

    const out = await handleMessage({
      messageId: 'm-conflict',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'sim',
    });

    expect(out.text).toContain('CPF já cadastrado');
    expect(out.text).toContain('Usar nome cadastrado');
    expect(mocks.updateSessionContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ pendingAction: 'resolver_nome_cpf', pendingStep: 1 })
    );
  });

  it('em falha transitória ao criar contrato mantém contexto e oferece retry', async () => {
    mocks.getOrCreateSession.mockResolvedValue(buildAdminSession({
      context: {
        pendingAction: 'criar_contrato',
        pendingStep: 2,
        pendingData: {
          debtor_name: 'Novo Nome',
          debtor_cpf: '52998224725',
          amount: 3000,
          rate: 2,
          installments: 6,
          frequency: 'monthly',
        },
      },
    }));

    mocks.createContract.mockResolvedValueOnce({
      status: 'error',
      reason: 'rpc_failed',
    });

    const out = await handleMessage({
      messageId: 'm-retry-contract',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'sim',
    });

    expect(out.text).toContain('Falhou por instabilidade');
    expect(mocks.updateSessionContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        pendingAction: 'criar_contrato',
        pendingStep: 2,
        pendingData: expect.objectContaining({ retryCount: 1 }),
      })
    );
    expect(mocks.clearSessionContext).not.toHaveBeenCalled();
  });

  it('baixar contrato com parcela explícita vai direto para confirmação', async () => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'marcar_pagamento',
      entities: {},
      normalizedEntities: {
        contract_id: 123,
        installment_number: 2,
      },
      confidence: 'high',
      source: 'rule',
    });

    const out = await handleMessage({
      messageId: 'm-pay-contract',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'baixar contrato 123 parcela 2',
    });

    expect(out.text).toContain('Confirma a baixa desta parcela?');
    expect(mocks.updateSessionContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ pendingAction: 'marcar_pagamento_contrato', pendingStep: 2 })
    );
  });

  it('fluxo mostrar mais em baixa por contrato mantém paginação', async () => {
    mocks.getOrCreateSession.mockResolvedValue(buildAdminSession({
      context: {
        pendingAction: 'marcar_pagamento_contrato',
        pendingStep: 1,
        pendingData: {
          contractId: 123,
          page: 0,
          pageSize: 3,
          installmentsPreview: [
            { id: 'inst-1', number: 1, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-03-10', status: 'pending' },
            { id: 'inst-2', number: 2, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-04-10', status: 'pending' },
            { id: 'inst-3', number: 3, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-05-10', status: 'pending' },
          ],
        },
      },
    }));

    mocks.getContractOpenInstallments.mockResolvedValueOnce({
      items: [
        { id: 'inst-4', number: 4, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-06-10', status: 'pending' },
        { id: 'inst-5', number: 5, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-07-10', status: 'pending' },
      ],
      page: 1,
      pageSize: 3,
      total: 5,
      hasMore: false,
    });

    const out = await handleMessage({
      messageId: 'm-show-more',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'mostrar mais',
    });

    expect(out.text).toContain('Contrato #123');
    expect(out.text).toContain('Parcela 4');
    expect(mocks.updateSessionContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        pendingAction: 'marcar_pagamento_contrato',
        pendingStep: 1,
        pendingData: expect.objectContaining({ page: 1 }),
      })
    );
  });

  it('bloqueia tentativa de trocar conta via código quando chat já está vinculado', async () => {
    mocks.validateLinkCode.mockResolvedValue({
      status: 'already_linked_to_other_profile',
      currentProfileId: 'profile-1',
      currentProfileName: 'Admin Atual',
      codeProfileId: 'profile-2',
    });

    const out = await handleMessage({
      messageId: 'm-link-conflict',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'NVP1DJ',
    });

    expect(mocks.routeIntent).not.toHaveBeenCalled();
    expect(out.text).toContain('já está vinculado à conta');
  });

  it('quando busca encontra homônimos pede seleção com CPF', async () => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'buscar_usuario',
      entities: {},
      normalizedEntities: { debtor_name: 'Icaro' },
      confidence: 'high',
      source: 'rule',
    });

    mocks.searchUser.mockResolvedValue([
      { id: 'debtor-1', full_name: 'Icaro', role: 'debtor', cpf: '52998224725' },
      { id: 'debtor-2', full_name: 'Icaro Soares', role: 'debtor', cpf: '39053344705' },
    ]);

    const out = await handleMessage({
      messageId: 'm-search-dup',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'quanto o icaro me deve?',
    });

    expect(out.text).toContain('Qual deles');
    expect(out.text).toContain('CPF');
    expect(mocks.updateSessionContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        workingState: expect.objectContaining({
          lastAction: 'query_debtor_balance',
          pendingCapability: 'query_debtor_balance',
          pendingMissingFields: ['debtor_choice'],
        }),
      })
    );
  });

  it('ao escolher cliente da lista retorna resumo de dívida com próxima parcela', async () => {
    mocks.getOrCreateSession.mockResolvedValue(buildAdminSession({
      context: {
        pendingAction: 'buscar_usuario_selecao',
        pendingStep: 1,
        pendingData: {
          query: 'Icaro',
          candidates: [
            { id: 'debtor-1', full_name: 'Icaro', role: 'debtor', cpf: '52998224725' },
            { id: 'debtor-2', full_name: 'Icaro Soares', role: 'debtor', cpf: '39053344705' },
          ],
        },
      },
    }));

    mocks.getUserDebtDetails.mockResolvedValue({
      totalDebt: 2000,
      pendingInstallments: 10,
      nextDueDate: '2026-04-05',
      nextDueAmount: 200,
      activeContracts: 1,
    });

    const out = await handleMessage({
      messageId: 'm-search-select',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: '2',
    });

    expect(out.text).toContain('R$ 2000.00');
    expect(out.text).toContain('10 parcelas pendentes');
    expect(out.text).toContain('2026-04-05');
    expect(mocks.clearSessionContext).toHaveBeenCalledWith('session-1');
  });

  it('roteia em modo rapido sem buscar historico para intent forte', async () => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'ver_dashboard',
      entities: {},
      normalizedEntities: {},
      confidence: 'high',
      source: 'rule',
    });

    await handleMessage({
      messageId: 'm-fast-route',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: '/dashboard',
    });

    expect(mocks.getRecentMessages).not.toHaveBeenCalled();
    expect(mocks.routeIntent).toHaveBeenCalledTimes(1);
    expect(mocks.routeIntent.mock.calls[0][2]).toEqual(expect.objectContaining({ mode: 'fast' }));
  });

  it('cai para modo full quando fast nao fecha e busca historico', async () => {
    mocks.routeIntent
      .mockResolvedValueOnce({
        intent: 'desconhecido',
        entities: {},
        normalizedEntities: {},
        confidence: 'low',
        source: 'rule',
      })
      .mockResolvedValueOnce({
        intent: 'ver_dashboard',
        entities: {},
        normalizedEntities: {},
        confidence: 'high',
        source: 'llm',
      });

    mocks.getRecentMessages.mockResolvedValue([{ role: 'user', content: 'hist' }]);

    await handleMessage({
      messageId: 'm-full-route',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'quero uma visão geral do cliente',
    });

    expect(mocks.getRecentMessages).toHaveBeenCalledTimes(1);
    expect(mocks.routeIntent).toHaveBeenCalledTimes(2);
    expect(mocks.routeIntent.mock.calls[1][2]).toEqual(expect.objectContaining({ mode: 'full' }));
  });

  it('recusa áudio acima do limite com orientação objetiva', async () => {
    mocks.transcribeAudioDetailed.mockResolvedValue({
      text: '',
      quality: 'too_long',
      usedFilesApi: false,
      durationMs: 10,
      reason: 'duration_limit_exceeded',
    });

    const out = await handleMessage({
      messageId: 'm-audio-long',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      audioBuffer: Buffer.from('audio'),
      audioMimeType: 'audio/ogg',
      audioDurationSec: 120,
      audioKind: 'voice_note',
    });

    expect(out.text).toContain('passou de');
    expect(out.text).toContain('90s');
    expect(mocks.routeIntent).not.toHaveBeenCalled();
  });

  it('prefixa confirmação sensível com resumo do que entendeu do áudio', async () => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'criar_contrato',
      entities: {},
      normalizedEntities: {
        debtor_name: 'João Silva',
        debtor_cpf: '52998224725',
        amount: 5000,
        rate: 3,
        installments: 12,
        frequency: 'monthly',
      },
      confidence: 'high',
      source: 'rule',
    });

    mocks.transcribeAudioDetailed.mockResolvedValue({
      text: 'emprestimo para João Silva, CPF 52998224725, 5000 reais, 12 parcelas',
      quality: 'ok',
      usedFilesApi: false,
      durationMs: 180,
    });

    const out = await handleMessage({
      messageId: 'm-audio-confirm',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      audioBuffer: Buffer.from('audio'),
      audioMimeType: 'audio/ogg',
      audioDurationSec: 12,
      audioKind: 'voice_note',
    });

    expect(out.text).toContain('Entendi do áudio');
    expect(out.text).toContain('Resumo do Contrato');
  });

  it('áudio com pagamento por mês entra no fluxo de baixa com confirmação', async () => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'marcar_pagamento',
      entities: {},
      normalizedEntities: {
        debtor_name: 'Icaro',
        installment_month: 1,
        installment_year: 2026,
      },
      confidence: 'high',
      source: 'rule',
    });

    mocks.transcribeAudioDetailed.mockResolvedValue({
      text: 'dar baixa na parcela de janeiro do Icaro',
      quality: 'ok',
      usedFilesApi: false,
      durationMs: 160,
    });

    mocks.getInstallmentByDebtorAndMonth.mockResolvedValue({
      debtorName: 'Icaro Soares',
      installments: [
        {
          id: 'inst-jan',
          number: 1,
          contractId: 77,
          debtorName: 'Icaro Soares',
          amount: 200,
          dueDate: '2026-01-05',
          status: 'pending',
        },
      ],
    });

    const out = await handleMessage({
      messageId: 'm-audio-month',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      audioBuffer: Buffer.from('audio'),
      audioMimeType: 'audio/ogg',
      audioDurationSec: 9,
      audioKind: 'voice_note',
    });

    expect(out.text).toContain('Entendi do áudio');
    expect(out.text).toContain('Confirma a baixa desta parcela?');
    expect(mocks.updateSessionContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        pendingAction: 'marcar_pagamento_por_mes',
        pendingStep: 2,
      })
    );
  });
  it('responde recebíveis por janela com total previsto', async () => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'recebiveis_periodo',
      entities: {},
      normalizedEntities: { days_ahead: 7, window_start: 'today' },
      confidence: 'high',
      source: 'rule',
    });

    mocks.getInstallmentsByDateRange.mockResolvedValue([
      { id: 'w-1', investmentId: 'inv-1', debtorName: 'Carlos', amount: 200, dueDate: '2026-03-08', status: 'pending', daysLate: 0 },
      { id: 'w-2', investmentId: 'inv-2', debtorName: 'Ana', amount: 300, dueDate: '2026-03-09', status: 'pending', daysLate: 0 },
    ]);

    const out = await handleMessage({
      messageId: 'm-window-r',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'quanto vou receber nos próximos 7 dias?',
    });

    expect(out.text).toContain('Total previsto');
    expect(out.text).toContain('R$ 500.00');
    expect(mocks.getInstallmentsByDateRange).toHaveBeenCalledWith('tenant-1', '2026-03-05', '2026-03-11');
  });

  it('responde cobrança por janela a partir de amanhã', async () => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'cobrar_periodo',
      entities: {},
      normalizedEntities: { days_ahead: 3, window_start: 'tomorrow' },
      confidence: 'high',
      source: 'rule',
    });

    mocks.getDebtorsToCollectByDateRange.mockResolvedValue([
      { name: 'Carlos', totalDue: 450, installmentCount: 2, oldestDueDate: '2026-03-06', daysLate: 0 },
    ]);
    mocks.buildDateWindow.mockReturnValue({
      daysAhead: 3,
      windowStart: 'tomorrow',
      startDate: '2026-03-06',
      endDate: '2026-03-08',
    });

    const out = await handleMessage({
      messageId: 'm-window-c',
      channel: 'telegram',
      channelUserId: 'chat-1',
      senderName: 'User',
      text: 'a partir de amanhã, quem devo cobrar nos próximos 3 dias?',
    });

    expect(out.text).toContain('Total em aberto');
    expect(out.text).toContain('R$ 450.00');
    expect(mocks.getDebtorsToCollectByDateRange).toHaveBeenCalledWith('tenant-1', '2026-03-06', '2026-03-08');
  });


});
