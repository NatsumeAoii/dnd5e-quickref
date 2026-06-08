// Feature: pre-ship-finalization, Property 16: User-facing errors are sanitized while developer detail is retained
//
// Property 16 (design "Correctness Properties"):
//   For any error exposed to an end user with a raw stack trace, internal path,
//   or raw exception message, the fixed user-facing output SHALL contain none of
//   those raw details while a developer-facing log entry SHALL still contain the
//   original error detail.
//
// **Validates: Requirements 5.2, 5.3**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  errorBoundaryDetector,
  errorBoundaryFixer,
  applyErrorBoundaryFix,
  KIND_RAW_ERROR_EXPOSURE,
} from '../detectors/errorBoundary';
import type { FileRecord } from '../types';

/**
 * Build a minimal TypeScript FileRecord. The detector only inspects `content`
 * and `language`; the path is fixed.
 */
function tsRecord(content: string, path = 'src/handler.ts'): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: 'typescript',
  };
}

/**
 * Error-binding names the detector recognizes as carrying raw error detail
 * (matched as whole words by the detector's raw-exposure heuristic).
 */
const errorBindingArb = fc.constantFrom('error', 'err', 'exception');

/**
 * Accessor producing a raw stack trace or raw exception message. Restricted to
 * `.stack`/`.message` so the resulting expression (for example `error.stack`)
 * is a distinctive substring that does not collide with the `catch (error)`
 * binding text elsewhere in the source.
 */
const accessorArb = fc.constantFrom('.stack', '.message');

/** DOM text/markup sinks that render content to the end user. */
const sinkPropArb = fc.constantFrom('textContent', 'innerText', 'innerHTML', 'outerHTML');

/** Whether the user-facing exposure is a DOM sink or an alert() call. */
const exposureKindArb = fc.constantFrom('sink', 'alert');

/** alert flavor: bare `alert(...)` or `window.alert(...)`. */
const alertFormArb = fc.constantFrom('alert', 'window.alert');

/**
 * Builds a source file whose catch handler exposes a raw error expression to
 * the end user via the chosen sink/alert, wrapped in a neutrally-named function
 * so the derived sanitized message contains no error-related words.
 */
function buildSource(params: {
  binding: string;
  expr: string;
  kind: 'sink' | 'alert';
  sinkProp: string;
  alertForm: string;
}): string {
  const { binding, expr, kind, sinkProp, alertForm } = params;
  const exposureLine =
    kind === 'sink' ? `    el.${sinkProp} = ${expr};` : `    ${alertForm}(${expr});`;
  return (
    `function handleSubmit() {\n` +
    `  try {\n` +
    `    doWork();\n` +
    `  } catch (${binding}) {\n` +
    `${exposureLine}\n` +
    `  }\n` +
    `}\n`
  );
}

describe('Property 16: User-facing errors are sanitized while developer detail is retained', () => {
  it('removes raw error detail from the user-facing output while a developer log retains it', () => {
    fc.assert(
      fc.property(
        errorBindingArb,
        accessorArb,
        exposureKindArb,
        sinkPropArb,
        alertFormArb,
        (binding, accessor, kind, sinkProp, alertForm) => {
          const expr = `${binding}${accessor}`;
          const content = buildSource({ binding, expr, kind, sinkProp, alertForm });
          const record = tsRecord(content);

          // Precondition: the raw error expression is exposed to the user.
          expect(content).toContain(expr);

          // 1. The detector must flag a raw-error-exposure finding.
          const findings = errorBoundaryDetector
            .detect([record])
            .filter((f) => f.kind === KIND_RAW_ERROR_EXPOSURE);
          expect(findings.length).toBeGreaterThanOrEqual(1);

          // 2. The fixer must emit a real source rewrite (not a preservation).
          const outcome = errorBoundaryFixer.fix(findings[0], record);
          expect(outcome.preserved).toBe(false);
          expect(outcome.edits.length).toBeGreaterThanOrEqual(1);

          // 3. Apply the fix and split the result into the developer log line
          //    and the user-facing line.
          const fixed = applyErrorBoundaryFix(content, findings[0]);
          const lines = fixed.split('\n');

          const devLine = lines.find((l) => l.includes('console.error'));
          const userLine = lines.find(
            (l) =>
              l !== devLine &&
              (l.includes('alert(') ||
                /\.(?:textContent|innerText|innerHTML|outerHTML)\s*=/.test(l)),
          );

          // A developer-facing log entry SHALL still contain the original detail.
          expect(devLine).toBeDefined();
          expect(devLine).toContain(expr);

          // The user-facing output SHALL contain none of the raw details.
          expect(userLine).toBeDefined();
          expect(userLine).not.toContain(expr);
          expect(userLine).not.toMatch(/\.(?:stack|message)\b/);
          expect(userLine).not.toMatch(/\b(?:error|err|exception)\b/);

          // The user-facing output is a sanitized, human-readable message.
          expect(userLine).toContain('Could not complete');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('re-detecting the fixed source finds no raw-error-exposure', () => {
    fc.assert(
      fc.property(
        errorBindingArb,
        accessorArb,
        exposureKindArb,
        sinkPropArb,
        alertFormArb,
        (binding, accessor, kind, sinkProp, alertForm) => {
          const expr = `${binding}${accessor}`;
          const content = buildSource({ binding, expr, kind, sinkProp, alertForm });
          const record = tsRecord(content);

          const findings = errorBoundaryDetector
            .detect([record])
            .filter((f) => f.kind === KIND_RAW_ERROR_EXPOSURE);
          expect(findings.length).toBeGreaterThanOrEqual(1);

          const fixed = applyErrorBoundaryFix(content, findings[0]);

          // After sanitizing, no raw-error-exposure should remain in the file.
          const reFindings = errorBoundaryDetector
            .detect([tsRecord(fixed, record.path)])
            .filter((f) => f.kind === KIND_RAW_ERROR_EXPOSURE);
          expect(reFindings.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
