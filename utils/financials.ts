export const formatCurrency = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

export const roundCurrency = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export const formatDecimalInput = (val: number) =>
  roundCurrency(Number(val || 0)).toFixed(2);

export const distributeEvenly = (total: number, count: number): number[] => {
  if (count <= 0) return [];
  const base = roundCurrency(total / count);
  const values = Array.from({ length: count }, () => base);
  const currentTotal = roundCurrency(values.reduce((sum, value) => sum + value, 0));
  values[count - 1] = roundCurrency(values[count - 1] + (total - currentTotal));
  return values;
};

export const calculateInstallmentDates = (
  frequency: string,
  dueDay: number,
  weekday: number,
  startDateStr: string,
  count: number,
  skipSaturday: boolean = false,
  skipSunday: boolean = false,
  monthOffset?: 0 | 1
): Date[] => {
  const dates: Date[] = [];
  const now = new Date();
  let cursorDate = new Date();

  if (frequency === 'monthly') {
    cursorDate.setDate(dueDay);
    const shouldGoNext = monthOffset !== undefined
      ? monthOffset === 1
      : now.getDate() >= dueDay;
    if (shouldGoNext) {
      cursorDate.setMonth(cursorDate.getMonth() + 1);
    }
  } else if (frequency === 'weekly') {
    const currentDay = now.getDay();
    let diff = weekday - currentDay;
    if (diff <= 0) diff += 7;
    cursorDate.setDate(now.getDate() + diff);
  } else if (startDateStr) {
    const [y, m, d] = startDateStr.split('-').map(Number);
    cursorDate = new Date(y, m - 1, d);
  }

  if (frequency === 'daily' && (skipSaturday || skipSunday)) {
    let start = new Date(cursorDate);
    while ((skipSunday && start.getDay() === 0) || (skipSaturday && start.getDay() === 6)) {
      start.setDate(start.getDate() + 1);
    }
    for (let i = 0; i < count; i++) {
      const candidate = new Date(start);
      let bDaysLeft = i;
      while (bDaysLeft > 0) {
        candidate.setDate(candidate.getDate() + 1);
        const day = candidate.getDay();
        const shouldSkip = (skipSunday && day === 0) || (skipSaturday && day === 6);
        if (!shouldSkip) bDaysLeft--;
      }
      dates.push(new Date(candidate));
    }
    return dates;
  }

  for (let i = 0; i < count; i++) {
    const d = new Date(cursorDate);
    if (frequency === 'monthly') {
      d.setMonth(d.getMonth() + i);
      if (d.getDate() !== dueDay) d.setDate(0);
    } else if (frequency === 'weekly') {
      d.setDate(d.getDate() + (i * 7));
    } else if (frequency === 'daily') {
      d.setDate(d.getDate() + i);
    }
    dates.push(d);
  }
  return dates;
};

export const calculateFinancials = (
  amount: number,
  installments: number,
  rate: number,
  mode: 'auto' | 'manual' | 'interest_only',
  manualInstallmentValue: number,
  bulletPrincipalMode: 'together' | 'separate' = 'together',
  remainingBalance?: number | null
) => {
  const principal = Number(amount) || 0;
  const count = Math.max(1, Number(installments));

  if (principal <= 0) return { installmentValue: 0, totalValue: 0, interestRate: 0 };

  if (mode === 'interest_only') {
    const r = Number(rate) || 0;
    // Usa saldo devedor atual se disponível (bullet rotativo), senão usa principal original
    const base = (remainingBalance != null && remainingBalance > 0) ? Number(remainingBalance) : principal;
    const interestPerPeriod = roundCurrency(base * (r / 100));
    return {
      installmentValue: interestPerPeriod,
      totalValue: roundCurrency(base + interestPerPeriod),
      interestRate: r
    };
  } else if (mode === 'auto') {
    const r = Number(rate) || 0;
    const total = principal * (1 + (r / 100));
    return {
      installmentValue: total / count,
      totalValue: total,
      interestRate: r
    };
  } else {
    const instVal = Number(manualInstallmentValue) || 0;
    const total = instVal * count;
    const impliedRate = ((total - principal) / principal) * 100;
    return {
      installmentValue: instVal,
      totalValue: total,
      interestRate: impliedRate
    };
  }
};

export const buildFreelancerDates = (count: number, startDate: string, intervalDays: number): string[] => {
  const dates: string[] = [];
  const [y, m, d] = startDate.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  for (let i = 0; i < count; i++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + i * intervalDays);
    dates.push(dt.toISOString().split('T')[0]);
  }
  return dates;
};
