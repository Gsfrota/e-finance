import type { AgentEvalCase, AgentEvalSetupContext } from './contracts';

/** Setup helper para marcar_pagamento */
function setupMarkInstallmentPaid(ctx: AgentEvalSetupContext, entities: Record<string, unknown> = {}) {
  ctx.mocks.routeIntent.mockResolvedValue({
    intent: 'marcar_pagamento',
    entities,
    normalizedEntities: entities,
    confidence: 'high',
    source: 'rule',
  });
}

export const PROBE_BAIXA_CASES: AgentEvalCase[] = [
  {
    id: 'baixa-001-contrato-numero',
    description: 'Baixar por contrato + número de parcela explícito',
    category: 'functional',
    criticality: 'core',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 123, installment_number: 2 });
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
        id: 'inst-2',
        number: 2,
        contractId: 123,
        debtorName: 'Carlos Silva',
        amount: 900,
        dueDate: '2026-04-10',
        status: 'pending',
      });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixar contrato 123 parcela 2' },
        expect: {
          textIncludes: ['Carlos Silva', '#123', 'Parcela', 'confirmar', 'sim'],
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          textIncludes: ['confirmado', '900'],
          mockCalls: { markInstallmentPaid: 1 },
        },
      },
    ],
  },

  {
    id: 'baixa-002-contrato-mes',
    description: 'Baixar por contrato + mês de parcela',
    category: 'functional',
    criticality: 'core',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 123, installment_month: 4 });
      ctx.mocks.getContractOpenInstallmentByMonth.mockResolvedValue({
        id: 'inst-3',
        number: 3,
        contractId: 123,
        debtorName: 'Carlos Silva',
        amount: 900,
        dueDate: '2026-04-10',
        status: 'pending',
      });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixar a parcela de abril do contrato 123' },
        expect: {
          textIncludes: ['Carlos Silva', '#123', 'Parcela', 'confirmar'],
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          mockCalls: { markInstallmentPaid: 1 },
          textIncludes: ['confirmado'],
        },
      },
    ],
  },

  {
    id: 'baixa-003-contrato-lista',
    description: 'Contrato só → lista parcelas → seleção por número (multi-turno)',
    category: 'multi_turn',
    criticality: 'core',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 123 });
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [
          { id: 'inst-1', number: 1, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-03-10', status: 'pending' },
          { id: 'inst-2', number: 2, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-04-10', status: 'pending' },
          { id: 'inst-3', number: 3, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-05-10', status: 'pending' },
        ],
        page: 0,
        pageSize: 3,
        total: 3,
        hasMore: false,
      });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixar contrato 123' },
        expect: {
          textIncludes: ['#123', 'Parcela', 'número'],
        },
      },
      {
        input: { text: '2' },
        expect: {
          textIncludes: ['Parcela', 'sim', 'confirmar'],
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          mockCalls: { markInstallmentPaid: 1 },
          textIncludes: ['confirmado'],
        },
      },
    ],
  },

  {
    id: 'baixa-004-contrato-lista-paginada',
    description: 'Lista com "mostrar mais" (paginação)',
    category: 'multi_turn',
    criticality: 'extended',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 456 });
      ctx.mocks.getContractOpenInstallments
        .mockResolvedValueOnce({
          items: [
            { id: 'inst-1', number: 1, contractId: 456, debtorName: 'João', amount: 500, dueDate: '2026-03-01', status: 'pending' },
            { id: 'inst-2', number: 2, contractId: 456, debtorName: 'João', amount: 500, dueDate: '2026-04-01', status: 'pending' },
            { id: 'inst-3', number: 3, contractId: 456, debtorName: 'João', amount: 500, dueDate: '2026-05-01', status: 'pending' },
          ],
          page: 0,
          pageSize: 3,
          total: 5,
          hasMore: true,
        })
        .mockResolvedValueOnce({
          items: [
            { id: 'inst-4', number: 4, contractId: 456, debtorName: 'João', amount: 500, dueDate: '2026-06-01', status: 'pending' },
            { id: 'inst-5', number: 5, contractId: 456, debtorName: 'João', amount: 500, dueDate: '2026-07-01', status: 'pending' },
          ],
          page: 1,
          pageSize: 3,
          total: 5,
          hasMore: false,
        });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixar contrato 456' },
        expect: {
          textIncludes: ['#456', 'Parcela', 'mostrar mais'],
        },
      },
      {
        input: { text: 'mostrar mais' },
        expect: {
          textIncludes: ['Parcela', 'número'],
        },
      },
      {
        input: { text: '4' },
        expect: {
          textIncludes: ['Parcela', 'sim', 'confirmar'],
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          mockCalls: { markInstallmentPaid: 1 },
          textIncludes: ['confirmado'],
        },
      },
    ],
  },

  {
    id: 'baixa-005-contrato-lista-vazia',
    description: 'Contrato sem parcelas em aberto',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 789 });
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [],
        page: 0,
        pageSize: 3,
        total: 0,
        hasMore: false,
      });
    },
    steps: [
      {
        input: { text: 'baixar contrato 789' },
        expect: {
          textIncludes: ['Não encontrei parcelas em aberto'],
        },
      },
    ],
  },

  {
    id: 'baixa-006-devedor-mes-sem-resultado',
    description: 'Por devedor + mês: 0 resultados',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { debtor_name: 'Maria Santos', installment_month: 6 });
      ctx.mocks.getInstallmentByDebtorAndMonth.mockResolvedValue(null);
    },
    steps: [
      {
        input: { text: 'baixar parcela de junho de Maria Santos' },
        expect: {
          textIncludes: ['Não encontrei parcela em aberto'],
        },
      },
    ],
  },

  {
    id: 'baixa-007-devedor-mes-um-resultado',
    description: 'Por devedor + mês: 1 resultado (direto para confirmação)',
    category: 'multi_turn',
    criticality: 'core',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { debtor_name: 'Ana Paula', installment_month: 5 });
      ctx.mocks.getInstallmentByDebtorAndMonth.mockResolvedValue({
        installments: [
          { id: 'inst-app1', number: 2, contractId: 111, debtorName: 'Ana Paula', amount: 1200, dueDate: '2026-05-15', status: 'pending' },
        ],
      });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixar de maio da Ana Paula' },
        expect: {
          textIncludes: ['Ana Paula', 'Parcela', 'confirmar', 'sim'],
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          mockCalls: { markInstallmentPaid: 1 },
          textIncludes: ['confirmado'],
        },
      },
    ],
  },

  {
    id: 'baixa-008-devedor-mes-multiplos-resultados',
    description: 'Por devedor + mês: múltiplos resultados (lista)',
    category: 'multi_turn',
    criticality: 'extended',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { debtor_name: 'Roberto Costa', installment_month: 3 });
      ctx.mocks.getInstallmentByDebtorAndMonth.mockResolvedValue({
        installments: [
          { id: 'inst-rc1', number: 1, contractId: 200, debtorName: 'Roberto Costa', amount: 650, dueDate: '2026-03-05', status: 'pending' },
          { id: 'inst-rc2', number: 2, contractId: 201, debtorName: 'Roberto Costa', amount: 800, dueDate: '2026-03-10', status: 'pending' },
        ],
      });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixar de março do Roberto Costa' },
        expect: {
          textIncludes: ['número', 'Parcela', 'em aberto'],
        },
      },
      {
        input: { text: '1' },
        expect: {
          textIncludes: ['Roberto Costa', 'Parcela', 'sim', 'confirmar'],
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          mockCalls: { markInstallmentPaid: 1 },
          textIncludes: ['confirmado', 'Roberto Costa'],
        },
      },
    ],
  },

  {
    id: 'baixa-009-selecao-ordinal',
    description: 'Seleção por número ordinal direto (1º, 2º, 3º)',
    category: 'multi_turn',
    criticality: 'core',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 300 });
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [
          { id: 'inst-1', number: 1, contractId: 300, debtorName: 'Teste', amount: 400, dueDate: '2026-03-20', status: 'pending' },
          { id: 'inst-2', number: 2, contractId: 300, debtorName: 'Teste', amount: 400, dueDate: '2026-04-20', status: 'pending' },
          { id: 'inst-3', number: 3, contractId: 300, debtorName: 'Teste', amount: 400, dueDate: '2026-05-20', status: 'pending' },
        ],
        page: 0,
        pageSize: 3,
        total: 3,
        hasMore: false,
      });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixar contrato 300' },
        expect: {
          textIncludes: ['Parcela', 'número'],
        },
      },
      {
        input: { text: 'primeiro' },
        expect: {
          textIncludes: ['Parcela', 'sim', 'confirmar'],
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          mockCalls: { markInstallmentPaid: 1 },
          textIncludes: ['confirmado'],
        },
      },
    ],
  },

  {
    id: 'baixa-010-selecao-por-nome',
    description: 'Seleção por nome parcial do devedor',
    category: 'multi_turn',
    criticality: 'extended',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 400 });
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [
          { id: 'inst-1', number: 1, contractId: 400, debtorName: 'Francisco Oliveira', amount: 550, dueDate: '2026-03-15', status: 'pending' },
          { id: 'inst-2', number: 2, contractId: 400, debtorName: 'Francisco Oliveira', amount: 550, dueDate: '2026-04-15', status: 'pending' },
        ],
        page: 0,
        pageSize: 2,
        total: 2,
        hasMore: false,
      });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixar contrato 400' },
        expect: {
          textIncludes: ['Parcela', 'número'],
        },
      },
      {
        input: { text: 'oliveira' },
        expect: {
          textIncludes: ['Francisco Oliveira', 'Parcela', 'sim', 'confirmar'],
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          mockCalls: { markInstallmentPaid: 1 },
          textIncludes: ['confirmado', 'Francisco Oliveira'],
        },
      },
    ],
  },

  {
    id: 'baixa-011-installment-id-pre-resolvido',
    description: 'installment_id pré-resolvido via working state (via initialContext)',
    category: 'functional',
    criticality: 'core',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    initialContext: {
      workingState: {
        pendingCapability: 'mark_installment_paid',
        pendingOperationInput: { installment_id: 'inst-preresolvido' },
        candidateSets: {
          installments: [
            {
              id: 'inst-preresolvido',
              label: 'Patricia López — Parcela 5',
              meta: JSON.stringify({
                contractId: 500,
                number: 5,
                debtorName: 'Patricia López',
                amount: 1100,
                dueDate: '2026-05-20',
                status: 'pending',
              }),
            },
          ],
        },
      },
    },
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, {});
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'marcar como pago' },
        expect: {
          textIncludes: ['Patricia López', 'Parcela', 'confirmar', 'sim'],
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          mockCalls: { markInstallmentPaid: 1 },
          textIncludes: ['confirmado', 'Patricia López'],
        },
      },
    ],
  },

  {
    id: 'baixa-012-confirmacao-cancelamento',
    description: 'Cancelamento: "não" aborta a operação',
    category: 'functional',
    criticality: 'core',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 600, installment_number: 3 });
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
        id: 'inst-600-3',
        number: 3,
        contractId: 600,
        debtorName: 'Denise Ferreira',
        amount: 750,
        dueDate: '2026-04-25',
        status: 'pending',
      });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixar contrato 600 parcela 3' },
        expect: {
          textIncludes: ['Denise Ferreira', 'sim', 'não'],
        },
      },
      {
        input: { text: 'não' },
        expect: {
          mockNotCalled: ['markInstallmentPaid'],
        },
      },
    ],
    allowSoftFailure: true,
  },

  {
    id: 'baixa-013-falha-execucao',
    description: 'Falha de execução: markInstallmentPaid retorna false',
    category: 'functional',
    criticality: 'core',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 700, installment_number: 1 });
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
        id: 'inst-700-1',
        number: 1,
        contractId: 700,
        debtorName: 'Gustavo Martins',
        amount: 600,
        dueDate: '2026-03-10',
        status: 'pending',
      });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(false);
    },
    steps: [
      {
        input: { text: 'baixar contrato 700 parcela 1' },
        expect: {
          textIncludes: ['Gustavo Martins', 'sim'],
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          textIncludes: ['Não foi possível', 'erro'],
          mockCalls: { markInstallmentPaid: 1 },
        },
      },
    ],
    allowSoftFailure: true,
  },

  {
    id: 'baixa-014-regressao-company-selection-hijack',
    description: 'BOT-FIX-001: Com seleção de empresa pendente + "1" para parcela NÃO deve ser sequestrado',
    category: 'regressions',
    criticality: 'critical',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    initialContext: {
      workingState: {
        pendingCompanySelection: true,
        candidateSets: {
          companies: [
            { id: 'company-1', label: 'Empresa A' },
            { id: 'company-2', label: 'Empresa B' },
          ],
        },
      },
    },
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 800 });
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [
          { id: 'inst-1', number: 1, contractId: 800, debtorName: 'Isabella', amount: 450, dueDate: '2026-03-05', status: 'pending' },
          { id: 'inst-2', number: 2, contractId: 800, debtorName: 'Isabella', amount: 450, dueDate: '2026-04-05', status: 'pending' },
        ],
        page: 0,
        pageSize: 2,
        total: 2,
        hasMore: false,
      });
      ctx.mocks.listCompaniesByTenant.mockResolvedValue([
        { id: 'company-1', name: 'Empresa A', isPrimary: true },
        { id: 'company-2', name: 'Empresa B', isPrimary: false },
      ]);
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixar contrato 800' },
        expect: {
          textIncludes: ['#800', 'Parcela', 'número'],
          textExcludes: ['Vou considerar a empresa'],
        },
      },
      {
        input: { text: '1' },
        expect: {
          textIncludes: ['Isabella', 'Parcela', 'sim'],
          textExcludes: ['Vou considerar a empresa', 'Empresa A'],
        },
      },
    ],
  },

  {
    id: 'baixa-015-numero-invalido-out-of-range',
    description: 'Seleção inválida: número fora do intervalo',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 900 });
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [
          { id: 'inst-1', number: 1, contractId: 900, debtorName: 'Lucas', amount: 500, dueDate: '2026-03-01', status: 'pending' },
          { id: 'inst-2', number: 2, contractId: 900, debtorName: 'Lucas', amount: 500, dueDate: '2026-04-01', status: 'pending' },
        ],
        page: 0,
        pageSize: 2,
        total: 2,
        hasMore: false,
      });
    },
    steps: [
      {
        input: { text: 'baixar contrato 900' },
        expect: {
          textIncludes: ['Parcela', 'número'],
        },
      },
      {
        input: { text: '99' },
        expect: {
          textIncludes: ['número'],
        },
      },
    ],
    allowSoftFailure: true,
  },

  {
    id: 'baixa-016-numero-invalido-contrato-numero-mismatch',
    description: 'Contrato + número: parcela não existe',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 1000, installment_number: 99 });
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(null);
    },
    steps: [
      {
        input: { text: 'baixar contrato 1000 parcela 99' },
        expect: {
          textIncludes: ['Não encontrei'],
        },
      },
    ],
  },

  {
    id: 'baixa-017-devedor-nome-apenas',
    description: 'Devedor só (sem mês): pede clarificação',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'missing_clarification',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { debtor_name: 'Silva' });
    },
    steps: [
      {
        input: { text: 'baixar parcela do Silva' },
        expect: {
          textIncludes: ['Silva', 'mês', 'contrato'],
        },
      },
    ],
  },

  {
    id: 'baixa-018-nada-provided',
    description: 'Nenhuma informação: pede contrato ou devedor+mês',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, {});
    },
    steps: [
      {
        input: { text: 'baixar um pagamento' },
        expect: {
          textIncludes: ['contrato', 'devedor'],
        },
      },
    ],
  },

  {
    id: 'baixa-019-numero-direto',
    description: 'Contrato + número direto (sem lista intermediária)',
    category: 'functional',
    criticality: 'core',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 1100, installment_number: 4 });
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
        id: 'inst-1100-4',
        number: 4,
        contractId: 1100,
        debtorName: 'Helena Costa',
        amount: 800,
        dueDate: '2026-05-18',
        status: 'pending',
      });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixa 1100 parcela 4' },
        expect: {
          textIncludes: ['Helena Costa', 'Parcela', 'confirmar'],
          mockCalls: { getContractOpenInstallmentByNumber: 1 },
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          mockCalls: { markInstallmentPaid: 1 },
          textIncludes: ['confirmado'],
        },
      },
    ],
  },

  {
    id: 'baixa-020-segundo-terceiro-ordinal',
    description: 'Seleção por "segundo" e "terceiro"',
    category: 'multi_turn',
    criticality: 'extended',
    failureTag: 'bad_confirmation_flow',
    role: 'admin',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    setup(ctx) {
      setupMarkInstallmentPaid(ctx, { contract_id: 1200 });
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [
          { id: 'inst-1', number: 1, contractId: 1200, debtorName: 'Vanessa', amount: 600, dueDate: '2026-03-12', status: 'pending' },
          { id: 'inst-2', number: 2, contractId: 1200, debtorName: 'Vanessa', amount: 600, dueDate: '2026-04-12', status: 'pending' },
          { id: 'inst-3', number: 3, contractId: 1200, debtorName: 'Vanessa', amount: 600, dueDate: '2026-05-12', status: 'pending' },
        ],
        page: 0,
        pageSize: 3,
        total: 3,
        hasMore: false,
      });
      ctx.mocks.markInstallmentPaid.mockResolvedValue(true);
    },
    steps: [
      {
        input: { text: 'baixar contrato 1200' },
        expect: {
          textIncludes: ['Parcela', 'número'],
        },
      },
      {
        input: { text: 'segundo' },
        expect: {
          textIncludes: ['Parcela', 'sim', 'confirmar'],
        },
      },
      {
        input: { text: 'sim' },
        expect: {
          mockCalls: { markInstallmentPaid: 1 },
          textIncludes: ['confirmado'],
        },
      },
    ],
  },
];
