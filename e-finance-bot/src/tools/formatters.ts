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
    const parcelas = d.installmentCount > 1 ? `  ·  ${d.installmentCount} parcelas` : '';
    const atraso = d.daysLate > 0 ? `  ·  _${d.daysLate}d atrasado_` : '';
    return `*${idx + 1}.* ${d.name}  ·  *${formatCurrency(d.totalDue)}*${parcelas}${atraso}`;
  });
  const extra = debtors.length > visibleItems.length
    ? `\n_…e mais ${debtors.length - visibleItems.length} devedores no período._`
    : '';
  const word = debtors.length === 1 ? 'devedor' : 'devedores';
  return [
    `*Cobranças — ${windowLabel}*`,
    `${debtors.length} ${word}  ·  Total em aberto: *${formatCurrency(total)}*`,
    '',
    lines.join('\n'),
    extra,
  ].filter(Boolean).join('\n');
}

/**
 * Formata lista de recebíveis (recebiveis_hoje / recebiveis_periodo).
 */
export function formatReceivablesList(installments: Installment[], windowLabel: string): string {
  const total = installments.reduce((sum, i) => sum + i.amount, 0);
  const visibleItems = installments.slice(0, 8);
  const lines = visibleItems.map((item, idx) => {
    const dateStr = item.dueDate ? `  ·  ${formatDate(item.dueDate)}` : '';
    const atraso = item.daysLate > 0 ? `  ·  _atrasado_` : '';
    return `*${idx + 1}.* ${item.debtorName}  ·  *${formatCurrency(item.amount)}*${dateStr}${atraso}`;
  });
  const extra = installments.length > visibleItems.length
    ? `\n_…e mais ${installments.length - visibleItems.length} parcelas no período._`
    : '';
  const word = installments.length === 1 ? 'parcela' : 'parcelas';
  return [
    `*Recebíveis — ${windowLabel}*`,
    `${installments.length} ${word}  ·  Total previsto: *${formatCurrency(total)}*`,
    '',
    lines.join('\n'),
    extra,
  ].filter(Boolean).join('\n');
}

/**
 * Formata comprovante de pagamento após marcar parcela como paga.
 */
export function formatComprovante(data: ComprovanteData): string {
  const paidDate = new Date(data.paidAt);
  // V44d — Cloud Run roda em UTC; sem timezone explícito o comprovante mostrava
  // "às 19:21" para uma baixa feita às 16:21 BRT. BR-TZ-001 já documentou padrão.
  const paidDateStr = paidDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const paidTimeStr = paidDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  const headerParts: string[] = [data.debtorName];
  if (data.contractId) headerParts.push(`Contrato #${data.contractId}`);
  if (data.installmentNumber !== undefined) {
    const totalStr = data.totalInstallments ? `/${data.totalInstallments}` : '';
    headerParts.push(`Parcela ${data.installmentNumber}${totalStr}`);
  }

  const lines: string[] = [
    '*Pagamento confirmado*',
    '',
    headerParts.join('  ·  '),
    '',
    `Valor: *${formatCurrency(data.amount)}*`,
  ];

  if (data.dueDate) {
    lines.push(`Vencimento: ${formatDate(data.dueDate)}`);
  }
  lines.push(`Pago em: ${paidDateStr} às ${paidTimeStr}`);

  return lines.join('\n');
}

export interface BulletReceiptData {
  debtorName: string;
  contractId?: number;
  installmentNumber?: number;
  paidAt: string;
  mode: 'interest' | 'settle';
  interestPaid: number;
  principalPaid: number;
  newBalance: number;
  contractClosed: boolean;
}

/**
 * BR-BOT-012: comprovante de baixa de contrato bullet (juros simples).
 * Rolagem mostra juros pagos + saldo que segue em aberto; quitação mostra
 * juros + principal e o encerramento do contrato.
 */
export function formatBulletPaymentReceipt(data: BulletReceiptData): string {
  const paidDate = new Date(data.paidAt);
  const paidDateStr = paidDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const paidTimeStr = paidDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  const headerParts: string[] = [data.debtorName];
  if (data.contractId) headerParts.push(`Contrato #${data.contractId}`);

  const lines: string[] = ['*Pagamento confirmado*', '', headerParts.join('  ·  '), ''];

  if (data.mode === 'settle' || data.contractClosed) {
    const total = data.interestPaid + data.principalPaid;
    lines.push(
      '_Contrato quitado (juros + principal)_',
      `Juros: *${formatCurrency(data.interestPaid)}*`,
      `Principal: *${formatCurrency(data.principalPaid)}*`,
      `Total pago: *${formatCurrency(total)}*`,
      `Saldo devedor: *${formatCurrency(0)}*  ·  _contrato encerrado_`,
    );
  } else {
    lines.push(
      '_Rolagem de juros_',
      `Juros pagos: *${formatCurrency(data.interestPaid)}*`,
      `Principal em aberto: *${formatCurrency(data.newBalance)}*`,
      '_Próxima parcela de juros gerada automaticamente._',
    );
  }
  lines.push(`Pago em: ${paidDateStr} às ${paidTimeStr}`);
  return lines.join('\n');
}

/**
 * Formata relatório mensal completo (gerar_relatorio).
 */
export function formatRelatorioCompleto(report: MonthlyReport, month: string): string {
  const { dashboard: d } = report;
  const receivedByPaymentMonth = d.receivedByPaymentMonth ?? d.receivedMonth;
  const receivedByDueMonth = d.receivedByDueMonth ?? d.receivedMonth;

  const sections: string[] = [];

  sections.push(`*Relatório — ${month}*`);

  sections.push([
    '*Resumo*',
    `• Recebido (data do pagamento): *${formatCurrency(receivedByPaymentMonth)}*`,
    `• Recebido (por vencimento): *${formatCurrency(receivedByDueMonth)}*`,
    `• Previsto para receber: *${formatCurrency(d.expectedMonth)}*`,
    `• Em atraso: *${formatCurrency(d.totalOverdue)}*`,
    `• Contratos ativos: *${d.activeContracts}*`,
  ].join('\n'));

  if (report.todayInstallments.length > 0) {
    const list = report.todayInstallments.slice(0, 5)
      .map(i => `• ${i.debtorName}  ·  *${formatCurrency(i.amount)}*`)
      .join('\n');
    sections.push(`*Vence hoje (${report.todayInstallments.length})*\n${list}`);
  }

  if (report.overdueDebtors.length > 0) {
    const list = report.overdueDebtors.slice(0, 5)
      .map(debtor => `• ${debtor.name}  ·  *${formatCurrency(debtor.totalDue)}*  ·  _${debtor.daysLate}d_`)
      .join('\n');
    sections.push(`*Inadimplentes (${report.overdueDebtors.length})*\n${list}`);
  }

  if (report.topDebtors.length > 0) {
    const list = report.topDebtors
      .map((debtor, idx) => `*${idx + 1}.* ${debtor.name}  ·  *${formatCurrency(debtor.totalDebt)}*`)
      .join('\n');
    sections.push(`*Maiores devedores*\n${list}`);
  }

  return sections.join('\n\n');
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

const FREQ_LABEL: Record<string, string> = { monthly: 'mensais', weekly: 'semanais', biweekly: 'quinzenais', daily: 'diárias' };
const WEEKDAY_NAMES = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const ordinal = (n: number) => `${n}ª`;

/**
 * BR-BOT-011: mensagem para contrato bullet (juros simples / interest_only).
 * Mostra juros por período e principal em aberto, sem total linear nem "Nx de".
 */
function formatBulletContractMessage(
  draft: ContractDraft,
  opts: { variant: 'confirm' } | { variant: 'created'; result: ContractCreatedResult },
): string {
  const juros = draft.amount * (draft.rate / 100);
  const freqLabel = FREQ_LABEL[draft.frequency] ?? draft.frequency;
  const periodWord = draft.frequency === 'monthly' ? 'mensais'
    : draft.frequency === 'weekly' ? 'semanais'
    : draft.frequency === 'biweekly' ? 'quinzenais'
    : draft.frequency === 'daily' ? 'diárias'
    : freqLabel;
  const nextDate = generateInstallmentDates(draft, 1)[0];

  if (opts.variant === 'created') {
    const cpf = opts.result.debtorCpf;
    const lines = [
      `*Contrato #${opts.result.id} criado*`,
      '',
      `*${opts.result.debtorName}*  ·  CPF ${maskCpf(cpf)}`,
      '',
      '_Juros simples — prazo indeterminado_',
      `Principal em aberto: *${formatCurrency(draft.amount)}*`,
      `Taxa: *${draft.rate}%* a.m.`,
      `Juros ${periodWord}: *${formatCurrency(juros)}*`,
      '',
      `*Próxima cobrança:* ${formatDateBR(nextDate)}  ·  *${formatCurrency(juros)}*`,
    ];
    if (opts.result.debtorResolution === 'reused') {
      lines.push('', '_Devedor já cadastrado — contrato vinculado ao perfil existente._');
    }
    lines.push('', `Para registrar baixa depois, diga *"baixar contrato ${opts.result.id}"*.`);
    return lines.join('\n');
  }

  const cpfLabel = draft.debtor_cpf ? `  ·  CPF ${maskCpf(draft.debtor_cpf)}` : '';
  return [
    '*Novo contrato — confirmar*',
    '',
    `*${draft.debtor_name}*${cpfLabel}`,
    '',
    '_Juros simples — prazo indeterminado_',
    `Principal em aberto: *${formatCurrency(draft.amount)}*`,
    `Taxa: *${draft.rate}%* a.m.`,
    `Juros ${periodWord}: *${formatCurrency(juros)}*`,
    `Cobrança: ${periodWord}, principal pago só na quitação`,
    '',
    `*Próxima cobrança:* ${formatDateBR(nextDate)}  ·  *${formatCurrency(juros)}*`,
    '',
    'Responda *sim* para criar ou *não* para cancelar.',
  ].join('\n');
}

/**
 * Mensagem de confirmação antes de criar o contrato.
 */
export function formatContractConfirmationMessage(draft: ContractDraft): string {
  if (draft.calculation_mode === 'interest_only') {
    return formatBulletContractMessage(draft, { variant: 'confirm' });
  }
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
    `${ordinal(i + 1)}  ·  ${formatDateBR(d)}  ·  *${formatCurrency(installmentValue)}*`
  );
  const remaining = draft.installments - previewCount;
  const previewExtra = remaining > 0 ? `…e mais ${remaining} parcela${remaining > 1 ? 's' : ''}` : '';

  const cpfLabel = draft.debtor_cpf ? `  ·  CPF ${maskCpf(draft.debtor_cpf)}` : '';

  const modalidadeText = draft.frequency === 'monthly'
    ? (draft.due_day ? `mensal, todo dia ${draft.due_day}` : 'mensal')
    : draft.frequency === 'weekly'
      ? (draft.due_day !== undefined ? `semanal (${WEEKDAY_NAMES[draft.due_day % 7] ?? 'semanal'})` : 'semanal')
      : draft.frequency === 'daily' ? 'diária'
      : draft.frequency;

  void sep; // legacy ribbon não é mais usado
  return [
    '*Novo contrato — confirmar*',
    '',
    `*${draft.debtor_name}*${cpfLabel}`,
    '',
    `Principal: *${formatCurrency(draft.amount)}*`,
    `Taxa: *${draft.rate}%* a.m.`,
    `Parcelas: *${draft.installments}×* ${freqLabel} de *${formatCurrency(installmentValue)}* (${modalidadeText})`,
    '─────────────',
    `Total a pagar: *${formatCurrency(total)}*`,
    `Rentabilidade: *${formatCurrency(lucro)}* (${lucroPercent}%)`,
    '',
    '*Próximas parcelas:*',
    ...previewLines,
    ...(previewExtra ? [`_${previewExtra}_`] : []),
    '',
    'Responda *sim* para criar ou *não* para cancelar.',
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
  if (draft.calculation_mode === 'interest_only') {
    return formatBulletContractMessage(draft, { variant: 'created', result });
  }
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
    `${ordinal(i + 1)}  ·  ${formatDateBR(d)}  ·  *${formatCurrency(installmentValue)}*`
  );

  void sep;
  const lines = [
    `*Contrato #${result.id} criado*`,
    '',
    `*${result.debtorName}*  ·  CPF ${maskCpf(result.debtorCpf)}`,
    '',
    `Principal: *${formatCurrency(draft.amount)}*`,
    `Taxa: *${draft.rate}%* a.m.  ·  *${draft.installments}×* ${FREQ_LABEL[draft.frequency] ?? draft.frequency}`,
    `Parcela: *${formatCurrency(installmentValue)}*`,
    '─────────────',
    `Total a pagar: *${formatCurrency(total)}*`,
    `Retorno: *${formatCurrency(lucro)}* (${lucroPercent}%)`,
    '',
    '*Próximas parcelas:*',
    ...previewLines,
  ];

  if (result.debtorResolution === 'reused') {
    lines.push('', '_Devedor já cadastrado — contrato vinculado ao perfil existente._');
  }

  lines.push('', `Para registrar baixa depois, diga *"baixar contrato ${result.id}"*.`);

  return lines.join('\n');
}
