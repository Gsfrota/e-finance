/**
 * services/salary.ts — BR-REL-018, a "fórmula única de rendimento".
 *
 * Alimenta LUCRO RECEBIDO (Visão Geral), "Você ganhou" (Salário) e
 * totalPrincipalRepaid (que por sua vez define CAPITAL EM RUA). É a função que
 * decide quanto do dinheiro que entrou é juros e quanto é principal devolvido.
 */
import { describe, expect, it } from 'vitest';
import { calcSalaryPortions, isSalaryPhantom } from '@/services/salary';

describe('calcSalaryPortions — parcela quitada com os componentes coerentes', () => {
  it('157,15 pagos de 142,86 + 14,29 devolvem os componentes integrais', () => {
    // |obligation - paid| = 0 <= 1 → salary.ts:67 devolve os valores crus.
    expect(
      calcSalaryPortions({
        status: 'paid',
        amount_principal: 142.86,
        amount_interest: 14.29,
        fine_amount: 0,
        interest_delay_amount: 0,
        amount_paid: 157.15,
      })
    ).toEqual({ juros: 14.29, atraso: 0, principal: 142.86, bruto: 157.15 });
  });

  it('multa e mora entram em "atraso", não em "juros"', () => {
    // 100 + 10 + 4 + 2 = 116 de obrigação, 116 pagos.
    expect(
      calcSalaryPortions({
        status: 'paid',
        amount_principal: 100,
        amount_interest: 10,
        fine_amount: 4,
        interest_delay_amount: 2,
        amount_paid: 116,
      })
    ).toEqual({ juros: 10, atraso: 6, principal: 100, bruto: 116 });
  });
});

describe('calcSalaryPortions — o rateio proporcional do bullet', () => {
  it('R$ 450 de juros pagos numa parcela de 3450 viram R$ 58,70 de juros e R$ 391,30 de principal', () => {
    // BUG CONFIRMADO (§1.12.1 / §1.12.8 do briefing):
    // pay_bullet_interest_only grava status='paid' com amount_paid = amount_interest (450)
    // mas mantém amount_total = 3450. salary.ts:58 detecta |3450 - 450| > 1 e rateia:
    //   ratio = 450/3450 = 0,130434...
    //   juros     = 450  * ratio = 58,695652173913040
    //   principal = 3000 * ratio = 391,304347826086940
    // Resultado: o dashboard credita R$ 391,30 de PRINCIPAL DEVOLVIDO num
    // pagamento em que nenhum centavo de principal voltou (remaining_balance
    // continua 5000), e reporta R$ 58,70 de lucro num recebimento de R$ 450.
    // Correto seria juros = 450, principal = 0 — mas isso exige que a RPC pare
    // de gravar amount_paid inconsistente com amount_total (ver Camada 2).
    const portions = calcSalaryPortions({
      status: 'paid',
      amount_principal: 3000,
      amount_interest: 450,
      fine_amount: 0,
      interest_delay_amount: 0,
      amount_paid: 450,
    });
    expect(portions).toEqual({
      juros: 58.69565217391304,
      atraso: 0,
      principal: 391.30434782608694,
      bruto: 450,
    });
  });

  it('as três fórmulas de "juros recebidos" do app divergem para a MESMA parcela', () => {
    // BUG CONFIRMADO — BR-REL-018 diz que é proibido recalcular porções inline,
    // e três consumidores ainda o fazem (§1.12.8):
    //   useYieldMetrics.ts:193 / Dashboard.tsx:216 / useInvestorMetrics.ts:93
    //     → usam amount_interest INTEGRAL          = R$ 450,00
    //   services/salary.ts (esta função)          = R$  58,70
    //   useContractDetail.ts:40-41                 = R$ 450,00 + R$ 3.000 de principal fantasma
    const inst = {
      status: 'paid',
      amount_principal: 3000,
      amount_interest: 450,
      fine_amount: 0,
      interest_delay_amount: 0,
      amount_paid: 450,
    };
    const canonico = calcSalaryPortions(inst).juros;
    const inlineDasAbasRendimentoMensalEGrafico = inst.amount_interest;

    expect(canonico).toBe(58.69565217391304);
    expect(inlineDasAbasRendimentoMensalEGrafico).toBe(450);
    expect(canonico).not.toBe(inlineDasAbasRendimentoMensalEGrafico);
    // A divergência que o usuário vê entre duas abas, em reais:
    expect(inlineDasAbasRendimentoMensalEGrafico - canonico).toBeCloseTo(391.3043478260869, 10);
  });

  it('parcela parcial rateia amount_paid entre os quatro componentes', () => {
    // 100 + 10 + 4 + 2 = 116; pagos 58 → ratio 0,5 exato.
    expect(
      calcSalaryPortions({
        status: 'partial',
        amount_principal: 100,
        amount_interest: 10,
        fine_amount: 4,
        interest_delay_amount: 2,
        amount_paid: 58,
      })
    ).toEqual({ juros: 5, atraso: 3, principal: 50, bruto: 58 });
  });
});

describe('calcSalaryPortions — parcela quitada por excedente (amount_paid = 0)', () => {
  it('credita a obrigação inteira como recebida, apesar de amount_paid ser 0', () => {
    // salary.ts:48-53. É intencional (a parcela foi quitada pelo excedente de
    // outra), mas significa que `bruto` NÃO é dinheiro que entrou nesta linha —
    // ele já foi contado na parcela de origem. Duplicidade contábil possível.
    expect(
      calcSalaryPortions({
        status: 'paid',
        amount_principal: 100,
        amount_interest: 10,
        fine_amount: 4,
        interest_delay_amount: 2,
        amount_paid: 0,
      })
    ).toEqual({ juros: 10, atraso: 6, principal: 100, bruto: 116 });
  });

  it('parcela fantasma (tudo zero) devolve zeros, sem NaN', () => {
    expect(
      calcSalaryPortions({
        status: 'paid',
        amount_principal: 0,
        amount_interest: 0,
        fine_amount: 0,
        interest_delay_amount: 0,
        amount_paid: 0,
      })
    ).toEqual({ juros: 0, atraso: 0, principal: 0, bruto: 0 });
  });

  it('valores em string (o que o PostgREST devolve para numeric) são coagidos', () => {
    expect(
      calcSalaryPortions({
        status: 'paid',
        amount_principal: '142.86',
        amount_interest: '14.29',
        fine_amount: null,
        interest_delay_amount: undefined,
        amount_paid: '157.15',
      })
    ).toEqual({ juros: 14.29, atraso: 0, principal: 142.86, bruto: 157.15 });
  });
});

describe('isSalaryPhantom — BR-REL-002', () => {
  it('só é fantasma com status paid E total 0 E pago 0', () => {
    expect(isSalaryPhantom({ status: 'paid', amount_total: 0, amount_paid: 0 })).toBe(true);
    expect(isSalaryPhantom({ status: 'paid', amount_total: 100, amount_paid: 100 })).toBe(false);
    expect(isSalaryPhantom({ status: 'pending', amount_total: 0, amount_paid: 0 })).toBe(false);
    // Uma parcela zerada ainda 'pending' não é fantasma — mark_installment_missed
    // sempre marca 'paid' ao zerar (§1.10).
  });
});
