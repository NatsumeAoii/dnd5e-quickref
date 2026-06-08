// Feature: pre-ship-finalization, Property 54: Empty report sections render an explicit "none"
//
// Validates: Requirements 15.6
//
// Property text: For any FinalizationReport, every list-bearing section of the
// rendered `## Finalization Summary` whose backing collection is empty SHALL be
// present with an explicit "none" marker — never silently omitted.
//
// Strategy: generate FinalizationReport objects where each list-bearing
// collection is an independently-sized array (minLength 0), so an arbitrary
// subset of the twelve list-bearing sections is empty on any given run. The test
// then asserts, for every list-bearing section:
//   1. Its `### <Title>` heading is always present exactly once, regardless of
//      whether the section is empty (sections are never dropped).
//   2. When the backing collection is empty, the heading is immediately followed
//      by the explicit NONE_MARKER line (`### <Title>\nnone`) — Requirement 15.6.
//   3. When the backing collection is non-empty, the heading is followed by a
//      markdown bullet (`### <Title>\n- ...`) and NOT by the "none" marker, so
//      the explicit-none rendering is exact rather than vacuous.
//
// The generated entries are constrained to single, non-empty lines so the line
// directly after each heading is unambiguous; this isolates the property under
// test (empty -> "none") from incidental content shapes.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  buildFinalizationSummary,
  NONE_MARKER,
  type FinalizationReport,
} from '../ReportBuilder';
import type { ProjectType } from '../ProjectTypeDetector';
import type { CommandResult } from '../CommandRunner';
import type { FileChange, PlaceholderRef, ReadFailure } from '../types';

/**
 * A fixed, fully-determined project type. `detectedProjectType` is not a
 * list-bearing section (it always renders its scalar fields), so holding it
 * constant keeps the test focused on the twelve list-bearing sections.
 */
const PROJECT_TYPE: ProjectType = {
  primaryLanguages: [{ language: 'typescript', count: 10, share: 1 }],
  runtime: 'browser',
  environment: 'Node >=22',
  packageManager: 'npm',
  keyConfigFiles: ['package.json'],
  buildTooling: 'Vite',
  deploymentTarget: 'GitHub Pages',
  notes: [],
};

/** A non-empty, single-line string (no newlines) for predictable rendering. */
const safeText: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .map((value) => `x${value.replace(/[\r\n]/g, '_')}`);

/** A repo-relative POSIX path with no newlines. */
const safePath: fc.Arbitrary<string> = safeText.map((value) => `src/${value}.ts`);

const fileChangeArb: fc.Arbitrary<FileChange> = fc.record({
  path: safePath,
  kind: fc.constantFrom('changed', 'created'),
});

const placeholderArb: fc.Arbitrary<PlaceholderRef> = fc.record({
  path: safePath,
  location: fc.record({
    line: fc.integer({ min: 1, max: 500 }),
    column: fc.integer({ min: 1, max: 120 }),
  }),
  key: safeText,
});

const readFailureArb: fc.Arbitrary<ReadFailure> = fc.record({
  path: safePath,
  reason: safeText,
});

const commandResultArb: fc.Arbitrary<CommandResult> = fc.record({
  command: safeText,
  exitStatus: fc.integer({ min: -1, max: 5 }),
  stdout: fc.constant(''),
  stderr: fc.constant(''),
});

/** A list-bearing section over arbitrary strings, possibly empty. */
function stringListArb(): fc.Arbitrary<readonly string[]> {
  return fc.array(safeText, { maxLength: 4 });
}

/**
 * A FinalizationReport whose twelve list-bearing collections are each
 * independently sized (minLength 0), so an arbitrary subset is empty per run.
 */
const reportArb: fc.Arbitrary<FinalizationReport> = fc.record({
  detectedProjectType: fc.constant(PROJECT_TYPE),
  changedFiles: fc.array(fileChangeArb, { maxLength: 4 }),
  universalIssuesFixed: stringListArb(),
  stackIssuesFixed: stringListArb(),
  configFilesCorrected: stringListArb(),
  placeholders: fc.array(placeholderArb, { maxLength: 4 }),
  verifiedClean: stringListArb(),
  selfCorrections: stringListArb(),
  gitignoreAdditions: stringListArb(),
  restructured: stringListArb(),
  readFailures: fc.array(readFailureArb, { maxLength: 4 }),
  commandStatuses: fc.array(commandResultArb, { maxLength: 4 }),
  remainingIssues: stringListArb(),
  completed: fc.boolean(),
});

/**
 * The twelve list-bearing section titles paired with a predicate reading the
 * matching collection's emptiness from the report. This is the single source of
 * truth the assertions iterate over.
 */
const LIST_SECTIONS: readonly {
  readonly title: string;
  readonly isEmpty: (report: FinalizationReport) => boolean;
}[] = [
  { title: 'Changed and created files', isEmpty: (r) => r.changedFiles.length === 0 },
  { title: 'Universal issues fixed', isEmpty: (r) => r.universalIssuesFixed.length === 0 },
  { title: 'Stack-specific issues fixed', isEmpty: (r) => r.stackIssuesFixed.length === 0 },
  {
    title: 'Configuration files corrected or created',
    isEmpty: (r) => r.configFilesCorrected.length === 0,
  },
  {
    title: 'Placeholders requiring human completion',
    isEmpty: (r) => r.placeholders.length === 0,
  },
  { title: 'Verified clean', isEmpty: (r) => r.verifiedClean.length === 0 },
  {
    title: 'Self-corrections during recheck',
    isEmpty: (r) => r.selfCorrections.length === 0,
  },
  {
    title: '.gitignore additions for transient directories',
    isEmpty: (r) => r.gitignoreAdditions.length === 0,
  },
  { title: 'Restructured or recategorized', isEmpty: (r) => r.restructured.length === 0 },
  { title: 'Read failures', isEmpty: (r) => r.readFailures.length === 0 },
  {
    title: 'Verification command statuses',
    isEmpty: (r) => r.commandStatuses.length === 0,
  },
  { title: 'Remaining issues', isEmpty: (r) => r.remainingIssues.length === 0 },
];

/** Count non-overlapping occurrences of an exact substring. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

describe('Property 54: Empty report sections render an explicit "none"', () => {
  it('renders every empty list-bearing section with an explicit "none" and never omits it', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const summary = buildFinalizationSummary(report);

        for (const section of LIST_SECTIONS) {
          const heading = `### ${section.title}`;
          const emptyRender = `${heading}\n${NONE_MARKER}`;
          const bulletRender = `${heading}\n- `;

          // 1. The section heading is always present exactly once — empty
          //    sections are never silently dropped.
          expect(countOccurrences(summary, heading)).toBe(1);

          if (section.isEmpty(report)) {
            // 2. Empty collection -> explicit "none" directly under the heading.
            expect(summary).toContain(emptyRender);
            expect(summary).not.toContain(bulletRender);
          } else {
            // 3. Non-empty collection -> a bullet, never the "none" marker.
            expect(summary).toContain(bulletRender);
            expect(summary).not.toContain(emptyRender);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('renders all twelve list-bearing sections as "none" when the report is fully empty', () => {
    const emptyReport: FinalizationReport = {
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
    };

    const summary = buildFinalizationSummary(emptyReport);

    for (const section of LIST_SECTIONS) {
      expect(summary).toContain(`### ${section.title}\n${NONE_MARKER}`);
    }
  });
});
