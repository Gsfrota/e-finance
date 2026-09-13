import { describe, it, expect } from 'vitest';
import {
  formatReceived,
  formatDebtorBalance,
  formatDebtorNotFound,
  formatDebtorAmbiguous,
  installmentOpenAmount as aberto,
} from '../../services/assistantAnswerMoney';
import type { ResolvedPeriod } from '../../utils/assistantTypes';

/**
 * BR-BOT-010 — texto de chat de "quanto recebi" e "quanto o Fulano me deve".
 * Só funções puras: a query precisa de banco e é coberta pelo contrato de banco.
 */

// Intl pt-BR separa "R$" do número com NBSP (U+00A0); normalizar deixa a asserção legível.
const t = (s: string) => s.replace(/\u00a0/g, ' ');

const hoje: ResolvedPeriod = {
  kind: 'today',
  label: 'hoje',
  startISO: '2026-09-13T03:00:00.000Z',
  endISO: '2026-09-14T03:00:00.000Z',
  startYMD: '2026-09-13',
  endYMD: '2026-09-14',
};

const ultimos15: ResolvedPeriod = {
  ...hoje,
  kind: 'last_n_days',
  label: 'nos últimos 15 dias',
};

describe('formatReceived', () => {
  it('diz o valor, a quantidade e o escopo', () => {
    const r = formatReceived(3200, 5, hoje, 'todas as empresas');
    expect(t(r.text)).toBe('Hoje entraram *R$ 3.200,00* em 5 pagamentos (todas as empresas).');
    expect(r.followUp).toBe('Quem está atrasado?');
  });

  it('singulariza "pagamento" quando é um só', () => {
    const texto = t(formatReceived(1500.5, 1, hoje, 'Matriz').text);
    expect(texto).toContain('em 1 pagamento (');
    expect(texto).not.toContain('1 pagamentos');
    expect(texto).toContain('R$ 1.500,50');
  });

  it('caso zero: diz que nada entrou, sem parecer erro', () => {
    const texto = t(formatReceived(0, 0, hoje, 'todas as empresas').text);
    expect(texto).toBe('Nenhum pagamento entrou hoje (todas as empresas).');
    expect(texto).not.toMatch(/erro|falha/i);
  });

  it('usa o label do período recebido, capitalizado', () => {
    expect(t(formatReceived(900, 2, ultimos15, 'Matriz').text))
      .toBe('Nos últimos 15 dias entraram *R$ 900,00* em 2 pagamentos (Matriz).');
    expect(t(formatReceived(0, 0, ultimos15, 'Matriz').text))
      .toBe('Nenhum pagamento entrou nos últimos 15 dias (Matriz).');
  });

  it('negrito estilo WhatsApp só no número', () => {
    const texto = t(formatReceived(1234567.89, 12, hoje, 'Matriz').text);
    expect(texto).toContain('*R$ 1.234.567,89*');
    expect(texto.match(/\*/g)).toHaveLength(2);
  });
});

describe('formatDebtorBalance', () => {
  it('diz saldo, contratos e próximo vencimento em DD/MM', () => {
    const r = formatDebtorBalance('João da Silva', 8450, 2, '2026-09-15');
    expect(t(r.text)).toBe('João da Silva tem *R$ 8.450,00* em aberto, em 2 contratos. O próximo vencimento é 15/09.');
    expect(r.followUp).toBe('Quanto tenho pra receber essa semana?');
  });

  it('singulariza "contrato" quando é um só', () => {
    const texto = t(formatDebtorBalance('Ana', 500, 1, '2026-12-01').text);
    expect(texto).toContain('em 1 contrato.');
    expect(texto).not.toContain('1 contratos');
    expect(texto).toContain('O próximo vencimento é 01/12.');
  });

  it('sem próximo vencimento: omite a frase e nunca escreve "null"', () => {
    const texto = t(formatDebtorBalance('Ana', 500, 1, null).text);
    expect(texto).toBe('Ana tem *R$ 500,00* em aberto, em 1 contrato.');
    expect(texto).not.toContain('null');
    expect(texto).not.toContain('vencimento');
  });

  it('saldo zero: diz que não deve nada (cliente existe)', () => {
    const texto = t(formatDebtorBalance('Ana', 0, 0, null).text);
    expect(texto).toBe('Ana não tem nada em aberto.');
    expect(texto).not.toContain('R$');
  });
});

describe('formatDebtorNotFound', () => {
  it('diz que não achou o cadastro — nunca R$ 0,00', () => {
    const texto = formatDebtorNotFound('Fulano');
    expect(texto.text).toContain('Não achei nenhum cliente chamado "Fulano"');
    expect(texto.text).not.toContain('R$');
    expect(texto.followUp).toBeUndefined();
  });
});

describe('formatDebtorAmbiguous', () => {
  it('lista os homônimos e pede para escolher, sem decidir sozinho', () => {
    const r = formatDebtorAmbiguous('João', ['João da Silva', 'João Pedro Souza', 'João Vitor Lima']);
    expect(r.text).toBe('Achei 3 clientes com "João": João da Silva, João Pedro Souza, João Vitor Lima. Qual deles?');
    expect(r.text).not.toContain('R$');
  });
});

/** Regra do saldo em aberto (BR-BOT-010): a mesma função que a query usa por parcela. */
describe('valor em aberto por parcela', () => {
  it('soma multa e juros de atraso e desconta o que já foi pago', () => {
    expect(aberto({ amount_total: 1000, fine_amount: 50, interest_delay_amount: 20, amount_paid: 300 })).toBe(770);
  });

  it('trata nulls como zero', () => {
    expect(aberto({ amount_total: 1000, fine_amount: null, interest_delay_amount: undefined, amount_paid: null })).toBe(1000);
  });

  it('clampa em zero quando o pago passa da obrigação', () => {
    expect(aberto({ amount_total: 500, fine_amount: 0, interest_delay_amount: 0, amount_paid: 700 })).toBe(0);
  });
});
