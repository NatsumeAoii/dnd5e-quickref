// Feature: pre-ship-finalization, Property 40: Floating promises are handled
//
// Property 40 (design "Correctness Properties"):
//   For any floating promise, the fixer awaits it, returns it, or marks it
//   intentionally unhandled with an adjacent comment.
//
// This test exercises the text-based detector/fixer in
// `src/finalization/detectors/tsJsSafety.ts`:
//   - Standalone promise-returning call statements (`fetch(...)`,
//     `somethingAsync(...)`, `.then(...)` chains, `Promise.all(...)`) that are
//     NOT awaited, returned, assigned, `.catch`'d, or comment-annotated are
//     flagged as floating promises, and the fix inserts an adjacent
//     "intentionally unhandled" comment.
//   - The same calls that ARE awaited, returned, assigned, `.catch`'d, or
//     marked with an adjacent comment are NOT flagged.
//
// **Validates: Requirements 10.3**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  detectTsJsSafety,
  fixTsJsSafety,
  TS_JS_KINDS,
} from '../detectors/tsJsSafety';
import type { Finding, FileRecord, SourceLanguage } from '../types';

/**
 * Build a minimal FileRecord for a source string. The detector inspects only
 * `content` and `language`; the path determines the file extension so the
 * language gate (`isScriptLanguage`) is satisfied.
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

function floatingFindings(record: FileRecord): Finding[] {
  return detectTsJsSafety([record]).filter(
    (finding) => finding.kind === TS_JS_KINDS.floatingPromise,
  );
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

/** A short, valid lower-camel identifier (never a reserved keyword we skip). */
const identifierArb = fc
  .stringMatching(/^[a-z][a-zA-Z0-9]{0,8}$/)
  .filter(
    (name) =>
      ![
        'await',
        'return',
        'void',
        'yield',
        'const',
        'let',
        'var',
        'import',
        'export',
        'if',
        'for',
        'while',
        'switch',
      ].includes(name),
  );

/** Simple call arguments that never contain `=` or arrow functions. */
const argsArb = fc.constantFrom('', 'url', 'data', 'x', 'config', 'a, b');

const languageArb = fc.constantFrom<SourceLanguage>('typescript', 'javascript');

/**
 * A promise-returning call EXPRESSION (no trailing semicolon, no leading
 * keyword) whose textual shape the detector treats as promise-like.
 */
const promiseExprArb: fc.Arbitrary<string> = fc.oneof(
  // fetch(...)
  argsArb.map((args) => `fetch(${args})`),
  // somethingAsync(...)
  fc.record({ name: identifierArb, args: argsArb }).map(
    ({ name, args }) => `${name}Async(${args})`,
  ),
  // a `.then(...)` chain
  fc.record({ name: identifierArb, args: argsArb, cb: identifierArb }).map(
    ({ name, args, cb }) => `${name}(${args}).then(${cb})`,
  ),
  // Promise static combinators
  fc
    .record({
      method: fc.constantFrom('all', 'race', 'allSettled', 'any', 'resolve'),
      args: argsArb,
    })
    .map(({ method, args }) => `Promise.${method}(${args})`),
);

interface FloatingCase {
  readonly content: string;
  readonly language: SourceLanguage;
  readonly path: string;
  readonly statementLine: number;
}

/** A FLOATING (unhandled) promise statement embedded after a benign line. */
const floatingCaseArb: fc.Arbitrary<FloatingCase> = fc
  .record({ expr: promiseExprArb, language: languageArb, name: identifierArb })
  .map(({ expr, language, name }) => {
    // A benign preceding line ensures the line above the call is not a
    // comment-only line (which would suppress the finding).
    const content = `const ready = true;\n${expr};\n`;
    const ext = language === 'typescript' ? 'ts' : 'js';
    return {
      content,
      language,
      path: `src/${name}.${ext}`,
      statementLine: 2,
    };
  });

type HandledKind =
  | 'await'
  | 'return'
  | 'void'
  | 'const-assign'
  | 'reassign'
  | 'catch'
  | 'comment';

const handledKindArb = fc.constantFrom<HandledKind>(
  'await',
  'return',
  'void',
  'const-assign',
  'reassign',
  'catch',
  'comment',
);

interface HandledCase {
  readonly content: string;
  readonly language: SourceLanguage;
  readonly path: string;
}

/** A HANDLED promise statement that must NOT be flagged. */
const handledCaseArb: fc.Arbitrary<HandledCase> = fc
  .record({
    expr: promiseExprArb,
    language: languageArb,
    name: identifierArb,
    kind: handledKindArb,
  })
  .map(({ expr, language, name, kind }) => {
    let statement: string;
    switch (kind) {
      case 'await':
        statement = `await ${expr};`;
        break;
      case 'return':
        statement = `return ${expr};`;
        break;
      case 'void':
        statement = `void ${expr};`;
        break;
      case 'const-assign':
        statement = `const result = ${expr};`;
        break;
      case 'reassign':
        statement = `result = ${expr};`;
        break;
      case 'catch':
        statement = `${expr}.catch(onError);`;
        break;
      case 'comment':
        statement = `${expr}; // intentionally unhandled fire-and-forget`;
        break;
    }
    const ext = language === 'typescript' ? 'ts' : 'js';
    return {
      content: `const ready = true;\n${statement}\n`,
      language,
      path: `src/${name}.${ext}`,
    };
  });

// ---------------------------------------------------------------------------
// Properties.
// ---------------------------------------------------------------------------

describe('Property 40: Floating promises are handled', () => {
  it('flags an unhandled promise statement and the fix adds an "intentionally unhandled" comment', () => {
    fc.assert(
      fc.property(floatingCaseArb, ({ content, language, path, statementLine }) => {
        const record = codeRecord(content, language, path);

        // The detector reports exactly one floating-promise finding on the
        // unhandled call statement.
        const findings = floatingFindings(record);
        expect(findings.length).toBe(1);

        const finding = findings[0];
        expect(finding.domain).toBe('ts-js-safety');
        expect(finding.path).toBe(path);
        expect(finding.location.line).toBe(statementLine);

        // The fix marks it intentionally unhandled via an adjacent comment.
        const outcome = fixTsJsSafety(finding, record);
        expect(outcome.preserved).toBe(false);
        expect(outcome.edits.length).toBe(1);

        const edit = outcome.edits[0];
        expect(edit.kind).toBe('insert');
        expect(edit.text).toBeDefined();
        const text = edit.text as string;
        // The inserted line is a `//` comment...
        expect(text.trim().startsWith('//')).toBe(true);
        // ...marking the promise intentionally unhandled.
        expect(text.toLowerCase()).toContain('intentionally unhandled');
      }),
      { numRuns: 100 },
    );
  });

  it('does not flag promises that are awaited, returned, assigned, .catch-handled, or comment-annotated', () => {
    fc.assert(
      fc.property(handledCaseArb, ({ content, language, path }) => {
        const record = codeRecord(content, language, path);
        const findings = floatingFindings(record);
        expect(findings).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
