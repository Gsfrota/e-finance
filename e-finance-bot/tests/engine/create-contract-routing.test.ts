import { describe, it, expect } from 'vitest';
import { createActionPlan } from '../../src/assistant/action-planner';
import { getCapabilityDefinition } from '../../src/assistant/capability-registry';
import type { CommandUnderstanding } from '../../src/assistant/contracts';

/**
 * Guarda de convergência — Fase 2 do motor determinístico.
 *
 * Prova, sem mocks, que `create_contract` está 100% convergido no caminho-capability
 * e que o wizard legado (`pendingAction='criar_contrato'` / `dispatchIntent` case
 * `criar_contrato` no message-handler) é INALCANÇÁVEL pelo pipeline vivo. Enquanto
 * estas três invariantes valerem, o bloco legado é código morto e pode ser aposentado
 * com segurança — e qualquer regressão que re-religue o legado quebra o gate.
 *
 * Por que o legado é inalcançável:
 *  1. A capability tem executor real (resolve/execute) e é idempotente (idempotencyScope='mutation').
 *  2. A capability NÃO tem `legacyIntent` → `executeActionPlan` nunca delega a `dispatchIntent('criar_contrato')`.
 *  3. O planner mapeia a intent `criar_contrato` → capability `create_contract` (decision=execute).
 * Como `dispatchIntent` só é chamado via delegação de capability com `legacyIntent`, e nenhum
 * setter de `pendingAction='criar_contrato'` vive fora do próprio bloco legado, nada entra nele.
 */
describe('Convergência create_contract — caminho-capability é o único vivo', () => {
  const def = getCapabilityDefinition('create_contract');

  it('a capability é um executor real e idempotente (alvo da convergência)', () => {
    expect(typeof def.resolve).toBe('function');
    expect(typeof def.execute).toBe('function');
    expect(def.idempotencyScope).toBe('mutation');
    expect(def.requiresConfirmation).toBe(true);
  });

  it('a capability NÃO delega ao wizard legado (sem legacyIntent)', () => {
    // Se isto voltar a ser 'criar_contrato', executeActionPlan religaria o
    // dispatchIntent legado (não idempotente) — regressão do bug "2 sim = 2 contratos".
    expect(def.legacyIntent).toBeUndefined();
  });

  it('o planner roteia a intent criar_contrato para a capability create_contract', () => {
    const understanding: CommandUnderstanding = {
      intent: 'criar_contrato',
      source: 'rule',
      confidence: 'high',
      dependsOnContext: false,
      normalizedEntities: {},
    };

    const plan = createActionPlan(understanding, 'criar contrato', 'admin');

    expect(plan.decision).toBe('execute');
    expect(plan.capability).toBe('create_contract');
  });
});
