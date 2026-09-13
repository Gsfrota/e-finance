/**
 * Consultas de dinheiro do Assistente determinístico (BR-BOT-010):
 * `received` ("quanto recebi") e `debtor_balance` ("quanto o Fulano me deve").
 *
 * Sem LLM: mesma pergunta ⇒ mesmo número, mesmo texto.
 * Formatação é função pura — testada em tests/unit/assistantAnswerMoney.test.ts.
 */

import { getSupabase, parseSupabaseError } from './supabase';
import { getBrazilToday } from './dateUtils';
import type { AssistantCtx, AssistantReply, ResolvedPeriod } from '../utils/assistantTypes';

const formatBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

/** 'YYYY-MM-DD' -> 'DD/MM' */
const formatDM = (ymd: string) => {
  const [, month, day] = ymd.split('-');
  return `${day}/${month}`;
};

const num = (val: any): number => {
  const n = Number(val ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** minúsculo, sem acento, sem espaço duplo — para casar nome digitado com cadastro */
const normalizeName = (text: unknown): string =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Em aberto de uma parcela: obrigação + encargos - pago, nulls como 0 e mínimo 0. Função PURA. */
export const installmentOpenAmount = (row: {
  amount_total?: any;
  fine_amount?: any;
  interest_delay_amount?: any;
  amount_paid?: any;
}): number =>
  Math.max(
    0,
    num(row.amount_total) + num(row.fine_amount) + num(row.interest_delay_amount) - num(row.amount_paid)
  );

/** BR-REL-002: parcela fantasma (deferida e zerada) nunca entra em métrica financeira. */
const isPhantom = (row: { amount_total?: any; amount_paid?: any; status?: string | null }) =>
  num(row.amount_total) === 0 && num(row.amount_paid) === 0 && row.status === 'paid';

// ---------------------------------------------------------------- formatação

/** "Hoje entraram *R$ 3.200,00* em 5 pagamentos (escopo)." Função PURA. */
export function formatReceived(
  total: number,
  count: number,
  period: ResolvedPeriod,
  scopeLabel: string
): AssistantReply {
  const followUp = 'Quem está atrasado?';
  if (count === 0) {
    return { text: `Nenhum pagamento entrou ${period.label} (${scopeLabel}).`, followUp };
  }
  const plural = count === 1 ? 'pagamento' : 'pagamentos';
  return {
    text: `${capitalize(period.label)} entraram *${formatBRL(total)}* em ${count} ${plural} (${scopeLabel}).`,
    followUp,
  };
}

/** "João da Silva tem *R$ 8.450,00* em aberto, em 2 contratos. O próximo vencimento é 15/09." Função PURA. */
export function formatDebtorBalance(
  nome: string,
  saldo: number,
  contratosAtivos: number,
  proximoVencimentoYMD: string | null
): AssistantReply {
  const followUp = 'Quanto tenho pra receber essa semana?';
  if (saldo <= 0) {
    return { text: `${nome} não tem nada em aberto.`, followUp };
  }
  const plural = contratosAtivos === 1 ? 'contrato' : 'contratos';
  const contratos = contratosAtivos > 0 ? `, em ${contratosAtivos} ${plural}` : '';
  // sem próximo vencimento a frase some — nunca escrever "null"
  const vencimento = proximoVencimentoYMD
    ? ` O próximo vencimento é ${formatDM(proximoVencimentoYMD)}.`
    : '';
  return {
    text: `${nome} tem *${formatBRL(saldo)}* em aberto${contratos}.${vencimento}`,
    followUp,
  };
}

/** Nome sem cadastro ≠ cliente sem dívida: nunca responder R$ 0,00 aqui (BR-BOT-010). */
export function formatDebtorNotFound(nomeBuscado: string): AssistantReply {
  return {
    text: `Não achei nenhum cliente chamado "${nomeBuscado}" no cadastro. Confere o nome e pergunta de novo.`,
  };
}

/** Ambiguidade nunca é resolvida sozinha (BR-BOT-010): devolve a lista e pede para escolher. */
export function formatDebtorAmbiguous(nomeBuscado: string, candidatos: string[]): AssistantReply {
  return {
    text: `Achei ${candidatos.length} clientes com "${nomeBuscado}": ${candidatos.join(', ')}. Qual deles?`,
  };
}

// ---------------------------------------------------------------- consultas

/** Soma amount_paid das parcelas pagas dentro da janela (BR-BOT-010). */
export async function answerReceived(
  period: ResolvedPeriod,
  ctx: AssistantCtx
): Promise<AssistantReply> {
  let query = getSupabase()
    .from('loan_installments')
    .select('amount_paid, amount_total, status')
    .eq('tenant_id', ctx.tenantId)
    .gte('paid_at', period.startISO)
    .lt('paid_at', period.endISO)
    .gt('amount_paid', 0);
  if (ctx.companyId) query = query.eq('company_id', ctx.companyId);

  const { data, error } = await query;
  if (error) throw new Error(parseSupabaseError(error));

  const rows = (data ?? []) as any[];
  let total = 0;
  let count = 0;
  for (const row of rows) {
    if (isPhantom(row)) continue; // BR-REL-002 (redundante com amount_paid > 0, mas explícito)
    total += num(row.amount_paid);
    count += 1;
  }
  return formatReceived(total, count, period, ctx.scopeLabel);
}

/** Saldo em aberto de um cliente, casando o nome por parte, sem acento e sem caixa. */
export async function answerDebtorBalance(
  nome: string,
  ctx: AssistantCtx
): Promise<AssistantReply> {
  const supabase = getSupabase();
  const alvo = normalizeName(nome);
  if (!alvo) return formatDebtorNotFound(nome);

  // ponytail: filtro do nome em JS — ilike do Postgres não ignora acento e a lista
  // de devedores de um tenant é pequena. Se virar milhares, criar índice unaccent.
  //
  // O cadastro NÃO é filtrado por empresa de propósito: `profiles.company_id` é nulo
  // em cliente antigo, enquanto o contrato dele carrega a empresa. Filtrar aqui fazia
  // o assistente listar o cliente em "quem está atrasado" (escopo vindo da parcela) e
  // negar a existência dele em "quanto fulano me deve". O escopo de empresa vem das
  // parcelas, logo abaixo.
  const { data: perfilData, error: perfilError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('tenant_id', ctx.tenantId)
    .eq('role', 'debtor');
  if (perfilError) throw new Error(parseSupabaseError(perfilError));

  const candidatos = ((perfilData ?? []) as any[])
    .filter((p) => normalizeName(p.full_name).includes(alvo));

  if (candidatos.length === 0) return formatDebtorNotFound(nome);
  if (candidatos.length > 1) {
    return formatDebtorAmbiguous(
      nome,
      candidatos.map((p) => String(p.full_name ?? 'sem nome'))
    );
  }

  const cliente = candidatos[0];
  let parcelas = supabase
    .from('loan_installments')
    .select(
      'investment_id, due_date, amount_total, amount_paid, fine_amount, interest_delay_amount, status, investments!inner(payer_id, status)'
    )
    .eq('tenant_id', ctx.tenantId)
    .in('status', ['pending', 'late', 'partial'])
    .eq('investments.payer_id', cliente.id)
    .not('investments.status', 'in', '(completed,renewed)');
  if (ctx.companyId) parcelas = parcelas.eq('company_id', ctx.companyId);

  const { data: parcelaData, error: parcelaError } = await parcelas;
  if (parcelaError) throw new Error(parseSupabaseError(parcelaError));

  const hoje = getBrazilToday();
  const contratos = new Set<any>();
  let saldo = 0;
  let proximo: string | null = null;

  for (const row of (parcelaData ?? []) as any[]) {
    if (isPhantom(row)) continue; // BR-REL-002
    saldo += installmentOpenAmount(row);
    contratos.add(row.investment_id);
    if (row.due_date && row.due_date >= hoje && (proximo === null || row.due_date < proximo)) {
      proximo = row.due_date;
    }
  }

  return formatDebtorBalance(
    String(cliente.full_name ?? nome),
    saldo,
    contratos.size,
    proximo
  );
}
