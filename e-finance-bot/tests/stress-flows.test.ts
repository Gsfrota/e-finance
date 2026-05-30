/**
 * Gate de estresse — erro humano / ambiguidade nos fluxos sensíveis.
 * Verde obrigatório (sem allowSoftFailure): o bot deve guiar o admin e nunca
 * executar mutação financeira sob ambiguidade.
 */
import { describe, expect, it } from 'vitest';
import { runAgentEvalCase } from './evals/harness';
import { STRESS_FLOW_CASES } from './evals/stress-flows';

describe('stress flows (erro humano / ambiguidade)', () => {
  for (const testCase of STRESS_FLOW_CASES) {
    it(`${testCase.id} — ${testCase.description}`, async () => {
      const result = await runAgentEvalCase(testCase);
      if (result.status !== 'pass') {
        throw new Error(`[${testCase.id}] ${result.status}: ${result.details}`);
      }
      expect(result.status).toBe('pass');
    });
  }
});
