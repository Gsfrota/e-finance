import { execSync } from 'child_process';
import { FLOW_MAP, IGNORED_PATTERNS, ALL_SPEC_FILES } from './flow-map.js';
import type { DiffAnalysis, AffectedFlow } from './types.js';

function getChangedFiles(): string[] {
  // Try uncommitted changes first
  let output = execSync('git diff --name-only HEAD 2>/dev/null || true', {
    encoding: 'utf-8',
  }).trim();

  // Include untracked files
  const untracked = execSync('git ls-files --others --exclude-standard 2>/dev/null || true', {
    encoding: 'utf-8',
  }).trim();

  if (untracked) {
    output = output ? `${output}\n${untracked}` : untracked;
  }

  // If no uncommitted changes, use last commit
  if (!output) {
    output = execSync('git diff --name-only HEAD~1..HEAD 2>/dev/null || true', {
      encoding: 'utf-8',
    }).trim();
  }

  if (!output) return [];
  return [...new Set(output.split('\n').filter(Boolean))];
}

function isIgnored(file: string): boolean {
  return IGNORED_PATTERNS.some((p) => p.test(file));
}

function analyzeDiff(): DiffAnalysis {
  const changedFiles = getChangedFiles();
  const testableFiles = changedFiles.filter((f) => !isIgnored(f));

  const flowMap = new Map<string, AffectedFlow>();
  let isFullSuiteRecommended = false;

  for (const file of testableFiles) {
    const basename = file.split('/').pop() || file;

    for (const mapping of FLOW_MAP) {
      if (file.includes(mapping.filePattern) || basename === mapping.filePattern) {
        if (mapping.flowName === 'ALL') {
          isFullSuiteRecommended = true;
          continue;
        }

        const existing = flowMap.get(mapping.flowName);
        if (existing) {
          if (!existing.triggerFiles.includes(file)) {
            existing.triggerFiles.push(file);
          }
        } else {
          flowMap.set(mapping.flowName, {
            flowName: mapping.flowName,
            testFiles: [...mapping.testFiles],
            playwrightProject: mapping.playwrightProject,
            risk: mapping.risk,
            triggerFiles: [file],
            hasTests: mapping.testFiles.length > 0,
          });
        }
      }
    }
  }

  // If full suite recommended, upgrade all flows to use all tests
  if (isFullSuiteRecommended) {
    for (const flow of flowMap.values()) {
      flow.testFiles = ALL_SPEC_FILES;
      flow.playwrightProject = 'all';
      flow.hasTests = true;
    }
    // If no specific flows matched but full suite is needed
    if (flowMap.size === 0) {
      flowMap.set('full-suite', {
        flowName: 'full-suite',
        testFiles: ALL_SPEC_FILES,
        playwrightProject: 'all',
        risk: 'high',
        triggerFiles: testableFiles.filter((f) =>
          FLOW_MAP.some(
            (m) => m.flowName === 'ALL' && (f.includes(m.filePattern) || f.endsWith(m.filePattern)),
          ),
        ),
        hasTests: true,
      });
    }
  }

  return {
    changedFiles,
    affectedFlows: Array.from(flowMap.values()),
    isFullSuiteRecommended,
  };
}

const analysis = analyzeDiff();
console.log(JSON.stringify(analysis));
