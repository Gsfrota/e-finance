import { describe, expect, it } from 'vitest';
import { SMART_BAIXA_SINGLE_CASES } from './evals/chunks/chunk-01-single';
import { SMART_BAIXA_MULTI_CASES } from './evals/chunks/chunk-02-multi';
import { CONFIRM_TOLERANT_CASES } from './evals/chunks/chunk-03-confirm';
import { EDGE_CASES } from './evals/chunks/chunk-04-edge';
import { REGRESSION_CASES } from './evals/chunks/chunk-05-regression';
import { ADVERSARIAL_MULTI_CASES } from './evals/chunks/chunk-06-adversarial';
import { emitAgentEvalScorecard, runAgentEvalCase } from './evals/harness';

const ALL_CASES = [
  ...SMART_BAIXA_SINGLE_CASES,
  ...SMART_BAIXA_MULTI_CASES,
  ...CONFIRM_TOLERANT_CASES,
  ...EDGE_CASES,
  ...REGRESSION_CASES,
  ...ADVERSARIAL_MULTI_CASES,
];

function rate(passed: number, total: number): number {
  if (total === 0) return 1;
  return passed / total;
}

describe('smart baixa — 300 interações', () => {
  it('roda todos os 300 casos e atinge os gates de qualidade', async () => {
    const results = [];

    for (const testCase of ALL_CASES) {
      results.push(await runAgentEvalCase(testCase));
    }

    const failures = results.filter(r => r.status === 'fail');
    const softFailures = results.filter(r => r.status === 'soft_fail');
    const categorySummary = Object.groupBy(results, r => r.category);
    const criticalitySummary = Object.groupBy(results, r => r.criticality);

    const scorecard = {
      generatedAt: new Date().toISOString(),
      totalCases: results.length,
      totals: {
        total: results.length,
        passed: results.filter(r => r.status === 'pass').length,
        failed: failures.length,
        softFailed: softFailures.length,
      },
      byChunk: {
        single_1_parcela: SMART_BAIXA_SINGLE_CASES.length,
        multi_parcelas: SMART_BAIXA_MULTI_CASES.length,
        confirmacao_tolerante: CONFIRM_TOLERANT_CASES.length,
        edge_cases: EDGE_CASES.length,
        regression: REGRESSION_CASES.length,
        adversarial: ADVERSARIAL_MULTI_CASES.length,
      },
      byCategory: Object.fromEntries(
        Object.entries(categorySummary).map(([cat, items]) => {
          const group = items || [];
          const passed = group.filter(i => i.status === 'pass').length;
          return [cat, { total: group.length, passed, rate: Number(rate(passed, group.length).toFixed(4)) }];
        })
      ),
      byCriticality: Object.fromEntries(
        Object.entries(criticalitySummary).map(([crit, items]) => {
          const group = items || [];
          const passed = group.filter(i => i.status === 'pass').length;
          return [crit, { total: group.length, passed, rate: Number(rate(passed, group.length).toFixed(4)) }];
        })
      ),
      failures,
      softFailures,
    };

    emitAgentEvalScorecard(scorecard);
    console.log('SMART_BAIXA_SCORECARD', JSON.stringify(scorecard, null, 2));

    const passRate = (items: typeof results) =>
      rate(items.filter(i => i.status === 'pass').length, items.length);

    const critical = criticalitySummary.critical || [];
    const core = criticalitySummary.core || [];
    const functional = categorySummary.functional || [];
    const multiTurn = categorySummary.multi_turn || [];
    const adversarial = categorySummary.adversarial || [];

    // Core feature gates:
    // - Functional (single-turn): 95%+ required — validates "dar baixa" works end-to-end
    // - Critical: 80%+ required — harder cases with multi-turn state management
    // - Core: 70%+ acceptable — expected text varies in LLM responses
    expect(passRate(functional)).toBeGreaterThanOrEqual(0.95);
    expect(passRate(critical)).toBeGreaterThanOrEqual(0.80);
    expect(passRate(core)).toBeGreaterThanOrEqual(0.70);
    expect(failures.length).toBeLessThanOrEqual(80);
  });
});
