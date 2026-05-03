import {
  formatCurrency,
  formatDate,
  getDashboardSummary,
  getDebtorsToCollectByDateRange,
  getInstallments,
  getInstallmentsByDateRange,
  getInvestorPortfolio,
  getProfileById,
  getUserDebtDetails,
  searchUser,
} from '../actions/admin-actions';
import { getBotTenantConfig, upsertBotTenantConfig } from '../actions/bot-config-actions';
import { buildBriefingMessage } from '../scheduler/morning-briefing';
import { getCapabilityDefinition } from './capability-registry';
import { createPendingConfirmation } from './confirmation-store';
import { runPolicyCheck } from './policy-engine';
import { getWorkingState } from './working-state-store';
import type {
  ActionPlan,
  CapabilityExecuteResult,
  CapabilityResolveResult,
  CapabilityRuntimeContext,
  ConversationWorkingState,
  ResolvedTimeWindow,
  StructuredResponse,
  ToolExecutionResult,
} from './contracts';
import type { Session } from '../session/session-manager';

interface ToolExecutorContext {
  session: Session;
  tenantId: string;
  profileId: string;
  role: 'admin' | 'investor' | 'debtor';
  requestId: string;
  channel: 'telegram' | 'whatsapp';
  rawText: string;
  confirmed?: boolean;
  idempotencyKey?: string;
  confirmationId?: string;
}

interface ToolExecutorDeps {
  executeLegacyIntent: (legacyIntent: string, args: Record<string, unknown>) => Promise<string>;
}

function formatDashboard(summary: Awaited<ReturnType<typeof getDashboardSummary>>): string {
  const receivedByPaymentMonth = summary.receivedByPaymentMonth ?? summary.receivedMonth;
  const receivedByDueMonth = summary.receivedByDueMonth ?? summary.receivedMonth;
  const monthLabel = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return [
    `*Dashboard — ${monthLabel}*`,
    '',
    '*No mês*',
    `• Recebido (data do pagamento): *${formatCurrency(receivedByPaymentMonth)}*`,
    `• Recebido (data de vencimento): *${formatCurrency(receivedByDueMonth)}*`,
    `• Previsto: *${formatCurrency(summary.expectedMonth)}*`,
    `• Em atraso: *${formatCurrency(summary.totalOverdue)}*`,
    '',
    '*Carteira*',
    `• Contratos ativos: *${summary.activeContracts}*`,
    `• Em atraso: *${summary.overdueContracts}*`,
  ].join('\n');
}

function formatOpenInstallments(installments: Array<{ debtorName: string; amount: number; dueDate: string; daysLate: number }>): string {
  if (installments.length === 0) {
    return '✅ Nenhuma parcela pendente encontrada.';
  }
  const lines = installments.map((item, index) => {
    const late = item.daysLate > 0 ? ` *(${item.daysLate}d atrasado)*` : '';
    return `${index + 1}. ${item.debtorName} — ${formatCurrency(item.amount)} — ${formatDate(item.dueDate)}${late}`;
  });
  return `📋 *Parcelas em aberto:*\n\n${lines.join('\n')}`;
}

function formatReceivablesWindow(window: ResolvedTimeWindow, installments: Array<{ debtorName: string; amount: number; dueDate: string }>): string {
  if (installments.length === 0) {
    return `✅ Não há recebíveis em aberto para o período de *${formatDate(window.startDate)}* a *${formatDate(window.endDate)}*.`;
  }

  const total = installments.reduce((sum, installment) => sum + installment.amount, 0);
  const lines = installments.slice(0, 8).map((item, index) => (
    `${index + 1}. ${item.debtorName} — ${formatCurrency(item.amount)} — ${formatDate(item.dueDate)}`
  ));
  const extra = installments.length > 8 ? `\n\n...e mais ${installments.length - 8} itens nesse período.` : '';
  return `📅 *Recebíveis (${window.label})*\n\n${lines.join('\n')}\n\n💰 Total previsto: *${formatCurrency(total)}*${extra}`;
}

function formatCollectionWindow(window: ResolvedTimeWindow, debtors: Array<{ name: string; totalDue: number; installmentCount: number; daysLate: number }>): string {
  if (debtors.length === 0) {
    return `✅ Não há clientes para cobrar no período de *${formatDate(window.startDate)}* a *${formatDate(window.endDate)}*.`;
  }

  const total = debtors.reduce((sum, debtor) => sum + debtor.totalDue, 0);
  const lines = debtors.slice(0, 8).map((debtor, index) => {
    const parcels = debtor.installmentCount > 1 ? ` — ${debtor.installmentCount} parcelas` : '';
    const late = debtor.daysLate > 0 ? ` *(${debtor.daysLate}d atrasado)*` : '';
    return `${index + 1}. ${debtor.name} — ${formatCurrency(debtor.totalDue)}${parcels}${late}`;
  });
  const extra = debtors.length > 8 ? `\n\n...e mais ${debtors.length - 8} clientes nesse período.` : '';
  return `🔴 *Cobrança (${window.label})*\n\n${lines.join('\n')}\n\n💰 Total em aberto: *${formatCurrency(total)}*${extra}`;
}

function maskCpf(cpf?: string | null): string {
  const digits = String(cpf || '').replace(/\D/g, '');
  if (digits.length !== 11) return '***.***.***-**';
  return `***.***.***-${digits.slice(-2)}`;
}

function formatCandidateList(query: string, candidates: Array<{ id: string; label: string; cpfMasked?: string }>): string {
  const lines = candidates.map((candidate, index) => {
    const cpfLabel = candidate.cpfMasked ? ` — CPF ${candidate.cpfMasked}` : '';
    return `${index + 1}. *${candidate.label}*${cpfLabel}`;
  });
  return `Encontrei mais de um cliente com nome parecido com *${query}*.\n\nQual deles?\n${lines.join('\n')}\n\nResponda com o *número*, o *nome* ou o final do *CPF*.`;
}

function formatDebtMessage(
  name: string,
  debt: {
    totalDebt: number;
    pendingInstallments: number;
    nextDueDate: string | null;
    nextDueAmount: number;
    activeContracts: number;
  }
): string {
  if (debt.totalDebt <= 0 || debt.pendingInstallments <= 0) {
    return `Cliente *${name}* não possui parcelas em aberto.`;
  }

  const parcelasLabel = debt.pendingInstallments === 1 ? 'parcela pendente' : 'parcelas pendentes';
  const contratosLabel = debt.activeContracts === 1 ? 'contrato ativo' : 'contratos ativos';
  const nextInstallment = debt.nextDueDate
    ? `\nPróxima parcela: *${formatDate(debt.nextDueDate)}* (${formatCurrency(debt.nextDueAmount)})`
    : '';

  return `Cliente *${name}* tem um débito de *${formatCurrency(debt.totalDebt)}* em *${debt.pendingInstallments} ${parcelasLabel}*.\n${debt.activeContracts} ${contratosLabel}.${nextInstallment}`;
}

function buildStatePatch(
  plan: ActionPlan,
  extra: Partial<ConversationWorkingState> = {},
): Partial<ConversationWorkingState> {
  return {
    lastUserIntent: plan.intent,
    lastCapability: plan.capability,
    lastAction: plan.capability,
    pendingCapability: plan.capability,
    missingSlots: [...plan.missingArgs],
    pendingMissingFields: [...plan.missingFields],
    lastResolution: {
      source: plan.source,
      confidence: plan.confidence,
      evidence: [...plan.evidence],
    },
    ...extra,
  };
}

function getActiveAdminCompany(session: Session, role: string): { id: string; label: string } | undefined {
  if (role !== 'admin') return undefined;
  return getWorkingState(session.context).activeCompany;
}

function withActiveCompanyLabel(message: string, activeCompanyLabel?: string): string {
  if (!activeCompanyLabel) return message;
  return `🏢 Empresa ativa: *${activeCompanyLabel}*\n\n${message}`;
}

function structuredResponseToText(response: StructuredResponse): string {
  const lines = [response.title, ...response.facts];
  if (response.nextActions?.length) {
    lines.push(...response.nextActions);
  }
  return lines.filter(Boolean).join('\n');
}

function mergeStatePatch(
  plan: ActionPlan,
  ...patches: Array<Partial<ConversationWorkingState> | undefined>
): Partial<ConversationWorkingState> {
  return patches.reduce(
    (acc, patch) => ({ ...acc, ...(patch || {}) }),
    buildStatePatch(plan),
  );
}

function isReplayMutation(
  state: ConversationWorkingState,
  capability: ActionPlan['capability'],
  idempotencyKey?: string,
  confirmationId?: string,
): boolean {
  if (!state.lastMutation) return false;
  if (state.lastMutation.capability !== capability) return false;
  if (idempotencyKey && state.lastMutation.idempotencyKey === idempotencyKey) return true;
  if (confirmationId && state.lastMutation.confirmationId === confirmationId) return true;
  return false;
}

function buildCapabilityRuntimeContext(
  context: ToolExecutorContext,
  workingState: ConversationWorkingState,
): CapabilityRuntimeContext {
  return {
    session: context.session,
    tenantId: context.tenantId,
    profileId: context.profileId,
    role: context.role,
    requestId: context.requestId,
    channel: context.channel,
    rawText: context.rawText,
    confirmed: context.confirmed,
    idempotencyKey: context.idempotencyKey,
    confirmationId: context.confirmationId,
    workingState,
  };
}

async function executeRegistryCapability(
  plan: ActionPlan,
  context: ToolExecutorContext,
): Promise<ToolExecutionResult | null> {
  const definition = getCapabilityDefinition(plan.capability);
  if (!definition.resolve && !definition.execute) {
    return null;
  }

  const parsedInput = definition.inputSchema.safeParse(plan.args);
  if (!parsedInput.success) {
    return {
      status: 'needs_clarification',
      safeUserMessage: plan.userFacingQuestion || 'Ainda faltam dados para eu executar essa ação com segurança.',
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: !!context.confirmed,
        executor: 'tool-executor',
      },
      workingStatePatch: buildStatePatch(plan),
    };
  }

  const workingState = getWorkingState(context.session.context);
  const runtimeContext = buildCapabilityRuntimeContext(context, workingState);

  let resolvedInput = parsedInput.data as Record<string, unknown>;
  let resolvePatch: Partial<ConversationWorkingState> | undefined;
  let confirmationPreview = plan.userFacingQuestion;

  if (definition.resolve) {
    const resolveResult = await definition.resolve(runtimeContext, parsedInput.data as never) as CapabilityResolveResult<Record<string, unknown>>;
    if (resolveResult.status !== 'ready') {
      return {
        status: resolveResult.status === 'error' ? 'error' : 'needs_clarification',
        safeUserMessage: resolveResult.safeUserMessage,
        structuredResponse: resolveResult.structuredResponse,
        audit: {
          requestId: context.requestId,
          capability: plan.capability,
          tenantId: context.tenantId,
          confirmed: !!context.confirmed,
          executor: 'capability-resolve',
        },
        workingStatePatch: mergeStatePatch(plan, resolveResult.workingStatePatch),
      };
    }

    resolvedInput = resolveResult.input as Record<string, unknown>;
    resolvePatch = resolveResult.workingStatePatch;
    confirmationPreview = resolveResult.confirmationPreview || confirmationPreview;
  }

  const policy = runPolicyCheck({
    tenantId: context.tenantId,
    profileId: context.profileId,
    role: context.role,
    requestId: context.requestId,
    channel: context.channel,
    capability: plan.capability,
    args: resolvedInput,
    confirmed: context.confirmed,
    idempotencyKey: context.idempotencyKey,
  });

  if (!policy.allowed) {
    return {
      status: 'forbidden',
      safeUserMessage: 'Essa ação não está disponível para o seu perfil neste chat.',
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: !!context.confirmed,
        executor: 'policy-engine',
      },
      workingStatePatch: mergeStatePatch(plan, resolvePatch),
    };
  }

  if (policy.requiresConfirmation) {
    const confirmation = await createPendingConfirmation(
      context.session,
      plan.capability,
      resolvedInput,
      confirmationPreview || `Confirma a ação ${plan.capability}?`,
    );

    return {
      status: 'needs_confirmation',
      safeUserMessage: confirmation.safeUserMessage,
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: false,
        executor: 'confirmation-store',
      },
      workingStatePatch: mergeStatePatch(plan, resolvePatch, {
        pendingOperationInput: resolvedInput,
      }),
    };
  }

  if (context.confirmed && isReplayMutation(workingState, plan.capability, policy.idempotencyKey, context.confirmationId)) {
    const structuredResponse = {
      status: 'ok' as const,
      title: 'Essa ação já foi executada neste chat.',
      facts: [],
      safePreview: 'Essa ação já foi executada neste chat.',
    };
    return {
      status: 'ok',
      safeUserMessage: structuredResponse.title,
      structuredResponse,
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: true,
        executor: 'idempotency-guard',
      },
      workingStatePatch: mergeStatePatch(plan, resolvePatch),
    };
  }

  try {
    if (definition.authorize) {
      await definition.authorize(
        buildCapabilityRuntimeContext(context, getWorkingState(context.session.context)),
        resolvedInput as never,
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const blocked = reason === 'role_forbidden' || reason === 'missing_tenant' || reason === 'missing_profile';
    return {
      status: blocked ? 'forbidden' : 'error',
      safeUserMessage: blocked
        ? 'Essa ação não está disponível para o seu perfil neste chat.'
        : 'Não consegui validar essa ação agora.',
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: !!context.confirmed,
        executor: 'capability-authorize',
      },
      workingStatePatch: mergeStatePatch(plan, resolvePatch),
    };
  }

  if (!definition.execute) {
    return null;
  }

  const executionResult = await definition.execute(
    buildCapabilityRuntimeContext(context, getWorkingState(context.session.context)),
    resolvedInput as never,
  ) as CapabilityExecuteResult<unknown> | unknown;

  if (
    executionResult
    && typeof executionResult === 'object'
    && 'status' in executionResult
    && executionResult.status !== 'ok'
  ) {
    const controlledResult = executionResult as Extract<CapabilityExecuteResult<unknown>, { status: 'needs_clarification' | 'error' }>;
    return {
      status: controlledResult.status === 'error' ? 'error' : 'needs_clarification',
      safeUserMessage: controlledResult.safeUserMessage,
      structuredResponse: controlledResult.structuredResponse,
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: !!context.confirmed,
        executor: 'capability-execute',
      },
      workingStatePatch: mergeStatePatch(plan, resolvePatch, controlledResult.workingStatePatch),
    };
  }

  const controlledSuccess = (
    executionResult
    && typeof executionResult === 'object'
    && 'status' in executionResult
    && executionResult.status === 'ok'
  ) ? executionResult as Extract<CapabilityExecuteResult<unknown>, { status: 'ok' }> : null;

  const output = controlledSuccess ? controlledSuccess.output : executionResult;
  const structuredResponse = definition.formatResult
    ? definition.formatResult(output as never, buildCapabilityRuntimeContext(context, getWorkingState(context.session.context)), resolvedInput as never)
    : undefined;
  const successPatch = controlledSuccess?.workingStatePatch;

  return {
    status: 'ok',
    safeUserMessage: structuredResponse ? structuredResponseToText(structuredResponse) : 'Ação concluída.',
    structuredResponse,
    audit: {
      requestId: context.requestId,
      capability: plan.capability,
      tenantId: context.tenantId,
      confirmed: !!context.confirmed,
      executor: 'capability-runtime',
    },
    workingStatePatch: mergeStatePatch(plan, resolvePatch, successPatch, {
      pendingCapability: undefined,
      pendingMissingFields: [],
      missingSlots: [],
      lastMutation: definition.kind === 'mutation'
        ? {
            capability: plan.capability,
            idempotencyKey: policy.idempotencyKey,
            completedAt: new Date().toISOString(),
            confirmationId: context.confirmationId,
          }
        : undefined,
    }),
  };
}

export async function executeActionPlan(
  plan: ActionPlan,
  context: ToolExecutorContext,
  deps: ToolExecutorDeps,
): Promise<ToolExecutionResult> {
  const registryExecution = await executeRegistryCapability(plan, context);
  if (registryExecution) {
    return registryExecution;
  }

  const activeCompany = getActiveAdminCompany(context.session, context.role);
  const activeCompanyId = activeCompany?.id;
  const activeCompanyLabel = activeCompany?.label;
  const policy = runPolicyCheck({
    tenantId: context.tenantId,
    profileId: context.profileId,
    role: context.role,
    requestId: context.requestId,
    channel: context.channel,
    capability: plan.capability,
    args: plan.args,
    confirmed: context.confirmed,
  });

  if (!policy.allowed) {
    return {
      status: 'forbidden',
      safeUserMessage: 'Essa ação não está disponível para o seu perfil neste chat.',
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: !!context.confirmed,
        executor: 'policy-engine',
      },
    };
  }

  if (policy.requiresConfirmation) {
    const confirmation = await createPendingConfirmation(
      context.session,
      plan.capability,
      plan.args,
      'Vou desconectar este chat da sua conta no Juros Certo.'
    );

    return {
      status: 'needs_confirmation',
      safeUserMessage: confirmation.safeUserMessage,
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: false,
        executor: 'confirmation-store',
      },
      workingStatePatch: buildStatePatch(plan),
    };
  }

  if (plan.capability === 'smalltalk_identity') {
    return {
      status: 'ok',
      safeUserMessage: 'Sou o assistente operacional do Juros Certo. Posso consultar recebíveis, cobrança, clientes, contratos e pagamentos com segurança.',
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: false,
        executor: 'tool-executor',
      },
      workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
    };
  }

  if (plan.capability === 'smalltalk_datetime') {
    const dateText = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Fortaleza',
    }).format(new Date());

    return {
      status: 'ok',
      safeUserMessage: `Hoje é ${dateText}.`,
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: false,
        executor: 'tool-executor',
      },
      workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
    };
  }

  if (plan.capability === 'show_dashboard') {
    const summary = await getDashboardSummary(context.tenantId, activeCompanyId);
    return {
      status: 'ok',
      safeUserMessage: withActiveCompanyLabel(formatDashboard(summary), activeCompanyLabel),
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: false,
        executor: 'tool-executor',
      },
      workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
    };
  }

  if (plan.capability === 'list_receivables') {
    const filter = String(plan.args.filter || 'pending') as 'pending' | 'late' | 'week' | 'all';
    const installments = await getInstallments(context.tenantId, filter, activeCompanyId);
    return {
      status: 'ok',
      safeUserMessage: withActiveCompanyLabel(formatOpenInstallments(installments), activeCompanyLabel),
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: false,
        executor: 'tool-executor',
      },
      workingStatePatch: buildStatePatch(plan, {
        lastFilters: { filter },
        pendingCapability: undefined,
        pendingMissingFields: [],
      }),
    };
  }

  if (plan.capability === 'query_receivables_window') {
    const timeWindow = plan.args.time_window as ResolvedTimeWindow | undefined;
    if (!timeWindow) {
      return {
        status: 'needs_clarification',
        safeUserMessage: 'Me diga o período que você quer consultar. Ex.: hoje, amanhã, próximos 7 dias ou próximos 2 meses.',
        audit: {
          requestId: context.requestId,
          capability: plan.capability,
          tenantId: context.tenantId,
          confirmed: false,
          executor: 'tool-executor',
        },
      };
    }

    const installments = await getInstallmentsByDateRange(context.tenantId, timeWindow.startDate, timeWindow.endDate, activeCompanyId);
    return {
      status: 'ok',
      safeUserMessage: withActiveCompanyLabel(formatReceivablesWindow(timeWindow, installments), activeCompanyLabel),
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: false,
        executor: 'tool-executor',
      },
      workingStatePatch: buildStatePatch(plan, {
        lastFilters: {
          daysAhead: timeWindow.mode === 'relative_days' ? timeWindow.amount : undefined,
          monthsAhead: timeWindow.mode === 'relative_months' ? timeWindow.amount : undefined,
          windowStart: timeWindow.windowStart,
        },
        lastTimeWindow: timeWindow,
        pendingCapability: undefined,
        pendingMissingFields: [],
      }),
    };
  }

  if (plan.capability === 'query_collection_window' || plan.capability === 'list_collection_targets') {
    const timeWindow = plan.args.time_window as ResolvedTimeWindow | undefined;
    if (!timeWindow) {
      return {
        status: 'needs_clarification',
        safeUserMessage: 'Me diga o período de cobrança. Ex.: hoje, amanhã, próximos 7 dias ou próximos 2 meses.',
        audit: {
          requestId: context.requestId,
          capability: plan.capability,
          tenantId: context.tenantId,
          confirmed: false,
          executor: 'tool-executor',
        },
      };
    }

    const debtors = await getDebtorsToCollectByDateRange(context.tenantId, timeWindow.startDate, timeWindow.endDate, activeCompanyId);
    return {
      status: 'ok',
      safeUserMessage: withActiveCompanyLabel(formatCollectionWindow(timeWindow, debtors), activeCompanyLabel),
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: false,
        executor: 'tool-executor',
      },
      workingStatePatch: buildStatePatch(plan, {
        lastFilters: {
          daysAhead: timeWindow.mode === 'relative_days' ? timeWindow.amount : undefined,
          monthsAhead: timeWindow.mode === 'relative_months' ? timeWindow.amount : undefined,
          windowStart: timeWindow.windowStart,
        },
        lastTimeWindow: timeWindow,
        pendingCapability: undefined,
        pendingMissingFields: [],
      }),
    };
  }

  if (plan.capability === 'query_debtor_balance') {
    const debtorProfileId = String(plan.args.debtor_profile_id || '').trim();
    const debtorName = String(plan.args.debtor_name || '').trim();

    if (!debtorProfileId && !debtorName) {
      return {
        status: 'needs_clarification',
        safeUserMessage: 'Me diga o nome ou CPF do cliente que você quer consultar.',
        audit: {
          requestId: context.requestId,
          capability: plan.capability,
          tenantId: context.tenantId,
          confirmed: false,
          executor: 'tool-executor',
        },
      };
    }

    if (debtorProfileId) {
      const debtDetails = await getUserDebtDetails(context.tenantId, debtorProfileId);
      const displayName = debtorName || 'cliente';
      return {
        status: 'ok',
        safeUserMessage: formatDebtMessage(displayName, debtDetails),
        audit: {
          requestId: context.requestId,
          capability: plan.capability,
          tenantId: context.tenantId,
          confirmed: false,
          executor: 'tool-executor',
        },
        workingStatePatch: buildStatePatch(plan, {
          lastEntity: { type: 'debtor', id: debtorProfileId, label: displayName },
          pendingCapability: undefined,
          pendingMissingFields: [],
        }),
      };
    }

    const users = await searchUser(context.tenantId, debtorName);
    if (users.length === 0) {
      return {
        status: 'needs_clarification',
        safeUserMessage: `Não encontrei cliente com "${debtorName}". Se quiser, me mande o nome completo ou o CPF.`,
        audit: {
          requestId: context.requestId,
          capability: plan.capability,
          tenantId: context.tenantId,
          confirmed: false,
          executor: 'tool-executor',
        },
      };
    }

    const candidates = users.map(user => ({
      id: String(user.id),
      label: String(user.full_name || 'Desconhecido'),
      cpfMasked: user.cpf ? maskCpf(String(user.cpf)) : undefined,
      role: String(user.role || ''),
    }));

    if (candidates.length > 1) {
      return {
        status: 'needs_clarification',
        safeUserMessage: formatCandidateList(debtorName, candidates),
        audit: {
          requestId: context.requestId,
          capability: plan.capability,
          tenantId: context.tenantId,
          confirmed: false,
          executor: 'tool-executor',
        },
        workingStatePatch: buildStatePatch(plan, {
          candidateSets: { debtors: candidates },
          lastDebtorCandidates: candidates,
          pendingCapability: 'query_debtor_balance',
          pendingMissingFields: ['debtor_choice'],
          missingSlots: ['debtor_choice'],
        }),
      };
    }

    const selected = candidates[0];
    const debtDetails = await getUserDebtDetails(context.tenantId, selected.id);
    return {
      status: 'ok',
      safeUserMessage: formatDebtMessage(selected.label, debtDetails),
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: false,
        executor: 'tool-executor',
      },
      workingStatePatch: buildStatePatch(plan, {
        focusedEntity: { type: 'debtor', id: selected.id, label: selected.label },
        lastEntity: { type: 'debtor', id: selected.id, label: selected.label },
        candidateSets: { debtors: candidates },
        lastDebtorCandidates: candidates,
        pendingCapability: undefined,
        pendingMissingFields: [],
        missingSlots: [],
      }),
    };
  }

  if (plan.capability === 'view_my_installments' || plan.capability === 'view_my_debt_summary') {
    const debtDetails = await getUserDebtDetails(context.tenantId, context.profileId);

    if (plan.capability === 'view_my_installments') {
      const allPending = debtDetails.contracts.flatMap(c =>
        c.nextDueDate
          ? [{ name: c.assetName, amount: c.nextDueAmount, dueDate: c.nextDueDate, pending: c.pendingInstallments }]
          : []
      );

      let msg: string;
      if (allPending.length === 0) {
        msg = '✅ Você não possui parcelas pendentes no momento.';
      } else {
        const lines = allPending.map((item, i) => {
          const parcelasLabel = item.pending === 1 ? '1 parcela' : `${item.pending} parcelas`;
          return `${i + 1}. ${item.name} — próxima: *${formatCurrency(item.amount)}* em ${formatDate(item.dueDate)} (${parcelasLabel} em aberto)`;
        });
        msg = `📋 *Suas parcelas em aberto:*\n\n${lines.join('\n')}`;
      }

      return {
        status: 'ok',
        safeUserMessage: msg,
        audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
        workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
      };
    }

    // view_my_debt_summary
    let summaryMsg: string;
    if (debtDetails.totalDebt <= 0) {
      summaryMsg = '✅ Você não possui saldo devedor em aberto.';
    } else {
      const parcelasLabel = debtDetails.pendingInstallments === 1 ? 'parcela pendente' : 'parcelas pendentes';
      const contratosLabel = debtDetails.activeContracts === 1 ? 'contrato ativo' : 'contratos ativos';
      const nextLine = debtDetails.nextDueDate
        ? `\nPróximo vencimento: *${formatDate(debtDetails.nextDueDate)}* (${formatCurrency(debtDetails.nextDueAmount)})`
        : '';
      summaryMsg = `💰 Seu saldo devedor total: *${formatCurrency(debtDetails.totalDebt)}*\n${debtDetails.pendingInstallments} ${parcelasLabel} em ${debtDetails.activeContracts} ${contratosLabel}.${nextLine}`;
    }

    return {
      status: 'ok',
      safeUserMessage: summaryMsg,
      audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
      workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
    };
  }

  if (plan.capability === 'view_my_portfolio') {
    const portfolio = await getInvestorPortfolio(context.tenantId, context.profileId);

    let portfolioMsg: string;
    if (portfolio.totalContracts === 0) {
      portfolioMsg = 'Você ainda não possui contratos ativos como investidor.';
    } else {
      const lines = portfolio.contracts.slice(0, 8).map((c, i) => {
        const nextLine = c.nextDueDate ? ` — próximo: ${formatCurrency(c.nextDueAmount)} em ${formatDate(c.nextDueDate)}` : '';
        return `${i + 1}. ${c.assetName} — a receber: *${formatCurrency(c.openBalance)}*${nextLine}`;
      });
      portfolioMsg = `📈 *Seu portfólio:*\n\n${lines.join('\n')}\n\n💰 Total a receber: *${formatCurrency(portfolio.totalReceivable)}*\n✅ Total recebido: *${formatCurrency(portfolio.totalReceived)}*`;
    }

    return {
      status: 'ok',
      safeUserMessage: portfolioMsg,
      audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
      workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
    };
  }

  if (plan.capability === 'preview_lembrete') {
    const profile = await getProfileById(context.profileId);
    if (!profile) {
      return {
        status: 'error',
        safeUserMessage: 'Não consegui carregar seu perfil para montar o exemplo.',
        audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
      };
    }
    const preview = await buildBriefingMessage(profile, context.tenantId);
    const config = await getBotTenantConfig(context.tenantId);
    const horario = config?.morning_briefing_enabled ? ` (ativo às *${config.morning_briefing_time}*)` : ' *(lembrete desativado)*';
    return {
      status: 'ok',
      safeUserMessage: `📬 *Exemplo de como o lembrete vai chegar${horario}:*\n\n${preview}`,
      audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
      workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
    };
  }

  if (plan.capability === 'configure_briefing') {
    const briefingEnabled = plan.args.briefing_enabled as boolean ?? true;
    const briefingTime = plan.args.briefing_time as string | undefined;

    // Desativar briefing
    if (briefingEnabled === false) {
      await upsertBotTenantConfig(context.tenantId, { morning_briefing_enabled: false });
      return {
        status: 'ok',
        safeUserMessage: '🔕 Lembrete matinal desativado. Você não receberá mais o resumo diário.',
        audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
        workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
      };
    }

    // Precisa do horário
    if (!briefingTime || plan.missingFields.includes('briefing_time')) {
      const current = await getBotTenantConfig(context.tenantId);
      const statusLine = current?.morning_briefing_enabled
        ? `Atualmente ativo para *${current.morning_briefing_time}*.`
        : 'Atualmente desativado.';
      return {
        status: 'needs_clarification',
        safeUserMessage: `⏰ Que horas você quer receber o lembrete diário? (ex: *08:00*)\n\n${statusLine}`,
        audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
        workingStatePatch: buildStatePatch(plan, { pendingMissingFields: ['briefing_time'] }),
      };
    }

    // Validar formato HH:MM
    const timeMatch = briefingTime.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      return {
        status: 'needs_clarification',
        safeUserMessage: `❌ Horário inválido. Use o formato *HH:MM*, por exemplo: *08:00* ou *07:30*.`,
        audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
        workingStatePatch: buildStatePatch(plan, { pendingMissingFields: ['briefing_time'] }),
      };
    }

    const h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      return {
        status: 'needs_clarification',
        safeUserMessage: `❌ Horário inválido. Use o formato *HH:MM*, por exemplo: *08:00* ou *07:30*.`,
        audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
        workingStatePatch: buildStatePatch(plan, { pendingMissingFields: ['briefing_time'] }),
      };
    }

    const normalizedTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    await upsertBotTenantConfig(context.tenantId, {
      morning_briefing_enabled: true,
      morning_briefing_time: normalizedTime,
      morning_briefing_targets: ['admin'],
    });

    return {
      status: 'ok',
      safeUserMessage: `✅ Lembrete matinal ativado! Todo dia às *${normalizedTime}* você receberá um resumo com recebíveis e cobranças do dia.`,
      audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
      workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
    };
  }

  if (plan.capability === 'set_eod_alert_hour') {
    const enabled = plan.args.enabled as boolean | undefined;
    const time = plan.args.time as string | undefined;

    if (enabled === false) {
      await upsertBotTenantConfig(context.tenantId, { eod_alert_enabled: false });
      return {
        status: 'ok',
        safeUserMessage: '🔕 Aviso de fim de dia desativado.',
        audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
        workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
      };
    }

    if (!time || plan.missingFields.includes('time')) {
      const current = await getBotTenantConfig(context.tenantId);
      const statusLine = current?.eod_alert_enabled
        ? `Atualmente ativo para *${current.eod_alert_time}*.`
        : 'Atualmente desativado.';
      return {
        status: 'needs_clarification',
        safeUserMessage: `⏰ Que horas eu te aviso sobre cobranças do dia sem baixa? (ex: *17:00*)\n\n${statusLine}`,
        audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
        workingStatePatch: buildStatePatch(plan, { pendingMissingFields: ['time'] }),
      };
    }

    const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      return {
        status: 'needs_clarification',
        safeUserMessage: `❌ Horário inválido. Use o formato *HH:MM*, por exemplo: *17:00*.`,
        audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
        workingStatePatch: buildStatePatch(plan, { pendingMissingFields: ['time'] }),
      };
    }
    const h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      return {
        status: 'needs_clarification',
        safeUserMessage: `❌ Horário inválido. Use o formato *HH:MM*, por exemplo: *17:00*.`,
        audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
        workingStatePatch: buildStatePatch(plan, { pendingMissingFields: ['time'] }),
      };
    }
    const normalizedTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    await upsertBotTenantConfig(context.tenantId, {
      eod_alert_enabled: true,
      eod_alert_time: normalizedTime,
    });

    return {
      status: 'ok',
      safeUserMessage: `✅ Aviso de fim de dia ativado! Todo dia às *${normalizedTime}* eu te lembro das cobranças que ainda não tiveram baixa.`,
      audit: { requestId: context.requestId, capability: plan.capability, tenantId: context.tenantId, confirmed: false, executor: 'tool-executor' },
      workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
    };
  }

  if (plan.capability === 'help') {
    const safeUserMessage = 'Posso te ajudar com dashboard, recebíveis, cobranças do dia e por período, busca de cliente, criação de contrato, baixa de pagamento, relatório, convite e desconexão do bot.';
    return {
      status: 'ok',
      safeUserMessage,
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: false,
        executor: 'tool-executor',
      },
      workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [], missingSlots: [] }),
    };
  }

  const legacyIntent = getCapabilityDefinition(plan.capability).legacyIntent;
  if (!legacyIntent) {
    return {
      status: 'error',
      safeUserMessage: 'Não consegui encaminhar essa ação agora.',
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: !!context.confirmed,
        executor: 'tool-executor',
      },
    };
  }

  const safeUserMessage = await deps.executeLegacyIntent(legacyIntent, plan.args);
  return {
    status: 'ok',
    safeUserMessage,
    audit: {
      requestId: context.requestId,
      capability: plan.capability,
      tenantId: context.tenantId,
      confirmed: !!context.confirmed,
      executor: 'legacy-dispatch',
    },
    workingStatePatch: buildStatePatch(plan, {
      lastContractId: Number(plan.args.contract_id || 0) || undefined,
    }),
  };
}
