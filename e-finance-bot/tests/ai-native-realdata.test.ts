/**
 * Validação dos handlers AI-native usando fixtures derivadas de DB real
 * (tenant 'Guilherme juros' — f1d6accc-3772-43de-abe0-2564aacd9df1).
 *
 * Fixtures extraídas via MCP Supabase em 2026-04-29:
 *  - 8 contratos ativos
 *  - 20 parcelas em aberto, total R$ 3.533,30
 *  - 3 devedores: Teste, Felipe mendes, Jubileu
 *  - Próxima parcela: Jubileu, R$ 100,00, 2026-05-10
 *
 * Objetivo: garantir que os handlers reais convertem corretamente os shapes
 * que o admin-actions retorna em respostas formatadas para o LLM/usuário.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const REAL_TENANT = 'f1d6accc-3772-43de-abe0-2564aacd9df1';
const REAL_ADMIN_PROFILE = '0ae63248-f66d-4180-aaa6-fedb8d721862';
const REAL_DEBTOR_JUBILEU = 'e258629b-4a25-4381-b9c5-7c88d78b5cf0';

// Fixtures realistas — shape exato do que admin-actions retorna em prod
const REAL_DASHBOARD = {
  activeContracts: 8,
  overdueContracts: 0,
  totalOverdue: 0,
  expectedMonth: 100,
  receivedMonth: 0,
  receivedByPaymentMonth: 0,
  receivedByDueMonth: 0,
};

const REAL_INSTALLMENTS = [
  { debtorName: 'Jubileu', amount: 100, dueDate: '2026-05-10', status: 'pending', daysLate: -11 },
  { debtorName: 'Jubileu', amount: 100, dueDate: '2026-06-10', status: 'pending', daysLate: -42 },
  { debtorName: 'Jubileu', amount: 100, dueDate: '2026-07-10', status: 'pending', daysLate: -72 },
  { debtorName: 'Teste', amount: 183.33, dueDate: '2026-09-10', status: 'pending', daysLate: -134 },
];

const mocks = vi.hoisted(() => ({
  updateSessionContext: vi.fn().mockResolvedValue(undefined),
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
    assistant: { workingStateTtlMs: 30 * 60 * 1000, confirmationTtlMs: 10 * 60 * 1000 },
  },
}));
vi.mock('../src/session/session-manager', () => ({ updateSessionContext: mocks.updateSessionContext }));
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
  isValidCpf: () => true,
  normalizeCpf: (v?: string | null) => {
    if (!v) return null;
    const digits = String(v).replace(/\D/g, '');
    return digits.length === 11 ? digits : null;
  },
  formatDate: (v: string) => v,
}));
vi.mock('../src/actions/bot-config-actions', () => ({
  getBotTenantConfig: mocks.getBotTenantConfig,
  upsertBotTenantConfig: mocks.upsertBotTenantConfig,
}));
vi.mock('../src/scheduler/morning-briefing', () => ({ buildBriefingMessage: mocks.buildBriefingMessage }));
vi.mock('../src/observability/logger', () => ({ logStructuredMessage: vi.fn() }));

import {
  showDashboardHandler,
  listReceivablesHandler,
  queryDebtorBalanceHandler,
  viewMyInstallmentsHandler,
  viewMyDebtSummaryHandler,
} from '../src/ai/tools/handlers';
import type { ToolContext } from '../src/ai/tools/types';

function buildCtx(role: 'admin' | 'investor' | 'debtor' = 'admin', profileId = REAL_ADMIN_PROFILE): ToolContext {
  return {
    session: {
      id: 'session-real',
      profile_id: profileId,
      channel: 'whatsapp' as const,
      channel_user_id: '5511999999999',
      context: {},
      profile: {
        id: profileId,
        name: role === 'admin' ? 'Guilherme' : 'Devedor',
        role,
        tenant_id: REAL_TENANT,
      },
    } as any,
    tenantId: REAL_TENANT,
    userId: profileId,
    role,
    companyId: null,
    turnId: 'turn-real',
    now: new Date('2026-04-29T12:00:00Z'),
  };
}

describe('AI-native handlers — fixtures de DB real (tenant Guilherme juros)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('show_dashboard: 8 contratos ativos, sem atraso', async () => {
    mocks.getDashboardSummary.mockResolvedValue(REAL_DASHBOARD);
    const outcome = await showDashboardHandler({}, buildCtx('admin'));
    expect(outcome.kind).toBe('data');
    if (outcome.kind === 'data') {
      expect(outcome.summary).toContain('8 contratos ativos');
      expect(outcome.summary).toContain('R$');
      expect(outcome.data).toMatchObject({ activeContracts: 8 });
    }
  });

  it('list_receivables: 4 parcelas pending — formata com nome, valor, vencimento', async () => {
    mocks.getInstallments.mockResolvedValue(REAL_INSTALLMENTS);
    const outcome = await listReceivablesHandler({ filter: 'pending' }, buildCtx('admin'));
    expect(outcome.kind).toBe('data');
    if (outcome.kind === 'data') {
      const data = outcome.data as Array<Record<string, unknown>>;
      expect(data).toHaveLength(4);
      expect(data[0]).toMatchObject({
        debtor: 'Jubileu',
        amount: 100,
        due_date: '2026-05-10',
        status: 'pending',
      });
      expect(outcome.summary).toContain('4 parcelas');
    }
  });

  it('query_debtor_balance: cross-tenant guard ATIVO — bloqueia profile de outro tenant', async () => {
    // P4: tentativa de exfiltração via UUID cuspido pelo LLM
    mocks.getProfileById.mockResolvedValue({
      id: 'rogue',
      full_name: 'Cliente de Outro Tenant',
      tenant_id: 'different-tenant-uuid',
      whatsapp_phone: null,
      telegram_chat_id: null,
    });
    const outcome = await queryDebtorBalanceHandler(
      { debtor_profile_id: 'rogue' },
      buildCtx('admin'),
    );
    expect(outcome.kind).toBe('text');
    if (outcome.kind === 'text') expect(outcome.text).toContain('Não encontrei');
    expect(mocks.getUserDebtDetails).not.toHaveBeenCalled();
  });

  it('query_debtor_balance: tenant correto — devolve débito formatado', async () => {
    mocks.getProfileById.mockResolvedValue({
      id: REAL_DEBTOR_JUBILEU,
      full_name: 'Jubileu',
      tenant_id: REAL_TENANT,
      whatsapp_phone: null,
      telegram_chat_id: null,
    });
    mocks.getUserDebtDetails.mockResolvedValue({
      totalDebt: 400,
      pendingInstallments: 4,
      nextDueDate: '2026-05-10',
      nextDueAmount: 100,
      activeContracts: 1,
    });
    mocks.getUserDebt.mockResolvedValue(400);
    const outcome = await queryDebtorBalanceHandler(
      { debtor_profile_id: REAL_DEBTOR_JUBILEU },
      buildCtx('admin'),
    );
    expect(outcome.kind).toBe('data');
    if (outcome.kind === 'data') {
      expect(outcome.summary).toContain('Jubileu');
      expect(outcome.summary).toContain('R$');
      expect(outcome.summary).toContain('4 parcelas pendentes');
    }
  });

  it('view_my_installments: devedor com parcelas pendentes — sem cross-tenant', async () => {
    mocks.getUserDebtDetails.mockResolvedValue({
      totalDebt: 400,
      pendingInstallments: 4,
      nextDueDate: '2026-05-10',
      nextDueAmount: 100,
      activeContracts: 1,
    });
    const outcome = await viewMyInstallmentsHandler({}, buildCtx('debtor', REAL_DEBTOR_JUBILEU));
    expect(outcome.kind).toBe('data');
    if (outcome.kind === 'data') {
      expect(outcome.summary).toContain('4 parcelas pendentes');
      expect(outcome.summary).toContain('R$');
    }
  });

  it('view_my_debt_summary: devedor — apenas saldo total', async () => {
    mocks.getUserDebt.mockResolvedValue(400);
    const outcome = await viewMyDebtSummaryHandler({}, buildCtx('debtor', REAL_DEBTOR_JUBILEU));
    expect(outcome.kind).toBe('data');
    if (outcome.kind === 'data') {
      expect(outcome.summary).toContain('R$');
      expect(outcome.data).toMatchObject({ total_debt: 400 });
    }
  });
});
