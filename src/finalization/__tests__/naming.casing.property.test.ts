// Feature: pre-ship-finalization, Property 21: Replacement names follow the majority casing convention
//
// Property 21 (design "Correctness Properties"):
//   For any file with a detectable dominant casing style for the identifier's
//   kind, the replacement name SHALL use that casing style.
//
// **Validates: Requirements 6.3**
//
// Strategy: generate a non-test TypeScript source whose value-kind
// declarations all share one clear dominant casing (camelCase, PascalCase, or
// UPPER_SNAKE_CASE), plus a single placeholder identifier (`foo` / `bar` /
// `temp` / `test123`) declared as a value. The naming fixer renames the
// placeholder following the file's majority casing for that kind (Requirement
// 6.3). We then read the replacement name back out of the fixed source and
// assert, via the exported `classifyCasing` helper, that its casing matches the
// file's dominant casing.
//
// Casing styles are restricted to the three that are unambiguously
// distinguishable for the single-word descriptive base words the fixer emits
// (`value`, `item`, `temporary`, `sample`): for a single word, camelCase and
// snake_case both render as the same all-lowercase token, so snake is excluded
// here to keep the assertion exact rather than ambiguous.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  namingDetector,
  namingFixer,
  classifyCasing,
} from '../detectors/naming';
import type { FileRecord } from '../types';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Casing styles that round-trip exactly through a single-word base word. */
type DistinguishableCasing = 'camel' | 'pascal' | 'upper';

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
 * Render a distinct sibling value-declaration name in the requested casing.
 * The chosen word avoids every descriptive base word the fixer emits so the
 * generated source can never collide with the replacement.
 */
function renderSibling(casing: DistinguishableCasing, index: number): string {
  switch (casing) {
    case 'camel':
      return `columnIndex${index}`; // classifyCasing -> 'camel'
    case 'pascal':
      return `ColumnIndex${index}`; // classifyCasing -> 'pascal'
    case 'upper':
      return `COLUMN_INDEX_${index}`; // classifyCasing -> 'upper'
  }
}

/** Extract the renamed placeholder declaration's new identifier name. */
function renamedDeclarationName(fixedContent: string): string | null {
  // The placeholder is the only declaration initialized to the sentinel `0`.
  const match = /let\s+(\w+)\s*=\s*0\s*;/.exec(fixedContent);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

const placeholderArb = fc.constantFrom('foo', 'bar', 'temp', 'test123');
const casingArb = fc.constantFrom<DistinguishableCasing>(
  'camel',
  'pascal',
  'upper',
);
const siblingCountArb = fc.integer({ min: 2, max: 5 });

// ---------------------------------------------------------------------------
// Property 21.
// ---------------------------------------------------------------------------

describe('Property 21: Replacement names follow the majority casing convention', () => {
  it('renames a placeholder using the file dominant casing for its kind', () => {
    fc.assert(
      fc.property(
        placeholderArb,
        casingArb,
        siblingCountArb,
        (placeholder, casing, siblingCount) => {
          // Several value declarations establishing the dominant casing, plus
          // the placeholder (declared with the `= 0` sentinel) and a usage.
          const siblingLines: string[] = [];
          for (let i = 1; i <= siblingCount; i += 1) {
            siblingLines.push(`const ${renderSibling(casing, i)} = ${i};`);
          }
          const content =
            `${siblingLines.join('\n')}\n` +
            `let ${placeholder} = 0;\n` +
            `${placeholder} = ${placeholder} + 1;\n`;

          const record = tsRecord(content);

          // The detector must flag the placeholder as auto-fixable.
          const finding = namingDetector
            .detect([record])
            .find(
              (f) => f.kind === 'placeholder-identifier' && f.autoFixable,
            );
          expect(
            finding,
            `expected an auto-fixable placeholder finding in:\n${content}`,
          ).toBeDefined();
          if (!finding) return;

          // The fixer must apply a rename (not preserve).
          const outcome = namingFixer.fix(finding, record);
          expect(outcome.preserved).toBe(false);
          expect(outcome.edits.length).toBe(1);

          const fixedContent = outcome.edits[0].text;
          expect(fixedContent, 'fixer should produce replacement text').toBeDefined();
          if (fixedContent === undefined) return;

          // Read the replacement name back from the fixed source.
          const newName = renamedDeclarationName(fixedContent);
          expect(
            newName,
            `expected a renamed declaration in:\n${fixedContent}`,
          ).not.toBeNull();
          if (newName === null) return;

          // The replacement must no longer be the placeholder.
          expect(newName.toLowerCase()).not.toBe(placeholder.toLowerCase());

          // Core assertion (Requirement 6.3): the replacement's casing, as
          // reported by the shared classifier, matches the file's dominant
          // casing for the identifier's kind.
          expect(classifyCasing(newName)).toBe(casing);
        },
      ),
      { numRuns: 100 },
    );
  });
});
