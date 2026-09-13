/**
 * Volume emprestado, em texto de chat (BR-BOT-009 / BR-BOT-010).
 *
 * O motor (utils/assistantEngine.ts) classifica e soma; aqui só vira frase.
 * Formatação é função pura — testada em tests/unit/assistantAnswer.test.ts.
 */

import { getSupabase, parseSupabaseError } from './supabase';
import { getWeekToDateRangeBR, getLast7DaysRangeBR, isoToBrazilYMD, ymdToDM } from './dateUtils';
import { detalheDe } from './assistantAnswerCollection';
import { sumLentInRange, type LentRow } from '../utils/assistantEngine';
import type {
  AssistantCtx,
  AssistantReply,
  ReplyLine,
  ResolvedPeriod,
} from '../utils/assistantTypes';

export interface LentVolumeAnswer {
  week: { total: number; count: number; startYMD: string };
  last7: { total: number; count: number; startYMD: string };
}

const formatBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDM = ymdToDM;

const contratos = (n: number) => `${n} ${n === 1 ? 'contrato' : 'contratos'}`;

const linha = (titulo: string, periodo: string, dado: { total: number; count: number }) => {
  const cabecalho = `*${titulo}* (${periodo})`;
  if (dado.count === 0) {
    return `${cabecalho}\nNenhum contrato cadastrado nesse período — ${formatBRL(0)}`;
  }
  return `${cabecalho}\n${formatBRL(dado.total)} em ${contratos(dado.count)}`;
};

/** Resposta padrão (sem período na pergunta): as duas janelas juntas. Função PURA. */
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

/** Resposta quando a pergunta cita um período específico. Função PURA. */
export function formatLentVolumePeriod(
  dado: { total: number; count: number },
  period: ResolvedPeriod,
): string {
  if (dado.count === 0) {
    return `${capitalizar(period.label)} você não cadastrou nenhum contrato.`;
  }
  return `${capitalizar(period.label)} você emprestou *${formatBRL(dado.total)}*, em ${contratos(dado.count)}.\n\nRenovações contam como empréstimo.`;
}

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Texto de recusa: diz o que ele SABE responder. Função PURA. */
export function formatUnknownAnswer(): string {
  return [
    'Não entendi a pergunta.',
    '',
    'Por enquanto eu respondo:',
    '• quanto você emprestou num período',
    '• quem está atrasado',
    '• quanto tem pra receber',
    '• quanto entrou',
    '• quanto um cliente deve',
    '',
    'Ex.: "quanto emprestei essa semana?"',
  ].join('\n');
}

export function formatUnknownReply(): AssistantReply {
  return { text: formatUnknownAnswer(), followUp: 'Quem está atrasado?' };
}

export interface ContratoRow extends LentRow {
  id: number;
  company_id: string | null;
  asset_name: string | null;
  profiles: { full_name: string | null } | null;
}

/** Um contrato por linha, com quem pegou e quando foi cadastrado. Função PURA. */
export function linhasDeContratos(rows: ContratoRow[], startISO: string, endISO: string): ReplyLine[] {
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  const linhas: ReplyLine[] = [];
  for (const row of rows) {
    if (!row.created_at) continue;
    const at = Date.parse(row.created_at);
    if (Number.isNaN(at) || at < start || at >= end) continue;
    linhas.push({
      key: String(row.id),
      investmentId: Number(row.id),
      companyId: row.company_id ?? null,
      title: row.profiles?.full_name || row.asset_name || 'Sem nome',
      subtitle: `Cadastrado em ${formatDM(isoToBrazilYMD(row.created_at))}`,
      amount: Number(row.amount_invested ?? 0),
    });
  }
  return linhas;
}

/**
 * Busca no Supabase e devolve a resposta pronta.
 * `period` nulo = comportamento padrão de BR-BOT-009 (semana corrente + últimos 7 dias).
 */
export async function answerLentVolume(
  period: ResolvedPeriod | null,
  ctx: AssistantCtx,
): Promise<AssistantReply> {
  const week = getWeekToDateRangeBR();
  const last7 = getLast7DaysRangeBR();
  const fromISO = period
    ? period.startISO
    : (week.startISO < last7.startISO ? week.startISO : last7.startISO);
  const toISO = period ? period.endISO : week.endISO;

  let query = getSupabase()
    .from('investments')
    .select(
      'id, company_id, amount_invested, created_at, asset_name, ' +
        'profiles!investments_payer_id_fkey(full_name)'
    )
    .eq('tenant_id', ctx.tenantId)
    .gte('created_at', fromISO)
    .lt('created_at', toISO);
  if (ctx.companyId) query = query.eq('company_id', ctx.companyId);

  const { data, error } = await query;
  if (error) throw new Error(parseSupabaseError(error));

  const rows = (data ?? []) as unknown as ContratoRow[];
  const followUp = 'Quem está atrasado?';

  if (period) {
    return {
      text: formatLentVolumePeriod(sumLentInRange(rows, period.startISO, period.endISO), period),
      followUp,
      ...detalheDe(linhasDeContratos(rows, period.startISO, period.endISO), 'contrato', 'contratos'),
    };
  }

  // O par de janelas se sobrepõe; a lista mostra a união, que é o que a query trouxe.
  const inicio = week.startISO < last7.startISO ? week.startISO : last7.startISO;
  return {
    text: formatLentVolumeAnswer(
      {
        week: { ...sumLentInRange(rows, week.startISO, week.endISO), startYMD: week.startYMD },
        last7: { ...sumLentInRange(rows, last7.startISO, last7.endISO), startYMD: last7.startYMD },
      },
      ctx.scopeLabel,
    ),
    followUp,
    ...detalheDe(linhasDeContratos(rows, inicio, week.endISO), 'contrato', 'contratos'),
  };
}
