import { expect } from 'vitest';
import type { AgentEvalCase, AgentEvalSetupContext } from './contracts';

/**
 * PROBE-CREATE: Suíte determinística para cobertura COMPLETA de criação de contratos.
 *
 * Objetivo: exercitar TODAS as formas de criar contrato (parcelado padrão E bullet/juros simples),
 * parsing de entrada, e coletar métricas + achados.
 *
 * Convenção de id: `probe-create-<variante>` para isolamento do harness.
 * Todos os casos refletem comportamento desejado verificado no código.
 *
 * Strings de asserção ancoradas em:
 *   - getClarificationMessage() / formatContractConfirmationMessage() / formatBulletContractMessage()
 *   - formatContractCreatedMessage() → "Contrato #<id> criado" / "Juros simples"
 */

const CONFIRM_CONTRACT = 'Novo contrato — confirmar';
const VALID_CPF = '52998224725'; // CPF válido do dataset

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

// ───────────────────────── PARCELADO PADRÃO ──────────────────────

export const PROBE_CREATE_CASES: AgentEvalCase[] = [
  // --- BR-BOT-010: Escada de clarificação (parcelado padrão)
  {
    id: 'probe-create-clarify-name',
    description: 'sem dados → pergunta nome do devedor',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({}),
    steps: [
      {
        input: { text: 'quero criar um contrato' },
        expect: {
          textIncludes: ['nome completo do devedor'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingCapability: 'create_contract', pendingMissingFields: ['debtor_name'] },
        },
      },
    ],
  },

  {
    id: 'probe-create-clarify-amount',
    description: 'só nome → pergunta valor principal',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva' }),
    steps: [
      {
        input: { text: 'criar contrato para João Silva' },
        expect: {
          textIncludes: ['valor principal'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['amount'] },
        },
      },
    ],
  },

  {
    id: 'probe-create-clarify-rate',
    description: 'nome+valor → pergunta taxa de juros',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000 }),
    steps: [
      {
        input: { text: 'João Silva 5000' },
        expect: {
          textIncludes: ['taxa de juros'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['rate'] },
        },
      },
    ],
  },

  {
    id: 'probe-create-clarify-installments',
    description: 'nome+valor+taxa → pergunta nº de parcelas',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({ debtor_name: 'João Silva', amount: 5000, rate: 10 }),
    steps: [
      {
        input: { text: 'João Silva 5000 10%' },
        expect: {
          textIncludes: ['parcelas'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['installments'] },
        },
      },
    ],
  },

  {
    id: 'probe-create-clarify-cpf',
    description: 'falta CPF → pede CPF do devedor',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'João Silva',
      amount: 5000,
      rate: 10,
      installments: 12,
    }),
    steps: [
      {
        input: { text: 'João Silva 5000 10% 12x' },
        expect: {
          textIncludes: ['CPF do devedor'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['debtor_cpf'] },
        },
      },
    ],
  },

  {
    id: 'probe-create-clarify-cpf-invalid',
    description: 'CPF inválido → re-pede CPF',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'João Silva',
      amount: 5000,
      rate: 10,
      installments: 12,
      debtor_cpf: '11111111111',
    }),
    steps: [
      {
        input: { text: 'cpf 111.111.111-11' },
        expect: {
          textIncludes: ['CPF do devedor'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['debtor_cpf'] },
        },
      },
    ],
  },

  {
    id: 'probe-create-clarify-frequency',
    description: 'tudo menos modalidade → pergunta mensal/semanal/quinzenal/diária',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'João Silva',
      amount: 5000,
      rate: 10,
      installments: 12,
      debtor_cpf: VALID_CPF,
    }),
    steps: [
      {
        input: { text: 'contrato fechado' },
        expect: {
          textIncludes: ['modalidade de cobrança'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['frequency'] },
        },
      },
    ],
  },

  // --- BR-BOT-010: Frequências (parcelado padrão)
  {
    id: 'probe-create-freq-monthly-dueday',
    description: 'mensal sem dia → pergunta dia do mês',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'João Silva',
      amount: 5000,
      rate: 10,
      installments: 12,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
    }),
    steps: [
      {
        input: { text: 'mensal' },
        expect: {
          textIncludes: ['dia do mês'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['due_day'] },
        },
      },
    ],
  },

  {
    id: 'probe-create-freq-weekly-weekday',
    description: 'semanal sem dia da semana → pergunta dia da semana',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'João Silva',
      amount: 5000,
      rate: 10,
      installments: 12,
      debtor_cpf: VALID_CPF,
      frequency: 'weekly',
    }),
    steps: [
      {
        input: { text: 'semanal' },
        expect: {
          textIncludes: ['dia da semana'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['weekday'] },
        },
      },
    ],
  },

  {
    id: 'probe-create-freq-biweekly-startdate',
    description: 'quinzenal sem data → pergunta data da primeira parcela',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'João Silva',
      amount: 5000,
      rate: 10,
      installments: 12,
      debtor_cpf: VALID_CPF,
      frequency: 'biweekly',
    }),
    steps: [
      {
        input: { text: 'quinzenal' },
        expect: {
          textIncludes: ['data da primeira parcela'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['start_date'] },
        },
      },
    ],
  },

  {
    id: 'probe-create-freq-daily-startdate',
    description: 'diária sem data → pergunta data da primeira parcela',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'João Silva',
      amount: 5000,
      rate: 10,
      installments: 12,
      debtor_cpf: VALID_CPF,
      frequency: 'daily',
    }),
    steps: [
      {
        input: { text: 'diária' },
        expect: {
          textIncludes: ['data da primeira parcela'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['start_date'] },
        },
      },
    ],
  },

  // --- Confirmação pronta (parcelado padrão, 4 frequências)
  {
    id: 'probe-create-ready-monthly',
    description: 'mensal completo → preview confirmação + "Total a pagar"',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      installments: 6,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
      due_day: 10,
    }),
    steps: [
      {
        input: {
          text: 'contrato Ana Paula 3000 5% 6x mensal dia 10 cpf 529.982.247-25',
        },
        expect: {
          textIncludes: [CONFIRM_CONTRACT, 'Total a pagar', 'sim'],
          textExcludes: ['Juros simples', 'prazo indeterminado'],
          workingState: {
            pendingCapability: 'create_contract',
            pendingConfirmation: expect.anything(),
          },
        },
      },
    ],
  },

  {
    id: 'probe-create-ready-weekly',
    description: 'semanal completo → preview confirmação',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      installments: 6,
      debtor_cpf: VALID_CPF,
      frequency: 'weekly',
      weekday: 1,
    }),
    steps: [
      {
        input: { text: 'semanal segunda Ana Paula 3000 5% 6x' },
        expect: {
          textIncludes: [CONFIRM_CONTRACT, 'Total a pagar'],
          workingState: { pendingConfirmation: expect.anything() },
        },
      },
    ],
  },

  {
    id: 'probe-create-ready-biweekly',
    description: 'quinzenal completo (data) → preview confirmação',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 0,
      installments: 6,
      debtor_cpf: VALID_CPF,
      frequency: 'biweekly',
      start_date: '2026-04-10',
    }),
    steps: [
      {
        input: {
          text: 'contrato quinzenal Ana Paula 3000 sem juros 6x cpf 529.982.247-25 começando 10/04/2026',
        },
        expect: {
          textIncludes: [CONFIRM_CONTRACT, 'Total a pagar'],
        },
      },
    ],
  },

  {
    id: 'probe-create-ready-daily',
    description: 'diária completa (data) → preview confirmação',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 0,
      installments: 30,
      debtor_cpf: VALID_CPF,
      frequency: 'daily',
      start_date: '2026-04-10',
    }),
    steps: [
      {
        input: {
          text: 'diária Ana Paula 3000 sem juros 30x começando 10/04/2026',
        },
        expect: {
          textIncludes: [CONFIRM_CONTRACT, 'Total a pagar'],
        },
      },
    ],
  },

  // --- Parsing: sem juros / pular
  {
    id: 'probe-create-parse-no-interest',
    description: '"sem juros" → rate=0, avança para próximo slot',
    category: 'multi_turn',
    criticality: 'core',
    failureTag: 'context_loss',
    setup: routeCreate({
      debtor_name: 'João Silva',
      amount: 5000,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
      due_day: 10,
      installments: 12,
    }),
    steps: [
      {
        input: { text: 'contrato João Silva 5000 12x mensal dia 10' },
        expect: { textIncludes: ['taxa de juros'] },
      },
      {
        input: { text: 'sem juros' },
        expect: {
          textIncludes: [CONFIRM_CONTRACT],
          workingState: { pendingConfirmation: expect.anything() },
        },
      },
    ],
  },

  {
    id: 'probe-create-parse-skip-rate',
    description: '"pular" para taxa → rate=0, avança',
    category: 'multi_turn',
    criticality: 'core',
    failureTag: 'context_loss',
    setup: routeCreate({
      debtor_name: 'João Silva',
      amount: 5000,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
      due_day: 10,
      installments: 12,
    }),
    steps: [
      {
        input: { text: 'João Silva 5000 12x mensal dia 10' },
        expect: { textIncludes: ['taxa de juros'] },
      },
      {
        input: { text: 'pular' },
        expect: { textIncludes: [CONFIRM_CONTRACT] },
      },
    ],
  },

  {
    id: 'probe-create-parse-skip-installments',
    description: '"pular" para parcelas → installments=1, avança',
    category: 'multi_turn',
    criticality: 'extended',
    failureTag: 'context_loss',
    setup: routeCreate({
      debtor_name: 'João Silva',
      amount: 5000,
      rate: 10,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
      due_day: 10,
    }),
    steps: [
      {
        input: { text: 'João Silva 5000 10% mensal dia 10' },
        expect: { textIncludes: ['parcelas'] },
      },
      {
        input: { text: 'pular' },
        expect: { textIncludes: [CONFIRM_CONTRACT] },
      },
    ],
  },

  // --- CPF: formatos variados
  {
    id: 'probe-create-parse-cpf-formatted',
    description: 'CPF formatado 529.982.247-25 → normalizado',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      installments: 6,
      debtor_cpf: '52998224725',
      frequency: 'monthly',
      due_day: 10,
    }),
    steps: [
      {
        input: {
          text: 'contrato Ana Paula 3000 5% 6x mensal dia 10 cpf 529.982.247-25',
        },
        expect: {
          textIncludes: [CONFIRM_CONTRACT],
          workingState: { pendingConfirmation: expect.anything() },
        },
      },
    ],
  },

  {
    id: 'probe-create-parse-cpf-raw',
    description: 'CPF sem formatação 52998224725 → normalizado',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      installments: 6,
      debtor_cpf: '52998224725',
      frequency: 'monthly',
      due_day: 10,
    }),
    steps: [
      {
        input: {
          text: 'Ana Paula 3000 5% 6x mensal dia 10 52998224725',
        },
        expect: {
          textIncludes: [CONFIRM_CONTRACT],
          workingState: { pendingConfirmation: expect.anything() },
        },
      },
    ],
  },

  // --- Valor: formatos variados
  {
    id: 'probe-create-parse-amount-reais',
    description: 'Valor R$ 5.000 → normalizado',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 5000,
      rate: 5,
      installments: 6,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
      due_day: 10,
    }),
    steps: [
      {
        input: {
          text: 'Ana Paula R$ 5.000 5% 6x mensal dia 10 529.982.247-25',
        },
        expect: {
          textIncludes: [CONFIRM_CONTRACT],
        },
      },
    ],
  },

  {
    id: 'probe-create-parse-amount-mil',
    description: 'Valor "20 mil" → normalizado a 20000',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 20000,
      rate: 5,
      installments: 6,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
      due_day: 10,
    }),
    steps: [
      {
        input: {
          text: 'Ana Paula 20 mil 5% 6x mensal dia 10 529.982.247-25',
        },
        expect: {
          textIncludes: [CONFIRM_CONTRACT],
        },
      },
    ],
  },

  // --- Confirmação: sim/não
  {
    id: 'probe-create-confirm-yes',
    description: 'preview → "sim" cria contrato + "Contrato #123 criado"',
    category: 'multi_turn',
    criticality: 'critical',
    failureTag: 'bad_confirmation_flow',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      installments: 6,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
      due_day: 10,
    }),
    steps: [
      {
        input: {
          text: 'contrato Ana Paula 3000 5% 6x mensal dia 10 529.982.247-25',
        },
        expect: { textIncludes: [CONFIRM_CONTRACT], mockCalls: { createContract: 0 } },
      },
      {
        input: { text: 'sim' },
        expect: {
          textIncludes: ['Contrato #123 criado'],
          pendingAction: null,
          mockCalls: { createContract: 1 },
        },
      },
    ],
  },

  {
    id: 'probe-create-confirm-no',
    description: 'preview → "não" cancela, NÃO cria',
    category: 'multi_turn',
    criticality: 'critical',
    failureTag: 'bad_confirmation_flow',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      installments: 6,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
      due_day: 10,
    }),
    steps: [
      {
        input: {
          text: 'contrato Ana Paula 3000 5% 6x mensal dia 10 529.982.247-25',
        },
        expect: { textIncludes: [CONFIRM_CONTRACT] },
      },
      {
        input: { text: 'não' },
        expect: {
          textExcludes: ['Contrato #123 criado'],
          mockCalls: { createContract: 0 },
        },
      },
    ],
  },

  // ───────────────────────── BULLET (JUROS SIMPLES) ──────────────────────

  // --- BR-BOT-011: Gatilho de bullet
  {
    id: 'probe-create-bullet-trigger-keyword',
    description: 'texto "bullet" → calculation_mode=interest_only detectado',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: { text: 'contrato bullet Ana Paula 3000 5%' },
        expect: {
          textIncludes: ['CPF do devedor'],
          textExcludes: ['parcelas'],
        },
      },
    ],
  },

  {
    id: 'probe-create-bullet-trigger-juros-simples',
    description: 'texto "juros simples" → calculation_mode=interest_only detectado',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: { text: 'contrato juros simples Ana Paula 3000 5%' },
        expect: {
          textIncludes: ['CPF do devedor'],
          textExcludes: ['parcelas'],
        },
      },
    ],
  },

  {
    id: 'probe-create-bullet-trigger-só-juros',
    description: 'texto "só juros" → calculation_mode=interest_only detectado',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: { text: 'contrato só juros Ana Paula 3000 5%' },
        expect: {
          textIncludes: ['CPF do devedor'],
          textExcludes: ['parcelas'],
        },
      },
    ],
  },

  // --- BR-BOT-011: Escada de clarificação (bullet PULA parcelas)
  {
    id: 'probe-create-bullet-clarify-name',
    description: 'bullet sem nome → pergunta nome',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({ calculation_mode: 'interest_only' }),
    steps: [
      {
        input: { text: 'quero bullet' },
        expect: {
          textIncludes: ['nome completo do devedor'],
          textExcludes: [CONFIRM_CONTRACT],
        },
      },
    ],
  },

  {
    id: 'probe-create-bullet-clarify-amount',
    description: 'bullet só nome → pergunta valor',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: { text: 'bullet Ana Paula' },
        expect: {
          textIncludes: ['valor principal'],
          textExcludes: [CONFIRM_CONTRACT],
        },
      },
    ],
  },

  {
    id: 'probe-create-bullet-clarify-rate',
    description: 'bullet nome+valor → pergunta taxa',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: { text: 'bullet Ana Paula 3000' },
        expect: {
          textIncludes: ['taxa de juros'],
          textExcludes: [CONFIRM_CONTRACT],
        },
      },
    ],
  },

  {
    id: 'probe-create-bullet-clarify-cpf-skip-installments',
    description:
      'bullet nome+valor+taxa → pergunta CPF (NÃO pergunta parcelas)',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: { text: 'bullet Ana Paula 3000 5%' },
        expect: {
          textIncludes: ['CPF do devedor'],
          textExcludes: ['parcelas', CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['debtor_cpf'] },
        },
      },
    ],
  },

  {
    id: 'probe-create-bullet-clarify-frequency',
    description:
      'bullet completo sem modalidade → pergunta frequência (mensal/semanal/quinzenal/diária)',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      debtor_cpf: VALID_CPF,
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: { text: 'bullet Ana Paula 3000 5% cpf 529.982.247-25' },
        expect: {
          textIncludes: ['modalidade de cobrança'],
          textExcludes: [CONFIRM_CONTRACT],
          workingState: { pendingMissingFields: ['frequency'] },
        },
      },
    ],
  },

  // --- BR-BOT-011: Confirmação bullet (contains "Juros simples" + "prazo indeterminado", NOT "Total a pagar")
  {
    id: 'probe-create-bullet-ready-monthly',
    description:
      'bullet mensal completo → preview com "Juros simples" + "prazo indeterminado", SEM "Total a pagar"',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
      due_day: 10,
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: {
          text: 'bullet Ana Paula 3000 5% mensal dia 10 cpf 529.982.247-25',
        },
        expect: {
          textIncludes: [
            CONFIRM_CONTRACT,
            'Juros simples',
            'prazo indeterminado',
          ],
          textExcludes: ['Total a pagar'],
          workingState: {
            pendingCapability: 'create_contract',
            pendingConfirmation: expect.anything(),
          },
        },
      },
    ],
  },

  {
    id: 'probe-create-bullet-ready-weekly',
    description:
      'bullet semanal completo → preview com "Juros simples" + "prazo indeterminado"',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      debtor_cpf: VALID_CPF,
      frequency: 'weekly',
      weekday: 1,
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: {
          text: 'bullet semanal segunda Ana Paula 3000 5% cpf 529.982.247-25',
        },
        expect: {
          textIncludes: [
            CONFIRM_CONTRACT,
            'Juros simples',
            'prazo indeterminado',
          ],
          textExcludes: ['Total a pagar'],
        },
      },
    ],
  },

  {
    id: 'probe-create-bullet-ready-biweekly',
    description:
      'bullet quinzenal completo (data) → preview com "Juros simples"',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      debtor_cpf: VALID_CPF,
      frequency: 'biweekly',
      start_date: '2026-04-10',
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: {
          text: 'bullet quinzenal Ana Paula 3000 5% cpf 529.982.247-25 começando 10/04/2026',
        },
        expect: {
          textIncludes: [
            CONFIRM_CONTRACT,
            'Juros simples',
            'prazo indeterminado',
          ],
          textExcludes: ['Total a pagar'],
        },
      },
    ],
  },

  {
    id: 'probe-create-bullet-ready-daily',
    description:
      'bullet diária completo (data) → preview com "Juros simples"',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      debtor_cpf: VALID_CPF,
      frequency: 'daily',
      start_date: '2026-04-10',
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: {
          text: 'bullet diária Ana Paula 3000 5% cpf 529.982.247-25 começando 10/04/2026',
        },
        expect: {
          textIncludes: [
            CONFIRM_CONTRACT,
            'Juros simples',
            'prazo indeterminado',
          ],
          textExcludes: ['Total a pagar'],
        },
      },
    ],
  },

  // --- BR-BOT-011: Confirmação bullet
  {
    id: 'probe-create-bullet-confirm-yes',
    description:
      'bullet preview → "sim" cria + "Contrato #123 criado" com "Juros simples"',
    category: 'multi_turn',
    criticality: 'critical',
    failureTag: 'bad_confirmation_flow',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
      due_day: 10,
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: {
          text: 'bullet Ana Paula 3000 5% mensal dia 10 cpf 529.982.247-25',
        },
        expect: { textIncludes: [CONFIRM_CONTRACT], mockCalls: { createContract: 0 } },
      },
      {
        input: { text: 'sim' },
        expect: {
          textIncludes: ['Contrato #123 criado', 'Juros simples'],
          pendingAction: null,
          mockCalls: { createContract: 1 },
        },
      },
    ],
  },

  {
    id: 'probe-create-bullet-confirm-no',
    description: 'bullet preview → "não" cancela, NÃO cria',
    category: 'multi_turn',
    criticality: 'critical',
    failureTag: 'bad_confirmation_flow',
    setup: routeCreate({
      debtor_name: 'Ana Paula',
      amount: 3000,
      rate: 5,
      debtor_cpf: VALID_CPF,
      frequency: 'monthly',
      due_day: 10,
      calculation_mode: 'interest_only',
    }),
    steps: [
      {
        input: {
          text: 'bullet Ana Paula 3000 5% mensal dia 10 cpf 529.982.247-25',
        },
        expect: { textIncludes: [CONFIRM_CONTRACT] },
      },
      {
        input: { text: 'não' },
        expect: {
          textExcludes: ['Contrato #123 criado'],
          mockCalls: { createContract: 0 },
        },
      },
    ],
  },
];
