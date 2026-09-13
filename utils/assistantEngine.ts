/**
 * Motor determinístico do Assistente (BR-BOT-009).
 *
 * Sem LLM: a pergunta é casada por regex e a resposta é soma de coluna.
 * Funções puras — testadas em tests/unit/assistantEngine.test.ts.
 */

export type AssistantIntent = 'lent_volume' | 'unknown';

/** Períodos que o motor NÃO sabe responder — citá-los vira 'unknown' em vez de virar semana. */
const UNSUPPORTED_PERIOD = /\b(hoje|ontem|amanha|mes|meses|mensal|ano|anual|semestre|trimestre|quinzena|ultimo mes|mes passado)\b/;

const VOLUME_INTENT = /\b(quanto|total|volume|soma)\b/;
const LENDING_VERB = /(emprest|invest|apliquei|coloquei na rua|botei na rua)/;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classifica a pergunta do usuário. Nunca chuta: o que não casa vira 'unknown'. */
export function matchAssistantIntent(text: string): AssistantIntent {
  const normalized = normalize(text ?? '');
  if (!normalized) return 'unknown';
  if (UNSUPPORTED_PERIOD.test(normalized)) return 'unknown';
  if (VOLUME_INTENT.test(normalized) && LENDING_VERB.test(normalized)) return 'lent_volume';
  return 'unknown';
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
