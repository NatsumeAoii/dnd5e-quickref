// Feature: pre-ship-finalization, Property 9: Symbols are removed exactly when unreferenced
//
// Property 9 (design "Correctness Properties"):
//   For any import, variable, or function, the fixer SHALL remove it if and
//   only if its reference count across all records is zero.
//
// **Validates: Requirements 3.3**
//
// Scope note: the "remove iff reference count is zero" invariant applies to the
// auto-fixable artifacts whose references are confined to their declaring file:
// local (non-exported) variables/functions and imported bindings. An *exported*
// symbol may be referenced by another module, so the fixer deliberately
// preserves it (Requirement 3.7 / Property 10) rather than removing it; that
// behavior-altering retention is covered by Property 10's test, not here. This
// test therefore generates local declarations and imports, and verifies the
// exact-iff removal behavior of the detect → fix pipeline. References are placed
// across a multi-record input set to honour the "across all records" framing —
// for file-local and imported symbols the total across records equals the count
// in their own file, since they are not reachable from other files.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  deadCodeDetector,
  deadCodeFixer,
  applyDeadCodeFix,
  DEAD_CODE_KINDS,
} from '../detectors/deadCode';
import type { FileRecord, Finding, SourceLanguage } from '../types';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Build a minimal FileRecord; the detector only reads `content`/`language`. */
function codeRecord(
  content: string,
  language: SourceLanguage,
  path: string,
): FileRecord {
  return { path, content, bytes: content.length, readError: null, language };
}

/** Count whole-identifier occurrences of `name` (identifier-aware boundaries). */
function countWord(text: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g');
  let count = 0;
  while (re.exec(text) !== null) {
    count++;
  }
  return count;
}

/** Words that must never be used as generated identifiers. */
const RESERVED: ReadonlySet<string> = new Set([
  'const',
  'let',
  'var',
  'function',
  'class',
  'return',
  'throw',
  'import',
  'export',
  'from',
  'default',
  'void',
  'null',
  'true',
  'false',
  'undefined',
  'typeof',
  'delete',
  'switch',
  'case',
  'break',
  'continue',
  'finally',
  'catch',
  'try',
  'while',
  'for',
  'console',
  'window',
  'document',
]);

/** A valid lowercase-initial identifier that is not a reserved word. */
const identifierArb = fc
  .stringMatching(/^[a-z][a-zA-Z0-9]{3,9}$/)
  .filter((s) => !RESERVED.has(s));

/** Both languages are inspected by the dead-code detector. */
const languageArb = fc.constantFrom<SourceLanguage>('typescript', 'javascript');

/** A second, unrelated record so references are evaluated "across all records". */
function neighbourRecord(language: SourceLanguage): FileRecord {
  const ext = language === 'typescript' ? 'ts' : 'js';
  return codeRecord(
    'export const unrelatedNeighbour = 1;\n',
    language,
    `src/neighbour.${ext}`,
  );
}

/** Pull the unreferenced-symbol/import finding for `name` from the record set. */
function findingsFor(
  records: readonly FileRecord[],
  path: string,
  kind: string,
  name: string,
): readonly Finding[] {
  return deadCodeDetector
    .detect(records)
    .filter(
      (f) =>
        f.path === path &&
        f.kind === kind &&
        f.detail.includes(`"${name}"`),
    );
}

// ===========================================================================
// Local variables and functions.
// ===========================================================================

type LocalKind = 'const' | 'let' | 'var' | 'function';

interface LocalCase {
  readonly name: string;
  readonly holder: string;
  readonly kind: LocalKind;
  readonly refCount: number;
  readonly language: SourceLanguage;
}

const localCaseArb: fc.Arbitrary<LocalCase> = fc
  .record({
    name: identifierArb,
    holder: identifierArb,
    kind: fc.constantFrom<LocalKind>('const', 'let', 'var', 'function'),
    refCount: fc.integer({ min: 0, max: 3 }),
    language: languageArb,
  })
  .filter(({ name, holder }) => name !== holder);

function buildLocalSource(c: LocalCase): string {
  const refs = Array.from({ length: c.refCount }, () => `  ${c.name};\n`).join(
    '',
  );
  const decl =
    c.kind === 'function'
      ? `function ${c.name}() {\n  return 1;\n}\n`
      : `${c.kind} ${c.name} = 1;\n`;
  // The holder is exported so it is never auto-removed; it carries the
  // references to the target symbol (0..N of them).
  return `export function ${c.holder}() {\n${refs}}\n\n${decl}`;
}

describe('Property 9: local variables and functions are removed exactly when unreferenced', () => {
  it('removes a local symbol iff its reference count across all records is zero', () => {
    fc.assert(
      fc.property(localCaseArb, (c) => {
        const ext = c.language === 'typescript' ? 'ts' : 'js';
        const path = `src/mod_${c.name}.${ext}`;
        const content = buildLocalSource(c);
        const target = codeRecord(content, c.language, path);
        const records = [target, neighbourRecord(c.language)];

        const findings = findingsFor(
          records,
          path,
          DEAD_CODE_KINDS.unreferencedSymbol,
          c.name,
        );

        if (c.refCount === 0) {
          // Reference count is zero ⇒ flagged and removed.
          expect(findings.length).toBe(1);

          const outcome = deadCodeFixer.fix(findings[0], target);
          expect(outcome.preserved).toBe(false);
          expect(outcome.edits.length).toBeGreaterThan(0);

          const fixed = applyDeadCodeFix(content, findings[0]);
          expect(fixed).not.toBe(content);
          // The symbol no longer appears anywhere in the file.
          expect(countWord(fixed, c.name)).toBe(0);
        } else {
          // Reference count is positive ⇒ not flagged, so never removed.
          expect(findings.length).toBe(0);
          // The symbol (declaration + references) is fully retained.
          expect(countWord(content, c.name)).toBe(1 + c.refCount);
        }
      }),
      { numRuns: 120 },
    );
  });
});

// ===========================================================================
// Imported bindings.
// ===========================================================================

interface ImportCase {
  readonly name: string;
  readonly holder: string;
  readonly refCount: number;
  readonly language: SourceLanguage;
}

const importCaseArb: fc.Arbitrary<ImportCase> = fc
  .record({
    name: identifierArb,
    holder: identifierArb,
    refCount: fc.integer({ min: 0, max: 3 }),
    language: languageArb,
  })
  .filter(({ name, holder }) => name !== holder);

function buildImportSource(c: ImportCase): string {
  const refs = Array.from({ length: c.refCount }, () => `  ${c.name};\n`).join(
    '',
  );
  return (
    `import { ${c.name} } from './dep';\n\n` +
    `export function ${c.holder}() {\n${refs}}\n`
  );
}

describe('Property 9: imported bindings are removed exactly when unreferenced', () => {
  it('removes an import iff its reference count across all records is zero', () => {
    fc.assert(
      fc.property(importCaseArb, (c) => {
        const ext = c.language === 'typescript' ? 'ts' : 'js';
        const path = `src/imp_${c.name}.${ext}`;
        const content = buildImportSource(c);
        const target = codeRecord(content, c.language, path);
        const records = [target, neighbourRecord(c.language)];

        const findings = findingsFor(
          records,
          path,
          DEAD_CODE_KINDS.unreferencedImport,
          c.name,
        );

        if (c.refCount === 0) {
          // Zero references ⇒ flagged and the import statement is removed.
          expect(findings.length).toBe(1);

          const outcome = deadCodeFixer.fix(findings[0], target);
          expect(outcome.preserved).toBe(false);
          expect(outcome.edits.length).toBeGreaterThan(0);

          const fixed = applyDeadCodeFix(content, findings[0]);
          expect(fixed).not.toBe(content);
          // The binding no longer appears: the import line is gone.
          expect(countWord(fixed, c.name)).toBe(0);
        } else {
          // Positive references ⇒ not flagged, so the import is retained.
          expect(findings.length).toBe(0);
          // Import declaration (1) plus the in-file references.
          expect(countWord(content, c.name)).toBe(1 + c.refCount);
        }
      }),
      { numRuns: 120 },
    );
  });
});
