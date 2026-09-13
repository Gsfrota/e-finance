import { describe, it, expect } from 'vitest';
import { matchAssistantIntent, sumLentInRange } from '../../utils/assistantEngine';
import { getWeekToDateRangeBR, getLast7DaysRangeBR } from '../../services/dateUtils';

/**
 * BR-BOT-009 — pergunta determinística "quanto emprestei essa semana".
 * Cada teste afirma o critério da BR, não a implementação.
 */

describe('matchAssistantIntent', () => {
  it('reconhece as formas que o cliente usa', () => {
    for (const pergunta of [
      'quanto emprestei essa semana',
      'Quanto eu emprestei essa semana?',
      'quanto investi na semana',
      'qual o total emprestado na semana',
      'quanto que eu coloquei na rua essa semana',
    ]) {
      expect(matchAssistantIntent(pergunta), pergunta).toBe('lent_volume');
    }
  });

  it('não chuta: período não suportado não vira semana', () => {
    expect(matchAssistantIntent('quanto emprestei esse mês')).toBe('unknown');
    expect(matchAssistantIntent('quanto emprestei hoje')).toBe('unknown');
    expect(matchAssistantIntent('quanto emprestei no ano')).toBe('unknown');
  });

  it('não casa pergunta sem intenção de volume nem texto vazio', () => {
    expect(matchAssistantIntent('quem está atrasado')).toBe('unknown');
    expect(matchAssistantIntent('emprestei pro João')).toBe('unknown'); // sem "quanto/total"
    expect(matchAssistantIntent('')).toBe('unknown');
  });
});

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
});
