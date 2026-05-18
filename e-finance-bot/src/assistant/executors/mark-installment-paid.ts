import { z } from 'zod';
import {
  getContractOpenInstallments,
  getContractOpenInstallmentByMonth,
  getContractOpenInstallmentByNumber,
  getInstallmentByDebtorAndMonth,
  getOpenInstallmentsByDebtorName,
  markInstallmentPaid,
  formatCurrency,
  formatDate,
  type ContractOpenInstallment,
} from '../../actions/admin-actions';
import { getSupabaseClient } from '../../infra/runtime-clients';
import { formatComprovante } from '../../tools/formatters';
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
}

interface MarkInstallmentPaidCapabilityOutput {
  installment: ContractOpenInstallment;
  paidAt: string;
}

const markInstallmentPaidInputSchema = z.object({
  contract_id: z.number().int().positive().optional(),
  installment_number: z.number().int().positive().optional(),
  installment_month: z.number().int().min(1).max(12).optional(),
  installment_year: z.number().int().min(2000).max(2100).optional(),
  debtor_name: z.string().min(1).optional(),
  installment_id: z.string().min(1).optional(),
  selection_page: z.number().int().min(0).optional(),
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

  const itemMatch = trimmed.match(/^(?:item|opção|opcao|número|numero)\s+(\d{1,2})$/i);
  if (itemMatch?.[1]) return Number(itemMatch[1]);

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

export const markInstallmentPaidCapability: CapabilityDefinition<MarkInstallmentPaidCapabilityInput, MarkInstallmentPaidCapabilityOutput> = {
  name: 'mark_installment_paid',
  kind: 'mutation',
  rolesAllowed: ['admin'],
  requiredArgs: [],
  optionalArgs: ['contract_id', 'installment_number', 'installment_month', 'installment_year', 'debtor_name', 'installment_id', 'selection_page'],
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
        return {
          status: 'ready',
          input: {
            ...merged,
            installment_id: selected.id,
            contract_id: selected.contractId,
            installment_number: selected.number,
          },
          confirmationPreview: formatPaymentConfirmationPreview(selected, selected.contractId),
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: {
              ...merged,
              installment_id: selected.id,
              contract_id: selected.contractId,
              installment_number: selected.number,
            },
            candidateSets: { installments: [installmentToCandidate(selected)] },
            missingSlots: [],
            pendingMissingFields: [],
            focusedEntity: { type: 'contract', id: String(selected.contractId), label: `Contrato #${selected.contractId}` },
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }
    }

    if (merged.installment_id) {
      const selected = candidates.find(candidate => candidate.id === merged.installment_id);
      const installment = selected ? candidateToInstallment(selected) : null;
      if (installment) {
        return {
          status: 'ready',
          input: merged,
          confirmationPreview: formatPaymentConfirmationPreview(installment, installment.contractId),
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: { ...merged },
            candidateSets: { installments: [installmentToCandidate(installment)] },
            missingSlots: [],
            pendingMissingFields: [],
            focusedEntity: { type: 'contract', id: String(installment.contractId), label: `Contrato #${installment.contractId}` },
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
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
      return {
        status: 'ready',
        input: {
          ...merged,
          installment_id: selected.id,
        },
        confirmationPreview: formatPaymentConfirmationPreview(selected, selected.contractId),
        workingStatePatch: {
          pendingCapability: 'mark_installment_paid',
          pendingOperationInput: { ...merged, installment_id: selected.id },
          candidateSets: { installments: [installmentToCandidate(selected)] },
          missingSlots: [],
          pendingMissingFields: [],
          focusedEntity: { type: 'contract', id: String(selected.contractId), label: `Contrato #${selected.contractId}` },
          legacyPending: undefined,
        },
      } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
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
      return {
        status: 'ready',
        input: {
          ...merged,
          installment_id: selected.id,
          installment_number: selected.number,
        },
        confirmationPreview: formatPaymentConfirmationPreview(selected, selected.contractId),
        workingStatePatch: {
          pendingCapability: 'mark_installment_paid',
          pendingOperationInput: { ...merged, installment_id: selected.id, installment_number: selected.number },
          candidateSets: { installments: [installmentToCandidate(selected)] },
          missingSlots: [],
          pendingMissingFields: [],
          focusedEntity: { type: 'contract', id: String(selected.contractId), label: `Contrato #${selected.contractId}` },
          legacyPending: undefined,
        },
      } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
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
      );
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
        const selected = result.installments[0];
        return {
          status: 'ready',
          input: {
            ...merged,
            installment_id: selected.id,
            contract_id: selected.contractId,
            installment_number: selected.number,
          },
          confirmationPreview: formatPaymentConfirmationPreview(selected, selected.contractId),
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: {
              ...merged,
              installment_id: selected.id,
              contract_id: selected.contractId,
              installment_number: selected.number,
            },
            candidateSets: { installments: [installmentToCandidate(selected)] },
            focusedEntity: { type: 'contract', id: String(selected.contractId), label: `Contrato #${selected.contractId}` },
            missingSlots: [],
            pendingMissingFields: [],
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }
      return {
        status: 'needs_clarification',
        safeUserMessage: formatInstallmentOptions(undefined, result.installments, false),
        workingStatePatch: buildClarificationPatch(merged, result.installments),
      } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
    }

    if (merged.debtor_name) {
      const { installments: found, matchedDebtors } =
        await getOpenInstallmentsByDebtorName(ctx.tenantId, merged.debtor_name);

      if (found.length === 0) {
        return {
          status: 'needs_clarification',
          safeUserMessage: matchedDebtors === 0
            ? `Não encontrei nenhum devedor com nome parecido com *${merged.debtor_name}*.`
            : `*${merged.debtor_name}* não tem parcelas em aberto no momento.`,
          workingStatePatch: {
            pendingCapability: undefined,
            pendingOperationInput: undefined,
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }

      if (found.length === 1) {
        const sel = found[0];
        return {
          status: 'ready',
          input: {
            ...merged,
            installment_id: sel.id,
            contract_id: sel.contractId,
            installment_number: sel.number,
          },
          confirmationPreview: formatPaymentConfirmationPreview(sel, sel.contractId),
          workingStatePatch: {
            pendingCapability: 'mark_installment_paid',
            pendingOperationInput: {
              ...merged,
              installment_id: sel.id,
              contract_id: sel.contractId,
              installment_number: sel.number,
            },
            candidateSets: { installments: [installmentToCandidate(sel)] },
            missingSlots: [],
            pendingMissingFields: [],
            focusedEntity: { type: 'contract', id: String(sel.contractId), label: `Contrato #${sel.contractId}` },
            legacyPending: undefined,
          },
        } satisfies CapabilityResolveResult<MarkInstallmentPaidCapabilityInput>;
      }

      return {
        status: 'needs_clarification',
        safeUserMessage: formatInstallmentOptions(undefined, found, false),
        workingStatePatch: buildClarificationPatch(merged, found),
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
  let data: unknown = null;
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
