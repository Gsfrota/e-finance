import type { ActionPlan, ActionCapability, ConversationWorkingState, OperationalIntent } from './contracts';
import { inferInstallmentMonth } from '../ai/intent-classifier';
import { inferTimeWindowFromText } from './time-window';
import { buildDateWindow } from '../actions/admin-actions';

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOrdinalSelection(text: string): number | null {
  const trimmed = text.trim();
  const direct = trimmed.match(/^(\d{1,2})$/);
  if (direct?.[1]) return Number(direct[1]);

  if (/primeir[oa]/i.test(trimmed)) return 1;
  if (/segund[oa]/i.test(trimmed)) return 2;
  if (/terceir[oa]/i.test(trimmed)) return 3;
  return null;
}

function isShowMoreCommand(text: string): boolean {
  return /^mostrar(\s+mais)?$/i.test(text.trim());
}

function capabilityToIntent(capability: ActionCapability): OperationalIntent | 'desconhecido' {
  switch (capability) {
    case 'query_debtor_balance':
      return 'buscar_usuario';
    case 'query_receivables_window':
    case 'list_receivables':
      return 'recebiveis_periodo';
    case 'query_collection_window':
    case 'list_collection_targets':
      return 'cobrar_periodo';
    case 'mark_installment_paid':
      return 'marcar_pagamento';
    case 'configure_briefing':
      return 'configurar_briefing';
    case 'view_my_installments':
      return 'ver_minhas_parcelas';
    case 'view_my_debt_summary':
      return 'ver_meu_saldo_devedor';
    case 'view_my_portfolio':
      return 'ver_meu_portfolio';
    case 'disconnect_bot':
      return 'desconectar';
    case 'help':
      return 'ajuda';
    case 'greet':
      return 'saudacao';
    case 'smalltalk_identity':
      return 'smalltalk_identity';
    case 'smalltalk_datetime':
      return 'smalltalk_datetime';
    case 'show_dashboard':
      return 'ver_dashboard';
    case 'create_contract':
      return 'criar_contrato';
    case 'generate_report':
      return 'gerar_relatorio';
    case 'generate_invite':
      return 'gerar_convite';
    case 'preview_lembrete':
      return 'ver_exemplo_lembrete';
    default:
      return 'desconhecido';
  }
}

function makeFollowupPlan(
  capability: ActionCapability,
  args: Record<string, unknown>,
  evidence: string[],
): ActionPlan {
  return {
    decision: 'execute',
    intent: capabilityToIntent(capability),
    capability,
    args,
    missingArgs: [],
    missingFields: [],
    confidence: 0.95,
    confidenceLabel: 'high',
    source: 'followup',
    evidence,
    dependsOnContext: true,
    requiresConfirmation: false,
  };
}

function resolveDebtorCandidateSelection(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  const candidates = state.candidateSets?.debtors || state.lastDebtorCandidates || [];
  if (candidates.length === 0) return null;

  const normalized = normalizeText(text);
  let selected = null as typeof candidates[number] | null;
  const evidence: string[] = [];

  const focusedDebtorId = state.focusedEntity?.type === 'debtor'
    ? state.focusedEntity.id
    : state.lastEntity?.type === 'debtor'
      ? state.lastEntity.id
      : undefined;

  if (/^o outro\b/.test(normalized) && candidates.length === 2 && focusedDebtorId) {
    selected = candidates.find(candidate => candidate.id !== focusedDebtorId) || null;
    if (selected) evidence.push('candidate_set:debtors:o_outro');
  }

  if (!selected) {
    const byOrdinal = extractOrdinalSelection(text);
    if (byOrdinal && byOrdinal >= 1 && byOrdinal <= candidates.length) {
      selected = candidates[byOrdinal - 1];
      evidence.push('candidate_set:debtors:ordinal');
    }
  }

  if (!selected) {
    const digits = normalized.replace(/\D/g, '');
    if (digits.length >= 2) {
      selected = candidates.find(candidate =>
        candidate.cpfMasked?.replace(/\D/g, '').endsWith(digits)
      ) || null;
      if (selected) evidence.push('candidate_set:debtors:cpf_suffix');
    }
  }

  if (!selected) {
    selected = candidates.find(candidate =>
      normalizeText(candidate.label).includes(normalized)
    ) || null;
    if (selected) evidence.push('candidate_set:debtors:name_match');
  }

  if (!selected) return null;

  return makeFollowupPlan('query_debtor_balance', {
    debtor_profile_id: selected.id,
    debtor_name: selected.label,
  }, evidence);
}

function resolveTemporalFollowup(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  const timeWindow = inferTimeWindowFromText(text);
  const lastCapability = state.lastCapability || state.lastAction;
  if (!timeWindow || !lastCapability) return null;

  const lower = text.toLowerCase();
  const hasReceivableSignal = /receb[eií]|pra receber|vou receber|tenho a receber/.test(lower);
  const hasCollectionSignal = /cobr[aá]r?|devo cobrar|tenho que cobrar/.test(lower);

  if (lastCapability === 'query_collection_window' && hasReceivableSignal && !hasCollectionSignal) {
    return null;
  }
  if (lastCapability === 'query_receivables_window' && hasCollectionSignal && !hasReceivableSignal) {
    return null;
  }

  if (lastCapability === 'query_receivables_window' || lastCapability === 'list_receivables') {
    return makeFollowupPlan('query_receivables_window', { time_window: timeWindow }, ['active_time_window:followup']);
  }

  if (lastCapability === 'query_collection_window' || lastCapability === 'list_collection_targets') {
    return makeFollowupPlan('query_collection_window', { time_window: timeWindow }, ['active_time_window:followup']);
  }

  return null;
}

function resolveInstallmentFollowup(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  const lastCapability = state.lastCapability || state.lastAction;
  const focusedContractId = state.focusedEntity?.type === 'contract'
    ? state.focusedEntity.id
    : state.lastContractId
      ? String(state.lastContractId)
      : undefined;

  if (lastCapability !== 'mark_installment_paid' || !focusedContractId || !/^\d+$/.test(focusedContractId)) {
    return null;
  }

  const installmentNumber = text.trim().match(/parcela\s*#?\s*(\d+)/i)?.[1];
  if (installmentNumber) {
    return makeFollowupPlan('mark_installment_paid', {
      contract_id: Number(focusedContractId),
      installment_number: Number(installmentNumber),
    }, ['focused_entity:contract', 'explicit_installment_number']);
  }

  const monthInfo = inferInstallmentMonth(text);
  if (monthInfo.month) {
    return makeFollowupPlan('mark_installment_paid', {
      contract_id: Number(focusedContractId),
      installment_month: monthInfo.month,
      installment_year: monthInfo.year,
    }, ['focused_entity:contract', 'explicit_installment_month']);
  }

  return null;
}

function resolvePendingCapabilityFollowup(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  const pendingCapability = state.pendingCapability;
  if (!pendingCapability) return null;

  if (pendingCapability === 'create_contract') {
    return makeFollowupPlan('create_contract', {}, ['pending_capability:create_contract']);
  }

  if (pendingCapability === 'mark_installment_paid') {
    const normalized = normalizeText(text);
    const candidates = state.candidateSets?.installments || [];
    const byOrdinal = extractOrdinalSelection(text);

    if (isShowMoreCommand(text)) {
      return makeFollowupPlan('mark_installment_paid', {}, ['pending_capability:show_more']);
    }

    if (byOrdinal && byOrdinal >= 1 && byOrdinal <= candidates.length) {
      const selected = candidates[byOrdinal - 1];
      return makeFollowupPlan('mark_installment_paid', {
        installment_id: selected.id,
      }, ['pending_capability:installment_choice']);
    }

    if (normalized.length > 0 && (state.missingSlots?.length || state.pendingMissingFields?.length)) {
      return makeFollowupPlan('mark_installment_paid', {}, ['pending_capability:mark_installment_paid']);
    }
  }

  return null;
}

function resolveDetailFollowup(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  const lastCapability = state.lastCapability || state.lastAction;
  if (!lastCapability) return null;
  const normalized = normalizeText(text);

  if (
    lastCapability === 'view_my_installments'
    && /\b(detalhes?|mais|completo|tudo)\b/.test(normalized)
  ) {
    return makeFollowupPlan('view_my_installments', { filter: 'all' }, ['followup:detail']);
  }

  if (
    lastCapability === 'view_my_portfolio'
    && /\b(outros?|todos?|contratos?|carteira)\b/.test(normalized)
  ) {
    return makeFollowupPlan('view_my_portfolio', {}, ['followup:portfolio']);
  }

  if (
    lastCapability === 'view_my_debt_summary'
    && /\b(total|soma|quanto|divida|saldo)\b/.test(normalized)
  ) {
    return makeFollowupPlan('view_my_debt_summary', {}, ['followup:debt_summary']);
  }

  return null;
}

export function parseBriefingTime(text: string): string | null {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

  if (/meio\s*dia/.test(normalized)) return '12:00';

  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*h(?:oras?)?)?/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  if (hour < 12 && /(da\s+tarde|da\s+noite)/.test(normalized)) {
    hour += 12;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function resolveBriefingFollowup(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  const lastCapability = state.lastCapability || state.lastAction;
  const missingFields = state.pendingMissingFields || state.missingSlots || [];
  if (lastCapability !== 'configure_briefing' || !missingFields.includes('briefing_time')) {
    return null;
  }

  const briefingTime = parseBriefingTime(text);
  if (!briefingTime) return null;

  return makeFollowupPlan('configure_briefing', {
    briefing_time: briefingTime,
    briefing_enabled: true,
  }, ['followup:briefing_time']);
}

const TEMPORAL_ACTIONS = new Set<ActionCapability>([
  'list_receivables',
  'query_receivables_window',
  'query_collection_window',
  'list_collection_targets',
]);

function resolveShortTemporalFollowup(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  const lastCapability = state.lastCapability || state.lastAction;
  if (!lastCapability || !TEMPORAL_ACTIONS.has(lastCapability)) return null;

  const normalized = normalizeText(text);
  if (normalized.length > 20) return null;

  const shortTemporalPattern = /^(?:e\s+)?(?:em\s+)?(\d{1,2})\s*(?:dias?)?[?!]?$|^(?:e\s+)?em\s+(\d{1,2})\s*dias?[?!]?$|^(?:e\s+)?(\d{1,2})\s+dias?[?!]?$/;
  const match = normalized.match(shortTemporalPattern);
  if (!match) return null;

  const days = Number(match[1] || match[2] || match[3]);
  if (!Number.isFinite(days) || days < 1 || days > 60) return null;

  const window = buildDateWindow(days, 'today');
  const timeWindow = {
    mode: 'relative_days' as const,
    amount: days,
    windowStart: 'today' as const,
    startDate: window.startDate,
    endDate: window.endDate,
    label: `nos próximos ${days} dias`,
  };

  const capability = (
    lastCapability === 'query_collection_window' || lastCapability === 'list_collection_targets'
  ) ? 'query_collection_window' : 'query_receivables_window';

  return makeFollowupPlan(capability, { time_window: timeWindow }, ['followup:short_temporal']);
}

function resolvePendingCapabilityConfirmation(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  const pendingCapability = state.pendingCapability;
  if (!pendingCapability || pendingCapability === 'help' || pendingCapability === 'greet') return null;
  if ((state.missingSlots?.length || 0) > 0 || (state.pendingMissingFields?.length || 0) > 0) return null;
  if (pendingCapability === 'create_contract' || pendingCapability === 'mark_installment_paid') return null;

  const normalized = text.trim().toLowerCase();
  if (!/^(sim|ok|confirmo|pode|isso|s)$/i.test(normalized)) return null;

  return {
    decision: 'request_confirmation',
    intent: capabilityToIntent(pendingCapability),
    capability: pendingCapability,
    args: {},
    missingArgs: [],
    missingFields: [],
    confidence: 0.95,
    confidenceLabel: 'high',
    source: 'followup',
    evidence: ['followup:confirmation_reply'],
    dependsOnContext: true,
    requiresConfirmation: false,
  };
}

export function resolveFollowup(
  text: string,
  state: ConversationWorkingState,
): ActionPlan | null {
  return resolvePendingCapabilityConfirmation(state, text)
    || resolvePendingCapabilityFollowup(state, text)
    || resolveShortTemporalFollowup(state, text)
    || resolveDebtorCandidateSelection(state, text)
    || resolveTemporalFollowup(state, text)
    || resolveInstallmentFollowup(state, text)
    || resolveDetailFollowup(state, text)
    || resolveBriefingFollowup(state, text);
}
