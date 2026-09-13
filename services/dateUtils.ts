/**
 * Utilitários de data com fuso horário America/Sao_Paulo.
 *
 * REGRA (BR-TZ-001): toda computação de "hoje" e comparação de datas no frontend
 * deve usar estas funções. Proibido usar toISOString().split('T')[0] para data
 * atual (retorna UTC) ou new Date().getFullYear()/.getDate() sem timezone explícito.
 */

const BRAZIL_TZ = 'America/Sao_Paulo';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BRAZIL_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getDatePartsInBrazil(date: Date): { year: number; month: number; day: number } {
  const parts = formatter.formatToParts(date);
  return {
    year: Number(parts.find(p => p.type === 'year')?.value ?? 0),
    month: Number(parts.find(p => p.type === 'month')?.value ?? 0),
    day: Number(parts.find(p => p.type === 'day')?.value ?? 0),
  };
}

function padYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Converte um Date para 'YYYY-MM-DD' no fuso America/Sao_Paulo. */
export function toBrazilYMD(date: Date): string {
  const { year, month, day } = getDatePartsInBrazil(date);
  return padYMD(year, month, day);
}

/** Retorna a data de hoje em 'YYYY-MM-DD' no fuso America/Sao_Paulo. */
export function getBrazilToday(): string {
  return toBrazilYMD(new Date());
}

/** Converte uma ISO string (ex: paid_at do Supabase) para 'YYYY-MM-DD' em BRT. */
export function isoToBrazilYMD(iso: string): string {
  return toBrazilYMD(new Date(iso));
}

/**
 * Soma `days` dias a uma data 'YYYY-MM-DD' e retorna 'YYYY-MM-DD' em BRT.
 * Seguro para cruzar meia-noite e limites de mês/ano.
 */
export function addDaysBR(baseYMD: string, days: number): string {
  // Parsear como meia-noite local (sem shift UTC)
  const [y, m, d] = baseYMD.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return toBrazilYMD(date);
}

/**
 * Retorna os limites do mês corrente em America/Sao_Paulo.
 * startISO/endISO são timestamps UTC prontos para queries no Supabase.
 */
export function getMonthRangeBR(): {
  startISO: string;
  endISO: string;
  startYMD: string;
  endYMD: string;
} {
  const now = new Date();
  const { year, month } = getDatePartsInBrazil(now);

  // Meia-noite BRT = 03:00 UTC (BRT = UTC-3)
  const start = new Date(Date.UTC(year, month - 1, 1, 3, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 3, 0, 0));

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    startYMD: padYMD(year, month, 1),
    endYMD: padYMD(nextYear, nextMonth, 1),
  };
}

export interface DateRangeBR {
  startISO: string;
  endISO: string;
  startYMD: string;
  endYMD: string;
}

/**
 * Janela [hoje+startOffset 00:00 BRT, hoje+endOffset 00:00 BRT), como timestamps UTC
 * prontos para query. Fim EXCLUSIVO. Meia-noite BRT = 03:00 UTC.
 */
export function getDayWindowBR(now: Date, startOffset: number, endOffset: number): DateRangeBR {
  const { year, month, day } = getDatePartsInBrazil(now);
  const start = new Date(Date.UTC(year, month - 1, day + startOffset, 3, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day + endOffset, 3, 0, 0));
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    startYMD: toBrazilYMD(start),
    endYMD: toBrazilYMD(end),
  };
}

/**
 * Intervalo [hoje - offsetDays, amanhã) em BRT, como timestamps UTC prontos para query.
 * Meia-noite BRT = 03:00 UTC.
 */
function rangeEndingTodayBR(now: Date, offsetDays: number): DateRangeBR {
  return getDayWindowBR(now, -offsetDays, 1);
}

/**
 * Semana corrente: segunda-feira 00:00 BRT até o fim de hoje (BR-BOT-009).
 * Mossoró/RN é o mesmo UTC-3 de São Paulo (sem horário de verão desde 2019).
 */
export function getWeekToDateRangeBR(now: Date = new Date()): DateRangeBR {
  const { year, month, day } = getDatePartsInBrazil(now);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=domingo
  const daysSinceMonday = (weekday + 6) % 7;
  return rangeEndingTodayBR(now, daysSinceMonday);
}

/**
 * Restante da semana: hoje 00:00 BRT até segunda 00:00 BRT (BR-BOT-010).
 * Usado por "a receber essa semana" — recebível olha pra frente, então da semana
 * corrente só interessa o que ainda vai vencer. No domingo devolve só hoje.
 */
export function getWeekRemainderRangeBR(now: Date = new Date()): DateRangeBR {
  const { year, month, day } = getDatePartsInBrazil(now);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=domingo
  const daysSinceMonday = (weekday + 6) % 7;
  return getDayWindowBR(now, 0, 7 - daysSinceMonday);
}

/** 'YYYY-MM-DD' -> 'DD/MM', para rótulo curto de vencimento. */
export function ymdToDM(ymd: string): string {
  const [, month, day] = ymd.split('-');
  return `${day}/${month}`;
}

/** Últimos 7 dias: hoje-6 00:00 BRT até o fim de hoje (BR-BOT-009). */
export function getLast7DaysRangeBR(now: Date = new Date()): DateRangeBR {
  return rangeEndingTodayBR(now, 6);
}

/**
 * Mês corrente até o fim de hoje: dia 1 00:00 BRT → amanhã 00:00 BRT (BR-BOT-010).
 * Difere de getMonthRangeBR(), que vai até o fim do mês (inclui futuro).
 */
export function getMonthToDateRangeBR(now: Date = new Date()): DateRangeBR {
  const { day } = getDatePartsInBrazil(now);
  return getDayWindowBR(now, -(day - 1), 1);
}
