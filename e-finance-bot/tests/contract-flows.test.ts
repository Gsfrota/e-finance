/**
 * Gate de regressão dos dois fluxos sensíveis (admin-only):
 * criação de contrato e baixa de parcela. Cada caso de CONTRACT_FLOW_CASES
 * DEVE passar (verde obrigatório) — nada de allowSoftFailure aqui.
 */
import { describe, expect, it } from 'vitest';
import { runAgentEvalCase } from './evals/harness';
import { CONTRACT_FLOW_CASES } from './evals/contract-flows';

describe('contract flows — criação e baixa (todos os caminhos)', () => {
  for (const testCase of CONTRACT_FLOW_CASES) {
    it(`${testCase.id} — ${testCase.description}`, async () => {
      const result = await runAgentEvalCase(testCase);
      expect(result.status, result.details).toBe('pass');
    });
  }
});
