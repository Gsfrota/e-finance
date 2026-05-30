import { expect } from 'vitest';
import type { AgentEvalCase, AgentEvalSetupContext } from './contracts';

/**
 * Matriz exaustiva dos dois fluxos sensíveis (admin-only):
 *   - create_contract       (executors/create-contract.ts)
 *   - mark_installment_paid (executors/mark-installment-paid.ts)
 *
 * Convenção de id: `cap-<capability>-<variante>` para que o runner
 * (tests/eval-dump.test.ts) agrupe por capability.
 *
 * Todos os casos são GREEN-by-design: refletem o comportamento atual
 * verificado no código e servem de suíte de regressão. Achados de produto
 * (léxico de confirmação) ficam em chunk-03; aqui cobrimos os CAMINHOS.
 *
 * Strings de asserção ancoradas em:
 *   - getClarificationMessage() / formatContractConfirmationMessage()
 *   - formatContractCreatedMessage()  → "Contrato #<id> criado"
 *   - formatPaymentConfirmationPreview() → "Baixar parcela — confirmar"
 *   - formatComprovante() → "Pagamento confirmado"
 */

const CONFIRM_CONTRACT = 'Novo contrato — confirmar';
const CONFIRM_PAYMENT = 'Baixar parcela — confirmar';

const VALID_CPF = '52998224725'; // CPF válido usado no dataset oficial

type Entities = Record<string, unknown>;

function routeCreate(entities: Entities) {
  return ({ mocks }: AgentEvalSetupContext) => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'criar_contrato',
      entities: {},
      normalizedEntities: entities,
      confidence: 'high',
      source: 'rule',
    });
  };
}

function routePay(entities: Entities) {
  return ({ mocks }: AgentEvalSetupContext) => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'marcar_pagamento',
      entities: {},
      normalizedEntities: entities,
      confidence: 'high',
      source: 'rule',
    });
  };
}

function openInstallment(over: Partial<{ id: string; number: number; contractId: number; debtorName: string; amount: number; dueDate: string; status: string }> = {}) {
  return {
    id: 'inst-1',
    number: 1,
    contractId: 123,
    debtorName: 'Carlos',
    amount: 900,
    dueDate: '2026-03-10',
    status: 'pending',
    ...over,
  };
}

// ───────────────────────────── CREATE CONTRACT ─────────────────────────────

const createCases: AgentEvalCase[] = [
  // --- Escada de clarificação (BR-BOT-010): cada slot faltante pergunta na ordem ---
  {
    id: 'cap-create_contract-clarify-name',
    description: 'sem dados → pergunta o nome do devedor',
    category: 'functional', criticality: 'critical', failureTag: 'missing_clarification',
    setup: routeCreate({}),
    steps: [{ input: { text: 'quero criar um contrato' }, expect: {
      textIncludes: ['nome completo do devedor'], textExcludes: [CONFIRM_CONTRACT],
      workingState: { pendingCapability: 'create_contract', pendingMissingFields: ['debtor_name'] },
    } }],
  },
  {
    id: 'cap-create_contract-clarify-amount',
    description: 'só nome → pergunta o valor principal',
    category: 'functional', criticality: 'critical', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva' }),
    steps: [{ input: { text: 'criar contrato para João Silva' }, expect: {
      textIncludes: ['valor principal'], textExcludes: [CONFIRM_CONTRACT],
      workingState: { pendingMissingFields: ['amount'] },
    } }],
  },
  {
    id: 'cap-create_contract-clarify-rate',
    description: 'nome+valor → pergunta a taxa de juros',
    category: 'functional', criticality: 'critical', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000 }),
    steps: [{ input: { text: 'contrato João Silva 5000' }, expect: {
      textIncludes: ['taxa de juros'], textExcludes: [CONFIRM_CONTRACT],
      workingState: { pendingMissingFields: ['rate'] },
    } }],
  },
  {
    id: 'cap-create_contract-clarify-installments',
    description: 'nome+valor+taxa → pergunta nº de parcelas',
    category: 'functional', criticality: 'core', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, rate: 10 }),
    steps: [{ input: { text: 'contrato João Silva 5000 10%' }, expect: {
      textIncludes: ['parcelas'], textExcludes: [CONFIRM_CONTRACT],
      workingState: { pendingMissingFields: ['installments'] },
    } }],
  },
  {
    id: 'cap-create_contract-clarify-cpf',
    description: 'falta o CPF → pede CPF do devedor',
    category: 'functional', criticality: 'critical', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, rate: 10, installments: 12 }),
    steps: [{ input: { text: 'contrato João Silva 5000 10% 12x' }, expect: {
      textIncludes: ['CPF do devedor'], textExcludes: [CONFIRM_CONTRACT],
      workingState: { pendingMissingFields: ['debtor_cpf'] },
    } }],
  },
  {
    id: 'cap-create_contract-clarify-cpf-invalid',
    description: 'CPF inválido → re-pede CPF (isValidCpf falha)',
    category: 'functional', criticality: 'critical', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, rate: 10, installments: 12, debtor_cpf: '11111111111' }),
    steps: [{ input: { text: 'cpf 111.111.111-11' }, expect: {
      textIncludes: ['CPF do devedor'], textExcludes: [CONFIRM_CONTRACT],
      workingState: { pendingMissingFields: ['debtor_cpf'] },
    } }],
  },
  {
    id: 'cap-create_contract-clarify-frequency',
    description: 'tudo menos modalidade → pergunta mensal/semanal/quinzenal/diária',
    category: 'functional', criticality: 'core', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, rate: 10, installments: 12, debtor_cpf: VALID_CPF }),
    steps: [{ input: { text: 'contrato fechado' }, expect: {
      textIncludes: ['modalidade de cobrança'], textExcludes: [CONFIRM_CONTRACT],
      workingState: { pendingMissingFields: ['frequency'] },
    } }],
  },
  {
    id: 'cap-create_contract-clarify-dueday-monthly',
    description: 'mensal sem dia → pergunta o dia do mês',
    category: 'functional', criticality: 'core', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, rate: 10, installments: 12, debtor_cpf: VALID_CPF, frequency: 'monthly' }),
    steps: [{ input: { text: 'mensal' }, expect: {
      textIncludes: ['dia do mês'], textExcludes: [CONFIRM_CONTRACT],
      workingState: { pendingMissingFields: ['due_day'] },
    } }],
  },
  {
    id: 'cap-create_contract-clarify-weekday-weekly',
    description: 'semanal sem dia da semana → pergunta o dia da semana',
    category: 'functional', criticality: 'core', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, rate: 10, installments: 12, debtor_cpf: VALID_CPF, frequency: 'weekly' }),
    steps: [{ input: { text: 'semanal' }, expect: {
      textIncludes: ['dia da semana'], textExcludes: [CONFIRM_CONTRACT],
      workingState: { pendingMissingFields: ['weekday'] },
    } }],
  },
  {
    id: 'cap-create_contract-clarify-startdate-biweekly',
    description: 'quinzenal sem data → pergunta a data da primeira parcela',
    category: 'functional', criticality: 'core', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, rate: 10, installments: 12, debtor_cpf: VALID_CPF, frequency: 'biweekly' }),
    steps: [{ input: { text: 'quinzenal' }, expect: {
      textIncludes: ['data da primeira parcela'], textExcludes: [CONFIRM_CONTRACT],
      workingState: { pendingMissingFields: ['start_date'] },
    } }],
  },
  {
    id: 'cap-create_contract-clarify-startdate-daily',
    description: 'diária sem data → pergunta a data da primeira parcela',
    category: 'functional', criticality: 'core', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, rate: 10, installments: 12, debtor_cpf: VALID_CPF, frequency: 'daily' }),
    steps: [{ input: { text: 'diária' }, expect: {
      textIncludes: ['data da primeira parcela'], textExcludes: [CONFIRM_CONTRACT],
      workingState: { pendingMissingFields: ['start_date'] },
    } }],
  },

  // --- One-shot pronto para confirmação, por modalidade ---
  {
    id: 'cap-create_contract-ready-monthly',
    description: 'mensal completo → preview de confirmação',
    category: 'functional', criticality: 'critical', failureTag: 'response_regression',
    setup: routeCreate({ debtor_name: 'Ana Paula', amount: 3000, rate: 5, installments: 6, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10 }),
    steps: [{ input: { text: 'contrato Ana Paula 3000 5% 6x mensal dia 10 cpf 529.982.247-25' }, expect: {
      textIncludes: [CONFIRM_CONTRACT, 'sim'], pendingAction: null,
      workingState: { pendingCapability: 'create_contract', pendingConfirmation: expect.anything() },
    } }],
  },
  {
    id: 'cap-create_contract-ready-weekly',
    description: 'semanal completo → preview de confirmação',
    category: 'functional', criticality: 'core', failureTag: 'response_regression',
    setup: routeCreate({ debtor_name: 'Ana Paula', amount: 3000, rate: 5, installments: 6, debtor_cpf: VALID_CPF, frequency: 'weekly', weekday: 1 }),
    steps: [{ input: { text: 'contrato semanal segunda Ana Paula 3000 5% 6x cpf 529.982.247-25' }, expect: {
      textIncludes: [CONFIRM_CONTRACT], workingState: { pendingConfirmation: expect.anything() },
    } }],
  },
  {
    id: 'cap-create_contract-ready-biweekly',
    description: 'quinzenal completo (data) → preview de confirmação',
    category: 'functional', criticality: 'core', failureTag: 'response_regression',
    setup: routeCreate({ debtor_name: 'Ana Paula', amount: 3000, rate: 0, installments: 6, debtor_cpf: VALID_CPF, frequency: 'biweekly', start_date: '2026-04-10' }),
    steps: [{ input: { text: 'contrato quinzenal Ana Paula 3000 sem juros 6x cpf 529.982.247-25 começando 10/04/2026' }, expect: {
      textIncludes: [CONFIRM_CONTRACT], workingState: { pendingConfirmation: expect.anything() },
    } }],
  },
  {
    id: 'cap-create_contract-ready-daily',
    description: 'diária completa (data) → preview de confirmação',
    category: 'functional', criticality: 'core', failureTag: 'response_regression',
    setup: routeCreate({ debtor_name: 'Ana Paula', amount: 3000, rate: 0, installments: 30, debtor_cpf: VALID_CPF, frequency: 'daily', start_date: '2026-04-10' }),
    steps: [{ input: { text: 'contrato diário Ana Paula 3000 sem juros 30x cpf 529.982.247-25 começando 10/04/2026' }, expect: {
      textIncludes: [CONFIRM_CONTRACT], workingState: { pendingConfirmation: expect.anything() },
    } }],
  },

  // --- Atalhos "pular" / "sem juros" / parcela única ---
  {
    id: 'cap-create_contract-skip-rate-zero',
    description: 'taxa "pular" preenche rate=0 e avança',
    category: 'multi_turn', criticality: 'core', failureTag: 'context_loss',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10, installments: 12 }),
    steps: [
      { input: { text: 'contrato João Silva 5000 12x mensal dia 10 cpf 529.982.247-25' }, expect: { textIncludes: ['taxa de juros'] } },
      { input: { text: 'pular' }, expect: { textIncludes: [CONFIRM_CONTRACT], workingState: { pendingConfirmation: expect.anything() } } },
    ],
  },
  {
    id: 'cap-create_contract-skip-installments-one',
    description: 'parcelas "pular" preenche installments=1 e avança',
    category: 'multi_turn', criticality: 'extended', failureTag: 'context_loss',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, rate: 10, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10 }),
    steps: [
      { input: { text: 'contrato João Silva 5000 10% mensal dia 10 cpf 529.982.247-25' }, expect: { textIncludes: ['parcelas'] } },
      { input: { text: 'pular' }, expect: { textIncludes: [CONFIRM_CONTRACT] } },
    ],
  },

  // --- Confirmação executa / cancela ---
  {
    id: 'cap-create_contract-confirm-success',
    description: 'preview → "sim" cria o contrato e mostra "Contrato #123 criado"',
    category: 'multi_turn', criticality: 'critical', failureTag: 'bad_confirmation_flow',
    setup: routeCreate({ debtor_name: 'Ana Paula', amount: 3000, rate: 5, installments: 6, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10 }),
    steps: [
      { input: { text: 'contrato Ana Paula 3000 5% 6x mensal dia 10 cpf 529.982.247-25' }, expect: { textIncludes: [CONFIRM_CONTRACT], mockCalls: { createContract: 0 } } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Contrato #123 criado'], pendingAction: null, mockCalls: { createContract: 1 } } },
    ],
  },
  {
    id: 'cap-create_contract-confirm-cancel',
    description: 'preview → "não" cancela e NÃO cria o contrato',
    category: 'multi_turn', criticality: 'critical', failureTag: 'bad_confirmation_flow',
    setup: routeCreate({ debtor_name: 'Ana Paula', amount: 3000, rate: 5, installments: 6, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10 }),
    steps: [
      { input: { text: 'contrato Ana Paula 3000 5% 6x mensal dia 10 cpf 529.982.247-25' }, expect: { textIncludes: [CONFIRM_CONTRACT] } },
      { input: { text: 'não' }, expect: { textExcludes: ['Contrato #123 criado'], mockCalls: { createContract: 0 } } },
    ],
  },

  // --- Conflito de nome de CPF já cadastrado ---
  {
    id: 'cap-create_contract-conflict-use-existing',
    description: 'CPF já cadastrado → "1" usa nome existente e cria',
    category: 'multi_turn', criticality: 'core', failureTag: 'bad_confirmation_flow',
    setup: (ctx) => {
      routeCreate({ debtor_name: 'Ana P.', amount: 3000, rate: 5, installments: 6, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10 })(ctx);
      ctx.mocks.createContract
        .mockResolvedValueOnce({ status: 'conflict_name', debtorCpf: VALID_CPF, existingName: 'Ana Paula', requestedName: 'Ana P.' })
        .mockResolvedValue({ status: 'success', id: 123, debtorName: 'Ana Paula', debtorCpf: VALID_CPF, firstInstallment: '2026-04-10 - R$ 500', debtorResolution: 'reused' });
    },
    steps: [
      { input: { text: 'contrato Ana P. 3000 5% 6x mensal dia 10 cpf 529.982.247-25' }, expect: { textIncludes: [CONFIRM_CONTRACT] } },
      { input: { text: 'sim' }, expect: { textIncludes: ['CPF já cadastrado para'] } },
      { input: { text: '1' }, expect: { textIncludes: [CONFIRM_CONTRACT] } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Contrato #123 criado'], mockCalls: { createContract: 2 } } },
    ],
  },
  {
    id: 'cap-create_contract-conflict-replace',
    description: 'CPF já cadastrado → "2" substitui o nome e cria',
    category: 'multi_turn', criticality: 'extended', failureTag: 'bad_confirmation_flow',
    setup: (ctx) => {
      routeCreate({ debtor_name: 'Ana P.', amount: 3000, rate: 5, installments: 6, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10 })(ctx);
      ctx.mocks.createContract
        .mockResolvedValueOnce({ status: 'conflict_name', debtorCpf: VALID_CPF, existingName: 'Ana Paula', requestedName: 'Ana P.' })
        .mockResolvedValue({ status: 'success', id: 123, debtorName: 'Ana P.', debtorCpf: VALID_CPF, firstInstallment: '2026-04-10 - R$ 500', debtorResolution: 'reused', renameApplied: true });
    },
    steps: [
      { input: { text: 'contrato Ana P. 3000 5% 6x mensal dia 10 cpf 529.982.247-25' }, expect: { textIncludes: [CONFIRM_CONTRACT] } },
      { input: { text: 'sim' }, expect: { textIncludes: ['CPF já cadastrado para'] } },
      { input: { text: '2' }, expect: { textIncludes: [CONFIRM_CONTRACT] } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Contrato #123 criado'], mockCalls: { createContract: 2 } } },
    ],
  },

  // --- Erros de execução ---
  {
    id: 'cap-create_contract-error-transient',
    description: 'erro transitório (rpc_failed) → mensagem com dica de repetir',
    category: 'functional', criticality: 'core', failureTag: 'response_regression',
    setup: (ctx) => {
      routeCreate({ debtor_name: 'Ana Paula', amount: 3000, rate: 5, installments: 6, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10 })(ctx);
      ctx.mocks.createContract.mockResolvedValue({ status: 'error', reason: 'rpc_failed' });
    },
    steps: [
      { input: { text: 'contrato Ana Paula 3000 5% 6x mensal dia 10 cpf 529.982.247-25' }, expect: { textIncludes: [CONFIRM_CONTRACT] } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Não foi possível criar o contrato', 'repetir a confirmação'] } },
    ],
  },
  {
    id: 'cap-create_contract-error-permanent',
    description: 'erro permanente (invalid_cpf) → mensagem sem dica de repetir',
    category: 'functional', criticality: 'extended', failureTag: 'response_regression',
    setup: (ctx) => {
      routeCreate({ debtor_name: 'Ana Paula', amount: 3000, rate: 5, installments: 6, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10 })(ctx);
      ctx.mocks.createContract.mockResolvedValue({ status: 'error', reason: 'invalid_cpf' });
    },
    steps: [
      { input: { text: 'contrato Ana Paula 3000 5% 6x mensal dia 10 cpf 529.982.247-25' }, expect: { textIncludes: [CONFIRM_CONTRACT] } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Não foi possível criar o contrato'], textExcludes: ['repetir a confirmação'] } },
    ],
  },
];

// ─────────────────────────── MARK INSTALLMENT PAID ──────────────────────────

const payCases: AgentEvalCase[] = [
  // --- Rotas de resolução: pedidos incompletos ---
  {
    id: 'cap-mark_installment_paid-clarify-nothing',
    description: 'sem alvo → pede contrato+parcela ou nome+mês',
    category: 'functional', criticality: 'critical', failureTag: 'missing_clarification',
    setup: routePay({}),
    steps: [{ input: { text: 'quero dar baixa numa parcela' }, expect: {
      textIncludes: ['contrato'], textExcludes: [CONFIRM_PAYMENT],
      workingState: { pendingCapability: 'mark_installment_paid' },
    } }],
  },
  {
    id: 'cap-mark_installment_paid-clarify-debtor-only',
    description: 'só nome do devedor → pede o mês ou contrato+parcela',
    category: 'functional', criticality: 'core', failureTag: 'missing_clarification',
    setup: routePay({ debtor_name: 'Carlos' }),
    steps: [{ input: { text: 'baixar parcela do Carlos' }, expect: {
      textIncludes: ['mês'], textExcludes: [CONFIRM_PAYMENT],
      workingState: { pendingMissingFields: ['installment_month'] },
    } }],
  },

  // --- contrato + número da parcela ---
  {
    id: 'cap-mark_installment_paid-by-number-ready',
    description: 'contrato+nº → localiza e pede confirmação',
    category: 'functional', criticality: 'critical', failureTag: 'response_regression',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 2 })(ctx);
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(openInstallment({ id: 'inst-2', number: 2, amount: 900 }));
    },
    steps: [{ input: { text: 'baixar contrato 123 parcela 2' }, expect: {
      textIncludes: [CONFIRM_PAYMENT], workingState: { pendingConfirmation: expect.anything() }, mockCalls: { markInstallmentPaid: 0 },
    } }],
  },
  {
    id: 'cap-mark_installment_paid-by-number-notfound',
    description: 'contrato+nº inexistente → informa que não encontrou a parcela',
    category: 'functional', criticality: 'core', failureTag: 'response_regression',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 9 })(ctx);
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(null);
    },
    steps: [{ input: { text: 'baixar contrato 123 parcela 9' }, expect: {
      textIncludes: ['Não encontrei a parcela'], textExcludes: [CONFIRM_PAYMENT],
    } }],
  },

  // --- contrato + mês ---
  {
    id: 'cap-mark_installment_paid-by-month-ready',
    description: 'contrato+mês → localiza e pede confirmação',
    category: 'functional', criticality: 'core', failureTag: 'response_regression',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_month: 4 })(ctx);
      ctx.mocks.getContractOpenInstallmentByMonth.mockResolvedValue(openInstallment({ id: 'inst-4', number: 4, dueDate: '2026-04-10' }));
    },
    steps: [{ input: { text: 'baixar a parcela de abril do contrato 123' }, expect: {
      textIncludes: [CONFIRM_PAYMENT], workingState: { pendingConfirmation: expect.anything() },
    } }],
  },
  {
    id: 'cap-mark_installment_paid-by-month-notfound',
    description: 'contrato+mês sem parcela → informa não encontrado',
    category: 'functional', criticality: 'extended', failureTag: 'response_regression',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_month: 4 })(ctx);
      ctx.mocks.getContractOpenInstallmentByMonth.mockResolvedValue(null);
    },
    steps: [{ input: { text: 'baixar a parcela de abril do contrato 123' }, expect: {
      textIncludes: ['Não encontrei parcela em aberto desse contrato'], textExcludes: [CONFIRM_PAYMENT],
    } }],
  },

  // --- contrato apenas → lista / vazio ---
  {
    id: 'cap-mark_installment_paid-contract-list',
    description: 'só contrato → lista as parcelas em aberto para escolha',
    category: 'functional', criticality: 'core', failureTag: 'missing_clarification',
    setup: (ctx) => {
      routePay({ contract_id: 123 })(ctx);
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [openInstallment({ id: 'inst-1', number: 1 }), openInstallment({ id: 'inst-2', number: 2, dueDate: '2026-04-10' })],
        page: 0, pageSize: 3, total: 2, hasMore: false,
      });
    },
    steps: [{ input: { text: 'baixar contrato 123' }, expect: {
      textIncludes: ['Encontrei estas parcelas'], textExcludes: [CONFIRM_PAYMENT],
      workingState: { pendingMissingFields: ['installment_choice'] },
    } }],
  },
  {
    id: 'cap-mark_installment_paid-contract-empty',
    description: 'só contrato sem parcelas em aberto → informa que não há',
    category: 'functional', criticality: 'extended', failureTag: 'response_regression',
    setup: (ctx) => {
      routePay({ contract_id: 123 })(ctx);
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({ items: [], page: 0, pageSize: 3, total: 0, hasMore: false });
    },
    steps: [{ input: { text: 'baixar contrato 123' }, expect: {
      textIncludes: ['Não encontrei parcelas em aberto'], textExcludes: [CONFIRM_PAYMENT],
    } }],
  },

  // --- devedor + mês ---
  {
    id: 'cap-mark_installment_paid-debtor-month-single',
    description: 'devedor+mês com 1 parcela → pede confirmação direto',
    category: 'functional', criticality: 'core', failureTag: 'response_regression',
    setup: (ctx) => {
      routePay({ debtor_name: 'Carlos', installment_month: 3 })(ctx);
      ctx.mocks.getInstallmentByDebtorAndMonth.mockResolvedValue({ installments: [openInstallment({ id: 'inst-1', number: 1 })] });
    },
    steps: [{ input: { text: 'baixar a parcela de março do Carlos' }, expect: {
      textIncludes: [CONFIRM_PAYMENT], workingState: { pendingConfirmation: expect.anything() },
    } }],
  },
  {
    id: 'cap-mark_installment_paid-debtor-month-many',
    description: 'devedor+mês com várias parcelas → lista para escolha',
    category: 'functional', criticality: 'core', failureTag: 'missing_clarification',
    setup: (ctx) => {
      routePay({ debtor_name: 'Carlos', installment_month: 3 })(ctx);
      ctx.mocks.getInstallmentByDebtorAndMonth.mockResolvedValue({
        installments: [openInstallment({ id: 'inst-1', number: 1, contractId: 123 }), openInstallment({ id: 'inst-9', number: 1, contractId: 999 })],
      });
    },
    steps: [{ input: { text: 'baixar a parcela de março do Carlos' }, expect: {
      textIncludes: ['Encontrei estas parcelas'], workingState: { pendingMissingFields: ['installment_choice'] },
    } }],
  },
  {
    id: 'cap-mark_installment_paid-debtor-month-none',
    description: 'devedor+mês sem parcela → informa não encontrado',
    category: 'functional', criticality: 'extended', failureTag: 'response_regression',
    setup: (ctx) => {
      routePay({ debtor_name: 'Carlos', installment_month: 3 })(ctx);
      ctx.mocks.getInstallmentByDebtorAndMonth.mockResolvedValue(null);
    },
    steps: [{ input: { text: 'baixar a parcela de março do Carlos' }, expect: {
      textIncludes: ['Não encontrei parcela em aberto para'], textExcludes: [CONFIRM_PAYMENT],
    } }],
  },

  // --- seleção a partir da lista ---
  {
    id: 'cap-mark_installment_paid-list-then-ordinal',
    description: 'lista → escolhe pelo número "1" → confirmação',
    category: 'multi_turn', criticality: 'core', failureTag: 'context_loss',
    setup: (ctx) => {
      routePay({ contract_id: 123 })(ctx);
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [openInstallment({ id: 'inst-1', number: 1 }), openInstallment({ id: 'inst-2', number: 2, dueDate: '2026-04-10' })],
        page: 0, pageSize: 3, total: 2, hasMore: false,
      });
    },
    steps: [
      { input: { text: 'baixar contrato 123' }, expect: { textIncludes: ['Encontrei estas parcelas'] } },
      { input: { text: '1' }, expect: { textIncludes: [CONFIRM_PAYMENT], workingState: { pendingConfirmation: expect.anything() } } },
    ],
  },
  {
    id: 'cap-mark_installment_paid-list-then-primeiro',
    description: 'lista → escolhe "primeira" → confirmação',
    category: 'multi_turn', criticality: 'extended', failureTag: 'context_loss',
    setup: (ctx) => {
      routePay({ contract_id: 123 })(ctx);
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [openInstallment({ id: 'inst-1', number: 1 }), openInstallment({ id: 'inst-2', number: 2, dueDate: '2026-04-10' })],
        page: 0, pageSize: 3, total: 2, hasMore: false,
      });
    },
    steps: [
      { input: { text: 'baixar contrato 123' }, expect: { textIncludes: ['Encontrei estas parcelas'] } },
      { input: { text: 'a primeira' }, expect: { textIncludes: [CONFIRM_PAYMENT] } },
    ],
  },
  {
    id: 'cap-mark_installment_paid-mostrar-mais',
    description: 'lista paginada → "mostrar mais" traz a próxima página',
    category: 'multi_turn', criticality: 'extended', failureTag: 'context_loss',
    setup: (ctx) => {
      routePay({ contract_id: 123 })(ctx);
      ctx.mocks.getContractOpenInstallments.mockImplementation(async (_tenant: string, _contract: number, page = 0) => {
        if (page === 0) {
          return {
            items: [openInstallment({ id: 'inst-1', number: 1 }), openInstallment({ id: 'inst-2', number: 2 }), openInstallment({ id: 'inst-3', number: 3 })],
            page: 0, pageSize: 3, total: 5, hasMore: true,
          };
        }
        return {
          items: [openInstallment({ id: 'inst-4', number: 4 }), openInstallment({ id: 'inst-5', number: 5 })],
          page: 1, pageSize: 3, total: 5, hasMore: false,
        };
      });
    },
    steps: [
      { input: { text: 'baixar contrato 123' }, expect: { textIncludes: ['Encontrei estas parcelas', 'mostrar mais'] } },
      { input: { text: 'mostrar mais' }, expect: { textIncludes: ['Encontrei estas parcelas'] } },
    ],
  },

  // --- confirmação executa / cancela / falha ---
  {
    id: 'cap-mark_installment_paid-confirm-success',
    description: 'confirmação "sim" baixa a parcela e emite comprovante',
    category: 'multi_turn', criticality: 'critical', failureTag: 'bad_confirmation_flow',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 2 })(ctx);
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(openInstallment({ id: 'inst-2', number: 2, amount: 900 }));
    },
    steps: [
      { input: { text: 'baixar contrato 123 parcela 2' }, expect: { textIncludes: [CONFIRM_PAYMENT], mockCalls: { markInstallmentPaid: 0 } } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Pagamento confirmado', '#123'], pendingAction: null, mockCalls: { markInstallmentPaid: 1 } } },
    ],
  },
  {
    id: 'cap-mark_installment_paid-confirm-cancel',
    description: 'confirmação "não" cancela e NÃO baixa a parcela',
    category: 'multi_turn', criticality: 'critical', failureTag: 'bad_confirmation_flow',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 2 })(ctx);
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(openInstallment({ id: 'inst-2', number: 2, amount: 900 }));
    },
    steps: [
      { input: { text: 'baixar contrato 123 parcela 2' }, expect: { textIncludes: [CONFIRM_PAYMENT] } },
      { input: { text: 'não' }, expect: { textExcludes: ['Pagamento confirmado'], mockCalls: { markInstallmentPaid: 0 } } },
    ],
  },
  {
    // REGRESSÃO do achado live: com seleção de empresa pendente, o número que
    // escolhe a PARCELA não pode ser sequestrado pela seleção de empresa.
    id: 'cap-mark_installment_paid-company-selection-no-hijack',
    description: 'número de seleção de parcela não é sequestrado por seleção de empresa pendente',
    category: 'multi_turn', criticality: 'critical', failureTag: 'context_loss',
    setup: (ctx) => {
      routePay({ contract_id: 123 })(ctx);
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [openInstallment({ id: 'inst-1', number: 1 }), openInstallment({ id: 'inst-2', number: 2, dueDate: '2026-04-10' })],
        page: 0, pageSize: 3, total: 2, hasMore: false,
      });
    },
    steps: [
      { input: { text: 'quais empresas eu tenho?' }, expect: { textIncludes: ['Empresas disponíveis'] } },
      { input: { text: 'baixar contrato 123' }, expect: { textIncludes: ['Encontrei estas parcelas'] } },
      { input: { text: '1' }, expect: { textIncludes: [CONFIRM_PAYMENT], textExcludes: ['Vou considerar a empresa'] } },
    ],
  },
  {
    id: 'cap-mark_installment_paid-execute-fail',
    description: 'RPC de baixa falha → mensagem de erro, sem comprovante',
    category: 'multi_turn', criticality: 'core', failureTag: 'response_regression',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 2 })(ctx);
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(openInstallment({ id: 'inst-2', number: 2, amount: 900 }));
      ctx.mocks.markInstallmentPaid.mockResolvedValue(false);
    },
    steps: [
      { input: { text: 'baixar contrato 123 parcela 2' }, expect: { textIncludes: [CONFIRM_PAYMENT] } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Não foi possível marcar como pago'], textExcludes: ['Pagamento confirmado'], mockCalls: { markInstallmentPaid: 1 } } },
    ],
  },
];

// ───────────────────────── BULLET (juros simples) ─────────────────────────
// BR-BOT-011 (criação) / BR-BOT-012 (baixa). Bullet = calculation_mode interest_only:
// paga só juros/período, principal em aberto, prazo indeterminado.

const BULLET_TITLE = 'Juros simples';
const BULLET_CHOICE = 'Contrato de juros simples';

function bulletInfo(over: Partial<{ isBullet: boolean; remainingBalance: number; contractId: number; interestDue: number }> = {}) {
  return { isBullet: true, remainingBalance: 5000, contractId: 123, interestDue: 500, ...over };
}

const bulletCases: AgentEvalCase[] = [
  // --- Criação bullet ---
  {
    id: 'cap-create_contract-bullet-ready-monthly',
    description: 'bullet mensal completo (entities) → confirmação sem total linear',
    category: 'functional', criticality: 'critical', failureTag: 'response_regression',
    setup: routeCreate({ debtor_name: 'Ana Paula', amount: 5000, rate: 10, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10, calculation_mode: 'interest_only' }),
    steps: [{ input: { text: 'contrato juros simples Ana Paula 5000 10% mensal dia 10 cpf 529.982.247-25' }, expect: {
      textIncludes: [CONFIRM_CONTRACT, BULLET_TITLE, 'prazo indeterminado', 'Principal em aberto'],
      textExcludes: ['Total a pagar', 'Rentabilidade'],
      workingState: { pendingCapability: 'create_contract', pendingConfirmation: expect.anything() },
    } }],
  },
  {
    id: 'cap-create_contract-bullet-skip-installments',
    description: 'bullet pula o slot de parcelas → pede CPF, não "parcelas"',
    category: 'functional', criticality: 'critical', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, rate: 10, calculation_mode: 'interest_only' }),
    steps: [{ input: { text: 'empréstimo só juros para João Silva 5000 10%' }, expect: {
      textIncludes: ['CPF do devedor'], textExcludes: ['parcelas', CONFIRM_CONTRACT],
      workingState: { pendingMissingFields: ['debtor_cpf'] },
    } }],
  },
  {
    id: 'cap-create_contract-bullet-nl-trigger',
    description: 'gatilho "só juros" no texto (sem entity) marca bullet e fica pronto',
    category: 'functional', criticality: 'core', failureTag: 'response_regression',
    setup: routeCreate({ debtor_name: 'Ana Paula', amount: 5000, rate: 10, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10 }),
    steps: [{ input: { text: 'contrato Ana Paula 5000 10% mensal dia 10 paga só os juros cpf 529.982.247-25' }, expect: {
      textIncludes: [CONFIRM_CONTRACT, BULLET_TITLE], textExcludes: ['Total a pagar'],
      workingState: { pendingConfirmation: expect.anything() },
    } }],
  },
  {
    id: 'cap-create_contract-bullet-confirm-success',
    description: 'bullet → "sim" cria e mostra comprovante sem total linear',
    category: 'multi_turn', criticality: 'critical', failureTag: 'bad_confirmation_flow',
    setup: (ctx) => {
      routeCreate({ debtor_name: 'Ana Paula', amount: 5000, rate: 10, debtor_cpf: VALID_CPF, frequency: 'monthly', due_day: 10, calculation_mode: 'interest_only' })(ctx);
    },
    steps: [
      { input: { text: 'contrato juros simples Ana Paula 5000 10% mensal dia 10 cpf 529.982.247-25' }, expect: { textIncludes: [CONFIRM_CONTRACT, BULLET_TITLE], mockCalls: { createContract: 0 } } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Contrato #123 criado', BULLET_TITLE], pendingAction: null, mockCalls: { createContract: 1 } } },
    ],
  },

  // --- Baixa bullet: escolha rolagem/quitação ---
  {
    id: 'cap-mark_installment_paid-bullet-choice',
    description: 'parcela bullet → pergunta rolagem/quitação com JUROS correto (não amount_total)',
    category: 'functional', criticality: 'critical', failureTag: 'missing_clarification',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 1 })(ctx);
      // amount_total = 5500 (principal + juros); interestDue real = 500. O bug exibia 5500/10500.
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(openInstallment({ id: 'inst-1', number: 1, amount: 5500 }));
      ctx.mocks.getInstallmentBulletInfo.mockResolvedValue(bulletInfo({ remainingBalance: 5000, interestDue: 500 }));
    },
    steps: [{ input: { text: 'baixar contrato 123 parcela 1' }, expect: {
      // juros = R$ 500.00; quitar total = 5000 + 500 = R$ 5500.00. NUNCA R$ 10500.00 (bug).
      textIncludes: [BULLET_CHOICE, 'R$ 500.00', 'R$ 5500.00'], textExcludes: [CONFIRM_PAYMENT, 'R$ 10500.00'],
      workingState: { pendingMissingFields: ['bullet_mode'] }, mockCalls: { payBulletInterest: 0 },
    } }],
  },
  {
    id: 'cap-mark_installment_paid-bullet-rollover-success',
    description: 'bullet → "juros" → confirma rolagem → paga só juros (payBulletInterest 1×)',
    category: 'multi_turn', criticality: 'critical', failureTag: 'bad_confirmation_flow',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 1 })(ctx);
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(openInstallment({ id: 'inst-1', number: 1, amount: 5500 }));
      ctx.mocks.getInstallmentBulletInfo.mockResolvedValue(bulletInfo({ remainingBalance: 5000, interestDue: 500 }));
      ctx.mocks.payBulletInterest.mockResolvedValue({ ok: true, contractClosed: false, interestPaid: 500, principalPaid: 0, newBalance: 5000 });
    },
    steps: [
      { input: { text: 'baixar contrato 123 parcela 1' }, expect: { textIncludes: [BULLET_CHOICE] } },
      { input: { text: 'juros' }, expect: { textIncludes: [CONFIRM_PAYMENT, 'Rolagem', 'R$ 500.00'], textExcludes: ['R$ 5500.00'], workingState: { pendingConfirmation: expect.anything() }, mockCalls: { payBulletInterest: 0 } } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Pagamento confirmado', 'Rolagem de juros'], pendingAction: null, mockCalls: { payBulletInterest: 1, markInstallmentPaid: 0 } } },
    ],
  },
  {
    id: 'cap-mark_installment_paid-bullet-settle-success',
    description: 'bullet → "quitar" → confirma quitação → quita principal+juros e encerra',
    category: 'multi_turn', criticality: 'critical', failureTag: 'bad_confirmation_flow',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 1 })(ctx);
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(openInstallment({ id: 'inst-1', number: 1, amount: 5500 }));
      ctx.mocks.getInstallmentBulletInfo.mockResolvedValue(bulletInfo({ remainingBalance: 5000, interestDue: 500 }));
      ctx.mocks.payBulletInterest.mockResolvedValue({ ok: true, contractClosed: true, interestPaid: 500, principalPaid: 5000, newBalance: 0 });
    },
    steps: [
      { input: { text: 'baixar contrato 123 parcela 1' }, expect: { textIncludes: [BULLET_CHOICE] } },
      { input: { text: 'quitar' }, expect: { textIncludes: [CONFIRM_PAYMENT, 'Quitação', 'R$ 5500.00'], textExcludes: ['R$ 10500.00'], mockCalls: { payBulletInterest: 0 } } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Pagamento confirmado', 'Contrato quitado', 'encerrado'], mockCalls: { payBulletInterest: 1, markInstallmentPaid: 0 } } },
    ],
  },
  {
    // REGRESSÃO BOT-FIX-001 sob bullet: selecionar a parcela "1" com seleção de
    // empresa pendente não pode ser sequestrado; e a parcela bullet deve abrir a
    // escolha rolagem/quitação.
    id: 'cap-mark_installment_paid-bullet-company-no-hijack',
    description: 'bullet via lista: "1" não vira seleção de empresa e abre escolha juros/quitar',
    category: 'multi_turn', criticality: 'critical', failureTag: 'context_loss',
    setup: (ctx) => {
      routePay({ contract_id: 123 })(ctx);
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [openInstallment({ id: 'inst-1', number: 1, amount: 500 }), openInstallment({ id: 'inst-2', number: 2, amount: 500, dueDate: '2026-04-10' })],
        page: 0, pageSize: 3, total: 2, hasMore: false,
      });
      ctx.mocks.getInstallmentBulletInfo.mockResolvedValue(bulletInfo());
    },
    steps: [
      { input: { text: 'quais empresas eu tenho?' }, expect: { textIncludes: ['Empresas disponíveis'] } },
      { input: { text: 'baixar contrato 123' }, expect: { textIncludes: ['Encontrei estas parcelas'] } },
      { input: { text: '1' }, expect: { textIncludes: [BULLET_CHOICE], textExcludes: ['Vou considerar a empresa'] } },
    ],
  },
];

export const CONTRACT_FLOW_CASES: AgentEvalCase[] = [...createCases, ...payCases, ...bulletCases];
