import type { ActionPlan, ActionCapability, ConversationWorkingState } from './contracts';
import { inferInstallmentMonth } from '../ai/intent-classifier';
import { inferTimeWindowFromText } from './time-window';
import { buildDateWindow } from '../actions/admin-actions';

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

function resolveDebtorCandidateSelection(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  const candidates = state.lastDebtorCandidates || [];
  if (candidates.length === 0) return null;

  const normalized = normalizeText(text);
  let selected = null as typeof candidates[number] | null;

  if (/^o outro\b/.test(normalized) && candidates.length === 2 && state.lastEntity?.id) {
    selected = candidates.find(candidate => candidate.id !== state.lastEntity?.id) || null;
  }

  if (!selected) {
    const byOrdinal = extractOrdinalSelection(text);
    if (byOrdinal && byOrdinal >= 1 && byOrdinal <= candidates.length) {
      selected = candidates[byOrdinal - 1];
    }
  }

  if (!selected) {
    const digits = normalized.replace(/\D/g, '');
    if (digits.length >= 2) {
      selected = candidates.find(candidate =>
        candidate.cpfMasked?.replace(/\D/g, '').endsWith(digits)
      ) || null;
    }
  }

  if (!selected) {
    selected = candidates.find(candidate =>
      normalizeText(candidate.label).includes(normalized)
    ) || null;
  }

  if (!selected) return null;

  return {
    capability: 'query_debtor_balance',
    confidence: 'high',
    source: 'followup',
    args: {
      debtor_profile_id: selected.id,
      debtor_name: selected.label,
    },
    missingFields: [],
    dependsOnContext: true,
    requiresConfirmation: false,
  };
}

function resolveTemporalFollowup(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  const timeWindow = inferTimeWindowFromText(text);
  if (!timeWindow || !state.lastAction) return null;

  // Se o texto contém sinal claro de intent oposto, deixa cair pro intent-router
  const lower = text.toLowerCase();
  const hasReceivableSignal = /receb[eií]|pra receber|vou receber|tenho a receber/.test(lower);
  const hasCollectionSignal = /cobr[aá]r?|devo cobrar|tenho que cobrar/.test(lower);

  if (state.lastAction === 'query_collection_window' && hasReceivableSignal && !hasCollectionSignal) {
    return null;
  }
  if (state.lastAction === 'query_receivables_window' && hasCollectionSignal && !hasReceivableSignal) {
    return null;
  }

  if (state.lastAction === 'query_receivables_window' || state.lastAction === 'list_receivables') {
    return {
      capability: 'query_receivables_window',
      confidence: 'high',
      source: 'followup',
      args: { time_window: timeWindow },
      missingFields: [],
      dependsOnContext: true,
      requiresConfirmation: false,
    };
  }

  if (state.lastAction === 'query_collection_window' || state.lastAction === 'list_collection_targets') {
    return {
      capability: 'query_collection_window',
      confidence: 'high',
      source: 'followup',
      args: { time_window: timeWindow },
      missingFields: [],
      dependsOnContext: true,
      requiresConfirmation: false,
    };
  }

  return null;
}

function resolveInstallmentFollowup(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  if (state.lastAction !== 'mark_installment_paid' || !state.lastContractId) return null;

  const installmentNumber = text.trim().match(/parcela\s*#?\s*(\d+)/i)?.[1];
  if (installmentNumber) {
    return {
      capability: 'mark_installment_paid',
      confidence: 'high',
      source: 'followup',
      args: {
        contract_id: state.lastContractId,
        installment_number: Number(installmentNumber),
      },
      missingFields: [],
      dependsOnContext: true,
      requiresConfirmation: false,
    };
  }

  const monthInfo = inferInstallmentMonth(text);
  if (monthInfo.month) {
    return {
      capability: 'mark_installment_paid',
      confidence: 'high',
      source: 'followup',
      args: {
        contract_id: state.lastContractId,
        installment_month: monthInfo.month,
        installment_year: monthInfo.year,
      },
      missingFields: [],
      dependsOnContext: true,
      requiresConfirmation: false,
    };
  }

  return null;
}

function resolveDetailFollowup(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  if (!state.lastAction) return null;
  const normalized = normalizeText(text);

  // "quero ver detalhes" / "me mostra mais" after installments view
  if (
    state.lastAction === 'view_my_installments'
    && /\b(detalhes?|mais|completo|tudo)\b/.test(normalized)
  ) {
    return {
      capability: 'view_my_installments',
      confidence: 'high',
      source: 'followup',
      args: { filter: 'all' },
      missingFields: [],
      dependsOnContext: true,
      requiresConfirmation: false,
    };
  }

  // "e meus outros contratos?" / "todos os contratos" after portfolio view
  if (
    state.lastAction === 'view_my_portfolio'
    && /\b(outros?|todos?|contratos?|carteira)\b/.test(normalized)
  ) {
    return {
      capability: 'view_my_portfolio',
      confidence: 'high',
      source: 'followup',
      args: {},
      missingFields: [],
      dependsOnContext: true,
      requiresConfirmation: false,
    };
  }

  // "quanto no total?" / "total da dívida?" after debt summary
  if (
    state.lastAction === 'view_my_debt_summary'
    && /\b(total|soma|quanto|divida|saldo)\b/.test(normalized)
  ) {
    return {
      capability: 'view_my_debt_summary',
      confidence: 'high',
      source: 'followup',
      args: {},
      missingFields: [],
      dependsOnContext: true,
      requiresConfirmation: false,
    };
  }

  return null;
}

export function parseBriefingTime(text: string): string | null {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
  if (
    state.lastAction !== 'configure_briefing'
    || !state.pendingMissingFields?.includes('briefing_time')
  ) {
    return null;
  }

  const briefingTime = parseBriefingTime(text);
  if (!briefingTime) return null;

  return {
    capability: 'configure_briefing',
    confidence: 'high',
    source: 'followup',
    args: {
      briefing_time: briefingTime,
      briefing_enabled: true,
    },
    missingFields: [],
    dependsOnContext: true,
    requiresConfirmation: false,
  };
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
  if (!state.lastAction || !TEMPORAL_ACTIONS.has(state.lastAction)) return null;

  const normalized = normalizeText(text);
  // Must be short (<=20 chars) to avoid false positives
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
    state.lastAction === 'query_collection_window' || state.lastAction === 'list_collection_targets'
  ) ? 'query_collection_window' : 'query_receivables_window';

  return {
    capability,
    confidence: 'high',
    source: 'followup',
    args: { time_window: timeWindow },
    missingFields: [],
    dependsOnContext: true,
    requiresConfirmation: false,
  };
}

function resolvePendingCapabilityConfirmation(
  state: ConversationWorkingState,
  text: string,
): ActionPlan | null {
  // 'help' e 'greet' não são ações confirmaveis — "sim" após clarificação cai no pipeline normal
  if (!state.pendingCapability || state.pendingCapability === 'help' || state.pendingCapability === 'greet') return null;

  const normalized = text.trim().toLowerCase();
  if (!/^(sim|ok|confirmo|pode|isso|s)$/i.test(normalized)) return null;

  return {
    capability: state.pendingCapability,
    confidence: 'high',
    source: 'followup',
    args: {},
    missingFields: [],
    dependsOnContext: true,
    requiresConfirmation: false,
  };
}

export function resolveFollowup(
  text: string,
  state: ConversationWorkingState,
): ActionPlan | null {
  return resolvePendingCapabilityConfirmation(state, text)
    || resolveShortTemporalFollowup(state, text)
    || resolveDebtorCandidateSelection(state, text)
    || resolveTemporalFollowup(state, text)
    || resolveInstallmentFollowup(state, text)
    || resolveDetailFollowup(state, text)
    || resolveBriefingFollowup(state, text);
}
