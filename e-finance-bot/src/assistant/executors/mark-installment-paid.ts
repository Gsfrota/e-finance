import { z } from 'zod';
import {
  getContractOpenInstallments,
  getContractOpenInstallmentByMonth,
  getContractOpenInstallmentByNumber,
  getInstallmentByDebtorAndMonth,
  getInstallmentBulletInfo,
  searchDebtorsByName,
  markInstallmentPaid,
  payBulletInterest,
  formatCurrency,
  formatDate,
  type ContractOpenInstallment,
} from '../../actions/admin-actions';
import { getSupabaseClient } from '../../infra/runtime-clients';
import { formatComprovante, formatBulletPaymentReceipt } from '../../tools/formatters';
import {
  buildStructuredResponse,
  type CandidateOption,
  type CapabilityDefinition,
  type CapabilityExecuteResult,
  type CapabilityResolveResult,
  type ConversationWorkingState,
} from '../contracts';

export interface MarkInstallmentPaidCapabilityInput {
  contract_id?: number;
  installment_number?: number;
  installment_month?: number;
  installment_year?: number;
  debtor_name?: string;
  installment_id?: string;
  selection_page?: number;
  // BR-BOT-012: contrato bullet (interest_only) → 'interest' = rolagem (só juros),
  // 'settle' = quitação (juros + principal). undefined = ainda não escolhido.
  bullet_mode?: 'interest' | 'settle';
  // BR-BOT-013: desambiguação de cliente homônimo na baixa por nome. Mantidos
  // PRIVADOS na capability (não em candidateSets.debtors, que o followup-resolver
  // sequestraria para query_debtor_balance).
  debtor_id?: string;
  debtor_candidates?: Array<{ id: string; full_name: string; cpf: string | null }>;
}

interface MarkInstallmentPaidCapabilityOutput {
  installment: ContractOpenInstallment;
  paidAt: string;
  bullet?: {
    mode: 'interest' | 'settle';
    interestPaid: number;
    principalPaid: number;
    newBalance: number;
    contractClosed: boolean;
  };
}

const markInstallmentPaidInputSchema = z.object({
  contract_id: z.number().int().positive().optional(),
  installment_number: z.number().int().positive().optional(),
  installment_month: z.number().int().min(1).max(12).optional(),
  installment_year: z.number().int().min(2000).max(2100).optional(),
  debtor_name: z.string().min(1).optional(),
  installment_id: z.string().min(1).optional(),
  selection_page: z.number().int().min(0).optional(),
  bullet_mode: z.enum(['interest', 'settle']).optional(),
}).passthrough();

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isShowMoreCommand(text: string): boolean {
  return /^mostrar(\s+mais)?$/i.test(text.trim());
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

function candidateToInstallment(option: CandidateOption): ContractOpenInstallment {
  const meta = option.meta ? JSON.parse(option.meta) as Record<string, unknown> : {};
  return {
    id: option.id,
    number: Number(meta.number || 0),
    contractId: Number(meta.contractId || 0),
    debtorName: String(meta.debtorName || option.label || 'Desconhecido'),
    amount: Number(meta.amount || 0),
    dueDate: String(meta.dueDate || ''),
    status: String(meta.status || 'pending'),
  };
}

function installmentToCandidate(installment: ContractOpenInstallment): CandidateOption {
  return {
    id: installment.id,
    label: `${installment.debtorName} — Parcela ${installment.number}`,
    meta: JSON.stringify({
      contractId: installment.contractId,
      number: installment.number,
      debtorName: installment.debtorName,
      amount: installment.amount,
      dueDate: installment.dueDate,
      status: installment.status,
    }),
  };
}

function formatInstallmentOptions(contractId: number | undefined, installments: ContractOpenInstallment[], hasMore = false): string {
  const header = contractId
    ? `Encontrei estas parcelas em aberto no *Contrato #${contractId}*:`
    : 'Encontrei estas parcelas em aberto:';

  const lines = installments.map((item, index) => (
    `${index + 1}. Parcela *${item.number}* — ${formatCurrency(item.amount)} — ${formatDate(item.dueDate)}`
  ));
  const extra = hasMore ? '\n\nSe quiser ver mais, responda *mostrar mais*.' : '';
  return `${header}\n\n${lines.join('\n')}\n\nResponda com o *número* da parcela.${extra}`;
}

function formatPaymentConfirmationPreview(
  installment: ContractOpenInstallment,
  contractId?: number,
): string {
  const headerParts: string[] = [`*${installment.debtorName || 'Desconhecido'}*`];
  if (contractId) headerParts.push(`Contrato *#${contractId}*`);
  if (installment.number) headerParts.push(`Parcela *${installment.number}*`);

  const lines = [
    '*Baixar parcela — confirmar*',
    '',
    headerParts.join('  ·  '),
    '',
    `Valor: *${formatCurrency(installment.amount)}*`,
  ];
  if (installment.dueDate) lines.push(`Vencimento: ${formatDate(installment.dueDate)}`);
  lines.push('', 'Responda *sim* para confirmar a baixa ou *não* para cancelar.');
  return lines.join('\n');
}

function textToStructuredResponse(message: string) {
  const lines = message.split('\n').map(line => line.trimEnd()).filter(Boolean);
  return buildStructuredResponse({
    status: 'ok',
    title: lines[0] || 'Resposta',
    facts: lines.slice(1),
    safePreview: message,
  });
}

function buildClarificationPatch(
  input: MarkInstallmentPaidCapabilityInput,
  installments: ContractOpenInstallment[],
  extras: Partial<ConversationWorkingState> = {},
): Partial<ConversationWorkingState> {
  return {
    pendingCapability: 'mark_installment_paid',
    pendingOperationInput: { ...input },
    candidateSets: {
      installments: installments.map(installmentToCandidate),
    },
    missingSlots: ['installment_choice'],
    pendingMissingFields: ['installment_choice'],
    focusedEntity: input.contract_id
      ? { type: 'contract', id: String(input.contract_id), label: `Contrato #${input.contract_id}` }
      : undefined,
    legacyPending: undefined,
    ...extras,
  };
}

async function resolveFromCandidateSelection(
  rawText: string,
  candidates: CandidateOption[],
): Promise<ContractOpenInstallment | null> {
  if (candidates.length === 0) return null;
  const selection = extractOrdinalSelection(rawText);
  if (selection && selection >= 1 && selection <= candidates.length) {
    return candidateToInstallment(candidates[selection - 1]);
  }

  const normalized = normalizeText(rawText);
  if (!normalized) return null;
  const byName = candidates.find(candidate => normalizeText(candidate.label).includes(normalized));
  return byName ? candidateToInstallment(byName) : null;
}

// BR-BOT-013: desambiguação de cliente homônimo na baixa por nome.
type DebtorChoice = { id: string; full_name: string; cpf: string | null };

function maskCpfTail(cpf: string | null): string {
  const digits = (cpf || '').replace(/\D/g, '');
  return digits ? `***.***.***-${digits.slice(-2)}` : 'CPF não informado';
}

function formatDebtorChoiceMessage(query: string, candidates: DebtorChoice[]): string {
  const lines = candidates.map((c, i) => `${i + 1}. *${c.full_name}* — CPF ${maskCpfTail(c.cpf)}`);
  return [
    `Encontrei *${candidates.length} clientes* com nome parecido com *${query}*.`,
    '',
    'Para evitar baixar no cliente errado, me diga qual deles:',
    ...lines,
    '',
    'Responda com o *número* ou o *final do CPF* (2 dígitos).',
  ].join('\n');
}

function resolveDebtorChoice(text: string, candidates: DebtorChoice[]): DebtorChoice | null {
  const ordinal = extractOrdinalSelection(text);
  if (ordinal && ordinal >= 1 && ordinal <= candidates.length) return candidates[ordinal - 1];

  const digits = text.replace(/\D/g, '');
  if (digits.length >= 2) {
    const matches = candidates.filter(c => (c.cpf || '').replace(/\D/g, '').endsWith(digits));
    if (matches.length === 1) return matches[0]; // suffix ambíguo → null (re-pergunta)
  }
  return null;
}

// BR-BOT-012: léxico de escolha na baixa bullet.
function parseBulletMode(text: string): 'interest' | 'settle' | null {
  const n = normalizeText(text);
  if (/quitar|quita|quito|liquidar|liquida|liquidou|zerar|encerrar|encerra|matar|mata|matou|fechou|pagar\s*tudo|paga\s*tudo|pagar\s*o?\s*saldo|pagar\s*o?\s*principal|abater|principal|fechar\s*contrato/.test(n)) {
    return 'settle';
  }
  if (/juros|rolar|rola|rolagem|so\s*juros|apenas\s*juros|somente\s*juros|^1$/.test(n)) {
    return 'interest';
  }
  return null;
}

function formatBulletChoiceMessage(installment: ContractOpenInstallment, remainingBalance: number, interestDue: number): string {
  const headerParts: string[] = [`*${installment.debtorName || 'Desconhecido'}*`];
  if (installment.contractId) headerParts.push(`Contrato *#${installment.contractId}*`);
  return [
    '*Contrato de juros simples (bullet)*',
    '',
    headerParts.join('  ·  '),
    `Principal em aberto: *${formatCurrency(remainingBalance)}*`,
    `Juros desta parcela: *${formatCurrency(interestDue)}*`,
    '',
    'Como deseja registrar a baixa?',
    `• *Juros* — paga só os juros (${formatCurrency(interestDue)}) e mantém o principal em aberto`,
    `• *Quitar* — paga juros + principal (${formatCurrency(remainingBalance + interestDue)}) e encerra o contrato`,
    '',
    'Responda *juros* ou *quitar*.',
  ].join('\n');
}

function formatBulletConfirmationPreview(
  installment: ContractOpenInstallment,
  mode: 'interest' | 'settle',
  remainingBalance: number,
  interestDue: number,
): string {
  const headerParts: string[] = [`*${installment.debtorName || 'Desconhecido'}*`];
  if (installment.contractId) headerParts.push(`Contrato *#${installment.contractId}*`);
  const lines = ['*Baixar parcela — confirmar*', '', headerParts.join('  ·  '), ''];
  if (mode === 'settle') {
    lines.push(
      '_Quitação (juros + principal)_',
      `Juros: *${formatCurrency(interestDue)}*`,
      `Principal: *${formatCurrency(remainingBalance)}*`,
      `Total: *${formatCurrency(remainingBalance + interestDue)}*`,
    );
  } else {
    lines.push(
      '_Rolagem (só juros)_',
      `Valor: *${formatCurrency(interestDue)}*`,
      `Principal em aberto após a baixa: *${formatCurrency(remainingBalance)}*`,
    );
  }
  if (installment.dueDate) lines.push(`Vencimento: ${formatDate(installment.dueDate)}`);
  lines.push('', 'Responda *sim* para confirmar a baixa ou *não* para cancelar.');
  return lines.join('\n');
}

/**
 * BR-BOT-012: centraliza a finalização de uma parcela escolhida. Se a parcela
 * pertence a um contrato bullet e o modo (rolagem/quitação) ainda não foi
 * escolhido, pede a escolha; senão devolve 'ready' com o preview adequado.
 */
async function finalizeSelection(
  ctx: { tenantId: string; rawText: string },
  merged: MarkInstallmentPaidCapabilityInput,
  selected: ContractOpenInstallment,
): Promise<CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>> {
  const baseInput: MarkInstallmentPaidCapabilityInput = {
    ...merged,
    installment_id: selected.id,
    contract_id: selected.contractId,
    installment_number: selected.number,
  };
  const focusedEntity = { type: 'contract' as const, id: String(selected.contractId), label: `Contrato #${selected.contractId}` };

  const bulletInfo = await getInstallmentBulletInfo(selected.id, ctx.tenantId);
  if (bulletInfo?.isBullet && !baseInput.bullet_mode) {
    return {
      status: 'needs_clarification',
      safeUserMessage: formatBulletChoiceMessage(selected, bulletInfo.remainingBalance, bulletInfo.interestDue),
      workingStatePatch: {
        pendingCapability: 'mark_installment_paid',
        pendingOperationInput: { ...baseInput },
        candidateSets: { installments: [installmentToCandidate(selected)] },
        missingSlots: ['bullet_mode'],
        pendingMissingFields: ['bullet_mode'],
        focusedEntity,
        legacyPending: undefined,
      },
    } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
  }

  const confirmationPreview = bulletInfo?.isBullet
    ? formatBulletConfirmationPreview(selected, baseInput.bullet_mode || 'interest', bulletInfo.remainingBalance, bulletInfo.interestDue)
    : formatPaymentConfirmationPreview(selected, selected.contractId);

  return {
    status: 'ready',
    input: baseInput,
    confirmationPreview,
    workingStatePatch: {
      pendingCapability: 'mark_installment_paid',
      pendingOperationInput: { ...baseInput },
      candidateSets: { installments: [installmentToCandidate(selected)] },
      missingSlots: [],
      pendingMissingFields: [],
      focusedEntity,
      legacyPending: undefined,
    },
  } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
}

export const markInstallmentPaidCapability: CapabilityDefinition<MarkInstallmentPaidCapabilityInput, MarkInstallmentPaidCapabilityOutput> = {
  name: 'mark_installment_paid',
  kind: 'mutation',
  rolesAllowed: ['admin'],
  requiredArgs: [],
  optionalArgs: ['contract_id', 'installment_number', 'installment_month', 'installment_year', 'debtor_name', 'installment_id', 'selection_page', 'bullet_mode'],
  requiresConfirmation: true,
  idempotencyScope: 'mutation',
  inputSchema: markInstallmentPaidInputSchema,
  replyMode: 'rewrite',
  async resolve(ctx, input) {
    const storedInput = ctx.workingState.pendingCapability === 'mark_installment_paid'
      ? (ctx.workingState.pendingOperationInput || {}) as MarkInstallmentPaidCapabilityInput
      : {};
    const merged = { ...storedInput, ...input };
    const candidates = ctx.workingState.candidateSets?.installments || [];

    // BR-BOT-012: aguardando a escolha rolagem/quitação numa baixa bullet.
    if ((ctx.workingState.pendingMissingFields || []).includes('bullet_mode')
      && merged.installment_id && candidates.length > 0) {
      const selected = candidateToInstallment(candidates[0]);
      const mode = parseBulletMode(ctx.rawText);
      if (!mode) {
        const info = await getInstallmentBulletInfo(selected.id, ctx.tenantId);
        return {
          status: 'needs_clarification',
          safeUserMessage: `Não entendi a opção. ${formatBulletChoiceMessage(selected, info?.remainingBalance ?? 0, info?.interestDue ?? 0)}`,
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: { ...merged },
            candidateSets: { installments: [installmentToCandidate(selected)] },
            missingSlots: ['bullet_mode'],
            pendingMissingFields: ['bullet_mode'],
            focusedEntity: { type: 'contract', id: String(selected.contractId), label: `Contrato #${selected.contractId}` },
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }
      return finalizeSelection(ctx, { ...merged, bullet_mode: mode }, selected);
    }

    // BR-BOT-013: aguardando a escolha de qual cliente homônimo (baixa por nome).
    if ((ctx.workingState.pendingMissingFields || []).includes('debtor_choice')
      && Array.isArray(merged.debtor_candidates) && merged.debtor_candidates.length > 1) {
      const chosen = resolveDebtorChoice(ctx.rawText, merged.debtor_candidates);
      if (!chosen) {
        return {
          status: 'needs_clarification',
          safeUserMessage: `Não identifiquei o cliente. ${formatDebtorChoiceMessage(merged.debtor_name || '', merged.debtor_candidates)}`,
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: { ...merged },
            missingSlots: ['debtor_choice'],
            pendingMissingFields: ['debtor_choice'],
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }
      // Cliente resolvido → resolve por debtor_id + mês. Descarta contract_id
      // (pode ter sido inferido pelo LLM e apontar para o cliente errado — BOT-007).
      merged.debtor_id = chosen.id;
      merged.debtor_name = chosen.full_name;
      merged.debtor_candidates = undefined;
      merged.contract_id = undefined;
    }

    // BR-BOT-014 (BOT-007): pedido por NOME junto de um contract_id (tipicamente
    // inferido pelo LLM a partir do histórico) sob nome AMBÍGUO → desambigua a
    // pessoa primeiro e descarta o contract_id não confiável, evitando baixa no
    // cliente errado. Pulado quando a pessoa já foi escolhida (debtor_id).
    if (merged.debtor_name && merged.contract_id && !merged.debtor_id
      && !merged.installment_id && candidates.length === 0) {
      const profiles = await searchDebtorsByName(ctx.tenantId, merged.debtor_name);
      if (profiles.length > 1) {
        const cleaned = { ...merged, contract_id: undefined, debtor_candidates: profiles };
        return {
          status: 'needs_clarification',
          safeUserMessage: formatDebtorChoiceMessage(merged.debtor_name, profiles),
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: cleaned,
            missingSlots: ['debtor_choice'],
            pendingMissingFields: ['debtor_choice'],
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }
    }

    if (isShowMoreCommand(ctx.rawText) && merged.contract_id) {
      const nextPage = Number(merged.selection_page || 0) + 1;
      const page = await getContractOpenInstallments(ctx.tenantId, merged.contract_id, nextPage, 3);
      if (page.items.length === 0) {
        return {
          status: 'needs_clarification',
          safeUserMessage: 'Não há mais parcelas em aberto para mostrar. Responda com o número da parcela que deseja baixar.',
          workingStatePatch: buildClarificationPatch(
            { ...merged, selection_page: Math.max(0, nextPage - 1) },
            candidates.map(candidateToInstallment),
          ),
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }
      return {
        status: 'needs_clarification',
        safeUserMessage: formatInstallmentOptions(merged.contract_id, page.items, page.hasMore),
        workingStatePatch: buildClarificationPatch({ ...merged, selection_page: page.page }, page.items),
      } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
    }

    if (candidates.length > 0) {
      const selected = await resolveFromCandidateSelection(ctx.rawText, candidates);
      if (selected) {
        return finalizeSelection(ctx, merged, selected);
      }
    }

    if (merged.installment_id) {
      const selected = candidates.find(candidate => candidate.id === merged.installment_id);
      const installment = selected ? candidateToInstallment(selected) : null;
      if (installment) {
        return finalizeSelection(ctx, merged, installment);
      }
    }

    if (merged.contract_id && merged.installment_number) {
      const selected = await getContractOpenInstallmentByNumber(ctx.tenantId, merged.contract_id, merged.installment_number);
      if (!selected) {
        return {
          status: 'needs_clarification',
          safeUserMessage: `Não encontrei a parcela *${merged.installment_number}* em aberto no *Contrato #${merged.contract_id}*.`,
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: { ...merged },
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }
      return finalizeSelection(ctx, merged, selected);
    }

    if (merged.contract_id && merged.installment_month) {
      const selected = await getContractOpenInstallmentByMonth(
        ctx.tenantId,
        merged.contract_id,
        merged.installment_month,
        merged.installment_year,
      );
      if (!selected) {
        return {
          status: 'needs_clarification',
          safeUserMessage: `Não encontrei parcela em aberto desse contrato para o mês informado.`,
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: { ...merged },
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }
      return finalizeSelection(ctx, merged, selected);
    }

    if (merged.contract_id && !merged.installment_number && !merged.installment_month) {
      const page = await getContractOpenInstallments(ctx.tenantId, merged.contract_id, Number(merged.selection_page || 0), 3);
      if (page.items.length === 0) {
        return {
          status: 'needs_clarification',
          safeUserMessage: `Não encontrei parcelas em aberto no *Contrato #${merged.contract_id}*.`,
          workingStatePatch: {
            pendingCapability: undefined,
            pendingOperationInput: undefined,
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }
      return {
        status: 'needs_clarification',
        safeUserMessage: formatInstallmentOptions(merged.contract_id, page.items, page.hasMore),
        workingStatePatch: buildClarificationPatch({ ...merged, selection_page: page.page }, page.items),
      } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
    }

    if (merged.debtor_name && merged.installment_month) {
      const result = await getInstallmentByDebtorAndMonth(
        ctx.tenantId,
        merged.debtor_name,
        merged.installment_month,
        merged.installment_year,
        merged.debtor_id,
      );
      // BR-BOT-013: nome casa com mais de um cliente → pergunta qual antes de qualquer baixa.
      if (result?.ambiguousDebtors && result.ambiguousDebtors.length > 1) {
        return {
          status: 'needs_clarification',
          safeUserMessage: formatDebtorChoiceMessage(merged.debtor_name, result.ambiguousDebtors),
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: { ...merged, debtor_candidates: result.ambiguousDebtors },
            missingSlots: ['debtor_choice'],
            pendingMissingFields: ['debtor_choice'],
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }
      if (!result || result.installments.length === 0) {
        return {
          status: 'needs_clarification',
          safeUserMessage: `Não encontrei parcela em aberto para *${merged.debtor_name}* nesse período.`,
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: { ...merged },
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }
      if (result.installments.length === 1) {
        return finalizeSelection(ctx, merged, result.installments[0]);
      }
      return {
        status: 'needs_clarification',
        safeUserMessage: formatInstallmentOptions(undefined, result.installments, false),
        workingStatePatch: buildClarificationPatch(merged, result.installments),
      } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
    }

    if (merged.debtor_name) {
      return {
        status: 'needs_clarification',
        safeUserMessage: `Para baixar o pagamento de *${merged.debtor_name}*, me diga o *mês* da parcela ou o *contrato + número da parcela*.`,
        workingStatePatch: {
          pendingCapability: 'mark_installment_paid',
          pendingOperationInput: { ...merged },
          missingSlots: ['installment_month'],
          pendingMissingFields: ['installment_month'],
          legacyPending: undefined,
        },
      } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
    }

    return {
      status: 'needs_clarification',
      safeUserMessage: 'Me diga o *contrato + parcela* ou o *nome do devedor + mês* para eu localizar a baixa com segurança.',
      workingStatePatch: {
        pendingCapability: 'mark_installment_paid',
        pendingOperationInput: { ...merged },
        missingSlots: ['payment_target'],
        pendingMissingFields: ['payment_target'],
        legacyPending: undefined,
      },
    } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
  },
  authorize(ctx) {
    if (ctx.role !== 'admin') throw new Error('role_forbidden');
    if (!ctx.tenantId) throw new Error('missing_tenant');
    if (!ctx.profileId) throw new Error('missing_profile');
  },
  async execute(ctx, input) {
    const candidates = ctx.workingState.candidateSets?.installments || [];
    const selected = input.installment_id
      ? candidates.find(candidate => candidate.id === input.installment_id)
      : undefined;
    const installment = selected ? candidateToInstallment(selected) : undefined;

    if (!input.installment_id) {
      return {
        status: 'needs_clarification',
        safeUserMessage: 'Ainda não fechei qual parcela você quer baixar.',
        workingStatePatch: {
          pendingCapability: 'mark_installment_paid',
          pendingOperationInput: { ...input },
          legacyPending: undefined,
        },
      } satisfies CapabilityExecuteResult<MarkInstallmentPaidCapabilityOutput>;
    }

    // BR-BOT-012: baixa de contrato bullet roteia para o RPC pay_bullet_interest_only.
    if (input.bullet_mode) {
      const bulletResult = await payBulletInterest(input.installment_id, ctx.tenantId, input.bullet_mode === 'settle');
      if (!bulletResult) {
        return {
          status: 'error',
          safeUserMessage: '❌ Não foi possível registrar a baixa do contrato de juros simples. Tente novamente.',
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: { ...input },
            legacyPending: undefined,
          },
        } satisfies CapabilityExecuteResult<MarkInstallmentPaidCapabilityOutput>;
      }
      const base = installment || {
        id: input.installment_id,
        number: Number(input.installment_number || 0),
        contractId: Number(input.contract_id || 0),
        debtorName: String(input.debtor_name || 'Cliente'),
        amount: bulletResult.interestPaid,
        dueDate: '',
        status: 'paid',
      };
      return {
        status: 'ok',
        output: {
          installment: { ...base, status: bulletResult.contractClosed ? 'completed' : 'paid' },
          paidAt: new Date().toISOString(),
          bullet: {
            mode: input.bullet_mode,
            interestPaid: bulletResult.interestPaid,
            principalPaid: bulletResult.principalPaid,
            newBalance: bulletResult.newBalance,
            contractClosed: bulletResult.contractClosed,
          },
        },
        workingStatePatch: {
          pendingCapability: undefined,
          pendingOperationInput: undefined,
          pendingMissingFields: [],
          missingSlots: [],
          legacyPending: undefined,
        },
      } satisfies CapabilityExecuteResult<MarkInstallmentPaidCapabilityOutput>;
    }

    const success = await markInstallmentPaid(input.installment_id, ctx.tenantId);
    if (!success) {
      return {
        status: 'error',
        safeUserMessage: '❌ Não foi possível marcar como pago. Tente novamente.',
        workingStatePatch: {
          pendingCapability: 'mark_installment_paid',
          pendingOperationInput: { ...input },
          legacyPending: undefined,
        },
      } satisfies CapabilityExecuteResult<MarkInstallmentPaidCapabilityOutput>;
    }

    // V44d — Lê dados frescos do banco (incluindo paid_at real do RPC). Antes
    // o executor caía num fallback com debtorName="Cliente" amount=0 quando
    // candidates não tinha a parcela — gerava comprovante errado.
    const fresh = await fetchInstallmentReceipt(input.installment_id, ctx.tenantId);
    const paidAt = fresh?.paidAt || new Date().toISOString();

    return {
      status: 'ok',
      output: {
        installment: fresh
          ? {
              id: input.installment_id,
              number: fresh.number,
              contractId: fresh.contractId,
              debtorName: fresh.debtorName,
              amount: fresh.amountPaid > 0 ? fresh.amountPaid : fresh.amountTotal,
              dueDate: fresh.dueDate,
              status: 'paid',
            }
          : (installment || {
              id: input.installment_id,
              number: Number(input.installment_number || 0),
              contractId: Number(input.contract_id || 0),
              debtorName: String(input.debtor_name || 'Cliente'),
              amount: 0,
              dueDate: '',
              status: 'paid',
            }),
        paidAt,
      },
      workingStatePatch: {
        pendingCapability: undefined,
        pendingOperationInput: undefined,
        pendingMissingFields: [],
        missingSlots: [],
        legacyPending: undefined,
      },
    } satisfies CapabilityExecuteResult<MarkInstallmentPaidCapabilityOutput>;
  },
  formatResult(output) {
    if (output.bullet) {
      return textToStructuredResponse(formatBulletPaymentReceipt({
        debtorName: output.installment.debtorName,
        contractId: output.installment.contractId,
        installmentNumber: output.installment.number,
        paidAt: output.paidAt,
        mode: output.bullet.mode,
        interestPaid: output.bullet.interestPaid,
        principalPaid: output.bullet.principalPaid,
        newBalance: output.bullet.newBalance,
        contractClosed: output.bullet.contractClosed,
      }));
    }
    return textToStructuredResponse(formatComprovante({
      debtorName: output.installment.debtorName,
      amount: output.installment.amount,
      dueDate: output.installment.dueDate,
      paidAt: output.paidAt,
      installmentNumber: output.installment.number,
      contractId: output.installment.contractId,
    }));
  },
};

interface FreshInstallmentReceipt {
  number: number;
  contractId: number;
  debtorName: string;
  amountTotal: number;
  amountPaid: number;
  dueDate: string;
  paidAt: string | null;
}

async function fetchInstallmentReceipt(
  installmentId: string,
  tenantId: string,
): Promise<FreshInstallmentReceipt | null> {
  let data: unknown;
  try {
    const result = await getSupabaseClient()
      .from('loan_installments')
      .select('number, amount_total, amount_paid, due_date, paid_at, investment_id, investments!inner(id, tenant_id, payer_id, profiles!investments_payer_id_fkey(full_name))')
      .eq('id', installmentId)
      .eq('investments.tenant_id', tenantId)
      .maybeSingle();
    if (result.error || !result.data) return null;
    data = result.data;
  } catch {
    return null;
  }
  if (!data) return null;
  // Tipos do supabase-js para joins aninhados são frouxos; tratamos defensivamente.
  const inv = (data as unknown as { investments?: { id?: number; profiles?: { full_name?: string } | null } }).investments;
  return {
    number: Number((data as { number?: number }).number ?? 0),
    contractId: Number(inv?.id ?? 0),
    debtorName: inv?.profiles?.full_name ?? 'Cliente',
    amountTotal: Number((data as { amount_total?: number | string }).amount_total ?? 0),
    amountPaid: Number((data as { amount_paid?: number | string }).amount_paid ?? 0),
    dueDate: String((data as { due_date?: string }).due_date ?? ''),
    paidAt: ((data as { paid_at?: string | null }).paid_at) ?? null,
  };
}
