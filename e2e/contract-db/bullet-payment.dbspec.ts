/**
 * `pay_bullet_interest_only` — a RPC de baixa do produto de maior ticket
 * (InstallmentDetailFlow.tsx:729,1286; InstallmentModals.tsx:1750).
 *
 * Este arquivo nasceu VERMELHO, como prova executável de dois bugs verificados no
 * corpo real da função em produção (`pg_get_functiondef`, 04/08/2026):
 *
 * (1) RAMO DE ROLAGEM — `p_amount_paid` era IGNORADO:
 *       amount_paid = COALESCE(amount_paid,0) + v_interest_due
 *     Pagar R$ 50 de um juros de R$ 250 registrava R$ 250 e marcava 'paid'.
 *
 * (2) RAMO DE QUITAÇÃO — o limiar ignorava os juros:
 *       v_is_settlement := v_effective_amt >= (v_remaining - 0.005)
 *     Pagando só o principal o contrato fechava, e a linha de ledger gravava
 *     porções que somavam mais que o próprio `amount`.
 *
 * A migration v47 corrigiu os dois (imputação única: juros -> principal), então
 * agora estes testes afirmam o comportamento CORRETO e devem passar. Se algum
 * voltar a ficar vermelho, o bug de dinheiro voltou.
 *
 * Referência de negócio: BR-PAG-015 / FR-PAG-06 (itens 4, 5 e 6).
 *
 * FORA DE QUALQUER TIER DO CI. Rode com `npm run test:db-contract`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupAll,
  createContract,
  fetchInstallments,
  fetchInvestment,
  fetchPaymentTransactions,
  missingCredentials,
  num,
  rpc,
  signInQaAdmin,
  type DbCtx,
} from './fixture';

const skipReason = missingCredentials();
if (skipReason) console.warn(`[contract-db] SUÍTE PULADA — ${skipReason}`);

/** `calculateFinancials(5000, 1, 5, 'interest_only', 0)` → juros do ciclo = 250. */
const BULLET = {
  label: 'BULLET',
  amountInvested: 5000,
  currentValue: 5000, // bullet grava current_value == amount_invested
  installmentValue: 250,
  totalInstallments: 1,
  interestRate: 5,
  calculationMode: 'interest_only' as const,
};

describe.skipIf(skipReason !== null)('Camada 2 — bullet: pay_bullet_interest_only', () => {
  let ctx: DbCtx;

  beforeAll(async () => {
    ctx = await signInQaAdmin();
  });

  afterAll(async () => {
    if (ctx) await cleanupAll(ctx);
  });

  it('a criação bullet gera exatamente 1 parcela de 5000 + 250 (controle — passa hoje)', async () => {
    const c = await createContract(ctx, BULLET);
    const inv = await fetchInvestment(ctx, c.investmentId);

    expect(c.installments).toHaveLength(1);
    const p = c.installments[0];
    expect({
      principal: num(p.amount_principal),
      juros: num(p.amount_interest),
      total: num(p.amount_total),
      pago: num(p.amount_paid),
      status: p.status,
    }).toEqual({ principal: 5000, juros: 250, total: 5250, pago: 0, status: 'pending' });

    expect(num(inv.installment_value)).toBe(250);
    expect(num(inv.remaining_balance)).toBe(5000);
    expect(inv.total_installments).toBeNull();
    expect(inv.status).toBe('active');
  });

  it('pagar R$ 50 de um juros de R$ 250 tem que registrar R$ 50 — não R$ 250', async () => {
    const c = await createContract(ctx, BULLET);
    const parcela = c.installments[0];

    const ret = await rpc<any>(ctx, 'pay_bullet_interest_only', {
      p_installment_id: parcela.id,
      p_paid_at: '2026-08-04T12:00:00',
      p_payment_method: 'PIX',
      p_amount_paid: 50,
    });

    const depois = (await fetchInstallments(ctx, c.investmentId)).find((i) => i.id === parcela.id)!;
    expect(
      num(depois.amount_paid),
      `Operador informou R$ 50; a RPC gravou R$ ${num(depois.amount_paid)} e devolveu ` +
        `interest_paid=${ret?.interest_paid}. São R$ ${num(depois.amount_paid) - 50} que nunca entraram no caixa.`
    ).toBe(50);
  });

  it('pagar menos que o juros não pode quitar a parcela', async () => {
    const c = await createContract(ctx, BULLET);
    const parcela = c.installments[0];

    await rpc(ctx, 'pay_bullet_interest_only', {
      p_installment_id: parcela.id,
      p_paid_at: '2026-08-04T12:00:00',
      p_payment_method: 'PIX',
      p_amount_paid: 50,
    });

    const depois = (await fetchInstallments(ctx, c.investmentId)).find((i) => i.id === parcela.id)!;
    expect(
      depois.status,
      `R$ 50 de um ciclo de R$ 250 deixou a parcela '${depois.status}'. ` +
        'Pagamento parcial de juros não existe nesta RPC: é tudo-ou-quitação.'
    ).toBe('partial');
  });

  it('em payment_transactions, amount tem que ser igual a principal_portion + interest_portion', async () => {
    const c = await createContract(ctx, BULLET);
    const parcela = c.installments[0];

    // Paga EXATAMENTE o saldo devedor (5000), sem um centavo dos R$ 250 de juros.
    // Antes da v47 isso quitava o contrato (o limiar olhava só o principal).
    // Agora imputa 250 de juros + 4750 de principal e o contrato segue aberto.
    await rpc(ctx, 'pay_bullet_interest_only', {
      p_installment_id: parcela.id,
      p_paid_at: '2026-08-04T12:00:00',
      p_payment_method: 'PIX',
      p_amount_paid: 5000,
    });

    const txs = await fetchPaymentTransactions(ctx, c.investmentId);
    expect(txs).toHaveLength(1);
    const tx = txs[0];

    const amount = num(tx.amount);
    const soma = num(tx.principal_portion) + num(tx.interest_portion);
    expect(
      soma,
      `A linha de ledger não fecha: amount=${amount}, principal_portion=${num(tx.principal_portion)}, ` +
        `interest_portion=${num(tx.interest_portion)} (soma ${soma}). ` +
        `Diferença de R$ ${soma - amount} creditada sem lastro.`
    ).toBe(amount);

    // Pagar o principal sem os juros NÃO é quitação: falta R$ 250 do ciclo.
    const inv = await fetchInvestment(ctx, c.investmentId);
    expect(tx.transaction_type).toBe('bullet_interest');
    expect(num(tx.interest_portion)).toBe(250);
    expect(num(tx.principal_portion)).toBe(4750);
    expect(num(inv.remaining_balance)).toBe(250);
    expect(inv.status).toBe('active');
  });

  it('quitação exige principal + juros (5250) e fecha o contrato sem gerar nova parcela', async () => {
    const c = await createContract(ctx, BULLET);
    const parcela = c.installments[0];

    await rpc(ctx, 'pay_bullet_interest_only', {
      p_installment_id: parcela.id,
      p_paid_at: '2026-08-04T12:00:00',
      p_payment_method: 'PIX',
      p_amount_paid: 5250,
    });

    const inv = await fetchInvestment(ctx, c.investmentId);
    const txs = await fetchPaymentTransactions(ctx, c.investmentId);
    const parcelas = await fetchInstallments(ctx, c.investmentId);

    expect(txs).toHaveLength(1);
    expect(txs[0].transaction_type).toBe('bullet_settlement');
    expect(num(txs[0].amount)).toBe(5250);
    expect(num(txs[0].principal_portion) + num(txs[0].interest_portion)).toBe(5250);
    expect(num(inv.remaining_balance)).toBe(0);
    expect(inv.status).toBe('completed');
    // BR-PAG-015: pagamento total não gera nova cobrança automática.
    expect(parcelas).toHaveLength(1);
  });

  it('conservação: o que foi creditado (principal abatido + juros creditados) = o que foi pago', async () => {
    const c = await createContract(ctx, BULLET);
    const parcela = c.installments[0];
    const invAntes = await fetchInvestment(ctx, c.investmentId);
    const jurosAntes = num(parcela.interest_payments_total) || 0;

    const PAGO = 5000; // exatamente o saldo devedor, sem um centavo dos R$ 250 de juros
    await rpc(ctx, 'pay_bullet_interest_only', {
      p_installment_id: parcela.id,
      p_paid_at: '2026-08-04T12:00:00',
      p_payment_method: 'PIX',
      p_amount_paid: PAGO,
    });

    const invDepois = await fetchInvestment(ctx, c.investmentId);
    const parcelaDepois = (await fetchInstallments(ctx, c.investmentId)).find((i) => i.id === parcela.id)!;

    const principalAbatido = num(invAntes.remaining_balance) - num(invDepois.remaining_balance);
    const jurosCreditados = (num(parcelaDepois.interest_payments_total) || 0) - jurosAntes;

    // Lei de conservação, independente de qual seja a política de imputação:
    // não se pode creditar mais dívida do que o dinheiro que entrou.
    expect(
      principalAbatido + jurosCreditados,
      `Entrou R$ ${PAGO}, mas o sistema deu baixa em R$ ${principalAbatido} de principal + ` +
        `R$ ${jurosCreditados} de juros = R$ ${principalAbatido + jurosCreditados}. ` +
        `Sobra de R$ ${principalAbatido + jurosCreditados - PAGO} creditada sem lastro, e o contrato ` +
        `ficou '${invDepois.status}'.`
    ).toBe(PAGO);
  });
});
