/**
 * Consultas de dinheiro do Assistente determinístico (BR-BOT-010):
 * `received` ("quanto recebi") e `debtor_balance` ("quanto o Fulano me deve").
 *
 * Sem LLM: mesma pergunta ⇒ mesmo número, mesmo texto.
 * Formatação é função pura — testada em tests/unit/assistantAnswerMoney.test.ts.
 */

import { getSupabase, parseSupabaseError } from './supabase';
import { getBrazilToday, ymdToDM, isoToBrazilYMD } from './dateUtils';
import { detalheDe } from './assistantAnswerCollection';
import type {
  AssistantCtx,
  AssistantReply,
  ReplyLine,
  ResolvedPeriod,
} from '../utils/assistantTypes';

const formatBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const num = (val: any): number => {
  const n = Number(val ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * O digitado casa com o cadastro se um contém o outro. Os dois sentidos importam:
 * o dono escreve o apelido ("João da Silva bom bom") sobre um cadastro mais curto,
 * e escreve o primeiro nome ("joão") sobre um cadastro mais longo.
 */
export const nomeCasa = (cadastro: string, alvo: string): boolean => {
  const c = normalizeName(cadastro);
  const a = normalizeName(alvo);
  if (!c || !a) return false;
  return c.includes(a) || a.includes(c);
};

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

/** "Parcela 2/4" quando o contrato informa o total; senão só o número. */
const rotuloParcela = (row: { number?: any; investments?: { total_installments?: any } | null }) => {
  const total = Number(row.investments?.total_installments ?? 0);
  return total > 0 ? `Parcela ${row.number}/${total}` : `Parcela ${row.number}`;
};

/** BR-REL-002: parcela fantasma (deferida e zerada) nunca entra em métrica financeira. */
const isPhantom = (row: { amount_total?: any; amount_paid?: any; status?: string | null }) =>
  num(row.amount_total) === 0 && num(row.amount_paid) === 0 && row.status === 'paid';

// ---------------------------------------------------------------- formatação

/** "Hoje entraram *R$ 3.200,00* em 5 pagamentos (escopo)." Função PURA. */
export function formatReceived(
  total: number,
  count: number,
  period: ResolvedPeriod,
  scopeLabel: string,
  detalhe: ReplyLine[] = []
): AssistantReply {
  const followUp = 'Quem está atrasado?';
  if (count === 0) {
    return { text: `Nenhum pagamento entrou ${period.label} (${scopeLabel}).`, followUp };
  }
  const plural = count === 1 ? 'pagamento' : 'pagamentos';
  return {
    text: `${capitalize(period.label)} entraram *${formatBRL(total)}* em ${count} ${plural} (${scopeLabel}).`,
    followUp,
    ...detalheDe(detalhe, 'parcela paga', 'parcelas pagas'),
  };
}

/** "João da Silva tem *R$ 8.450,00* em aberto, em 2 contratos. O próximo vencimento é 15/09." Função PURA. */
export function formatDebtorBalance(
  nome: string,
  saldo: number,
  contratosAtivos: number,
  proximoVencimentoYMD: string | null,
  detalhe: ReplyLine[] = []
): AssistantReply {
  const followUp = 'Quanto tenho pra receber essa semana?';
  if (saldo <= 0) {
    return { text: `${nome} não tem nada em aberto.`, followUp };
  }
  const plural = contratosAtivos === 1 ? 'contrato' : 'contratos';
  const contratos = contratosAtivos > 0 ? `, em ${contratosAtivos} ${plural}` : '';
  // sem próximo vencimento a frase some — nunca escrever "null"
  const vencimento = proximoVencimentoYMD
    ? ` O próximo vencimento é ${ymdToDM(proximoVencimentoYMD)}.`
    : '';
  return {
    text: `${nome} tem *${formatBRL(saldo)}* em aberto${contratos}.${vencimento}`,
    followUp,
    ...detalheDe(detalhe, 'parcela em aberto', 'parcelas em aberto'),
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
    .select(
      'id, investment_id, company_id, number, due_date, amount_paid, amount_total, status, ' +
        'investments!inner(total_installments, profiles!investments_payer_id_fkey(full_name))'
    )
    .eq('tenant_id', ctx.tenantId)
    .gte('paid_at', period.startISO)
    .lt('paid_at', period.endISO)
    .gt('amount_paid', 0);
  if (ctx.companyId) query = query.eq('company_id', ctx.companyId);

  const { data, error } = await query;
  if (error) throw new Error(parseSupabaseError(error));

  const rows = (data ?? []) as any[];
  let total = 0;
  const detalhe: ReplyLine[] = [];
  for (const row of rows) {
    if (isPhantom(row)) continue; // BR-REL-002 (redundante com amount_paid > 0, mas explícito)
    total += num(row.amount_paid);
    detalhe.push({
      key: String(row.id),
      investmentId: Number(row.investment_id),
      companyId: row.company_id ?? null,
      title: row.investments?.profiles?.full_name || 'Sem nome',
      // aqui o valor da linha é o que ENTROU, não o que resta em aberto
      subtitle: `${rotuloParcela(row)} · venc. ${ymdToDM(row.due_date)}`,
      amount: num(row.amount_paid),
    });
  }
  return formatReceived(total, detalhe.length, period, ctx.scopeLabel, detalhe);
}

/**
 * Acha UM cliente pelo nome digitado. Devolve `reply` quando não dá para seguir:
 * ninguém com esse nome, ou mais de um (BR-BOT-010 — nunca escolher sozinho).
 *
 * O cadastro NÃO é filtrado por empresa de propósito: `profiles.company_id` é nulo
 * em cliente antigo, enquanto o contrato dele carrega a empresa. Filtrar aqui fazia
 * o assistente listar o cliente em "quem está atrasado" (escopo vindo da parcela) e
 * negar a existência dele em "quanto fulano me deve". O escopo de empresa vem das
 * parcelas de cada consulta.
 *
 * ponytail: filtro do nome em JS — ilike do Postgres não ignora acento e a lista de
 * devedores de um tenant é pequena. Se virar milhares, criar índice unaccent.
 */
async function acharCliente(
  nome: string,
  ctx: AssistantCtx
): Promise<{ cliente?: { id: string; full_name: string | null }; reply?: AssistantReply }> {
  const alvo = normalizeName(nome);
  if (!alvo) return { reply: formatDebtorNotFound(nome) };

  const { data, error } = await getSupabase()
    .from('profiles')
    .select('id, full_name')
    .eq('tenant_id', ctx.tenantId)
    .eq('role', 'debtor');
  if (error) throw new Error(parseSupabaseError(error));

  const candidatos = ((data ?? []) as any[]).filter((p) => nomeCasa(p.full_name ?? '', alvo));

  if (candidatos.length === 0) return { reply: formatDebtorNotFound(nome) };
  if (candidatos.length > 1) {
    return {
      reply: formatDebtorAmbiguous(
        nome,
        candidatos.map((p) => String(p.full_name ?? 'sem nome'))
      ),
    };
  }
  return { cliente: candidatos[0] };
}

/** Saldo em aberto de um cliente, casando o nome por parte, sem acento e sem caixa. */
export async function answerDebtorBalance(
  nome: string,
  ctx: AssistantCtx
): Promise<AssistantReply> {
  const supabase = getSupabase();
  const { cliente, reply } = await acharCliente(nome, ctx);
  if (!cliente) return reply!;
  let parcelas = supabase
    .from('loan_installments')
    .select(
      'id, investment_id, company_id, number, due_date, amount_total, amount_paid, fine_amount, ' +
        'interest_delay_amount, status, investments!inner(payer_id, status, total_installments)'
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
  const detalhe: ReplyLine[] = [];
  let saldo = 0;
  let proximo: string | null = null;

  const nomeCliente = String(cliente.full_name ?? nome);
  for (const row of (parcelaData ?? []) as any[]) {
    if (isPhantom(row)) continue; // BR-REL-002
    const aberto = installmentOpenAmount(row);
    saldo += aberto;
    contratos.add(row.investment_id);
    if (row.due_date && row.due_date >= hoje && (proximo === null || row.due_date < proximo)) {
      proximo = row.due_date;
    }
    if (aberto > 0) {
      detalhe.push({
        key: String(row.id),
        investmentId: Number(row.investment_id),
        companyId: row.company_id ?? null,
        title: nomeCliente,
        subtitle: `${rotuloParcela(row)} · ${row.due_date < hoje ? 'venceu' : 'vence'} ${ymdToDM(row.due_date)}`,
        amount: aberto,
      });
    }
  }

  return formatDebtorBalance(nomeCliente, saldo, contratos.size, proximo, detalhe);
}

/** "Quanto o João já me pagou" — pagamentos daquele cliente, não o caixa do dia. */
export function formatReceivedFromDebtor(
  nome: string,
  total: number,
  count: number,
  period: ResolvedPeriod | null,
  detalhe: ReplyLine[] = []
): AssistantReply {
  const followUp = `Quanto o ${nome} me deve?`;
  const janela = period ? ` ${period.label}` : '';
  if (count === 0) {
    return { text: `${nome} não tem nenhum pagamento registrado${janela}.`, followUp };
  }
  const plural = count === 1 ? 'pagamento' : 'pagamentos';
  const quando = period ? `${capitalize(period.label)} ` : '';
  const verbo = period ? 'pagou' : 'já pagou';
  return {
    text: `${quando}${nome} ${verbo} *${formatBRL(total)}*, em ${count} ${plural}.`,
    followUp,
    ...detalheDe(detalhe, 'parcela paga', 'parcelas pagas'),
  };
}

/**
 * Pagamentos de UM cliente. Sem período citado soma a vida inteira do cadastro —
 * "já me pagou" não tem janela.
 */
export async function answerReceivedFromDebtor(
  nome: string,
  period: ResolvedPeriod | null,
  ctx: AssistantCtx
): Promise<AssistantReply> {
  const { cliente, reply } = await acharCliente(nome, ctx);
  if (!cliente) return reply!;

  let query = getSupabase()
    .from('loan_installments')
    .select(
      'id, investment_id, company_id, number, due_date, paid_at, amount_paid, amount_total, status, ' +
        'investments!inner(payer_id, total_installments)'
    )
    .eq('tenant_id', ctx.tenantId)
    .eq('investments.payer_id', cliente.id)
    .gt('amount_paid', 0);
  if (ctx.companyId) query = query.eq('company_id', ctx.companyId);
  if (period) query = query.gte('paid_at', period.startISO).lt('paid_at', period.endISO);

  const { data, error } = await query;
  if (error) throw new Error(parseSupabaseError(error));

  const nomeCliente = String(cliente.full_name ?? nome);
  let total = 0;
  const detalhe: ReplyLine[] = [];
  for (const row of (data ?? []) as any[]) {
    if (isPhantom(row)) continue; // BR-REL-002
    total += num(row.amount_paid);
    detalhe.push({
      key: String(row.id),
      investmentId: Number(row.investment_id),
      companyId: row.company_id ?? null,
      title: nomeCliente,
      subtitle: `${rotuloParcela(row)} · ${row.paid_at ? `pago ${ymdToDM(isoToBrazilYMD(row.paid_at))}` : `venc. ${ymdToDM(row.due_date)}`}`,
      amount: num(row.amount_paid),
    });
  }

  return formatReceivedFromDebtor(nomeCliente, total, detalhe.length, period, detalhe);
}
