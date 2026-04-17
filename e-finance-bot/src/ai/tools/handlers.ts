/**
 * Handlers concretos das tools (AI-S5) — wrappers sobre admin-actions.ts.
 *
 * Cada handler:
 *  - recebe input Zod-parsed + ToolContext (tenantId, role, userId)
 *  - chama a função de admin-actions/querying equivalente
 *  - retorna ToolOutcome com `summary` (para o LLM parafrasear) e `data` (truncada pelo serializeOutcome)
 *
 * Mutações permanecem stubs (notWired) até AI-S6 — envolvem confirmation-store
 * e idempotency key; fluxo não-trivial.
 */

import type { ToolHandler, ToolOutcome } from './types';
import {
  getDashboardSummary,
  getInstallments,
  getDebtorsToCollectInWindow,
  getDebtorsToCollectByDateRange,
  generateMonthlyReport,
  searchUser,
  getUserDebtDetails,
  getUserDebt,
  getInvestorPortfolio,
  generateInvite,
} from '../../actions/admin-actions';
import { logStructuredMessage } from '../../observability/logger';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (n: number) => BRL.format(Number(n) || 0);

function notWired(name: string): ToolOutcome {
  return {
    kind: 'error',
    message: `Tool ${name} ainda não foi conectada ao handler.`,
    retryable: false,
  };
}

// ─── Queries: Admin ──────────────────────────────────────────────────────────

export const showDashboardHandler: ToolHandler = async (_input, ctx) => {
  const summary = await getDashboardSummary(ctx.tenantId, ctx.companyId ?? undefined);
  return {
    kind: 'data',
    summary: `Dashboard: ${summary.activeContracts} contratos ativos, ${fmt(summary.totalOverdue)} em atraso, ${fmt(summary.expectedMonth)} previstos no mês e ${fmt(summary.receivedMonth)} já recebidos.`,
    data: summary,
  };
};

export const listReceivablesHandler: ToolHandler<{ filter?: 'pending' | 'late' | 'week' | 'all' }> = async (input, ctx) => {
  const filter = input.filter ?? 'pending';
  const items = await getInstallments(ctx.tenantId, filter, ctx.companyId ?? undefined);
  if (items.length === 0) {
    return { kind: 'text', text: 'Nenhuma parcela encontrada para esse filtro.' };
  }
  const total = items.reduce((a, i) => a + i.amount, 0);
  return {
    kind: 'data',
    summary: `${items.length} parcelas (${fmt(total)}). Filtro: ${filter}.`,
    data: items.map(i => ({
      debtor: i.debtorName,
      amount: i.amount,
      due_date: i.dueDate,
      status: i.status,
      days_late: i.daysLate,
    })),
  };
};

interface WindowInput {
  window: 'today' | 'tomorrow' | 'this_week' | 'this_month' | 'next_n_days';
  n_days?: number;
}

function resolveWindow(input: WindowInput): { daysAhead: number; windowStart: 'today' | 'tomorrow' } {
  switch (input.window) {
    case 'today':
      return { daysAhead: 1, windowStart: 'today' };
    case 'tomorrow':
      return { daysAhead: 1, windowStart: 'tomorrow' };
    case 'this_week':
      return { daysAhead: 7, windowStart: 'today' };
    case 'this_month':
      return { daysAhead: 30, windowStart: 'today' };
    case 'next_n_days':
      return { daysAhead: Math.max(1, Math.min(60, input.n_days ?? 7)), windowStart: 'today' };
  }
}

export const listCollectionTargetsHandler: ToolHandler<WindowInput> = async (input, ctx) => {
  const { daysAhead, windowStart } = resolveWindow(input);
  const items = await getDebtorsToCollectInWindow(ctx.tenantId, daysAhead, windowStart, ctx.companyId ?? undefined);
  if (items.length === 0) {
    return { kind: 'text', text: 'Ninguém para cobrar nessa janela.' };
  }
  const total = items.reduce((a, d) => a + d.totalDue, 0);
  return {
    kind: 'data',
    summary: `${items.length} devedores a cobrar, total ${fmt(total)} na janela ${input.window}.`,
    data: items.map(d => ({
      name: d.name,
      total_due: d.totalDue,
      installment_count: d.installmentCount,
      oldest_due: d.oldestDueDate,
      days_late: d.daysLate,
    })),
  };
};

export const queryReceivablesWindowHandler: ToolHandler<WindowInput> = async (input, ctx) => {
  // Recebíveis totais = coletas previstas no intervalo
  const { daysAhead, windowStart } = resolveWindow(input);
  const items = await getDebtorsToCollectInWindow(ctx.tenantId, daysAhead, windowStart, ctx.companyId ?? undefined);
  const total = items.reduce((a, d) => a + d.totalDue, 0);
  const count = items.reduce((a, d) => a + d.installmentCount, 0);
  return {
    kind: 'data',
    summary: `Previsto receber ${fmt(total)} (${count} parcelas de ${items.length} devedores) na janela ${input.window}.`,
    data: { total_amount: total, installment_count: count, debtor_count: items.length },
  };
};

export const queryCollectionWindowHandler: ToolHandler<WindowInput> = queryReceivablesWindowHandler;

export const queryDebtorBalanceHandler: ToolHandler<{ debtor_name?: string; debtor_profile_id?: string }> = async (input, ctx) => {
  let profileId = input.debtor_profile_id;
  let displayName = '';

  if (!profileId && input.debtor_name) {
    const results = await searchUser(ctx.tenantId, input.debtor_name.trim());
    if (!results || results.length === 0) {
      return { kind: 'text', text: `Não encontrei ninguém com o nome "${input.debtor_name}".` };
    }
    if (results.length > 1) {
      return {
        kind: 'data',
        summary: `Encontrei ${results.length} pessoas. Preciso que você escolha.`,
        data: results.map(r => ({ profile_id: r.id, name: r.full_name, role: r.role })),
      };
    }
    profileId = results[0].id;
    displayName = results[0].full_name;
  }

  if (!profileId) {
    return { kind: 'error', message: 'debtor_name ou debtor_profile_id obrigatório.', retryable: false };
  }

  const details = await getUserDebtDetails(ctx.tenantId, profileId);
  const totalDebt = await getUserDebt(ctx.tenantId, profileId);
  return {
    kind: 'data',
    summary: `${displayName || 'Devedor'} deve ${fmt(totalDebt)} no total (${details.activeContracts} contratos, ${details.pendingInstallments} parcelas pendentes).`,
    data: { profile_id: profileId, total_debt: totalDebt, details },
  };
};

export const generateReportHandler: ToolHandler = async (_input, ctx) => {
  const report = await generateMonthlyReport(ctx.tenantId, ctx.companyId ?? undefined);
  const d = report.dashboard;
  return {
    kind: 'data',
    summary: `Relatório: ${d.activeContracts} contratos, ${fmt(d.receivedMonth)} recebido no mês, ${fmt(d.totalOverdue)} em atraso, ${report.overdueDebtors.length} devedores atrasados, top devedor: ${report.topDebtors[0]?.name ?? '—'}.`,
    data: {
      dashboard: d,
      overdue_debtors: report.overdueDebtors.slice(0, 5).map(x => ({ name: x.name, total_due: x.totalDue, days_late: x.daysLate })),
      top_debtors: report.topDebtors.map(x => ({ name: x.name, total_debt: x.totalDebt })),
    },
  };
};

export const generateInviteHandler: ToolHandler = async (_input, ctx) => {
  const code = await generateInvite(ctx.tenantId);
  if (!code) {
    return { kind: 'error', message: 'Não consegui gerar convite agora.', retryable: true };
  }
  return {
    kind: 'mutation_applied',
    summary: `Convite gerado: código *${code}*. Válido para um único uso.`,
    data: { invite_code: code },
  };
};

// ─── Queries: Debtor ────────────────────────────────────────────────────────

export const viewMyInstallmentsHandler: ToolHandler = async (_input, ctx) => {
  const profileId = ctx.session.profile?.id;
  if (!profileId) {
    return { kind: 'error', message: 'Perfil não encontrado.', retryable: false };
  }
  const details = await getUserDebtDetails(ctx.tenantId, profileId);
  if (details.pendingInstallments === 0) {
    return { kind: 'text', text: 'Você não tem parcelas pendentes. 🎉' };
  }
  return {
    kind: 'data',
    summary: `Você tem ${details.pendingInstallments} parcelas pendentes, próxima em ${details.nextDueDate ?? '—'} (${fmt(details.nextDueAmount)}).`,
    data: details,
  };
};

export const viewMyDebtSummaryHandler: ToolHandler = async (_input, ctx) => {
  const profileId = ctx.session.profile?.id;
  if (!profileId) {
    return { kind: 'error', message: 'Perfil não encontrado.', retryable: false };
  }
  const totalDebt = await getUserDebt(ctx.tenantId, profileId);
  return {
    kind: 'data',
    summary: `Seu saldo devedor total é ${fmt(totalDebt)}.`,
    data: { total_debt: totalDebt },
  };
};

// ─── Queries: Investor ──────────────────────────────────────────────────────

export const viewMyPortfolioHandler: ToolHandler = async (_input, ctx) => {
  const profileId = ctx.session.profile?.id;
  if (!profileId) {
    return { kind: 'error', message: 'Perfil não encontrado.', retryable: false };
  }
  const portfolio = await getInvestorPortfolio(ctx.tenantId, profileId);
  return {
    kind: 'data',
    summary: `Portfólio: ${portfolio.totalContracts} contratos, a receber ${fmt(portfolio.totalReceivable)}, já recebido ${fmt(portfolio.totalReceived)}. Próximo vencimento ${portfolio.nextDueDate ?? '—'} (${fmt(portfolio.nextDueAmount)}).`,
    data: portfolio,
  };
};

// ─── Utilities ───────────────────────────────────────────────────────────────

export const greetHandler: ToolHandler = async (_input, ctx) => {
  const hour = ctx.now.getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const firstName = ctx.session.profile?.name?.split(/\s+/)[0];
  return {
    kind: 'text',
    text: firstName ? `${greet}, ${firstName}! Como posso ajudar?` : `${greet}! Como posso ajudar?`,
  };
};

export const helpHandler: ToolHandler = async (_input, ctx) => {
  const role = ctx.role;
  const list = role === 'admin'
    ? [
        'Dashboard e resumos',
        'Recebíveis e cobranças',
        'Saldo devedor por pessoa',
        'Criar contrato / marcar parcela paga',
        'Relatório do mês',
        'Gerar convite',
      ]
    : role === 'investor'
      ? ['Ver seu portfólio', 'Desconectar']
      : ['Ver suas parcelas', 'Ver saldo devedor', 'Desconectar'];
  return { kind: 'text', text: `Posso te ajudar com:\n• ${list.join('\n• ')}\n\nMe pergunta em português natural.` };
};

export const smalltalkIdentityHandler: ToolHandler = async () => {
  // Fallback raramente chamado — LLM normalmente responde direto usando a persona no system prompt
  return { kind: 'text', text: 'Sou o assistente desta empresa. Posso te ajudar com seus dados financeiros.' };
};

export const smalltalkDatetimeHandler: ToolHandler = async (_input, ctx) => {
  const fmtDate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short' });
  return { kind: 'text', text: `Agora é ${fmtDate.format(ctx.now)}.` };
};

// ─── Mutations — ainda stubs (AI-S6) ────────────────────────────────────────
// create_contract, mark_installment_paid, disconnect_bot, configure_briefing,
// preview_lembrete ficam como notWired até termos confirmation-store integrado.

export const createContractHandler: ToolHandler = async () => notWired('create_contract');
export const markInstallmentPaidHandler: ToolHandler = async () => notWired('mark_installment_paid');
export const disconnectBotHandler: ToolHandler = async () => notWired('disconnect_bot');
export const configureBriefingHandler: ToolHandler = async () => notWired('configure_briefing');
export const previewLembreteHandler: ToolHandler = async () => notWired('preview_lembrete');

// Silencia unused imports (helpers existem para wiring futuro)
void getDebtorsToCollectByDateRange;
void logStructuredMessage;
