import { test, expect } from '@playwright/test';
import {
  getCtx,
  restCall,
  resolveScope,
  waitForApp,
  navigateToView,
  ymdBR,
  midnightBR,
  ymdOffsetBR,
} from '../fixtures/e2e-test-helpers';

/**
 * BR-BOT-010 — as outras quatro perguntas do Assistente saem do banco, não de texto fixo.
 *
 * Cada número esperado é recalculado AQUI a partir da regra escrita (parcela aberta =
 * total + multa + juros de atraso − pago, contrato `completed`/`renewed` fora, fantasma
 * fora), lendo pela REST — caminho independente do código sob teste.
 *
 * NÃO escreve no banco: o tenant de QA vive em produção. Se o sandbox estiver zerado o
 * teste continua válido: ele afirma que a tela diz o mesmo que o banco, inclusive o
 * texto de "nada a receber". As janelas em BRT são cobertas por
 * tests/unit/assistantEngine.test.ts.
 */

const brl = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(value)
    .replace(/ /g, ' '); // Intl separa R$ do número com NBSP

interface ParcelaAberta {
  investment_id: number;
  due_date: string;
  amount_total: string | number;
  amount_paid: string | number;
  fine_amount: string | number;
  interest_delay_amount: string | number;
  status: string;
  investments: { payer_id: string; status: string };
}

const num = (v: unknown) => Number(v ?? 0);

/** BR-REL-005 + BR-REL-002: o que o cliente ainda deve naquela parcela, nunca negativo. */
const aberto = (p: ParcelaAberta) =>
  Math.max(
    num(p.amount_total) + num(p.fine_amount) + num(p.interest_delay_amount) - num(p.amount_paid),
    0,
  );

test('Assistente responde atraso, a receber, recebido e saldo do cliente com o número do banco (BR-BOT-010)', async ({
  page,
}) => {
  await page.goto('/');
  await waitForApp(page, { requireSidebar: true });

  const ctx = await getCtx(page);
  expect(ctx, 'sem credenciais do Supabase na página — env-config.js não injetado').not.toBeNull();

  const { tenantId, companyId } = await resolveScope(ctx!);
  expect(tenantId, 'admin de teste sem tenant_id').toBeTruthy();

  const escopo = companyId ? `&company_id=eq.${companyId}` : '';
  const hoje = ymdBR();

  /** Todas as parcelas em aberto do escopo — base dos três primeiros números. */
  const lerAbertas = (): Promise<ParcelaAberta[]> =>
    restCall(
      ctx!,
      'loan_installments?select=investment_id,due_date,amount_total,amount_paid,fine_amount,' +
        'interest_delay_amount,status,investments!inner(payer_id,status)' +
        `&tenant_id=eq.${tenantId}${escopo}` +
        '&status=in.(pending,late,partial)' +
        '&investments.status=not.in.(completed,renewed)',
    );

  const lerRecebidoHoje = (): Promise<Array<{ amount_paid: string | number }>> =>
    restCall(
      ctx!,
      'loan_installments?select=amount_paid' +
        `&tenant_id=eq.${tenantId}${escopo}&amount_paid=gt.0` +
        `&paid_at=gte.${midnightBR(hoje, 0).toISOString()}` +
        `&paid_at=lt.${midnightBR(hoje, 1).toISOString()}`,
    );

  const atrasoDe = (rows: ParcelaAberta[]) => {
    const venci = rows.filter((p) => p.due_date < hoje);
    return {
      total: Math.round(venci.reduce((a, p) => a + aberto(p), 0) * 100) / 100,
      clientes: new Set(venci.map((p) => p.investments.payer_id)).size,
    };
  };

  const aReceberDe = (rows: ParcelaAberta[]) => {
    const limite = ymdOffsetBR(hoje, 7);
    const futuras = rows.filter((p) => p.due_date >= hoje && p.due_date < limite);
    return {
      total: Math.round(futuras.reduce((a, p) => a + aberto(p), 0) * 100) / 100,
      count: futuras.length,
    };
  };

  // --- ORÁCULO: calculado da regra, antes de olhar a tela ---
  const antes = await lerAbertas();
  const atrasoAntes = atrasoDe(antes);
  const receberAntes = aReceberDe(antes);
  const recebidoAntes = await lerRecebidoHoje();
  const somaRecebido = (rows: Array<{ amount_paid: string | number }>) =>
    Math.round(rows.reduce((a, r) => a + num(r.amount_paid), 0) * 100) / 100;

  // --- A tela ---
  await navigateToView(page, 'Assistente');
  const input = page.locator('textarea').first();
  const baloes = page.getByTestId('chat-msg-assistant');

  const perguntar = async (texto: string) => {
    const jaVistos = await baloes.count();
    await input.click();
    await input.fill(texto);
    await page.keyboard.press('Enter');
    const novo = baloes.nth(jaVistos);
    await novo.waitFor({ timeout: 20_000 });
    return (await novo.innerText()).replace(/ /g, ' ');
  };

  /**
   * Outros specs criam, pagam e apagam contratos no mesmo tenant enquanto este roda.
   * Relemos depois da resposta e aceitamos os dois retratos: escrita concorrente move o
   * total em centenas de reais, bug de fórmula/escopo/fuso não bate com nenhum dos dois.
   */
  const confere = (resposta: string, rotulo: string, trechos: string[][]) => {
    expect(
      trechos.some((alternativa) => alternativa.every((t) => resposta.includes(t))),
      `${rotulo}: a tela não bate com o banco.\nEsperado um de: ${JSON.stringify(trechos)}\nResposta: ${resposta}`,
    ).toBe(true);
  };

  // 1. Quem está atrasado
  const respAtraso = await perguntar('quem está atrasado?');
  const atrasoDepois = atrasoDe(await lerAbertas());
  const textoAtraso = (d: { total: number; clientes: number }) =>
    d.clientes === 0
      ? ['Ninguém está atrasado']
      : [brl(d.total), `${d.clientes} ${d.clientes === 1 ? 'cliente' : 'clientes'}`];
  confere(respAtraso, 'atraso', [textoAtraso(atrasoAntes), textoAtraso(atrasoDepois)]);

  // 2. Quanto tenho pra receber (próximos 7 dias)
  const respReceber = await perguntar('quanto tenho pra receber nos próximos 7 dias?');
  const receberDepois = aReceberDe(await lerAbertas());
  const textoReceber = (d: { total: number; count: number }) =>
    d.count === 0
      ? ['não tem nada a receber']
      : [brl(d.total), `${d.count} ${d.count === 1 ? 'parcela' : 'parcelas'}`];
  confere(respReceber, 'a receber', [textoReceber(receberAntes), textoReceber(receberDepois)]);

  // 3. Quanto recebi hoje
  const respRecebido = await perguntar('quanto recebi hoje?');
  const recebidoDepois = await lerRecebidoHoje();
  const textoRecebido = (rows: Array<{ amount_paid: string | number }>) =>
    rows.length === 0 ? ['Nenhum pagamento entrou'] : [brl(somaRecebido(rows)), `${rows.length}`];
  confere(respRecebido, 'recebido hoje', [
    textoRecebido(recebidoAntes),
    textoRecebido(recebidoDepois),
  ]);

  // 4. Saldo de um cliente — a invariante que já quebrou uma vez:
  //    todo cliente citado na lista de atrasados TEM que ser achado pela busca por nome.
  //    O cadastro pode ter `company_id` nulo enquanto o contrato carrega a empresa; se a
  //    busca voltar a filtrar o perfil por empresa, o Assistente passa a listar o cliente
  //    numa pergunta e negar a existência dele na outra.
  const citado = respAtraso.match(/• (.+?) — R\$/)?.[1];
  test.skip(!citado || citado === 'Sem nome', 'sandbox sem cliente atrasado com nome');

  const respSaldo = await perguntar(`quanto o ${citado} me deve?`);
  expect(
    respSaldo,
    `o Assistente listou "${citado}" em atraso mas não achou o cadastro dele`,
  ).not.toContain('Não achei nenhum cliente');
  expect(respSaldo).toContain('em aberto');

  // saldo recalculado pelo cadastro, para casar valor e nº de contratos
  const saldoBanco = await lerAbertas();
  const nomeAlvo = citado!;
  const perfis: Array<{ id: string; full_name: string | null }> = await restCall(
    ctx!,
    `profiles?select=id,full_name&tenant_id=eq.${tenantId}&role=eq.debtor&full_name=eq.${encodeURIComponent(nomeAlvo)}`,
  );
  expect(perfis.length, `cadastro de "${nomeAlvo}" sumiu entre as leituras`).toBeGreaterThan(0);
  const ids = new Set(perfis.map((p) => p.id));
  const doCliente = saldoBanco.filter((p) => ids.has(p.investments.payer_id));
  const saldo = Math.round(doCliente.reduce((a, p) => a + aberto(p), 0) * 100) / 100;
  const contratos = new Set(doCliente.map((p) => p.investment_id)).size;
  confere(respSaldo, `saldo de ${nomeAlvo}`, [
    [brl(saldo), `${contratos} ${contratos === 1 ? 'contrato' : 'contratos'}`],
  ]);

  // 5. O detalhamento: a lista tem que somar o número que a frase afirma (BR-BOT-011),
  //    e clicar numa linha tem que abrir aquele contrato — não a lista de contratos.
  const balaoSaldo = baloes.nth((await baloes.count()) - 1);
  const linhas = balaoSaldo.getByTestId('reply-line');
  expect(await linhas.count(), 'resposta de saldo veio sem detalhamento').toBeGreaterThan(0);

  const toggle = balaoSaldo.getByTestId('reply-breakdown-toggle');
  if (await toggle.count()) {
    const colapsadas = await linhas.count();
    await toggle.click();
    await expect
      .poll(() => linhas.count(), { message: 'botão não expandiu a lista' })
      .toBeGreaterThan(colapsadas);
  }

  const brlParaNumero = (t: string) =>
    Number(t.replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.'));
  const valores = await linhas.allInnerTexts();
  const somaDaLista =
    Math.round(
      valores.reduce((acc, t) => acc + brlParaNumero(t.split('\n').pop() ?? '0'), 0) * 100,
    ) / 100;
  const totalDaFrase = brlParaNumero(respSaldo.match(/R\$[\s\u00a0][\d.,]+/)?.[0] ?? '0');
  expect(
    somaDaLista,
    `a lista soma ${somaDaLista} mas a frase afirma ${totalDaFrase}`,
  ).toBeCloseTo(totalDaFrase, 2);

  const primeira = linhas.first();
  const rotuloLinha = await primeira.innerText();
  await primeira.click();
  // o detalhe do contrato mostra o id; a lista de contratos, não
  await expect(
    page.getByText(/ID #\d+/).first(),
    `clicar em "${rotuloLinha.replace(/\n/g, ' · ')}" não abriu o detalhe de um contrato`,
  ).toBeVisible({ timeout: 15_000 });

  await navigateToView(page, 'Assistente');
  await input.click();

  // 6. Cliente inexistente não pode virar R$ 0,00 (BR-BOT-010)
  const respNinguem = await perguntar('quanto o Zoroastro Inexistente me deve?');
  expect(respNinguem).toContain('Não achei nenhum cliente');
  expect(respNinguem).not.toContain('R$ 0,00');
});
