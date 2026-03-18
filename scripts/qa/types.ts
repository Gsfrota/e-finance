export interface FlowMapping {
  filePattern: string;
  flowName: string;
  testFiles: string[];
  playwrightProject: string;
  risk: 'high' | 'medium' | 'low';
  hasInputs?: boolean;
}

export interface DiffAnalysis {
  changedFiles: string[];
  affectedFlows: AffectedFlow[];
  isFullSuiteRecommended: boolean;
}

export interface AffectedFlow {
  flowName: string;
  testFiles: string[];
  playwrightProject: string;
  risk: 'high' | 'medium' | 'low';
  triggerFiles: string[];
  hasTests: boolean;
}

export interface TestPlan {
  staticTests: StaticTest[];
  dynamicTests: DynamicTest[];
  visualChecks: string[];
}

export interface StaticTest {
  specFile: string;
  project: string;
  flowName: string;
  risk: 'high' | 'medium' | 'low';
}

export interface DynamicTest {
  flowName: string;
  description: string;
  risk: 'high' | 'medium' | 'low';
}

export interface TestResults {
  passed: number;
  failed: number;
  failures: TestFailure[];
  warnings: string[];
  planPath: string;
}

export interface TestFailure {
  specFile: string;
  testName: string;
  error: string;
  screenshotPath?: string;
}

export interface InputAuditResult {
  component: string;
  inputs: InputCheck[];
  passed: number;
  warnings: number;
  gaps: number;
}

export interface InputCheck {
  field: string;
  type: string;
  status: 'ok' | 'gap' | 'weak';
  detail: string;
}

export interface InputAuditReport {
  components: InputAuditResult[];
  totalPassed: number;
  totalWarnings: number;
  totalGaps: number;
  hasBlockingGaps: boolean;
}
