/**
 * Eval Dump — bateria determinística consolidada.
 *
 * Roda dataset oficial + chunk-03 (confirmação) + matriz de cobertura,
 * e emite artefatos de "dump" (scorecard.json + report.md) com métricas
 * por categoria, criticidade, failureTag e capability.
 *
 * NÃO é um gate: o objetivo é capturar o estado real (inclusive achados),
 * por isso não falha o processo mesmo com casos vermelhos.
 *
 * Uso:
 *   EVAL_DUMP_DIR=artifacts/eval-dump npx vitest run tests/eval-dump.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentEvalCase, AgentEvalResult } from './evals/contracts';
import { runAgentEvalCase } from './evals/harness';
import { AGENT_EVAL_DATASET } from './evals/dataset';
import { CONFIRM_TOLERANT_CASES } from './evals/chunks/chunk-03-confirm';
import { COVERAGE_MATRIX_CASES } from './evals/coverage-matrix';
import { CONTRACT_FLOW_CASES } from './evals/contract-flows';

type Suite = { suite: string; cases: AgentEvalCase[] };

const SUITES: Suite[] = [
  { suite: 'official', cases: AGENT_EVAL_DATASET },
  { suite: 'confirm-lexicon', cases: CONFIRM_TOLERANT_CASES },
  { suite: 'coverage-matrix', cases: COVERAGE_MATRIX_CASES },
  { suite: 'contract-flows', cases: CONTRACT_FLOW_CASES },
];

function capabilityOf(id: string): string {
  const m = id.match(/^cap-([a-z_]+?)-/);
  return m ? m[1] : 'misc';
}

function groupRate<T>(items: T[], keyFn: (i: T) => string, passFn: (i: T) => boolean) {
  const out: Record<string, { total: number; passed: number; rate: number }> = {};
  for (const it of items) {
    const k = keyFn(it);
    out[k] ??= { total: 0, passed: 0, rate: 0 };
    out[k].total += 1;
    if (passFn(it)) out[k].passed += 1;
  }
  for (const k of Object.keys(out)) out[k].rate = Number((out[k].passed / out[k].total).toFixed(4));
  return out;
}

describe('eval dump (determinístico)', () => {
  it('roda toda a bateria e emite scorecard + report', async () => {
    const dir = process.env.EVAL_DUMP_DIR || 'artifacts/eval-dump';
    fs.mkdirSync(dir, { recursive: true });

    type Row = AgentEvalResult & { suite: string; capability: string; durationMs: number };
    const rows: Row[] = [];

    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    for (const { suite, cases } of SUITES) {
      for (const c of cases) {
        const cStart = Date.now();
        const r = await runAgentEvalCase(c);
        rows.push({ ...r, suite, capability: capabilityOf(c.id), durationMs: Date.now() - cStart });
      }
    }
    const wallMs = Date.now() - t0;

    const pass = (r: Row) => r.status === 'pass';
    const passed = rows.filter(pass).length;
    const failed = rows.filter(r => r.status === 'fail').length;
    const softFailed = rows.filter(r => r.status === 'soft_fail').length;

    // Léxico de confirmação (deriva de confirm-lexicon: input text = palavra)
    const lexCases = CONFIRM_TOLERANT_CASES.map((c) => ({
      word: c.steps[0].input.text as string,
      pass: rows.find(r => r.suite === 'confirm-lexicon' && r.id === c.id)?.status === 'pass',
    }));
    const accepted = [...new Set(lexCases.filter(l => l.pass).map(l => l.word))].sort();
    const ignored = [...new Set(lexCases.filter(l => !l.pass).map(l => l.word))].sort();

    const scorecard = {
      generatedAt: startedAt,
      wallMs,
      totals: { total: rows.length, passed, failed, softFailed },
      bySuite: groupRate(rows, r => r.suite, pass),
      byCategory: groupRate(rows, r => r.category, pass),
      byCriticality: groupRate(rows, r => r.criticality, pass),
      byFailureTag: groupRate(rows.filter(r => !pass(r)), r => r.failureTag, () => false),
      byCapability: groupRate(rows.filter(r => r.suite === 'coverage-matrix' || r.suite === 'contract-flows'), r => r.capability, pass),
      confirmationLexicon: { accepted, ignored },
      failures: rows.filter(r => !pass(r)).map(r => ({ id: r.id, suite: r.suite, category: r.category, criticality: r.criticality, failureTag: r.failureTag, status: r.status, details: r.details })),
    };

    fs.writeFileSync(path.join(dir, 'scorecard.json'), `${JSON.stringify(scorecard, null, 2)}\n`, 'utf8');

    const md: string[] = [];
    md.push(`# Eval Dump — Determinístico\n`);
    md.push(`Gerado: ${startedAt} · Wall: ${wallMs}ms · Casos: **${rows.length}**\n`);
    md.push(`| | total | passed | failed | soft |`);
    md.push(`|---|---:|---:|---:|---:|`);
    md.push(`| **Geral** | ${rows.length} | ${passed} | ${failed} | ${softFailed} |\n`);

    md.push(`## Por suíte`);
    md.push(`| suíte | total | passed | rate |`);
    md.push(`|---|---:|---:|---:|`);
    for (const [k, v] of Object.entries(scorecard.bySuite)) md.push(`| ${k} | ${v.total} | ${v.passed} | ${(v.rate * 100).toFixed(1)}% |`);
    md.push('');

    md.push(`## Por categoria`);
    md.push(`| categoria | total | passed | rate |`);
    md.push(`|---|---:|---:|---:|`);
    for (const [k, v] of Object.entries(scorecard.byCategory)) md.push(`| ${k} | ${v.total} | ${v.passed} | ${(v.rate * 100).toFixed(1)}% |`);
    md.push('');

    md.push(`## Por criticidade`);
    md.push(`| criticidade | total | passed | rate |`);
    md.push(`|---|---:|---:|---:|`);
    for (const [k, v] of Object.entries(scorecard.byCriticality)) md.push(`| ${k} | ${v.total} | ${v.passed} | ${(v.rate * 100).toFixed(1)}% |`);
    md.push('');

    md.push(`## Cobertura por capability (suíte coverage-matrix)`);
    md.push(`| capability | total | passed | rate |`);
    md.push(`|---|---:|---:|---:|`);
    for (const [k, v] of Object.entries(scorecard.byCapability)) md.push(`| ${k} | ${v.total} | ${v.passed} | ${(v.rate * 100).toFixed(1)}% |`);
    md.push('');

    md.push(`## Achado: léxico de confirmação`);
    md.push(`Palavras que disparam a baixa (**aceitas**): ${accepted.map(w => `\`${w}\``).join(', ') || '—'}`);
    md.push('');
    md.push(`Palavras **ignoradas** (caem no fallback degradado, baixa não ocorre): ${ignored.map(w => `\`${w}\``).join(', ') || '—'}`);
    md.push('');

    if (scorecard.failures.length) {
      md.push(`## Falhas / achados detalhados (${scorecard.failures.length})`);
      md.push(`| id | suíte | categoria | tag | detalhe |`);
      md.push(`|---|---|---|---|---|`);
      for (const f of scorecard.failures) md.push(`| ${f.id} | ${f.suite} | ${f.category} | ${f.failureTag} | ${(f.details || '').replace(/\|/g, '\\|').slice(0, 120)} |`);
      md.push('');
    }

    fs.writeFileSync(path.join(dir, 'report.md'), `${md.join('\n')}\n`, 'utf8');
    console.log('EVAL_DUMP_WRITTEN', path.resolve(dir));
    console.log('EVAL_DUMP_TOTALS', JSON.stringify(scorecard.totals));

    expect(rows.length).toBeGreaterThan(0);
  });
});
