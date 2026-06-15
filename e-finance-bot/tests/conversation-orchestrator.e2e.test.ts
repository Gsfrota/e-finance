/**
 * E2E do conversation-orchestrator:
 *  - Cenário A: query simples (show_dashboard) → resposta direta
 *  - Cenário B: mutation com preview (disconnect_bot) → para no preview
 *  - Cenário C: tool retorna preview → orchestrator NÃO chama mais tools
 *  - Cenário D: serialização de mutations + paralelização de queries
 *  - Cenário E: circuit-breaker abre após N falhas
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // Gemini: cada chamada `generateContent` consome a próxima resposta
  generateContent: vi.fn(),

  // Supabase tenant config (cache do system-prompt-builder)
  loadTenantAiConfig: vi.fn(),

  // Session/working-state
  updateSessionContext: vi.fn().mockResolvedValue(undefined),

  // admin-actions handlers usados em queries
  getDashboardSummary: vi.fn(),
  getInstallments: vi.fn(),
  getDebtorsToCollectInWindow: vi.fn(),
  getDebtorsToCollectByDateRange: vi.fn(),
  generateMonthlyReport: vi.fn(),
  searchUser: vi.fn(),
  getUserDebtDetails: vi.fn(),
  getUserDebt: vi.fn(),
  getInvestorPortfolio: vi.fn(),
  generateInvite: vi.fn(),
  getProfileById: vi.fn(),
  getContractOpenInstallments: vi.fn(),
  getContractOpenInstallmentByNumber: vi.fn(),
  getContractOpenInstallmentByMonth: vi.fn(),
  getInstallmentByDebtorAndMonth: vi.fn(),

  getBotTenantConfig: vi.fn(),
  upsertBotTenantConfig: vi.fn(),
  buildBriefingMessage: vi.fn(),
}));

vi.mock('../src/config', () => ({
  config: {
    supabase: { url: '', serviceRoleKey: '' },
    gemini: { apiKey: 'fake-key' },
    assistant: {
      workingStateTtlMs: 30 * 60 * 1000,
      confirmationTtlMs: 10 * 60 * 1000,
    },
    aiNative: { timeoutMs: 15000 },
  },
}));

vi.mock('../src/infra/runtime-clients', () => ({
  getGeminiClient: () => ({ models: { generateContent: mocks.generateContent } }),
  hasGeminiClient: () => true,
  getSupabaseClient: () => ({}),
}));

vi.mock('../src/ai/system-prompt-builder', async () => {
  const actual: any = await vi.importActual('../src/ai/system-prompt-builder');
  return {
    ...actual,
    loadTenantAiConfig: mocks.loadTenantAiConfig,
  };
});

vi.mock('../src/session/session-manager', () => ({
  updateSessionContext: mocks.updateSessionContext,
}));

vi.mock('../src/actions/admin-actions', () => ({
  getDashboardSummary: mocks.getDashboardSummary,
  getInstallments: mocks.getInstallments,
  getDebtorsToCollectInWindow: mocks.getDebtorsToCollectInWindow,
  getDebtorsToCollectByDateRange: mocks.getDebtorsToCollectByDateRange,
  generateMonthlyReport: mocks.generateMonthlyReport,
  searchUser: mocks.searchUser,
  getUserDebtDetails: mocks.getUserDebtDetails,
  getUserDebt: mocks.getUserDebt,
  getInvestorPortfolio: mocks.getInvestorPortfolio,
  generateInvite: mocks.generateInvite,
  getProfileById: mocks.getProfileById,
  getContractOpenInstallments: mocks.getContractOpenInstallments,
  getContractOpenInstallmentByNumber: mocks.getContractOpenInstallmentByNumber,
  getContractOpenInstallmentByMonth: mocks.getContractOpenInstallmentByMonth,
  getInstallmentByDebtorAndMonth: mocks.getInstallmentByDebtorAndMonth,
  isValidCpf: (value?: string | null) => value === '52998224725',
  normalizeCpf: (value?: string | null) => {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    return digits.length === 11 ? digits : null;
  },
  formatDate: (value: string) => value,
}));

vi.mock('../src/actions/bot-config-actions', () => ({
  getBotTenantConfig: mocks.getBotTenantConfig,
  upsertBotTenantConfig: mocks.upsertBotTenantConfig,
}));

vi.mock('../src/scheduler/morning-briefing', () => ({
  buildBriefingMessage: mocks.buildBriefingMessage,
}));

vi.mock('../src/observability/logger', () => ({
  logStructuredMessage: vi.fn(),
}));

import { runConversation, __resetCircuitBreakerForTests } from '../src/ai/conversation-orchestrator';

const TENANT_CONFIG = {
  tenantId: 'tenant-1',
  tenantName: 'Tenant Teste',
  aiEnabled: true,
  personaName: 'Salomão',
  tone: 'casual' as const,
  systemPrompt: null,
  faqEntries: [],
  modelPreference: 'flash' as const,
  monthlyBudgetCents: 10000,
  currentMonthCentsSpent: 0,
};

function buildSession() {
  return {
    id: 'session-1',
    profile_id: 'profile-admin',
    channel: 'whatsapp' as const,
    channel_user_id: '5511999999999',
    context: {},
    profile: {
      id: 'profile-admin',
      name: 'Admin Teste',
      role: 'admin' as const,
      tenant_id: 'tenant-1',
    },
  };
}

function geminiTextResponse(text: string) {
  return {
    text,
    functionCalls: [],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
  };
}

function geminiToolResponse(calls: Array<{ name: string; args: Record<string, unknown> }>) {
  return {
    text: '',
    functionCalls: calls,
    usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 30 },
  };
}

describe('conversation-orchestrator E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCircuitBreakerForTests();
    mocks.loadTenantAiConfig.mockResolvedValue(TENANT_CONFIG);
  });

  it('Cenário A: query show_dashboard → tool retorna data → LLM gera texto natural', async () => {
    mocks.getDashboardSummary.mockResolvedValue({
      activeContracts: 5,
      overdueContracts: 1,
      totalOverdue: 1500,
      expectedMonth: 8000,
      receivedMonth: 3000,
    });

    // 1ª chamada: LLM decide chamar show_dashboard
    // 2ª chamada: LLM com resultado da tool gera texto
    mocks.generateContent
      .mockResolvedValueOnce(geminiToolResponse([{ name: 'show_dashboard', args: {} }]))
      .mockResolvedValueOnce(geminiTextResponse('Você tem 5 contratos ativos. R$ 1500 em atraso.'));

    const result = await runConversation({
      session: buildSession(),
      userMessage: 'me mostra o dashboard',
      history: [],
      hasPendingConfirmation: false,
      turnId: 'turn-A',
    });

    expect(result.source).toBe('llm');
    expect(result.reply).toContain('contratos');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('show_dashboard');
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
  });

  it('Cenário B: mutation disconnect_bot → orchestrator PARA no preview e não chama LLM de novo', async () => {
    mocks.generateContent.mockResolvedValueOnce(geminiToolResponse([{ name: 'disconnect_bot', args: {} }]));

    const result = await runConversation({
      session: buildSession(),
      userMessage: 'me desconecta',
      history: [],
      hasPendingConfirmation: false,
      turnId: 'turn-B',
    });

    expect(result.source).toBe('llm');
    expect(result.reply).toMatch(/desconectar/i);
    expect(result.reply).toMatch(/\*sim\*/);
    // CRÍTICO P1: somente 1 chamada Gemini (parou no preview)
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.outcome.kind).toBe('preview');
  });

  it('Cenário C: mutation create_contract com CPF válido → preview imediato', async () => {
    mocks.generateContent.mockResolvedValueOnce(geminiToolResponse([{
      name: 'create_contract',
      args: {
        debtor_name: 'João Silva',
        debtor_cpf: '52998224725',
        amount: 5000,
        rate: 5,
        installments: 10,
        frequency: 'monthly',
        due_day: 15,
      },
    }]));

    const result = await runConversation({
      session: buildSession(),
      userMessage: 'criar contrato 5 mil pro João CPF 52998224725 em 10x',
      history: [],
      hasPendingConfirmation: false,
      turnId: 'turn-C',
    });

    expect(result.source).toBe('llm');
    expect(result.reply).toContain('João Silva');
    expect(result.reply).toContain('***.***.***-25');
    expect(result.reply).toMatch(/sim|não/i);
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it('Cenário D: paralelização de queries (P8) — 2 queries no mesmo turno', async () => {
    mocks.getDashboardSummary.mockResolvedValue({
      activeContracts: 3, overdueContracts: 0, totalOverdue: 0, expectedMonth: 5000, receivedMonth: 2000,
    });
    mocks.getInstallments.mockResolvedValue([]);
    mocks.generateContent
      .mockResolvedValueOnce(geminiToolResponse([
        { name: 'show_dashboard', args: {} },
        { name: 'list_receivables', args: { filter: 'pending' } },
      ]))
      .mockResolvedValueOnce(geminiTextResponse('Resumo: 3 contratos. Sem parcelas pendentes.'));

    const result = await runConversation({
      session: buildSession(),
      userMessage: 'dashboard e recebíveis',
      history: [],
      hasPendingConfirmation: false,
      turnId: 'turn-D',
    });

    expect(result.toolCalls).toHaveLength(2);
    expect(result.source).toBe('llm');
  });

  it('Cenário E: circuit-breaker abre após 5 falhas', async () => {
    // Forçar 5 falhas em show_dashboard
    mocks.getDashboardSummary.mockRejectedValue(new Error('db down'));
    mocks.generateContent.mockResolvedValue(
      geminiToolResponse([{ name: 'show_dashboard', args: {} }]),
    );
    // Histórico de turnos não importa — o circuit-breaker é por (tenant, tool).
    for (let i = 0; i < 5; i++) {
      // cada turno: 1ª gemini call → tool falha → 2ª gemini gera texto fallback
      mocks.generateContent
        .mockResolvedValueOnce(geminiToolResponse([{ name: 'show_dashboard', args: {} }]))
        .mockResolvedValueOnce(geminiTextResponse('Não consegui buscar agora.'));
      await runConversation({
        session: buildSession(),
        userMessage: 'dashboard',
        history: [],
        hasPendingConfirmation: false,
        turnId: `turn-E-${i}`,
      });
    }

    // Chamadas reais à action devem existir, mas no 6º turno a tool é bloqueada
    const callsBefore = mocks.getDashboardSummary.mock.calls.length;

    mocks.generateContent
      .mockResolvedValueOnce(geminiToolResponse([{ name: 'show_dashboard', args: {} }]))
      .mockResolvedValueOnce(geminiTextResponse('Resposta após circuit'));
    await runConversation({
      session: buildSession(),
      userMessage: 'dashboard de novo',
      history: [],
      hasPendingConfirmation: false,
      turnId: 'turn-E-blocked',
    });

    // Tool não deve ter sido chamada porque o circuit está aberto
    expect(mocks.getDashboardSummary.mock.calls.length).toBe(callsBefore);
  });
});
