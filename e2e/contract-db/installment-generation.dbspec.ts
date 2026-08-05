/**
 * ⚠ ESTE ARQUIVO FALHA DE PROPÓSITO (2 dos 4 casos). As falhas SÃO o resultado.
 *
 * `create_investment_validated` não redistribui centavos. Corpo real em produção:
 *
 *   v_amount_principal := ROUND(p_amount_invested / p_total_installments, 2);
 *   v_amount_interest  := ROUND((p_current_value - p_amount_invested) / p_total_installments, 2);
 *   FOR i IN 1..N LOOP
 *     INSERT ... amount_total = ROUND(v_amount_principal + v_amount_interest, 2)
 *
 * Todas as parcelas ficam idênticas e o resíduo simplesmente some (ou sobra).
 * Ao mesmo tempo, `investments.installment_value` recebe ROUND(p_installment_value, 2)
 * — que é ROUND(current_value/N, 2) — uma conta DIFERENTE da soma das duas metades.
 * O card do contrato mostra um número e a lista de parcelas mostra outro.
 *
 * O frontend TEM a função certa (`distributeEvenly`, utils/financials.ts:10), que
 * joga o resíduo na última parcela e fecha a soma — mas ela só é usada na EDIÇÃO
 * (AdminContracts.tsx:891). Criar e editar discordam por construção.
 * O teste unitário correspondente está em tests/unit/financials.test.ts.
 *
 * FORA DE QUALQUER TIER DO CI. Rode com `npm run test:db-contract`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupAll,
  createContract,
  fetchInvestment,
  missingCredentials,
  num,
  signInQaAdmin,
  type DbCtx,
} from './fixture';
import { calculateFinancials, roundCurrency } from '@/utils/financials';

const skipReason = missingCredentials();
if (skipReason) console.warn(`[contract-db] SUÍTE PULADA — ${skipReason}`);

/** Casos de 1000 a 10% (o default do wizard: AdminContracts.tsx:203). */
const CASOS = [
  { n: 3, principalDaParcela: 333.33, jurosDaParcela: 33.33, esperaFechar: false },
  { n: 7, principalDaParcela: 142.86, jurosDaParcela: 14.29, esperaFechar: false },
  { n: 10, principalDaParcela: 100.0, jurosDaParcela: 10.0, esperaFechar: true },
  { n: 12, principalDaParcela: 83.33, jurosDaParcela: 8.33, esperaFechar: false },
];

describe.skipIf(skipReason !== null)('Camada 2 — geração da tabela de parcelas', () => {
  let ctx: DbCtx;

  beforeAll(async () => {
    ctx = await signInQaAdmin();
  });

  afterAll(async () => {
    if (ctx) await cleanupAll(ctx);
  });

  for (const caso of CASOS) {
    it(`1000 a 10% em ${caso.n}x: a soma das parcelas tem que dar exatamente 1100${caso.esperaFechar ? ' (controle — passa hoje)' : ''}`, async () => {
      // A fixture usa a MESMA função que o wizard usa para montar os parâmetros
      // (AdminContracts.tsx:512 → updateFormState → calculateFinancials), então o
      // teste não inventa nenhum número: ele reproduz a entrada do usuário.
      const financeiro = calculateFinancials(1000, caso.n, 10, 'auto', 0);
      expect(financeiro.totalValue).toBe(1100);

      const c = await createContract(ctx, {
        label: `GER${caso.n}X`,
        amountInvested: 1000,
        currentValue: financeiro.totalValue,
        installmentValue: financeiro.installmentValue,
        totalInstallments: caso.n,
        interestRate: 10,
        calculationMode: 'auto',
      });

      expect(c.installments).toHaveLength(caso.n);

      // Toda parcela sai idêntica — isso é o comportamento atual, e é a causa.
      for (const p of c.installments) {
        expect({
          numero: p.number,
          principal: num(p.amount_principal),
          juros: num(p.amount_interest),
          total: num(p.amount_total),
        }).toEqual({
          numero: p.number,
          principal: caso.principalDaParcela,
          juros: caso.jurosDaParcela,
          total: roundCurrency(caso.principalDaParcela + caso.jurosDaParcela),
        });
      }

      const soma = roundCurrency(c.installments.reduce((s, p) => s + num(p.amount_total), 0));
      expect(
        soma,
        `O contrato cobra R$ ${roundCurrency(soma - 1100)} a ${soma > 1100 ? 'MAIS' : 'MENOS'} que o ` +
          `current_value de R$ 1100,00. create_investment_validated replica ` +
          `ROUND(1000/${caso.n},2) + ROUND(100/${caso.n},2) em todas as ${caso.n} parcelas e descarta o resíduo.`
      ).toBe(1100);
    });
  }

  it('o valor da parcela no card do contrato tem que ser o mesmo da lista de parcelas', async () => {
    const financeiro = calculateFinancials(1000, 7, 10, 'auto', 0);
    const c = await createContract(ctx, {
      label: 'GERCARD',
      amountInvested: 1000,
      currentValue: financeiro.totalValue,
      installmentValue: financeiro.installmentValue,
      totalInstallments: 7,
      interestRate: 10,
      calculationMode: 'auto',
    });
    const inv = await fetchInvestment(ctx, c.investmentId);

    // AdminContracts.tsx:2190 mostra investments.installment_value;
    // DashboardWidgets.tsx:853 mostra loan_installments.amount_total.
    expect(
      num(inv.installment_value),
      `Card do contrato exibe R$ ${num(inv.installment_value)} (ROUND(1100/7,2)) e cada parcela ` +
        `da lista exibe R$ ${num(c.installments[0].amount_total)} (ROUND(1000/7,2)+ROUND(100/7,2)). ` +
        'São duas contas diferentes sobre a mesma entrada, divergindo na tela.'
    ).toBe(num(c.installments[0].amount_total));
  });
});
