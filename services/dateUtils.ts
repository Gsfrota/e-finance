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
