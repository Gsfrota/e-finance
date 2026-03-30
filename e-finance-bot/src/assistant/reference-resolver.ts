import { inferInstallmentMonth } from '../ai/intent-classifier';
import type { CommandUnderstanding, ContextPack, ConversationWorkingState } from './contracts';

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

export interface ReferenceResolutionResult {
  normalizedEntities: CommandUnderstanding['normalizedEntities'];
  evidence: string[];
  userFacingQuestion?: string;
}

export function buildContextPack(
  state: ConversationWorkingState,
  role: 'admin' | 'investor' | 'debtor',
): ContextPack {
  const candidateHints = [
    ...(state.candidateSets?.debtors || []).map(item => `debtor:${item.label}`),
    ...(state.candidateSets?.contracts || []).map(item => `contract:${item.label}`),
    ...(state.candidateSets?.companies || []).map(item => `company:${item.label}`),
  ].slice(0, 8);

  return {
    tenantScoped: true,
    userRole: role,
    lastIntent: state.lastUserIntent,
    lastCapability: state.lastCapability || state.lastAction,
    focusedEntity: state.focusedEntity?.label,
    activeTimeWindow: state.activeTimeWindow?.label,
    pendingConfirmation: !!state.pendingConfirmation,
    candidateHints,
    recentTurnsSummary: [state.lastUserIntent, state.lastCapability].filter(Boolean).join(' -> '),
  };
}

export function resolveReferences(
  text: string,
  understanding: CommandUnderstanding,
  state: ConversationWorkingState,
  _contextPack: ContextPack,
): ReferenceResolutionResult {
  const normalized = normalizeText(text);
  const entities = { ...(understanding.normalizedEntities || {}) };
  const evidence: string[] = [];

  const debtorCandidates = state.candidateSets?.debtors || state.lastDebtorCandidates || [];
  if (understanding.intent === 'buscar_usuario' && debtorCandidates.length > 0 && !entities.debtor_profile_id) {
    let selected = null as (typeof debtorCandidates)[number] | null;

    if (/^o outro\b/.test(normalized) && debtorCandidates.length === 2 && state.focusedEntity?.id) {
      selected = debtorCandidates.find(candidate => candidate.id !== state.focusedEntity?.id) || null;
      if (selected) evidence.push('candidate_set:debtors:o_outro');
    }

    if (!selected) {
      const byOrdinal = extractOrdinalSelection(text);
      if (byOrdinal && byOrdinal >= 1 && byOrdinal <= debtorCandidates.length) {
        selected = debtorCandidates[byOrdinal - 1];
        evidence.push('candidate_set:debtors:ordinal');
      }
    }

    if (!selected) {
      const digits = normalized.replace(/\D/g, '');
      if (digits.length >= 2) {
        selected = debtorCandidates.find(candidate =>
          candidate.cpfMasked?.replace(/\D/g, '').endsWith(digits)
        ) || null;
        if (selected) evidence.push('candidate_set:debtors:cpf_suffix');
      }
    }

    if (!selected) {
      selected = debtorCandidates.find(candidate =>
        normalizeText(candidate.label).includes(normalized)
      ) || null;
      if (selected) evidence.push('candidate_set:debtors:name_match');
    }

    if (selected) {
      entities.debtor_profile_id = selected.id;
      entities.debtor_name = selected.label;
    }
  }

  if (understanding.intent === 'marcar_pagamento') {
    if (!entities.contract_id && state.focusedEntity?.type === 'contract' && state.focusedEntity.id && /^\d+$/.test(String(state.focusedEntity.id))) {
      entities.contract_id = Number(state.focusedEntity.id);
      evidence.push('focused_entity:contract');
    }

    if (!entities.installment_number) {
      const installmentNumber = text.trim().match(/parcela\s*#?\s*(\d+)/i)?.[1];
      if (installmentNumber) {
        entities.installment_number = Number(installmentNumber);
        evidence.push('explicit_installment_number');
      }
    }

    if (!entities.installment_month) {
      const monthInfo = inferInstallmentMonth(text);
      if (monthInfo.month) {
        entities.installment_month = monthInfo.month;
        if (monthInfo.year) entities.installment_year = monthInfo.year;
        evidence.push('explicit_installment_month');
      }
    }
  }

  if ((understanding.intent === 'recebiveis_periodo' || understanding.intent === 'cobrar_periodo') && understanding.normalizedEntities.time_window) {
    evidence.push('time_window:explicit_or_inferred');
  }

  return {
    normalizedEntities: entities,
    evidence,
  };
}
