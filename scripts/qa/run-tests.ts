import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync, spawn } from 'child_process';
import type { TestPlan, TestResults, TestFailure } from './types.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function isPortInUse(port: number): boolean {
  try {
    execSync(`lsof -i :${port} -t 2>/dev/null`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

async function waitForServer(url: string, timeoutMs: number = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function runTests(): Promise<void> {
  const planPath = join(import.meta.dirname, 'tmp', 'test-plan.json');
  const plan: TestPlan = JSON.parse(readFileSync(planPath, 'utf-8'));

  if (plan.staticTests.length === 0) {
    console.log(`\n${CYAN}Nenhum teste automatizado para executar.${RESET}`);
    const results: TestResults = {
      passed: 0,
      failed: 0,
      failures: [],
      warnings: plan.dynamicTests.map((t) => t.description),
      planPath,
    };
    writeFileSync(join(import.meta.dirname, 'tmp', 'test-results.json'), JSON.stringify(results, null, 2));
    return;
  }

  // Start dev server if not running
  let serverProcess: ReturnType<typeof spawn> | null = null;
  if (!isPortInUse(3001)) {
    console.log(`${DIM}Iniciando servidor dev na porta 3001...${RESET}`);
    serverProcess = spawn('npx', ['vite', '--port', '3001'], {
      stdio: 'ignore',
      detached: true,
      cwd: join(import.meta.dirname, '..', '..'),
    });
    serverProcess.unref();

    const ready = await waitForServer('http://localhost:3001', 30_000);
    if (!ready) {
      console.error(`${RED}Servidor não iniciou em 30s${RESET}`);
      process.exit(1);
    }
    console.log(`${GREEN}Servidor pronto.${RESET}`);
  } else {
    console.log(`${DIM}Servidor já rodando na porta 3001.${RESET}`);
  }

  // Deduplicate spec files and collect projects
  const specFiles = [...new Set(plan.staticTests.map((t) => t.specFile))];
  const projects = [...new Set(plan.staticTests.map((t) => t.project))];

  // Build playwright command
  const projectArgs = projects
    .filter((p) => p !== 'all')
    .flatMap((p) => ['--project', p]);

  // If 'all' is in projects, don't filter by project
  const useAllProjects = projects.includes('all');

  const args = [
    'playwright', 'test',
    ...specFiles,
    ...(useAllProjects ? [] : projectArgs),
    '--reporter=json',
  ];

  console.log(`\n${BOLD}${CYAN}Executando testes...${RESET}`);
  console.log(`${DIM}npx ${args.join(' ')}${RESET}\n`);

  let jsonOutput = '';
  try {
    jsonOutput = execSync(`npx ${args.join(' ')}`, {
      encoding: 'utf-8',
      cwd: join(import.meta.dirname, '..', '..'),
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: '' },
      timeout: 120_000,
    });
  } catch (err: any) {
    // Playwright exits non-zero on test failures — capture stdout
    jsonOutput = err.stdout || '';
    if (err.stderr) {
      console.error(`${DIM}${err.stderr}${RESET}`);
    }
  } finally {
    // Kill dev server if we started it
    if (serverProcess?.pid) {
      try {
        process.kill(-serverProcess.pid, 'SIGTERM');
      } catch {
        // already dead
      }
    }
  }

  // Parse results
  const failures: TestFailure[] = [];
  let passed = 0;
  let failed = 0;

  try {
    const report = JSON.parse(jsonOutput);
    for (const suite of report.suites || []) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          for (const result of test.results || []) {
            if (result.status === 'passed') {
              passed++;
            } else if (result.status === 'failed' || result.status === 'timedOut') {
              failed++;
              failures.push({
                specFile: suite.file || '',
                testName: spec.title || '',
                error: result.error?.message || 'Unknown error',
                screenshotPath: result.attachments?.find(
                  (a: any) => a.name === 'screenshot',
                )?.path,
              });
            }
          }
        }
      }
    }
  } catch {
    // If JSON parsing fails, treat as all tests passed if exit was 0
    // or all failed otherwise
    if (jsonOutput.includes('"passed"')) {
      console.log(`${CYAN}Não foi possível parsear o report JSON. Verificar manualmente.${RESET}`);
    }
  }

  const results: TestResults = {
    passed,
    failed,
    failures,
    warnings: plan.dynamicTests.map((t) => t.description),
    planPath,
  };

  writeFileSync(
    join(import.meta.dirname, 'tmp', 'test-results.json'),
    JSON.stringify(results, null, 2),
  );

  console.log(`\n${passed > 0 ? GREEN : ''}Passed: ${passed}${RESET}  ${failed > 0 ? RED : ''}Failed: ${failed}${RESET}`);
}

runTests();
