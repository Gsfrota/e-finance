import { formatCurrency, formatDate, DebtorToCollect, MonthlyReport, ContractDraft } from '../actions/admin-actions';
import type { Installment } from '../actions/admin-actions';

export interface ComprovanteData {
  debtorName: string;
  amount: number;
  dueDate?: string;
  paidAt: string;            // ISO timestamp
  installmentNumber?: number;
  totalInstallments?: number;
  contractId?: number;
}

type DebtorItem = Pick<DebtorToCollect, 'name' | 'totalDue' | 'installmentCount' | 'daysLate'>;

/**
 * Formata lista de cobrança (cobrar_hoje / cobrar_periodo).
 */
export function formatCobrancaList(debtors: DebtorItem[], windowLabel: string): string {
  const total = debtors.reduce((sum, d) => sum + d.totalDue, 0);
  const visibleItems = debtors.slice(0, 8);
  const lines = visibleItems.map((d, idx) => {
    const parcelas = d.installmentCount > 1 ? ` — ${d.installmentCount} parcelas` : '';
    const atraso = d.daysLate > 0 ? ` *(${d.daysLate}d atrasado)*` : '';
    return `${idx + 1}. ${d.name} — ${formatCurrency(d.totalDue)}${parcelas}${atraso}`;
  });
  const extra = debtors.length > visibleItems.length
    ? `\n\n...e mais ${debtors.length - visibleItems.length} devedores no período.`
    : '';
  return `🔔 *Cobranças — ${windowLabel}* — ${debtors.length} devedor${debtors.length !== 1 ? 'es' : ''}\n\n${lines.join('\n')}\n\n💰 Total em aberto: *${formatCurrency(total)}*${extra}`;
}

/**
 * Formata lista de recebíveis (recebiveis_hoje / recebiveis_periodo).
 */
export function formatReceivablesList(installments: Installment[], windowLabel: string): string {
  const total = installments.reduce((sum, i) => sum + i.amount, 0);
  const visibleItems = installments.slice(0, 8);
  const lines = visibleItems.map((item, idx) => {
    const dateStr = item.dueDate ? ` — ${formatDate(item.dueDate)}` : '';
    const atraso = item.daysLate > 0 ? ` *(atrasado)*` : '';
    return `${idx + 1}. ${item.debtorName} — ${formatCurrency(item.amount)}${dateStr}${atraso}`;
  });
  const extra = installments.length > visibleItems.length
    ? `\n\n...e mais ${installments.length - visibleItems.length} itens no período.`
    : '';
  return `📅 *Recebíveis — ${windowLabel}* — ${installments.length} parcela${installments.length !== 1 ? 's' : ''}\n\n${lines.join('\n')}\n\n💰 Total previsto: *${formatCurrency(total)}*${extra}`;
}

/**
 * Formata comprovante de pagamento após marcar parcela como paga.
 */
export function formatComprovante(data: ComprovanteData): string {
  const paidDate = new Date(data.paidAt);
  const paidDateStr = paidDate.toLocaleDateString('pt-BR');
  const paidTimeStr = paidDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const lines: string[] = [
    '✅ *Comprovante de Pagamento*',
    '─────────────────────────',
    `Devedor: ${data.debtorName}`,
  ];

  if (data.contractId) {
    lines.push(`Contrato: #${data.contractId}`);
  }

  if (data.installmentNumber !== undefined) {
    const totalStr = data.totalInstallments ? `/${data.totalInstallments}` : '';
    lines.push(`Parcela: ${data.installmentNumber}${totalStr}`);
  }

  lines.push(`Valor: ${formatCurrency(data.amount)}`);

  if (data.dueDate) {
    lines.push(`Vencimento: ${formatDate(data.dueDate)}`);
  }

  lines.push(`Pago em: ${paidDateStr} às ${paidTimeStr}`);
  lines.push('─────────────────────────');
  lines.push('Para mais detalhes, acesse o dashboard web.');

  return lines.join('\n');
}

/**
 * Formata relatório mensal completo (gerar_relatorio).
 */
export function formatRelatorioCompleto(report: MonthlyReport, month: string): string {
  const { dashboard: d } = report;
  const receivedByPaymentMonth = d.receivedByPaymentMonth ?? d.receivedMonth;
  const receivedByDueMonth = d.receivedByDueMonth ?? d.receivedMonth;

  const sep = '━━━━━━━━━━━━━━━━━━';

  let text = `📊 *Relatório — ${month}*\n${sep}\n\n`;

  text += `💼 *RESUMO*\n`;
  text += `✅ Recebido (pagamento no mês): ${formatCurrency(receivedByPaymentMonth)}\n`;
  text += `📅 Recebido (por vencimento): ${formatCurrency(receivedByDueMonth)}\n`;
  text += `📈 Previsto para receber: ${formatCurrency(d.expectedMonth)}\n`;
  text += `⚠️ Em atraso: ${formatCurrency(d.totalOverdue)}\n`;
  text += `📋 Contratos ativos: ${d.activeContracts}\n`;

  if (report.todayInstallments.length > 0) {
    text += `\n${sep}\n`;
    text += `📅 *VENCE HOJE* (${report.todayInstallments.length})\n`;
    report.todayInstallments.slice(0, 5).forEach(i => {
      text += `• ${i.debtorName} — ${formatCurrency(i.amount)}\n`;
    });
  }

  if (report.overdueDebtors.length > 0) {
    text += `\n${sep}\n`;
    text += `🔴 *INADIMPLENTES* (${report.overdueDebtors.length})\n`;
    report.overdueDebtors.slice(0, 5).forEach(debtor => {
      text += `• ${debtor.name} — ${formatCurrency(debtor.totalDue)} (${debtor.daysLate}d)\n`;
    });
  }

  if (report.topDebtors.length > 0) {
    text += `\n${sep}\n`;
    text += `👥 *MAIORES DEVEDORES*\n`;
    report.topDebtors.forEach((debtor, idx) => {
      text += `${idx + 1}. ${debtor.name} — ${formatCurrency(debtor.totalDebt)}\n`;
    });
  }

  return text.trim();
}

// ── Formatadores de criação de contrato ─────────────────────────────────────

function maskCpf(cpf?: string): string {
  if (!cpf) return '***.***.***-**';
  const digits = cpf.replace(/\D/g, '');
  if (!digits) return '***.***.***-**';
  return `***.***.***-${digits.slice(-2)}`;
}

function generateInstallmentDates(draft: ContractDraft, count: number): Date[] {
  const baseDate = draft.start_date
    ? new Date(draft.start_date + 'T12:00:00')
    : (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d; })();

  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate);
    if (draft.frequency === 'weekly') {
      d.setDate(d.getDate() + i * 7);
    } else if (draft.frequency === 'biweekly') {
      d.setDate(d.getDate() + i * 14);
    } else {
      // monthly (default)
      d.setMonth(d.getMonth() + i);
    }
    if (draft.due_day && draft.frequency === 'monthly') {
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(draft.due_day, maxDay));
    }
    dates.push(d);
  }
  return dates;
}

function formatDateBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const FREQ_LABEL: Record<string, string> = { monthly: 'mensais', weekly: 'semanais', biweekly: 'quinzenais' };
const ordinal = (n: number) => `${n}ª`;

/**
 * Mensagem de confirmação antes de criar o contrato.
 */
export function formatContractConfirmationMessage(draft: ContractDraft): string {
  const total = (draft.total_repayment ?? 0) > 0
    ? draft.total_repayment!
    : draft.amount * (1 + (draft.rate / 100) * draft.installments);
  const installmentValue = total / draft.installments;
  const lucro = total - draft.amount;
  const lucroPercent = ((lucro / draft.amount) * 100).toFixed(0);
  const freqLabel = FREQ_LABEL[draft.frequency] ?? draft.frequency;
  const sep = '━━━━━━━━━━━━━━━━━━';

  const previewCount = Math.min(3, draft.installments);
  const dates = generateInstallmentDates(draft, previewCount);
  const previewLines = dates.map((d, i) =>
    `${ordinal(i + 1)} — ${formatDateBR(d)} — ${formatCurrency(installmentValue)}`
  );
  const remaining = draft.installments - previewCount;
  const previewExtra = remaining > 0 ? `...e mais ${remaining} parcela${remaining > 1 ? 's' : ''}` : '';

  const cpfLine = draft.debtor_cpf ? `\n🪪 CPF: *${maskCpf(draft.debtor_cpf)}*` : '';

  return [
    `📋 *Resumo do Contrato*`,
    sep,
    ``,
    `👤 Devedor: *${draft.debtor_name}*${cpfLine}`,
    ``,
    `💰 Principal: *${formatCurrency(draft.amount)}*`,
    `📈 Taxa: *${draft.rate}% a.m.*`,
    `📅 Parcelas: *${draft.installments}x ${freqLabel}*`,
    `💵 Valor por parcela: *${formatCurrency(installmentValue)}*`,
    ``,
    `🧾 Total a pagar: *${formatCurrency(total)}*`,
    `💹 Rentabilidade: *${formatCurrency(lucro)}* (${lucroPercent}%)`,
    ``,
    `📆 *Preview das parcelas:*`,
    ...previewLines,
    ...(previewExtra ? [previewExtra] : []),
    ``,
    `Confirma? (sim/não)`,
  ].join('\n');
}

export interface ContractCreatedResult {
  id: number;
  debtorName: string;
  debtorCpf: string;
  firstInstallment: string;
  debtorResolution: 'created' | 'reused';
}

/**
 * Comprovante exibido após criação bem-sucedida do contrato.
 */
export function formatContractCreatedMessage(result: ContractCreatedResult, draft: ContractDraft): string {
  const total = (draft.total_repayment ?? 0) > 0
    ? draft.total_repayment!
    : draft.amount * (1 + (draft.rate / 100) * draft.installments);
  const installmentValue = total / draft.installments;
  const lucro = total - draft.amount;
  const lucroPercent = ((lucro / draft.amount) * 100).toFixed(0);
  const sep = '━━━━━━━━━━━━━━━━━━';

  const previewCount = Math.min(4, draft.installments);
  const dates = generateInstallmentDates(draft, previewCount);
  const previewLines = dates.map((d, i) =>
    `${ordinal(i + 1)} — ${formatDateBR(d)} — ${formatCurrency(installmentValue)}`
  );

  const lines = [
    `✅ *Contrato #${result.id} criado com sucesso!*`,
    sep,
    ``,
    `👤 Devedor: *${result.debtorName}*`,
    `🪪 CPF: *${maskCpf(result.debtorCpf)}*`,
    ``,
    `💰 Principal: *${formatCurrency(draft.amount)}*`,
    `📈 Taxa: *${draft.rate}% a.m.* | 📅 *${draft.installments}x ${FREQ_LABEL[draft.frequency] ?? draft.frequency}*`,
    `💵 Parcela: *${formatCurrency(installmentValue)}*`,
    `🧾 Total a pagar: *${formatCurrency(total)}*`,
    `💹 Retorno: *${formatCurrency(lucro)}* (${lucroPercent}%)`,
    ``,
    `📆 *Próximas parcelas:*`,
    ...previewLines,
  ];

  if (result.debtorResolution === 'reused') {
    lines.push(`♻️ _Devedor já cadastrado — contrato vinculado ao perfil existente._`);
  }

  lines.push(``, `Para baixar, diga: *baixar contrato ${result.id}*`);

  return lines.join('\n');
}
