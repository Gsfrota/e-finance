import { buildDateWindow } from '../actions/admin-actions';
import type { ResolvedTimeWindow } from './contracts';

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseYmd(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDays(baseDate: Date, days: number): Date {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(baseDate: Date, months: number): Date {
  const next = new Date(baseDate);
  const originalDay = next.getDate();
  next.setMonth(next.getMonth() + months);
  while (next.getDate() < originalDay) {
    next.setDate(next.getDate() - 1);
  }
  return next;
}

function getWindowStart(text: string): 'today' | 'tomorrow' {
  return /(a partir de amanha|comecando amanha|desde amanha|de amanha em diante|amanha)/.test(normalizeText(text))
    ? 'tomorrow'
    : 'today';
}

function buildRelativeMonthsWindow(amount: number, windowStart: 'today' | 'tomorrow', now = new Date()): ResolvedTimeWindow {
  const offsetDays = windowStart === 'tomorrow' ? 1 : 0;
  const start = addDays(now, offsetDays);
  const end = addDays(addMonths(start, amount), -1);
  const label = amount === 1
    ? (windowStart === 'tomorrow' ? 'a partir de amanhã, no próximo mês' : 'nos próximos 30 dias corridos')
    : `nos próximos ${amount} meses`;

  return {
    mode: 'relative_months',
    amount,
    windowStart,
    startDate: formatYmd(start.getFullYear(), start.getMonth() + 1, start.getDate()),
    endDate: formatYmd(end.getFullYear(), end.getMonth() + 1, end.getDate()),
    label,
  };
}

function buildCalendarMonthWindow(offsetMonths: 0 | 1, now = new Date()): ResolvedTimeWindow {
  const year = now.getFullYear();
  const monthIndex = now.getMonth() + offsetMonths;
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);

  return {
    mode: 'calendar_month',
    amount: 1,
    windowStart: 'today',
    startDate: formatYmd(start.getFullYear(), start.getMonth() + 1, start.getDate()),
    endDate: formatYmd(end.getFullYear(), end.getMonth() + 1, end.getDate()),
    label: offsetMonths === 0 ? 'este mês' : 'o próximo mês',
  };
}

export function inferTimeWindowFromText(text: string, now = new Date()): ResolvedTimeWindow | null {
  const normalized = normalizeText(text);
  const windowStart = getWindowStart(normalized);

  if (/(este mes|esse mes|mes atual)/.test(normalized)) {
    return buildCalendarMonthWindow(0, now);
  }

  if (/(proximo mes|mes que vem)/.test(normalized)) {
    return buildCalendarMonthWindow(1, now);
  }

  const monthsMatch = normalized.match(/proxim(?:o|a|os|as)\s+(\d{1,2})\s+mes(?:es)?/);
  if (monthsMatch?.[1]) {
    const amount = Math.max(1, Math.min(12, Number(monthsMatch[1])));
    return buildRelativeMonthsWindow(amount, windowStart, now);
  }

  if (/(essa semana|esta semana|na semana)/.test(normalized)) {
    const window = buildDateWindow(7, 'today', now);
    return {
      mode: 'relative_days',
      amount: 7,
      windowStart: 'today',
      startDate: window.startDate,
      endDate: window.endDate,
      label: 'esta semana',
    };
  }

  if (/\bhoje\b/.test(normalized)) {
    const window = buildDateWindow(1, 'today', now);
    return {
      mode: 'relative_days',
      amount: 1,
      windowStart: 'today',
      startDate: window.startDate,
      endDate: window.endDate,
      label: 'hoje',
    };
  }

  if (/\bamanha\b/.test(normalized)) {
    const window = buildDateWindow(1, 'tomorrow', now);
    return {
      mode: 'relative_days',
      amount: 1,
      windowStart: 'tomorrow',
      startDate: window.startDate,
      endDate: window.endDate,
      label: 'amanhã',
    };
  }

  if (/primeiro\s+semestre/i.test(normalized)) {
    const year = now.getFullYear();
    return {
      mode: 'calendar_month',
      amount: 6,
      windowStart: 'today',
      startDate: formatYmd(year, 1, 1),
      endDate: formatYmd(year, 6, 30),
      label: `primeiro semestre de ${year}`,
    };
  }

  if (/segundo\s+semestre/i.test(normalized)) {
    const year = now.getFullYear();
    return {
      mode: 'calendar_month',
      amount: 6,
      windowStart: 'today',
      startDate: formatYmd(year, 7, 1),
      endDate: formatYmd(year, 12, 31),
      label: `segundo semestre de ${year}`,
    };
  }

  const daysMatch = normalized.match(/proxim(?:o|a|os|as)\s+(\d{1,2})\s+dias?/)
    || normalized.match(/(\d{1,2})\s+dias?\s+(?:a frente|adiante|seguintes)/)
    || normalized.match(/\bem\s+(\d{1,2})\s*dias?\b/);
  if (daysMatch?.[1]) {
    const amount = Math.max(1, Math.min(60, Number(daysMatch[1])));
    const window = buildDateWindow(amount, windowStart, now);
    return {
      mode: 'relative_days',
      amount,
      windowStart,
      startDate: window.startDate,
      endDate: window.endDate,
      label: windowStart === 'tomorrow'
        ? `a partir de amanhã, nos próximos ${amount} dias`
        : `nos próximos ${amount} dias`,
    };
  }

  if (/proxim(?:os|as)\s+dias/.test(normalized)) {
    const window = buildDateWindow(7, windowStart, now);
    return {
      mode: 'relative_days',
      amount: 7,
      windowStart,
      startDate: window.startDate,
      endDate: window.endDate,
      label: windowStart === 'tomorrow'
        ? 'a partir de amanhã, nos próximos 7 dias'
        : 'nos próximos 7 dias',
    };
  }

  return null;
}

export function inferTimeWindowFromEntities(
  entities: { days_ahead?: number; window_start?: 'today' | 'tomorrow'; months_ahead?: number },
  now = new Date(),
): ResolvedTimeWindow | null {
  if (entities.months_ahead) {
    return buildRelativeMonthsWindow(entities.months_ahead, entities.window_start || 'today', now);
  }
  if (entities.days_ahead) {
    const window = buildDateWindow(entities.days_ahead, entities.window_start || 'today', now);
    return {
      mode: 'relative_days',
      amount: entities.days_ahead,
      windowStart: entities.window_start || 'today',
      startDate: window.startDate,
      endDate: window.endDate,
      label: (entities.window_start || 'today') === 'tomorrow'
        ? `a partir de amanhã, nos próximos ${entities.days_ahead} dias`
        : `nos próximos ${entities.days_ahead} dias`,
    };
  }
  return null;
}

export function shiftTimeWindow(
  baseWindow: ResolvedTimeWindow,
  override: ResolvedTimeWindow,
): ResolvedTimeWindow {
  return {
    ...baseWindow,
    ...override,
  };
}

export function isSameTimeWindow(a?: ResolvedTimeWindow | null, b?: ResolvedTimeWindow | null): boolean {
  if (!a || !b) return false;
  return a.startDate === b.startDate && a.endDate === b.endDate && a.mode === b.mode;
}

export function describeTimeWindow(window: ResolvedTimeWindow): string {
  return window.label;
}

export function parseTimeWindowDate(date: string): Date {
  return parseYmd(date);
}
