import { describe, it, expect } from 'vitest';
import { formatLentVolumeAnswer, formatUnknownAnswer, type LentVolumeAnswer } from '../../services/assistantAnswer';

/**
 * BR-BOT-009 — texto de chat da resposta determinística.
 * Só funções puras: a query precisa de banco e é coberta pelo contrato de banco.
 */

// Intl pt-BR separa "R$" do número com NBSP (U+00A0); normalizar deixa a asserção legível.
const t = (s: string) => s.replace(/\u00a0/g, ' ');

const exemplo: LentVolumeAnswer = {
  week: { total: 3200, count: 2, startYMD: '2026-09-07' },
  last7: { total: 4200, count: 3, startYMD: '2026-09-06' },
};

describe('formatLentVolumeAnswer', () => {
  it('mostra os dois recortes com valor exato, quantidade e escopo', () => {
    const texto = t(formatLentVolumeAnswer(exemplo, 'todas as empresas'));

    expect(texto).toContain('Volume emprestado — todas as empresas:');
    expect(texto).toContain('*Semana corrente* (segunda 07/09 até hoje)\nR$ 3.200,00 em 2 contratos');
    expect(texto).toContain('*Últimos 7 dias* (06/09 até hoje)\nR$ 4.200,00 em 3 contratos');
  });

  it('deixa explícito que renovação conta', () => {
    expect(formatLentVolumeAnswer(exemplo, 'todas as empresas'))
      .toContain('Renovações contam como empréstimo.');
  });

  it('usa o escopo recebido, não um genérico', () => {
    expect(formatLentVolumeAnswer(exemplo, 'Frota Investimentos'))
      .toContain('Volume emprestado — Frota Investimentos:');
  });

  it('singulariza "contrato" quando é um só', () => {
    const texto = t(formatLentVolumeAnswer(
      { week: { total: 1500.5, count: 1, startYMD: '2026-09-07' }, last7: { total: 1500.5, count: 1, startYMD: '2026-09-06' } },
      'todas as empresas'
    ));
    expect(texto).toContain('R$ 1.500,50 em 1 contrato\n');
    expect(texto).not.toContain('1 contratos');
  });

  it('caso zero na semana: diz que não houve cadastro, sem parecer erro', () => {
    const texto = t(formatLentVolumeAnswer(
      { week: { total: 0, count: 0, startYMD: '2026-09-07' }, last7: { total: 900, count: 1, startYMD: '2026-09-06' } },
      'todas as empresas'
    ));
    expect(texto).toContain('*Semana corrente* (segunda 07/09 até hoje)\nNenhum contrato cadastrado nesse período — R$ 0,00');
    expect(texto).not.toMatch(/erro|falha/i);
    // a outra janela continua sendo respondida
    expect(texto).toContain('R$ 900,00 em 1 contrato');
  });

  it('formata milhar e centavos em pt-BR', () => {
    const texto = t(formatLentVolumeAnswer(
      { week: { total: 1234567.89, count: 12, startYMD: '2026-01-05' }, last7: { total: 0, count: 0, startYMD: '2026-01-04' } },
      'Matriz'
    ));
    expect(texto).toContain('R$ 1.234.567,89 em 12 contratos');
    expect(texto).toContain('(segunda 05/01 até hoje)');
  });
});

describe('formatUnknownAnswer', () => {
  it('recusa dizendo o que sabe hoje e dá um exemplo', () => {
    const texto = formatUnknownAnswer();
    expect(texto).toContain('Não entendi a pergunta.');
    expect(texto).toContain('quanto você emprestou na semana');
    expect(texto).toContain('"quanto emprestei essa semana?"');
  });

  it('não promete capacidade que não existe', () => {
    expect(formatUnknownAnswer()).not.toMatch(/\b(mês|mes|ano|atrasad|lucro|receb)/i);
  });
});
