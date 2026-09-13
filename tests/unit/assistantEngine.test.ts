import { describe, it, expect } from 'vitest';
import { matchAssistant, resolvePeriod, sumLentInRange } from '../../utils/assistantEngine';
import {
  getWeekToDateRangeBR,
  getLast7DaysRangeBR,
  getWeekRemainderRangeBR,
} from '../../services/dateUtils';

/**
 * BR-BOT-009 — pergunta determinística "quanto emprestei essa semana".
 * Cada teste afirma o critério da BR, não a implementação.
 */

describe('sumLentInRange', () => {
  const rows = [
    { amount_invested: 2000, created_at: '2026-09-08T19:04:24.000Z' },   // 16:04 BRT seg 08
    { amount_invested: '1500', created_at: '2026-09-11T22:22:03.000Z' }, // 19:22 BRT sex 11
    { amount_invested: 500, created_at: '2026-09-06T20:00:00.000Z' },    // dom 06 — semana anterior
    { amount_invested: 999, created_at: null },                          // sem data — ignorada
  ];

  it('soma só o que está na janela e conta os contratos', () => {
    const r = sumLentInRange(rows, '2026-09-07T03:00:00.000Z', '2026-09-13T03:00:00.000Z');
    expect(r).toEqual({ total: 3500, count: 2 });
  });

  it('fim da janela é exclusivo', () => {
    const r = sumLentInRange(
      [{ amount_invested: 100, created_at: '2026-09-13T03:00:00.000Z' }],
      '2026-09-07T03:00:00.000Z',
      '2026-09-13T03:00:00.000Z',
    );
    expect(r).toEqual({ total: 0, count: 0 });
  });

  it('renovação conta como empréstimo (BR-BOT-009)', () => {
    const comRenovacao = [
      { amount_invested: 1000, created_at: '2026-09-09T15:00:00.000Z', parent_investment_id: 4181 },
      { amount_invested: 1000, created_at: '2026-09-09T16:00:00.000Z', parent_investment_id: null },
    ];
    const r = sumLentInRange(comRenovacao, '2026-09-07T03:00:00.000Z', '2026-09-13T03:00:00.000Z');
    expect(r).toEqual({ total: 2000, count: 2 });
  });
});

describe('janelas em BRT (UTC-3, fuso de Mossoró)', () => {
  // Sábado 12/09/2026 23:30 BRT = 13/09 02:30 UTC — o caso que quebra quem usa UTC.
  const sabadoNoite = new Date('2026-09-13T02:30:00.000Z');

  it('semana corrente começa na segunda 00:00 BRT e termina no fim de hoje', () => {
    const r = getWeekToDateRangeBR(sabadoNoite);
    expect(r.startYMD).toBe('2026-09-07'); // segunda
    expect(r.startISO).toBe('2026-09-07T03:00:00.000Z');
    expect(r.endYMD).toBe('2026-09-13'); // domingo 00:00 BRT, exclusivo
    expect(r.endISO).toBe('2026-09-13T03:00:00.000Z');
  });

  it('últimos 7 dias cobrem hoje-6 até o fim de hoje', () => {
    const r = getLast7DaysRangeBR(sabadoNoite);
    expect(r.startYMD).toBe('2026-09-06'); // sábado 12 menos 6 dias = domingo 06
    expect(r.endYMD).toBe('2026-09-13');
  });

  it('na segunda, a semana corrente é só o próprio dia', () => {
    const segunda = new Date('2026-09-07T13:00:00.000Z'); // 10:00 BRT seg
    expect(getWeekToDateRangeBR(segunda).startYMD).toBe('2026-09-07');
    expect(getLast7DaysRangeBR(segunda).startYMD).toBe('2026-09-01'); // atravessa o mês
  });

  it('no domingo, a semana corrente ainda é a que começou na segunda anterior', () => {
    const domingo = new Date('2026-09-13T14:00:00.000Z'); // 11:00 BRT dom 13
    expect(getWeekToDateRangeBR(domingo).startYMD).toBe('2026-09-07');
    expect(getWeekToDateRangeBR(domingo).endYMD).toBe('2026-09-14');
  });

  // O recebível olha pra frente: "a receber essa semana" não pode devolver parcela
  // que já venceu segunda passada.
  it('o restante da semana vai de hoje até segunda 00:00', () => {
    const quarta = new Date('2026-09-09T13:00:00.000Z'); // 10:00 BRT qua 09
    expect(getWeekRemainderRangeBR(quarta).startYMD).toBe('2026-09-09');
    expect(getWeekRemainderRangeBR(quarta).endYMD).toBe('2026-09-14'); // domingo incluído

    const domingo = new Date('2026-09-13T14:00:00.000Z');
    expect(getWeekRemainderRangeBR(domingo).startYMD).toBe('2026-09-13');
    expect(getWeekRemainderRangeBR(domingo).endYMD).toBe('2026-09-14'); // só o próprio dia

    const segunda = new Date('2026-09-07T13:00:00.000Z');
    expect(getWeekRemainderRangeBR(segunda).startYMD).toBe('2026-09-07');
    expect(getWeekRemainderRangeBR(segunda).endYMD).toBe('2026-09-14'); // a semana inteira
  });
});

/**
 * BR-BOT-010 — catálogo de 5 intents + período citado na frase.
 * Sábado 12/09/2026 23:30 BRT = 13/09 02:30 UTC — o `now` fixo de todos os testes.
 */
const SABADO_NOITE = new Date('2026-09-13T02:30:00.000Z');
const em = (texto: string) => matchAssistant(texto, SABADO_NOITE);

describe('matchAssistant — intents', () => {
  it('lent_volume nas formas que o cliente usa', () => {
    for (const p of [
      'quanto emprestei essa semana',
      'qual o total emprestado na semana',
      'quanto que eu botei na rua nos ultimos 30 dias',
    ]) {
      expect(em(p).intent, p).toBe('lent_volume');
    }
  });

  it('late_debtors: atraso, inadimplência e cobrança', () => {
    for (const p of [
      'quem esta atrasado',
      'quem ta atrasado?',
      'quem nao pagou',
      'quem devo cobrar',
      'me lista os inadimplentes',
    ]) {
      expect(em(p).intent, p).toBe('late_debtors');
    }
  });

  it('receivables: o que ainda vai entrar', () => {
    for (const p of [
      'quanto tenho pra receber',
      'quais recebiveis eu tenho',
      'o que vence nos proximos 5 dias',
    ]) {
      expect(em(p).intent, p).toBe('receivables');
    }
  });

  it('received: o que já entrou', () => {
    for (const p of ['quanto recebi hoje', 'quanto entrou ontem', 'quanto caiu essa semana']) {
      expect(em(p).intent, p).toBe('received');
    }
  });

  it('o tempo verbal decide: "vou receber" é futuro, "recebi" é passado', () => {
    expect(em('quanto vou receber').intent).toBe('receivables');
    expect(em('quanto recebi').intent).toBe('received');
    expect(em('quanto vou receber hoje').intent).toBe('receivables');
    expect(em('quanto recebi hoje').intent).toBe('received');
  });

  it('unknown para o que está fora do catálogo', () => {
    expect(em('').intent).toBe('unknown');
    expect(em('bom dia, tudo certo?').intent).toBe('unknown');
    expect(em('cadastra um contrato novo pro joao').intent).toBe('unknown');
  });
});

describe('matchAssistant — debtor_balance e extração de nome', () => {
  it('extrai o nome nas quatro formas da BR', () => {
    expect(em('quanto o João me deve')).toMatchObject({ intent: 'debtor_balance', debtorName: 'joao' });
    expect(em('saldo do João')).toMatchObject({ intent: 'debtor_balance', debtorName: 'joao' });
    expect(em('quanto falta o João pagar')).toMatchObject({ intent: 'debtor_balance', debtorName: 'joao' });
    expect(em('o João deve quanto?')).toMatchObject({ intent: 'debtor_balance', debtorName: 'joao' });
  });

  it('mantém nome composto e devolve sem acento nem caixa', () => {
    expect(em('quanto a Maria Aparecida me deve').debtorName).toBe('maria aparecida');
  });

  it('sem nome extraível é unknown — não chuta', () => {
    expect(em('quanto me devem').intent).toBe('unknown');
    expect(em('saldo').intent).toBe('unknown');
  });
});

describe('matchAssistant — período citado', () => {
  it('reconhece cada forma suportada', () => {
    expect(em('quanto recebi hoje').period?.kind).toBe('today');
    expect(em('quanto recebi ontem').period?.kind).toBe('yesterday');
    expect(em('quanto emprestei essa semana').period?.kind).toBe('current_week');
    expect(em('quanto emprestei nos ultimos 7 dias').period?.kind).toBe('last_7_days');
    expect(em('quanto emprestei esse mes').period?.kind).toBe('current_month');
    expect(em('quanto emprestei no mes atual').period?.kind).toBe('current_month');
    expect(em('quanto emprestei nos ultimos 15 dias').period?.kind).toBe('last_n_days');
    expect(em('quanto vou receber nos proximos 3 dias').period?.kind).toBe('next_n_days');
    expect(em('quanto vou receber nos proximos 7 dias').period?.kind).toBe('next_7_days');
    expect(em('quanto vou receber na proxima semana').period?.kind).toBe('next_7_days');
  });

  it('frase sem período deixa period null — a intent usa o padrão dela', () => {
    expect(em('quem esta atrasado').period).toBeNull();
    expect(em('quanto o joao me deve').period).toBeNull();
  });

  it('"quanto emprestei hoje" agora é válido (antes era recusado por falta de período)', () => {
    expect(em('quanto emprestei hoje')).toMatchObject({ intent: 'lent_volume' });
    expect(em('quanto emprestei hoje').period?.startYMD).toBe('2026-09-12');
  });

  it('período fora do catálogo derruba a intent inteira (BR-BOT-010)', () => {
    for (const p of [
      'quanto emprestei no ano passado',
      'quanto emprestei mes passado',
      'quanto recebi no semestre',
      'quem esta atrasado desde o ano passado',
      'quanto vou receber amanha',
      'quanto emprestei nos ultimos 400 dias',
      'quanto emprestei nos ultimos 0 dias',
    ]) {
      expect(em(p), p).toEqual({ intent: 'unknown', period: null });
    }
  });
});

describe('resolvePeriod (now = sábado 12/09/2026 23:30 BRT)', () => {
  const r = (kind: Parameters<typeof resolvePeriod>[0], n?: number) =>
    resolvePeriod(kind, SABADO_NOITE, n);

  it('hoje e ontem começam à meia-noite BRT (03:00 UTC) e terminam exclusivos', () => {
    expect(r('today')).toMatchObject({
      label: 'hoje',
      startISO: '2026-09-12T03:00:00.000Z',
      endISO: '2026-09-13T03:00:00.000Z',
      startYMD: '2026-09-12',
      endYMD: '2026-09-13',
    });
    expect(r('yesterday')).toMatchObject({
      label: 'ontem',
      startISO: '2026-09-11T03:00:00.000Z',
      endISO: '2026-09-12T03:00:00.000Z',
    });
  });

  it('semana e últimos 7 dias reusam as janelas da BR-BOT-009', () => {
    expect(r('current_week')).toMatchObject({ label: 'esta semana', startYMD: '2026-09-07', endYMD: '2026-09-13' });
    expect(r('last_7_days')).toMatchObject({ label: 'nos últimos 7 dias', startYMD: '2026-09-06', endYMD: '2026-09-13' });
  });

  it('mês corrente vai do dia 1 até o fim de hoje, não até o fim do mês', () => {
    expect(r('current_month')).toMatchObject({
      label: 'neste mês',
      startISO: '2026-09-01T03:00:00.000Z',
      endISO: '2026-09-13T03:00:00.000Z',
    });
  });

  it('últimos N dias incluem hoje e atravessam o mês', () => {
    expect(r('last_n_days', 15)).toMatchObject({
      label: 'nos últimos 15 dias',
      startYMD: '2026-08-29',
      endYMD: '2026-09-13',
    });
    expect(r('last_n_days', 1)).toMatchObject({ label: 'no último dia', startYMD: '2026-09-12' });
  });

  it('próximos N dias começam hoje e terminam no dia N (exclusivo)', () => {
    expect(r('next_7_days')).toMatchObject({
      label: 'nos próximos 7 dias',
      startYMD: '2026-09-12',
      endYMD: '2026-09-19',
    });
    expect(r('next_n_days', 3)).toMatchObject({ label: 'nos próximos 3 dias', endYMD: '2026-09-15' });
  });

  it('é determinística: mesma frase + mesmo now ⇒ mesmo resultado', () => {
    expect(em('quanto emprestei nos ultimos 15 dias')).toEqual(em('quanto emprestei nos ultimos 15 dias'));
  });
});
