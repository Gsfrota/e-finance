/**
 * `submit_offline_payment` — contrato executável da baixa capturada sem rede.
 *
 * A intenção nasce no celular e seu UUID precisa proteger o dinheiro em quatro
 * momentos diferentes: retry depois de timeout, retomada de estado incompleto,
 * recusa de negócio e sincronização concorrente. Estes testes exercitam a RPC
 * real no tenant de QA e releem banco e ledger; não aceitam apenas o JSON da RPC
 * como prova de que o pagamento entrou uma única vez.
 *
 * Limitação honesta: deadlock/serialization failure/lock timeout exigem controle
 * de duas transações SQL abertas. O PostgREST fecha cada request numa transação,
 * então esses SQLSTATE continuam validados pela migration, não reproduzidos aqui.
 *
 * FORA DE QUALQUER TIER DO CI. Rode com `npm run test:db-contract`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupAll,
  createContract,
  fetchInstallments,
  fetchPaymentTransactions,
  missingCredentials,
  num,
  rest,
  rpc,
  rpcRaw,
  signInQaAdmin,
  trackOfflineIntent,
  type ContractFixture,
  type DbCtx,
} from './fixture';

const skipReason = missingCredentials();
if (skipReason) console.warn(`[contract-db] SUÍTE PULADA — ${skipReason}`);

const REGULAR = {
  label: 'OFFLINE',
  amountInvested: 1000,
  currentValue: 1100,
  installmentValue: 1100 / 3,
  totalInstallments: 3,
  interestRate: 10,
  calculationMode: 'auto' as const,
};

interface OfflineIntentRow {
  id: string;
  tenant_id: string;
  installment_id: string;
  amount: number | string;
  paid_at: string;
  status: 'pending' | 'applied' | 'rejected' | 'resolved';
  error_message: string | null;
  resolved_at: string | null;
}

interface SubmitResult {
  status: OfflineIntentRow['status'];
  duplicada: boolean;
  erro?: string;
}

const fieldDate = (daysAgo = 0): string =>
  new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

function submitArgs(intentId: string, installmentId: string, amount: number, paidAt = fieldDate()) {
  return {
    p_intent_id: intentId,
    p_installment_id: installmentId,
    p_amount: amount,
    p_paid_at: paidAt,
  };
}

async function getIntent(ctx: DbCtx, id: string): Promise<OfflineIntentRow | null> {
  const res = await rest<OfflineIntentRow[]>(
    ctx,
    `/rest/v1/offline_payment_intents?id=eq.${id}&select=*`
  );
  expect(res.status, `Falha ao reler intenção ${id}: ${res.raw}`).toBe(200);
  expect(res.data.length).toBeLessThanOrEqual(1);
  return res.data[0] ?? null;
}

async function seedIntent(
  ctx: DbCtx,
  fixture: ContractFixture,
  id: string,
  status: 'pending' | 'rejected' | 'resolved',
  amount = 100,
  paidAt = fieldDate()
): Promise<void> {
  trackOfflineIntent(id);
  const res = await rest<OfflineIntentRow[]>(ctx, '/rest/v1/offline_payment_intents', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      id,
      tenant_id: ctx.tenantId,
      installment_id: fixture.installments[0].id,
      amount,
      paid_at: paidAt,
      status,
      error_message: status === 'rejected' ? 'falha anterior simulada' : null,
      created_by: ctx.authUserId,
      resolved_at: status === 'pending' ? null : fieldDate(),
    },
  });
  expect(res.status, `Falha ao preparar intenção ${status}: ${res.raw}`).toBe(201);
  expect(res.data).toHaveLength(1);
}

describe.skipIf(skipReason !== null)('Camada 2 — intenções de baixa offline', () => {
  let ctx: DbCtx;

  beforeAll(async () => {
    ctx = await signInQaAdmin();
  });

  afterAll(async () => {
    if (ctx) await cleanupAll(ctx);
  });

  it('o mesmo UUID aplica dinheiro e ledger uma vez, mesmo se o retry vier com outro valor', async () => {
    const c = await createContract(ctx, { ...REGULAR, label: 'OFF-IDEM' });
    const alvo = c.installments[0];
    const intentId = randomUUID();
    const paidAt = fieldDate();
    trackOfflineIntent(intentId);

    const txAntes = await fetchPaymentTransactions(ctx, c.investmentId);
    const primeira = await rpc<SubmitResult>(ctx, 'submit_offline_payment', submitArgs(intentId, alvo.id, 100, paidAt));
    const retry = await rpc<SubmitResult>(ctx, 'submit_offline_payment', submitArgs(intentId, alvo.id, 150, paidAt));

    expect(primeira).toMatchObject({ status: 'applied', duplicada: false });
    expect(retry).toMatchObject({ status: 'applied', duplicada: true });

    const depois = (await fetchInstallments(ctx, c.investmentId)).find((i) => i.id === alvo.id)!;
    expect(num(depois.amount_paid), 'Retry do mesmo UUID aplicou dinheiro pela segunda vez.').toBe(100);

    const txDepois = await fetchPaymentTransactions(ctx, c.investmentId);
    const novas = txDepois.slice(txAntes.length);
    expect(novas, 'A baixa offline precisa deixar exatamente uma linha no ledger.').toHaveLength(1);
    expect(num(novas[0].amount)).toBe(100);
    expect(novas[0].installment_id).toBe(alvo.id);
  });

  it("uma intenção preexistente em 'pending' é retomada e aplicada", async () => {
    const c = await createContract(ctx, { ...REGULAR, label: 'OFF-PENDING' });
    const intentId = randomUUID();
    const paidAt = fieldDate();
    await seedIntent(ctx, c, intentId, 'pending', 100, paidAt);

    const ret = await rpc<SubmitResult>(
      ctx,
      'submit_offline_payment',
      submitArgs(intentId, c.installments[0].id, 100, paidAt)
    );

    expect(ret).toMatchObject({ status: 'applied', duplicada: false });
    expect(num((await getIntent(ctx, intentId))?.amount)).toBe(100);
    expect((await getIntent(ctx, intentId))?.status).toBe('applied');
    const parcela = (await fetchInstallments(ctx, c.investmentId))[0];
    expect(num(parcela.amount_paid), "Intenção 'pending' continuou presa sem aplicar dinheiro.").toBe(100);
  });

  it('a retomada aplica o payload persistido, não parâmetros alterados no retry', async () => {
    const c = await createContract(ctx, { ...REGULAR, label: 'OFF-PAYLOAD' });
    const original = c.installments[0];
    const outroAlvo = c.installments[1];
    const intentId = randomUUID();
    const paidAt = fieldDate();
    await seedIntent(ctx, c, intentId, 'pending', 40, paidAt);

    const ret = await rpc<SubmitResult>(
      ctx,
      'submit_offline_payment',
      submitArgs(intentId, outroAlvo.id, 90, paidAt)
    );
    const parcelas = await fetchInstallments(ctx, c.investmentId);

    expect(ret).toMatchObject({ status: 'applied', duplicada: false });
    expect(num(parcelas.find((i) => i.id === original.id)!.amount_paid)).toBe(40);
    expect(
      num(parcelas.find((i) => i.id === outroAlvo.id)!.amount_paid),
      'O UUID deixou de identificar uma intenção imutável: o retry redirecionou o dinheiro.'
    ).toBe(0);
  });

  it('uma recusa de negócio preserva a intenção, o valor e o motivo', async () => {
    const c = await createContract(ctx, { ...REGULAR, label: 'OFF-REJECT' });
    const alvo = c.installments[0];
    await rpc(ctx, 'pay_installment', {
      p_installment_id: alvo.id,
      p_amount_paid: num(alvo.amount_total),
      p_paid_at: fieldDate(),
    });

    const intentId = randomUUID();
    trackOfflineIntent(intentId);
    const ret = await rpc<SubmitResult>(ctx, 'submit_offline_payment', submitArgs(intentId, alvo.id, 25));
    const intent = await getIntent(ctx, intentId);

    expect(ret.status).toBe('rejected');
    expect(ret.duplicada).toBe(false);
    expect(intent).not.toBeNull();
    expect(intent?.status).toBe('rejected');
    expect(num(intent?.amount)).toBe(25);
    expect(intent?.error_message).toMatch(/quitada/i);
    expect(intent?.resolved_at).not.toBeNull();
  });

  it("uma intenção preexistente em 'rejected' também pode ser retomada", async () => {
    const c = await createContract(ctx, { ...REGULAR, label: 'OFF-RESUME' });
    const intentId = randomUUID();
    const paidAt = fieldDate();
    await seedIntent(ctx, c, intentId, 'rejected', 75, paidAt);

    const ret = await rpc<SubmitResult>(
      ctx,
      'submit_offline_payment',
      submitArgs(intentId, c.installments[0].id, 75, paidAt)
    );
    const intent = await getIntent(ctx, intentId);

    expect(ret).toMatchObject({ status: 'applied', duplicada: false });
    expect(intent?.status).toBe('applied');
    expect(intent?.error_message).toBeNull();
    expect(num((await fetchInstallments(ctx, c.investmentId))[0].amount_paid)).toBe(75);
  });

  it('grava a data recebida em campo, não a data posterior da sincronização', async () => {
    const c = await createContract(ctx, { ...REGULAR, label: 'OFF-DATE' });
    const alvo = c.installments[0];
    const intentId = randomUUID();
    const paidAt = fieldDate(2);
    trackOfflineIntent(intentId);

    const ret = await rpc<SubmitResult>(
      ctx,
      'submit_offline_payment',
      submitArgs(intentId, alvo.id, num(alvo.amount_total), paidAt)
    );
    const intent = await getIntent(ctx, intentId);
    const parcela = (await fetchInstallments(ctx, c.investmentId)).find((i) => i.id === alvo.id)!;

    expect(ret.status).toBe('applied');
    expect(Math.abs(Date.parse(intent!.paid_at) - Date.parse(paidAt))).toBeLessThan(1000);
    expect(Math.abs(Date.parse(parcela.paid_at!) - Date.parse(paidAt))).toBeLessThan(1000);
  });

  it('recusa paid_at além da tolerância de um dia sem criar intenção nem mover dinheiro', async () => {
    const c = await createContract(ctx, { ...REGULAR, label: 'OFF-FUTURE' });
    const alvo = c.installments[0];
    const intentId = randomUUID();
    trackOfflineIntent(intentId);
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    const res = await rpcRaw(ctx, 'submit_offline_payment', submitArgs(intentId, alvo.id, 100, future));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.raw).toMatch(/futuro/i);
    expect(await getIntent(ctx, intentId)).toBeNull();
    expect(num((await fetchInstallments(ctx, c.investmentId))[0].amount_paid)).toBe(0);
  });

  it('parcela inexistente ou alheia é recusada sem deixar intenção', async () => {
    const intentId = randomUUID();
    trackOfflineIntent(intentId);

    const res = await rpcRaw(ctx, 'submit_offline_payment', submitArgs(intentId, randomUUID(), 100));

    expect(res.status).toBe(403);
    expect(res.raw).toMatch(/não pertence ao seu tenant/i);
    expect(await getIntent(ctx, intentId)).toBeNull();
  });

  it('anon não tem EXECUTE e não consegue criar intenção nem mover a parcela', async () => {
    const c = await createContract(ctx, { ...REGULAR, label: 'OFF-ANON' });
    const alvo = c.installments[0];
    const intentId = randomUUID();
    trackOfflineIntent(intentId);

    const res = await rpcRaw(ctx, 'submit_offline_payment', submitArgs(intentId, alvo.id, 100), { asAnon: true });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await getIntent(ctx, intentId)).toBeNull();
    expect(num((await fetchInstallments(ctx, c.investmentId))[0].amount_paid)).toBe(0);
  });

  it('resolver como avulso é atômico e idempotente', async () => {
    const c = await createContract(ctx, { ...REGULAR, label: 'OFF-AVULSO' });
    const alvo = c.installments[0];
    await rpc(ctx, 'pay_installment', {
      p_installment_id: alvo.id,
      p_amount_paid: num(alvo.amount_total),
      p_paid_at: fieldDate(),
    });

    const intentId = randomUUID();
    trackOfflineIntent(intentId);
    const rejeitada = await rpc<SubmitResult>(ctx, 'submit_offline_payment', submitArgs(intentId, alvo.id, 25));
    expect(rejeitada.status).toBe('rejected');

    const primeira = await rpc<SubmitResult>(ctx, 'resolve_offline_intent_as_avulso', {
      p_intent_id: intentId,
      p_destination: 'general_credit',
      p_notes: 'resolução do teste de contrato',
    });
    const retry = await rpc<SubmitResult>(ctx, 'resolve_offline_intent_as_avulso', {
      p_intent_id: intentId,
      p_destination: 'general_credit',
      p_notes: 'retry da mesma resolução',
    });

    expect(primeira).toMatchObject({ status: 'resolved', duplicada: false });
    expect(retry).toMatchObject({ status: 'resolved', duplicada: true });
    expect((await getIntent(ctx, intentId))?.status).toBe('resolved');

    const avulsos = (await fetchPaymentTransactions(ctx, c.investmentId))
      .filter((tx) => tx.transaction_type === 'avulso');
    expect(avulsos, 'Retry da resolução criou mais de um pagamento avulso.').toHaveLength(1);
    expect(num(avulsos[0].amount)).toBe(25);
    expect(avulsos[0].installment_id).toBeNull();
  });

  it('descarte explícito marca resolved sem movimentar dinheiro', async () => {
    const c = await createContract(ctx, { ...REGULAR, label: 'OFF-DISCARD' });
    const intentId = randomUUID();
    await seedIntent(ctx, c, intentId, 'rejected', 60, fieldDate());

    const antes = await fetchPaymentTransactions(ctx, c.investmentId);
    const primeira = await rpc<SubmitResult>(ctx, 'discard_offline_payment_intent', {
      p_intent_id: intentId,
    });
    const retry = await rpc<SubmitResult>(ctx, 'discard_offline_payment_intent', {
      p_intent_id: intentId,
    });

    expect(primeira).toMatchObject({ status: 'resolved', duplicada: false });
    expect(retry).toMatchObject({ status: 'resolved', duplicada: true });
    expect((await getIntent(ctx, intentId))?.status).toBe('resolved');
    expect(await fetchPaymentTransactions(ctx, c.investmentId)).toHaveLength(antes.length);
    expect(num((await fetchInstallments(ctx, c.investmentId))[0].amount_paid)).toBe(0);
  });

  it('envios realmente simultâneos do mesmo UUID produzem um único efeito financeiro', async () => {
    const c = await createContract(ctx, { ...REGULAR, label: 'OFF-RACE' });
    const alvo = c.installments[0];
    const intentId = randomUUID();
    const paidAt = fieldDate();
    trackOfflineIntent(intentId);

    const respostas = await Promise.all(
      Array.from({ length: 8 }, () =>
        rpc<SubmitResult>(ctx, 'submit_offline_payment', submitArgs(intentId, alvo.id, 10, paidAt))
      )
    );

    expect(respostas.filter((r) => r.duplicada === false)).toHaveLength(1);
    expect(respostas.filter((r) => r.duplicada === true)).toHaveLength(7);
    const parcela = (await fetchInstallments(ctx, c.investmentId)).find((i) => i.id === alvo.id)!;
    expect(num(parcela.amount_paid), 'A janela SELECT/INSERT aplicou o mesmo UUID mais de uma vez.').toBe(10);
    const txs = await fetchPaymentTransactions(ctx, c.investmentId);
    expect(txs, 'Concorrência no mesmo UUID também não pode duplicar o ledger.').toHaveLength(1);
  });
});
