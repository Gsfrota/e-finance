import { describe, it, expect } from 'vitest';
import { createActionPlan } from '../../src/assistant/action-planner';
import { getCapabilityDefinition } from '../../src/assistant/capability-registry';
import type { CommandUnderstanding } from '../../src/assistant/contracts';

/**
 * Guarda de convergência — Fase 3 do motor determinístico.
 *
 * Prova, sem mocks, que `mark_installment_paid` está 100% convergido no caminho-capability
 * e que o wizard legado de baixa (`dispatchIntent` case `marcar_pagamento` +
 * `handlePendingAction` `marcar_pagamento*` no message-handler) é INALCANÇÁVEL pelo
 * pipeline vivo. Enquanto estas três invariantes valerem, o bloco legado é código morto
 * e pode ser aposentado com segurança — e qualquer regressão que re-religue o legado
 * (ex.: re-adicionar `legacyIntent: 'marcar_pagamento'`) quebra o gate.
 *
 * Por que o legado é inalcançável:
 *  1. A capability tem executor real (resolve/execute) e é idempotente (idempotencyScope='mutation').
 *  2. A capability NÃO tem `legacyIntent` → `executeActionPlan` nunca delega a `dispatchIntent('marcar_pagamento')`.
 *  3. O planner mapeia a intent `marcar_pagamento` → capability `mark_installment_paid` (decision=execute).
 * Como `dispatchIntent` só é chamado via delegação de capability com `legacyIntent`, e nenhum
 * setter de `pendingAction='marcar_pagamento*'` vive fora do próprio bloco legado, nada entra nele.
 */
describe('Convergência mark_installment_paid — caminho-capability é o único vivo', () => {
  const def = getCapabilityDefinition('mark_installment_paid');

  it('a capability é um executor real e idempotente (alvo da convergência)', () => {
    expect(typeof def.resolve).toBe('function');
    expect(typeof def.execute).toBe('function');
    expect(def.idempotencyScope).toBe('mutation');
    expect(def.requiresConfirmation).toBe(true);
  });

  it('a capability NÃO delega ao wizard legado (sem legacyIntent)', () => {
    // Se isto voltar a ser 'marcar_pagamento', executeActionPlan religaria o
    // dispatchIntent legado (não idempotente) — regressão do wizard pendingStep.
    expect(def.legacyIntent).toBeUndefined();
  });

  it('o planner roteia a intent marcar_pagamento para a capability mark_installment_paid', () => {
    const understanding: CommandUnderstanding = {
      intent: 'marcar_pagamento',
      source: 'rule',
      confidence: 'high',
      dependsOnContext: false,
      normalizedEntities: {},
    };

    const plan = createActionPlan(understanding, 'marcar pagamento', 'admin');

    expect(plan.decision).toBe('execute');
    expect(plan.capability).toBe('mark_installment_paid');
  });
});
