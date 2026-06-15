import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateSessionContext: vi.fn(),

  getDashboardSummary: vi.fn(),
  getDebtorsToCollectByDateRange: vi.fn(),
  getInstallments: vi.fn(),
  getInstallmentsByDateRange: vi.fn(),
  getInvestorPortfolio: vi.fn(),
  getProfileById: vi.fn(),
  getUserDebtDetails: vi.fn(),
  searchUser: vi.fn(),

  parseContractTextWithMeta: vi.fn(),
  createContract: vi.fn(),
  markInstallmentPaid: vi.fn(),
  getInstallmentBulletInfo: vi.fn(),
  payBulletInterest: vi.fn(),
  searchDebtorsByName: vi.fn(),
  getContractOpenInstallments: vi.fn(),
  getContractOpenInstallmentByNumber: vi.fn(),
  getContractOpenInstallmentByMonth: vi.fn(),
  getInstallmentByDebtorAndMonth: vi.fn(),

  getBotTenantConfig: vi.fn(),
  upsertBotTenantConfig: vi.fn(),
  buildBriefingMessage: vi.fn(),
}));

vi.mock('../src/session/session-manager', () => ({
  updateSessionContext: mocks.updateSessionContext,
}));

vi.mock('../src/actions/admin-actions', () => ({
  getDashboardSummary: mocks.getDashboardSummary,
  getDebtorsToCollectByDateRange: mocks.getDebtorsToCollectByDateRange,
  getInstallments: mocks.getInstallments,
  getInstallmentsByDateRange: mocks.getInstallmentsByDateRange,
  getInvestorPortfolio: mocks.getInvestorPortfolio,
  getProfileById: mocks.getProfileById,
  getUserDebtDetails: mocks.getUserDebtDetails,
  searchUser: mocks.searchUser,

  parseContractTextWithMeta: mocks.parseContractTextWithMeta,
  createContract: mocks.createContract,
  markInstallmentPaid: mocks.markInstallmentPaid,
  getInstallmentBulletInfo: mocks.getInstallmentBulletInfo,
  payBulletInterest: mocks.payBulletInterest,
  searchDebtorsByName: mocks.searchDebtorsByName,
  getContractOpenInstallments: mocks.getContractOpenInstallments,
  getContractOpenInstallmentByNumber: mocks.getContractOpenInstallmentByNumber,
  getContractOpenInstallmentByMonth: mocks.getContractOpenInstallmentByMonth,
  getInstallmentByDebtorAndMonth: mocks.getInstallmentByDebtorAndMonth,

  normalizeCpf: (value?: string | null) => {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    return digits.length === 11 ? digits : null;
  },
  isValidCpf: (value?: string | null) => value === '52998224725',
  formatCurrency: (value: number) => `R$ ${Number(value).toFixed(2)}`,
  formatDate: (value: string) => value,
  extractDebtorNameSimple: (text: string) => {
    const match = text.match(/([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)*)/);
    return match?.[1] || null;
  },
  extractAmount: (text: string) => {
    const match = text.match(/(\d+(?:[.,]\d+)?)/);
    return match?.[1] ? Number(match[1].replace(',', '.')) : null;
  },
  extractRate: (text: string) => {
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
    return match?.[1] ? Number(match[1].replace(',', '.')) : null;
  },
  extractInstallments: (text: string) => {
    const match = text.match(/(\d+)\s*(?:parcelas?|x|vezes)/i);
    return match?.[1] ? Number(match[1]) : null;
  },
}));

vi.mock('../src/actions/bot-config-actions', () => ({
  getBotTenantConfig: mocks.getBotTenantConfig,
  upsertBotTenantConfig: mocks.upsertBotTenantConfig,
}));

vi.mock('../src/scheduler/morning-briefing', () => ({
  buildBriefingMessage: mocks.buildBriefingMessage,
}));

import { executeActionPlan } from '../src/assistant/tool-executor';
import type { ActionPlan } from '../src/assistant/contracts';

function buildSession(context: Record<string, unknown> = {}, role: 'admin' | 'investor' | 'debtor' = 'admin') {
  return {
    id: 'session-1',
    profile_id: role === 'admin' ? 'profile-1' : 'profile-2',
    channel: 'telegram',
    channel_user_id: 'chat-1',
    context,
    profile: {
      id: role === 'admin' ? 'profile-1' : 'profile-2',
      name: role === 'admin' ? 'Admin' : 'Investor',
      role,
      tenant_id: 'tenant-1',
    },
  } as any;
}

function buildPlan(capability: ActionPlan['capability'], args: Record<string, unknown>): ActionPlan {
  return {
    decision: 'execute',
    intent: capability === 'create_contract' ? 'criar_contrato' : 'marcar_pagamento',
    capability,
    args,
    missingArgs: [],
    missingFields: [],
    confidence: 0.99,
    confidenceLabel: 'high',
    source: 'rule',
    evidence: ['test'],
    dependsOnContext: false,
    requiresConfirmation: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.parseContractTextWithMeta.mockResolvedValue({ draft: null, mode: 'failed', reason: 'missing_fields' });
  mocks.createContract.mockResolvedValue({
    status: 'success',
    id: 42,
    debtorName: 'Maria',
    debtorCpf: '52998224725',
    firstInstallment: '2026-04-10 - R$ 1000',
    debtorResolution: 'created',
  });

  mocks.markInstallmentPaid.mockResolvedValue(true);
  mocks.getInstallmentBulletInfo.mockResolvedValue({ isBullet: false, remainingBalance: 0, contractId: 123, interestDue: 0 });
  mocks.payBulletInterest.mockResolvedValue({ ok: true, contractClosed: false, interestPaid: 0, principalPaid: 0, newBalance: 0 });
  mocks.searchDebtorsByName.mockResolvedValue([]);
  mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
    id: 'inst-2',
    number: 2,
    contractId: 123,
    debtorName: 'Carlos',
    amount: 900,
    dueDate: '2026-04-10',
    status: 'pending',
  });
  mocks.getContractOpenInstallmentByMonth.mockResolvedValue({
    id: 'inst-2',
    number: 2,
    contractId: 123,
    debtorName: 'Carlos',
    amount: 900,
    dueDate: '2026-04-10',
    status: 'pending',
  });
  mocks.getContractOpenInstallments.mockResolvedValue({
    items: [
      { id: 'inst-1', number: 1, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-03-10', status: 'pending' },
      { id: 'inst-2', number: 2, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-04-10', status: 'pending' },
    ],
    page: 0,
    pageSize: 3,
    total: 2,
    hasMore: false,
  });
  mocks.getInstallmentByDebtorAndMonth.mockResolvedValue(null);
});

describe('tool-executor mutations', () => {
  it('create_contract pede clarificação objetiva quando faltam dados', async () => {
    const session = buildSession();
    const legacyDispatch = vi.fn();

    const result = await executeActionPlan(
      buildPlan('create_contract', {
        debtor_name: 'Maria',
        debtor_cpf: '52998224725',
        amount: 5000,
        installments: 12,
        frequency: 'monthly',
        due_day: 10,
      }),
      {
        session,
        tenantId: 'tenant-1',
        profileId: 'profile-1',
        role: 'admin',
        requestId: 'req-create-missing',
        channel: 'telegram',
        rawText: 'criar contrato para Maria CPF 52998224725 5000 em 12 parcelas dia 10',
      },
      { executeLegacyIntent: legacyDispatch },
    );

    expect(result.status).toBe('needs_clarification');
    expect(result.safeUserMessage).toContain('taxa de juros');
    expect(result.workingStatePatch).toEqual(expect.objectContaining({
      pendingCapability: 'create_contract',
      pendingOperationInput: expect.objectContaining({ debtor_name: 'Maria' }),
    }));
    expect(legacyDispatch).not.toHaveBeenCalled();
    expect(mocks.createContract).not.toHaveBeenCalled();
  });

  it('create_contract completo entra em confirmação sem passar no legacy-dispatch e sem espelhar pendingAction', async () => {
    const session = buildSession();
    const legacyDispatch = vi.fn();

    const result = await executeActionPlan(
      buildPlan('create_contract', {
        debtor_name: 'Maria',
        debtor_cpf: '52998224725',
        amount: 5000,
        rate: 3,
        installments: 12,
        frequency: 'monthly',
        due_day: 10,
      }),
      {
        session,
        tenantId: 'tenant-1',
        profileId: 'profile-1',
        role: 'admin',
        requestId: 'req-create-confirm',
        channel: 'telegram',
        rawText: 'criar contrato para Maria CPF 52998224725 5000 com 3% em 12 parcelas dia 10',
      },
      { executeLegacyIntent: legacyDispatch },
    );

    expect(result.status).toBe('needs_confirmation');
    expect(result.safeUserMessage).toMatch(/Novo contrato — confirmar/);
    expect(result.safeUserMessage).toMatch(/[Rr]esponda \*sim\*/);
    expect(session.context.pendingAction).toBeUndefined();
    expect((session.context as any).workingStateV2).toEqual(expect.objectContaining({
      pendingCapability: 'create_contract',
      pendingConfirmation: expect.anything(),
    }));
    expect(legacyDispatch).not.toHaveBeenCalled();
    expect(mocks.createContract).not.toHaveBeenCalled();
  });

  it('create_contract confirmado executa pelo runtime dedicado e respeita policy', async () => {
    const session = buildSession();
    const legacyDispatch = vi.fn();

    const result = await executeActionPlan(
      buildPlan('create_contract', {
        debtor_name: 'Maria',
        debtor_cpf: '52998224725',
        amount: 5000,
        rate: 3,
        installments: 12,
        frequency: 'monthly',
        due_day: 10,
      }),
      {
        session,
        tenantId: 'tenant-1',
        profileId: 'profile-1',
        role: 'admin',
        requestId: 'req-create-ok',
        channel: 'telegram',
        rawText: 'sim',
        confirmed: true,
        idempotencyKey: 'session-1:create_contract:abc',
        confirmationId: 'create_contract:1',
      },
      { executeLegacyIntent: legacyDispatch },
    );

    expect(result.status).toBe('ok');
    expect(result.safeUserMessage).toContain('Contrato #42 criado');
    expect(result.structuredResponse?.title).toContain('Contrato #42 criado');
    expect(mocks.createContract).toHaveBeenCalledTimes(1);
    expect(legacyDispatch).not.toHaveBeenCalled();
  });

  it('create_contract bloqueia role sem mutar o banco', async () => {
    const session = buildSession({}, 'investor');
    const legacyDispatch = vi.fn();

    const result = await executeActionPlan(
      buildPlan('create_contract', {
        debtor_name: 'Maria',
        debtor_cpf: '52998224725',
        amount: 5000,
        rate: 3,
        installments: 12,
        frequency: 'monthly',
        due_day: 10,
      }),
      {
        session,
        tenantId: 'tenant-1',
        profileId: 'profile-2',
        role: 'investor',
        requestId: 'req-create-blocked',
        channel: 'telegram',
        rawText: 'sim',
        confirmed: true,
        idempotencyKey: 'session-1:create_contract:blocked',
        confirmationId: 'create_contract:2',
      },
      { executeLegacyIntent: legacyDispatch },
    );

    expect(result.status).toBe('forbidden');
    expect(mocks.createContract).not.toHaveBeenCalled();
    expect(legacyDispatch).not.toHaveBeenCalled();
  });

  it('create_contract trata conflito de nome como clarificação estruturada', async () => {
    mocks.createContract.mockResolvedValueOnce({
      status: 'conflict_name',
      debtorCpf: '52998224725',
      existingName: 'Maria Antiga',
      requestedName: 'Maria Nova',
    });
    const session = buildSession();
    const legacyDispatch = vi.fn();

    const result = await executeActionPlan(
      buildPlan('create_contract', {
        debtor_name: 'Maria Nova',
        debtor_cpf: '52998224725',
        amount: 5000,
        rate: 3,
        installments: 12,
        frequency: 'monthly',
        due_day: 10,
      }),
      {
        session,
        tenantId: 'tenant-1',
        profileId: 'profile-1',
        role: 'admin',
        requestId: 'req-create-conflict',
        channel: 'telegram',
        rawText: 'sim',
        confirmed: true,
        idempotencyKey: 'session-1:create_contract:conflict',
        confirmationId: 'create_contract:3',
      },
      { executeLegacyIntent: legacyDispatch },
    );

    expect(result.status).toBe('needs_clarification');
    expect(result.safeUserMessage).toContain('CPF já cadastrado');
    expect(result.workingStatePatch).toEqual(expect.objectContaining({
      pendingCapability: 'create_contract',
      pendingMissingFields: ['rename_mode'],
    }));
    expect(legacyDispatch).not.toHaveBeenCalled();
  });

  it('create_contract confirmado replay NÃO cria contrato duplicado (idempotência)', async () => {
    // Trava o invariante do alvo da convergência (Fase 2): o caminho capability
    // bloqueia o "2 sim = 2 contratos" — bug que só existe no wizard legado.
    const session = buildSession();
    const legacyDispatch = vi.fn();

    const args = {
      debtor_name: 'Maria',
      debtor_cpf: '52998224725',
      amount: 5000,
      rate: 3,
      installments: 12,
      frequency: 'monthly',
      due_day: 10,
    };
    const confirmContext = {
      session,
      tenantId: 'tenant-1',
      profileId: 'profile-1',
      role: 'admin' as const,
      channel: 'telegram' as const,
      rawText: 'sim',
      confirmed: true,
      idempotencyKey: 'session-1:create_contract:dup',
      confirmationId: 'create_contract:dup',
    };

    const firstResult = await executeActionPlan(
      buildPlan('create_contract', args),
      { ...confirmContext, requestId: 'req-create-first' },
      { executeLegacyIntent: legacyDispatch },
    );

    // Simula o estado pós-execução persistido (lastMutation grava o idempotencyKey).
    session.context = {
      workingStateV2: {
        version: 2,
        lastMutation: {
          capability: 'create_contract',
          idempotencyKey: 'session-1:create_contract:dup',
          confirmationId: 'create_contract:dup',
          completedAt: new Date().toISOString(),
        },
      },
    };

    const replayResult = await executeActionPlan(
      buildPlan('create_contract', args),
      { ...confirmContext, requestId: 'req-create-replay' },
      { executeLegacyIntent: legacyDispatch },
    );

    expect(firstResult.status).toBe('ok');
    expect(mocks.createContract).toHaveBeenCalledTimes(1);
    // O replay NÃO chama createContract de novo → nenhum contrato duplicado.
    expect(replayResult.status).toBe('ok');
    expect(replayResult.safeUserMessage).toContain('já foi executada neste chat');
    expect(mocks.createContract).toHaveBeenCalledTimes(1);
    expect(legacyDispatch).not.toHaveBeenCalled();
  });

  it('mark_installment_paid entra em confirmação no runtime dedicado', async () => {
    const session = buildSession();
    const legacyDispatch = vi.fn();

    const result = await executeActionPlan(
      buildPlan('mark_installment_paid', {
        contract_id: 123,
        installment_number: 2,
      }),
      {
        session,
        tenantId: 'tenant-1',
        profileId: 'profile-1',
        role: 'admin',
        requestId: 'req-pay-confirm',
        channel: 'telegram',
        rawText: 'baixar contrato 123 parcela 2',
      },
      { executeLegacyIntent: legacyDispatch },
    );

    expect(result.status).toBe('needs_confirmation');
    expect(result.safeUserMessage).toMatch(/Baixar parcela — confirmar/);
    expect(session.context.pendingAction).toBeUndefined();
    expect((session.context as any).workingStateV2).toEqual(expect.objectContaining({
      pendingCapability: 'mark_installment_paid',
      pendingConfirmation: expect.anything(),
    }));
    expect(legacyDispatch).not.toHaveBeenCalled();
    expect(mocks.markInstallmentPaid).not.toHaveBeenCalled();
  });

  it('mark_installment_paid com múltiplos candidatos pede clarificação objetiva', async () => {
    mocks.getInstallmentByDebtorAndMonth.mockResolvedValueOnce({
      installments: [
        { id: 'inst-10', number: 1, contractId: 200, debtorName: 'Carlos', amount: 400, dueDate: '2026-04-05', status: 'pending' },
        { id: 'inst-20', number: 1, contractId: 201, debtorName: 'Carlos', amount: 450, dueDate: '2026-04-12', status: 'pending' },
      ],
    });
    const session = buildSession();
    const legacyDispatch = vi.fn();

    const result = await executeActionPlan(
      buildPlan('mark_installment_paid', {
        debtor_name: 'Carlos',
        installment_month: 4,
        installment_year: 2026,
      }),
      {
        session,
        tenantId: 'tenant-1',
        profileId: 'profile-1',
        role: 'admin',
        requestId: 'req-pay-clarify',
        channel: 'telegram',
        rawText: 'baixar parcela do Carlos de abril',
      },
      { executeLegacyIntent: legacyDispatch },
    );

    expect(result.status).toBe('needs_clarification');
    expect(result.safeUserMessage).toContain('Encontrei estas parcelas em aberto');
    expect(result.workingStatePatch).toEqual(expect.objectContaining({
      pendingCapability: 'mark_installment_paid',
      pendingMissingFields: ['installment_choice'],
    }));
    expect(legacyDispatch).not.toHaveBeenCalled();
    expect(mocks.markInstallmentPaid).not.toHaveBeenCalled();
  });

  it('mark_installment_paid confirmado executa e mantém idempotência por confirmação', async () => {
    const session = buildSession();
    const legacyDispatch = vi.fn();

    const firstResult = await executeActionPlan(
      buildPlan('mark_installment_paid', {
        installment_id: 'inst-2',
        contract_id: 123,
        installment_number: 2,
      }),
      {
        session,
        tenantId: 'tenant-1',
        profileId: 'profile-1',
        role: 'admin',
        requestId: 'req-pay-ok',
        channel: 'telegram',
        rawText: 'sim',
        confirmed: true,
        idempotencyKey: 'session-1:mark_installment_paid:abc',
        confirmationId: 'mark_installment_paid:1',
      },
      { executeLegacyIntent: legacyDispatch },
    );

    session.context = {
      workingStateV2: {
        version: 2,
        lastMutation: {
          capability: 'mark_installment_paid',
          idempotencyKey: 'session-1:mark_installment_paid:abc',
          confirmationId: 'mark_installment_paid:1',
          completedAt: new Date().toISOString(),
        },
      },
    };

    const replayResult = await executeActionPlan(
      buildPlan('mark_installment_paid', {
        installment_id: 'inst-2',
        contract_id: 123,
        installment_number: 2,
      }),
      {
        session,
        tenantId: 'tenant-1',
        profileId: 'profile-1',
        role: 'admin',
        requestId: 'req-pay-replay',
        channel: 'telegram',
        rawText: 'sim',
        confirmed: true,
        idempotencyKey: 'session-1:mark_installment_paid:abc',
        confirmationId: 'mark_installment_paid:1',
      },
      { executeLegacyIntent: legacyDispatch },
    );

    expect(firstResult.status).toBe('ok');
    expect(firstResult.safeUserMessage).toMatch(/Pagamento confirmado/);
    expect(mocks.markInstallmentPaid).toHaveBeenCalledTimes(1);
    expect(replayResult.status).toBe('ok');
    expect(replayResult.safeUserMessage).toContain('já foi executada neste chat');
    expect(mocks.markInstallmentPaid).toHaveBeenCalledTimes(1);
    expect(legacyDispatch).not.toHaveBeenCalled();
  });
});
