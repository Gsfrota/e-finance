import { describe, it, expect } from 'vitest';
import { detalheDe } from '../../services/assistantAnswerCollection';
import { linhasDeContratos, type ContratoRow } from '../../services/assistantAnswer';
import type { ReplyLine } from '../../utils/assistantTypes';

/**
 * BR-BOT-011 — a lista que abre embaixo da resposta.
 *
 * Só funções puras: montar as linhas e decidir o rótulo do botão. O clique em si
 * (abrir o contrato) é coberto pelo E2E, que é onde ele pode realmente quebrar.
 */

const linha = (over: Partial<ReplyLine> = {}): ReplyLine => ({
  key: 'k1',
  investmentId: 10,
  companyId: null,
  title: 'João da Silva',
  subtitle: 'Parcela 1/3 · vence 16/09',
  amount: 100,
  ...over,
});

describe('detalheDe — bloco expansível da resposta', () => {
  it('sem linha nenhuma não cria o bloco', () => {
    // `{}` e não `{ details: undefined }`: espalhado na resposta, a chave some
    expect(detalheDe([], 'parcela', 'parcelas')).toEqual({});
  });

  it('maior valor primeiro — quem decide a cobrança do dia fica no topo', () => {
    const r = detalheDe(
      [
        linha({ key: 'a', amount: 100 }),
        linha({ key: 'b', amount: 900 }),
        linha({ key: 'c', amount: 450 }),
      ],
      'parcela',
      'parcelas',
    );
    expect(r.details!.lines.map(l => l.key)).toEqual(['b', 'c', 'a']);
  });

  it('não altera o array que recebeu', () => {
    const original = [linha({ key: 'a', amount: 1 }), linha({ key: 'b', amount: 2 })];
    detalheDe(original, 'parcela', 'parcelas');
    expect(original.map(l => l.key)).toEqual(['a', 'b']);
  });

  it('rótulo do botão concorda em número', () => {
    expect(detalheDe([linha()], 'parcela', 'parcelas').details!.label).toBe('Ver a parcela');
    expect(detalheDe([linha({ key: 'a' }), linha({ key: 'b' })], 'parcela', 'parcelas').details!.label)
      .toBe('Ver as 2 parcelas');
  });
});

describe('linhasDeContratos — uma linha por contrato cadastrado na janela', () => {
  const row = (over: Partial<ContratoRow> = {}): ContratoRow => ({
    id: 6065,
    company_id: 'comp-1',
    amount_invested: 4000,
    created_at: '2026-09-09T13:00:00.000Z',
    asset_name: 'Capital de giro',
    profiles: { full_name: 'João da Silva' },
    ...over,
  });

  const semana = { start: '2026-09-07T03:00:00.000Z', end: '2026-09-14T03:00:00.000Z' };

  it('monta a linha com destino, cliente e data de cadastro', () => {
    const [l] = linhasDeContratos([row()], semana.start, semana.end);
    expect(l).toEqual({
      key: '6065',
      investmentId: 6065,
      companyId: 'comp-1',
      title: 'João da Silva',
      subtitle: 'Cadastrado em 09/09',
      amount: 4000,
    });
  });

  it('respeita a janela: fim é EXCLUSIVO', () => {
    const dentro = row({ id: 1, created_at: semana.start });
    const fora = row({ id: 2, created_at: semana.end });
    const ids = linhasDeContratos([dentro, fora], semana.start, semana.end).map(l => l.investmentId);
    expect(ids).toEqual([1]);
  });

  it('sem cadastro de cliente cai no nome do contrato, nunca em branco', () => {
    const [l] = linhasDeContratos([row({ profiles: null })], semana.start, semana.end);
    expect(l.title).toBe('Capital de giro');
    const [semNada] = linhasDeContratos(
      [row({ profiles: null, asset_name: null })],
      semana.start,
      semana.end,
    );
    expect(semNada.title).toBe('Sem nome');
  });

  it('ignora linha sem data — não dá para dizer se entrou na janela', () => {
    expect(linhasDeContratos([row({ created_at: null })], semana.start, semana.end)).toEqual([]);
  });
});
