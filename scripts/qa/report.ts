import { readFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import type { TestResults } from './types.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function printReport(results: TestResults): void {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║       RELATÓRIO QA PRE-DEPLOY                ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════╝${RESET}\n`);

  // Results summary
  const total = results.passed + results.failed;
  console.log(`${BOLD}Resultados:${RESET}`);
  console.log(`  ${GREEN}✓ Passed:${RESET} ${results.passed}`);
  if (results.failed > 0) {
    console.log(`  ${RED}✗ Failed:${RESET} ${results.failed}`);
  }
  console.log(`  ${DIM}Total: ${total}${RESET}`);

  // Failures detail
  if (results.failures.length > 0) {
    console.log(`\n${RED}${BOLD}Falhas:${RESET}`);
    for (const f of results.failures) {
      console.log(`\n  ${RED}✗${RESET} ${BOLD}${f.testName}${RESET}`);
      console.log(`    ${DIM}Spec:${RESET} ${f.specFile}`);
      console.log(`    ${DIM}Erro:${RESET} ${f.error.split('\n')[0]}`);
      if (f.screenshotPath) {
        console.log(`    ${DIM}Screenshot:${RESET} ${f.screenshotPath}`);
      }
    }
  }

  // Warnings
  if (results.warnings.length > 0) {
    console.log(`\n${YELLOW}${BOLD}Avisos (fluxos sem cobertura):${RESET}`);
    for (const w of results.warnings) {
      console.log(`  ${YELLOW}⚠${RESET} ${w}`);
    }
  }
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function gate(results: TestResults): Promise<void> {
  printReport(results);

  const hasHighMediumFailures = results.failures.length > 0;
  const onlyWarnings = results.failures.length === 0 && results.warnings.length > 0;
  const allPassed = results.failures.length === 0 && results.warnings.length === 0;

  console.log(`\n${DIM}─────────────────────────────────────────────${RESET}`);

  if (allPassed && results.passed > 0) {
    console.log(`${GREEN}${BOLD}  ✅ APPROVED — Todos os testes passaram${RESET}`);
    console.log(`${DIM}─────────────────────────────────────────────${RESET}\n`);
    process.exit(0);
  }

  if (allPassed && results.passed === 0) {
    // No tests ran (no testable flows affected)
    if (results.warnings.length === 0) {
      console.log(`${GREEN}${BOLD}  ✅ APPROVED — Nenhum fluxo testável afetado${RESET}`);
      console.log(`${DIM}─────────────────────────────────────────────${RESET}\n`);
      process.exit(0);
    }
  }

  if (onlyWarnings) {
    console.log(`${YELLOW}${BOLD}  ⚠  WARNINGS — Fluxos sem cobertura de teste${RESET}`);
    console.log(`${DIM}─────────────────────────────────────────────${RESET}\n`);
    const resp = await prompt('Deploy mesmo assim? [y/N] ');
    if (resp.toLowerCase() === 'y') {
      process.exit(0);
    }
    process.exit(1);
  }

  if (hasHighMediumFailures) {
    console.log(`${RED}${BOLD}  ❌ BLOCKED — Testes falharam${RESET}`);
    console.log(`${DIM}─────────────────────────────────────────────${RESET}\n`);
    process.exit(1);
  }
}

const resultsPath = join(import.meta.dirname, 'tmp', 'test-results.json');
const results: TestResults = JSON.parse(readFileSync(resultsPath, 'utf-8'));
gate(results);
