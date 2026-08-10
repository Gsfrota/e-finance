/**
 * services/paymentAudit.ts — calcBreakdown.
 *
 * O resultado desta função vai direto para payment_transactions.principal_portion
 * / interest_portion / extras_portion, e é DELA que revert_installment_payment
 * depende para saber quanto devolver (§1.10 do briefing). Errar aqui não
 * aparece na tela — aparece na reversão, meses depois.
 */
import { describe, expect, it } from 'vitest';
import { calcBreakdown } from '@/services/paymentAudit';
import type { LoanInstallment } from '@/types';

const inst = (over: Partial<LoanInstallment>): LoanInstallment => ({
  id: '00000000-0000-0000-0000-000000000001',
  investment_id: 1,
  tenant_id: '00000000-0000-0000-0000-0000000000ff',
  number: 1,
  due_date: '2026-08-10',
  amount_principal: 0,
  amount_interest: 0,
  amount_total: 0,
  amount_paid: 0,
  fine_amount: 0,
  interest_delay_amount: 0,
  status: 'pending',
  ...over,
});

describe('calcBreakdown', () => {
  it('quitação integral com multa e mora reparte 190 / 10 / 6 sobre 206', () => {
    expect(
      calcBreakdown(
        inst({ amount_principal: 190, amount_interest: 10, fine_amount: 4, interest_delay_amount: 2 }),
        206
      )
    ).toEqual({ principal_portion: 190, interest_portion: 10, extras_portion: 6 });
  });

  it('pagamento parcial rateia proporcionalmente à obrigação, com encargos incluídos', () => {
    // 100 de 206 → ratio 0,485436893...
    expect(
      calcBreakdown(
        inst({ amount_principal: 190, amount_interest: 10, fine_amount: 4, interest_delay_amount: 2 }),
        100
      )
    ).toEqual({
      principal_portion: 92.23300970873787,
      interest_portion: 4.854368932038835,
      extras_portion: 2.912621359223301,
    });
  });

  it('grava 14 casas decimais numa coluna de dinheiro — não arredonda', () => {
    // BUG CONFIRMADO: paymentAudit.ts:50-54 devolve `paidAmount * (x/obligation)`
    // com precisão total de float e o INSERT vai cru para colunas `numeric` sem
    // escala fixa. A soma das porções de um contrato deixa de fechar em centavos,
    // e a reversão (que subtrai esses valores) herda o resíduo.
    // Correto seria roundCurrency() nas três porções — como faz calcSalaryPortions
    // nos consumidores de tela. Não corrigido aqui: muda dado contábil gravado.
    const r = calcBreakdown(inst({ amount_principal: 142.86, amount_interest: 14.29 }), 157.15);
    expect(r.principal_portion).toBe(142.86);
    expect(r.interest_portion).toBe(14.290000000000001);
    expect(r.interest_portion).not.toBe(14.29);
  });

  it('parcela sem obrigação devolve zeros em vez de NaN (divisão por zero)', () => {
    expect(calcBreakdown(inst({}), 100)).toEqual({
      principal_portion: 0,
      interest_portion: 0,
      extras_portion: 0,
    });
  });
});
