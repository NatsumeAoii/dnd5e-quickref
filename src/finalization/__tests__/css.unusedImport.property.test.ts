// Feature: pre-ship-finalization, Property 42: Unused CSS imports are removed when and only when unused
//
// Property 42 (design "Correctness Properties", Requirement 11.1):
//   For any CSS `@import`, it is removed if and only if the referenced
//   stylesheet matches no project markup AND is not referenced by any other
//   retained stylesheet. Equivalently:
//     - The detector emits an `unused-import` finding for the import iff the
//       referenced stylesheet has no rule whose selector matches project markup
//       AND no other retained stylesheet imports the same target.
//     - The fixer turns every such finding into a single `delete` edit at the
//       import's source line.
//     - A used import (matches markup, or referenced elsewhere) is never
//       flagged, so it is never removed.
//
// **Validates: Requirements 11.1**
//
// The test drives `cssDetector` / `cssFixer` (CssQualityDetector /
// CssQualityFixer) from `src/finalization/detectors/css.ts`. It builds a small
// file inventory: an HTML file establishing the project markup, a target
// stylesheet that either does or does not match that markup, a main stylesheet
// that imports the target, and optionally a second stylesheet that also imports
// the target. Two independent booleans (`targetMatches`, `hasOtherReference`)
// span all four combinations, so the generated space covers both the
// "should remove" and "should keep" sides of the iff.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { cssDetector, cssFixer } from '../detectors/css';
import type { FileRecord, SourceLanguage } from '../types';

const RUNS = 200;

const KIND_UNUSED_IMPORT = 'unused-import';

/** Builds a FileRecord from a path, content, and language (no I/O). */
function record(path: string, content: string, language: SourceLanguage): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language,
  };
}

/** A lowercase CSS identifier (letters only) of length 3..8. */
const identifier = fc
  .stringMatching(/^[a-z]{3,8}$/)
  .filter((s) => s.length >= 3 && s.length <= 8);

interface Scenario {
  /** Class name that appears in the project markup. */
  readonly presentClass: string;
  /** Class name guaranteed absent from the project markup. */
  readonly absentClass: string;
  /** When true, the target stylesheet matches the markup (a used target). */
  readonly targetMatches: boolean;
  /** When true, a second stylesheet also imports the target. */
  readonly hasOtherReference: boolean;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    presentClass: identifier,
    absentSuffix: identifier,
    targetMatches: fc.boolean(),
    hasOtherReference: fc.boolean(),
  })
  // Force the present/absent class names to be disjoint via distinct prefixes,
  // so a non-matching target selector shares no token with the markup.
  .map(({ presentClass, absentSuffix, targetMatches, hasOtherReference }) => ({
    presentClass: `u-${presentClass}`,
    absentClass: `z-${absentSuffix}`,
    targetMatches,
    hasOtherReference,
  }));

/** Assembles the file inventory for a scenario. */
function buildInventory(scenario: Scenario): {
  records: FileRecord[];
  mainPath: string;
} {
  const { presentClass, absentClass, targetMatches, hasOtherReference } = scenario;

  // The HTML markup establishes the only tags/classes/ids the toolkit knows.
  const html = record(
    'index.html',
    `<!doctype html><html lang="en"><body>` +
      `<div class="${presentClass}" id="used-id">content</div>` +
      `</body></html>`,
    'html',
  );

  // A matching target uses the present class; a non-matching target uses a
  // class that does not appear anywhere in the markup.
  const targetSelector = targetMatches ? `.${presentClass}` : `.${absentClass}`;
  const target = record(
    'target.css',
    `${targetSelector} {\n  color: red;\n}\n`,
    'css',
  );

  // The main stylesheet imports the target on line 1.
  const main = record(
    'main.css',
    `@import "target.css";\n.layout {\n  display: block;\n}\n`,
    'css',
  );

  const records: FileRecord[] = [html, target, main];

  // An optional second stylesheet that also imports the target makes the
  // import "referenced by another retained stylesheet".
  if (hasOtherReference) {
    records.push(
      record('other.css', `@import "target.css";\n.other {\n  margin: 0;\n}\n`, 'css'),
    );
  }

  return { records, mainPath: 'main.css' };
}

describe('Property 42: unused CSS imports are removed when and only when unused', () => {
  it('flags and deletes an import iff the target is unused (no markup match and no other reference)', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { records, mainPath } = buildInventory(scenario);

        // Ground truth from the requirement's own definition of "unused".
        const expectedUnused =
          !scenario.targetMatches && !scenario.hasOtherReference;

        const findings = cssDetector.detect(records);
        const importFindings = findings.filter(
          (f) => f.path === mainPath && f.kind === KIND_UNUSED_IMPORT,
        );

        // Detector side of the iff: flagged exactly when the import is unused.
        if (expectedUnused) {
          expect(importFindings).toHaveLength(1);
        } else {
          expect(importFindings).toHaveLength(0);
        }

        const mainRecord = records.find((r) => r.path === mainPath)!;

        if (expectedUnused) {
          // Fixer side: the finding becomes a single delete edit at the import.
          const finding = importFindings[0];
          const outcome = cssFixer.fix(finding, mainRecord);
          expect(outcome.preserved).toBe(false);
          expect(outcome.edits).toHaveLength(1);
          const edit = outcome.edits[0];
          expect(edit.kind).toBe('delete');
          expect(edit.path).toBe(mainPath);
          expect(edit.range?.line).toBe(finding.location.line);
          expect(edit.placeholderInserted).toBe(false);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('never flags the target stylesheet for an import it does not contain', () => {
    // Sanity guard: a used import (matching markup) must not be flagged even
    // when the second stylesheet is absent, isolating the markup-match branch.
    fc.assert(
      fc.property(identifier, (cls) => {
        const presentClass = `u-${cls}`;
        const records: FileRecord[] = [
          record(
            'index.html',
            `<!doctype html><html lang="en"><body><span class="${presentClass}"></span></body></html>`,
            'html',
          ),
          record('target.css', `.${presentClass} {\n  color: blue;\n}\n`, 'css'),
          record('main.css', `@import "target.css";\n`, 'css'),
        ];

        const importFindings = cssDetector
          .detect(records)
          .filter((f) => f.kind === KIND_UNUSED_IMPORT);

        expect(importFindings).toHaveLength(0);
      }),
      { numRuns: RUNS },
    );
  });
});
