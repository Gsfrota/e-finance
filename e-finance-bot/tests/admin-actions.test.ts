import { describe, expect, it } from 'vitest';
import {
  buildCanonicalInstallmentSchedule,
  extractDebtorNameSimple,
  isValidCpf,
  normalizeCpf,
  parseContractTextDeterministic,
  summarizeDashboardRows,
  summarizeUserDebtContracts,
} from '../src/actions/admin-actions';

// BUG-3: extractDebtorNameSimple não deve retornar keywords de comando como nome
describe('extractDebtorNameSimple', () => {
  it('retorna null para "criar contrato" (sem nome real)', () => {
    expect(extractDebtorNameSimple('criar contrato')).toBeNull();
  });

  it('retorna null para "contrato" isolado', () => {
    expect(extractDebtorNameSimple('contrato')).toBeNull();
  });

  it('extrai nome real quando presente', () => {
    const name = extractDebtorNameSimple('criar contrato para João Silva');
    expect(name).toBe('João Silva');
  });

  it('extrai nome simples', () => {
    const name = extractDebtorNameSimple('João');
    expect(name).toBe('João');
  });
});

describe('CPF helpers', () => {
  it('normaliza cpf com máscara', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
  });

  it('valida cpf válido e rejeita inválido', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('52998224724')).toBe(false);
  });
});

describe('buildCanonicalInstallmentSchedule', () => {
  it('gera cronograma mensal estável para criação de contrato', () => {
    const rows = buildCanonicalInstallmentSchedule({
      amountInvested: 900,
      currentValue: 1080,
      installmentValue: 360,
      totalInstallments: 3,
      frequency: 'monthly',
      dueDay: 9,
      now: new Date('2026-03-06T12:00:00-03:00'),
    });

    expect(rows.map(row => row.dueDate)).toEqual([
      '2026-03-09',
      '2026-04-09',
      '2026-05-09',
    ]);
    expect(rows.map(row => row.amountTotal)).toEqual([360, 360, 360]);
  });

  it('respeita start_date quando fornecida', () => {
    const rows = buildCanonicalInstallmentSchedule({
      amountInvested: 1000,
      currentValue: 2000,
      installmentValue: 200,
      totalInstallments: 3,
      frequency: 'monthly',
      dueDay: 5,
      startDate: '2026-04-05',
      now: new Date('2026-03-06T12:00:00-03:00'),
    });

    expect(rows.map(row => row.dueDate)).toEqual([
      '2026-04-05',
      '2026-05-05',
      '2026-06-05',
    ]);
  });
});

describe('parseContractTextDeterministic', () => {
  it('extrai contrato completo em PT-BR', () => {
    const parsed = parseContractTextDeterministic('criar contrato para João Silva, CPF 529.982.247-25, R$ 5.000, 3% ao mês, 12 parcelas mensais');

    expect(parsed).toMatchObject({
      debtor_name: 'João Silva',
      debtor_cpf: '52998224725',
      amount: 5000,
      rate: 3,
      installments: 12,
      frequency: 'monthly',
    });
  });

  it('entende notação em k e semanal', () => {
    const parsed = parseContractTextDeterministic('empréstimo para Maria Clara de 2,5k em 5x semanais');

    expect(parsed).toMatchObject({
      debtor_name: 'Maria Clara',
      amount: 2500,
      rate: 0,
      installments: 5,
      frequency: 'weekly',
    });
  });

  it('entende padrão principal por total e due day', () => {
    const parsed = parseContractTextDeterministic('Empréstimo pessoal para Icaro Soares, CPF 52998224725, ele vai receber 1000 reais por 2000, vai pagar 10 parcelas todo dia 5');

    expect(parsed).toMatchObject({
      debtor_name: 'Icaro Soares',
      debtor_cpf: '52998224725',
      amount: 1000,
      total_repayment: 2000,
      installments: 10,
      frequency: 'monthly',
      due_day: 5,
      derived_rate_source: 'period_total',
    });
    // rate is monthly: (2000/1000 - 1) * 100 / 10 installments = 10% a.m.
    expect(parsed?.rate).toBeCloseTo(10, 4);
  });

  it('retorna null quando faltam dados mínimos', () => {
    const parsed = parseContractTextDeterministic('quero criar algo pra depois');
    expect(parsed).toBeNull();
  });
});

describe('summarizeDashboardRows', () => {
  it('considera recebido por mês de pagamento mesmo com vencimento futuro', () => {
    const summary = summarizeDashboardRows(
      [
        {
          investment_id: 'inv-1',
          amount_total: 200,
          amount_paid: 200,
          status: 'paid',
          due_date: '2026-04-10',
          paid_at: '2026-03-04T12:00:00Z',
        },
        {
          investment_id: 'inv-2',
          amount_total: 500,
          amount_paid: 100,
          status: 'partial',
          due_date: '2026-03-25',
          paid_at: null,
        },
        {
          investment_id: 'inv-3',
          amount_total: 300,
          amount_paid: 0,
          status: 'late',
          due_date: '2026-03-01',
          paid_at: null,
        },
      ],
      3,
      new Date('2026-03-20T12:00:00-03:00'),
      'America/Fortaleza'
    );

    expect(summary.receivedByPaymentMonth).toBe(200);
    expect(summary.receivedByDueMonth).toBe(0);
    expect(summary.receivedMonth).toBe(200);
    expect(summary.expectedMonth).toBe(700);
    expect(summary.totalOverdue).toBe(300);
    expect(summary.overdueContracts).toBe(1);
    expect(summary.activeContracts).toBe(3);
  });
});

describe('summarizeUserDebtContracts', () => {
  it('resume rentabilidade prevista e recebido por contrato', () => {
    const summary = summarizeUserDebtContracts(
      [
        { id: 77, asset_name: 'Contrato #77 - Icaro', amount_invested: 1000, current_value: 2000 },
        { id: 84, asset_name: 'Contrato #84 - Icaro', amount_invested: 500, current_value: 1250 },
      ],
      [
        { investment_id: 77, amount_total: 200, amount_paid: 200, due_date: '2026-03-05', status: 'paid' },
        { investment_id: 77, amount_total: 200, amount_paid: 0, due_date: '2026-04-05', status: 'pending' },
        { investment_id: 84, amount_total: 250, amount_paid: 250, due_date: '2026-03-06', status: 'paid' },
        { investment_id: 84, amount_total: 250, amount_paid: 0, due_date: '2026-04-06', status: 'pending' },
      ],
    );

    expect(summary.totalDebt).toBe(450);
    expect(summary.pendingInstallments).toBe(2);
    expect(summary.nextDueDate).toBe('2026-04-05');
    expect(summary.nextDueAmount).toBe(200);
    expect(summary.activeContracts).toBe(2);
    expect(summary.totalProjectedProfit).toBe(1750);
    expect(summary.totalReceivedAmount).toBe(450);

    expect(summary.contracts).toEqual([
      expect.objectContaining({
        contractId: 77,
        projectedProfit: 1000,
        projectedReturnPct: 100,
        receivedAmount: 200,
        openBalance: 200,
        nextDueDate: '2026-04-05',
      }),
      expect.objectContaining({
        contractId: 84,
        projectedProfit: 750,
        projectedReturnPct: 150,
        receivedAmount: 250,
        openBalance: 250,
        nextDueDate: '2026-04-06',
      }),
    ]);
  });
});
