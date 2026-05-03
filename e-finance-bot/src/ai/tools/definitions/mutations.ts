import { z } from 'zod';
import type { ToolDefinition } from '../types';
import {
  generateInviteHandler,
  createContractHandler,
  markInstallmentPaidHandler,
  disconnectBotHandler,
  configureBriefingHandler,
  setEodAlertHourHandler,
} from '../handlers';

export const createContractTool: ToolDefinition = {
  name: 'create_contract',
  kind: 'mutation',
  description: 'Cria um novo contrato de empréstimo. CAMPOS OBRIGATÓRIOS: debtor_cpf (11 dígitos), amount (principal em reais), installments (nº de parcelas) E (rate OU total_repayment). NUNCA chame esta tool sem rate ou total_repayment — peça ao usuário antes. Se o usuário falou "10 parcelas de 200 com principal de 1500", calcule total_repayment = 10*200 = 2000. Retorna PREVIEW; o contrato só é criado após "sim" explícito. Use para "criar contrato", "emprestar X para Y", "novo empréstimo".',
  rolesAllowed: ['admin'],
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      debtor_name: { type: 'string', description: 'Nome do devedor.' },
      debtor_cpf: { type: 'string', description: 'CPF do devedor (11 dígitos). OBRIGATÓRIO para criar contrato.' },
      amount: { type: 'number', description: 'Valor principal do empréstimo em reais.' },
      rate: { type: 'number', description: 'Taxa de juros em % ao mês (ex: 5 para 5%).' },
      installments: { type: 'integer', description: 'Quantidade de parcelas.' },
      frequency: { type: 'string', enum: ['monthly', 'weekly', 'biweekly'], description: 'Frequência das parcelas.' },
      due_day: { type: 'integer', description: 'Dia do mês do vencimento (1-31) para parcelas mensais.' },
      start_date: { type: 'string', description: 'Data ISO do primeiro vencimento (YYYY-MM-DD), opcional.' },
      total_repayment: { type: 'number', description: 'Valor total a ser pago (alternativa a rate+installments).' },
    },
    required: ['debtor_cpf', 'amount'],
  },
  inputSchema: z.object({
    debtor_name: z.string().min(1).optional(),
    debtor_cpf: z.string().min(11),
    amount: z.number().positive(),
    rate: z.number().min(0).max(1000).optional(),
    installments: z.number().int().positive().optional(),
    frequency: z.enum(['monthly', 'weekly', 'biweekly']).optional(),
    due_day: z.number().int().min(1).max(31).optional(),
    start_date: z.string().min(1).optional(),
    total_repayment: z.number().positive().optional(),
  }).passthrough(),
  handler: createContractHandler as unknown as ToolDefinition['handler'],
};

export const markInstallmentPaidTool: ToolDefinition = {
  name: 'mark_installment_paid',
  kind: 'mutation',
  description: 'Marca uma parcela como paga (total ou parcial). Retorna sempre um PREVIEW primeiro. Use para "marcar como pago", "recebi o pagamento do João", "paguei a parcela 3".',
  rolesAllowed: ['admin'],
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      debtor_name: { type: 'string', description: 'Nome do devedor que pagou.' },
      contract_id: { type: 'integer', description: 'ID numérico do contrato, se conhecido.' },
      installment_id: { type: 'string', description: 'UUID da parcela, se conhecido.' },
      installment_number: { type: 'integer', description: 'Nº da parcela (1-N) dentro do contrato.' },
      installment_month: { type: 'integer', description: 'Mês da parcela (1-12) quando o usuário menciona o mês.' },
      installment_year: { type: 'integer', description: 'Ano da parcela (4 dígitos), opcional.' },
      amount: { type: 'number', description: 'Valor pago em reais. Se omitido, assume-se o valor total da parcela.' },
      paid_at: { type: 'string', description: 'Data do pagamento (YYYY-MM-DD). Default: hoje.' },
    },
  },
  inputSchema: z.object({
    debtor_name: z.string().min(1).optional(),
    contract_id: z.number().int().positive().optional(),
    installment_id: z.string().min(1).optional(),
    installment_number: z.number().int().positive().optional(),
    installment_month: z.number().int().min(1).max(12).optional(),
    installment_year: z.number().int().min(2000).max(2100).optional(),
    amount: z.number().positive().optional(),
    paid_at: z.string().min(1).optional(),
  }).passthrough(),
  handler: markInstallmentPaidHandler as unknown as ToolDefinition['handler'],
};

export const disconnectBotTool: ToolDefinition = {
  name: 'disconnect_bot',
  kind: 'mutation',
  description: 'Desconecta o usuário do bot (encerra vínculo entre chat e profile). Requer confirmação. Use para "me desconecta", "parar de usar o bot", "sair".',
  rolesAllowed: ['admin', 'investor', 'debtor'],
  requiresConfirmation: true,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: disconnectBotHandler,
};

export const generateInviteTool: ToolDefinition = {
  name: 'generate_invite',
  kind: 'mutation',
  description: 'Gera um código de convite para adicionar um novo usuário ao tenant (admin only). Use para "gerar convite", "convidar usuário", "novo convite".',
  rolesAllowed: ['admin'],
  requiresConfirmation: false,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: generateInviteHandler,
};

export const configureBriefingTool: ToolDefinition = {
  name: 'configure_briefing',
  kind: 'mutation',
  description: 'Configura o briefing matinal do admin: horário de envio e se está ativado. Use para "muda o horário do briefing", "desativa o briefing", "briefing para 8 horas".',
  rolesAllowed: ['admin'],
  requiresConfirmation: false,
  parameters: {
    type: 'object',
    properties: {
      briefing_time: { type: 'string', description: 'Horário no formato HH:MM em BRT (ex: "07:00").' },
      briefing_enabled: { type: 'boolean', description: 'Se true, ativa briefing; se false, desativa.' },
    },
  },
  inputSchema: z.object({
    briefing_time: z.string().min(1).optional(),
    briefing_enabled: z.boolean().optional(),
  }).passthrough(),
  handler: configureBriefingHandler as unknown as ToolDefinition['handler'],
};

export const setEodAlertHourTool: ToolDefinition = {
  name: 'set_eod_alert_hour',
  kind: 'mutation',
  description: 'Configura o horário do aviso de fim de dia (lembrete de cobranças do dia que ainda não tiveram baixa). Use para "me avise às 16h", "alerta de fim de dia às 18:30", "muda meu aviso pra 17:00", "desativa o aviso de fim de dia". Padrão é 17:00 BRT.',
  rolesAllowed: ['admin'],
  requiresConfirmation: false,
  parameters: {
    type: 'object',
    properties: {
      time: { type: 'string', description: 'Horário no formato HH:MM em BRT (ex: "16:00", "17:30").' },
      enabled: { type: 'boolean', description: 'Se true, ativa o alerta; se false, desativa.' },
    },
  },
  inputSchema: z.object({
    time: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  }).passthrough(),
  handler: setEodAlertHourHandler as unknown as ToolDefinition['handler'],
};

export const mutationTools: ToolDefinition[] = [
  createContractTool,
  markInstallmentPaidTool,
  disconnectBotTool,
  generateInviteTool,
  configureBriefingTool,
  setEodAlertHourTool,
];
