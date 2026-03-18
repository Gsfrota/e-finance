import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { FLOW_MAP } from './flow-map.js';
import type { InputAuditResult, InputAuditReport, InputCheck, DiffAnalysis } from './types.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

// ── Validation rules per input pattern ─────────────────────

interface ValidationRule {
  /** regex to find the input in source */
  inputPattern: RegExp;
  /** friendly field name */
  fieldName: string;
  /** input type */
  type: string;
  /** checks to run against the source code */
  checks: Check[];
}

interface Check {
  name: string;
  /** regex that MUST be found near the input for it to pass */
  mustMatch: RegExp;
  /** severity if missing */
  severity: 'gap' | 'weak';
  detail: string;
}

const VALIDATION_RULES: ValidationRule[] = [
  // ── CPF fields ──
  {
    inputPattern: /cpf|CPF/,
    fieldName: 'cpf',
    type: 'text/masked',
    checks: [
      {
        name: 'CPF mask',
        mustMatch: /maskCPF|mask.*cpf|replace\([^)]*\\D/i,
        severity: 'gap',
        detail: 'Campo CPF sem máscara de formatação (XXX.XXX.XXX-XX)',
      },
      {
        name: 'CPF validation',
        mustMatch: /isValidCPF|validar.*cpf|cpf.*valid/i,
        severity: 'gap',
        detail: 'Campo CPF sem validação de dígitos verificadores',
      },
    ],
  },
  // ── Email fields ──
  {
    inputPattern: /type=['"]email['"]/,
    fieldName: 'email',
    type: 'email',
    checks: [
      {
        name: 'Email type attribute',
        mustMatch: /type=['"]email['"]/,
        severity: 'weak',
        detail: 'Campo email sem type="email" para validação nativa do browser',
      },
    ],
  },
  // ── Password fields ──
  {
    inputPattern: /type=['"]password['"]/,
    fieldName: 'password',
    type: 'password',
    checks: [
      {
        name: 'Password min length',
        mustMatch: /minLength|min.*length|\.length\s*[<>=]/i,
        severity: 'gap',
        detail: 'Campo de senha sem validação de comprimento mínimo',
      },
    ],
  },
  // ── Number/currency fields ──
  {
    inputPattern: /type=['"]number['"]|amount|value|rate|installment/i,
    fieldName: 'number/currency',
    type: 'number',
    checks: [
      {
        name: 'Number parsing',
        mustMatch: /Number\(|parseFloat|parseInt|\.toFixed/,
        severity: 'weak',
        detail: 'Campo numérico sem parsing explícito (Number/parseFloat)',
      },
      {
        name: 'Negative/zero check',
        mustMatch: />\s*0|>=\s*0|<\s*0|<=\s*0|amount.*0|val.*0|negativ/i,
        severity: 'weak',
        detail: 'Campo numérico sem validação de valor negativo ou zero',
      },
    ],
  },
  // ── CEP field ──
  {
    inputPattern: /cep|CEP|postal/i,
    fieldName: 'cep',
    type: 'text/masked',
    checks: [
      {
        name: 'CEP lookup',
        mustMatch: /viacep|cep.*lookup|busca.*cep|handleCep/i,
        severity: 'weak',
        detail: 'Campo CEP sem integração com ViaCEP para auto-preenchimento',
      },
      {
        name: 'CEP length',
        mustMatch: /\.length.*8|8.*\.length|slice\(0,\s*8\)|maxLength/i,
        severity: 'gap',
        detail: 'Campo CEP sem limitação de 8 dígitos',
      },
    ],
  },
  // ── Phone field ──
  {
    inputPattern: /phone|telefone|whatsapp|tel/i,
    fieldName: 'phone',
    type: 'tel',
    checks: [
      {
        name: 'Phone cleanup',
        mustMatch: /cleanNumbers|replace\([^)]*\\D|replace\([^)]*\[^0-9\]/i,
        severity: 'weak',
        detail: 'Campo telefone sem limpeza de caracteres não-numéricos',
      },
    ],
  },
  // ── PIX key fields ──
  {
    inputPattern: /pixKey|pix_key|pix.*chave/i,
    fieldName: 'pixKey',
    type: 'text',
    checks: [
      {
        name: 'PIX type-based validation',
        mustMatch: /pixKeyType|key.*type|validatePix|validar.*pix/i,
        severity: 'gap',
        detail: 'Campo PIX sem validação dinâmica por tipo (CPF/CNPJ/email/phone/EVP)',
      },
    ],
  },
  // ── Date fields ──
  {
    inputPattern: /type=['"]date['"]/,
    fieldName: 'date',
    type: 'date',
    checks: [
      {
        name: 'Date input type',
        mustMatch: /type=['"]date['"]/,
        severity: 'weak',
        detail: 'Campo de data sem type="date" nativo',
      },
    ],
  },
  // ── XSS: dangerouslySetInnerHTML ──
  {
    inputPattern: /dangerouslySetInnerHTML/,
    fieldName: 'innerHTML',
    type: 'security',
    checks: [
      {
        name: 'No dangerouslySetInnerHTML with user input',
        mustMatch: /(?!dangerouslySetInnerHTML)^$/,
        severity: 'gap',
        detail: 'SEGURANCA: uso de dangerouslySetInnerHTML detectado — risco de XSS',
      },
    ],
  },
];

// ── Audit logic ────────────────────────────────────────────

function auditComponent(filePath: string, componentName: string): InputAuditResult | null {
  let source: string;
  try {
    source = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  // Check if component has any inputs at all
  const hasInputElements = /<input|<select|<textarea|onChange|onSubmit/i.test(source);
  if (!hasInputElements) return null;

  const inputs: InputCheck[] = [];

  for (const rule of VALIDATION_RULES) {
    if (!rule.inputPattern.test(source)) continue;

    for (const check of rule.checks) {
      const passes = check.mustMatch.test(source);
      inputs.push({
        field: rule.fieldName,
        type: rule.type,
        status: passes ? 'ok' : check.severity,
        detail: passes ? `${check.name}: implementado` : check.detail,
      });
    }
  }

  // Extra: check for raw string interpolation in queries (SQL injection risk)
  const sqlInjectionRisk = /\$\{.*\}.*(?:select|insert|update|delete|from|where)/i.test(source);
  if (sqlInjectionRisk) {
    inputs.push({
      field: 'query',
      type: 'security',
      status: 'gap',
      detail: 'SEGURANCA: possível interpolação de string em query SQL — risco de SQL injection',
    });
  }

  // Extra: check for form onSubmit with e.preventDefault
  const hasForm = /<form/i.test(source);
  if (hasForm) {
    const hasPreventDefault = /preventDefault/.test(source);
    inputs.push({
      field: 'form',
      type: 'form',
      status: hasPreventDefault ? 'ok' : 'weak',
      detail: hasPreventDefault
        ? 'Form preventDefault: implementado'
        : 'Formulário sem e.preventDefault() — pode causar reload indesejado',
    });
  }

  if (inputs.length === 0) return null;

  return {
    component: componentName,
    inputs,
    passed: inputs.filter((i) => i.status === 'ok').length,
    warnings: inputs.filter((i) => i.status === 'weak').length,
    gaps: inputs.filter((i) => i.status === 'gap').length,
  };
}

function resolveFilePath(filePattern: string): string {
  const projectRoot = join(import.meta.dirname, '..', '..');
  // Try common locations
  const candidates = [
    join(projectRoot, filePattern),
    join(projectRoot, 'components', filePattern),
    join(projectRoot, 'components', 'dashboard', filePattern),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      // try next
    }
  }
  return join(projectRoot, 'components', filePattern);
}

// ── Main ───────────────────────────────────────────────────

const input = readFileSync(0, 'utf-8').trim();
const analysis: DiffAnalysis = JSON.parse(input);

// Find which changed files have inputs
const inputFlows = FLOW_MAP.filter((m) => m.hasInputs);
const affectedInputFiles: string[] = [];

for (const file of analysis.changedFiles) {
  const basename = file.split('/').pop() || file;
  for (const mapping of inputFlows) {
    if (file.includes(mapping.filePattern) || basename === mapping.filePattern) {
      if (!affectedInputFiles.includes(mapping.filePattern)) {
        affectedInputFiles.push(mapping.filePattern);
      }
    }
  }
}

// Also trigger if core files changed (supabase.ts has validation helpers)
const coreChanged = analysis.changedFiles.some(
  (f) => f.includes('services/supabase.ts') || f === 'types.ts',
);
if (coreChanged) {
  // Audit all input components when core changes
  for (const m of inputFlows) {
    if (!affectedInputFiles.includes(m.filePattern)) {
      affectedInputFiles.push(m.filePattern);
    }
  }
}

if (affectedInputFiles.length === 0) {
  console.log(JSON.stringify({ skip: true, reason: 'Nenhum componente com inputs foi alterado.' }));
  process.exit(0);
}

// Run audit
const results: InputAuditResult[] = [];
for (const pattern of affectedInputFiles) {
  const filePath = resolveFilePath(pattern);
  const result = auditComponent(filePath, pattern);
  if (result) results.push(result);
}

const report: InputAuditReport = {
  components: results,
  totalPassed: results.reduce((s, r) => s + r.passed, 0),
  totalWarnings: results.reduce((s, r) => s + r.warnings, 0),
  totalGaps: results.reduce((s, r) => s + r.gaps, 0),
  hasBlockingGaps: results.some((r) => r.gaps > 0),
};

// Print report
console.error(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════╗${RESET}`);
console.error(`${BOLD}${CYAN}║       AUDITORIA DE INPUTS                    ║${RESET}`);
console.error(`${BOLD}${CYAN}╚══════════════════════════════════════════════╝${RESET}\n`);

console.error(`${BOLD}Componentes auditados (${results.length}):${RESET}\n`);

for (const r of results) {
  const icon = r.gaps > 0 ? `${RED}✗` : r.warnings > 0 ? `${YELLOW}⚠` : `${GREEN}✓`;
  console.error(`${icon}${RESET} ${BOLD}${r.component}${RESET} — ${GREEN}${r.passed} ok${RESET}, ${YELLOW}${r.warnings} weak${RESET}, ${RED}${r.gaps} gap${RESET}`);

  for (const check of r.inputs) {
    if (check.status === 'ok') {
      console.error(`    ${GREEN}✓${RESET} ${DIM}${check.detail}${RESET}`);
    } else if (check.status === 'weak') {
      console.error(`    ${YELLOW}⚠${RESET} ${check.detail}`);
    } else {
      console.error(`    ${RED}✗${RESET} ${BOLD}${check.detail}${RESET}`);
    }
  }
  console.error('');
}

console.error(`${DIM}─────────────────────────────────────────────${RESET}`);
console.error(`  ${GREEN}OK:${RESET} ${report.totalPassed}  ${YELLOW}Weak:${RESET} ${report.totalWarnings}  ${RED}Gap:${RESET} ${report.totalGaps}`);
console.error(`${DIM}─────────────────────────────────────────────${RESET}`);

if (report.hasBlockingGaps) {
  console.error(`\n${RED}${BOLD}  ❌ GAPS detectados em inputs — verificar antes do deploy${RESET}\n`);
} else if (report.totalWarnings > 0) {
  console.error(`\n${YELLOW}${BOLD}  ⚠  Validações fracas detectadas — considerar melhorar${RESET}\n`);
} else {
  console.error(`\n${GREEN}${BOLD}  ✅ Inputs validados corretamente${RESET}\n`);
}

// Write JSON to tmp
const tmpDir = join(import.meta.dirname, 'tmp');
mkdirSync(tmpDir, { recursive: true });
writeFileSync(join(tmpDir, 'input-audit.json'), JSON.stringify(report, null, 2));

// Output JSON to stdout for pipeline
console.log(JSON.stringify(report));
