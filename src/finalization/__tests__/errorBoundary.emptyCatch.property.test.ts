// Feature: pre-ship-finalization, Property 15: Empty catch blocks gain real handling
//
// Property 15 (design "Correctness Properties"):
//   For any empty catch block, the fixed catch body SHALL contain at least one
//   of: a log of the caught error with the attempted operation, a rethrow
//   preserving the cause, or a recovery path returning a defined fallback.
//
// **Validates: Requirements 5.1**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  errorBoundaryDetector,
  applyErrorBoundaryFix,
  KIND_EMPTY_CATCH,
} from '../detectors/errorBoundary';
import type { FileRecord, SourceLanguage } from '../types';

/**
 * Build a minimal FileRecord for a source string. The detector only inspects
 * `content` and `language`, so the path is fixed per generated case.
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
 * Extract the body text (between the catch `{` and its matching `}`) of the
 * first catch clause in `content`. Works on both empty and fixed (non-empty)
 * catch bodies. Returns null when no catch clause is present.
 */
function catchBody(content: string): string | null {
  const catchIndex = content.indexOf('catch');
  if (catchIndex === -1) return null;
  // Find the `{` that opens the catch body (skipping any `(param)` clause).
  const open = content.indexOf('{', catchIndex);
  if (open === -1) return null;
  // Match braces to find the closing `}` of the catch body.
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return content.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Whether a catch body performs at least one of the three forms of real
 * handling required by Requirement 5.1: a log call, a rethrow, or a recovery
 * path returning a fallback value. Comments alone do not count.
 */
function hasRealHandling(body: string, paramName: string): boolean {
  // Strip line and block comments so prose in the body cannot mask an
  // otherwise-empty handler.
  const code = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim();

  if (code === '') return false;

  const logs = /\b(?:console\s*\.\s*(?:error|warn|info|log|debug)|logger\s*\.\s*\w+)\s*\(/.test(
    code,
  );
  // A rethrow preserves the cause when it throws the bound error (or a wrapper
  // referencing it).
  const rethrows = new RegExp(`\\bthrow\\b[^;]*\\b${paramName}\\b`).test(code) || /\bthrow\b/.test(code);
  const recovers = /\breturn\b/.test(code);

  return logs || rethrows || recovers;
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

/** A valid JS/TS identifier used for function and catch-parameter names. */
const identifierArb = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,11}$/)
  .filter((s) => !['catch', 'try', 'function', 'return', 'throw'].includes(s));

/** The catch clause shape: bound parameter, bare `catch {}`, or whitespace-only body. */
const catchShapeArb = fc.constantFrom<'param' | 'bare' | 'spaced'>(
  'param',
  'bare',
  'spaced',
);

/** Whether the file is TypeScript or JavaScript (both are inspected). */
const languageArb = fc.constantFrom<SourceLanguage>('typescript', 'javascript');

/** Some innocuous work to place inside the try block. */
const tryBodyArb = fc.constantFrom(
  'doWork();',
  'const value = compute();\n    use(value);',
  'await load();',
  'JSON.parse(input);',
);

interface GeneratedCase {
  readonly content: string;
  readonly language: SourceLanguage;
  readonly path: string;
  readonly paramName: string;
}

const caseArb: fc.Arbitrary<GeneratedCase> = fc
  .record({
    fnName: identifierArb,
    paramName: identifierArb,
    shape: catchShapeArb,
    language: languageArb,
    tryBody: tryBodyArb,
  })
  .map(({ fnName, paramName, shape, language, tryBody }) => {
    const catchClause =
      shape === 'param'
        ? `catch (${paramName}) {\n  }`
        : shape === 'bare'
          ? `catch {\n  }`
          : `catch {\n      \n  }`;
    const content =
      `function ${fnName}() {\n` +
      `  try {\n` +
      `    ${tryBody}\n` +
      `  } ${catchClause}\n` +
      `}\n`;
    // When the catch omits a parameter the fixer binds the default `error`.
    const effectiveParam = shape === 'param' ? paramName : 'error';
    const ext = language === 'typescript' ? 'ts' : 'js';
    return {
      content,
      language,
      path: `src/${fnName}.${ext}`,
      paramName: effectiveParam,
    };
  });

// ---------------------------------------------------------------------------
// Property.
// ---------------------------------------------------------------------------

describe('Property 15: Empty catch blocks gain real handling', () => {
  it('replaces every empty catch body with real handling and leaves no empty catch behind', () => {
    fc.assert(
      fc.property(caseArb, ({ content, language, path, paramName }) => {
        const record = codeRecord(content, language, path);

        // Precondition: the detector finds exactly one empty-catch finding.
        const findings = errorBoundaryDetector
          .detect([record])
          .filter((f) => f.kind === KIND_EMPTY_CATCH);
        expect(findings.length).toBe(1);

        // Apply the fix for the empty-catch finding.
        const fixed = applyErrorBoundaryFix(content, findings[0]);

        // The fix must actually change the source.
        expect(fixed).not.toBe(content);

        // The fixed catch body must contain real handling (log / rethrow /
        // recovery), not merely comments or whitespace.
        const body = catchBody(fixed);
        expect(body).not.toBeNull();
        expect(hasRealHandling(body as string, paramName)).toBe(true);

        // The fixed body must reference the caught error binding, satisfying
        // "log of the caught error" form of handling.
        expect((body as string)).toContain(paramName);

        // Re-detecting over the fixed source finds no empty catch.
        const reFindings = errorBoundaryDetector
          .detect([codeRecord(fixed, language, path)])
          .filter((f) => f.kind === KIND_EMPTY_CATCH);
        expect(reFindings.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
