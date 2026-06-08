// Feature: pre-ship-finalization, Property 10: Behavior-altering removals are retained with a reason
//
// Property 10 (design "Correctness Properties"):
//   For any candidate debug-artifact removal, if removing it would change the
//   project's observable runtime behavior, the artifact SHALL be retained and a
//   reason SHALL be recorded.
//
// **Validates: Requirements 3.7**
//
// This is a behavior-preservation property. Rather than asserting what the fixer
// removes, it asserts what the fixer must NOT remove: any dead-code candidate
// whose removal would alter observable runtime behavior.
//
// Aligned to the deadCode.ts fixer contract, the dead-code domain treats three
// removal candidates as behavior-altering and retains each with a recorded
// reason (deadCodeFixer.fix -> { preserved: true, preservationReason: ... } and
// applyDeadCodeFix leaving the source byte-for-byte unchanged):
//
//   1. Exported unreferenced symbol (3.7): an exported declaration may be
//      referenced by another module the detector cannot see, so removing it
//      could change the module's public surface and observable behavior.
//   2. A symbol still referenced within its own file: removing the declaration
//      would orphan a live reference, i.e. break the program.
//   3. Whole-file removal (`unreferenced-file`): deleting an entire source file
//      is a behavior-altering operation retained for manual review.
//
// (A `console` debug call with no preservation annotation is, by contrast,
// considered safe to remove and is intentionally NOT in this set; the fixer does
// not classify it as behavior-altering.)

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  deadCodeDetector,
  deadCodeFixer,
  applyDeadCodeFix,
  DEAD_CODE_KINDS,
} from '../detectors/deadCode';
import type { FileRecord, Finding } from '../types';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function tsRecord(content: string, path = 'src/sample.ts'): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: 'typescript',
  };
}

/**
 * Asserts a finding is retained because its removal would alter observable
 * behavior: the fixer must report `preserved: true`, emit no edits, record a
 * non-empty reason, and leave the source byte-for-byte unchanged.
 */
function assertRetainedWithReason(record: FileRecord, finding: Finding): void {
  const outcome = deadCodeFixer.fix(finding, record);

  expect(outcome.preserved).toBe(true);
  expect(outcome.edits).toEqual([]);
  expect(outcome.preservationReason).toBeTruthy();
  expect((outcome.preservationReason ?? '').trim().length).toBeGreaterThan(0);

  // A preserved finding must not mutate the source at all.
  expect(applyDeadCodeFix(record.content as string, finding)).toBe(
    record.content,
  );
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

/** Descriptive, non-placeholder identifier names (valid in any scope). */
const descriptiveNameArb = fc.constantFrom(
  'computeTotal',
  'renderView',
  'parseConfig',
  'loadData',
  'handleSelection',
  'formatDate',
  'validateInput',
  'buildReport',
);

/** An exported, unreferenced top-level declaration (a real 3.7 candidate). */
const exportedDeclArb = fc
  .record({
    name: descriptiveNameArb,
    kind: fc.constantFrom('const', 'let', 'var', 'function', 'class'),
  })
  .map(({ name, kind }) => {
    switch (kind) {
      case 'function':
        return { name, source: `export function ${name}() {\n  return 1;\n}\n` };
      case 'class':
        return { name, source: `export class ${name} {\n  value = 1;\n}\n` };
      default:
        return { name, source: `export ${kind} ${name} = 1;\n` };
    }
  });

/** A local declaration that is still referenced elsewhere in the same file. */
const referencedLocalDeclArb = fc
  .record({
    name: descriptiveNameArb,
    kind: fc.constantFrom('const', 'let', 'var'),
    uses: fc.integer({ min: 1, max: 3 }),
  })
  .map(({ name, kind, uses }) => {
    const usageLines = Array.from(
      { length: uses },
      () => `consume(${name});`,
    ).join('\n');
    return { name, source: `${kind} ${name} = produceValue();\n${usageLines}\n` };
  });

// ---------------------------------------------------------------------------
// Property 10.
// ---------------------------------------------------------------------------

describe('Property 10: Behavior-altering removals are retained with a reason', () => {
  it('retains exported unreferenced symbols (removal could alter module behavior)', () => {
    fc.assert(
      fc.property(exportedDeclArb, ({ source }) => {
        const record = tsRecord(source);

        const finding = deadCodeDetector
          .detect([record])
          .find(
            (f) =>
              f.kind === DEAD_CODE_KINDS.unreferencedSymbol &&
              f.path === record.path,
          );

        // The exported symbol must be detected as unreferenced...
        expect(
          finding,
          `expected an unreferenced exported-symbol finding in:\n${source}`,
        ).toBeDefined();
        if (!finding) return;

        // ...and the fixer must retain it rather than remove it (3.7).
        assertRetainedWithReason(record, finding);
      }),
      { numRuns: 100 },
    );
  });

  it('retains symbols that are still referenced within the file', () => {
    fc.assert(
      fc.property(referencedLocalDeclArb, ({ source }) => {
        const record = tsRecord(source);

        // The symbol is genuinely used, so the detector does not flag it.
        // Pose the worst case directly: a removal candidate aimed at a live
        // symbol. The fixer must refuse to remove it because doing so would
        // orphan the surviving reference and alter behavior.
        const finding: Finding = {
          domain: 'dead-code',
          path: record.path,
          location: { line: 1, column: 1 },
          kind: DEAD_CODE_KINDS.unreferencedSymbol,
          detail: 'candidate removal targeting a referenced symbol',
          autoFixable: true,
        };

        assertRetainedWithReason(record, finding);
      }),
      { numRuns: 100 },
    );
  });

  it('retains whole-file removal candidates (deleting a file is behavior-altering)', () => {
    fc.assert(
      fc.property(descriptiveNameArb, (name) => {
        const source = `export function ${name}() {\n  return 1;\n}\n`;
        const record = tsRecord(source, `src/${name}.ts`);

        const finding: Finding = {
          domain: 'dead-code',
          path: record.path,
          location: { line: 1, column: 1 },
          kind: DEAD_CODE_KINDS.unreferencedFile,
          detail: 'source file is not referenced by any other project file',
          autoFixable: false,
        };

        assertRetainedWithReason(record, finding);
      }),
      { numRuns: 100 },
    );
  });
});
