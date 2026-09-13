/**
 * Motor determinístico do Assistente (BR-BOT-009 / BR-BOT-010).
 *
 * Sem LLM: a pergunta é casada por regex e a resposta é soma de coluna.
 * Funções puras — testadas em tests/unit/assistantEngine.test.ts.
 */

import {
  getDayWindowBR,
  getLast7DaysRangeBR,
  getMonthToDateRangeBR,
  getWeekRemainderRangeBR,
  getWeekToDateRangeBR,
} from '../services/dateUtils';
import type { AssistantIntent, AssistantMatch, PeriodKind, ResolvedPeriod } from './assistantTypes';

export type { AssistantIntent, AssistantMatch, PeriodKind, ResolvedPeriod };

/** Períodos que o motor NÃO sabe responder — citá-los vira 'unknown' em vez de virar semana. */
const UNSUPPORTED_PERIOD = /\b(hoje|ontem|amanha|mes|meses|mensal|ano|anual|semestre|trimestre|quinzena|ultimo mes|mes passado)\b/;

const VOLUME_INTENT = /\b(quanto|total|volume|soma)\b/;
const LENDING_VERB = /(emprest|invest|apliquei|coloquei na rua|botei na rua)/;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Período (BR-BOT-010)
// ---------------------------------------------------------------------------

/**
 * Períodos fora do catálogo. Citar um deles derruba a intent inteira para
 * 'unknown' — recusar é a regra; usar outra janela em silêncio seria mentir.
 */
const UNSUPPORTED_PERIOD_PHRASE =
  /\b(anos?|anual|semestre|semestral|trimestre|trimestral|bimestre|quinzena|quinzenal|decada|amanha|anteontem)\b|\b(mes|semana)\s+(passad[ao]|retrasad[ao])\b|\bmes que vem\b|\bultim[oa]s?\s+(mes|meses|semana|semanas|ano|anos)\b|\bproxim[oa]s?\s+(mes|meses|ano|anos|semestre|quinzena)\b/;

const MIN_DAYS = 1;
const MAX_DAYS = 365;

interface PeriodHit {
  kind: PeriodKind;
  n?: number;
}

function detectPeriod(t: string): PeriodHit | null | 'unsupported' {
  if (UNSUPPORTED_PERIOD_PHRASE.test(t)) return 'unsupported';

  const last = t.match(/\bultimos?\s+(\d{1,4})\s+dias?\b/);
  if (last) {
    const n = Number(last[1]);
    if (n < MIN_DAYS || n > MAX_DAYS) return 'unsupported';
    return n === 7 ? { kind: 'last_7_days' } : { kind: 'last_n_days', n };
  }

  const next = t.match(/\bproximos?\s+(\d{1,4})\s+dias?\b/);
  if (next) {
    const n = Number(next[1]);
    if (n < MIN_DAYS || n > MAX_DAYS) return 'unsupported';
    return n === 7 ? { kind: 'next_7_days' } : { kind: 'next_n_days', n };
  }

  if (/\b(proxima semana|semana que vem)\b/.test(t)) return { kind: 'next_7_days' };
  if (/\bhoje\b/.test(t)) return { kind: 'today' };
  if (/\bontem\b/.test(t)) return { kind: 'yesterday' };
  if (/\b(essa|esta|nessa|nesta|na|da)\s+semana\b/.test(t) || /\bsemana atual\b/.test(t)) {
    return { kind: 'current_week' };
  }
  if (/\b(esse|este|nesse|neste|no|do)\s+mes\b/.test(t) || /\bmes atual\b/.test(t)) {
    return { kind: 'current_month' };
  }
  return null;
}

function clampDays(n: number | undefined): number {
  const days = Math.trunc(n ?? 7);
  if (!Number.isFinite(days) || days < MIN_DAYS) return MIN_DAYS;
  return days > MAX_DAYS ? MAX_DAYS : days;
}

/** Traduz o período citado em janela UTC (`endISO` EXCLUSIVO) + rótulo em PT-BR. */
export function resolvePeriod(kind: PeriodKind, now: Date = new Date(), n?: number): ResolvedPeriod {
  const days = clampDays(n);

  switch (kind) {
    case 'today':
      return { kind, label: 'hoje', ...getDayWindowBR(now, 0, 1) };
    case 'yesterday':
      return { kind, label: 'ontem', ...getDayWindowBR(now, -1, 0) };
    case 'current_week':
      return { kind, label: 'esta semana', ...getWeekToDateRangeBR(now) };
    case 'last_7_days':
      return { kind, label: 'nos últimos 7 dias', ...getLast7DaysRangeBR(now) };
    case 'current_month':
      return { kind, label: 'neste mês', ...getMonthToDateRangeBR(now) };
    case 'last_n_days':
      return {
        kind,
        label: days === 1 ? 'no último dia' : `nos últimos ${days} dias`,
        ...getDayWindowBR(now, -(days - 1), 1),
      };
    case 'week_remainder':
      return { kind, label: 'até o fim da semana', ...getWeekRemainderRangeBR(now) };
    case 'next_7_days':
      return { kind, label: 'nos próximos 7 dias', ...getDayWindowBR(now, 0, 7) };
    case 'next_n_days':
      return {
        kind,
        label: days === 1 ? 'no próximo dia' : `nos próximos ${days} dias`,
        ...getDayWindowBR(now, 0, days),
      };
  }
}

// ---------------------------------------------------------------------------
// Intents (BR-BOT-010)
// ---------------------------------------------------------------------------

const LATE_DEBTORS =
  /(atrasad|inadimplent|quem nao pagou|quem nao me pagou|nao pagaram|devo cobrar|preciso cobrar|quem cobrar|cobrar hoje|em atraso|quem (?:ainda )?me deve|quem (?:esta|ta) devendo|quem deve)/;

const RECEIVABLES =
  /(pra receber|para receber|vou receber|a receber|tenho que receber|recebivel|recebiveis|o que vence|que vence|quanto vence|vai vencer|quanto entra)/;

// 'pagou/pagaram/foi pago' entram aqui, mas LATE_DEBTORS é testado antes e fica com
// "quem não pagou" — a ordem de detectIntent é que separa os dois.
const RECEIVED =
  /\b(recebi|recebemos|entrou|caiu|recebimento|recebimentos|pagaram|pagou|foi pago|foram pagos)\b/;

/** Preposição/pronome que gruda no nome — some das pontas antes de devolver `debtorName`. */
const NAME_STOPWORDS = new Set([
  'quanto', 'quantos', 'qual', 'que', 'o', 'a', 'os', 'as', 'do', 'da', 'de', 'dos', 'das',
  'eu', 'ja', 'ainda', 'me', 'mim', 'sr', 'sra', 'senhor', 'senhora', 'dona', 'seu', 'sua',
  'cliente', 'pro', 'pra', 'para', 'no', 'na', 'e', 'com', 'saldo', 'falta', 'deve', 'devendo',
  // interrogativo nunca é nome: sem isto, "quem me deve?" virava busca pelo cliente "quem"
  'quem', 'quantas', 'quais', 'quanta',
]);

const DEBTOR_PATTERNS: RegExp[] = [
  /\bsaldo\s+(?:do|da|de|dos|das|d[oa])?\s*([a-z0-9][a-z0-9 ]*)$/,
  /([a-z0-9][a-z0-9 ]*?)\s+(?:ainda\s+)?me deve\b/,
  /\bquanto falta\s+([a-z0-9][a-z0-9 ]*?)\s+(?:pagar|quitar)\b/,
  /([a-z0-9][a-z0-9 ]*?)\s+deve quanto\b/,
  /\bquanto\s+(?:o|a|que o|que a)?\s*([a-z0-9][a-z0-9 ]*?)\s+(?:ainda\s+)?deve\b/,
  /\bquanto\s+(?:o|a)?\s*([a-z0-9][a-z0-9 ]*?)\s+(?:esta|ta)\s+devendo\b/,
];

function cleanDebtorName(raw: string): string {
  const words = raw.split(' ').filter(Boolean);
  while (words.length && NAME_STOPWORDS.has(words[0])) words.shift();
  while (words.length && NAME_STOPWORDS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/** Nome do cliente citado, já normalizado (sem acento, sem caixa). '' quando não dá para extrair. */
function extractDebtorName(t: string): string {
  for (const pattern of DEBTOR_PATTERNS) {
    const match = t.match(pattern);
    if (!match) continue;
    const name = cleanDebtorName(match[1]);
    if (name) return name;
  }
  return '';
}

function detectIntent(t: string): AssistantIntent {
  if (VOLUME_INTENT.test(t) && LENDING_VERB.test(t)) return 'lent_volume';
  if (LATE_DEBTORS.test(t)) return 'late_debtors';
  if (RECEIVABLES.test(t)) return 'receivables';
  if (RECEIVED.test(t)) return 'received';
  if (extractDebtorName(t)) return 'debtor_balance';
  return 'unknown';
}

/**
 * Classifica a pergunta e resolve o período citado. Nunca chuta: o que não casa
 * vira 'unknown', e período fora do catálogo derruba a intent (BR-BOT-010).
 * Determinística: mesma frase + mesmo `now` ⇒ mesmo resultado.
 */
export function matchAssistant(text: string, now: Date = new Date()): AssistantMatch {
  const t = normalize(text ?? '');
  if (!t) return { intent: 'unknown', period: null };

  const hit = detectPeriod(t);
  if (hit === 'unsupported') return { intent: 'unknown', period: null };

  const intent = detectIntent(t);
  if (intent === 'unknown') return { intent: 'unknown', period: null };

  const period = hit ? resolvePeriod(hit.kind, now, hit.n) : null;
  if (intent !== 'debtor_balance') return { intent, period };

  return { intent, period, debtorName: extractDebtorName(t) };
}

export interface LentRow {
  amount_invested: number | string | null;
  created_at: string | null;
}

export interface LentTotal {
  total: number;
  count: number;
}

/**
 * Soma amount_invested das linhas com created_at em [startISO, endISO).
 * Renovações contam (BR-BOT-009) — nenhum filtro por parent_investment_id ou status.
 */
export function sumLentInRange(rows: LentRow[], startISO: string, endISO: string): LentTotal {
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  let total = 0;
  let count = 0;

  for (const row of rows) {
    if (!row.created_at) continue;
    const at = Date.parse(row.created_at);
    if (Number.isNaN(at) || at < start || at >= end) continue;
    total += Number(row.amount_invested ?? 0);
    count += 1;
  }

  // ponytail: arredonda só na saída; centavos de float não viram erro de exibição
  return { total: Math.round(total * 100) / 100, count };
}
