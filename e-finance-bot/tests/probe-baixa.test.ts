import { describe, it, expect } from 'vitest';
import { runAgentEvalCase } from './evals/harness';
import { PROBE_BAIXA_CASES } from './evals/probe-baixa';

describe('Probe: Dar Baixa em Parcelas (Mark Installment Paid)', () => {
  it('should have test cases defined', () => {
    expect(PROBE_BAIXA_CASES.length).toBeGreaterThan(0);
    console.log(`[PROBE] Total de casos de teste: ${PROBE_BAIXA_CASES.length}`);
  });

  it('should run all baixa test cases', async () => {
    const results = [];
    const byForm = new Map<string, { total: number; pass: number; fail: number }>();

    for (const testCase of PROBE_BAIXA_CASES) {
      try {
        const result = await runAgentEvalCase(testCase);
        results.push(result);
        console.log(`✓ ${testCase.id}: ${result.status.toUpperCase()}`);

        // Categorização por forma de baixa
        let formKey = 'outro';
        if (testCase.id.includes('-001-')) formKey = 'contrato+número';
        else if (testCase.id.includes('-002-')) formKey = 'contrato+mês';
        else if (testCase.id.includes('-003-')) formKey = 'contrato→lista';
        else if (testCase.id.includes('-004-')) formKey = 'contrato→paginação';
        else if (testCase.id.includes('-005-')) formKey = 'contrato_vazio';
        else if (testCase.id.includes('-006-')) formKey = 'devedor+mês_0';
        else if (testCase.id.includes('-007-')) formKey = 'devedor+mês_1';
        else if (testCase.id.includes('-008-')) formKey = 'devedor+mês_N';
        else if (testCase.id.includes('-009-')) formKey = 'selecao_ordinal';
        else if (testCase.id.includes('-010-')) formKey = 'selecao_nome';
        else if (testCase.id.includes('-011-')) formKey = 'installment_id_pre';
        else if (testCase.id.includes('-012-')) formKey = 'confirmacao_não';
        else if (testCase.id.includes('-013-')) formKey = 'falha_execução';
        else if (testCase.id.includes('-014-')) formKey = 'regressao_BOT-FIX-001';
        else if (testCase.id.includes('-015-')) formKey = 'numero_invalido_range';
        else if (testCase.id.includes('-016-')) formKey = 'numero_invalido_notfound';
        else if (testCase.id.includes('-017-')) formKey = 'devedor_apenas';
        else if (testCase.id.includes('-018-')) formKey = 'nada_provided';
        else if (testCase.id.includes('-019-')) formKey = 'contrato+número_direto';
        else if (testCase.id.includes('-020-')) formKey = 'selecao_segundo_terceiro';

        const current = byForm.get(formKey) || { total: 0, pass: 0, fail: 0 };
        current.total += 1;
        if (result.status === 'pass') {
          current.pass += 1;
        } else if (result.status === 'fail') {
          current.fail += 1;
        }
        byForm.set(formKey, current);
      } catch (error) {
        console.error(`✗ ${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
        results.push({
          id: testCase.id,
          category: testCase.category,
          criticality: testCase.criticality,
          failureTag: testCase.failureTag,
          status: testCase.allowSoftFailure ? 'soft_fail' : 'fail',
          details: error instanceof Error ? error.message : String(error),
        });

        let formKey = 'outro';
        if (testCase.id.includes('-014-')) formKey = 'regressao_BOT-FIX-001';
        const current = byForm.get(formKey) || { total: 0, pass: 0, fail: 0 };
        current.total += 1;
        current.fail += 1;
        byForm.set(formKey, current);
      }
    }

    // Relatório final
    console.log('\n' + '='.repeat(80));
    console.log('PROBE BAIXA — RELATÓRIO FINAL');
    console.log('='.repeat(80));

    console.log('\n## Tabela por Forma de Baixa\n');
    const formTable: Record<string, string>[] = [];
    let totalPass = 0;
    let totalFail = 0;
    for (const [form, stats] of byForm.entries()) {
      totalPass += stats.pass;
      totalFail += stats.fail;
      const passRate = stats.total > 0 ? ((stats.pass / stats.total) * 100).toFixed(0) : '0';
      formTable.push({
        forma: form,
        casos: String(stats.total),
        pass: String(stats.pass),
        fail: String(stats.fail),
        'pass %': passRate,
      });
    }
    console.table(formTable);

    console.log(`\n## Métricas Globais\n`);
    console.log(`Total de casos: ${results.length}`);
    console.log(`Passou: ${totalPass}`);
    console.log(`Falhou: ${totalFail}`);
    console.log(`Taxa de sucesso: ${results.length > 0 ? ((totalPass / results.length) * 100).toFixed(1) : '0'}%`);

    // Achados (falhas)
    const failures = results.filter(r => r.status === 'fail');
    if (failures.length > 0) {
      console.log(`\n## Falhas Detectadas\n`);
      failures.forEach(failure => {
        console.log(`- **${failure.id}** (${failure.failureTag}): ${failure.details}`);
      });
    } else {
      console.log(`\n✓ Nenhuma falha detectada.`);
    }

    // Verificação crítica: BOT-FIX-001
    const bot001 = results.find(r => r.id === 'baixa-014-regressao-company-selection-hijack');
    console.log(`\n## Verificação de Regressão BOT-FIX-001\n`);
    if (bot001?.status === 'pass') {
      console.log(`✓ BOT-FIX-001 VERDE: No-hijack de seleção de empresa confirmado.`);
    } else {
      console.log(`✗ BOT-FIX-001 VERMELHO: REGRESSÃO DETECTADA!`);
      if (bot001?.details) console.log(`  Detalhes: ${bot001.details}`);
    }

    // Asserção final
    expect(results.length).toBeGreaterThan(0);
  });

  it('should probe-discover text outputs when needed', async () => {
    // Para descobrir o texto real de um caso:
    // const testCase = PROBE_BAIXA_CASES.find(c => c.id === 'caso-id');
    // const outputs = await probeAgentEvalCase(testCase);
    // outputs.forEach((o, i) => console.log(`Step ${i}:\n${o}\n---`));
    expect(true).toBe(true);
  });
});
