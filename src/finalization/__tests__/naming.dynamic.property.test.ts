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
// `FileRecord[]`. The test generates non-test JS/TS sources that contain a
// placeholder identifier (`foo`/`bar`/`temp`/`test123`, varied casing) which is
// reachable through a reference the fixer cannot rewrite without risking a
// change in observable behavior:
//   - a string-literal reference whose text equals the identifier name
//     (e.g. `obj['foo']` or a bare `'foo'` used as a dynamic key), or
//   - a member/property access (e.g. `obj.foo`).
//
// For every generated case the test feeds the record through detect -> fix and
// asserts that the fixer:
//   - returns `preserved: true`,
//   - records a non-empty `preservationReason`,
//   - emits no edits (the source is left byte-for-byte unchanged), and
//   - that the corresponding finding is reported as not auto-fixable.

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
  | 'string-bare-key'
  | 'member-access';

/**
 * Build a single-file source in which the placeholder `name` is reachable only
 * through a context the fixer must not rewrite.
 *
 * The detector surfaces a placeholder name only when it appears as a genuine
 * code token, so the string-based styles declare the placeholder in code AND
 * add a string-literal reference whose text equals the name (e.g.
 * `target['foo']`); that string reference is what makes the rename unsafe
 * (Requirement 6.5). The member-access style lets the placeholder appear solely
 * as a property reference (`target.foo`), which is likewise un-rewritable.
 */
function buildSource(style: RefStyle, name: string): string {
  switch (style) {
    case 'string-bracket-single':
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
    case 'string-bare-key':
      // A bare string literal whose text equals the identifier name, used as a
      // dynamic property key elsewhere: a string-based reference.
      return (
        `const ${name} = 1;\n` +
        `const key = '${name}';\n` +
        `function read(source) {\n` +
        `  return source[key] + ${name};\n` +
        `}\n`
      );
    case 'member-access':
      // target.foo — the placeholder appears only as a member/property access.
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
  'string-bare-key',
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
        // because its only references are dynamic / string / member-access.
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
        expect((outcome.preservationReason as string).length).toBeGreaterThan(
          0,
        );

        // No edits are produced: the source is left byte-for-byte unchanged.
        expect(outcome.edits.length).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
