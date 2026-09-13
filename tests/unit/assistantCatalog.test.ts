import { describe, it, expect } from 'vitest';
import { matchAssistant } from '../../utils/assistantEngine';
import { ASSISTANT_CATALOG, CATALOG_GROUPS } from '../../utils/assistantCatalog';

/**
 * BR-BOT-013 — o catálogo é uma promessa: o que está no botão, ele responde.
 *
 * Um botão que devolve "não entendi" é pior que botão nenhum — o cliente conclui
 * que o assistente é quebrado, e a culpa é da tela, não do motor.
 */

const SABADO_NOITE = new Date('2026-09-13T02:30:00.000Z');

describe('catálogo de perguntas prontas', () => {
  for (const entry of ASSISTANT_CATALOG.filter(e => !e.needsInput)) {
    it(`"${entry.question}" é entendida pelo motor`, () => {
      expect(matchAssistant(entry.question, SABADO_NOITE).intent).not.toBe('unknown');
    });
  }

  it('as perguntas sobre cliente ficam incompletas de propósito', () => {
    const sobreCliente = ASSISTANT_CATALOG.filter(e => e.needsInput);
    expect(sobreCliente.length).toBeGreaterThan(0);
    for (const entry of sobreCliente) {
      // sem o nome não há o que consultar: o botão preenche e devolve o cursor
      expect(matchAssistant(entry.question, SABADO_NOITE).intent).toBe('unknown');
      expect(entry.question.trimEnd().endsWith('o')).toBe(true);
    }
  });

  it('todo grupo declarado tem pergunta, e toda pergunta tem grupo declarado', () => {
    const grupos = new Set(ASSISTANT_CATALOG.map(e => e.group));
    for (const grupo of CATALOG_GROUPS) expect(grupos.has(grupo), `grupo vazio: ${grupo}`).toBe(true);
    for (const grupo of grupos) {
      expect(CATALOG_GROUPS as readonly string[], `grupo fora da ordem da tela: ${grupo}`).toContain(
        grupo,
      );
    }
  });

  it('não oferece a mesma pergunta duas vezes', () => {
    const perguntas = ASSISTANT_CATALOG.filter(e => !e.needsInput).map(e => e.question);
    expect(new Set(perguntas).size).toBe(perguntas.length);
  });

  it('cobre as cinco capacidades do assistente', () => {
    const intents = new Set(
      ASSISTANT_CATALOG.filter(e => !e.needsInput).map(
        e => matchAssistant(e.question, SABADO_NOITE).intent,
      ),
    );
    expect(intents).toEqual(
      new Set(['lent_volume', 'late_debtors', 'receivables', 'received']),
    );
  });
});
