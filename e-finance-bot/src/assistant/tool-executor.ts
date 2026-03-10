import {
  formatCurrency,
  formatDate,
  getDashboardSummary,
  getDebtorsToCollectByDateRange,
  getInstallments,
  getInstallmentsByDateRange,
  getInvestorPortfolio,
  getUserDebtDetails,
  searchUser,
} from '../actions/admin-actions';
import { getCapabilityDefinition } from './capability-registry';
import { createPendingConfirmation } from './confirmation-store';
import { runPolicyCheck } from './policy-engine';
import type {
  ActionPlan,
  ConversationWorkingState,
  ResolvedTimeWindow,
  ToolExecutionResult,
} from './contracts';
import type { Session } from '../session/session-manager';

interface ToolExecutorContext {
  session: Session;
  tenantId: string;
  profileId: string;
  role: string;
  requestId: string;
  channel: 'telegram' | 'whatsapp';
  confirmed?: boolean;
}

interface ToolExecutorDeps {
  executeLegacyIntent: (legacyIntent: string, args: Record<string, unknown>) => Promise<string>;
}

function formatDashboard(summary: Awaited<ReturnType<typeof getDashboardSummary>>): string {
  const receivedByPaymentMonth = summary.receivedByPaymentMonth ?? summary.receivedMonth;
  const receivedByDueMonth = summary.receivedByDueMonth ?? summary.receivedMonth;

  return `📊 *Dashboard — ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}*

💰 Recebido (pagamento no mês): *${formatCurrency(receivedByPaymentMonth)}*
🗓️ Recebido (vencimento no mês): *${formatCurrency(receivedByDueMonth)}*
📅 Esperado no mês: *${formatCurrency(summary.expectedMonth)}*
⚠️ Em atraso: *${formatCurrency(summary.totalOverdue)}*

📋 Contratos ativos: *${summary.activeContracts}*
🔴 Com atraso: *${summary.overdueContracts}*`;
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
    lastAction: plan.capability,
    pendingCapability: plan.capability,
    pendingMissingFields: plan.missingFields,
    ...extra,
  };
}

export async function executeActionPlan(
  plan: ActionPlan,
  context: ToolExecutorContext,
  deps: ToolExecutorDeps,
): Promise<ToolExecutionResult> {
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
    const summary = await getDashboardSummary(context.tenantId);
    return {
      status: 'ok',
      safeUserMessage: formatDashboard(summary),
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
    const installments = await getInstallments(context.tenantId, filter);
    return {
      status: 'ok',
      safeUserMessage: formatOpenInstallments(installments),
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

    const installments = await getInstallmentsByDateRange(context.tenantId, timeWindow.startDate, timeWindow.endDate);
    return {
      status: 'ok',
      safeUserMessage: formatReceivablesWindow(timeWindow, installments),
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

    const debtors = await getDebtorsToCollectByDateRange(context.tenantId, timeWindow.startDate, timeWindow.endDate);
    return {
      status: 'ok',
      safeUserMessage: formatCollectionWindow(timeWindow, debtors),
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
          lastDebtorCandidates: candidates,
          pendingCapability: 'query_debtor_balance',
          pendingMissingFields: ['debtor_choice'],
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
        lastEntity: { type: 'debtor', id: selected.id, label: selected.label },
        lastDebtorCandidates: candidates,
        pendingCapability: undefined,
        pendingMissingFields: [],
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

  if (plan.capability === 'help') {
    const reply = await deps.executeLegacyIntent(getCapabilityDefinition('help').legacyIntent!, {});
    return {
      status: 'ok',
      safeUserMessage: reply,
      audit: {
        requestId: context.requestId,
        capability: plan.capability,
        tenantId: context.tenantId,
        confirmed: false,
        executor: 'legacy-dispatch',
      },
      workingStatePatch: buildStatePatch(plan, { pendingCapability: undefined, pendingMissingFields: [] }),
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
