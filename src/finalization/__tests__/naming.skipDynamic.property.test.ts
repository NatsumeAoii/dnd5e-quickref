// Feature: pre-ship-finalization, Property 23: Dynamically-referenced identifiers are skipped with a reason
//
// Property 23 (design "Correctness Properties"):
//   For any identifier that has a dynamic or string-based reference that cannot
//   be updated without altering observable behavior, the identifier SHALL be
//   left unchanged and a skip reason SHALL be recorded.
//
// **Validates: Requirements 6.5**
//
// This exercises `namingDetector` / `namingFixer` from
// `src/finalization/detectors/naming.ts`. Both are pure functions over
// `FileRecord[]`. The test generates non-test JS/TS sources that declare a
// placeholder identifier (`foo`/`bar`/`temp`/`test123`, varied casing) and then
// reference it through a context the fixer cannot rewrite safely:
//   - a string-literal reference whose text equals the identifier name
//     (e.g. `obj['foo']`, or a bare string `'foo'`), or
//   - a member-access reference (e.g. `obj.foo`).
//
// For each generated case the test feeds the record through detect -> fix and
// asserts the fixer:
//   - returns `preserved: true`,
//   - records a non-empty `preservationReason`,
//   - emits no edits (the identifier is left unchanged), and
//   - the corresponding finding is marked not auto-fixable.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { namingDetector, namingFixer } from '../detectors/naming';
import type { FileRecord, SourceLanguage } from '../types';

// ---------------------------------------------------------------------------
// Constants mirrored from the detector under test
// ---------------------------------------------------------------------------

/** The placeholder set, matched case-insensitively (Requirement 6.1). */
const PLACEHOLDER_NAMES = ['foo', 'bar', 'temp', 'test123'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  path: string,
  content: string,
  language: SourceLanguage,
): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language,
  };
}

/** Vary the casing of a placeholder base while preserving the match. */
function casingVariants(base: string): readonly string[] {
  const lower = base.toLowerCase();
  const upper = base.toUpperCase();
  const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [lower, upper, capitalized];
}

// ---------------------------------------------------------------------------
// Reference-style generators
// ---------------------------------------------------------------------------

type RefStyle =
  | 'string-bracket-single'
  | 'string-bracket-double'
  | 'string-bare'
  | 'member-access';

/**
 * Build a single-file source where the placeholder `name` is referenced through
 * a context the fixer must not rewrite. The detector only surfaces placeholder
 * names that appear as genuine code tokens, so the string-based cases declare
 * the placeholder in code AND add a string-literal reference whose text equals
 * the name (e.g. `obj['foo']`); that string reference makes the rename unsafe
 * (Requirement 6.5). The member-access case lets the placeholder appear solely
 * as a property reference (`obj.foo`), which is likewise un-rewritable.
 */
function buildSource(style: RefStyle, name: string): string {
  switch (style) {
    case 'string-bracket-single':
      // Declared in code, but also read via obj['foo'] string-literal access.
      return (
        `const ${name} = 1;\n` +
        `const target = {};\n` +
        `function read() {\n` +
        `  return target['${name}'] + ${name};\n` +
        `}\n`
      );
    case 'string-bracket-double':
      return (
        `const ${name} = 1;\n` +
        `const target = {};\n` +
        `function read() {\n` +
        `  return target["${name}"] + ${name};\n` +
        `}\n`
      );
    case 'string-bare':
      // A bare string literal whose text equals the identifier name: a
      // dynamic/string-based reference used as a property key elsewhere.
      return (
        `const ${name} = 1;\n` +
        `const key = '${name}';\n` +
        `function read(source) {\n` +
        `  return source[key] + ${name};\n` +
        `}\n`
      );
    case 'member-access':
      // obj.foo — the placeholder appears only as a member/property reference.
      return (
        `const target = {};\n` +
        `function read() {\n` +
        `  return target.${name};\n` +
        `}\n`
      );
  }
}

const placeholderNameArb: fc.Arbitrary<string> = fc
  .constantFrom(...PLACEHOLDER_NAMES)
  .chain((base) => fc.constantFrom(...casingVariants(base)));

const refStyleArb: fc.Arbitrary<RefStyle> = fc.constantFrom(
  'string-bracket-single',
  'string-bracket-double',
  'string-bare',
  'member-access',
);

const languageArb: fc.Arbitrary<SourceLanguage> = fc.constantFrom(
  'typescript',
  'javascript',
);

interface GeneratedCase {
  readonly content: string;
  readonly language: SourceLanguage;
  readonly path: string;
  readonly name: string;
}

const caseArb: fc.Arbitrary<GeneratedCase> = fc
  .record({
    name: placeholderNameArb,
    style: refStyleArb,
    language: languageArb,
    fileStem: fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
  })
  .map(({ name, style, language, fileStem }) => {
    const ext = language === 'typescript' ? 'ts' : 'js';
    return {
      content: buildSource(style, name),
      language,
      // Non-test path: outside __tests__ and without a .test/.spec suffix.
      path: `src/${fileStem}.${ext}`,
      name,
    };
  });

// ---------------------------------------------------------------------------
// Property 23
// ---------------------------------------------------------------------------

describe('Property 23: Dynamically-referenced identifiers are skipped with a reason', () => {
  it('leaves dynamically/string-referenced placeholders unchanged and records a skip reason', () => {
    fc.assert(
      fc.property(caseArb, ({ content, language, path }) => {
        const record = makeRecord(path, content, language);

        // The detector surfaces the placeholder, but marks it not auto-fixable
        // because the only references are dynamic / string / member-access.
        const findings = namingDetector
          .detect([record])
          .filter((f) => f.domain === 'naming');
        expect(findings.length).toBe(1);
        const finding = findings[0];
        expect(finding.autoFixable).toBe(false);

        // The fixer preserves the identifier and records why it was skipped.
        const outcome = namingFixer.fix(finding, record);

        expect(outcome.preserved).toBe(true);
        expect(outcome.preservationReason).toBeDefined();
        expect((outcome.preservationReason as string).length).toBeGreaterThan(0);

        // No edits are produced: the source is left byte-for-byte unchanged.
        expect(outcome.edits.length).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
