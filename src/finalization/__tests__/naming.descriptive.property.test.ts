// Feature: pre-ship-finalization, Property 19: Placeholder identifiers are renamed to valid descriptive names
//
// Property 19 (design "Correctness Properties"):
//   For any identifier in a non-test file whose name case-insensitively matches
//   `foo`, `bar`, `temp`, or `test123`, the replacement name SHALL NOT be a
//   member of that set and SHALL be composed of one or more whole words
//   describing the identifier's role.
//
// **Validates: Requirements 6.1**
//
// This exercises `namingDetector` / `namingFixer` (and the exported `fixNaming`
// helper) from `src/finalization/detectors/naming.ts`. Both are pure functions
// over `FileRecord[]`. The test generates non-test JS/TS sources that declare a
// single placeholder identifier (in varied casing), feeds them through
// detect -> fix, applies the whole-file `replace` edit, and asserts the
// replacement name is a valid identifier, is not a placeholder
// (case-insensitive), and is composed only of word characters.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { namingDetector, namingFixer } from '../detectors/naming';
import type { FileRecord, FixOutcome, SourceLanguage } from '../types';

// ---------------------------------------------------------------------------
// Constants mirrored from the detector under test
// ---------------------------------------------------------------------------

/** The placeholder set, matched case-insensitively (Requirement 6.1). */
const PLACEHOLDER_NAMES = ['foo', 'bar', 'temp', 'test123'] as const;

/** A valid JS/TS identifier per the language spec subset used by the toolkit. */
const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** "Composed of word characters" — letters, digits, and underscore only. */
const WORD_CHARACTERS_ONLY = /^\w+$/;

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

/**
 * Extract the whole-file `replace` edit a naming fix emits and return its new
 * content, or `null` when no such edit is present.
 */
function applyWholeFileReplace(
  record: FileRecord,
  outcome: FixOutcome,
): string | null {
  const edit = outcome.edits.find(
    (e) =>
      e.kind === 'replace' && e.path === record.path && e.range === undefined,
  );
  return edit && edit.text !== undefined ? edit.text : null;
}

function isPlaceholder(name: string): boolean {
  return (PLACEHOLDER_NAMES as readonly string[]).includes(name.toLowerCase());
}

type DeclKind = 'const' | 'let' | 'var' | 'function' | 'class';

/** Build a single-declaration source plus a non-member, non-string reference. */
function buildSource(kind: DeclKind, name: string): string {
  switch (kind) {
    case 'const':
    case 'let':
    case 'var':
      return (
        `${kind} ${name} = 1;\n` +
        `function consume() {\n` +
        `  return ${name} + ${name};\n` +
        `}\n`
      );
    case 'function':
      return (
        `function ${name}() {\n` + `  return 1;\n` + `}\n` + `const sink = ${name}();\n`
      );
    case 'class':
      return `class ${name} {}\n` + `const instance = new ${name}();\n`;
  }
}

/** Locate the renamed declaration's new identifier in the fixed source. */
function extractRenamedName(kind: DeclKind, fixed: string): string | null {
  let match: RegExpExecArray | null = null;
  if (kind === 'function') {
    match = /function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(fixed);
  } else if (kind === 'class') {
    match = /class\s+([A-Za-z_$][\w$]*)/.exec(fixed);
  } else {
    match = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*1;/.exec(fixed);
  }
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Vary the casing of a placeholder base while preserving the case-insensitive match. */
function casingVariants(base: string): readonly string[] {
  const lower = base.toLowerCase();
  const upper = base.toUpperCase();
  const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [lower, upper, capitalized];
}

const placeholderNameArb: fc.Arbitrary<string> = fc
  .constantFrom(...PLACEHOLDER_NAMES)
  .chain((base) => fc.constantFrom(...casingVariants(base)));

const declKindArb: fc.Arbitrary<DeclKind> = fc.constantFrom(
  'const',
  'let',
  'var',
  'function',
  'class',
);

const languageArb: fc.Arbitrary<SourceLanguage> = fc.constantFrom(
  'typescript',
  'javascript',
);

interface GeneratedCase {
  readonly content: string;
  readonly language: SourceLanguage;
  readonly path: string;
  readonly kind: DeclKind;
}

const caseArb: fc.Arbitrary<GeneratedCase> = fc
  .record({
    name: placeholderNameArb,
    kind: declKindArb,
    language: languageArb,
    fileStem: fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
  })
  .map(({ name, kind, language, fileStem }) => {
    const ext = language === 'typescript' ? 'ts' : 'js';
    return {
      content: buildSource(kind, name),
      language,
      // Non-test path: outside __tests__ and without a .test/.spec suffix.
      path: `src/${fileStem}.${ext}`,
      kind,
    };
  });

// ---------------------------------------------------------------------------
// Property 19
// ---------------------------------------------------------------------------

describe('Property 19: Placeholder identifiers are renamed to valid descriptive names', () => {
  it('renames every placeholder identifier to a valid, non-placeholder, word-only name', () => {
    fc.assert(
      fc.property(caseArb, ({ content, language, path, kind }) => {
        const record = makeRecord(path, content, language);

        // Detection surfaces exactly one auto-fixable placeholder finding.
        const findings = namingDetector
          .detect([record])
          .filter((f) => f.domain === 'naming');
        expect(findings.length).toBe(1);
        const finding = findings[0];
        expect(finding.autoFixable).toBe(true);

        // The fixer performs a real rename, not a preservation.
        const outcome = namingFixer.fix(finding, record);
        expect(outcome.preserved).toBe(false);

        const fixed = applyWholeFileReplace(record, outcome);
        expect(fixed).not.toBeNull();

        // Recover the replacement name from the rewritten declaration.
        const replacement = extractRenamedName(kind, fixed as string);
        expect(replacement).not.toBeNull();
        const name = replacement as string;

        // (a) It is a valid identifier.
        expect(VALID_IDENTIFIER.test(name)).toBe(true);

        // (b) It is not a member of the placeholder set (case-insensitive).
        expect(isPlaceholder(name)).toBe(false);

        // (c) It is composed solely of word characters (whole words).
        expect(WORD_CHARACTERS_ONLY.test(name)).toBe(true);

        // Re-detecting the fixed source finds no remaining placeholder.
        const reFindings = namingDetector
          .detect([makeRecord(path, fixed as string, language)])
          .filter((f) => f.domain === 'naming');
        expect(reFindings.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
