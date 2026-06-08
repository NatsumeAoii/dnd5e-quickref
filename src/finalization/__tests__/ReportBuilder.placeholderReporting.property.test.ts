// Feature: pre-ship-finalization, Property 53: Every placeholder appears in the report with path and location
//
// Validates: Requirements 15.4
//
// Property text: Every [FILL IN] placeholder in the FinalizationReport appears
// in the rendered `## Finalization Summary` with its file path and in-file
// location coordinates.
//
// Strategy: generate FinalizationReport objects whose `placeholders` array is a
// list of PlaceholderRef ({ path, location, key }) covering every CodeLocation
// shape the report can render:
//   - source coordinates: line only, or line + column
//   - markup coordinates: tag and/or selector
// The remaining report fields are filled with a minimal-but-valid skeleton so
// the builder runs end-to-end. For each generated report we render the summary
// once and assert that, for every placeholder, the rendered text contains:
//   1. the placeholder's file path,
//   2. each location coordinate that was supplied (line, column, tag,
//      selector), formatted exactly as the builder renders it, and
//   3. the key, when present.
// We also assert the placeholders section is never collapsed to "none" when at
// least one placeholder exists, so a placeholder can never silently vanish.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  buildFinalizationSummary,
  type FinalizationReport,
} from '../ReportBuilder';
import type { ProjectType } from '../ProjectTypeDetector';
import type { CodeLocation, PlaceholderRef } from '../types';

/** A minimal, valid ProjectType so the builder can render the type section. */
const MINIMAL_PROJECT_TYPE: ProjectType = {
  primaryLanguages: [],
  runtime: 'undetermined',
  environment: 'undetermined',
  packageManager: 'undetermined',
  keyConfigFiles: [],
  buildTooling: 'undetermined',
  deploymentTarget: 'undetermined',
  notes: [],
};

/** Distinct repo-relative paths a generated placeholder may reference. */
const CANDIDATE_PATHS: readonly string[] = [
  'src/index.ts',
  'src/config.ts',
  'public/index.html',
  'styles/app.css',
  'package.json',
  'README.md',
  'vite.config.ts',
  'src/nested/deep/module.ts',
];

/**
 * A CodeLocation arbitrary that always produces at least one populated
 * coordinate, drawn from both the source (line/column) and markup
 * (tag/selector) families so every render branch is exercised.
 */
const locationArbitrary: fc.Arbitrary<CodeLocation> = fc
  .record(
    {
      line: fc.integer({ min: 1, max: 99999 }),
      column: fc.integer({ min: 1, max: 500 }),
      tag: fc.constantFrom('html', 'head', 'title', 'meta', 'link', 'body'),
      selector: fc.constantFrom('.btn', '#main', 'a:hover', 'div > span'),
    },
    { requiredKeys: [] },
  )
  // Drop column when line is absent: the builder only renders column alongside
  // line, so a column-without-line shape would not be observable and would make
  // the assertion vacuous.
  .map((loc) => (loc.line === undefined ? { ...loc, column: undefined } : loc))
  // Guarantee at least one coordinate so the rendered location is never the
  // "location unknown" fallback (which carries no placeholder-specific data).
  .filter(
    (loc) =>
      loc.line !== undefined ||
      loc.tag !== undefined ||
      loc.selector !== undefined,
  );

const placeholderArbitrary: fc.Arbitrary<PlaceholderRef> = fc.record({
  path: fc.constantFrom(...CANDIDATE_PATHS),
  location: locationArbitrary,
  key: fc.oneof(
    fc.constant(''),
    fc.constantFrom(
      'apiBaseUrl',
      'og:image',
      'twitter:site',
      'description',
      'canonical-url',
    ),
  ),
});

/**
 * A FinalizationReport carrying a non-empty placeholder list. All other
 * list-bearing fields are left empty: the focus is placeholder reporting, and
 * empty fields exercise the "none" rendering for the surrounding sections.
 */
const reportArbitrary: fc.Arbitrary<FinalizationReport> = fc
  .array(placeholderArbitrary, { minLength: 1, maxLength: 12 })
  .chain((placeholders) =>
    fc.record({
      detectedProjectType: fc.constant(MINIMAL_PROJECT_TYPE),
      changedFiles: fc.constant([]),
      universalIssuesFixed: fc.constant([]),
      stackIssuesFixed: fc.constant([]),
      configFilesCorrected: fc.constant([]),
      placeholders: fc.constant(placeholders),
      verifiedClean: fc.constant([]),
      selfCorrections: fc.constant([]),
      gitignoreAdditions: fc.constant([]),
      restructured: fc.constant([]),
      readFailures: fc.constant([]),
      commandStatuses: fc.constant([]),
      remainingIssues: fc.constant([]),
      completed: fc.boolean(),
    }),
  );

/**
 * The exact coordinate substrings the builder renders for a location. Mirrors
 * ReportBuilder.formatLocation so the test asserts on the real output contract.
 */
function expectedLocationFragments(location: CodeLocation): string[] {
  const fragments: string[] = [];
  if (location.line !== undefined) {
    fragments.push(
      location.column !== undefined
        ? `line ${location.line}, column ${location.column}`
        : `line ${location.line}`,
    );
  }
  if (location.tag !== undefined) {
    fragments.push(`tag ${location.tag}`);
  }
  if (location.selector !== undefined) {
    fragments.push(`selector ${location.selector}`);
  }
  return fragments;
}

describe('ReportBuilder placeholder reporting (Property 53)', () => {
  it('renders every placeholder with its path and location coordinates', () => {
    fc.assert(
      fc.property(reportArbitrary, (report) => {
        const summary = buildFinalizationSummary(report);

        // The placeholders section must never be collapsed to "none" when at
        // least one placeholder exists (Requirement 15.4 / 15.6).
        const placeholderSection = summary.split('\n\n').find((section) =>
          section.startsWith('### Placeholders requiring human completion'),
        );
        expect(placeholderSection).toBeDefined();
        expect(placeholderSection).not.toContain('\nnone');

        for (const placeholder of report.placeholders) {
          // 1. Path is present.
          expect(summary).toContain(placeholder.path);

          // 2. Every supplied location coordinate is present, exactly as
          //    rendered by the builder.
          for (const fragment of expectedLocationFragments(
            placeholder.location,
          )) {
            expect(summary).toContain(fragment);
          }

          // 3. The key, when present, is included.
          if (placeholder.key.length > 0) {
            expect(summary).toContain(placeholder.key);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('places every placeholder entry on its own bullet within the placeholder section', () => {
    fc.assert(
      fc.property(reportArbitrary, (report) => {
        const summary = buildFinalizationSummary(report);
        const placeholderSection = summary.split('\n\n').find((section) =>
          section.startsWith('### Placeholders requiring human completion'),
        );
        expect(placeholderSection).toBeDefined();

        // One bullet line per placeholder (the heading is the only non-bullet
        // line), so no placeholder is merged into or dropped from a neighbour.
        const bulletLines = (placeholderSection ?? '')
          .split('\n')
          .filter((line) => line.startsWith('- '));
        expect(bulletLines.length).toBe(report.placeholders.length);

        // Each placeholder's path + location coordinates appear together on a
        // single bullet, proving path and location are co-located per entry.
        for (const placeholder of report.placeholders) {
          const bullet = bulletLines.find(
            (line) =>
              line.includes(placeholder.path) &&
              expectedLocationFragments(placeholder.location).every((fragment) =>
                line.includes(fragment),
              ),
          );
          expect(bullet).toBeDefined();
        }
      }),
      { numRuns: 200 },
    );
  });
});
