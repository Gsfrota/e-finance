import { describe, expect, it } from 'vitest';
import {
  compactConversationHistory,
  inferDaysWindow,
  normalizeEntities,
} from '../src/ai/intent-classifier';

describe('normalizeEntities', () => {
  it('normaliza filtros em PT-BR para o formato canônico', () => {
    expect(normalizeEntities({ filter: 'atrasadas' }).filter).toBe('late');
    expect(normalizeEntities({ filter: 'semana' }).filter).toBe('week');
    expect(normalizeEntities({ filter: 'todos' }).filter).toBe('all');
    expect(normalizeEntities({ filter: 'pendente' }).filter).toBe('pending');
  });

  it('normaliza números e frequência', () => {
    const entities = normalizeEntities({
      amount: 'R$ 5.000,50',
      rate: '3,5',
      installments: '12',
      frequency: 'mensal',
    });

    expect(entities.amount).toBe(5000.5);
    expect(entities.rate).toBe(3.5);
    expect(entities.installments).toBe(12);
    expect(entities.frequency).toBe('monthly');
  });

  it('normaliza janela de dias e início da janela', () => {
    const entities = normalizeEntities({
      days_ahead: '15',
      window_start: 'amanhã',
    });

    expect(entities.days_ahead).toBe(15);
    expect(entities.window_start).toBe('tomorrow');
  });
});

describe('inferDaysWindow', () => {
  it('infere próximos dias iniciando hoje por padrão', () => {
    const inferred = inferDaysWindow('quanto vou receber nos próximos 7 dias?');
    expect(inferred.daysAhead).toBe(7);
    expect(inferred.windowStart).toBe('today');
  });

  it('infere início em amanhã quando frase explicita', () => {
    const inferred = inferDaysWindow('a partir de amanhã, quem devo cobrar nos próximos 3 dias?');
    expect(inferred.daysAhead).toBe(3);
    expect(inferred.windowStart).toBe('tomorrow');
  });
});

describe('compactConversationHistory', () => {
  it('remove duplicatas e limita mensagens longas', () => {
    const history = compactConversationHistory([
      { role: 'user', content: 'oi' },
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'resposta '.repeat(60) },
    ], 6, 40);

    expect(history.length).toBe(2);
    expect(history[1].content.endsWith('...')).toBe(true);
  });
});
