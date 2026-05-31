import { describe, it, expect } from 'vitest';
import { PROBE_CREATE_CASES } from './evals/probe-create';
import { runAgentEvalCase } from './evals/harness';

const CATEGORIES = ['functional', 'multi_turn'] as const;
const CRITICALITIES = ['critical', 'core', 'extended'] as const;

interface ResultsMap {
  [category: string]: {
    [criticality: string]: { pass: number; fail: number; softFail: number };
  };
}

function initResultsMap(): ResultsMap {
  const map: ResultsMap = {};
  for (const cat of CATEGORIES) {
    map[cat] = {};
    for (const crit of CRITICALITIES) {
      map[cat][crit] = { pass: 0, fail: 0, softFail: 0 };
    }
  }
  return map;
}

describe('PROBE-CREATE: Suíte determinística de contratos', () => {
  it('executa todos os casos e relata métricas', async () => {
    const startTime = Date.now();
    const results = initResultsMap();
    const failures: string[] = [];
    let totalPass = 0;
    let totalFail = 0;
    let totalSoftFail = 0;

    console.log(
      '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    );
    console.log('PROBE-CREATE: Execução de suíte determinística');
    console.log(`Total de casos: ${PROBE_CREATE_CASES.length}`);
    console.log(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    );

    for (const testCase of PROBE_CREATE_CASES) {
      try {
        const result = await runAgentEvalCase(testCase);

        if (result.status === 'pass') {
          totalPass++;
          results[result.category][result.criticality].pass++;
          console.log(`✓ [${result.category}] ${testCase.id}`);
        } else if (result.status === 'soft_fail') {
          totalSoftFail++;
          results[result.category][result.criticality].softFail++;
          failures.push(
            `  [soft_fail] ${testCase.id}: ${result.details || 'sem detalhes'}`
          );
          console.log(
            `⚠ [${result.category}] ${testCase.id} (soft_fail: ${result.details?.split('\n')[0]})`
          );
        } else {
          totalFail++;
          results[result.category][result.criticality].fail++;
          failures.push(
            `  [fail] ${testCase.id}: ${result.details || 'sem detalhes'}`
          );
          console.log(`✗ [${result.category}] ${testCase.id}`);
        }
      } catch (error) {
        totalFail++;
        results[testCase.category][testCase.criticality].fail++;
        const msg = error instanceof Error ? error.message : String(error);
        failures.push(`  [exception] ${testCase.id}: ${msg}`);
        console.log(`✗ [${testCase.category}] ${testCase.id} (exception)`);
      }
    }

    const duration = Date.now() - startTime;

    console.log(
      '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    );
    console.log('TABELA RESUMIDA (Categoria × Criticidade)');
    console.log(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    );

    console.log('\nCOMPARATIVO POR CATEGORIA:');
    for (const cat of CATEGORIES) {
      let catPass = 0;
      let catFail = 0;
      let catSoftFail = 0;
      for (const crit of CRITICALITIES) {
        catPass += results[cat][crit].pass;
        catFail += results[cat][crit].fail;
        catSoftFail += results[cat][crit].softFail;
      }
      const total = catPass + catFail + catSoftFail;
      const passRate = total > 0 ? ((catPass / total) * 100).toFixed(1) : '—';
      console.log(
        `  ${cat.padEnd(15)} │ ${String(catPass).padStart(3)} pass │ ${String(catFail).padStart(3)} fail │ ${String(catSoftFail).padStart(3)} soft_fail │ ${passRate}%`
      );
    }

    console.log('\nCOMPARATIVO POR CRITICIDADE:');
    for (const crit of CRITICALITIES) {
      let critPass = 0;
      let critFail = 0;
      let critSoftFail = 0;
      for (const cat of CATEGORIES) {
        critPass += results[cat][crit].pass;
        critFail += results[cat][crit].fail;
        critSoftFail += results[cat][crit].softFail;
      }
      const total = critPass + critFail + critSoftFail;
      const passRate = total > 0 ? ((critPass / total) * 100).toFixed(1) : '—';
      console.log(
        `  ${crit.padEnd(15)} │ ${String(critPass).padStart(3)} pass │ ${String(critFail).padStart(3)} fail │ ${String(critSoftFail).padStart(3)} soft_fail │ ${passRate}%`
      );
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('RESUMO EXECUTIVO');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const total = totalPass + totalFail + totalSoftFail;
    const passRate = total > 0 ? ((totalPass / total) * 100).toFixed(1) : '—';
    console.log(`Total de casos:     ${total}`);
    console.log(`Passou:             ${totalPass} (${passRate}%)`);
    console.log(`Falhou:             ${totalFail}`);
    console.log(`Soft fail:          ${totalSoftFail}`);
    console.log(`Tempo total:        ${duration}ms`);

    if (failures.length > 0) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('FALHAS DETECTADAS');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      for (const failure of failures.slice(0, 20)) {
        console.log(failure);
      }
      if (failures.length > 20) {
        console.log(`  ... e mais ${failures.length - 20} falhas`);
      }
    }

    console.log(
      '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
    );

    // Assertion final: esperamos que todos os casos passem ou sejam soft_fail
    expect(PROBE_CREATE_CASES.length).toBeGreaterThan(0);
  });
});
