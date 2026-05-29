import { z } from 'zod';
import { ResolvedTimeWindowSchema, type CapabilityDefinition, type ActionCapability } from './contracts';
import { createContractCapability } from './executors/create-contract';
import { markInstallmentPaidCapability } from './executors/mark-installment-paid';

const emptySchema = z.object({}).passthrough();
const listReceivablesSchema = z.object({
  filter: z.enum(['pending', 'late', 'week', 'all']).optional(),
}).passthrough();
const timeWindowArgsSchema = z.object({
  time_window: ResolvedTimeWindowSchema,
}).passthrough();
const debtorBalanceSchema = z.object({
  debtor_name: z.string().min(1).optional(),
  debtor_profile_id: z.string().min(1).optional(),
}).refine(input => !!input.debtor_name || !!input.debtor_profile_id, {
  message: 'debtor_name_or_profile_id_required',
});
const configureBriefingSchema = z.object({
  briefing_time: z.string().min(1).optional(),
  briefing_enabled: z.boolean().optional(),
}).passthrough();
const setEodAlertHourSchema = z.object({
  time: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
}).passthrough();

const REGISTRY: Record<ActionCapability, CapabilityDefinition<any, any>> = {
  show_dashboard: {
    name: 'show_dashboard', kind: 'query', rolesAllowed: ['admin'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'session', legacyIntent: 'ver_dashboard', inputSchema: emptySchema, replyMode: 'raw',
  },
  list_receivables: {
    name: 'list_receivables', kind: 'query', rolesAllowed: ['admin'], requiredArgs: [], optionalArgs: ['filter'], requiresConfirmation: false,
    idempotencyScope: 'session', legacyIntent: 'listar_recebiveis', inputSchema: listReceivablesSchema, replyMode: 'raw',
  },
  list_collection_targets: {
    name: 'list_collection_targets', kind: 'query', rolesAllowed: ['admin'], requiredArgs: ['time_window'], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'session', legacyIntent: 'cobrar_hoje', inputSchema: timeWindowArgsSchema, replyMode: 'raw',
  },
  query_debtor_balance: {
    name: 'query_debtor_balance', kind: 'query', rolesAllowed: ['admin'], requiredArgs: [], optionalArgs: ['debtor_name', 'debtor_profile_id'], requiresConfirmation: false,
    idempotencyScope: 'session', legacyIntent: 'buscar_usuario', inputSchema: debtorBalanceSchema, replyMode: 'raw',
  },
  query_receivables_window: {
    name: 'query_receivables_window', kind: 'query', rolesAllowed: ['admin'], requiredArgs: ['time_window'], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'session', legacyIntent: 'recebiveis_periodo', inputSchema: timeWindowArgsSchema, replyMode: 'raw',
  },
  query_collection_window: {
    name: 'query_collection_window', kind: 'query', rolesAllowed: ['admin'], requiredArgs: ['time_window'], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'session', legacyIntent: 'cobrar_periodo', inputSchema: timeWindowArgsSchema, replyMode: 'raw',
  },
  create_contract: createContractCapability,
  mark_installment_paid: markInstallmentPaidCapability,
  disconnect_bot: {
    name: 'disconnect_bot', kind: 'mutation', rolesAllowed: ['admin', 'investor', 'debtor'], requiredArgs: [], optionalArgs: [], requiresConfirmation: true,
    idempotencyScope: 'mutation', legacyIntent: 'desconectar', inputSchema: emptySchema, replyMode: 'raw',
  },
  greet: {
    name: 'greet', kind: 'utility', rolesAllowed: ['admin', 'investor', 'debtor'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'none', legacyIntent: 'saudacao', inputSchema: emptySchema, replyMode: 'rewrite',
  },
  help: {
    name: 'help', kind: 'utility', rolesAllowed: ['admin', 'investor', 'debtor'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'none', legacyIntent: 'ajuda', inputSchema: emptySchema, replyMode: 'raw',
  },
  smalltalk_identity: {
    name: 'smalltalk_identity', kind: 'utility', rolesAllowed: ['admin', 'investor', 'debtor'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'none', inputSchema: emptySchema, replyMode: 'raw',
  },
  smalltalk_datetime: {
    name: 'smalltalk_datetime', kind: 'utility', rolesAllowed: ['admin', 'investor', 'debtor'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'none', inputSchema: emptySchema, replyMode: 'raw',
  },
  generate_report: {
    name: 'generate_report', kind: 'query', rolesAllowed: ['admin'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'session', legacyIntent: 'gerar_relatorio', inputSchema: emptySchema, replyMode: 'raw',
  },
  generate_invite: {
    name: 'generate_invite', kind: 'mutation', rolesAllowed: ['admin'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'mutation', legacyIntent: 'gerar_convite', inputSchema: emptySchema, replyMode: 'raw',
  },
  view_my_installments: {
    name: 'view_my_installments', kind: 'query', rolesAllowed: ['debtor'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'session', inputSchema: emptySchema, replyMode: 'raw',
  },
  view_my_debt_summary: {
    name: 'view_my_debt_summary', kind: 'query', rolesAllowed: ['debtor'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'session', inputSchema: emptySchema, replyMode: 'raw',
  },
  view_my_portfolio: {
    name: 'view_my_portfolio', kind: 'query', rolesAllowed: ['investor'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'session', inputSchema: emptySchema, replyMode: 'raw',
  },
  configure_briefing: {
    name: 'configure_briefing', kind: 'mutation', rolesAllowed: ['admin'], requiredArgs: [], optionalArgs: ['briefing_time', 'briefing_enabled'], requiresConfirmation: false,
    idempotencyScope: 'mutation', inputSchema: configureBriefingSchema, replyMode: 'raw',
  },
  set_eod_alert_hour: {
    name: 'set_eod_alert_hour', kind: 'mutation', rolesAllowed: ['admin'], requiredArgs: [], optionalArgs: ['time', 'enabled'], requiresConfirmation: false,
    idempotencyScope: 'mutation', inputSchema: setEodAlertHourSchema, replyMode: 'raw',
  },
  preview_lembrete: {
    name: 'preview_lembrete', kind: 'query', rolesAllowed: ['admin'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'session', inputSchema: emptySchema, replyMode: 'raw',
  },
  show_subscription_payment: {
    name: 'show_subscription_payment', kind: 'query', rolesAllowed: ['admin'], requiredArgs: [], optionalArgs: [], requiresConfirmation: false,
    idempotencyScope: 'session', legacyIntent: 'ver_mensalidade', inputSchema: emptySchema, replyMode: 'raw',
  },
};

export function getCapabilityDefinition(capability: ActionCapability): CapabilityDefinition<any, any> {
  return REGISTRY[capability];
}
