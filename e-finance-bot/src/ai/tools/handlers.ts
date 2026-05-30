/**
 * Handlers concretos das tools (AI-S5/S6) — wrappers sobre admin-actions.ts.
 *
 * Cada handler:
 *  - recebe input Zod-parsed + ToolContext (tenantId, role, userId)
 *  - chama a função de admin-actions/querying equivalente
 *  - retorna ToolOutcome com `summary` (para o LLM parafrasear) e `data` (truncada pelo serializeOutcome)
 *
 * Mutações (S6): retornam `kind: 'preview'` com confirmation já registrada
 * via confirmation-store. A próxima mensagem do usuário ("sim"/"não") é
 * resolvida pelo pipeline legado em message-handler.ts (pendingConfirmation).
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
  getProfileById,
  getContractOpenInstallments,
  getContractOpenInstallmentByNumber,
  getContractOpenInstallmentByMonth,
  getInstallmentByDebtorAndMonth,
  getInstallmentBulletInfo,
  searchDebtorsByName,
  isValidCpf,
  normalizeCpf,
  formatDate,
  type ContractOpenInstallment,
  type ContractDraft,
} from '../../actions/admin-actions';
import { formatContractConfirmationMessage } from '../../tools/formatters';
import { createPendingConfirmation } from '../../assistant/confirmation-store';
import { getBotTenantConfig, upsertBotTenantConfig } from '../../actions/bot-config-actions';
import { buildBriefingMessage } from '../../scheduler/morning-briefing';
import { logStructuredMessage } from '../../observability/logger';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (n: number) => BRL.format(Number(n) || 0);

/** Formata YYYY-MM-DD em DD/MM/YYYY para exibição. */
function fmtDateBR(iso?: string | null): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
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

  // P4: validar que o profileId pertence ao tenant atual (defesa em profundidade,
  // RLS Supabase já protege, mas evita confusão se o LLM chutar um UUID).
  if (input.debtor_profile_id) {
    const profile = await getProfileById(profileId);
    if (!profile || profile.tenant_id !== ctx.tenantId) {
      logStructuredMessage('ai_tool_cross_tenant_access_blocked', {
        tool: 'query_debtor_balance',
        tenantId: ctx.tenantId,
        profileId,
        turnId: ctx.turnId,
      });
      return { kind: 'text', text: 'Não encontrei esse devedor.' };
    }
    displayName = profile.full_name;
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

// ─── Mutations (AI-S6) ──────────────────────────────────────────────────────
// Devolvem `kind: 'preview'` com confirmation já registrada. A confirmação real
// ("sim"/"não") é resolvida pelo pipeline legado em message-handler.ts:1469.

const ASSISTENT_PERSONA = 'assistente';

export const disconnectBotHandler: ToolHandler = async (_input, ctx) => {
  if (!ctx.session.profile?.id) {
    return { kind: 'error', message: 'Perfil não encontrado.', retryable: false };
  }

  const safePreview = [
    '*Desconectar este chat*',
    '',
    'Você perde acesso pelo bot até gerar um novo código no dashboard web.',
    '',
    'Confirma com *sim* ou cancele com *não*.',
  ].join('\n');
  const argsSnapshot = { capability: 'disconnect_bot' };

  const { confirmationId, idempotencyKey, safeUserMessage } = await createPendingConfirmation(
    ctx.session,
    'disconnect_bot',
    argsSnapshot,
    safePreview,
  );

  return {
    kind: 'preview',
    preview: safeUserMessage,
    confirmationId,
    idempotencyKey,
    argsSnapshot,
  };
};

interface ConfigureBriefingInput {
  briefing_time?: string;
  briefing_enabled?: boolean;
}

function isValidBriefingTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time.trim());
}

export const configureBriefingHandler: ToolHandler<ConfigureBriefingInput> = async (input, ctx) => {
  if (input.briefing_enabled === false) {
    try {
      await upsertBotTenantConfig(ctx.tenantId, { morning_briefing_enabled: false });
      return {
        kind: 'mutation_applied',
        summary: '*Briefing matinal desativado.*\n\nVocê não vai mais receber o resumo automático todo dia. Para reativar, é só me pedir.',
      };
    } catch (err) {
      logStructuredMessage('configure_briefing_failed', {
        tenantId: ctx.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { kind: 'error', message: 'Não consegui salvar a configuração agora.', retryable: true };
    }
  }

  const time = (input.briefing_time || '').trim();
  if (!time || !isValidBriefingTime(time)) {
    return {
      kind: 'error',
      message: 'Horário inválido. Use formato HH:MM (24h), por exemplo 07:30.',
      retryable: false,
    };
  }

  try {
    await upsertBotTenantConfig(ctx.tenantId, {
      morning_briefing_enabled: true,
      morning_briefing_time: time,
    });
    return {
      kind: 'mutation_applied',
      summary: `*Briefing matinal ativado*\n\nTodo dia às *${time}* (horário de Brasília) eu te mando o resumo das cobranças. Para ver um exemplo agora, peça *"como fica o lembrete"*.`,
    };
  } catch (err) {
    logStructuredMessage('configure_briefing_failed', {
      tenantId: ctx.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'error', message: 'Não consegui salvar a configuração agora.', retryable: true };
  }
};

interface SetEodAlertHourInput {
  time?: string;
  enabled?: boolean;
}

export const setEodAlertHourHandler: ToolHandler<SetEodAlertHourInput> = async (input, ctx) => {
  if (input.enabled === false) {
    try {
      await upsertBotTenantConfig(ctx.tenantId, { eod_alert_enabled: false });
      return {
        kind: 'mutation_applied',
        summary: '*Aviso de fim de dia desativado.*\n\nVocê não vai mais receber o lembrete sobre cobranças do dia sem baixa. Para reativar, é só me pedir.',
      };
    } catch (err) {
      logStructuredMessage('set_eod_alert_hour_failed', {
        tenantId: ctx.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { kind: 'error', message: 'Não consegui salvar a configuração agora.', retryable: true };
    }
  }

  const time = (input.time || '').trim();
  if (!time || !isValidBriefingTime(time)) {
    return {
      kind: 'error',
      message: 'Horário inválido. Use formato HH:MM (24h), por exemplo 17:00.',
      retryable: false,
    };
  }

  try {
    await upsertBotTenantConfig(ctx.tenantId, {
      eod_alert_enabled: true,
      eod_alert_time: time,
    });
    return {
      kind: 'mutation_applied',
      summary: `*Aviso de fim de dia ativado*\n\nTodo dia às *${time}* (horário de Brasília) eu te aviso sobre cobranças do dia que ainda não tiveram baixa, antes de virar atraso.`,
    };
  } catch (err) {
    logStructuredMessage('set_eod_alert_hour_failed', {
      tenantId: ctx.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'error', message: 'Não consegui salvar a configuração agora.', retryable: true };
  }
};

export const previewLembreteHandler: ToolHandler = async (_input, ctx) => {
  const profile = ctx.session.profile;
  if (!profile?.id) {
    return { kind: 'error', message: 'Perfil não encontrado.', retryable: false };
  }

  try {
    const message = await buildBriefingMessage(
      {
        id: profile.id,
        full_name: profile.name,
        whatsapp_phone: null,
        telegram_chat_id: null,
      },
      ctx.tenantId,
    );
    const config = await getBotTenantConfig(ctx.tenantId);
    const horario = config?.morning_briefing_time || '07:30';
    const status = config?.morning_briefing_enabled ? 'ativo' : 'desativado';

    return {
      kind: 'data',
      summary: `Exemplo do lembrete matinal (horário ${horario}, ${status}).`,
      data: { sample_message: message, briefing_time: horario, enabled: status === 'ativo' },
    };
  } catch (err) {
    logStructuredMessage('preview_lembrete_failed', {
      tenantId: ctx.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'error', message: 'Não consegui montar o exemplo agora.', retryable: true };
  }
};

interface CreateContractInput {
  debtor_name?: string;
  debtor_cpf?: string;
  amount?: number;
  rate?: number;
  installments?: number;
  frequency?: 'monthly' | 'weekly' | 'biweekly';
  due_day?: number;
  start_date?: string;
  total_repayment?: number;
  calculation_mode?: 'standard' | 'interest_only';
}

const FREQUENCY_LABEL: Record<string, string> = {
  monthly: 'mensais',
  weekly: 'semanais',
  biweekly: 'quinzenais',
};

export const createContractHandler: ToolHandler<CreateContractInput> = async (input, ctx) => {
  const cpfRaw = (input.debtor_cpf || '').replace(/\D/g, '');
  const cpfNormalized = normalizeCpf(cpfRaw);
  if (!cpfNormalized || !isValidCpf(cpfNormalized)) {
    return {
      kind: 'error',
      message: 'Para criar contrato preciso do CPF válido do devedor (11 dígitos).',
      retryable: false,
    };
  }

  if (!input.amount || input.amount <= 0) {
    return {
      kind: 'error',
      message: 'Preciso do valor principal do empréstimo (em reais, maior que zero).',
      retryable: false,
    };
  }

  // Não inventar: precisa de OU taxa explícita OU total_repayment para back-calc.
  // Sem nenhum dos dois, perguntar antes de criar (BR-BOT: não inventar dados financeiros).
  const hasRate = typeof input.rate === 'number' && input.rate >= 0;
  const hasTotalRepayment = typeof input.total_repayment === 'number' && input.total_repayment > 0;
  if (!hasRate && !hasTotalRepayment) {
    return {
      kind: 'error',
      message: 'Falta a taxa de juros (em % por período) OU o valor total a ser pago. Sem isso eu não posso criar o contrato.',
      retryable: false,
    };
  }

  const installmentsRaw = input.installments && input.installments > 0 ? input.installments : 1;

  // Back-calcular taxa quando temos total_repayment
  let rate: number;
  if (hasRate) {
    rate = input.rate as number;
  } else {
    // total = principal * (1 + rate * n) → rate = (total/principal - 1) / n
    const total = input.total_repayment as number;
    const principal = input.amount;
    const n = installmentsRaw;
    rate = ((total / principal) - 1) / n * 100;
    if (!Number.isFinite(rate) || rate < 0) {
      return {
        kind: 'error',
        message: 'O valor total a pagar parece inconsistente com o principal e número de parcelas. Confirma os números?',
        retryable: false,
      };
    }
    rate = Math.round(rate * 100) / 100;
  }

  // BOT-008: bullet (juros simples) — preview bullet-aware e argsSnapshot com
  // calculation_mode. A execução confirmada reusa o capability executor (BOT-005).
  if (input.calculation_mode === 'interest_only') {
    const debtorName = (input.debtor_name || 'devedor').trim();
    const draft: ContractDraft = {
      debtor_name: debtorName,
      debtor_cpf: cpfNormalized,
      amount: input.amount,
      rate,
      installments: 1,
      frequency: input.frequency || 'monthly',
      due_day: input.due_day,
      start_date: input.start_date,
      calculation_mode: 'interest_only',
    };
    const safePreview = formatContractConfirmationMessage(draft);
    const argsSnapshot: Record<string, unknown> = {
      debtor_name: debtorName,
      debtor_cpf: cpfNormalized,
      amount: input.amount,
      rate,
      frequency: draft.frequency,
      ...(input.due_day !== undefined ? { due_day: input.due_day } : {}),
      ...(input.start_date ? { start_date: input.start_date } : {}),
      calculation_mode: 'interest_only',
    };
    const { confirmationId, idempotencyKey, safeUserMessage } = await createPendingConfirmation(
      ctx.session,
      'create_contract',
      argsSnapshot,
      safePreview,
    );
    return { kind: 'preview', preview: safeUserMessage, confirmationId, idempotencyKey, argsSnapshot };
  }

  const installments = installmentsRaw;
  const frequency = input.frequency || 'monthly';
  const debtorName = (input.debtor_name || 'devedor').trim();

  const cpfMasked = `***.***.***-${cpfNormalized.slice(-2)}`;
  const installmentValue = hasTotalRepayment
    ? (input.total_repayment as number) / installments
    : (input.amount * (1 + rate / 100 * installments)) / installments;
  const totalToPay = hasTotalRepayment
    ? (input.total_repayment as number)
    : installmentValue * installments;

  const periodLabel = {
    monthly: { adj: 'mensais', short: 'a.m.' },
    weekly: { adj: 'semanais', short: 'a.s.' },
    biweekly: { adj: 'quinzenais', short: 'a.q.' },
    daily: { adj: 'diárias', short: 'a.d.' },
  }[frequency] || { adj: 'mensais', short: 'a.m.' };

  const periodicidade = frequency === 'monthly' && input.due_day
    ? `*${installments}×* de *${fmt(installmentValue)}* ${periodLabel.adj}, todo dia *${input.due_day}*`
    : `*${installments}×* de *${fmt(installmentValue)}* ${periodLabel.adj}`;

  const startLine = input.start_date ? `\nInício em *${fmtDateBR(input.start_date)}*.` : '';

  const safePreview = [
    '*Novo contrato — confirmar*',
    '',
    `*${debtorName}*  ·  CPF ${cpfMasked}`,
    '',
    `Principal: *${fmt(input.amount)}*`,
    `Taxa: *${rate.toFixed(2)}%* ${periodLabel.short}`,
    `Parcelas: ${periodicidade}`,
    '─────────────',
    `Total a pagar: *${fmt(totalToPay)}*${startLine}`,
    '',
    'Responda *sim* para criar ou *não* para cancelar.',
  ].join('\n');
  void formatDate; // mantido pra compat — não usado neste preview

  const argsSnapshot: Record<string, unknown> = {
    debtor_name: debtorName,
    debtor_cpf: cpfNormalized,
    amount: input.amount,
    rate,
    installments,
    frequency,
    ...(input.due_day !== undefined ? { due_day: input.due_day } : {}),
    ...(input.start_date ? { start_date: input.start_date } : {}),
    ...(hasTotalRepayment ? { total_repayment: input.total_repayment } : {}),
  };

  const { confirmationId, idempotencyKey, safeUserMessage } = await createPendingConfirmation(
    ctx.session,
    'create_contract',
    argsSnapshot,
    safePreview,
  );

  return {
    kind: 'preview',
    preview: safeUserMessage,
    confirmationId,
    idempotencyKey,
    argsSnapshot,
  };
};

interface MarkInstallmentPaidInput {
  contract_id?: number;
  installment_id?: string;
  installment_number?: number;
  installment_month?: number;
  installment_year?: number;
  debtor_name?: string;
  amount?: number;
  paid_at?: string;
  bullet_mode?: 'interest' | 'settle';
}

async function resolveInstallmentForPayment(
  input: MarkInstallmentPaidInput,
  ctx: Parameters<ToolHandler>[1],
): Promise<{ kind: 'ok'; installment: ContractOpenInstallment } | { kind: 'ambiguous'; options: ContractOpenInstallment[] } | { kind: 'ambiguous_debtor'; debtors: Array<{ id: string; full_name: string; cpf: string | null }> } | { kind: 'not_found' }> {
  // BR-BOT-014 (BOT-007): nome ambíguo → desambigua a pessoa antes de tocar em
  // qualquer parcela (evita baixar no cliente errado, inclusive com contract_id
  // inferido pelo LLM). Espelha o executor da capability.
  if (input.debtor_name && !input.installment_number) {
    const profiles = await searchDebtorsByName(ctx.tenantId, input.debtor_name);
    if (profiles.length > 1) return { kind: 'ambiguous_debtor', debtors: profiles };
  }
  if (input.contract_id && input.installment_number) {
    const found = await getContractOpenInstallmentByNumber(ctx.tenantId, input.contract_id, input.installment_number);
    return found ? { kind: 'ok', installment: found } : { kind: 'not_found' };
  }
  if (input.contract_id && input.installment_month) {
    const found = await getContractOpenInstallmentByMonth(
      ctx.tenantId,
      input.contract_id,
      input.installment_month,
      input.installment_year,
    );
    return found ? { kind: 'ok', installment: found } : { kind: 'not_found' };
  }
  if (input.contract_id) {
    const page = await getContractOpenInstallments(ctx.tenantId, input.contract_id);
    const items = page.items;
    if (items.length === 0) return { kind: 'not_found' };
    if (items.length === 1) return { kind: 'ok', installment: items[0] };
    return { kind: 'ambiguous', options: items };
  }
  if (input.debtor_name && input.installment_month) {
    const found = await getInstallmentByDebtorAndMonth(
      ctx.tenantId,
      input.debtor_name,
      input.installment_month,
      input.installment_year,
    );
    if (!found) return { kind: 'not_found' };
    if (found.installments.length === 0) return { kind: 'not_found' };
    if (found.installments.length === 1) return { kind: 'ok', installment: found.installments[0] };
    return { kind: 'ambiguous', options: found.installments };
  }
  return { kind: 'not_found' };
}

export const markInstallmentPaidHandler: ToolHandler<MarkInstallmentPaidInput> = async (input, ctx) => {
  const resolution = await resolveInstallmentForPayment(input, ctx);

  if (resolution.kind === 'not_found') {
    return {
      kind: 'error',
      message: 'Não encontrei a parcela. Me diga o número do contrato e o número (ou mês) da parcela.',
      retryable: false,
    };
  }

  if (resolution.kind === 'ambiguous_debtor') {
    const lines = resolution.debtors.map((d, idx) => {
      const tail = (d.cpf || '').replace(/\D/g, '').slice(-2);
      const cpfLabel = tail ? ` — CPF ***.***.***-${tail}` : '';
      return `*${idx + 1}.* ${d.full_name}${cpfLabel}`;
    });
    return {
      kind: 'data',
      summary: `Encontrei ${resolution.debtors.length} clientes com esse nome.`,
      data: {
        prompt: `Para evitar baixar no cliente errado, me diga qual deles:\n\n${lines.join('\n')}\n\nResponda com o *número* ou o *final do CPF*.`,
      },
    };
  }

  if (resolution.kind === 'ambiguous') {
    const lines = resolution.options.slice(0, 5).map((it, idx) => (
      `*${idx + 1}.* Parcela ${it.number}  ·  ${fmt(it.amount)}  ·  vence ${fmtDateBR(it.dueDate)}`
    ));
    const more = resolution.options.length > 5 ? `\n_…e mais ${resolution.options.length - 5} parcelas._` : '';
    return {
      kind: 'data',
      summary: `Encontrei ${resolution.options.length} parcelas em aberto neste contrato.`,
      data: {
        prompt: `Qual delas você quer baixar?\n\n${lines.join('\n')}${more}\n\nResponda com o *número* da opção.`,
      },
    };
  }

  const installment = resolution.installment;

  // BOT-008: parcela de contrato bullet (interest_only) → escolha rolagem/quitação,
  // depois preview bullet; argsSnapshot leva bullet_mode → a execução confirmada
  // reusa o capability executor (payBulletInterest, BOT-005).
  const bulletInfo = await getInstallmentBulletInfo(installment.id, ctx.tenantId);
  if (bulletInfo?.isBullet) {
    const remaining = bulletInfo.remainingBalance;
    const interestDue = bulletInfo.interestDue;
    const header = `*${installment.debtorName}*  ·  Contrato *#${installment.contractId}*`;

    if (input.bullet_mode !== 'interest' && input.bullet_mode !== 'settle') {
      return {
        kind: 'data',
        summary: 'Contrato de juros simples (bullet) — preciso saber se é juros ou quitação.',
        data: {
          prompt: [
            '*Contrato de juros simples (bullet)*',
            '',
            header,
            `Principal em aberto: *${fmt(remaining)}*`,
            `Juros desta parcela: *${fmt(interestDue)}*`,
            '',
            'Como deseja registrar a baixa?',
            `• *Juros* — paga só os juros (${fmt(interestDue)}) e mantém o principal em aberto`,
            `• *Quitar* — paga juros + principal (${fmt(remaining + interestDue)}) e encerra o contrato`,
            '',
            'Responda *juros* ou *quitar*.',
          ].join('\n'),
        },
      };
    }

    const settle = input.bullet_mode === 'settle';
    const bulletPreview = ['*Baixar parcela — confirmar*', '', header, ''];
    if (settle) {
      bulletPreview.push(
        '_Quitação (juros + principal)_',
        `Juros: *${fmt(interestDue)}*`,
        `Principal: *${fmt(remaining)}*`,
        `Total: *${fmt(remaining + interestDue)}*`,
      );
    } else {
      bulletPreview.push(
        '_Rolagem (só juros)_',
        `Valor: *${fmt(interestDue)}*`,
        `Principal em aberto após a baixa: *${fmt(remaining)}*`,
      );
    }
    bulletPreview.push('', 'Responda *sim* para confirmar a baixa ou *não* para cancelar.');

    const bulletArgs: Record<string, unknown> = {
      installment_id: installment.id,
      contract_id: installment.contractId,
      installment_number: installment.number,
      bullet_mode: input.bullet_mode,
    };
    const bulletConfirm = await createPendingConfirmation(ctx.session, 'mark_installment_paid', bulletArgs, bulletPreview.join('\n'));
    return {
      kind: 'preview',
      preview: bulletConfirm.safeUserMessage,
      confirmationId: bulletConfirm.confirmationId,
      idempotencyKey: bulletConfirm.idempotencyKey,
      argsSnapshot: bulletArgs,
    };
  }

  const paidAt = (input.paid_at && /^\d{4}-\d{2}-\d{2}$/.test(input.paid_at))
    ? input.paid_at
    : new Date().toISOString().slice(0, 10);

  const safePreview = [
    '*Baixar parcela — confirmar*',
    '',
    `*${installment.debtorName}*  ·  Contrato *#${installment.contractId}*  ·  Parcela *${installment.number}*`,
    '',
    `Valor: *${fmt(installment.amount)}*`,
    `Vencimento: ${fmtDateBR(installment.dueDate)}`,
    '',
    'Responda *sim* para confirmar a baixa ou *não* para cancelar.',
  ].join('\n');

  const argsSnapshot: Record<string, unknown> = {
    installment_id: installment.id,
    contract_id: installment.contractId,
    installment_number: installment.number,
    amount: input.amount ?? installment.amount,
    paid_at: paidAt,
  };

  const { confirmationId, idempotencyKey, safeUserMessage } = await createPendingConfirmation(
    ctx.session,
    'mark_installment_paid',
    argsSnapshot,
    safePreview,
  );

  return {
    kind: 'preview',
    preview: safeUserMessage,
    confirmationId,
    idempotencyKey,
    argsSnapshot,
  };
};

// Silencia unused imports (helpers existem para wiring futuro)
void getDebtorsToCollectByDateRange;
void getProfileById;
void ASSISTENT_PERSONA;
