/**
 * BOT-001 — gate do léxico de confirmação. Testa parseConfirmationReply
 * diretamente: recall coloquial, robustez de acento/pontuação, cancelamento,
 * e (crítico) ambíguos NUNCA confirmam uma mutação financeira.
 */
import { describe, expect, it } from 'vitest';
import { parseConfirmationReply } from '../src/assistant/confirmation-store';

const CONFIRM = [
  // já aceitas
  'sim', 's', 'confirmo', 'ok', 'pode', 'isso', 'segue', 'pode seguir',
  // BOT-001: coloquiais
  'beleza', 'blz', 'bora', 'certo', 'combinado', 'isso mesmo', 'perfeito',
  'pode confirmar', 'pode ser', 'ta', 'tá', 'yes', 'claro', 'fechado', 'positivo',
  // AC-4: acento/pontuação/caixa
  'Sim!', 'OK.', 'Tá', 'PODE', 'Confirmo!!!', 'beleza.',
];

const CANCEL = [
  'não', 'nao', 'cancela', 'cancelar', 'para', 'parar', 'sair',
  'deixa', 'negativo', 'nope', 'melhor não', 'Não!',
];

// AC-2: tentativos/ambíguos — NUNCA podem confirmar (nem cancelar por engano).
const AMBIGUOUS = [
  'talvez', 'acho que sim', 'pode ser que sim', 'mais ou menos',
  'espera', 'deixa eu ver', 'não sei', 'hmm', 'depois eu vejo',
];

describe('BOT-001 — parseConfirmationReply', () => {
  for (const word of CONFIRM) {
    it(`confirma: "${word}"`, () => expect(parseConfirmationReply(word)).toBe('confirm'));
  }
  for (const word of CANCEL) {
    it(`cancela: "${word}"`, () => expect(parseConfirmationReply(word)).toBe('cancel'));
  }
  for (const word of AMBIGUOUS) {
    it(`ambíguo não confirma: "${word}"`, () => expect(parseConfirmationReply(word)).not.toBe('confirm'));
  }
});
