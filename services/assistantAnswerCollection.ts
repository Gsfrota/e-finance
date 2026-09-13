/**
 * Consultas de cobrança do Assistente determinístico (BR-BOT-010).
 *
 * Duas perguntas: "quem está atrasado" (late_debtors) e "quanto tenho pra
 * receber" (receivables). Sem LLM: mesma pergunta ⇒ mesmo número, mesmo texto.
 * Formatação é função pura — testada em tests/unit/assistantAnswerCollection.test.ts.
 */

import { getSupabase, parseSupabaseError } from './supabase';
import { getBrazilToday, ymdToDM } from './dateUtils';
import type {
  AssistantCtx,
  AssistantReply,
  ReplyLine,
  ResolvedPeriod,
} from '../utils/assistantTypes';

/** Uma linha da lista de atrasados: cliente, quanto está em aberto e há quantos dias. */
export interface LateRow {
  name: string;
  openAmount: number;
  daysLate: number;
}

const formatBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Valor ainda devido de uma parcela: total + encargos - pago, nunca negativo. */
export function openAmountOf(inst: {
  amount_total?: number | null;
  fine_amount?: number | null;
  interest_delay_amount?: number | null;
  amount_paid?: number | null;
}): number {
  const devido =
    num(inst.amount_total) + num(inst.fine_amount) + num(inst.interest_delay_amount) - num(inst.amount_paid);
  return devido > 0 ? devido : 0;
}

/** Diferença em dias entre duas datas 'YYYY-MM-DD' (positiva quando `ymd` é passado). */
function daysBefore(ymd: string, todayYMD: string): number {
  const toUTC = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUTC(todayYMD) - toUTC(ymd)) / 86400000);
}

const ABERTAS = ['pending', 'late', 'partial'];
/** BR-REL-005: parcela de contrato encerrado/renovado não entra em bucket de cobrança. */
const CONTRATO_FORA = new Set(['completed', 'renewed']);

/** BR-REL-002: parcela fantasma (zerada e marcada como paga) nunca entra em métrica. */
const ehFantasma = (i: { amount_total?: number | null; amount_paid?: number | null; status?: string }) =>
  num(i.amount_total) === 0 && num(i.amount_paid) === 0 && i.status === 'paid';

const MAX_LISTADOS = 5;

/** Texto de chat dos atrasados. Função PURA — é o que os testes cobrem. */
export function formatLateDebtors(
  linhas: LateRow[],
  scopeLabel: string,
  detalhe: ReplyLine[] = []
): AssistantReply {
  const followUp = 'Quanto tenho pra receber essa semana?';

  if (linhas.length === 0) {
    return {
      text: `Ninguém está atrasado agora (${scopeLabel}). Todas as parcelas em aberto estão em dia.`,
      followUp,
    };
  }

  const ordenadas = [...linhas].sort((a, b) => b.openAmount - a.openAmount);
  const total = ordenadas.reduce((acc, l) => acc + l.openAmount, 0);
  const clientes = ordenadas.length === 1 ? 'cliente' : 'clientes';

  const partes = [
    `Você tem *${formatBRL(total)}* em atraso, de ${ordenadas.length} ${clientes} (${scopeLabel}).`,
    '',
    ...ordenadas
      .slice(0, MAX_LISTADOS)
      .map(l => `• ${l.name} — ${formatBRL(l.openAmount)}, há ${l.daysLate} ${l.daysLate === 1 ? 'dia' : 'dias'}`),
  ];

  const restantes = ordenadas.length - MAX_LISTADOS;
  if (restantes > 0) {
    partes.push(`...e mais ${restantes} ${restantes === 1 ? 'cliente' : 'clientes'}.`);
  }

  return {
    text: partes.join('\n'),
    followUp,
    ...detalheDe(detalhe, 'parcela atrasada', 'parcelas atrasadas'),
  };
}

/** Texto de chat dos recebíveis. Função PURA. */
export function formatReceivables(
  total: number,
  count: number,
  period: ResolvedPeriod,
  scopeLabel: string,
  detalhe: ReplyLine[] = []
): AssistantReply {
  const followUp = 'Quem está atrasado?';
  const janela = capitalize(period.label);

  if (count === 0) {
    return {
      text: `${janela} você não tem nada a receber — nenhuma parcela vence nessa janela (${scopeLabel}).`,
      followUp,
    };
  }

  const parcelas = count === 1 ? 'parcela' : 'parcelas';
  return {
    text: `${janela} você tem *${formatBRL(total)}* a receber, em ${count} ${parcelas} (${scopeLabel}).`,
    followUp,
    ...detalheDe(detalhe, 'parcela', 'parcelas'),
  };
}

// ponytail: uma query só, com o contrato embutido pra pegar o nome do pagador.
// O filtro de status do contrato fica em JS — evita depender de filtro em recurso
// embutido do PostgREST, que falha em silêncio quando a sintaxe muda.
const SELECT_COBRANCA = `
  id, investment_id, company_id, number, due_date, status,
  amount_total, amount_paid, fine_amount, interest_delay_amount,
  investment:investments!inner (
    status, total_installments,
    payer:profiles!investments_payer_id_fkey ( full_name )
  )
`;

interface RowCobranca {
  id: string;
  investment_id: number;
  company_id: string | null;
  number: number;
  due_date: string;
  status: string;
  amount_total: number | null;
  amount_paid: number | null;
  fine_amount: number | null;
  interest_delay_amount: number | null;
  investment: {
    status: string;
    total_installments: number | null;
    payer: { full_name: string | null } | null;
  } | null;
}

const nomeDe = (row: RowCobranca) => row.investment?.payer?.full_name || 'Sem nome';

/** Rótulo da parcela: "Parcela 2/4" quando o contrato diz quantas são. */
function rotuloParcela(row: RowCobranca): string {
  const total = row.investment?.total_installments;
  return total && total > 0 ? `Parcela ${row.number}/${total}` : `Parcela ${row.number}`;
}

/** Linha clicável de uma parcela, já com o valor em aberto daquela parcela. */
function linhaDeParcela(row: RowCobranca, sufixo: string): ReplyLine {
  return {
    key: row.id,
    investmentId: row.investment_id,
    companyId: row.company_id,
    title: nomeDe(row),
    subtitle: `${rotuloParcela(row)} · ${sufixo}`,
    amount: openAmountOf(row),
  };
}

/** Maior valor primeiro: o que decide a cobrança do dia aparece no topo. */
const porValorDesc = (a: ReplyLine, b: ReplyLine) => b.amount - a.amount;

/**
 * Bloco `details` da resposta, ou nada quando não há linha para abrir — assim
 * `{...detalheDe([])}` some do objeto em vez de virar `details: undefined`.
 */
export function detalheDe(
  linhas: ReplyLine[],
  singular: string,
  plural: string
): { details?: { label: string; lines: ReplyLine[] } } {
  if (linhas.length === 0) return {};
  const ordenadas = [...linhas].sort(porValorDesc);
  const n = ordenadas.length;
  return {
    details: {
      label: n === 1 ? `Ver a ${singular}` : `Ver as ${n} ${plural}`,
      lines: ordenadas,
    },
  };
}

/** "quem está atrasado" — foto do agora, sem período (BR-BOT-010). */
export async function answerLateDebtors(ctx: AssistantCtx): Promise<AssistantReply> {
  const hoje = getBrazilToday();

  let query = getSupabase()
    .from('loan_installments')
    .select(SELECT_COBRANCA)
    .eq('tenant_id', ctx.tenantId)
    .lt('due_date', hoje)
    .in('status', ABERTAS);
  if (ctx.companyId) query = query.eq('company_id', ctx.companyId);

  const { data, error } = await query;
  if (error) throw new Error(parseSupabaseError(error));

  const porCliente = new Map<string, LateRow>();
  const detalhe: ReplyLine[] = [];
  for (const row of (data ?? []) as unknown as RowCobranca[]) {
    if (CONTRATO_FORA.has(row.investment?.status ?? '')) continue;
    if (ehFantasma(row)) continue;
    const aberto = openAmountOf(row);
    if (aberto === 0) continue;

    const name = nomeDe(row);
    const dias = daysBefore(row.due_date, hoje);
    detalhe.push(
      linhaDeParcela(row, `venceu ${ymdToDM(row.due_date)} · ${dias} ${dias === 1 ? 'dia' : 'dias'}`)
    );
    const atual = porCliente.get(name);
    if (atual) {
      atual.openAmount += aberto;
      atual.daysLate = Math.max(atual.daysLate, dias);
    } else {
      porCliente.set(name, { name, openAmount: aberto, daysLate: dias });
    }
  }

  return formatLateDebtors([...porCliente.values()], ctx.scopeLabel, detalhe);
}

/** "quanto tenho pra receber" — parcelas a vencer dentro da janela (fim EXCLUSIVO). */
export async function answerReceivables(period: ResolvedPeriod, ctx: AssistantCtx): Promise<AssistantReply> {
  let query = getSupabase()
    .from('loan_installments')
    .select(SELECT_COBRANCA)
    .eq('tenant_id', ctx.tenantId)
    .gte('due_date', period.startYMD)
    .lt('due_date', period.endYMD)
    .in('status', ABERTAS);
  if (ctx.companyId) query = query.eq('company_id', ctx.companyId);

  const { data, error } = await query;
  if (error) throw new Error(parseSupabaseError(error));

  let total = 0;
  const detalhe: ReplyLine[] = [];
  for (const row of (data ?? []) as unknown as RowCobranca[]) {
    if (CONTRATO_FORA.has(row.investment?.status ?? '')) continue;
    if (ehFantasma(row)) continue;
    const aberto = openAmountOf(row);
    if (aberto === 0) continue;
    total += aberto;
    detalhe.push(linhaDeParcela(row, `vence ${ymdToDM(row.due_date)}`));
  }

  return formatReceivables(total, detalhe.length, period, ctx.scopeLabel, detalhe);
}
