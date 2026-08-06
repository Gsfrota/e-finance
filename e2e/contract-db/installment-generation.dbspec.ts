/**
 * Geração da tabela de parcelas na criação de contrato.
 *
 * Este arquivo nasceu VERMELHO (2 dos 4 casos), como prova executável de que
 * `create_investment_validated` não redistribuía centavos. Corpo real que estava
 * em produção:
 *
 *   v_amount_principal := ROUND(p_amount_invested / N, 2);
 *   v_amount_interest  := ROUND((p_current_value - p_amount_invested) / N, 2);
 *   FOR i IN 1..N LOOP INSERT ... (v_amount_principal, v_amount_interest, ...)
 *
 * Todas as parcelas saíam idênticas e o resíduo sumia: 7x cobrava R$ 0,05 a mais,
 * 12x R$ 0,08 a menos. E `investments.installment_value` recebia
 * ROUND(current_value / N, 2) — outra conta — então o card mostrava R$ 157,14 e
 * cada parcela da lista R$ 157,15.
 *
 * A migration v48 passou a distribuir PRINCIPAL e TOTAL com o resíduo na última
 * parcela, derivando o juros, que é exatamente o que `distributeEvenly`
 * (utils/financials.ts:10) já fazia na EDIÇÃO (AdminContracts.tsx:891-901).
 * Por isso os testes abaixo comparam o banco contra `distributeEvenly`: se
 * passarem, criar e editar concordam por construção.
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
import { calculateFinancials, distributeEvenly, roundCurrency } from '@/utils/financials';

const skipReason = missingCredentials();
if (skipReason) console.warn(`[contract-db] SUÍTE PULADA — ${skipReason}`);

/** Casos de 1000 a 10% (o default do wizard: AdminContracts.tsx:203). */
const CASOS = [3, 7, 10, 12];

describe.skipIf(skipReason !== null)('Camada 2 — geração da tabela de parcelas', () => {
  let ctx: DbCtx;

  beforeAll(async () => {
    ctx = await signInQaAdmin();
  });

  afterAll(async () => {
    if (ctx) await cleanupAll(ctx);
  });

  for (const n of CASOS) {
    it(`1000 a 10% em ${n}x: a soma das parcelas tem que dar exatamente 1100`, async () => {
      // A fixture usa a MESMA função que o wizard usa para montar os parâmetros
      // (AdminContracts.tsx:512 → updateFormState → calculateFinancials), então o
      // teste não inventa nenhum número: ele reproduz a entrada do usuário.
      const financeiro = calculateFinancials(1000, n, 10, 'auto', 0);
      expect(financeiro.totalValue).toBe(1100);

      const c = await createContract(ctx, {
        label: `GER${n}X`,
        amountInvested: 1000,
        currentValue: financeiro.totalValue,
        installmentValue: financeiro.installmentValue,
        totalInstallments: n,
        interestRate: 10,
        calculationMode: 'auto',
      });

      expect(c.installments).toHaveLength(n);

      // O banco tem que reproduzir a MESMA distribuição que a edição aplica.
      const parcelas = [...c.installments].sort((a, b) => a.number - b.number);
      const principais = distributeEvenly(1000, n);
      const totais = distributeEvenly(financeiro.totalValue, n);

      parcelas.forEach((p, idx) => {
        expect({
          numero: p.number,
          principal: num(p.amount_principal),
          juros: num(p.amount_interest),
          total: num(p.amount_total),
        }).toEqual({
          numero: idx + 1,
          principal: principais[idx],
          juros: roundCurrency(totais[idx] - principais[idx]),
          total: totais[idx],
        });
      });

      const soma = roundCurrency(parcelas.reduce((s, p) => s + num(p.amount_total), 0));
      expect(
        soma,
        `O contrato cobra R$ ${roundCurrency(soma - 1100)} a ${soma > 1100 ? 'MAIS' : 'MENOS'} que o ` +
          `current_value de R$ 1100,00 — o resíduo da divisão por ${n} não foi redistribuído.`
      ).toBe(1100);

      const somaPrincipal = roundCurrency(parcelas.reduce((s, p) => s + num(p.amount_principal), 0));
      expect(somaPrincipal, 'A soma dos principais tem que devolver o valor emprestado.').toBe(1000);

      // Cada linha tem que fechar sozinha — o caminho legado gravava um
      // amount_total que não era principal + juros.
      for (const p of parcelas) {
        expect(
          roundCurrency(num(p.amount_principal) + num(p.amount_interest)),
          `Parcela ${p.number}: amount_total ${num(p.amount_total)} != principal ` +
            `${num(p.amount_principal)} + juros ${num(p.amount_interest)}.`
        ).toBe(num(p.amount_total));
      }
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
    const primeira = [...c.installments].sort((a, b) => a.number - b.number)[0];

    // AdminContracts.tsx:2190 mostra investments.installment_value;
    // DashboardWidgets.tsx:853 mostra loan_installments.amount_total.
    expect(
      num(inv.installment_value),
      `Card do contrato exibe R$ ${num(inv.installment_value)} e a parcela regular da lista ` +
        `exibe R$ ${num(primeira.amount_total)}. São duas contas diferentes sobre a mesma entrada.`
    ).toBe(num(primeira.amount_total));
  });
});
