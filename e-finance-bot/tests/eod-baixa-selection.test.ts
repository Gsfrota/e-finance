import { describe, expect, it } from 'vitest';
import { resolveBaixaSelection, formatBaixaResult, normalizeBaixaText } from '../src/scheduler/eod-baixa-selection';
import type { PendingPaymentFollowupItem } from '../src/scheduler/payment-followup';

const items: PendingPaymentFollowupItem[] = [
  { id: 'a', debtorName: 'João Silva', amount: 300 },
  { id: 'b', debtorName: 'Maria Souza', amount: 200 },
  { id: 'c', debtorName: 'Pedro Lima', amount: 150 },
];

describe('resolveBaixaSelection', () => {
  it('seleciona por número único', () => {
    const r = resolveBaixaSelection('1', items);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.selected.map(i => i.id)).toEqual(['a']);
  });

  it('seleciona por múltiplos números', () => {
    const r = resolveBaixaSelection('1, 3', items);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.selected.map(i => i.id)).toEqual(['a', 'c']);
  });

  it('seleciona por nome com "e"', () => {
    const r = resolveBaixaSelection('dar baixa em João e Maria', items);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.selected.map(i => i.id).sort()).toEqual(['a', 'b']);
  });

  it('seleciona por nome com vírgula', () => {
    const r = resolveBaixaSelection('paguei João, Pedro', items);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.selected.map(i => i.id).sort()).toEqual(['a', 'c']);
  });

  it('"todos" retorna kind all', () => {
    expect(resolveBaixaSelection('todos', items).kind).toBe('all');
    expect(resolveBaixaSelection('dar baixa em todas', items).kind).toBe('all');
  });

  it('nome curto não casa por substring (Ana não casa Mariana)', () => {
    const withMariana: PendingPaymentFollowupItem[] = [
      { id: 'x', debtorName: 'Mariana Alves', amount: 100 },
    ];
    const r = resolveBaixaSelection('dar baixa em Ana', withMariana);
    expect(r.kind).toBe('ambiguous'); // não encontrou "ana" na lista
  });

  it('nome ambíguo (casa >1) pede número', () => {
    const homonimos: PendingPaymentFollowupItem[] = [
      { id: 'j1', debtorName: 'João Silva', amount: 100 },
      { id: 'j2', debtorName: 'João Santos', amount: 200 },
    ];
    const r = resolveBaixaSelection('dar baixa em João', homonimos);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.message.toLowerCase()).toContain('número');
  });

  it('nome inexistente na lista pede número', () => {
    const r = resolveBaixaSelection('dar baixa em Carlos', items);
    expect(r.kind).toBe('ambiguous');
  });

  it('número fora do range é ambíguo', () => {
    const r = resolveBaixaSelection('9', items);
    expect(r.kind).toBe('ambiguous');
  });

  it('texto sem seleção retorna none', () => {
    expect(resolveBaixaSelection('oi', items).kind).toBe('none');
  });

  it('normaliza acentos', () => {
    expect(normalizeBaixaText('JOÃO')).toBe('joao');
  });
});

describe('formatBaixaResult', () => {
  it('reporta pagas, já pagas e falhas', () => {
    const text = formatBaixaResult(
      [{ id: 'a', debtorName: 'João', amount: 1 }],
      [{ id: 'b', debtorName: 'Maria', amount: 1 }],
      [{ id: 'c', debtorName: 'Pedro', amount: 1 }],
    );
    expect(text).toContain('Baixa registrada');
    expect(text).toContain('já estava');
    expect(text).toContain('não puderam ser baixadas');
  });

  it('mensagem default quando nada aconteceu', () => {
    expect(formatBaixaResult([], [], [])).toBe('✅ Concluído.');
  });
});
