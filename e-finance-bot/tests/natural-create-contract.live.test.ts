/**
 * Teste isolado: criar contrato completo via Gemini real com 2 variantes:
 *  A) Usuário fornece taxa explícita
 *  B) Usuário fornece valor total (back-calc de taxa)
 */
import { describe, expect, it, vi } from 'vitest';

const HAS_GEMINI = !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
const REAL_TENANT = 'f1d6accc-3772-43de-abe0-2564aacd9df1';
const REAL_ADMIN_PROFILE = '0ae63248-f66d-4180-aaa6-fedb8d721862';

vi.mock('../src/session/session-manager', () => ({
  updateSessionContext: async () => {},
}));

vi.mock('../src/ai/system-prompt-builder', async () => {
  const actual: any = await vi.importActual('../src/ai/system-prompt-builder');
  return {
    ...actual,
    loadTenantAiConfig: async () => ({
      tenantId: REAL_TENANT, tenantName: 'Guilherme juros', aiEnabled: true,
      personaName: 'Salomão', tone: 'casual', systemPrompt: null, faqEntries: [],
      modelPreference: 'flash', monthlyBudgetCents: 100000, currentMonthCentsSpent: 0,
    }),
  };
});

vi.mock('../src/actions/admin-actions', () => ({
  getDashboardSummary: async () => ({ activeContracts: 8, overdueContracts: 0, totalOverdue: 0, expectedMonth: 100, receivedMonth: 0, receivedByPaymentMonth: 0, receivedByDueMonth: 0 }),
  getInstallments: async () => [],
  getDebtorsToCollectInWindow: async () => [],
  getDebtorsToCollectByDateRange: async () => [],
  generateMonthlyReport: async () => ({ dashboard: {}, overdueDebtors: [], topDebtors: [] }),
  searchUser: async () => [],
  getUserDebtDetails: async () => null,
  getUserDebt: async () => 0,
  getInvestorPortfolio: async () => null,
  generateInvite: async () => 'INV',
  getProfileById: async () => null,
  getContractOpenInstallments: async () => ({ items: [], page: 1, pageSize: 10, total: 0, hasMore: false }),
  getContractOpenInstallmentByNumber: async () => null,
  getContractOpenInstallmentByMonth: async () => null,
  getInstallmentByDebtorAndMonth: async () => null,
  isValidCpf: (v?: string | null) => !!(v && /^\d{11}$/.test(String(v).replace(/\D/g, ''))),
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
  buildBriefingMessage: async () => 'Bom dia!',
}));

vi.mock('../src/observability/logger', () => ({
  logStructuredMessage: (event: string, payload: Record<string, unknown>) => {
    if (event.includes('error') || event.includes('failed')) {
      console.log(`  [log:${event}]`, JSON.stringify(payload).slice(0, 300));
    }
  },
}));

import { runConversation, __resetCircuitBreakerForTests } from '../src/ai/conversation-orchestrator';

function buildSession() {
  return {
    id: 'session-cc',
    profile_id: REAL_ADMIN_PROFILE,
    channel: 'whatsapp' as const,
    channel_user_id: '5511999999999',
    context: {},
    profile: { id: REAL_ADMIN_PROFILE, name: 'Guilherme', role: 'admin' as const, tenant_id: REAL_TENANT },
  } as any;
}

async function ask(text: string, history: Array<{ role: 'user'|'model'; text: string }>) {
  console.log('\n› USER:', text);
  const r = await runConversation({
    session: buildSession(),
    userMessage: text,
    history,
    hasPendingConfirmation: false,
    turnId: `cc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  });
  console.log(`‹ BOT (${r.source}, ${r.tokensIn}/${r.tokensOut}t):\n${r.reply}`);
  if (r.toolCalls.length > 0) {
    for (const tc of r.toolCalls) {
      console.log(`  tool: ${tc.name}(${JSON.stringify(tc.args)}) → ${tc.outcome.kind}`);
    }
  }
  return r;
}

describe.skipIf(!HAS_GEMINI)('criar contrato via Gemini real', () => {
  it('A) usuário diz taxa explícita 2% — bot extrai e gera preview com 2.00%', async () => {
    __resetCircuitBreakerForTests();
    let r;
    // Tentar até 3× pra contornar 503 transitório
    for (let i = 0; i < 3; i++) {
      r = await ask(
        'criar contrato pro João Silva, CPF 529.982.247-25, valor R$ 2.000, taxa 2% ao mês, 10 parcelas mensais, vencimento dia 15',
        [],
      );
      if (r.source === 'llm') break;
      console.log(`  retry ${i + 1}/3 (Gemini ${r.source})`);
      await new Promise(res => setTimeout(res, 3000));
    }
    expect(r!.source).toBe('llm');
    if (r!.toolCalls.length > 0) {
      expect(r!.reply).toMatch(/2\.00%|2,00%|2%/); // Taxa preservada
      expect(r!.reply).toContain('***.***.***-25');
      expect(r!.reply).toMatch(/sim|não|confirma/i);
    }
  }, 90_000);

  it('B) usuário diz total a pagar — back-calc da taxa', async () => {
    __resetCircuitBreakerForTests();
    let r;
    for (let i = 0; i < 3; i++) {
      r = await ask(
        'criar contrato pra Maria, CPF 529.982.247-25, valor 1000 reais, total a pagar 2000, em 10 parcelas mensais',
        [],
      );
      if (r.source === 'llm') break;
      console.log(`  retry ${i + 1}/3 (Gemini ${r.source})`);
      await new Promise(res => setTimeout(res, 3000));
    }
    expect(r!.source).toBe('llm');
    if (r!.toolCalls.some(tc => tc.name === 'create_contract' && tc.outcome.kind === 'preview')) {
      // 10x200 com principal 1000 → taxa = (2000/1000-1)/10*100 = 10%
      expect(r!.reply).toMatch(/10\.00%|10,00%/);
      expect(r!.reply).toMatch(/2\.000,00/);
    }
  }, 90_000);

  it('C) usuário NÃO informa taxa — bot pede antes de criar (não inventa 0%)', async () => {
    __resetCircuitBreakerForTests();
    let r;
    for (let i = 0; i < 3; i++) {
      r = await ask(
        'criar contrato pra Maria CPF 529.982.247-25 valor 1000 em 10 parcelas mensais',
        [],
      );
      if (r.source === 'llm') break;
      console.log(`  retry ${i + 1}/3 (Gemini ${r.source})`);
      await new Promise(res => setTimeout(res, 3000));
    }
    expect(r!.source).toBe('llm');
    // Bot tem 2 caminhos válidos:
    //  - Pediu taxa antes (resposta texto, sem tool call) ← preferido
    //  - Chamou tool sem taxa → handler retorna erro "falta taxa" → LLM repete
    // EM AMBOS, NÃO pode haver preview com taxa zerada
    const previewWithZero = r!.toolCalls.find(
      tc => tc.name === 'create_contract' && tc.outcome.kind === 'preview' && /Taxa: \*0\.00%/.test((tc.outcome as any).preview)
    );
    expect(previewWithZero).toBeUndefined();
  }, 90_000);
});

describe.skipIf(HAS_GEMINI)('skip', () => {
  it('skip', () => expect(true).toBe(true));
});
