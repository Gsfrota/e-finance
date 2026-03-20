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

describe('conversation smoke (falando com o bot)', () => {
  const state = {
    context: {} as Record<string, unknown>,
  };

  function currentSession() {
    return {
      id: 'session-smoke',
      profile_id: 'profile-1',
      channel: 'telegram',
      channel_user_id: 'chat-1',
      context: state.context,
      profile: {
        id: 'profile-1',
        name: 'Admin',
        role: 'admin',
        tenant_id: 'tenant-1',
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    state.context = {};

    mocks.getOrCreateSession.mockImplementation(async () => currentSession());
    mocks.syncSessionProfileFromChannelBinding.mockImplementation(async (session: any) => ({
      session,
      changed: false,
      oldProfileId: session.profile_id || null,
      newProfileId: session.profile_id || null,
      reason: 'matched',
    }));
    mocks.getRecentMessages.mockResolvedValue([]);
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.updateSessionContext.mockImplementation(async (_sessionId: string, ctx: Record<string, unknown>) => {
      state.context = ctx;
    });
    mocks.clearSessionContext.mockImplementation(async () => {
      state.context = {};
    });
    mocks.linkProfileToSession.mockResolvedValue(undefined);

    mocks.getDashboardSummary.mockResolvedValue({
      receivedMonth: 1000,
      receivedByPaymentMonth: 1000,
      receivedByDueMonth: 750,
      expectedMonth: 2000,
      totalOverdue: 300,
      activeContracts: 5,
      overdueContracts: 2,
    });

    mocks.getInstallments.mockResolvedValue([
      { id: 'inst-1', investmentId: 'inv-1', debtorName: 'Carlos', amount: 900, dueDate: '2026-03-10', status: 'pending', daysLate: 0 },
      { id: 'inst-2', investmentId: 'inv-2', debtorName: 'Ana', amount: 700, dueDate: '2026-03-11', status: 'pending', daysLate: 0 },
    ]);

    mocks.getInstallmentsInWindow.mockResolvedValue([
      { id: 'inst-w-1', investmentId: 'inv-w-1', debtorName: 'Carlos', amount: 300, dueDate: '2026-03-12', status: 'pending', daysLate: 0 },
    ]);
    mocks.getInstallmentsByDateRange.mockResolvedValue([
      { id: 'inst-w-1', investmentId: 'inv-w-1', debtorName: 'Carlos', amount: 300, dueDate: '2026-03-12', status: 'pending', daysLate: 0 },
    ]);

    mocks.getDebtorsToCollectInWindow.mockResolvedValue([
      { name: 'Carlos', totalDue: 300, installmentCount: 1, oldestDueDate: '2026-03-12', daysLate: 0 },
    ]);
    mocks.getDebtorsToCollectByDateRange.mockResolvedValue([
      { name: 'Carlos', totalDue: 300, installmentCount: 1, oldestDueDate: '2026-03-12', daysLate: 0 },
    ]);

    mocks.buildDateWindow.mockReturnValue({
      daysAhead: 7,
      windowStart: 'today',
      startDate: '2026-03-05',
      endDate: '2026-03-11',
    });

    mocks.getInstallmentsToday.mockResolvedValue([]);
    mocks.getDebtorsToCollectToday.mockResolvedValue([]);
    mocks.generateMonthlyReport.mockResolvedValue({
      dashboard: { receivedMonth: 0, receivedByPaymentMonth: 0, receivedByDueMonth: 0, expectedMonth: 0, totalOverdue: 0, activeContracts: 0, overdueContracts: 0 },
      overdueDebtors: [],
      todayInstallments: [],
      topDebtors: [],
    });

    mocks.parseContractTextWithMeta.mockImplementation(async (text: string) => {
      if (/ana paula|r\$\s*4\.000|8 parcelas/i.test(text)) {
        return {
          draft: {
            debtor_name: 'Ana Paula',
            amount: 4000,
            rate: 2,
            installments: 8,
            frequency: 'monthly',
          },
          mode: 'deterministic',
        };
      }
      return { draft: null, mode: 'failed', reason: 'missing_fields' };
    });

    mocks.createContract.mockResolvedValue({
      status: 'success',
      id: 123,
      debtorName: 'Ana Paula',
      debtorCpf: '52998224725',
      firstInstallment: '01/04/2026 - R$ 500.00',
      debtorResolution: 'created',
    });

    mocks.getContractOpenInstallments.mockResolvedValue({
      items: [
        { id: 'inst-1', number: 1, contractId: 123, debtorName: 'Ana Paula', amount: 500, dueDate: '2026-04-01', status: 'pending' },
        { id: 'inst-2', number: 2, contractId: 123, debtorName: 'Ana Paula', amount: 500, dueDate: '2026-05-01', status: 'pending' },
        { id: 'inst-3', number: 3, contractId: 123, debtorName: 'Ana Paula', amount: 500, dueDate: '2026-06-01', status: 'pending' },
      ],
      page: 0,
      pageSize: 3,
      total: 8,
      hasMore: true,
    });

    mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
      id: 'inst-2',
      number: 2,
      contractId: 123,
      debtorName: 'Ana Paula',
      amount: 500,
      dueDate: '2026-05-01',
      status: 'pending',
    });
    mocks.getInstallmentByDebtorAndMonth.mockResolvedValue(null);

    mocks.markInstallmentPaid.mockResolvedValue(true);
    mocks.searchUser.mockResolvedValue([]);
    mocks.getUserDebt.mockResolvedValue(0);
    mocks.generateInvite.mockResolvedValue('INV123');
    mocks.validateLinkCode.mockResolvedValue({ status: 'invalid_or_expired' });
    mocks.disconnectBot.mockResolvedValue(true);
    mocks.transcribeAudioDetailed.mockResolvedValue({
      text: 'audio transcrito',
      quality: 'ok',
      usedFilesApi: false,
      durationMs: 140,
    });
    mocks.inferInstallmentMonth.mockReturnValue({});

    mocks.routeIntent.mockImplementation(async (text: string) => {
      const t = text.toLowerCase().trim();

      if (/dashboard|resumo|como tá o mês|como ta o mes|^1$/.test(t)) {
        return { intent: 'ver_dashboard', entities: {}, normalizedEntities: {}, confidence: 'high', source: 'rule' };
      }

      if (/marcar pagamento|^4$/.test(t)) {
        return { intent: 'marcar_pagamento', entities: {}, normalizedEntities: {}, confidence: 'high', source: 'rule' };
      }

      if (/^3$|\/contrato|criar contrato|novo contrato/.test(t)) {
        return { intent: 'criar_contrato', entities: {}, normalizedEntities: {}, confidence: 'high', source: 'rule' };
      }

      if (/baixar contrato 123 parcela 2/.test(t)) {
        return {
          intent: 'marcar_pagamento',
          entities: {},
          normalizedEntities: { contract_id: 123, installment_number: 2 },
          confidence: 'high',
          source: 'rule',
        };
      }

      return { intent: 'desconhecido', entities: {}, normalizedEntities: {}, confidence: 'low', source: 'llm' };
    });
  });

  it('mantém conversa útil e executa fluxo de contrato CPF-first + baixa por contrato', async () => {
    const ask = async (text: string, id: string) => {
      const out = await handleMessage({
        messageId: id,
        channel: 'telegram',
        channelUserId: 'chat-1',
        senderName: 'Admin',
        text,
      });
      return out.text;
    };

    const r1 = await ask('como tá o mês?', 'smk-1');
    expect(r1).toContain('Dashboard');

    const r2 = await ask('3', 'smk-2');
    expect(r2).toContain('nome completo do devedor');

    const r3 = await ask('Ana Paula, R$ 4.000, 2% ao mês, 8 parcelas', 'smk-3');
    expect(r3).toContain('CPF do devedor');

    const r4 = await ask('529.982.247-25', 'smk-4');
    // parseContractTextWithMeta já retornou frequency='monthly', então pula step 15 e vai p/ step 16
    expect(r4).toContain('dia do mês');

    const r5 = await ask('10', 'smk-5');
    expect(r5).toContain('Confirma?');

    const r6 = await ask('sim', 'smk-6');
    expect(r6).toContain('Contrato #123');
    expect(r6).toContain('baixar contrato 123');

    const r7 = await ask('baixar contrato 123 parcela 2', 'smk-7');
    expect(r7).toContain('Confirma a baixa desta parcela?');

    const r8 = await ask('sim', 'smk-8');
    expect(r8).toContain('Comprovante de Pagamento');
    expect(r8).toContain('#123');
  });
});
