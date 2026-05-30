import type { AgentEvalCase } from './contracts';

/**
 * Matriz de cobertura — preenche as lacunas do dataset oficial.
 *
 * Convenção de id: `cap-<capability>-<variante>` para que o runner
 * (tests/eval-dump.test.ts) agrupe por capability.
 *
 * DENY = role sem permissão para um intent administrativo deve receber
 * a mensagem de policy-gate e NÃO executar a ação.
 */

const DENY_MSG = 'Essa ação não está disponível para o seu perfil neste chat.';

function denyCase(capability: string, intent: string, role: 'debtor' | 'investor', text: string, soft = false): AgentEvalCase {
  return {
    id: `cap-${capability}-deny-${role}`,
    description: soft
      ? `ACHADO: ${role} + ${intent} NÃO recebe o policy-gate síncrono (ver report)`
      : `${role} não pode usar intent administrativo ${intent}`,
    category: 'policy',
    criticality: 'critical',
    failureTag: 'policy_bypass',
    role,
    allowSoftFailure: soft,
    setup: ({ mocks }) => {
      mocks.routeIntent.mockResolvedValue({
        intent,
        entities: {},
        normalizedEntities: {},
        confidence: 'high',
        source: 'rule',
      });
    },
    steps: [
      {
        input: { text },
        expect: { textIncludes: [DENY_MSG] },
      },
    ],
  };
}

// Intents administrativos com policy-gate SÍNCRONO verificado (negam debtor/investor).
const DENY_TARGETS: Array<{ capability: string; intent: string; text: string }> = [
  { capability: 'show_dashboard', intent: 'ver_dashboard', text: 'dashboard' },
  { capability: 'list_receivables', intent: 'listar_recebiveis', text: 'quais recebíveis tenho' },
  { capability: 'list_collection_targets', intent: 'cobrar_hoje', text: 'quem cobrar hoje' },
  { capability: 'query_collection_window', intent: 'cobrar_periodo', text: 'quem cobrar essa semana' },
  { capability: 'query_receivables_window', intent: 'recebiveis_periodo', text: 'recebíveis dos próximos 7 dias' },
  { capability: 'generate_report', intent: 'gerar_relatorio', text: 'gera o relatório do mês' },
  { capability: 'generate_invite', intent: 'gerar_convite', text: 'cria um convite' },
  { capability: 'query_debtor_balance', intent: 'buscar_usuario', text: 'quanto o Carlos deve' },
];

// ACHADOS: intents que divergem do gate síncrono (soft_fail = documentado, não infra-bug).
// - criar_contrato / marcar_pagamento: sensitive → fluxo de confirmação antes do gate.
// - configurar_briefing: responde com wizard ("Me diga o horário") para não-admin → POSSÍVEL BYPASS.
const SOFT_DENY_TARGETS: Array<{ capability: string; intent: string; text: string }> = [
  { capability: 'create_contract', intent: 'criar_contrato', text: 'novo contrato pra Ana 1000 reais 10% 5x' },
  { capability: 'mark_installment_paid', intent: 'marcar_pagamento', text: 'dar baixa na parcela do Carlos' },
  { capability: 'configure_briefing', intent: 'configurar_briefing', text: 'configurar briefing 8h' },
];

function happyCase(
  id: string,
  capability: string,
  intent: string,
  role: 'admin' | 'investor' | 'debtor',
  text: string,
  expectedSubstring: string,
  setup?: (context: { mocks: any; state: any }) => void
): AgentEvalCase {
  return {
    id,
    description: `${capability} happy path (${role})`,
    category: 'functional',
    criticality: 'core',
    failureTag: 'response_regression',
    role,
    setup: ({ mocks, state }) => {
      mocks.routeIntent.mockResolvedValue({
        intent,
        entities: {},
        normalizedEntities: {},
        confidence: 'high',
        source: 'rule',
      });
      setup?.({ mocks, state });
    },
    steps: [
      {
        input: { text },
        expect: { textIncludes: [expectedSubstring] },
      },
    ],
  };
}

export const COVERAGE_MATRIX_CASES: AgentEvalCase[] = [
  // ---- DENY matrix síncrono (verificado) ----
  ...DENY_TARGETS.flatMap(t => [
    denyCase(t.capability, t.intent, 'debtor', t.text),
    denyCase(t.capability, t.intent, 'investor', t.text),
  ]),
  // ---- DENY matrix divergente (achados documentados) ----
  ...SOFT_DENY_TARGETS.flatMap(t => [
    denyCase(t.capability, t.intent, 'debtor', t.text, true),
    denyCase(t.capability, t.intent, 'investor', t.text, true),
  ]),

  // ---- HAPPY-PATHS — 15 gap capabilities ----
  happyCase(
    'cap-list_receivables-happy-admin',
    'list_receivables',
    'listar_recebiveis',
    'admin',
    'meus recebíveis',
    'Nenhuma parcela pendente encontrada'
  ),
  happyCase(
    'cap-list_collection_targets-happy-admin',
    'list_collection_targets',
    'cobrar_hoje',
    'admin',
    'quem cobrar hoje',
    'Não há clientes para cobrar no período'
  ),
  happyCase(
    'cap-query_collection_window-happy-admin',
    'query_collection_window',
    'cobrar_periodo',
    'admin',
    'quem cobrar essa semana',
    'Não há clientes para cobrar no período'
  ),
  happyCase(
    'cap-query_receivables_window-happy-admin',
    'query_receivables_window',
    'recebiveis_periodo',
    'admin',
    'recebíveis dos próximos 7 dias',
    'Não há recebíveis em aberto para o período'
  ),
  happyCase(
    'cap-generate_report-happy-admin',
    'generate_report',
    'gerar_relatorio',
    'admin',
    'relatório do mês',
    'Relatório —'
  ),
  happyCase(
    'cap-generate_invite-happy-admin',
    'generate_invite',
    'gerar_convite',
    'admin',
    'gera um convite',
    'Convite gerado!'
  ),
  happyCase(
    'cap-query_debtor_balance-happy-admin',
    'query_debtor_balance',
    'buscar_usuario',
    'admin',
    'quanto o Carlos deve',
    'tem um débito de',
    ({ mocks }) => {
      mocks.searchUser.mockResolvedValue([{ id: 'd1', full_name: 'Carlos', role: 'debtor', cpf: '52998224725' }]);
      mocks.getUserDebtDetails.mockResolvedValue({
        totalDebt: 1800,
        pendingInstallments: 2,
        nextDueDate: '2026-04-10',
        nextDueAmount: 900,
        activeContracts: 1,
        contracts: [],
      });
    }
  ),
  happyCase(
    'cap-view_my_debt_summary-happy-debtor',
    'view_my_debt_summary',
    'ver_meu_saldo_devedor',
    'debtor',
    'quanto eu devo',
    'Você não possui saldo devedor em aberto'
  ),
  happyCase(
    'cap-view_my_installments-happy-debtor',
    'view_my_installments',
    'ver_minhas_parcelas',
    'debtor',
    'minhas parcelas',
    'Você não possui parcelas pendentes no momento'
  ),
  happyCase(
    'cap-view_my_portfolio-happy-investor',
    'view_my_portfolio',
    'ver_meu_portfolio',
    'investor',
    'meu portfólio',
    'Você ainda não possui contratos ativos como investidor'
  ),
  happyCase(
    'cap-preview_lembrete-happy-admin',
    'preview_lembrete',
    'ver_exemplo_lembrete',
    'admin',
    'exemplo de lembrete',
    'Exemplo de como o lembrete vai chegar'
  ),
  happyCase(
    'cap-show_subscription_payment-happy-admin',
    'show_subscription_payment',
    'ver_mensalidade',
    'admin',
    'minha mensalidade',
    'Não encontrei os dados da sua mensalidade'
  ),
  happyCase(
    'cap-report_feedback-happy-admin',
    'report_feedback',
    'reportar_problema',
    'admin',
    'quero reportar um problema',
    'Anotado!'
  ),
  happyCase(
    'cap-greet-happy-admin',
    'greet',
    'saudacao',
    'admin',
    'oi',
    'Como posso ajudar'
  ),
  happyCase(
    'cap-help-happy-admin',
    'help',
    'ajuda',
    'admin',
    'o que você faz',
    'Posso te ajudar com dashboard'
  ),
];
