// @vitest-environment node
//
// Feature: pre-ship-finalization, Task 19.5
//
// Unit test for Finalization Summary structure and early termination.
//
// Verifies buildFinalizationSummary renders:
//   - exactly one `## Finalization Summary` heading (Requirement 15.1),
//   - every detected-project-type field (Requirement 15.3),
//   - populated restructured and remaining-issues sections when entries are
//     supplied (Requirement 15.5),
//   - the "pass did not complete" notice when `completed` is false
//     (Requirement 15.7).
//
// _Requirements: 15.1, 15.3, 15.5, 15.7_

import { describe, expect, it } from 'vitest';

import {
  buildFinalizationSummary,
  INCOMPLETE_NOTICE,
  SUMMARY_HEADING,
  type FinalizationReport,
} from '../ReportBuilder';
import type { ProjectType } from '../ProjectTypeDetector';

/**
 * A fully-determined project type so every detection field renders a real
 * value (Requirement 15.3). Mirrors this repo's actual stack facts.
 */
const PROJECT_TYPE: ProjectType = {
  primaryLanguages: [
    { language: 'typescript', count: 42, share: 0.84 },
    { language: 'css', count: 8, share: 0.16 },
  ],
  runtime: 'browser',
  environment: 'Node >=22',
  packageManager: 'npm',
  keyConfigFiles: ['package.json', 'tsconfig.json', 'vite.config.ts'],
  buildTooling: 'Vite, tsc',
  deploymentTarget: 'GitHub Pages',
  notes: [],
};

/**
 * Build a report with sensible defaults that individual tests override. Every
 * list-bearing field defaults to empty so a test can isolate the one section
 * it cares about.
 */
function makeReport(
  overrides: Partial<FinalizationReport> = {},
): FinalizationReport {
  return {
    detectedProjectType: PROJECT_TYPE,
    changedFiles: [],
    universalIssuesFixed: [],
    stackIssuesFixed: [],
    configFilesCorrected: [],
    placeholders: [],
    verifiedClean: [],
    selfCorrections: [],
    gitignoreAdditions: [],
    restructured: [],
    readFailures: [],
    commandStatuses: [],
    remainingIssues: [],
    completed: true,
    ...overrides,
  };
}

describe('buildFinalizationSummary structure', () => {
  it('emits exactly one `## Finalization Summary` heading (Req 15.1)', () => {
    const summary = buildFinalizationSummary(makeReport());

    const headingMatches = summary.match(/^## Finalization Summary$/gm) ?? [];
    expect(headingMatches).toHaveLength(1);
    // The single heading is also the first line of the report.
    expect(summary.startsWith(SUMMARY_HEADING)).toBe(true);
  });

  it('renders every detected-project-type field (Req 15.3)', () => {
    const summary = buildFinalizationSummary(makeReport());

    expect(summary).toContain('### Detected project type');
    // Each labelled field is present with its detected value.
    expect(summary).toContain('Primary languages: typescript (42 files, 84%), css (8 files, 16%)');
    expect(summary).toContain('Runtime: browser');
    expect(summary).toContain('Environment: Node >=22');
    expect(summary).toContain('Package manager: npm');
    expect(summary).toContain(
      'Key configuration files: package.json, tsconfig.json, vite.config.ts',
    );
    expect(summary).toContain('Build tooling: Vite, tsc');
    expect(summary).toContain('Deployment target: GitHub Pages');
  });

  it('populates restructured and remaining-issues sections when given entries (Req 15.5)', () => {
    const summary = buildFinalizationSummary(
      makeReport({
        restructured: [
          'moved src/old-util.ts to src/utils/oldUtil.ts',
          'removed stray debug.log',
        ],
        remainingIssues: ['index.html description still requires a human value'],
      }),
    );

    expect(summary).toContain('### Restructured or recategorized');
    expect(summary).toContain('- moved src/old-util.ts to src/utils/oldUtil.ts');
    expect(summary).toContain('- removed stray debug.log');

    expect(summary).toContain('### Remaining issues');
    expect(summary).toContain(
      '- index.html description still requires a human value',
    );

    // Populated sections must not fall back to the empty "none" marker.
    expect(summary).not.toMatch(/### Restructured or recategorized\nnone/);
    expect(summary).not.toMatch(/### Remaining issues\nnone/);
  });

  it('renders the "pass did not complete" notice when completed is false (Req 15.7)', () => {
    const summary = buildFinalizationSummary(makeReport({ completed: false }));

    expect(summary).toContain(INCOMPLETE_NOTICE);
    // The notice sits directly beneath the single heading.
    const lines = summary.split('\n\n');
    expect(lines[0]).toBe(SUMMARY_HEADING);
    expect(lines[1]).toBe(INCOMPLETE_NOTICE);
  });

  it('omits the early-termination notice when the pass completed (Req 15.7)', () => {
    const summary = buildFinalizationSummary(makeReport({ completed: true }));

    expect(summary).not.toContain(INCOMPLETE_NOTICE);
  });
});
