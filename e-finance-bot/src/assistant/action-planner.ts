import type { ActionPlan, CommandUnderstanding } from './contracts';
import { inferTimeWindowFromEntities, inferTimeWindowFromText } from './time-window';

function makePlan(
  capability: ActionPlan['capability'],
  understanding: CommandUnderstanding,
  args: Record<string, unknown> = {},
  missingFields: string[] = [],
): ActionPlan {
  return {
    capability,
    confidence: understanding.confidence,
    source: understanding.source,
    args,
    missingFields,
    dependsOnContext: understanding.dependsOnContext,
    requiresConfirmation: capability === 'disconnect_bot',
  };
}

export function createActionPlan(
  understanding: CommandUnderstanding,
  rawText: string,
): ActionPlan {
  const entities = understanding.normalizedEntities || {};

  switch (understanding.intent) {
    case 'smalltalk_identity':
      return makePlan('smalltalk_identity', understanding);
    case 'smalltalk_datetime':
      return makePlan('smalltalk_datetime', understanding);
    case 'ver_dashboard':
      return makePlan('show_dashboard', understanding);
    case 'listar_recebiveis':
      return makePlan('list_receivables', understanding, { filter: entities.filter || 'pending' });
    case 'recebiveis_hoje':
    case 'recebiveis_periodo': {
      const timeWindow = entities.time_window || inferTimeWindowFromEntities(entities) || inferTimeWindowFromText(rawText);
      return makePlan('query_receivables_window', understanding, {
        time_window: timeWindow,
      });
    }
    case 'cobrar_hoje':
    case 'cobrar_periodo': {
      const timeWindow = entities.time_window || inferTimeWindowFromEntities(entities) || inferTimeWindowFromText(rawText);
      return makePlan('query_collection_window', understanding, {
        time_window: timeWindow,
      });
    }
    case 'buscar_usuario': {
      const debtorName = entities.debtor_name;
      const debtorProfileId = entities.debtor_profile_id;
      return makePlan(
        'query_debtor_balance',
        understanding,
        {
          debtor_name: debtorName,
          debtor_profile_id: debtorProfileId,
        },
        debtorName || debtorProfileId ? [] : ['debtor_name'],
      );
    }
    case 'criar_contrato':
      return makePlan('create_contract', understanding, { ...entities });
    case 'marcar_pagamento':
      return makePlan('mark_installment_paid', understanding, { ...entities });
    case 'gerar_relatorio':
      return makePlan('generate_report', understanding);
    case 'gerar_convite':
      return makePlan('generate_invite', understanding);
    case 'desconectar':
      return makePlan('disconnect_bot', understanding);
    case 'ajuda':
      return makePlan('help', understanding);
    case 'confirmar':
    case 'cancelar':
      return makePlan('help', understanding);
    case 'desconhecido':
    default:
      return {
        capability: 'help',
        confidence: 'low',
        source: understanding.source,
        args: {},
        missingFields: ['intent'],
        dependsOnContext: understanding.dependsOnContext,
        requiresConfirmation: false,
        ambiguity: understanding.candidates?.length
          ? {
              type: 'intent',
              candidates: understanding.candidates.map(candidate => ({ id: candidate, label: candidate })),
            }
          : undefined,
      };
  }
}
