/**
 * Camada de resposta em TEXTO do Assistente (BR-BOT-009).
 *
 * O motor (utils/assistantEngine.ts) classifica e soma; aqui só viram frase de chat.
 * Formatação é função pura — testada em tests/unit/assistantAnswer.test.ts.
 */

import { getSupabase, parseSupabaseError } from './supabase';
import { getWeekToDateRangeBR, getLast7DaysRangeBR } from './dateUtils';
import { matchAssistantIntent, sumLentInRange, type LentRow } from '../utils/assistantEngine';

export interface LentVolumeAnswer {
  week: { total: number; count: number; startYMD: string };
  last7: { total: number; count: number; startYMD: string };
}

const formatBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

/** 'YYYY-MM-DD' -> 'DD/MM' */
const formatDM = (ymd: string) => {
  const [, month, day] = ymd.split('-');
  return `${day}/${month}`;
};

const linha = (titulo: string, periodo: string, dado: { total: number; count: number }) => {
  const cabecalho = `*${titulo}* (${periodo})`;
  if (dado.count === 0) {
    return `${cabecalho}\nNenhum contrato cadastrado nesse período — ${formatBRL(0)}`;
  }
  const plural = dado.count === 1 ? 'contrato' : 'contratos';
  return `${cabecalho}\n${formatBRL(dado.total)} em ${dado.count} ${plural}`;
};

/** Formata a resposta em texto de chat. Função PURA — é o que os testes cobrem. */
export function formatLentVolumeAnswer(data: LentVolumeAnswer, scopeLabel: string): string {
  return [
    `Volume emprestado — ${scopeLabel}:`,
    '',
    linha('Semana corrente', `segunda ${formatDM(data.week.startYMD)} até hoje`, data.week),
    '',
    linha('Últimos 7 dias', `${formatDM(data.last7.startYMD)} até hoje`, data.last7),
    '',
    'Renovações contam como empréstimo. Soma pela data de cadastro do contrato.',
  ].join('\n');
}

/** Texto de recusa quando a pergunta não é reconhecida. Função PURA. */
export function formatUnknownAnswer(): string {
  return [
    'Não entendi a pergunta.',
    '',
    'Hoje eu sei responder só uma coisa: quanto você emprestou na semana (semana corrente e últimos 7 dias).',
    'Ex.: "quanto emprestei essa semana?"',
  ].join('\n');
}

/** Busca no Supabase e devolve o texto pronto pro chat. */
export async function answerAssistantQuestion(
  question: string,
  ctx: { tenantId: string; companyId: string | null; scopeLabel: string }
): Promise<string> {
  if (matchAssistantIntent(question) !== 'lent_volume') {
    return formatUnknownAnswer(); // nunca consulta o banco sem intenção reconhecida
  }

  const week = getWeekToDateRangeBR();
  const last7 = getLast7DaysRangeBR();
  // Uma leitura só: a janela maior cobre as duas
  const fromISO = week.startISO < last7.startISO ? week.startISO : last7.startISO;

  let query = getSupabase()
    .from('investments')
    .select('amount_invested, created_at')
    .eq('tenant_id', ctx.tenantId)
    .gte('created_at', fromISO)
    .lt('created_at', week.endISO);
  if (ctx.companyId) query = query.eq('company_id', ctx.companyId);

  const { data, error } = await query;
  if (error) throw new Error(parseSupabaseError(error));

  const rows = (data ?? []) as LentRow[];
  return formatLentVolumeAnswer(
    {
      week: { ...sumLentInRange(rows, week.startISO, week.endISO), startYMD: week.startYMD },
      last7: { ...sumLentInRange(rows, last7.startISO, last7.endISO), startYMD: last7.startYMD },
    },
    ctx.scopeLabel
  );
}
