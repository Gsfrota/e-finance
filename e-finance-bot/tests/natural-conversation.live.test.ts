/**
 * Conversa natural REAL contra Gemini.
 *
 * Para rodar: GEMINI_API_KEY=... npm test -- tests/natural-conversation.live.test.ts
 * (skip automaticamente se a chave não estiver setada).
 *
 * Supabase mockado com fixtures do tenant 'Guilherme juros' (DB de prod).
 * Gemini é REAL — vê o user message e decide qual tool chamar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const HAS_GEMINI = !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
const REAL_TENANT = 'f1d6accc-3772-43de-abe0-2564aacd9df1';
const REAL_ADMIN_PROFILE = '0ae63248-f66d-4180-aaa6-fedb8d721862';

// NÃO mockamos infra/runtime-clients — queremos Gemini real
// Mockamos só Supabase (admin-actions e similares)

vi.mock('../src/session/session-manager', () => ({
  updateSessionContext: async () => {},
}));

vi.mock('../src/ai/system-prompt-builder', async () => {
  const actual: any = await vi.importActual('../src/ai/system-prompt-builder');
  return {
    ...actual,
    loadTenantAiConfig: async () => ({
      tenantId: REAL_TENANT,
      tenantName: 'Guilherme juros',
      aiEnabled: true,
      personaName: 'Salomão',
      tone: 'casual',
      systemPrompt: null,
      faqEntries: [],
      modelPreference: 'flash',
      monthlyBudgetCents: 100000, // R$ 1.000 — não bloquear
      currentMonthCentsSpent: 0,
    }),
  };
});

vi.mock('../src/actions/admin-actions', () => ({
  getDashboardSummary: async () => ({
    activeContracts: 8, overdueContracts: 0, totalOverdue: 0,
    expectedMonth: 100, receivedMonth: 0,
    receivedByPaymentMonth: 0, receivedByDueMonth: 0,
  }),
  getInstallments: async () => [
    { debtorName: 'Jubileu', amount: 100, dueDate: '2026-05-10', status: 'pending', daysLate: -11 },
    { debtorName: 'Teste', amount: 183.33, dueDate: '2026-09-10', status: 'pending', daysLate: -134 },
  ],
  getDebtorsToCollectInWindow: async () => [
    { name: 'Jubileu', totalDue: 100, installmentCount: 1, daysLate: 0, oldestDueDate: '2026-04-29' },
  ],
  getDebtorsToCollectByDateRange: async () => [],
  generateMonthlyReport: async () => ({
    dashboard: { activeContracts: 8, overdueContracts: 0, totalOverdue: 0, expectedMonth: 100, receivedMonth: 0 },
    overdueDebtors: [],
    topDebtors: [{ name: 'Jubileu', totalDebt: 400 }],
  }),
  searchUser: async () => [],
  getUserDebtDetails: async () => ({ totalDebt: 400, pendingInstallments: 4, nextDueDate: '2026-05-10', nextDueAmount: 100, activeContracts: 1 }),
  getUserDebt: async () => 400,
  getInvestorPortfolio: async () => ({ totalContracts: 0, totalReceivable: 0, totalReceived: 0, nextDueDate: null, nextDueAmount: 0 }),
  generateInvite: async () => 'INV123',
  getProfileById: async () => null,
  getContractOpenInstallments: async () => ({ items: [], page: 1, pageSize: 10, total: 0, hasMore: false }),
  getContractOpenInstallmentByNumber: async () => null,
  getContractOpenInstallmentByMonth: async () => null,
  getInstallmentByDebtorAndMonth: async () => null,
  isValidCpf: (v?: string | null) => v === '52998224725' || (typeof v === 'string' && /^\d{11}$/.test(v)),
  normalizeCpf: (v?: string | null) => {
    if (!v) return null;
    const d = String(v).replace(/\D/g, '');
    return d.length === 11 ? d : null;
  },
  formatDate: (v: string) => v,
}));

vi.mock('../src/actions/bot-config-actions', () => ({
  getBotTenantConfig: async () => ({ morning_briefing_enabled: true, morning_briefing_time: '07:30' }),
  upsertBotTenantConfig: async () => {},
}));

vi.mock('../src/scheduler/morning-briefing', () => ({
  buildBriefingMessage: async () => 'Bom dia Guilherme! Hoje você tem 1 cobrança...',
}));

vi.mock('../src/observability/logger', () => ({
  logStructuredMessage: (event: string, payload: Record<string, unknown>) => {
    if (event.includes('error') || event.includes('timeout') || event.includes('failed')) {
      console.log(`  [log:${event}]`, JSON.stringify(payload).slice(0, 500));
    }
  },
}));

import { runConversation, __resetCircuitBreakerForTests } from '../src/ai/conversation-orchestrator';

function buildSession() {
  return {
    id: 'session-natural-test',
    profile_id: REAL_ADMIN_PROFILE,
    channel: 'whatsapp' as const,
    channel_user_id: '5511999999999',
    context: {},
    profile: {
      id: REAL_ADMIN_PROFILE,
      name: 'Guilherme',
      role: 'admin' as const,
      tenant_id: REAL_TENANT,
    },
  } as any;
}

async function ask(userMessage: string, history: Array<{ role: 'user'|'model'; text: string }>) {
  console.log('\n═══════════════════════════════════════════════');
  console.log('USER  →', userMessage);
  const t0 = Date.now();
  const result = await runConversation({
    session: buildSession(),
    userMessage,
    history,
    hasPendingConfirmation: false,
    turnId: `nat-${Date.now()}`,
  });
  const ms = Date.now() - t0;
  console.log(`\nBOT   ← (${result.source}, ${ms}ms, in=${result.tokensIn} out=${result.tokensOut} tok)`);
  console.log(result.reply);
  if (result.toolCalls.length > 0) {
    console.log('\n  tool calls:');
    for (const tc of result.toolCalls) {
      const argStr = JSON.stringify(tc.args);
      console.log(`   • ${tc.name}(${argStr.length > 80 ? argStr.slice(0, 80) + '...' : argStr}) → ${tc.outcome.kind}`);
    }
  }
  return result;
}

describe.skipIf(!HAS_GEMINI)('Conversa natural — Gemini real', () => {
  beforeEach(() => __resetCircuitBreakerForTests());

  it('cenário multi-turn: saudação → cobranças do dia → criar contrato', async () => {
    const history: Array<{ role: 'user'|'model'; text: string }> = [];

    // Turno 1: saudação informal
    const r1 = await ask('oi, tudo bem?', history);
    expect(r1.reply.length).toBeGreaterThan(0);
    history.push({ role: 'user', text: 'oi, tudo bem?' });
    history.push({ role: 'model', text: r1.reply });

    // Turno 2: pergunta operacional natural
    const r2 = await ask('quem tá me devendo hoje?', history);
    expect(r2.reply.length).toBeGreaterThan(0);
    // espera-se que tenha chamado list_collection_targets ou query_collection_window
    history.push({ role: 'user', text: 'quem tá me devendo hoje?' });
    history.push({ role: 'model', text: r2.reply });

    // Turno 3: mutation incompleta — deve pedir mais info ou listar opções
    const r3 = await ask('quero criar um contrato', history);
    expect(r3.reply.length).toBeGreaterThan(0);
    // Expectativa: ou pede CPF/valor, ou tenta create_contract sem CPF e falha graciosamente

    // Turno 4: dados completos — deve gerar preview
    const r4 = await ask(
      'criar contrato pro João Silva CPF 529.982.247-25 valor 2 mil em 10 vezes mensais dia 15',
      history,
    );
    expect(r4.reply.length).toBeGreaterThan(0);
    // Esperamos ver "***.***.***-25" no preview se a tool foi chamada com CPF correto
    if (r4.toolCalls.some(tc => tc.name === 'create_contract' && tc.outcome.kind === 'preview')) {
      expect(r4.reply).toMatch(/sim|não|confirma/i);
    }
  }, 60_000); // 60s pra Gemini responder
});

describe.skipIf(HAS_GEMINI)('Conversa natural — pulada', () => {
  it('GEMINI_API_KEY não setada — pulando', () => {
    expect(true).toBe(true);
  });
});
