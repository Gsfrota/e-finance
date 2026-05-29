import type { ActionPlan, CommandUnderstanding, OperationalIntent } from './contracts';
import { inferTimeWindowFromEntities, inferTimeWindowFromText } from './time-window';
import { labelToConfidenceScore, validateActionPlan } from './contracts';
import { getCapabilityDefinition } from './capability-registry';

function makePlan(
  decision: ActionPlan['decision'],
  capability: ActionPlan['capability'],
  understanding: CommandUnderstanding,
  args: Record<string, unknown> = {},
  missingArgs: string[] = [],
  extras: Partial<ActionPlan> = {},
): ActionPlan {
  const base: ActionPlan = {
    decision,
    intent: understanding.intent,
    capability,
    args,
    missingArgs,
    missingFields: [...missingArgs],
    confidence: labelToConfidenceScore(understanding.confidence),
    confidenceLabel: understanding.confidence,
    source: understanding.source,
    evidence: extras.evidence || [],
    dependsOnContext: understanding.dependsOnContext,
    requiresConfirmation: getCapabilityDefinition(capability).requiresConfirmation,
    ...extras,
  };

  return validateActionPlan(base);
}

function makeClarification(
  understanding: CommandUnderstanding,
  capability: ActionPlan['capability'],
  missingArgs: string[],
  userFacingQuestion: string,
  args: Record<string, unknown> = {},
): ActionPlan {
  return makePlan('ask_clarification', capability, understanding, args, missingArgs, {
    userFacingQuestion,
  });
}

function makeUtility(
  intent: OperationalIntent,
  capability: ActionPlan['capability'],
): ActionPlan {
  return validateActionPlan({
    decision: 'smalltalk',
    intent,
    capability,
    args: {},
    missingArgs: [],
    missingFields: [],
    confidence: 0.99,
    confidenceLabel: 'high',
    source: 'rule',
    evidence: ['utility_fast_path'],
    dependsOnContext: false,
    requiresConfirmation: false,
  });
}

export function createActionPlan(
  understanding: CommandUnderstanding,
  rawText: string,
  role?: string,
  referenceEvidence: string[] = [],
): ActionPlan {
  const entities = understanding.normalizedEntities || {};
  const evidence = referenceEvidence.length > 0 ? referenceEvidence : [];

  switch (understanding.intent) {
    case 'smalltalk_identity':
      return makeUtility('smalltalk_identity', 'smalltalk_identity');
    case 'smalltalk_datetime':
      return makeUtility('smalltalk_datetime', 'smalltalk_datetime');
    case 'ver_dashboard':
      return makePlan('execute', 'show_dashboard', understanding, {}, [], { evidence });
    case 'listar_recebiveis':
      return makePlan('execute', 'list_receivables', understanding, { filter: entities.filter || 'pending' }, [], { evidence });
    case 'recebiveis_hoje':
    case 'recebiveis_periodo': {
      const timeWindow = entities.time_window || inferTimeWindowFromEntities(entities) || inferTimeWindowFromText(rawText);
      if (!timeWindow) {
        return makeClarification(
          understanding,
          'query_receivables_window',
          ['time_window'],
          'Me diga o período que você quer consultar. Ex.: hoje, amanhã, próximos 7 dias ou próximos 2 meses.',
        );
      }
      return makePlan('execute', 'query_receivables_window', understanding, { time_window: timeWindow }, [], { evidence });
    }
    case 'cobrar_hoje':
    case 'cobrar_periodo': {
      const timeWindow = entities.time_window || inferTimeWindowFromEntities(entities) || inferTimeWindowFromText(rawText);
      if (!timeWindow) {
        return makeClarification(
          understanding,
          'query_collection_window',
          ['time_window'],
          'Me diga o período que você quer consultar. Ex.: hoje, amanhã, próximos 7 dias ou próximos 2 meses.',
        );
      }
      return makePlan('execute', 'query_collection_window', understanding, { time_window: timeWindow }, [], { evidence });
    }
    case 'buscar_usuario': {
      const debtorName = entities.debtor_name;
      const debtorProfileId = entities.debtor_profile_id;
      if (!debtorName && !debtorProfileId) {
        return makeClarification(
          understanding,
          'query_debtor_balance',
          ['debtor_name'],
          'Me diga o nome ou o CPF do cliente que você quer consultar.',
        );
      }
      return makePlan(
        'execute',
        'query_debtor_balance',
        understanding,
        {
          debtor_name: debtorName,
          debtor_profile_id: debtorProfileId,
        },
        [],
        { evidence },
      );
    }
    case 'criar_contrato':
      return makePlan('execute', 'create_contract', understanding, { ...entities }, [], { evidence });
    case 'marcar_pagamento':
      return makePlan('execute', 'mark_installment_paid', understanding, { ...entities }, [], { evidence });
    case 'gerar_relatorio':
      return makePlan('execute', 'generate_report', understanding, {}, [], { evidence });
    case 'gerar_convite':
      return makePlan('execute', 'generate_invite', understanding, {}, [], { evidence });
    case 'ver_minhas_parcelas':
      return makePlan('execute', 'view_my_installments', understanding, {}, [], { evidence });
    case 'ver_meu_saldo_devedor':
      if (role === 'admin') return makePlan('execute', 'show_dashboard', understanding, {}, [], { evidence });
      return makePlan('execute', 'view_my_debt_summary', understanding, {}, [], { evidence });
    case 'ver_meu_portfolio':
      if (role === 'admin') return makePlan('execute', 'list_receivables', understanding, { filter: entities.filter || 'pending' }, [], { evidence });
      return makePlan('execute', 'view_my_portfolio', understanding, {}, [], { evidence });
    case 'ver_exemplo_lembrete':
      return makePlan('execute', 'preview_lembrete', understanding, {}, [], { evidence });
    case 'ver_mensalidade':
      return makePlan('execute', 'show_subscription_payment', understanding, {}, [], { evidence });
    case 'reportar_problema':
      return makePlan('execute', 'report_feedback', understanding, {}, [], { evidence });
    case 'configurar_briefing': {
      const briefingTime = (entities as any).briefing_time as string | undefined;
      const briefingEnabled = (entities as any).briefing_enabled as boolean | undefined;
      if (briefingEnabled === false) {
        return makePlan('execute', 'configure_briefing', understanding, { briefing_enabled: false }, [], { evidence });
      }
      if (!briefingTime) {
        return makeClarification(
          understanding,
          'configure_briefing',
          ['briefing_time'],
          'Me diga o horário do briefing. Ex.: 07:30 ou 18h.',
        );
      }
      return makePlan('execute', 'configure_briefing', understanding, {
        briefing_time: briefingTime,
        briefing_enabled: briefingEnabled ?? true,
      }, [], { evidence });
    }
    case 'desconectar':
      return makePlan('request_confirmation', 'disconnect_bot', understanding, {}, [], {
        evidence,
        userFacingQuestion: 'Vou desconectar este chat da sua conta. Quer seguir?',
      });
    case 'saudacao':
      return makePlan('smalltalk', 'greet', understanding, {}, [], { evidence });
    case 'ajuda':
      return makePlan('smalltalk', 'help', understanding, {}, [], { evidence });
    case 'confirmar':
    case 'cancelar':
      return makePlan('reject', 'help', understanding, {}, ['pending_confirmation'], {
        evidence,
        userFacingQuestion: 'Não há uma confirmação pendente agora. Me diga a ação que você quer executar.',
      });
    case 'desconhecido':
    default: {
      const candidateLabels: Record<string, string> = {
        criar_contrato: 'criar contrato',
        listar_recebiveis: 'ver recebíveis',
        cobrar_hoje: 'ver cobrança de hoje',
        cobrar_periodo: 'ver cobrança por período',
        recebiveis_periodo: 'ver recebíveis por período',
        marcar_pagamento: 'marcar pagamento',
        buscar_usuario: 'buscar devedor',
        ver_dashboard: 'ver dashboard',
        gerar_relatorio: 'gerar relatório',
      };
      const candidateNames = understanding.candidates
        ?.map(c => candidateLabels[c] || c)
        .filter(Boolean) || [];
      const clarificationQ = candidateNames.length > 0
        ? `Você quis dizer: ${candidateNames.join(' ou ')}? Me confirme em uma frase curta.`
        : 'Ainda não fechei sua ação com segurança. Me diga em uma frase curta o que você quer fazer agora.';
      return validateActionPlan({
        decision: 'ask_clarification',
        intent: 'desconhecido',
        capability: 'help',
        args: {},
        missingArgs: ['intent'],
        missingFields: ['intent'],
        confidence: labelToConfidenceScore(understanding.confidence),
        confidenceLabel: understanding.confidence,
        source: understanding.source,
        evidence,
        dependsOnContext: understanding.dependsOnContext,
        requiresConfirmation: false,
        userFacingQuestion: clarificationQ,
        ambiguity: understanding.candidates?.length
          ? {
              type: 'intent',
              candidates: understanding.candidates.map(candidate => ({ id: candidate, label: candidateLabels[candidate] || candidate })),
            }
          : undefined,
      });
    }
  }
}
