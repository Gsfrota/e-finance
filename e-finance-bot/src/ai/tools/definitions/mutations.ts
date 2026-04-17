import { z } from 'zod';
import type { ToolDefinition, ToolOutcome } from '../types';
import { generateInviteHandler } from '../handlers';

const notWired = (name: string): ToolOutcome => ({
  kind: 'error',
  message: `Tool ${name} ainda não foi conectada ao handler — AI-S6 pendente.`,
  retryable: false,
});

export const createContractTool: ToolDefinition = {
  name: 'create_contract',
  kind: 'mutation',
  description: 'Cria um novo contrato de empréstimo para um devedor. Requer CPF do devedor, valor e condições. Retorna sempre um PREVIEW primeiro — o contrato só é criado após confirmação explícita do usuário ("sim"). Use para "criar contrato", "emprestar X para Y", "novo empréstimo".',
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
  handler: async () => notWired('create_contract'),
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
      installment_id: { type: 'string', description: 'UUID da parcela, se conhecido.' },
      installment_number: { type: 'integer', description: 'Nº da parcela (1-N) dentro do contrato.' },
      amount: { type: 'number', description: 'Valor pago em reais. Se omitido, assume-se o valor total da parcela.' },
      paid_at: { type: 'string', description: 'Data do pagamento (YYYY-MM-DD). Default: hoje.' },
    },
  },
  inputSchema: z.object({
    debtor_name: z.string().min(1).optional(),
    installment_id: z.string().min(1).optional(),
    installment_number: z.number().int().positive().optional(),
    amount: z.number().positive().optional(),
    paid_at: z.string().min(1).optional(),
  }).passthrough(),
  handler: async () => notWired('mark_installment_paid'),
};

export const disconnectBotTool: ToolDefinition = {
  name: 'disconnect_bot',
  kind: 'mutation',
  description: 'Desconecta o usuário do bot (encerra vínculo entre chat e profile). Requer confirmação. Use para "me desconecta", "parar de usar o bot", "sair".',
  rolesAllowed: ['admin', 'investor', 'debtor'],
  requiresConfirmation: true,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: async () => notWired('disconnect_bot'),
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
  handler: async () => notWired('configure_briefing'),
};

export const mutationTools: ToolDefinition[] = [
  createContractTool,
  markInstallmentPaidTool,
  disconnectBotTool,
  generateInviteTool,
  configureBriefingTool,
];
