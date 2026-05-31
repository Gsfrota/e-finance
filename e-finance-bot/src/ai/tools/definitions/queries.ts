import { z } from 'zod';
import type { ToolDefinition } from '../types';
import {
  showDashboardHandler,
  listReceivablesHandler,
  listCollectionTargetsHandler,
  queryDebtorBalanceHandler,
  queryReceivablesWindowHandler,
  queryCollectionWindowHandler,
  generateReportHandler,
  viewMyInstallmentsHandler,
  viewMyDebtSummaryHandler,
  viewMyPortfolioHandler,
  previewLembreteHandler,
} from '../handlers';

export const showDashboardTool: ToolDefinition = {
  name: 'show_dashboard',
  kind: 'query',
  description: 'Mostra o dashboard geral do admin: total a receber, cobranças do dia, totais do mês, métricas-chave. Use quando o usuário admin pedir "dashboard", "resumo geral", "como estou", "visão geral".',
  rolesAllowed: ['admin'],
  requiresConfirmation: false,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: showDashboardHandler,
};

export const listReceivablesTool: ToolDefinition = {
  name: 'list_receivables',
  kind: 'query',
  description: 'Lista parcelas a receber (todos os devedores agregados) ou parcelas em aberto de um contrato específico por contract_id. Use quando o admin pedir "recebíveis", "parcelas a receber", "parcelas em aberto do contrato 123", "como ficou o contrato #123", "status do contrato 123", "atrasados", "quem está atrasado", "da semana". NÃO use para pergunta sobre UM devedor específico (use query_debtor_balance).',
  rolesAllowed: ['admin'],
  requiresConfirmation: false,
  parameters: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        enum: ['pending', 'late', 'week', 'all'],
        description: 'Filtro opcional: pending (pendentes), late (atrasados), week (próx 7 dias), all (todos).',
      },
      contract_id: {
        type: 'integer',
        description: 'ID numérico do contrato para listar as parcelas abertas desse contrato específico sem iniciar baixa.',
      },
    },
  },
  inputSchema: z.object({
    filter: z.enum(['pending', 'late', 'week', 'all']).optional(),
    contract_id: z.number().int().positive().optional(),
  }).passthrough(),
  handler: listReceivablesHandler as unknown as ToolDefinition['handler'],
};

export const listCollectionTargetsTool: ToolDefinition = {
  name: 'list_collection_targets',
  kind: 'query',
  description: 'Lista quem cobrar em uma janela temporal (TODOS os devedores que vencem). Use para "cobrar hoje", "quem ta me devendo", "quem me deve", "quem está devendo", "quem tem que pagar amanhã", "cobranças da semana". Use SEMPRE quando o admin pergunta pela LISTA de devedores sem citar nome — JAMAIS use query_debtor_balance nesse caso. Default window=today se ambíguo.',
  rolesAllowed: ['admin'],
  requiresConfirmation: false,
  parameters: {
    type: 'object',
    properties: {
      window: {
        type: 'string',
        enum: ['today', 'tomorrow', 'this_week', 'this_month', 'next_n_days'],
        description: 'Janela temporal relativa.',
      },
      n_days: { type: 'integer', description: 'Número de dias quando window=next_n_days.' },
    },
    required: ['window'],
  },
  inputSchema: z.object({
    window: z.enum(['today', 'tomorrow', 'this_week', 'this_month', 'next_n_days']),
    n_days: z.number().int().positive().optional(),
  }).passthrough(),
  handler: listCollectionTargetsHandler as unknown as ToolDefinition['handler'],
};

export const queryDebtorBalanceTool: ToolDefinition = {
  name: 'query_debtor_balance',
  kind: 'query',
  description: 'Consulta o saldo devedor de UM devedor ESPECÍFICO IDENTIFICADO POR NOME OU CPF. Use APENAS quando o admin nomeia explicitamente quem ele quer consultar: "quanto João me deve?", "saldo do Felipe", "balanço da Maria Silva". NUNCA use para perguntas genéricas como "quem me deve", "quem está devendo", "quem ta me devendo" — essas vão para list_collection_targets. Se não há nome explícito de pessoa, NÃO chame esta tool.',
  rolesAllowed: ['admin'],
  requiresConfirmation: false,
  parameters: {
    type: 'object',
    properties: {
      debtor_name: { type: 'string', description: 'Nome (parcial ou completo) do devedor.' },
      debtor_profile_id: { type: 'string', description: 'UUID do profile do devedor quando disponível.' },
    },
  },
  inputSchema: z.object({
    debtor_name: z.string().min(1).optional(),
    debtor_profile_id: z.string().min(1).optional(),
  }).refine(v => !!v.debtor_name || !!v.debtor_profile_id, { message: 'debtor_name_or_profile_id_required' }),
  handler: queryDebtorBalanceHandler as unknown as ToolDefinition['handler'],
};

export const queryReceivablesWindowTool: ToolDefinition = {
  name: 'query_receivables_window',
  kind: 'query',
  description: 'Recebíveis agregados dentro de uma janela temporal (valor total a receber, nº de parcelas). Use para "quanto vou receber na semana?", "total do mês", "faturamento previsto".',
  rolesAllowed: ['admin'],
  requiresConfirmation: false,
  parameters: {
    type: 'object',
    properties: {
      window: {
        type: 'string',
        enum: ['today', 'tomorrow', 'this_week', 'this_month', 'next_n_days'],
      },
      n_days: { type: 'integer' },
    },
    required: ['window'],
  },
  inputSchema: z.object({
    window: z.enum(['today', 'tomorrow', 'this_week', 'this_month', 'next_n_days']),
    n_days: z.number().int().positive().optional(),
  }).passthrough(),
  handler: queryReceivablesWindowHandler as unknown as ToolDefinition['handler'],
};

export const queryCollectionWindowTool: ToolDefinition = {
  name: 'query_collection_window',
  kind: 'query',
  description: 'Total a cobrar em uma janela temporal (agregado). Use para "quanto tenho que cobrar hoje?", "total de cobranças da semana".',
  rolesAllowed: ['admin'],
  requiresConfirmation: false,
  parameters: {
    type: 'object',
    properties: {
      window: {
        type: 'string',
        enum: ['today', 'tomorrow', 'this_week', 'this_month', 'next_n_days'],
      },
      n_days: { type: 'integer' },
    },
    required: ['window'],
  },
  inputSchema: z.object({
    window: z.enum(['today', 'tomorrow', 'this_week', 'this_month', 'next_n_days']),
    n_days: z.number().int().positive().optional(),
  }).passthrough(),
  handler: queryCollectionWindowHandler as unknown as ToolDefinition['handler'],
};

export const generateReportTool: ToolDefinition = {
  name: 'generate_report',
  kind: 'query',
  description: 'Gera relatório completo do tenant (admin): performance geral, inadimplência, rentabilidade. Use para "relatório", "gerar relatório", "relatório do mês".',
  rolesAllowed: ['admin'],
  requiresConfirmation: false,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: generateReportHandler,
};

export const viewMyInstallmentsTool: ToolDefinition = {
  name: 'view_my_installments',
  kind: 'query',
  description: 'Mostra ao devedor as parcelas dele (calendário de pagamentos, status de cada). Use para "minhas parcelas", "o que eu devo pagar", "quais as próximas".',
  rolesAllowed: ['debtor'],
  requiresConfirmation: false,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: viewMyInstallmentsHandler,
};

export const viewMyDebtSummaryTool: ToolDefinition = {
  name: 'view_my_debt_summary',
  kind: 'query',
  description: 'Mostra ao devedor o saldo devedor total e resumo. Use para "quanto devo?", "meu saldo", "total da dívida".',
  rolesAllowed: ['debtor'],
  requiresConfirmation: false,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: viewMyDebtSummaryHandler,
};

export const viewMyPortfolioTool: ToolDefinition = {
  name: 'view_my_portfolio',
  kind: 'query',
  description: 'Mostra ao investidor o portfólio dele (investimentos ativos, retorno, etc). Use para "meus investimentos", "portfólio", "como está meu capital".',
  rolesAllowed: ['investor'],
  requiresConfirmation: false,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: viewMyPortfolioHandler,
};

export const previewLembreteTool: ToolDefinition = {
  name: 'preview_lembrete',
  kind: 'query',
  description: 'Mostra ao admin um exemplo de como o lembrete de pagamento ficaria (sem enviar). Use para "como fica o lembrete?", "exemplo de lembrete", "preview".',
  rolesAllowed: ['admin'],
  requiresConfirmation: false,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: previewLembreteHandler,
};

export const queryTools: ToolDefinition[] = [
  showDashboardTool,
  listReceivablesTool,
  listCollectionTargetsTool,
  queryDebtorBalanceTool,
  queryReceivablesWindowTool,
  queryCollectionWindowTool,
  generateReportTool,
  viewMyInstallmentsTool,
  viewMyDebtSummaryTool,
  viewMyPortfolioTool,
  previewLembreteTool,
];
