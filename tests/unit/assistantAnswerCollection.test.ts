import { describe, it, expect } from 'vitest';
import {
  formatLateDebtors,
  formatReceivables,
  openAmountOf,
  type LateRow,
} from '../../services/assistantAnswerCollection';
import type { ResolvedPeriod } from '../../utils/assistantTypes';

/**
 * BR-BOT-010 — texto de chat das perguntas de cobrança.
 * Só funções puras: a query precisa de banco e é coberta pelo contrato de banco.
 */

// Intl pt-BR separa "R$" do número com NBSP (U+00A0); normalizar deixa a asserção legível.
const t = (s: string) => s.replace(/\u00a0/g, ' ');

const linha = (name: string, openAmount: number, daysLate: number): LateRow => ({ name, openAmount, daysLate });

const proximos7: ResolvedPeriod = {
  kind: 'next_7_days',
  label: 'nos próximos 7 dias',
  startISO: '2026-09-13T03:00:00.000Z',
  endISO: '2026-09-20T03:00:00.000Z',
  startYMD: '2026-09-13',
  endYMD: '2026-09-20',
};

describe('openAmountOf', () => {
  it('soma multa e juros de atraso e desconta o que já foi pago', () => {
    expect(openAmountOf({ amount_total: 1000, fine_amount: 50, interest_delay_amount: 30, amount_paid: 200 }))
      .toBe(880);
  });

  it('trata campos ausentes/null como zero', () => {
    expect(openAmountOf({ amount_total: 500, fine_amount: null, interest_delay_amount: null, amount_paid: null }))
      .toBe(500);
    expect(openAmountOf({})).toBe(0);
  });

  it('nunca devolve negativo — pagou a mais, saldo é zero', () => {
    expect(openAmountOf({ amount_total: 100, amount_paid: 250 })).toBe(0);
  });
});

describe('formatLateDebtors', () => {
  it('abre com o total em negrito e a contagem de clientes', () => {
    const texto = t(formatLateDebtors([linha('João', 2000, 12), linha('Maria', 1500, 3), linha('Zé', 810, 1)], 'todas as empresas').text);
    expect(texto.split('\n')[0]).toBe('Você tem *R$ 4.310,00* em atraso, de 3 clientes (todas as empresas).');
  });

  it('ordena por valor decrescente, não pela ordem recebida', () => {
    const texto = t(formatLateDebtors([linha('Zé', 810, 1), linha('João', 2000, 12), linha('Maria', 1500, 3)], 'Matriz').text);
    const nomes = texto.split('\n').filter(l => l.startsWith('•')).map(l => l.slice(2).split(' —')[0]);
    expect(nomes).toEqual(['João', 'Maria', 'Zé']);
  });

  it('singulariza cliente e dia quando é um só', () => {
    const texto = t(formatLateDebtors([linha('João', 900, 1)], 'Matriz').text);
    expect(texto).toContain('de 1 cliente (Matriz).');
    expect(texto).toContain('• João — R$ 900,00, há 1 dia');
    expect(texto).not.toContain('1 dias');
  });

  it('lista no máximo 5 clientes e fecha com "e mais N"', () => {
    const sete = Array.from({ length: 7 }, (_, i) => linha(`Cliente ${i + 1}`, (7 - i) * 100, i + 1));
    const texto = t(formatLateDebtors(sete, 'Matriz').text);
    expect(texto.split('\n').filter(l => l.startsWith('•'))).toHaveLength(5);
    expect(texto).toContain('...e mais 2 clientes.');
    // o total continua somando TODOS, não só os listados
    expect(texto).toContain('*R$ 2.800,00*');
  });

  it('singulariza o "e mais" quando sobra um só', () => {
    const seis = Array.from({ length: 6 }, (_, i) => linha(`Cliente ${i + 1}`, (6 - i) * 100, i + 1));
    expect(t(formatLateDebtors(seis, 'Matriz').text)).toContain('...e mais 1 cliente.');
  });

  it('caso vazio: tom positivo, sem parecer erro', () => {
    const reply = formatLateDebtors([], 'todas as empresas');
    expect(reply.text).toBe('Ninguém está atrasado agora (todas as empresas). Todas as parcelas em aberto estão em dia.');
    expect(reply.text).not.toMatch(/erro|falha|nenhum resultado/i);
  });

  it('sugere a próxima pergunta', () => {
    expect(formatLateDebtors([], 'Matriz').followUp).toBe('Quanto tenho pra receber essa semana?');
    expect(formatLateDebtors([linha('João', 10, 1)], 'Matriz').followUp).toBe('Quanto tenho pra receber essa semana?');
  });
});

describe('formatReceivables', () => {
  it('usa o label do período, o total em negrito e a contagem', () => {
    const texto = t(formatReceivables(12000, 8, proximos7, 'todas as empresas').text);
    expect(texto).toBe('Nos próximos 7 dias você tem *R$ 12.000,00* a receber, em 8 parcelas (todas as empresas).');
  });

  it('singulariza parcela', () => {
    expect(t(formatReceivables(1500.5, 1, proximos7, 'Matriz').text))
      .toContain('*R$ 1.500,50* a receber, em 1 parcela (Matriz).');
  });

  it('caso zero: diz claramente que nada vence na janela', () => {
    const reply = formatReceivables(0, 0, proximos7, 'Matriz');
    expect(reply.text).toBe('Nos próximos 7 dias você não tem nada a receber — nenhuma parcela vence nessa janela (Matriz).');
    expect(reply.text).not.toContain('R$ 0,00');
  });

  it('respeita outro período sem inventar janela', () => {
    const mes: ResolvedPeriod = { ...proximos7, kind: 'current_month', label: 'neste mês' };
    expect(t(formatReceivables(500, 2, mes, 'Matriz').text)).toContain('Neste mês você tem *R$ 500,00*');
  });

  it('sugere a próxima pergunta', () => {
    expect(formatReceivables(0, 0, proximos7, 'Matriz').followUp).toBe('Quem está atrasado?');
    expect(formatReceivables(1, 1, proximos7, 'Matriz').followUp).toBe('Quem está atrasado?');
  });
});
