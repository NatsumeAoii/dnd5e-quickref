// Feature: pre-ship-finalization, Property 19: Placeholder identifiers are renamed to valid descriptive names
//
// Property 19 (Requirement 6.1):
//   For any identifier in a non-test file whose name case-insensitively matches
//   `foo`, `bar`, `temp`, or `test123`, the replacement name SHALL NOT be a
//   member of that set and SHALL be composed of one or more whole words
//   describing the identifier's role.
//
// **Validates: Requirements 6.1**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { detectNaming, fixNaming } from '../detectors/naming';
import type { Edit, FileRecord, SourceLanguage } from '../types';

// ---------------------------------------------------------------------------
// Domain facts mirrored from the specification (Requirement 6.1).
// ---------------------------------------------------------------------------

/** The placeholder set, matched case-insensitively. */
const PLACEHOLDER_NAMES = ['foo', 'bar', 'temp', 'test123'];

/**
 * The descriptive base words the toolkit uses to build replacement names. A
 * valid replacement, after stripping casing separators and any uniqueness
 * suffix, must reduce to one of these whole words - never to gibberish and
 * never back into the placeholder set.
 */
const DESCRIPTIVE_WORDS = ['value', 'item', 'temporary', 'sample'];

const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isPlaceholder(name: string): boolean {
  return PLACEHOLDER_NAMES.includes(name.toLowerCase());
}

/**
 * Reduce a replacement identifier to its alphabetic word core: drop any
 * casing separators (`_`) and any trailing numeric uniqueness suffix, then
 * lowercase. `temporary_2` -> `temporary`, `Item3` -> `item`.
 */
function wordCore(name: string): string {
  return name.replace(/[_$]/g, '').replace(/[0-9]+$/, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function codeRecord(
  content: string,
  language: SourceLanguage,
  path: string,
): FileRecord {
  return { path, content, bytes: content.length, readError: null, language };
}

/** The single whole-file replacement edit a successful rename produces. */
function replacementContent(edits: readonly Edit[]): string | null {
  const replace = edits.find((edit) => edit.kind === 'replace');
  return replace?.text ?? null;
}

/**
 * Extract the renamed identifier from the declaration site in `content`.
 * The generated templates always declare the placeholder with one of these
 * keywords, so the first match is the renamed binding.
 */
function declaredName(content: string): string | null {
  const match = content.match(
    /\b(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
  );
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

const languageArb = fc.constantFrom<SourceLanguage>('typescript', 'javascript');

/**
 * A placeholder name in a mix of casings so the case-insensitive match
 * (Requirement 6.1) is exercised: foo, FOO, Foo, Temp, TEST123, etc.
 */
const placeholderArb: fc.Arbitrary<string> = fc
  .constantFrom(...PLACEHOLDER_NAMES)
  .chain((base) =>
    fc.constantFrom<'lower' | 'upper' | 'capitalized'>(
      'lower',
      'upper',
      'capitalized',
    ).map((mode) => {
      switch (mode) {
        case 'lower':
          return base;
        case 'upper':
          return base.toUpperCase();
        case 'capitalized':
          return base.charAt(0).toUpperCase() + base.slice(1);
      }
    }),
  );

/** The declaration form, which drives the identifier kind / casing choice. */
const declarationArb = fc.constantFrom<'const' | 'let' | 'var' | 'function' | 'class'>(
  'const',
  'let',
  'var',
  'function',
  'class',
);

/** A non-test file path so the detector does not skip the file. */
const pathArb = (language: SourceLanguage) =>
  fc
    .stringMatching(/^[a-z][a-z0-9]{2,9}$/)
    .map((base) => `src/${base}.${language === 'typescript' ? 'ts' : 'js'}`);

interface GeneratedCase {
  readonly content: string;
  readonly language: SourceLanguage;
  readonly path: string;
  readonly placeholder: string;
}

/**
 * Build a fixable case: the placeholder is declared and then statically
 * referenced (no member access, no string reference), so the fixer renames it
 * rather than preserving it (Requirements 6.2, 6.5).
 */
const caseArb: fc.Arbitrary<GeneratedCase> = languageArb.chain((language) =>
  fc
    .record({
      placeholder: placeholderArb,
      declaration: declarationArb,
      refCount: fc.integer({ min: 1, max: 4 }),
      path: pathArb(language),
    })
    .map(({ placeholder, declaration, refCount, path }) => {
      let content: string;
      if (declaration === 'function') {
        const calls = Array.from(
          { length: refCount },
          () => `  ${placeholder}();`,
        ).join('\n');
        content = `function ${placeholder}() {\n  return 1;\n}\n${calls}\n`;
      } else if (declaration === 'class') {
        const uses = Array.from(
          { length: refCount },
          () => `  new ${placeholder}();`,
        ).join('\n');
        content = `class ${placeholder} {\n  run() {\n    return 1;\n  }\n}\n${uses}\n`;
      } else {
        // Declare the placeholder as the first declaration in the file so the
        // test's `declaredName` helper reads the renamed binding, then add
        // static references to make the identifier renameable.
        const uses = Array.from(
          { length: refCount },
          (_unused, index) => `total = total + ${placeholder} + ${index};`,
        ).join('\n');
        content =
          `${declaration} ${placeholder} = 1;\n` +
          `let total = 0;\n` +
          `${uses}\n`;
      }
      return { content, language, path, placeholder };
    }),
);

// ---------------------------------------------------------------------------
// Property.
// ---------------------------------------------------------------------------

describe('Property 19: Placeholder identifiers are renamed to valid descriptive names', () => {
  it('renames placeholder identifiers to a valid, non-placeholder, word-composed name', () => {
    fc.assert(
      fc.property(caseArb, ({ content, language, path, placeholder }) => {
        const record = codeRecord(content, language, path);

        // Precondition: the detector flags exactly this placeholder identifier
        // as an auto-fixable rename target.
        const findings = detectNaming([record]).filter(
          (finding) => finding.kind === 'placeholder-identifier',
        );
        expect(findings.length).toBe(1);
        expect(findings[0].autoFixable).toBe(true);

        // Apply the fix.
        const outcome = fixNaming(findings[0], record);
        expect(outcome.preserved).toBe(false);

        const newContent = replacementContent(outcome.edits);
        expect(newContent).not.toBeNull();

        // The original placeholder token is gone from the declaration site.
        const replacement = declaredName(newContent as string);
        expect(replacement).not.toBeNull();
        const renamed = replacement as string;

        // (a) The replacement is a syntactically valid identifier.
        expect(VALID_IDENTIFIER.test(renamed)).toBe(true);

        // (b) The replacement is not a member of the placeholder set
        //     (case-insensitive).
        expect(isPlaceholder(renamed)).toBe(false);
        expect(renamed.toLowerCase()).not.toBe(placeholder.toLowerCase());

        // (c) The replacement is composed of one or more whole words: its
        //     alphabetic core reduces to a real descriptive word.
        expect(DESCRIPTIVE_WORDS).toContain(wordCore(renamed));

        // (d) After the rename the detector no longer reports a placeholder,
        //     confirming the placeholder name was fully replaced.
        const reFindings = detectNaming([
          codeRecord(newContent as string, language, path),
        ]).filter((finding) => finding.kind === 'placeholder-identifier');
        expect(reFindings.length).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
