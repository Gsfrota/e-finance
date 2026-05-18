import type { AgentEvalCase } from '../contracts';

export const EDGE_CASES: AgentEvalCase[] = [
  // GROUP 1: Devedor não encontrado (matchedDebtors=0) — 15 casos
  {
    id: 'edge-debtor-not-found-01',
    description: 'admin tenta dar baixa com nome completamente fictício',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'XyzABC123' },
        normalizedEntities: { debtor_name: 'XyzABC123' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa XyzABC123' },
        expect: {
          textIncludes: ['Não encontrei', 'XyzABC123'],
          mockCalls: {
            getOpenInstallmentsByDebtorName: 1,
          },
          mockNotCalled: ['markInstallmentPaid'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-02',
    description: 'admin com typo no nome do devedor',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Joao Silvs' },
        normalizedEntities: { debtor_name: 'Joao Silvs' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Joao Silvs' },
        expect: {
          textIncludes: ['Não encontrei', 'Joao Silvs'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-03',
    description: 'nome vazio ou apenas espaços',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: '   ' },
        normalizedEntities: { debtor_name: '   ' },
        confidence: 'medium',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa    ' },
        expect: {
          textIncludes: ['Não encontrei'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-04',
    description: 'nome com apenas um caractere',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'A' },
        normalizedEntities: { debtor_name: 'A' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa A' },
        expect: {
          textIncludes: ['Não encontrei', 'A'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-05',
    description: 'nome com caracteres especiais que não existem no banco',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'José@#$!%' },
        normalizedEntities: { debtor_name: 'José@#$!%' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa José@#$!%' },
        expect: {
          textIncludes: ['Não encontrei'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-06',
    description: 'nome que é substring de nome real, mas insuficiente',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Jo' },
        normalizedEntities: { debtor_name: 'Jo' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Jo' },
        expect: {
          textIncludes: ['Não encontrei', 'Jo'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-07',
    description: 'nome com números que não existem',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: '12345' },
        normalizedEntities: { debtor_name: '12345' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa 12345' },
        expect: {
          textIncludes: ['Não encontrei'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-08',
    description: 'nome com acentos que não combinam no banco',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Jõao' },
        normalizedEntities: { debtor_name: 'Jõao' },
        confidence: 'medium',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Jõao' },
        expect: {
          textIncludes: ['Não encontrei'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-09',
    description: 'nome em maiúsculas que não bate sensibilidade de case',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'UNKNOWNPERSON' },
        normalizedEntities: { debtor_name: 'UNKNOWNPERSON' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa UNKNOWNPERSON' },
        expect: {
          textIncludes: ['Não encontrei'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-10',
    description: 'nome com apenas consoantes',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Brt' },
        normalizedEntities: { debtor_name: 'Brt' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Brt' },
        expect: {
          textIncludes: ['Não encontrei', 'Brt'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-11',
    description: 'nome que é apelido ou nickname, não match real',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Ze' },
        normalizedEntities: { debtor_name: 'Ze' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Ze' },
        expect: {
          textIncludes: ['Não encontrei', 'Ze'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-12',
    description: 'nome muito longo que não existe',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: {
          debtor_name: 'VeryLongNameThatDoesNotExistInTheDatabase123456789',
        },
        normalizedEntities: {
          debtor_name: 'VeryLongNameThatDoesNotExistInTheDatabase123456789',
        },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: {
          text: 'dar baixa VeryLongNameThatDoesNotExistInTheDatabase123456789',
        },
        expect: {
          textIncludes: ['Não encontrei'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-13',
    description: 'nome com hífen que não existe',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Fake-Name-Hyphen' },
        normalizedEntities: { debtor_name: 'Fake-Name-Hyphen' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Fake-Name-Hyphen' },
        expect: {
          textIncludes: ['Não encontrei'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-14',
    description: 'nome intencionalmente ofensivo ou impossível',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: '!!!NoOne!!!' },
        normalizedEntities: { debtor_name: '!!!NoOne!!!' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa !!!NoOne!!!' },
        expect: {
          textIncludes: ['Não encontrei'],
        },
      },
    ],
  },
  {
    id: 'edge-debtor-not-found-15',
    description: 'nome com espaços múltiplos incorretos',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Name    With    Spaces' },
        normalizedEntities: { debtor_name: 'Name    With    Spaces' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 0,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Name    With    Spaces' },
        expect: {
          textIncludes: ['Não encontrei'],
        },
      },
    ],
  },

  // GROUP 2: Devedor encontrado, sem parcelas abertas (matchedDebtors=1, installments=[]) — 10 casos
  {
    id: 'edge-no-installments-01',
    description: 'um devedor encontrado mas com zero parcelas abertas',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'João Silva' },
        normalizedEntities: { debtor_name: 'João Silva' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 1,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa João Silva' },
        expect: {
          textIncludes: ['João Silva', 'não tem parcelas'],
          mockCalls: {
            getOpenInstallmentsByDebtorName: 1,
          },
          mockNotCalled: ['markInstallmentPaid'],
        },
      },
    ],
  },
  {
    id: 'edge-no-installments-02',
    description: 'devedor encontrado mas todas parcelas estão em status quitado',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Maria Santos' },
        normalizedEntities: { debtor_name: 'Maria Santos' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 1,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Maria Santos' },
        expect: {
          textIncludes: ['Maria Santos', 'não tem parcelas em aberto'],
        },
      },
    ],
  },
  {
    id: 'edge-no-installments-03',
    description: 'devedor com nome parcial exato que resolveu 1 pessoa, sem parcelas',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Ana' },
        normalizedEntities: { debtor_name: 'Ana' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 1,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Ana' },
        expect: {
          textIncludes: ['Ana', 'não tem parcelas em aberto'],
        },
      },
    ],
  },
  {
    id: 'edge-no-installments-04',
    description: 'devedor com nome composto encontrado uma vez, sem parcelas',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'José Benedito Santos' },
        normalizedEntities: { debtor_name: 'José Benedito Santos' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 1,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa José Benedito Santos' },
        expect: {
          textIncludes: ['José Benedito Santos', 'não tem parcelas'],
        },
      },
    ],
  },
  {
    id: 'edge-no-installments-05',
    description: 'devedor com nome em minúsculas normalizado, sem parcelas',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'carlos oliveira' },
        normalizedEntities: { debtor_name: 'carlos oliveira' },
        confidence: 'medium',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 1,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa carlos oliveira' },
        expect: {
          textIncludes: ['carlos oliveira', 'não tem parcelas'],
        },
      },
    ],
  },
  {
    id: 'edge-no-installments-06',
    description: 'devedor com números no nome encontrado 1x, sem parcelas',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'José da Silva 123' },
        normalizedEntities: { debtor_name: 'José da Silva 123' },
        confidence: 'medium',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 1,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa José da Silva 123' },
        expect: {
          textIncludes: ['José da Silva 123', 'não tem parcelas'],
        },
      },
    ],
  },
  {
    id: 'edge-no-installments-07',
    description: 'devedor com caracteres especiais permitidos, sem parcelas',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: "João D'Ávila" },
        normalizedEntities: { debtor_name: "João D'Ávila" },
        confidence: 'medium',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 1,
      });
    },
    steps: [
      {
        input: { text: "dar baixa João D'Ávila" },
        expect: {
          textIncludes: ["João D'Ávila", 'não tem parcelas'],
        },
      },
    ],
  },
  {
    id: 'edge-no-installments-08',
    description: 'devedor com nome tipo empresa encontrado 1x, sem parcelas',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Empresa XYZ Ltda' },
        normalizedEntities: { debtor_name: 'Empresa XYZ Ltda' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 1,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Empresa XYZ Ltda' },
        expect: {
          textIncludes: ['Empresa XYZ Ltda', 'não tem parcelas'],
        },
      },
    ],
  },
  {
    id: 'edge-no-installments-09',
    description: 'devedor com nome muito curto encontrado 1x, sem parcelas',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Rui' },
        normalizedEntities: { debtor_name: 'Rui' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 1,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Rui' },
        expect: {
          textIncludes: ['Rui', 'não tem parcelas'],
        },
      },
    ],
  },
  {
    id: 'edge-no-installments-10',
    description: 'devedor com nome idêntico ao do admin, sem parcelas',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'marcar_pagamento',
        entities: { debtor_name: 'Guilherme Admin' },
        normalizedEntities: { debtor_name: 'Guilherme Admin' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getOpenInstallmentsByDebtorName.mockResolvedValue({
        installments: [],
        matchedDebtors: 1,
      });
    },
    steps: [
      {
        input: { text: 'dar baixa Guilherme Admin' },
        expect: {
          textIncludes: ['Guilherme Admin', 'não tem parcelas'],
        },
      },
    ],
  },

]
;
