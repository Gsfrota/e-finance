/**
 * E2E dos handlers wired no AI-native (P1, P4, P10).
 *
 * Cobre:
 *  - disconnect_bot retorna preview com confirmation registrada
 *  - configure_briefing aplica ou desativa
 *  - preview_lembrete retorna sample do briefing
 *  - mark_installment_paid resolve parcela e gera preview
 *  - create_contract valida CPF e gera preview
 *  - query_debtor_balance bloqueia cross-tenant
 *  - circuit-breaker abre após N falhas
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // session/working-state
  updateSessionContext: vi.fn().mockResolvedValue(undefined),

  // admin-actions
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
  getInstallmentBulletInfo: vi.fn(),
  searchDebtorsByName: vi.fn(),

  // bot-config
  getBotTenantConfig: vi.fn(),
  upsertBotTenantConfig: vi.fn(),

  // scheduler
  buildBriefingMessage: vi.fn(),
}));

vi.mock('../src/config', () => ({
  config: {
    assistant: {
      workingStateTtlMs: 30 * 60 * 1000,
      confirmationTtlMs: 10 * 60 * 1000,
    },
  },
}));

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
  getInstallmentBulletInfo: mocks.getInstallmentBulletInfo,
  searchDebtorsByName: mocks.searchDebtorsByName,
  isValidCpf: (value?: string | null) => value === '52998224725',
  normalizeCpf: (value?: string | null) => {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    return digits.length === 11 ? digits : null;
  },
  formatDate: (value: string) => value,
  formatCurrency: (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value),
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

import {
  disconnectBotHandler,
  configureBriefingHandler,
  previewLembreteHandler,
  markInstallmentPaidHandler,
  createContractHandler,
  queryDebtorBalanceHandler,
} from '../src/ai/tools/handlers';
import {
  __resetCircuitBreakerForTests,
} from '../src/ai/conversation-orchestrator';
import type { ToolContext } from '../src/ai/tools/types';

function buildSession(context: Record<string, unknown> = {}, role: 'admin' | 'investor' | 'debtor' = 'admin') {
  return {
    id: 'session-1',
    profile_id: role === 'admin' ? 'profile-1' : 'profile-2',
    channel: 'telegram' as const,
    channel_user_id: 'chat-1',
    context,
    profile: {
      id: role === 'admin' ? 'profile-1' : 'profile-2',
      name: role === 'admin' ? 'Admin Teste' : 'User Teste',
      role,
      tenant_id: 'tenant-1',
    },
  } as any;
}

function buildCtx(role: 'admin' | 'investor' | 'debtor' = 'admin'): ToolContext {
  return {
    session: buildSession({}, role),
    tenantId: 'tenant-1',
    userId: 'profile-1',
    role,
    companyId: null,
    turnId: 'turn-test-1',
    now: new Date('2026-04-29T12:00:00Z'),
  };
}

describe('AI-native handlers — wired mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCircuitBreakerForTests();
    // Default: parcela de contrato padrão (não-bullet). Casos bullet sobrescrevem.
    mocks.getInstallmentBulletInfo.mockResolvedValue({ isBullet: false, remainingBalance: 0, contractId: 0, interestDue: 0 });
    mocks.searchDebtorsByName.mockResolvedValue([]);
  });

  describe('disconnect_bot', () => {
    it('retorna preview e registra confirmation', async () => {
      const ctx = buildCtx('admin');
      const outcome = await disconnectBotHandler({}, ctx);
      expect(outcome.kind).toBe('preview');
      if (outcome.kind === 'preview') {
        expect(outcome.preview).toMatch(/desconectar/i);
        expect(outcome.preview).toMatch(/\*sim\*/);
        expect(outcome.confirmationId).toMatch(/^disconnect_bot:/);
        expect(outcome.idempotencyKey).toContain('session-1');
        expect(outcome.argsSnapshot).toEqual({ capability: 'disconnect_bot' });
      }
      // patchWorkingState foi chamado para gravar pendingConfirmation
      expect(mocks.updateSessionContext).toHaveBeenCalled();
    });
  });

  describe('configure_briefing', () => {
    it('desativa briefing quando enabled=false', async () => {
      const ctx = buildCtx('admin');
      mocks.upsertBotTenantConfig.mockResolvedValue(undefined);
      const outcome = await configureBriefingHandler({ briefing_enabled: false }, ctx);
      expect(outcome.kind).toBe('mutation_applied');
      expect(mocks.upsertBotTenantConfig).toHaveBeenCalledWith('tenant-1', { morning_briefing_enabled: false });
    });

    it('rejeita horário inválido', async () => {
      const ctx = buildCtx('admin');
      const outcome = await configureBriefingHandler({ briefing_time: '25:99' }, ctx);
      expect(outcome.kind).toBe('error');
    });

    it('ativa briefing com horário válido', async () => {
      const ctx = buildCtx('admin');
      mocks.upsertBotTenantConfig.mockResolvedValue(undefined);
      const outcome = await configureBriefingHandler({ briefing_time: '07:30', briefing_enabled: true }, ctx);
      expect(outcome.kind).toBe('mutation_applied');
      expect(mocks.upsertBotTenantConfig).toHaveBeenCalledWith('tenant-1', {
        morning_briefing_enabled: true,
        morning_briefing_time: '07:30',
      });
    });
  });

  describe('preview_lembrete', () => {
    it('retorna sample do briefing matinal', async () => {
      const ctx = buildCtx('admin');
      mocks.buildBriefingMessage.mockResolvedValue('Bom dia! Hoje você tem...');
      mocks.getBotTenantConfig.mockResolvedValue({ morning_briefing_time: '08:00', morning_briefing_enabled: true });
      const outcome = await previewLembreteHandler({}, ctx);
      expect(outcome.kind).toBe('data');
      if (outcome.kind === 'data') {
        expect(outcome.data).toMatchObject({
          sample_message: expect.stringContaining('Bom dia'),
          briefing_time: '08:00',
          enabled: true,
        });
      }
    });
  });

  describe('create_contract', () => {
    it('rejeita CPF inválido', async () => {
      const ctx = buildCtx('admin');
      const outcome = await createContractHandler({ debtor_cpf: '11122233344', amount: 1000, rate: 5 }, ctx);
      expect(outcome.kind).toBe('error');
    });

    it('rejeita amount zerado', async () => {
      const ctx = buildCtx('admin');
      const outcome = await createContractHandler({ debtor_cpf: '52998224725', amount: 0, rate: 5 }, ctx);
      expect(outcome.kind).toBe('error');
    });

    it('rejeita quando não tem taxa nem total_repayment (não inventa 0%)', async () => {
      const ctx = buildCtx('admin');
      const outcome = await createContractHandler({
        debtor_name: 'João',
        debtor_cpf: '52998224725',
        amount: 2000,
        installments: 10,
        frequency: 'monthly',
        due_day: 15,
      }, ctx);
      expect(outcome.kind).toBe('error');
      if (outcome.kind === 'error') {
        expect(outcome.message).toMatch(/taxa|total/i);
      }
    });

    it('gera preview com dados completos (rate explícito)', async () => {
      const ctx = buildCtx('admin');
      const outcome = await createContractHandler({
        debtor_name: 'João Silva',
        debtor_cpf: '52998224725',
        amount: 5000,
        rate: 5,
        installments: 10,
        frequency: 'monthly',
        due_day: 15,
      }, ctx);
      expect(outcome.kind).toBe('preview');
      if (outcome.kind === 'preview') {
        expect(outcome.preview).toContain('João Silva');
        expect(outcome.preview).toContain('***.***.***-25'); // CPF mascarado
        expect(outcome.preview).toContain('R$');
        expect(outcome.preview).toContain('5.00%');
        expect(outcome.preview).toMatch(/sim|não/i);
        expect(outcome.argsSnapshot.debtor_cpf).toBe('52998224725');
      }
    });

    it('back-calcula taxa quando recebe total_repayment', async () => {
      const ctx = buildCtx('admin');
      // 10x200 = 2000, principal 1000 → rate = (2000/1000 - 1)/10 * 100 = 10%
      const outcome = await createContractHandler({
        debtor_name: 'Maria',
        debtor_cpf: '52998224725',
        amount: 1000,
        installments: 10,
        total_repayment: 2000,
        frequency: 'monthly',
      }, ctx);
      expect(outcome.kind).toBe('preview');
      if (outcome.kind === 'preview') {
        expect(outcome.preview).toContain('10.00%'); // rate calculado
        expect(outcome.preview).toMatch(/R\$\s*2\.000,00/); // total mostrado (NBSP-tolerant)
      }
    });
  });

  describe('mark_installment_paid', () => {
    it('retorna erro quando não encontra parcela', async () => {
      const ctx = buildCtx('admin');
      mocks.getContractOpenInstallments.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0, hasMore: false });
      const outcome = await markInstallmentPaidHandler({ contract_id: 999 }, ctx);
      expect(outcome.kind).toBe('error');
    });

    it('gera preview quando resolve parcela única', async () => {
      const ctx = buildCtx('admin');
      mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
        id: 'inst-1',
        number: 3,
        contractId: 42,
        debtorName: 'Maria',
        amount: 500,
        dueDate: '2026-05-10',
        status: 'pending',
      });
      const outcome = await markInstallmentPaidHandler(
        { contract_id: 42, installment_number: 3 },
        ctx,
      );
      expect(outcome.kind).toBe('preview');
      if (outcome.kind === 'preview') {
        expect(outcome.preview).toContain('Maria');
        expect(outcome.preview).toContain('#42');
        expect(outcome.preview).toMatch(/Parcela\s+\*3\*/);
        expect(outcome.argsSnapshot.installment_id).toBe('inst-1');
      }
    });

    it('retorna ambiguidade quando há múltiplas parcelas em aberto', async () => {
      const ctx = buildCtx('admin');
      mocks.getContractOpenInstallments.mockResolvedValue({
        items: [
          { id: 'i1', number: 1, contractId: 7, debtorName: 'A', amount: 100, dueDate: '2026-01-01', status: 'pending' },
          { id: 'i2', number: 2, contractId: 7, debtorName: 'A', amount: 100, dueDate: '2026-02-01', status: 'pending' },
        ],
        page: 1, pageSize: 10, total: 2, hasMore: false,
      });
      const outcome = await markInstallmentPaidHandler({ contract_id: 7 }, ctx);
      expect(outcome.kind).toBe('data');
    });
  });

  describe('query_debtor_balance — cross-tenant guard (P4)', () => {
    it('bloqueia quando profileId é de outro tenant', async () => {
      const ctx = buildCtx('admin');
      mocks.getProfileById.mockResolvedValue({
        id: 'outsider',
        full_name: 'Vazamento',
        tenant_id: 'tenant-OUTRO',
        whatsapp_phone: null,
        telegram_chat_id: null,
      });
      const outcome = await queryDebtorBalanceHandler({ debtor_profile_id: 'outsider' }, ctx);
      expect(outcome.kind).toBe('text');
      if (outcome.kind === 'text') expect(outcome.text).toContain('Não encontrei');
      // não deve consultar dados se cross-tenant
      expect(mocks.getUserDebtDetails).not.toHaveBeenCalled();
    });

    it('permite quando profileId é do mesmo tenant', async () => {
      const ctx = buildCtx('admin');
      mocks.getProfileById.mockResolvedValue({
        id: 'profile-x',
        full_name: 'João Tenant1',
        tenant_id: 'tenant-1',
        whatsapp_phone: null,
        telegram_chat_id: null,
      });
      mocks.getUserDebtDetails.mockResolvedValue({
        totalDebt: 1500,
        pendingInstallments: 3,
        nextDueDate: '2026-05-01',
        nextDueAmount: 500,
        activeContracts: 1,
      });
      mocks.getUserDebt.mockResolvedValue(1500);
      const outcome = await queryDebtorBalanceHandler({ debtor_profile_id: 'profile-x' }, ctx);
      expect(outcome.kind).toBe('data');
    });
  });

  // BOT-008: paridade bullet no caminho AI-native (handlers).
  describe('BOT-008 bullet (paridade AI-native)', () => {
    it('create_contract: calculation_mode interest_only → preview bullet + argsSnapshot', async () => {
      const ctx = buildCtx('admin');
      const outcome = await createContractHandler({
        debtor_cpf: '52998224725', amount: 5000, rate: 10, frequency: 'monthly', due_day: 10,
        debtor_name: 'Icaro', calculation_mode: 'interest_only',
      }, ctx);
      expect(outcome.kind).toBe('preview');
      if (outcome.kind === 'preview') {
        expect(outcome.preview).toContain('Juros simples');
        expect(outcome.preview).toContain('prazo indeterminado');
        expect(outcome.preview).not.toContain('Total a pagar');
        expect(outcome.argsSnapshot.calculation_mode).toBe('interest_only');
      }
    });

    it('mark_installment_paid bullet sem modo → pergunta juros/quitar (sem confirmação)', async () => {
      const ctx = buildCtx('admin');
      mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
        id: 'inst-b1', number: 1, contractId: 77, debtorName: 'Icaro', amount: 5500, dueDate: '2026-06-10', status: 'pending',
      });
      mocks.getInstallmentBulletInfo.mockResolvedValue({ isBullet: true, remainingBalance: 5000, contractId: 77, interestDue: 500 });
      const outcome = await markInstallmentPaidHandler({ contract_id: 77, installment_number: 1 }, ctx);
      expect(outcome.kind).toBe('data');
      if (outcome.kind === 'data') {
        expect(outcome.data.prompt).toContain('juros simples (bullet)');
        expect(outcome.data.prompt).toContain('quitar');
        // juros correto (500), não amount_total (5500) — guarda do bug BOT-005.
        expect(outcome.data.prompt).toContain('500,00');
      }
    });

    it('mark_installment_paid bullet_mode=interest → preview rolagem + argsSnapshot.bullet_mode', async () => {
      const ctx = buildCtx('admin');
      mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
        id: 'inst-b1', number: 1, contractId: 77, debtorName: 'Icaro', amount: 5500, dueDate: '2026-06-10', status: 'pending',
      });
      mocks.getInstallmentBulletInfo.mockResolvedValue({ isBullet: true, remainingBalance: 5000, contractId: 77, interestDue: 500 });
      const outcome = await markInstallmentPaidHandler({ contract_id: 77, installment_number: 1, bullet_mode: 'interest' }, ctx);
      expect(outcome.kind).toBe('preview');
      if (outcome.kind === 'preview') {
        expect(outcome.preview).toContain('Rolagem');
        expect(outcome.preview).toContain('500,00');
        expect(outcome.argsSnapshot.bullet_mode).toBe('interest');
        expect(outcome.argsSnapshot.installment_id).toBe('inst-b1');
      }
    });

    it('mark_installment_paid bullet_mode=settle → preview quitação (juros+principal)', async () => {
      const ctx = buildCtx('admin');
      mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
        id: 'inst-b1', number: 1, contractId: 77, debtorName: 'Icaro', amount: 5500, dueDate: '2026-06-10', status: 'pending',
      });
      mocks.getInstallmentBulletInfo.mockResolvedValue({ isBullet: true, remainingBalance: 5000, contractId: 77, interestDue: 500 });
      const outcome = await markInstallmentPaidHandler({ contract_id: 77, installment_number: 1, bullet_mode: 'settle' }, ctx);
      expect(outcome.kind).toBe('preview');
      if (outcome.kind === 'preview') {
        expect(outcome.preview).toContain('Quitação');
        expect(outcome.preview).toContain('5.500,00'); // total = 5000 + 500
        expect(outcome.argsSnapshot.bullet_mode).toBe('settle');
      }
    });
  });
});
