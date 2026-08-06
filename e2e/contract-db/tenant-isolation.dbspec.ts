/**
 * ⚠ ESTE ARQUIVO FALHA DE PROPÓSITO. As falhas SÃO o resultado.
 *
 * Cada teste aqui prova uma falha de isolamento real, verificada no banco de
 * produção (`enzgerrnlbiojkuzeilw`) em 04/08/2026. Enquanto o bug existir, o teste
 * é vermelho — é essa a prova executável.
 *
 * Achados que estes testes cobrem:
 *   - view_investor_balances é SECURITY DEFINER (pg_class.reloptions = NULL, sem
 *     `security_invoker=on`) e a definição não tem NENHUM predicado de tenant.
 *     Medido: `SELECT count(*), count(DISTINCT tenant_id) FROM view_investor_balances`
 *     → 109 linhas / 21 tenants, contra 51 tenants na base.
 *   - 11 RPCs SECURITY DEFINER que movimentam dinheiro não checam tenant nem role,
 *     e `has_function_privilege('anon', ..., 'EXECUTE')` é TRUE para todas.
 *     A anon key é pública (vai no bundle: services/supabase.ts:15).
 *
 * FORA DE QUALQUER TIER DO CI: `.github/workflows/deploy.yml` lista caminhos
 * explícitos e nenhum deles é `e2e/contract-db/`. A extensão `.dbspec.ts` também
 * não casa com o testMatch padrão do Playwright, então `npx playwright test` ignora.
 * Rode com `npm run test:db-contract`.
 *
 * LACUNA DECLARADA — o cenário "tenant A opera parcela do tenant B" NÃO está aqui.
 * Só existe uma identidade de QA (`.env.local` tem um único TEST_ADMIN_*), e a
 * única forma de esse teste falhar-provando-o-bug seria mutar de fato uma parcela
 * de outro tenant em produção — o que é proibido. O substituto é o papel `anon`:
 * `anon` não tem tenant nenhum, então provar que `anon` move dinheiro numa parcela
 * qualquer prova a mesma guarda ausente, usando apenas fixture própria.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupAll,
  createContract,
  fetchInstallments,
  missingCredentials,
  num,
  rest,
  rpcRaw,
  signInQaAdmin,
  type ContractFixture,
  type DbCtx,
} from './fixture';

const skipReason = missingCredentials();
if (skipReason) console.warn(`[contract-db] SUÍTE PULADA — ${skipReason}`);

describe.skipIf(skipReason !== null)('Camada 2 — isolamento de tenant', () => {
  let ctx: DbCtx;
  let contrato: ContractFixture;

  beforeAll(async () => {
    ctx = await signInQaAdmin();
    // 3 parcelas de 366,66 — fixture própria, criada pela RPC de produção.
    contrato = await createContract(ctx, {
      label: 'ISO',
      amountInvested: 1000,
      currentValue: 1100,
      installmentValue: 1100 / 3,
      totalInstallments: 3,
      interestRate: 10,
      calculationMode: 'auto',
    });
    expect(contrato.installments).toHaveLength(3);
  });

  afterAll(async () => {
    if (ctx) await cleanupAll(ctx);
  });

  it('view_investor_balances só pode devolver linhas do tenant do usuário logado', async () => {
    const res = await rest<Array<{ tenant_id: string; profile_id: string }>>(
      ctx,
      '/rest/v1/view_investor_balances?select=tenant_id,profile_id'
    );
    expect(res.status).toBe(200);

    // Guarda anti-vácuo: o admin logado é 'investor|admin', então ele mesmo aparece.
    // Sem isto, uma view vazia passaria o teste sem provar nada.
    expect(res.data.length).toBeGreaterThan(0);

    const tenantsVazados = [...new Set(res.data.map((r) => r.tenant_id))].filter((t) => t !== ctx.tenantId);
    expect(
      tenantsVazados,
      `view_investor_balances devolveu ${res.data.length} linhas de ${tenantsVazados.length + 1} tenants ` +
        `para um usuário de um tenant só. A view é SECURITY DEFINER e não filtra tenant_id.`
    ).toEqual([]);
  });

  it('controle: SELECT direto em profiles respeita a RLS (prova que o vazamento é da VIEW)', async () => {
    // Este passa hoje. Serve para o teste acima não poder ser confundido com
    // "a autenticação não funcionou".
    const res = await rest<Array<{ tenant_id: string }>>(ctx, '/rest/v1/profiles?select=tenant_id');
    expect(res.status).toBe(200);
    expect(res.data.length).toBeGreaterThan(0);
    expect([...new Set(res.data.map((r) => r.tenant_id))]).toEqual([ctx.tenantId]);
  });

  it('anon (sem Authorization) não pode dar baixa numa parcela', async () => {
    const alvo = contrato.installments[0];
    expect(num(alvo.amount_paid)).toBe(0);

    const res = await rpcRaw(
      ctx,
      'pay_installment',
      { p_installment_id: alvo.id, p_amount_paid: 1, p_paid_at: '2026-08-04T12:00:00' },
      { asAnon: true }
    );

    const depois = (await fetchInstallments(ctx, contrato.investmentId)).find((i) => i.id === alvo.id)!;
    expect(
      res.status,
      `pay_installment aceitou uma chamada NÃO AUTENTICADA (só com a apikey pública): HTTP ${res.status}. ` +
        `amount_paid da parcela #${alvo.number} foi de 0 para ${num(depois.amount_paid)}. ` +
        'A RPC é SECURITY DEFINER, não checa auth.uid(), não checa tenant e é EXECUTE por anon.'
    ).toBeGreaterThanOrEqual(400);
  });

  it('anon (sem Authorization) não pode reescrever o valor de uma parcela', async () => {
    const alvo = contrato.installments[1];
    // Sem número mágico: até a v48 as três parcelas saíam idênticas (366,66) porque
    // o resíduo era descartado. Hoje a distribuição é [366,67 / 366,67 / 366,66], e
    // cravar um valor aqui só tornaria este teste de SEGURANÇA refém do rateio.
    const antes = num(alvo.amount_total);
    expect(antes).toBeGreaterThan(0);

    const res = await rpcRaw(
      ctx,
      'admin_update_installment',
      { p_installment_id: alvo.id, p_new_amount_total: 1 },
      { asAnon: true }
    );

    const depois = (await fetchInstallments(ctx, contrato.investmentId)).find((i) => i.id === alvo.id)!;
    expect(
      res.status,
      `admin_update_installment aceitou chamada NÃO AUTENTICADA: HTTP ${res.status}. ` +
        `amount_total da parcela #${alvo.number} foi de ${antes} para ${num(depois.amount_total)}. ` +
        'Apesar do prefixo "admin_", a função não checa role nem tenant.'
    ).toBeGreaterThanOrEqual(400);

    // O que de fato importa: a chamada anônima não pode ter mudado o valor.
    expect(
      num(depois.amount_total),
      'O valor da parcela mudou depois de uma chamada sem autenticação.'
    ).toBe(antes);
  });
});
