// Feature: pre-ship-finalization, Property 52: The report lists every changed and created file exactly once with the correct marker
//
// Validates: Requirements 15.2
//
// Property text: For any FinalizationReport, the rendered `## Finalization
// Summary` lists every changed/created Project_File exactly once, each marked
// `changed` or `created` according to its FileChange.kind — with no duplicates
// and no omissions.
//
// Strategy: generate a FinalizationReport whose `changedFiles` is an array of
// FileChange ({ path, kind: 'changed' | 'created' }) over a set of *distinct*
// repo-relative paths (distinct so "exactly once" and "no duplicate" are
// observable independently of input duplication). Every other list-bearing
// field is left empty and the project type is a fixed minimal stub, so the
// "Changed and created files" section is the only variable under test. The test
// renders the summary with `buildFinalizationSummary`, isolates that section,
// and asserts:
//   1. The number of rendered bullet entries equals the number of input
//      FileChange entries (no omissions, no spurious extras).
//   2. The set of rendered `path (kind)` pairs equals the input set exactly —
//      every file appears with the correct marker.
//   3. No rendered entry occurs more than once (no duplicates).
//   4. The marker rendered for each path matches that path's FileChange.kind.
// An empty `changedFiles` renders the explicit "none" marker rather than an
// empty list (the empty-section behaviour the same section must honour).

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  buildFinalizationSummary,
  NONE_MARKER,
  type FinalizationReport,
} from '../ReportBuilder';
import type { ProjectType } from '../ProjectTypeDetector';
import type { FileChange } from '../types';

/** The heading the changed/created file list is rendered under. */
const CHANGED_FILES_HEADING = '### Changed and created files';

/** A minimal, fully-determined project type so detection output is constant. */
const STUB_PROJECT_TYPE: ProjectType = {
  primaryLanguages: [],
  runtime: 'browser',
  environment: 'undetermined',
  packageManager: 'npm',
  keyConfigFiles: [],
  buildTooling: 'Vite',
  deploymentTarget: 'GitHub Pages',
  notes: [],
};

/**
 * Build a report whose only populated list is `changedFiles`; every other
 * section is empty so the changed-files section is the sole variable.
 */
function reportWith(changedFiles: readonly FileChange[]): FinalizationReport {
  return {
    detectedProjectType: STUB_PROJECT_TYPE,
    changedFiles,
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
}

/**
 * Extract the body lines of the `### Changed and created files` section from a
 * rendered summary. Sections are separated by blank lines, so the section block
 * is the paragraph starting with the heading; its body is every line after the
 * heading line.
 */
function changedFilesBody(summary: string): string[] {
  const blocks = summary.split('\n\n');
  const block = blocks.find((b) => b.startsWith(CHANGED_FILES_HEADING));
  expect(block).toBeDefined();
  return (block as string).split('\n').slice(1);
}

/** Candidate distinct repo-relative paths a generated FileChange may use. */
const CANDIDATE_PATHS: readonly string[] = [
  'src/index.ts',
  'src/config.ts',
  'src/app/main.ts',
  'public/index.html',
  'styles/app.css',
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'vite.config.ts',
  '.gitignore',
  'src/finalization/Orchestrator.ts',
  'tsconfig.json',
];

const kindArb = fc.constantFrom<FileChange['kind']>('changed', 'created');

/**
 * An array of FileChange entries over a distinct subset of paths. Distinct
 * paths make "exactly once / no duplicate / no omission" directly observable.
 * The empty subset is allowed so the "none" branch is also exercised.
 */
const changedFilesArb: fc.Arbitrary<readonly FileChange[]> = fc
  .subarray([...CANDIDATE_PATHS], { minLength: 0, maxLength: CANDIDATE_PATHS.length })
  .chain((paths) =>
    fc.tuple(...paths.map((path) => kindArb.map((kind) => ({ path, kind })))),
  );

describe('ReportBuilder changed/created file listing (Property 52)', () => {
  it('lists every changed/created file exactly once with the correct marker', () => {
    fc.assert(
      fc.property(changedFilesArb, (changedFiles) => {
        const summary = buildFinalizationSummary(reportWith(changedFiles));
        const body = changedFilesBody(summary);

        if (changedFiles.length === 0) {
          // Empty section renders the explicit "none" marker, never a bullet.
          expect(body).toEqual([NONE_MARKER]);
          return;
        }

        // Every body line is a real bullet of the form "- path (kind)".
        const entries = body.map((line) => {
          const match = /^- (.+) \((changed|created)\)$/.exec(line);
          expect(match).not.toBeNull();
          return { path: (match as RegExpMatchArray)[1], kind: (match as RegExpMatchArray)[2] };
        });

        // 1. No omissions, no spurious extras: counts match exactly.
        expect(entries).toHaveLength(changedFiles.length);

        // 3. No duplicates: each rendered path appears exactly once.
        const renderedPaths = entries.map((e) => e.path);
        expect(new Set(renderedPaths).size).toBe(renderedPaths.length);

        // 2 & 4. The set of (path, kind) pairs equals the input exactly, so
        // every file is present with the correct marker.
        const expectedPairs = changedFiles
          .map((c) => `${c.path} (${c.kind})`)
          .sort();
        const actualPairs = entries
          .map((e) => `${e.path} (${e.kind})`)
          .sort();
        expect(actualPairs).toEqual(expectedPairs);

        // Cross-check: the marker for each path matches its FileChange.kind.
        const kindByPath = new Map(changedFiles.map((c) => [c.path, c.kind]));
        for (const entry of entries) {
          expect(entry.kind).toBe(kindByPath.get(entry.path));
        }
      }),
      { numRuns: 200 },
    );
  });
});
