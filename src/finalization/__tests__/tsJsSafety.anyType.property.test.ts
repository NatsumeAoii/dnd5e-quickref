// Feature: pre-ship-finalization, Property 38: Unjustified `any` is typed or annotated
//
// Property 38 (design "Correctness Properties"):
//   For any `any` type without an adjacent justifying comment, the fixer types
//   it or adds an adjacent comment stating why a precise type is unavailable.
//   Conversely, an `any` that already carries an adjacent justifying comment is
//   not flagged.
//
// **Validates: Requirements 10.1**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  detectTsJsSafety,
  fixTsJsSafety,
  TS_JS_KINDS,
} from '../detectors/tsJsSafety';
import type { Edit, FileRecord, SourceLanguage } from '../types';

/**
 * Build a minimal FileRecord for a source string. The detector inspects
 * `content` and `language` only, so the path is fixed per generated case.
 */
function codeRecord(
  content: string,
  language: SourceLanguage,
  path: string,
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
 * Apply an `insert` edit that adds a comment line above its target line. The
 * fixer's edit text is an indented `// ...\n` line inserted before `range.line`
 * (1-based). Returns the resulting source so it can be re-scanned.
 */
function applyInsertAbove(content: string, edit: Edit): string {
  const line = edit.range?.line ?? 1;
  const insertText = (edit.text ?? '').replace(/\n$/, '');
  const lines = content.split('\n');
  lines.splice(line - 1, 0, insertText);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

/** A valid JS/TS identifier that is not a reserved word used in templates. */
const identifierArb = fc
  .stringMatching(/^[a-z][a-zA-Z0-9]{0,10}$/)
  .filter((s) => !['let', 'const', 'var', 'function', 'as', 'any'].includes(s));

/** Both inspected script languages. `any` is a TS concept but the text scanner
 *  treats `.ts`/`.js` uniformly, so either extension is valid input. */
const languageArb = fc.constantFrom<SourceLanguage>('typescript', 'javascript');

/**
 * Each template places exactly one `any` in a distinct type position that the
 * detector recognizes: annotation (`: any`), assertion (`as any`), array
 * (`any[]`), parameter annotation, union (`| any`), and generic argument
 * (`<any`).
 */
const typePositionTemplates: ReadonlyArray<(id: string) => string> = [
  (id) => `let ${id}: any;`,
  (id) => `const ${id} = value as any;`,
  (id) => `let ${id}: any[];`,
  (id) => `function use_${id}(${id}: any) { return ${id}; }`,
  (id) => `let ${id}: string | any;`,
  (id) => `let ${id}: Record<any, string>;`,
];

const templateArb = fc.constantFrom(...typePositionTemplates);

interface UnjustifiedCase {
  readonly content: string;
  readonly language: SourceLanguage;
  readonly path: string;
}

/** A single `any` in type position with no adjacent justifying comment. */
const unjustifiedArb: fc.Arbitrary<UnjustifiedCase> = fc
  .record({ id: identifierArb, template: templateArb, language: languageArb })
  .map(({ id, template, language }) => {
    const ext = language === 'typescript' ? 'ts' : 'js';
    return {
      content: `${template(id)}\n`,
      language,
      path: `src/${id}.${ext}`,
    };
  });

/** How a justifying comment is attached to an `any` usage. */
const justificationArb = fc.constantFrom<'trailing' | 'above'>(
  'trailing',
  'above',
);

/** A single `any` in type position that already carries a justifying comment. */
const justifiedArb: fc.Arbitrary<UnjustifiedCase> = fc
  .record({
    id: identifierArb,
    template: templateArb,
    language: languageArb,
    placement: justificationArb,
  })
  .map(({ id, template, language, placement }) => {
    const ext = language === 'typescript' ? 'ts' : 'js';
    const line = template(id);
    const reason = 'third-party value has no precise type available here';
    const content =
      placement === 'trailing'
        ? `${line} // ${reason}\n`
        : `// ${reason}\n${line}\n`;
    return { content, language, path: `src/${id}.${ext}` };
  });

// ---------------------------------------------------------------------------
// Properties.
// ---------------------------------------------------------------------------

describe('Property 38: Unjustified `any` is typed or annotated', () => {
  it('flags an unjustified `any` and the fix inserts an adjacent justifying comment', () => {
    fc.assert(
      fc.property(unjustifiedArb, ({ content, language, path }) => {
        const record = codeRecord(content, language, path);

        // The detector finds exactly one unjustified `any`.
        const findings = detectTsJsSafety([record]).filter(
          (f) => f.kind === TS_JS_KINDS.anyType,
        );
        expect(findings.length).toBe(1);
        expect(findings[0].path).toBe(path);

        // The fixer produces an `insert` edit that adds a comment stating why a
        // precise type is unavailable, without introducing a placeholder.
        const outcome = fixTsJsSafety(findings[0], record);
        expect(outcome.preserved).toBe(false);
        expect(outcome.edits.length).toBe(1);

        const edit = outcome.edits[0];
        expect(edit.kind).toBe('insert');
        expect(edit.placeholderInserted).toBe(false);
        const text = edit.text ?? '';
        expect(text).toMatch(/\/\//); // it is a comment
        expect(text.toLowerCase()).toContain('reason');

        // Applying the inserted comment resolves the finding: re-scanning the
        // annotated source flags no unjustified `any`.
        const annotated = applyInsertAbove(content, edit);
        const reFindings = detectTsJsSafety([
          codeRecord(annotated, language, path),
        ]).filter((f) => f.kind === TS_JS_KINDS.anyType);
        expect(reFindings.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('does not flag an `any` that already carries an adjacent justifying comment', () => {
    fc.assert(
      fc.property(justifiedArb, ({ content, language, path }) => {
        const record = codeRecord(content, language, path);
        const findings = detectTsJsSafety([record]).filter(
          (f) => f.kind === TS_JS_KINDS.anyType,
        );
        expect(findings.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
