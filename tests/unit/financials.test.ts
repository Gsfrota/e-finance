/**
 * utils/financials.ts — as fórmulas de dinheiro do produto, em Node puro.
 *
 * É AQUI que mora a taxa de juros do E-Finance: o banco nunca calcula juros de
 * contrato parcelado, ele recebe `current_value`/`installment_value` já prontos
 * (RPC create_investment_validated). Se estas funções erram, o SQL propaga sem
 * reclamar — e até 04/08/2026 elas tinham ZERO cobertura.
 *
 * Regra: todo `expect` afirma um número/string exato lido do código-fonte.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFreelancerDates,
  calculateFinancials,
  distributeEvenly,
  formatCurrency,
  formatDecimalInput,
  roundCurrency,
} from '@/utils/financials';

describe('calculateFinancials — mode "auto" (o modo do wizard, AdminContracts)', () => {
  // financials.ts:111 → total = principal * (1 + rate/100); installmentValue = total / count
  // NÃO é juros ao mês: é a taxa aplicada UMA vez sobre o principal inteiro.
  it('1000 a 10% em 12x → parcela 91,666… e total 1100 exatos', () => {
    expect(calculateFinancials(1000, 12, 10, 'auto', 0)).toEqual({
      installmentValue: 91.66666666666667,
      totalValue: 1100,
      interestRate: 10,
    });
  });

  it('1000 a 10% em 7x → parcela 157,142857… e total 1100 exatos', () => {
    expect(calculateFinancials(1000, 7, 10, 'auto', 0)).toEqual({
      installmentValue: 157.14285714285714,
      totalValue: 1100,
      interestRate: 10,
    });
  });

  it('1000 a 10% em 3x → parcela 366,666… e total 1100 exatos', () => {
    expect(calculateFinancials(1000, 3, 10, 'auto', 0)).toEqual({
      installmentValue: 366.6666666666667,
      totalValue: 1100,
      interestRate: 10,
    });
  });

  it('juros 0 é legal: 1000 em 10x → parcela 100, total 1000', () => {
    expect(calculateFinancials(1000, 10, 0, 'auto', 0)).toEqual({
      installmentValue: 100,
      totalValue: 1000,
      interestRate: 0,
    });
  });

  it('a multiplicação flutuante vaza para fora: 1500 a 12% em 5x NÃO dá 1680 exato', () => {
    // 1500 * 1.12 === 1680.0000000000002 em IEEE-754. A função não arredonda —
    // quem arredonda é o ROUND() do plpgsql, depois. Documentado, não consertado:
    // mudar isto muda o valor gravado em investments.current_value.
    const r = calculateFinancials(1500, 5, 12, 'auto', 0);
    expect(r.totalValue).toBe(1680.0000000000002);
    expect(r.installmentValue).toBe(336.00000000000006);
    expect(r.totalValue).not.toBe(1680);
  });
});

describe('calculateFinancials — mode "manual" (valor da parcela digitado)', () => {
  // financials.ts:118-125 → total = manual * count; impliedRate = ((total - principal)/principal)*100
  it('1000 em 12x de 100 → total 1200 e taxa implícita 20%', () => {
    expect(calculateFinancials(1000, 12, 0, 'manual', 100)).toEqual({
      installmentValue: 100,
      totalValue: 1200,
      interestRate: 20,
    });
  });

  it('1000 em 12x de 80 → taxa implícita NEGATIVA (-4%), sem erro', () => {
    // BUG CONFIRMADO: BR-CNT-002 exige interest_rate >= 0. Nem esta função nem
    // create_investment_validated validam isso — a taxa negativa é gravada em
    // investments.interest_rate e o contrato nasce dando prejuízo ao credor.
    // Correto seria rejeitar (ou exigir confirmação explícita). Não é escopo
    // deste teste consertar: mudar cálculo financeiro é decisão do dono.
    expect(calculateFinancials(1000, 12, 0, 'manual', 80)).toEqual({
      installmentValue: 80,
      totalValue: 960,
      interestRate: -4,
    });
  });
});

describe('calculateFinancials — mode "interest_only" (bullet)', () => {
  // financials.ts:99-108 → base = remainingBalance > 0 ? remainingBalance : principal
  //                        installmentValue = roundCurrency(base * rate/100)
  //                        totalValue = base  ⚠ o TOTAL é o PRINCIPAL, não principal+juros
  it('5000 a 5% → juros do ciclo 250 e totalValue 5000 (o principal, não 5250)', () => {
    expect(calculateFinancials(5000, 1, 5, 'interest_only', 0)).toEqual({
      installmentValue: 250,
      totalValue: 5000,
      interestRate: 5,
    });
  });

  it('bullet rotativo: com saldo devedor 3000, o juros passa a 150 e o total a 3000', () => {
    expect(calculateFinancials(5000, 1, 5, 'interest_only', 0, 'together', 3000)).toEqual({
      installmentValue: 150,
      totalValue: 3000,
      interestRate: 5,
    });
  });

  it('saldo devedor 0 (contrato quitado) volta a usar o principal original', () => {
    // `remainingBalance > 0` é falso → cai no principal. 0 não zera o juros.
    expect(calculateFinancials(5000, 1, 5, 'interest_only', 0, 'together', 0)).toEqual({
      installmentValue: 250,
      totalValue: 5000,
      interestRate: 5,
    });
  });
});

describe('calculateFinancials — guardas de entrada', () => {
  it('principal 0 zera parcela e total, mas preserva a taxa recebida', () => {
    expect(calculateFinancials(0, 12, 10, 'auto', 0)).toEqual({
      installmentValue: 0,
      totalValue: 0,
      interestRate: 10,
    });
  });

  it('principal negativo cai na mesma guarda de principal <= 0', () => {
    expect(calculateFinancials(-5, 12, 10, 'auto', 0)).toEqual({
      installmentValue: 0,
      totalValue: 0,
      interestRate: 10,
    });
  });

  it('0 parcelas é clampado para 1 (Math.max), não divide por zero', () => {
    expect(calculateFinancials(1000, 0, 10, 'auto', 0)).toEqual({
      installmentValue: 1100,
      totalValue: 1100,
      interestRate: 10,
    });
  });
});

describe('distributeEvenly — a redistribuição de centavos que a criação de contrato NÃO usa', () => {
  // financials.ts:10-17 → joga todo o resíduo na ÚLTIMA posição.
  // ⚠ Só é chamada em AdminContracts.tsx:891-892 (EDIÇÃO de contrato).
  // A criação (create_investment_validated, plpgsql) replica ROUND(principal/N,2)
  // + ROUND(juros/N,2) em todas as parcelas e o resíduo some. Os dois caminhos
  // discordam por construção — a prova numérica disso está na Camada 2
  // (e2e/contract-db/installment-generation.dbspec.ts).
  it('1100 em 7 → seis de 157,14 e uma de 157,16, somando exatamente 1100', () => {
    const values = distributeEvenly(1100, 7);
    expect(values).toEqual([157.14, 157.14, 157.14, 157.14, 157.14, 157.14, 157.16]);
    expect(roundCurrency(values.reduce((a, b) => a + b, 0))).toBe(1100);
  });

  it('1100 em 3 → 366,67 / 366,67 / 366,66, somando exatamente 1100', () => {
    const values = distributeEvenly(1100, 3);
    expect(values).toEqual([366.67, 366.67, 366.66]);
    expect(roundCurrency(values.reduce((a, b) => a + b, 0))).toBe(1100);
  });

  it('1100 em 12 → onze de 91,67 e uma de 91,63, somando exatamente 1100', () => {
    const values = distributeEvenly(1100, 12);
    expect(values).toEqual([91.67, 91.67, 91.67, 91.67, 91.67, 91.67, 91.67, 91.67, 91.67, 91.67, 91.67, 91.63]);
    expect(roundCurrency(values.reduce((a, b) => a + b, 0))).toBe(1100);
  });

  it('count <= 0 devolve lista vazia (não estoura)', () => {
    expect(distributeEvenly(1000, 0)).toEqual([]);
    expect(distributeEvenly(1000, -1)).toEqual([]);
  });
});

describe('roundCurrency — o arredondamento de todo o dinheiro do frontend', () => {
  // financials.ts:4-5 → Math.round((v + Number.EPSILON) * 100) / 100
  it('1.005 vira 1.01 (é para isso que o +EPSILON existe)', () => {
    expect(roundCurrency(1.005)).toBe(1.01);
    expect(Math.round(1.005 * 100) / 100).toBe(1); // sem o EPSILON daria 1.00
  });

  it('2.675 vira 2.68', () => {
    expect(roundCurrency(2.675)).toBe(2.68);
  });

  it('0.1 + 0.2 vira 0.3 exato', () => {
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
    expect(0.1 + 0.2).toBe(0.30000000000000004);
  });

  it('é assimétrico no negativo: -1.005 vira -1, não -1.01', () => {
    // BUG CONFIRMADO (menor): half-up arredonda em direção a +∞, então valores
    // negativos com meio-centavo perdem 1 centavo em vez de ganhar. Aparece em
    // estorno/reversão e no formatCurrency de saldos negativos. O correto para
    // dinheiro seria half-away-from-zero: -1.005 → -1.01.
    expect(roundCurrency(-1.005)).toBe(-1);
    expect(roundCurrency(-1.015)).toBe(-1.01);
  });
});

describe('formatCurrency / formatDecimalInput — o formato canônico do app', () => {
  it('1234.56 → "R$\\u00A01.234,56" com NBSP, nunca espaço ASCII', () => {
    const out = formatCurrency(1234.56);
    expect(out).toBe('R$ 1.234,56');
    // Armadilha de teste E2E: getByText('R$ 1.234,56') com espaço normal não casa.
    expect(out).not.toBe('R$ 1.234,56');
    expect(out.codePointAt(2)).toBe(0x00a0);
  });

  it('negativo põe o sinal ANTES do R$', () => {
    expect(formatCurrency(-50)).toBe('-R$ 50,00');
  });

  it('zero é "R$\\u00A00,00", não vazio', () => {
    expect(formatCurrency(0)).toBe('R$ 0,00');
  });

  it('formatDecimalInput arredonda antes de fixar 2 casas', () => {
    expect(formatDecimalInput(157.145)).toBe('157.15');
    expect(formatDecimalInput(0)).toBe('0.00');
  });
});

describe('buildFreelancerDates — datas de contrato "Livre" que vão para o banco', () => {
  // financials.ts:129-139. O retorno alimenta p_custom_dates da RPC de criação
  // (AdminContracts.tsx:556; LegacyContractPage.tsx:773) → vira due_date real.
  const originalTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it('no fuso do Brasil as datas saem corretas', () => {
    process.env.TZ = 'America/Sao_Paulo';
    expect(buildFreelancerDates(3, '2026-03-10', 7)).toEqual(['2026-03-10', '2026-03-17', '2026-03-24']);
  });

  it('num browser a leste de Greenwich toda data sai UM DIA ADIANTADA', () => {
    // BUG CONFIRMADO (BR-TZ-001): financials.ts:136 usa o padrão proibido
    //   dt.toISOString().split('T')[0]
    // sobre um Date construído em meia-noite LOCAL. Em fusos com offset positivo
    // (Asia/Tokyo = UTC+9) a meia-noite local é o dia anterior em UTC, então o
    // vencimento gravado no banco fica um dia antes do que o operador escolheu.
    // Correto seria formatar com services/dateUtils.toBrazilYMD.
    process.env.TZ = 'Asia/Tokyo';
    expect(buildFreelancerDates(3, '2026-03-10', 7)).toEqual(['2026-03-09', '2026-03-16', '2026-03-23']);

    // ⚠ DIVERGÊNCIA COM O BRIEFING: o documento "como-testar-o-saas.md" (§5.4 c-26)
    // afirma "Em BRT (UTC-3), os vencimentos saem um dia adiantados". Isso é FALSO —
    // em offset negativo a meia-noite local vira 03:00 UTC do MESMO dia. O bug só
    // existe para offsets positivos, como o teste acima prova.
  });
});
