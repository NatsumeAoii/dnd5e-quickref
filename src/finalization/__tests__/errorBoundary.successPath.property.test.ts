// Feature: pre-ship-finalization, Property 18: Error-handling edits preserve success-path outputs
//
// Property 18 (design "Correctness Properties"):
//   For any error-handling modification, the success-path return values and
//   externally visible side effects SHALL be identical before and after the
//   modification.
//
// **Validates: Requirements 5.5**
//
// Per the design note, behavior-preservation properties compare pre/post parse
// trees rather than raw strings. This test parses the source with the
// TypeScript compiler API and compares a *success-path projection* of the AST
// before and after the fix.
//
// The success-path projection captures exactly what executes when no error is
// thrown: it flattens every `try` statement to its try-block statements (the
// catch body only runs on the error path, so it is excluded; a `finally` block,
// which runs on both paths, is kept). The projection is then re-printed through
// a single printer so formatting differences are normalized away. Two sources
// with identical projections execute identical success-path statements in the
// same order and therefore produce identical success-path return values and
// externally visible side effects.
//
// This single projection covers all three error-boundary fix kinds:
//   - empty-catch:             only the catch body changes -> projection equal.
//   - raw-error-exposure:      the exposure lives on the error path (a catch
//                              body) -> projection equal.
//   - unguarded-boundary-call: the unchanged call is wrapped in a new try, which
//                              the projection unwraps back to the original
//                              statement -> projection equal.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as ts from 'typescript';

import {
  errorBoundaryDetector,
  errorBoundaryFixer,
  applyErrorBoundaryFix,
  KIND_EMPTY_CATCH,
  KIND_RAW_ERROR_EXPOSURE,
  KIND_UNGUARDED_BOUNDARY_CALL,
} from '../detectors/errorBoundary';
import type { FileRecord, Finding } from '../types';

// ---------------------------------------------------------------------------
// Success-path projection (parse-tree comparison).
// ---------------------------------------------------------------------------

const printer = ts.createPrinter({ removeComments: true });

/**
 * Transformer that flattens every `try` statement into the statements that run
 * on the success path: the try-block statements (recursively flattened) plus a
 * `finally` block's statements when present. The catch clause is dropped
 * because it only executes on the error path.
 */
const flattenTryTransformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
  const visit: ts.Visitor = (node) => {
    const visited = ts.visitEachChild(node, visit, context);
    if (ts.isTryStatement(visited)) {
      const successStatements: ts.Statement[] = [...visited.tryBlock.statements];
      if (visited.finallyBlock) successStatements.push(...visited.finallyBlock.statements);
      return successStatements;
    }
    return visited;
  };
  return (sourceFile) => ts.visitNode(sourceFile, visit) as ts.SourceFile;
};

/**
 * Returns a normalized textual form of the success path of `source`. Whitespace
 * is collapsed so the comparison is structural, not formatting-sensitive.
 */
function successPathProjection(source: string): string {
  const sourceFile = ts.createSourceFile(
    'projection.ts',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const result = ts.transform(sourceFile, [flattenTryTransformer]);
  const transformed = result.transformed[0];
  const text = printer.printFile(transformed);
  result.dispose();
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function tsRecord(content: string, path = 'src/sample.ts'): FileRecord {
  return { path, content, bytes: content.length, readError: null, language: 'typescript' };
}

/**
 * Drive both the pure string fixer (`applyErrorBoundaryFix`) and the
 * edit-producing fixer (`errorBoundaryFixer`) for a single generated defect,
 * then assert the success-path projection is unchanged.
 */
function assertSuccessPathPreserved(content: string, expectedKind: string): void {
  const record = tsRecord(content);

  // The detector must flag the seeded defect.
  const finding: Finding | undefined = errorBoundaryDetector
    .detect([record])
    .find((f) => f.kind === expectedKind);
  expect(finding, `expected a '${expectedKind}' finding in:\n${content}`).toBeDefined();
  if (!finding) return;

  // The edit-producing fixer must agree the finding is auto-fixable here.
  const outcome = errorBoundaryFixer.fix(finding, record);
  expect(outcome.preserved).toBe(false);
  expect(outcome.edits.length).toBe(1);

  // Apply the behavior-preserving rewrite.
  const fixed = applyErrorBoundaryFix(content, finding);

  // The fix must actually change the source (otherwise the comparison is moot).
  expect(fixed).not.toBe(content);

  // The success-path projection must be byte-for-byte identical before/after.
  expect(successPathProjection(fixed)).toBe(successPathProjection(content));
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

/** Simple, side-effecting success-path statements that trigger no findings. */
const simpleStatementArb = fc.constantFrom(
  'doWork();',
  'counter += 1;',
  'state.ready = true;',
  'items.push(1);',
  'total = total + step;',
);

/** A short block of success-path statements. */
const successBodyArb = fc.array(simpleStatementArb, { minLength: 1, maxLength: 3 });

/** Optional trailing success-path statement after the try. */
const tailArb = fc.constantFrom('', 'return counter;', 'finish();');

/** Catch binding: a named parameter or an omitted (optional) binding. */
const paramArb = fc.constantFrom('error', 'err', 'e', '');

/** Catch binding that always names the error (needed to expose it). */
const namedParamArb = fc.constantFrom('error', 'err');

const indent = (lines: readonly string[], pad: string): string =>
  lines.map((l) => `${pad}${l}`).join('\n');

// ---------------------------------------------------------------------------
// Property 18.
// ---------------------------------------------------------------------------

describe('Property 18: Error-handling edits preserve success-path outputs', () => {
  it('empty-catch fixes leave the try-body and surrounding statements unchanged', () => {
    fc.assert(
      fc.property(paramArb, successBodyArb, tailArb, (param, body, tail) => {
        const catchClause = param === '' ? 'catch {' : `catch (${param}) {`;
        const tailLine = tail === '' ? '' : `\n  ${tail}`;
        const content =
          `function run() {\n` +
          `  try {\n` +
          `${indent(body, '    ')}\n` +
          `  } ${catchClause}\n` +
          `  }${tailLine}\n` +
          `}\n`;

        assertSuccessPathPreserved(content, KIND_EMPTY_CATCH);
      }),
      { numRuns: 100 },
    );
  });

  it('raw-error-exposure fixes change only the error path, not the success path', () => {
    const exposureExprArb = fc.constantFrom('.message', '.stack', '');
    const exposureKindArb = fc.constantFrom<'sink' | 'alert'>('sink', 'alert');

    fc.assert(
      fc.property(
        namedParamArb,
        exposureExprArb,
        exposureKindArb,
        successBodyArb,
        tailArb,
        (param, accessor, kind, body, tail) => {
          const errorExpr = `${param}${accessor}`;
          const exposure =
            kind === 'alert' ? `alert(${errorExpr});` : `el.textContent = ${errorExpr};`;
          const tailLine = tail === '' ? '' : `\n  ${tail}`;
          const content =
            `function show() {\n` +
            `  try {\n` +
            `${indent(body, '    ')}\n` +
            `  } catch (${param}) {\n` +
            `    ${exposure}\n` +
            `  }${tailLine}\n` +
            `}\n`;

          assertSuccessPathPreserved(content, KIND_RAW_ERROR_EXPOSURE);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('unguarded-call fixes wrap the call without altering the executed success path', () => {
    const boundaryCallArb = fc.constantFrom(
      'fetch(endpoint);',
      'localStorage.setItem(key, value);',
      'writeFileSync(path, data);',
      'sessionStorage.removeItem(key);',
    );

    fc.assert(
      fc.property(
        fc.array(simpleStatementArb, { minLength: 0, maxLength: 2 }),
        boundaryCallArb,
        fc.array(simpleStatementArb, { minLength: 0, maxLength: 2 }),
        tailArb,
        (pre, call, post, tail) => {
          const lines: string[] = [...pre, call, ...post];
          if (tail !== '') lines.push(tail);
          const content = `function load() {\n${indent(lines, '  ')}\n}\n`;

          assertSuccessPathPreserved(content, KIND_UNGUARDED_BOUNDARY_CALL);
        },
      ),
      { numRuns: 100 },
    );
  });
});
