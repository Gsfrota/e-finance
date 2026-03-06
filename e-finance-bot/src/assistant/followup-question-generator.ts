import type { ActionCapability } from './contracts';
import type { BotTenantConfig } from '../actions/bot-config-actions';

type FollowupStyle = 'natural' | 'direto' | 'disabled';

const FOLLOWUP_NATURAL: Partial<Record<ActionCapability, string>> = {
  show_dashboard:           'Quer ver quem está atrasado hoje?',
  list_receivables:         'Deseja registrar algum pagamento?',
  list_collection_targets:  'Quer ver o valor total em atraso?',
  query_debtor_balance:     'Quer ver as parcelas abertas desse cliente?',
  query_receivables_window: 'Deseja exportar um relatório do período?',
  query_collection_window:  'Quer cobrar algum desses clientes agora?',
  create_contract:          'Deseja gerar um convite para o devedor?',
  mark_installment_paid:    'Tem mais algum pagamento para dar baixa?',
  generate_report:          'Quer ver os atrasados do mês?',
  generate_invite:          'Deseja criar outro convite?',
};

const FOLLOWUP_DIRETO: Partial<Record<ActionCapability, string>> = {
  show_dashboard:           'Ver atrasados hoje?',
  list_receivables:         'Registrar pagamento?',
  list_collection_targets:  'Ver total em atraso?',
  query_debtor_balance:     'Ver parcelas abertas?',
  query_receivables_window: 'Exportar relatório?',
  query_collection_window:  'Cobrar algum agora?',
  create_contract:          'Gerar convite?',
  mark_installment_paid:    'Mais pagamentos?',
  generate_report:          'Ver atrasados do mês?',
  generate_invite:          'Criar outro convite?',
};

export function getFollowupQuestion(
  capability: ActionCapability,
  config: { enabled: boolean; style: FollowupStyle }
): string | null {
  if (!config.enabled || config.style === 'disabled') return null;

  const map = config.style === 'direto' ? FOLLOWUP_DIRETO : FOLLOWUP_NATURAL;
  return map[capability] ?? null;
}

export function getFollowupFromTenantConfig(
  capability: ActionCapability,
  tenantConfig: BotTenantConfig | null
): string | null {
  const enabled = tenantConfig?.followup_enabled ?? true;
  const style: FollowupStyle = (tenantConfig?.followup_style as FollowupStyle) ?? 'natural';
  return getFollowupQuestion(capability, { enabled, style });
}
