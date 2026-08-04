import { Investment, MonthlyViewData, MonthlyDebtorSummary, MonthlyOverdueEntry } from '../types';
import { getBrazilToday } from '../services/dateUtils';

interface RawInstallment {
  id: string;
  number: number;
  due_date: string;
  amount_total: number;
  amount_interest: number;
  amount_paid: number;
  status: string;
  paid_at: string | null;
  fine_amount: number;
  interest_delay_amount: number;
}

interface RawInvestment extends Omit<Investment, 'loan_installments'> {
  loan_installments: RawInstallment[];
  payer?: { id: string; full_name: string } | null;
}

// --- Helpers puros ---

export function monthKeyToDate(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

export function dateToMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// --- Visão Mensal (BR-REL-007) ---

export function computeMonthlyView(invData: RawInvestment[], targetMonth: Date): MonthlyViewData {
  const monthStart = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
  const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59);
  const todayYMD = getBrazilToday();
  const today = new Date(todayYMD + 'T00:00:00');

  const monthLabel = monthStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  let totalExpected = 0;
  let totalPaid = 0;
  let interestReceived = 0;
  let interestExpected = 0;
  let capitalAllocated = 0;

  const overdueEntries: MonthlyOverdueEntry[] = [];
  const debtorMap = new Map<string, MonthlyDebtorSummary>();

  const capitalSet = new Set<number>();

  invData.forEach((inv) => {
    const debtorName = inv.payer?.full_name || inv.asset_name;

    // BR-REL-002: excluir parcelas fantasma
    const installments = (inv.loan_installments || []).filter(
      (i) => !(Number(i.amount_total) === 0 && Number(i.amount_paid) === 0 && i.status === 'paid')
    );

    const monthInstallments = installments.filter((inst) => {
      const d = new Date(inst.due_date + 'T00:00:00');
      return d >= monthStart && d <= monthEnd;
    });

    if (monthInstallments.length === 0) return;

    // Capital alocado: contar cada contrato apenas uma vez
    if (!capitalSet.has(inv.id)) {
      capitalSet.add(inv.id);
      capitalAllocated += Number(inv.amount_invested || 0);
    }

    let debtorDue = 0;
    let debtorPaid = 0;
    let debtorOverdueCount = 0;
    let debtorOverdueAmount = 0;

    monthInstallments.forEach((inst) => {
      const amountTotal = Number(inst.amount_total || 0);
      const amountPaid = Number(inst.amount_paid || 0);
      const amountInterest = Number(inst.amount_interest || 0);

      totalExpected += amountTotal;
      debtorDue += amountTotal;

      if (inst.status === 'paid' || inst.status === 'partial') {
        totalPaid += amountPaid;
        debtorPaid += amountPaid;

        // Juros recebidos: proporcional para partial
        if (inst.status === 'paid') {
          interestReceived += amountInterest;
        } else {
          interestReceived += amountTotal > 0 ? (amountPaid / amountTotal) * amountInterest : 0;
        }
      }

      if (inst.status === 'pending' || inst.status === 'late') {
        interestExpected += amountInterest;
      }

      // Atrasados do mês
      if (inst.status === 'late') {
        const dueDate = new Date(inst.due_date + 'T00:00:00');
        const daysLate = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        const overdueAmt = amountTotal - amountPaid;
        debtorOverdueCount++;
        debtorOverdueAmount += overdueAmt;
        overdueEntries.push({ debtorName, amount: overdueAmt, daysLate: Math.max(0, daysLate) });
      }
    });

    const instRows = monthInstallments.map((inst) => ({
      id: inst.id ?? `${inv.id}-${inst.due_date}`,
      investment_id: inv.id,
      number: inst.number ?? 0,
      due_date: inst.due_date,
      amount_total: Number(inst.amount_total || 0),
      amount_paid: Number(inst.amount_paid || 0),
      amount_interest: Number(inst.amount_interest || 0),
      fine_amount: Number(inst.fine_amount || 0),
      interest_delay_amount: Number(inst.interest_delay_amount || 0),
      status: inst.status,
      contractName: inv.asset_name,
    }));

    const existing = debtorMap.get(debtorName);
    if (existing) {
      existing.totalDue += debtorDue;
      existing.totalPaid += debtorPaid;
      existing.installmentCount += monthInstallments.length;
      existing.overdueCount += debtorOverdueCount;
      existing.overdueAmount += debtorOverdueAmount;
      existing.installments.push(...instRows);
    } else {
      debtorMap.set(debtorName, {
        debtorName,
        totalDue: debtorDue,
        totalPaid: debtorPaid,
        installmentCount: monthInstallments.length,
        overdueCount: debtorOverdueCount,
        overdueAmount: debtorOverdueAmount,
        installments: instRows,
      });
    }
  });

  const paymentPercent = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 10000) / 100 : 0;
  const overdueCount = overdueEntries.length;
  const overdueAmount = overdueEntries.reduce((s, e) => s + e.amount, 0);

  // Agrupa múltiplos contratos do mesmo devedor nos atrasados
  const overdueByDebtorMap = new Map<string, MonthlyOverdueEntry>();
  overdueEntries.forEach((e) => {
    const ex = overdueByDebtorMap.get(e.debtorName);
    if (ex) {
      ex.amount += e.amount;
      ex.daysLate = Math.max(ex.daysLate, e.daysLate);
    } else {
      overdueByDebtorMap.set(e.debtorName, { ...e });
    }
  });

  const debtors = Array.from(debtorMap.values()).sort((a, b) => b.overdueCount - a.overdueCount);

  return {
    month: monthStart,
    monthLabel: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
    totalExpected: Math.round(totalExpected * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    paymentPercent,
    interestReceived: Math.round(interestReceived * 100) / 100,
    interestExpected: Math.round(interestExpected * 100) / 100,
    capitalAllocated: Math.round(capitalAllocated * 100) / 100,
    overdueCount,
    overdueAmount: Math.round(overdueAmount * 100) / 100,
    overdueByDebtor: Array.from(overdueByDebtorMap.values()).sort((a, b) => b.amount - a.amount),
    debtors,
  };
}
