// Feature: pre-ship-finalization, Property 22: Renames never collide in scope
//
// Property 22 (design "Correctness Properties"):
//   For any proposed replacement name that collides with an existing
//   identifier in the same scope, the finally applied name SHALL be unique
//   within that scope.
//
// **Validates: Requirements 6.4**
//
// Strategy: generate a non-test TypeScript source that
//   1. establishes a single dominant casing (camel / pascal / upper) for
//      value-kind declarations via sibling `const` declarations, and
//   2. *pre-declares* the exact natural replacement name the fixer would
//      otherwise choose - the descriptive base word (`value` / `item` /
//      `temporary` / `sample`) rendered in that dominant casing - so that the
//      fixer's first-choice name collides with an existing identifier, and
//   3. declares a placeholder identifier (`foo` / `bar` / `temp` / `test123`)
//      plus a usage.
//
// The fixer must therefore avoid the collision and apply a distinct,
// non-colliding identifier (Requirement 6.4). We read the applied name back
// out of the fixed source and assert it differs from every pre-existing
// identifier in scope, including the deliberately-planted colliding name.
//
// Casing styles are restricted to the three unambiguously distinguishable for
// the single-word base words the fixer emits: for a single word camelCase and
// snake_case both render as the same all-lowercase token, so snake is excluded
// to keep the planted collision exact rather than ambiguous.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { namingDetector, namingFixer } from '../detectors/naming';
import type { FileRecord } from '../types';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

type DistinguishableCasing = 'camel' | 'pascal' | 'upper';

/** The descriptive base word the fixer derives from each placeholder. */
const BASE_WORD_BY_PLACEHOLDER: Readonly<Record<string, string>> = {
  foo: 'value',
  bar: 'item',
  temp: 'temporary',
  test123: 'sample',
};

function tsRecord(content: string, path = 'src/sample.ts'): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: 'typescript',
  };
}

/** Render a lowercase word in the requested casing, mirroring the fixer. */
function applyCasing(word: string, casing: DistinguishableCasing): string {
  const lower = word.toLowerCase();
  switch (casing) {
    case 'camel':
      return lower;
    case 'pascal':
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    case 'upper':
      return lower.toUpperCase();
  }
}

/** A distinct sibling value declaration that sets the dominant casing. */
function renderSibling(casing: DistinguishableCasing, index: number): string {
  switch (casing) {
    case 'camel':
      return `columnIndex${index}`;
    case 'pascal':
      return `ColumnIndex${index}`;
    case 'upper':
      return `COLUMN_INDEX_${index}`;
  }
}

/** Extract the renamed placeholder declaration's new identifier name. */
function renamedDeclarationName(fixedContent: string): string | null {
  // The placeholder is the only declaration initialized to the sentinel `0`.
  const match = /let\s+(\w+)\s*=\s*0\s*;/.exec(fixedContent);
  return match ? match[1] : null;
}

/** Every identifier token appearing in `content`. */
function identifiersIn(content: string): Set<string> {
  const names = new Set<string>();
  const token = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(content)) !== null) {
    names.add(match[0]);
  }
  return names;
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
// Property 22.
// ---------------------------------------------------------------------------

describe('Property 22: Renames never collide in scope', () => {
  it('applies a distinct name when the natural replacement is already declared', () => {
    fc.assert(
      fc.property(
        placeholderArb,
        casingArb,
        siblingCountArb,
        (placeholder, casing, siblingCount) => {
          // The exact name the fixer would pick if there were no collision.
          const baseWord = BASE_WORD_BY_PLACEHOLDER[placeholder];
          const collidingName = applyCasing(baseWord, casing);

          // Sibling declarations establish the dominant casing for the
          // value kind; the colliding name shares that casing so the fixer's
          // majority-casing computation yields exactly `collidingName`.
          const siblingLines: string[] = [];
          for (let i = 1; i <= siblingCount; i += 1) {
            siblingLines.push(`const ${renderSibling(casing, i)} = ${i};`);
          }

          const content =
            `${siblingLines.join('\n')}\n` +
            `const ${collidingName} = 99;\n` +
            `let ${placeholder} = 0;\n` +
            `${placeholder} = ${placeholder} + 1;\n`;

          const record = tsRecord(content);

          // Sanity: the planted collider must be a pre-existing identifier.
          expect(identifiersIn(content).has(collidingName)).toBe(true);

          // The detector must flag the placeholder as auto-fixable.
          const finding = namingDetector
            .detect([record])
            .find((f) => f.kind === 'placeholder-identifier' && f.autoFixable);
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

          // Read the applied replacement name back from the fixed source.
          const newName = renamedDeclarationName(fixedContent);
          expect(
            newName,
            `expected a renamed declaration in:\n${fixedContent}`,
          ).not.toBeNull();
          if (newName === null) return;

          // Core assertion (Requirement 6.4): the applied name must NOT be the
          // colliding identifier, and must be unique within the scope - i.e.
          // distinct from every identifier that pre-existed the rename.
          const preExisting = identifiersIn(content);
          preExisting.delete(placeholder); // the placeholder is the one removed

          expect(newName).not.toBe(collidingName);
          expect(
            preExisting.has(newName),
            `applied name '${newName}' collides with an existing identifier in:\n${fixedContent}`,
          ).toBe(false);

          // The applied name still derives from the descriptive base word, so
          // the collision was resolved by disambiguation rather than by
          // abandoning the descriptive rename.
          expect(newName.toLowerCase()).toContain(baseWord.toLowerCase());
        },
      ),
      { numRuns: 100 },
    );
  });
});
