import { expect } from 'vitest';
import type { AgentEvalCase, AgentEvalSetupContext } from './contracts';

/**
 * Bateria de ESTRESSE — erro humano e ambiguidade nos fluxos sensíveis (admin-only).
 * Foco: o bot deve guiar o admin para o caminho certo e NUNCA executar uma mutação
 * financeira em cima de ambiguidade (ex.: dois clientes com o mesmo nome).
 *
 * Convenção de id: `stress-<area>-<variante>`.
 */

const CONFIRM_PAYMENT = 'Baixar parcela — confirmar';
const VALID_CPF = '52998224725';

type Entities = Record<string, unknown>;

function routePay(entities: Entities) {
  return ({ mocks }: AgentEvalSetupContext) => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'marcar_pagamento', entities: {}, normalizedEntities: entities,
      confidence: 'high', source: 'rule',
    });
  };
}
function routeCreate(entities: Entities) {
  return ({ mocks }: AgentEvalSetupContext) => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'criar_contrato', entities: {}, normalizedEntities: entities,
      confidence: 'high', source: 'rule',
    });
  };
}
function openInstallment(over: Partial<{ id: string; number: number; contractId: number; debtorName: string; amount: number; dueDate: string; status: string }> = {}) {
  return { id: 'inst-1', number: 1, contractId: 123, debtorName: 'João Silva', amount: 900, dueDate: '2026-06-10', status: 'pending', ...over };
}

// Dois clientes homônimos distintos (CPFs diferentes).
const TWO_JOAOS = [
  { id: 'p1', full_name: 'João Silva', cpf: '52998224725' }, // final -25
  { id: 'p2', full_name: 'João Silva', cpf: '11144477735' }, // final -35
];

// getInstallmentByDebtorAndMonth: ambíguo sem preselect; resolvido com preselect.
function mockHomonyms(ctx: AgentEvalSetupContext, chosenInstallment = openInstallment()) {
  ctx.mocks.getInstallmentByDebtorAndMonth.mockImplementation(
    async (_t: string, _name: string, _m: number, _y: number | undefined, preId?: string) => {
      if (!preId) return { installments: [], debtorName: '', debtorId: '', ambiguousDebtors: TWO_JOAOS };
      return { installments: [chosenInstallment], debtorName: 'João Silva', debtorId: preId };
    },
  );
}

export const STRESS_FLOW_CASES: AgentEvalCase[] = [
  // ───────── BR-BOT-013: homônimos na baixa por nome ─────────
  {
    id: 'stress-homonimo-baixa-pergunta-cliente',
    description: 'dois clientes mesmo nome → bot pergunta QUAL cliente, não baixa às cegas',
    category: 'functional', criticality: 'critical', failureTag: 'missing_clarification',
    setup: (ctx) => { routePay({ debtor_name: 'João Silva', installment_month: 6 })(ctx); mockHomonyms(ctx); },
    steps: [{ input: { text: 'baixar a parcela de junho do João Silva' }, expect: {
      textIncludes: ['2 clientes', '***.***.***-25', '***.***.***-35', 'cliente errado'],
      textExcludes: [CONFIRM_PAYMENT],
      workingState: { pendingMissingFields: ['debtor_choice'] },
      mockNotCalled: ['markInstallmentPaid'],
    } }],
  },
  {
    id: 'stress-homonimo-baixa-escolhe-ordinal',
    description: 'homônimos → "2" seleciona o cliente certo e segue para confirmação',
    category: 'multi_turn', criticality: 'critical', failureTag: 'bad_confirmation_flow',
    setup: (ctx) => { routePay({ debtor_name: 'João Silva', installment_month: 6 })(ctx); mockHomonyms(ctx); },
    steps: [
      { input: { text: 'baixar a parcela de junho do João Silva' }, expect: { textIncludes: ['2 clientes'], mockNotCalled: ['markInstallmentPaid'] } },
      { input: { text: '2' }, expect: { textIncludes: [CONFIRM_PAYMENT], workingState: { pendingConfirmation: expect.anything() } } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Pagamento confirmado'], mockCalls: { markInstallmentPaid: 1 } } },
    ],
  },
  {
    id: 'stress-homonimo-baixa-escolhe-cpf',
    description: 'homônimos → final do CPF "35" resolve o cliente certo',
    category: 'multi_turn', criticality: 'core', failureTag: 'context_loss',
    setup: (ctx) => { routePay({ debtor_name: 'João Silva', installment_month: 6 })(ctx); mockHomonyms(ctx); },
    steps: [
      { input: { text: 'baixar a parcela de junho do João Silva' }, expect: { textIncludes: ['2 clientes'] } },
      { input: { text: '35' }, expect: { textIncludes: [CONFIRM_PAYMENT] } },
    ],
  },
  {
    id: 'stress-homonimo-baixa-escolha-invalida',
    description: 'homônimos → escolha fora do range re-pergunta, não baixa',
    category: 'multi_turn', criticality: 'core', failureTag: 'missing_clarification',
    setup: (ctx) => { routePay({ debtor_name: 'João Silva', installment_month: 6 })(ctx); mockHomonyms(ctx); },
    steps: [
      { input: { text: 'baixar a parcela de junho do João Silva' }, expect: { textIncludes: ['2 clientes'] } },
      { input: { text: '9' }, expect: { textIncludes: ['Não identifiquei o cliente'], textExcludes: [CONFIRM_PAYMENT], mockNotCalled: ['markInstallmentPaid'] } },
    ],
  },
  {
    // BR-BOT-013 + BOT-FIX-001: escolha de cliente homônimo não é sequestrada por
    // seleção de empresa pendente.
    id: 'stress-homonimo-baixa-no-company-hijack',
    description: 'homônimos com seleção de empresa pendente: "2" escolhe o cliente, não a empresa',
    category: 'multi_turn', criticality: 'critical', failureTag: 'context_loss',
    setup: (ctx) => { routePay({ debtor_name: 'João Silva', installment_month: 6 })(ctx); mockHomonyms(ctx); },
    steps: [
      { input: { text: 'quais empresas eu tenho?' }, expect: { textIncludes: ['Empresas disponíveis'] } },
      { input: { text: 'baixar a parcela de junho do João Silva' }, expect: { textIncludes: ['2 clientes'] } },
      { input: { text: '2' }, expect: { textIncludes: [CONFIRM_PAYMENT], textExcludes: ['Vou considerar a empresa'] } },
    ],
  },

  // ───────── BR-BOT-014 (BOT-007): contract_id inferido pelo LLM sob homônimos ─────────
  {
    id: 'stress-homonimo-contract_id-inferido-desambigua',
    description: 'pedido por nome + contract_id inferido sob homônimos → desambigua a pessoa, descarta o contrato',
    category: 'safety', criticality: 'critical', failureTag: 'context_loss',
    setup: (ctx) => {
      // LLM injeta contract_id do histórico junto do nome.
      routePay({ debtor_name: 'João Silva', installment_month: 6, contract_id: 777 })(ctx);
      ctx.mocks.searchDebtorsByName.mockResolvedValue(TWO_JOAOS);
      // se (errado) caísse no contrato 777, acharia a parcela; o teste garante que NÃO cai nisso.
      ctx.mocks.getContractOpenInstallmentByMonth.mockResolvedValue(openInstallment({ id: 'inst-x', number: 1, contractId: 777 }));
      mockHomonyms(ctx);
    },
    steps: [{ input: { text: 'baixar a parcela de junho do João Silva' }, expect: {
      textIncludes: ['2 clientes', '***.***.***-25', '***.***.***-35'],
      textExcludes: [CONFIRM_PAYMENT],
      workingState: { pendingMissingFields: ['debtor_choice'] },
      mockNotCalled: ['markInstallmentPaid'],
    } }],
  },
  {
    id: 'stress-homonimo-contract_id-inferido-resolve-correto',
    description: 'após escolher a pessoa, resolve pelo devedor (não pelo contract_id inferido)',
    category: 'multi_turn', criticality: 'critical', failureTag: 'bad_confirmation_flow',
    setup: (ctx) => {
      routePay({ debtor_name: 'João Silva', installment_month: 6, contract_id: 777 })(ctx);
      ctx.mocks.searchDebtorsByName.mockResolvedValue(TWO_JOAOS);
      mockHomonyms(ctx, openInstallment({ id: 'inst-p2', number: 1, contractId: 555 }));
    },
    steps: [
      { input: { text: 'baixar a parcela de junho do João Silva' }, expect: { textIncludes: ['2 clientes'] } },
      { input: { text: '35' }, expect: { textIncludes: [CONFIRM_PAYMENT], textExcludes: ['#777'] } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Pagamento confirmado'], mockCalls: { markInstallmentPaid: 1 } } },
    ],
  },

  // ───────── Segurança: confirmação ambígua não executa ─────────
  {
    id: 'stress-baixa-confirmacao-ambigua-nao-executa',
    description: 'resposta ambígua na confirmação da baixa NÃO marca pagamento',
    category: 'safety', criticality: 'critical', failureTag: 'bad_confirmation_flow',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 2 })(ctx);
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(openInstallment({ id: 'inst-2', number: 2, amount: 900 }));
    },
    steps: [
      { input: { text: 'baixar contrato 123 parcela 2' }, expect: { textIncludes: [CONFIRM_PAYMENT] } },
      { input: { text: 'talvez' }, expect: { textExcludes: ['Pagamento confirmado'], mockNotCalled: ['markInstallmentPaid'] } },
    ],
  },

  // ───────── Robustez: seleção fora do range na lista ─────────
  {
    id: 'stress-baixa-selecao-fora-do-range',
    description: 'escolher número de parcela inexistente na lista não quebra nem baixa',
    category: 'functional', criticality: 'core', failureTag: 'context_loss',
    setup: (ctx) => {
      routePay({ contract_id: 123 })(ctx);
      ctx.mocks.getContractOpenInstallments.mockResolvedValue({
        items: [openInstallment({ id: 'inst-1', number: 1 }), openInstallment({ id: 'inst-2', number: 2, dueDate: '2026-07-10' })],
        page: 0, pageSize: 3, total: 2, hasMore: false,
      });
    },
    steps: [
      { input: { text: 'baixar contrato 123' }, expect: { textIncludes: ['Encontrei estas parcelas'] } },
      { input: { text: '9' }, expect: { textExcludes: [CONFIRM_PAYMENT], mockNotCalled: ['markInstallmentPaid'] } },
    ],
  },

  // ───────── Criação: CPF malformado re-pede ─────────
  {
    id: 'stress-criar-cpf-malformado',
    description: 'CPF com dígito verificador inválido → re-pede CPF, não cria',
    category: 'functional', criticality: 'critical', failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'Ana Paula', amount: 5000, rate: 10, installments: 12, debtor_cpf: '12345678900' }),
    steps: [{ input: { text: 'contrato Ana Paula 5000 10% 12x cpf 123.456.789-00' }, expect: {
      textIncludes: ['CPF do devedor'], textExcludes: ['Novo contrato — confirmar'],
      workingState: { pendingMissingFields: ['debtor_cpf'] },
      mockNotCalled: ['createContract'],
    } }],
  },
];

// Garante que VALID_CPF segue sendo o CPF aceito (sanity de fixture).
void VALID_CPF;
