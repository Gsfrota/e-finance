import type { AgentEvalCase } from './contracts';

/**
 * PROBE-VIEW: Comprehensive QA suite for all VIEW capabilities
 *
 * Coverage matrix:
 * - show_dashboard (ver_dashboard)
 * - list_receivables (listar_recebiveis) — with filter variations
 * - list_collection_targets (cobrar_hoje)
 * - query_collection_window (cobrar_periodo/semana) — 1d, 7d, 60d windows
 * - query_receivables_window (recebiveis_periodo) — 1d, 7d, 60d windows
 * - query_debtor_balance (buscar_usuario) — single user, multiple candidates
 * - generate_report (gerar_relatorio)
 *
 * Each intent tested with:
 * - Empty dataset (no results)
 * - Populated dataset (various contract types: single, multi-installment, late)
 * - Error/edge cases
 * - Time window variations
 */

export const PROBE_VIEW_CASES: AgentEvalCase[] = [
  // ===== SHOW_DASHBOARD =====
  {
    id: 'view-dashboard-001-basic',
    description: 'Dashboard com dados de exemplo completos',
    category: 'functional',
    criticality: 'critical',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'ver_dashboard',
        entities: {},
        normalizedEntities: {},
        confidence: 'high',
        source: 'rule',
      });
      mocks.getDashboardSummary.mockResolvedValue({
        receivedMonth: 5000,
        receivedByPaymentMonth: 5000,
        receivedByDueMonth: 4500,
        expectedMonth: 6000,
        totalOverdue: 1200,
        activeContracts: 8,
        overdueContracts: 2,
      });
    },
    steps: [
      {
        input: { text: 'dashboard' },
        expect: {
          textIncludes: ['📊', 'Dashboard', 'R$ 5.000', 'Contratos ativos', 'Com atraso'],
          mockCalls: { getDashboardSummary: 1 },
        },
      },
    ],
  },

  // ===== LIST_RECEIVABLES =====
  {
    id: 'view-receivables-001-empty',
    description: 'Lista de recebíveis vazia',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'listar_recebiveis',
        entities: { filter: 'pending' },
        normalizedEntities: { filter: 'pending' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getInstallments.mockResolvedValue([]);
    },
    steps: [
      {
        input: { text: 'recebiveis' },
        expect: {
          textIncludes: ['✅', 'Nenhuma parcela pendente'],
          mockCalls: { getInstallments: 1 },
        },
      },
    ],
  },

  {
    id: 'view-receivables-002-with-data',
    description: 'Lista de recebíveis com múltiplas parcelas pendentes',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'listar_recebiveis',
        entities: { filter: 'pending' },
        normalizedEntities: { filter: 'pending' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getInstallments.mockResolvedValue([
        {
          debtorName: 'João Silva',
          amount: 500,
          dueDate: '2026-06-10',
          daysLate: 0,
          status: 'pending',
        },
        {
          debtorName: 'Maria Santos',
          amount: 750,
          dueDate: '2026-06-15',
          daysLate: 0,
          status: 'pending',
        },
        {
          debtorName: 'Carlos Oliveira',
          amount: 1200,
          dueDate: '2026-06-20',
          daysLate: 0,
          status: 'pending',
        },
      ]);
    },
    steps: [
      {
        input: { text: 'recebiveis' },
        expect: {
          textIncludes: ['📋', 'João Silva', 'Maria Santos', 'Carlos Oliveira', 'R$ 500,00', 'R$ 750,00', 'R$ 1.200,00'],
          mockCalls: { getInstallments: 1 },
        },
      },
    ],
  },

  {
    id: 'view-receivables-003-with-late',
    description: 'Lista de recebíveis com parcelas em atraso',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'listar_recebiveis',
        entities: { filter: 'late' },
        normalizedEntities: { filter: 'late' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getInstallments.mockResolvedValue([
        {
          debtorName: 'Ana Paula',
          amount: 900,
          dueDate: '2026-05-20',
          daysLate: 11,
          status: 'late',
        },
        {
          debtorName: 'Bruno Costa',
          amount: 600,
          dueDate: '2026-05-25',
          daysLate: 6,
          status: 'late',
        },
      ]);
    },
    steps: [
      {
        input: { text: 'quem ta atrasado' },
        expect: {
          textIncludes: ['📋', 'Ana Paula', 'Bruno Costa', '11d atrasado', '6d atrasado'],
          mockCalls: { getInstallments: 1 },
        },
      },
    ],
  },

  // ===== LIST_COLLECTION_TARGETS (cobrar_hoje) =====
  {
    id: 'view-collection-today-001-empty',
    description: 'Cobrança do dia vazia',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'cobrar_hoje',
        entities: { days_ahead: 1, window_start: 'today' },
        normalizedEntities: { days_ahead: 1, window_start: 'today' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getDebtorsToCollectToday.mockResolvedValue([]);
    },
    steps: [
      {
        input: { text: 'cobrar hoje' },
        expect: {
          textIncludes: ['✅', 'devedor', 'vencimento hoje'],
          mockCalls: { getDebtorsToCollectToday: 1 },
        },
      },
    ],
  },

  {
    id: 'view-collection-today-002-with-debtors',
    description: 'Cobrança do dia com múltiplos devedores',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'cobrar_hoje',
        entities: { days_ahead: 1, window_start: 'today' },
        normalizedEntities: { days_ahead: 1, window_start: 'today' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getDebtorsToCollectToday.mockResolvedValue([
        {
          name: 'Pedro Ferreira',
          totalDue: 1500,
          installmentCount: 2,
          daysLate: 0,
        },
        {
          name: 'Fernanda Alves',
          totalDue: 2000,
          installmentCount: 1,
          daysLate: 0,
        },
      ]);
    },
    steps: [
      {
        input: { text: 'quem cobro hoje' },
        expect: {
          textIncludes: ['Cobranças', 'Pedro Ferreira', 'Fernanda Alves', '1.500', '2.000', '2 parcelas'],
          mockCalls: { getDebtorsToCollectToday: 1 },
        },
      },
    ],
  },

  {
    id: 'view-collection-today-003-overdue-debtors',
    description: 'Cobrança do dia com devedores em atraso',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'cobrar_hoje',
        entities: { days_ahead: 1, window_start: 'today' },
        normalizedEntities: { days_ahead: 1, window_start: 'today' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.getDebtorsToCollectToday.mockResolvedValue([
        {
          name: 'Gustavo Mendes',
          totalDue: 3500,
          installmentCount: 3,
          daysLate: 15,
        },
      ]);
    },
    steps: [
      {
        input: { text: 'cobrar hoje' },
        expect: {
          textIncludes: ['Cobranças', 'Gustavo Mendes', '3.500', '15d atrasado'],
          mockCalls: { getDebtorsToCollectToday: 1 },
        },
      },
    ],
  },

  // ===== QUERY_COLLECTION_WINDOW =====
  {
    id: 'view-collection-week-001-empty',
    description: 'Cobrança da próxima semana (7 dias) vazia',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'cobrar_periodo',
        entities: { days_ahead: 7, window_start: 'today' },
        normalizedEntities: { days_ahead: 7, window_start: 'today' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.buildDateWindow.mockReturnValue({
        daysAhead: 7,
        windowStart: 'today',
        startDate: '2026-05-30',
        endDate: '2026-06-06',
        label: 'próximos 7 dias',
      });
      mocks.getDebtorsToCollectInWindow.mockResolvedValue([]);
    },
    steps: [
      {
        input: { text: 'quem devo cobrar na próxima semana' },
        expect: {
          textIncludes: ['✅', 'nenhum devedor', 'cobranca', 'próximos 7 dias'],
          mockCalls: { getDebtorsToCollectInWindow: 1 },
        },
      },
    ],
  },

  {
    id: 'view-collection-week-002-with-data',
    description: 'Cobrança da próxima semana com múltiplos devedores',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'cobrar_periodo',
        entities: { days_ahead: 7, window_start: 'today' },
        normalizedEntities: { days_ahead: 7, window_start: 'today' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.buildDateWindow.mockReturnValue({
        daysAhead: 7,
        windowStart: 'today',
        startDate: '2026-05-30',
        endDate: '2026-06-06',
        label: 'próximos 7 dias',
      });
      mocks.getDebtorsToCollectInWindow.mockResolvedValue([
        {
          name: 'Daniel Rocha',
          totalDue: 800,
          installmentCount: 1,
          daysLate: 0,
        },
        {
          name: 'Isabela Teixeira',
          totalDue: 1100,
          installmentCount: 2,
          daysLate: 0,
        },
        {
          name: 'Lucas Gomes',
          totalDue: 2200,
          installmentCount: 2,
          daysLate: 0,
        },
      ]);
    },
    steps: [
      {
        input: { text: 'quem eu cobro semana que vem' },
        expect: {
          textIncludes: ['Cobranças', 'Daniel Rocha', 'Isabela Teixeira', 'Lucas Gomes', '800', '1.100', '2.200', 'próximos 7 dias'],
          mockCalls: { getDebtorsToCollectInWindow: 1 },
        },
      },
    ],
  },

  {
    id: 'view-collection-month-001-2month-window',
    description: 'Cobrança dos próximos 2 meses com dados completos',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'cobrar_periodo',
        entities: { days_ahead: 60, window_start: 'today' },
        normalizedEntities: { days_ahead: 60, window_start: 'today' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.buildDateWindow.mockReturnValue({
        daysAhead: 60,
        windowStart: 'today',
        startDate: '2026-05-30',
        endDate: '2026-07-29',
        label: 'próximos 60 dias',
      });
      mocks.getDebtorsToCollectInWindow.mockResolvedValue([
        { name: 'Person A', totalDue: 500, installmentCount: 1, daysLate: 0 },
        { name: 'Person B', totalDue: 600, installmentCount: 1, daysLate: 0 },
        { name: 'Person C', totalDue: 700, installmentCount: 1, daysLate: 0 },
        { name: 'Person D', totalDue: 800, installmentCount: 1, daysLate: 0 },
        { name: 'Person E', totalDue: 900, installmentCount: 1, daysLate: 0 },
        { name: 'Person F', totalDue: 1000, installmentCount: 1, daysLate: 0 },
        { name: 'Person G', totalDue: 1100, installmentCount: 1, daysLate: 0 },
        { name: 'Person H', totalDue: 1200, installmentCount: 1, daysLate: 0 },
        { name: 'Person I', totalDue: 1300, installmentCount: 1, daysLate: 0 },
        { name: 'Person J', totalDue: 1400, installmentCount: 1, daysLate: 0 },
      ]);
    },
    steps: [
      {
        input: { text: 'quem tenho que cobrar nos próximos 2 meses' },
        expect: {
          textIncludes: ['Cobranças', 'Person A', 'mais 2', 'próximos 60 dias'],
          mockCalls: { getDebtorsToCollectInWindow: 1 },
        },
      },
    ],
  },

  // ===== QUERY_RECEIVABLES_WINDOW =====
  {
    id: 'view-receivables-week-001-empty',
    description: 'Recebíveis da próxima semana vazio',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'recebiveis_periodo',
        entities: { days_ahead: 7, window_start: 'today' },
        normalizedEntities: { days_ahead: 7, window_start: 'today' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.buildDateWindow.mockReturnValue({
        daysAhead: 7,
        windowStart: 'today',
        startDate: '2026-05-30',
        endDate: '2026-06-06',
        label: 'próximos 7 dias',
      });
      mocks.getInstallmentsInWindow.mockResolvedValue([]);
    },
    steps: [
      {
        input: { text: 'quanto recebo na próxima semana' },
        expect: {
          textIncludes: ['✅', 'nenhum recebivel', 'periodo', 'próximos 7 dias'],
          mockCalls: { getInstallmentsInWindow: 1 },
        },
      },
    ],
  },

  {
    id: 'view-receivables-week-002-with-data',
    description: 'Recebíveis da próxima semana com parcelas',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'recebiveis_periodo',
        entities: { days_ahead: 7, window_start: 'today' },
        normalizedEntities: { days_ahead: 7, window_start: 'today' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.buildDateWindow.mockReturnValue({
        daysAhead: 7,
        windowStart: 'today',
        startDate: '2026-05-30',
        endDate: '2026-06-06',
        label: 'próximos 7 dias',
      });
      mocks.getInstallmentsInWindow.mockResolvedValue([
        {
          debtorName: 'Rafael Lima',
          amount: 1500,
          dueDate: '2026-06-02',
          daysLate: 0,
          status: 'pending',
        },
        {
          debtorName: 'Soraia Mendes',
          amount: 2000,
          dueDate: '2026-06-05',
          daysLate: 0,
          status: 'pending',
        },
      ]);
    },
    steps: [
      {
        input: { text: 'quais recebíveis chegam próxima semana' },
        expect: {
          textIncludes: ['Recebíveis', 'Rafael Lima', 'Soraia Mendes', '1.500', '2.000', '3.500', 'Total previsto'],
          mockCalls: { getInstallmentsInWindow: 1 },
        },
      },
    ],
  },

  {
    id: 'view-receivables-month-001-large-dataset',
    description: 'Recebíveis do próximo mês com muitas parcelas (teste paginação)',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'recebiveis_periodo',
        entities: { days_ahead: 30, window_start: 'today' },
        normalizedEntities: { days_ahead: 30, window_start: 'today' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.buildDateWindow.mockReturnValue({
        daysAhead: 30,
        windowStart: 'today',
        startDate: '2026-05-30',
        endDate: '2026-06-29',
        label: 'próximos 30 dias',
      });
      const installments = Array.from({ length: 12 }, (_, i) => ({
        debtorName: `Devedor ${String.fromCharCode(65 + i)}`,
        amount: 500 + i * 100,
        dueDate: `2026-06-${String((2 + i).toString().padStart(2, '0'))}`,
        daysLate: 0,
        status: 'pending',
      }));
      mocks.getInstallmentsInWindow.mockResolvedValue(installments);
    },
    steps: [
      {
        input: { text: 'quanto recebo no próximo mês' },
        expect: {
          textIncludes: ['Recebíveis', 'Devedor A', 'Devedor H', 'mais 4', 'próximos 30 dias'],
          mockCalls: { getInstallmentsInWindow: 1 },
        },
      },
    ],
  },

  // ===== QUERY_DEBTOR_BALANCE =====
  {
    id: 'view-debtor-balance-001-single-match',
    description: 'Buscar dívida de um cliente com resultado único',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'buscar_usuario',
        entities: { debtor_name: 'Thiago Martins' },
        normalizedEntities: { debtor_name: 'Thiago Martins' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.searchUser.mockResolvedValue([
        {
          id: 'profile-100',
          name: 'Thiago Martins',
          cpf: '12345678900',
        },
      ]);
      mocks.getUserDebtDetails.mockResolvedValue({
        totalDebt: 3500,
        pendingInstallments: 3,
        nextDueDate: '2026-06-05',
        nextDueAmount: 1200,
        activeContracts: 2,
        contracts: [],
      });
    },
    steps: [
      {
        input: { text: 'quanto Thiago Martins deve' },
        expect: {
          textIncludes: ['Thiago Martins', '3.500', 'débito', '3 parcelas', '2 contratos', '1.200'],
          mockCalls: { searchUser: 1, getUserDebtDetails: 1 },
        },
      },
    ],
  },

  {
    id: 'view-debtor-balance-002-no-debt',
    description: 'Cliente sem dívida em aberto',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'buscar_usuario',
        entities: { debtor_name: 'Vanessa Silva' },
        normalizedEntities: { debtor_name: 'Vanessa Silva' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.searchUser.mockResolvedValue([
        {
          id: 'profile-101',
          name: 'Vanessa Silva',
          cpf: '98765432100',
        },
      ]);
      mocks.getUserDebtDetails.mockResolvedValue({
        totalDebt: 0,
        pendingInstallments: 0,
        nextDueDate: null,
        nextDueAmount: 0,
        activeContracts: 0,
        contracts: [],
      });
    },
    steps: [
      {
        input: { text: 'ver dívida Vanessa Silva' },
        expect: {
          textIncludes: ['Vanessa Silva', 'não possui', 'parcelas', 'aberto'],
          mockCalls: { searchUser: 1, getUserDebtDetails: 1 },
        },
      },
    ],
  },

  {
    id: 'view-debtor-balance-003-multiple-candidates',
    description: 'Múltiplos clientes com nome parecido — deve pedir desambiguação',
    category: 'functional',
    criticality: 'core',
    failureTag: 'missing_clarification',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'buscar_usuario',
        entities: { debtor_name: 'Silva' },
        normalizedEntities: { debtor_name: 'Silva' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.searchUser.mockResolvedValue([
        { id: 'profile-200', name: 'João Silva', cpf: '11111111100' },
        { id: 'profile-201', name: 'Maria Silva', cpf: '22222222200' },
        { id: 'profile-202', name: 'Carlos Silva', cpf: '33333333300' },
      ]);
    },
    steps: [
      {
        input: { text: 'quanto Silva deve' },
        expect: {
          textIncludes: ['Encontrei mais de um', 'Silva', 'João Silva', 'Maria Silva', 'Carlos Silva'],
          mockCalls: { searchUser: 1 },
        },
      },
    ],
  },

  // ===== GENERATE_REPORT =====
  {
    id: 'view-report-001-empty',
    description: 'Relatório mensal com dados vazios',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'gerar_relatorio',
        entities: {},
        normalizedEntities: {},
        confidence: 'high',
        source: 'rule',
      });
      mocks.generateMonthlyReport.mockResolvedValue({
        dashboard: {
          receivedMonth: 0,
          receivedByPaymentMonth: 0,
          receivedByDueMonth: 0,
          expectedMonth: 0,
          totalOverdue: 0,
          activeContracts: 0,
          overdueContracts: 0,
        },
        overdueDebtors: [],
        todayInstallments: [],
        topDebtors: [],
      });
    },
    steps: [
      {
        input: { text: 'me da um relatório' },
        expect: {
          textIncludes: ['Relatório', 'Resumo', 'R$ 0'],
          mockCalls: { generateMonthlyReport: 1 },
        },
      },
    ],
  },

  {
    id: 'view-report-002-with-data',
    description: 'Relatório mensal com dados completos',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'gerar_relatorio',
        entities: {},
        normalizedEntities: {},
        confidence: 'high',
        source: 'rule',
      });
      mocks.generateMonthlyReport.mockResolvedValue({
        dashboard: {
          receivedMonth: 8500,
          receivedByPaymentMonth: 8500,
          receivedByDueMonth: 7500,
          expectedMonth: 10000,
          totalOverdue: 2300,
          activeContracts: 12,
          overdueContracts: 3,
        },
        overdueDebtors: [
          {
            name: 'Wilson Santos',
            totalDue: 1500,
            daysLate: 20,
          },
          {
            name: 'Patricia Gomes',
            totalDue: 800,
            daysLate: 10,
          },
        ],
        todayInstallments: [
          {
            debtorName: 'Quiteria Barbosa',
            amount: 450,
            dueDate: '2026-05-30',
          },
        ],
        topDebtors: [
          { name: 'Rodrigo Ferreira', totalDue: 5000 },
          { name: 'Adriana Costa', totalDue: 4500 },
        ],
      });
    },
    steps: [
      {
        input: { text: 'gerar relatorio' },
        expect: {
          textIncludes: [
            'Relatório',
            'Resumo',
            'Wilson Santos',
            'Patricia Gomes',
            'Quiteria Barbosa',
            'Rodrigo Ferreira',
            'Adriana Costa',
            '8.500',
            '2.300',
          ],
          mockCalls: { generateMonthlyReport: 1 },
        },
      },
    ],
  },

  // ===== EDGE CASES & REGRESSIONS =====
  {
    id: 'view-idempotent-001-repeated-dashboard',
    description: 'Dashboard repetido em mesmo contexto (sem side-effects)',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'ver_dashboard',
        entities: {},
        normalizedEntities: {},
        confidence: 'high',
        source: 'rule',
      });
      mocks.getDashboardSummary.mockResolvedValue({
        receivedMonth: 3000,
        receivedByPaymentMonth: 3000,
        receivedByDueMonth: 2800,
        expectedMonth: 4000,
        totalOverdue: 500,
        activeContracts: 5,
        overdueContracts: 1,
      });
    },
    steps: [
      {
        input: { text: 'resumo' },
        expect: {
          mockCalls: { getDashboardSummary: 1 },
        },
      },
      {
        input: { text: 'dashboard' },
        expect: {
          mockCalls: { getDashboardSummary: 2 },
        },
      },
    ],
  },

  {
    id: 'view-receivables-filter-change-001',
    description: 'Listar recebíveis com filtro pendente vs atraso',
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      let callCount = 0;
      mocks.routeIntent.mockImplementation(async (text: string) => {
        const isLate = /atrasad/i.test(text);
        return {
          intent: 'listar_recebiveis',
          entities: { filter: isLate ? 'late' : 'pending' },
          normalizedEntities: { filter: isLate ? 'late' : 'pending' },
          confidence: 'high',
          source: 'rule',
        };
      });
      mocks.getInstallments.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return [
            { debtorName: 'Person X', amount: 100, dueDate: '2026-06-10', daysLate: 0, status: 'pending' },
          ];
        }
        return [
          { debtorName: 'Person Y', amount: 200, dueDate: '2026-05-20', daysLate: 10, status: 'late' },
        ];
      });
    },
    steps: [
      {
        input: { text: 'recebiveis pendentes' },
        expect: {
          textIncludes: ['📋', 'Person X', '100,00'],
          mockCalls: { getInstallments: 1 },
        },
      },
      {
        input: { text: 'recebiveis atrasados' },
        expect: {
          textIncludes: ['📋', 'Person Y', '200,00'],
          mockCalls: { getInstallments: 2 },
        },
      },
    ],
  },

  {
    id: 'view-collection-boundary-001-tomorrow',
    description: 'Cobrança amanhã (janela 1 dia + 1)',
    category: 'functional',
    criticality: 'extended',
    failureTag: 'response_regression',
    role: 'admin',
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent: 'cobrar_periodo',
        entities: { days_ahead: 1, window_start: 'tomorrow' },
        normalizedEntities: { days_ahead: 1, window_start: 'tomorrow' },
        confidence: 'high',
        source: 'rule',
      });
      mocks.buildDateWindow.mockReturnValue({
        daysAhead: 1,
        windowStart: 'tomorrow',
        startDate: '2026-05-31',
        endDate: '2026-05-31',
        label: 'amanhã',
      });
      mocks.getDebtorsToCollectInWindow.mockResolvedValue([
        {
          name: 'Wanda Oliveira',
          totalDue: 2500,
          installmentCount: 1,
          daysLate: 0,
        },
      ]);
    },
    steps: [
      {
        input: { text: 'cobrar amanhã' },
        expect: {
          textIncludes: ['Cobranças', 'Wanda Oliveira', '2.500', 'amanhã'],
          mockCalls: { getDebtorsToCollectInWindow: 1 },
        },
      },
    ],
  },
];
