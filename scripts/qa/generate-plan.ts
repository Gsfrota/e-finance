import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { DiffAnalysis, TestPlan, StaticTest, DynamicTest } from './types.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function riskColor(risk: string): string {
  if (risk === 'high') return RED;
  if (risk === 'medium') return YELLOW;
  return GREEN;
}

function generatePlan(analysis: DiffAnalysis): TestPlan {
  const staticTests: StaticTest[] = [];
  const dynamicTests: DynamicTest[] = [];
  const visualChecks: string[] = [];

  const seenSpecs = new Set<string>();

  for (const flow of analysis.affectedFlows) {
    if (flow.hasTests) {
      for (const spec of flow.testFiles) {
        const key = `${spec}::${flow.playwrightProject}`;
        if (!seenSpecs.has(key)) {
          seenSpecs.add(key);
          staticTests.push({
            specFile: spec,
            project: flow.playwrightProject,
            flowName: flow.flowName,
            risk: flow.risk,
          });
        }
      }
    } else {
      dynamicTests.push({
        flowName: flow.flowName,
        description: `Fluxo "${flow.flowName}" alterado (${flow.triggerFiles.join(', ')}) mas sem testes E2E. Verificar manualmente.`,
        risk: flow.risk,
      });
    }
  }

  // Check if visual changes need screenshot comparison
  const hasVisualChanges = analysis.changedFiles.some(
    (f) => f.endsWith('.css') || f.includes('index.css'),
  );
  if (hasVisualChanges) {
    visualChecks.push('Mudanças CSS detectadas — verificar visualmente após testes.');
  }

  return { staticTests, dynamicTests, visualChecks };
}

function printPlan(analysis: DiffAnalysis, plan: TestPlan): void {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║       PLANO DE TESTE PRE-DEPLOY              ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════╝${RESET}\n`);

  // Changed files
  console.log(`${BOLD}Arquivos alterados (${analysis.changedFiles.length}):${RESET}`);
  for (const f of analysis.changedFiles) {
    console.log(`  ${DIM}•${RESET} ${f}`);
  }

  // Full suite warning
  if (analysis.isFullSuiteRecommended) {
    console.log(`\n${RED}${BOLD}⚠  SUITE COMPLETA RECOMENDADA${RESET} — arquivo core alterado`);
  }

  // Affected flows
  console.log(`\n${BOLD}Fluxos afetados (${analysis.affectedFlows.length}):${RESET}`);
  for (const flow of analysis.affectedFlows) {
    const rc = riskColor(flow.risk);
    const testStatus = flow.hasTests ? `${GREEN}✓ com testes${RESET}` : `${YELLOW}⚠ sem testes${RESET}`;
    console.log(`  ${rc}[${flow.risk.toUpperCase()}]${RESET} ${flow.flowName} — ${testStatus}`);
  }

  // Static tests to run
  if (plan.staticTests.length > 0) {
    console.log(`\n${BOLD}${GREEN}Testes a executar (${plan.staticTests.length}):${RESET}`);
    for (const t of plan.staticTests) {
      const rc = riskColor(t.risk);
      console.log(`  ${rc}▶${RESET} ${t.specFile} ${DIM}(project: ${t.project})${RESET}`);
    }
  }

  // Dynamic tests (no automation)
  if (plan.dynamicTests.length > 0) {
    console.log(`\n${BOLD}${YELLOW}Verificações manuais necessárias (${plan.dynamicTests.length}):${RESET}`);
    for (const t of plan.dynamicTests) {
      const rc = riskColor(t.risk);
      console.log(`  ${rc}⚠${RESET} ${t.description}`);
    }
  }

  // Visual checks
  if (plan.visualChecks.length > 0) {
    console.log(`\n${BOLD}Verificações visuais:${RESET}`);
    for (const v of plan.visualChecks) {
      console.log(`  ${CYAN}👁${RESET} ${v}`);
    }
  }

  // Summary
  const totalTests = plan.staticTests.length;
  if (totalTests === 0 && plan.dynamicTests.length === 0) {
    console.log(`\n${GREEN}${BOLD}Nenhum fluxo testável afetado. Pipeline aprovada.${RESET}`);
  } else {
    console.log(`\n${DIM}─────────────────────────────────────────────${RESET}`);
    console.log(`  Testes automatizados: ${BOLD}${totalTests}${RESET}`);
    console.log(`  Verificações manuais: ${BOLD}${plan.dynamicTests.length}${RESET}`);
    console.log(`${DIM}─────────────────────────────────────────────${RESET}`);
  }
}

// Read analysis from stdin
const input = readFileSync(0, 'utf-8').trim();
const analysis: DiffAnalysis = JSON.parse(input);
const plan = generatePlan(analysis);

printPlan(analysis, plan);

// Save plan to temp file
const tmpDir = join(import.meta.dirname, 'tmp');
mkdirSync(tmpDir, { recursive: true });
const planPath = join(tmpDir, 'test-plan.json');
writeFileSync(planPath, JSON.stringify(plan, null, 2));
