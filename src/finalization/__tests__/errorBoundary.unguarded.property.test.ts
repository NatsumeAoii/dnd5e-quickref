// Feature: pre-ship-finalization, Property 17: Unguarded boundary calls become guarded
//
// Property 17 (design "Correctness Properties"):
//   For any external, I/O, or async call lacking surrounding error handling,
//   the fixed output SHALL wrap it with handling that captures the failure and
//   prevents continuation with unknown or partially modified state.
//
// **Validates: Requirements 5.4**
//
// The ErrorBoundaryDetector flags external/I/O/async boundary calls (fetch,
// JSON.parse, fs.*, storage, XMLHttpRequest) that sit outside a `try` block and
// carry no chained `.catch(...)`. A standalone expression-statement call is
// auto-fixable: the fixer wraps it in a `try { ... } catch { ... }` guard so the
// failure is logged and execution cannot continue with unknown state, while the
// success path runs the original statement unchanged. A call whose result is
// consumed (assignment, declaration, or return) is NOT auto-fixable: wrapping it
// in a guard would move the bound name out of scope, so the detector marks it
// non-auto-fixable and the fixer preserves it with a recorded reason for a
// manual refactor.
//
// This test asserts both halves of the property:
//   1. Auto-fixable unguarded calls become wrapped in try/catch, and
//      re-detecting the fixed source finds the call guarded (zero findings).
//   2. Non-auto-fixable consumed calls are preserved with a reason and left
//      byte-for-byte unchanged.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  errorBoundaryDetector,
  errorBoundaryFixer,
  applyErrorBoundaryFix,
  KIND_UNGUARDED_BOUNDARY_CALL,
} from '../detectors/errorBoundary';
import type { FileRecord } from '../types';

/**
 * Build a minimal TypeScript FileRecord. The detector only inspects `content`
 * and `language`; the path is fixed and unused by the boundary-call logic.
 */
function tsRecord(content: string, path = 'src/boundary.ts'): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: 'typescript',
  };
}

/** Filters a detector's output down to unguarded-boundary-call findings. */
function unguardedFindings(record: FileRecord) {
  return errorBoundaryDetector
    .detect([record])
    .filter((f) => f.kind === KIND_UNGUARDED_BOUNDARY_CALL);
}

/**
 * Argument tokens that contain no quote, backslash, brace, or newline so they
 * never break the embedding source string or the lightweight scanner.
 */
const tokenArb = fc.stringMatching(/^[a-zA-Z0-9_/.-]{1,12}$/);

/** Simple identifier names used as call arguments / assignment targets. */
const identArb = fc.constantFrom('raw', 'data', 'payload', 'input', 'key');

/**
 * Generator for a standalone boundary-call expression statement (no trailing
 * `;`). Each shape is an unguarded external / I/O / async call whose result is
 * discarded, which the detector classifies as auto-fixable.
 */
const standaloneCallArb = fc.oneof(
  tokenArb.map((u) => `fetch('/${u}')`),
  identArb.map((id) => `JSON.parse(${id})`),
  fc.tuple(tokenArb, tokenArb).map(([k, v]) => `localStorage.setItem('${k}', '${v}')`),
  tokenArb.map((k) => `sessionStorage.removeItem('${k}')`),
  fc.tuple(tokenArb, identArb).map(([p, d]) => `writeFileSync('${p}', ${d})`),
  tokenArb.map((p) => `mkdirSync('${p}')`),
  fc.constant('new XMLHttpRequest()'),
);

/**
 * Generator for a boundary call whose result is consumed by an assignment,
 * declaration, or return. Wrapping such a statement in a guard would change the
 * binding scope, so the detector classifies it as non-auto-fixable.
 */
const consumedCallArb = fc.oneof(
  fc.tuple(identArb, identArb).map(([lhs, id]) => `const ${lhs} = JSON.parse(${id})`),
  fc.tuple(identArb, tokenArb).map(([lhs, u]) => `const ${lhs} = fetch('/${u}')`),
  fc.tuple(identArb, tokenArb).map(([lhs, k]) => `${lhs} = localStorage.getItem('${k}')`),
  tokenArb.map((u) => `return fetch('/${u}')`),
);

describe('Property 17: Unguarded boundary calls become guarded', () => {
  it('wraps auto-fixable unguarded calls in try/catch; re-detection finds them guarded', () => {
    fc.assert(
      fc.property(standaloneCallArb, (stmt) => {
        // A benign preceding statement terminates the prior statement so the
        // boundary call is scanned as its own standalone expression statement.
        const content = `init();\n${stmt};\n`;
        const record = tsRecord(content);

        // 1. Exactly one unguarded boundary call is detected, and it is
        //    auto-fixable (standalone, result discarded).
        const findings = unguardedFindings(record);
        expect(findings.length).toBe(1);
        expect(findings[0].autoFixable).toBe(true);

        // 2. The fixer emits a single in-place replace edit (not preserved).
        const outcome = errorBoundaryFixer.fix(findings[0], record);
        expect(outcome.preserved).toBe(false);
        expect(outcome.edits.length).toBe(1);
        expect(outcome.edits[0].kind).toBe('replace');
        expect(outcome.edits[0].path).toBe(record.path);

        // 3. Applying the fix wraps the original statement in a try/catch guard
        //    while preserving the success-path statement verbatim.
        const fixed = applyErrorBoundaryFix(content, findings[0]);
        expect(fixed).toContain('try {');
        expect(fixed).toContain('catch');
        expect(fixed).toContain(stmt);

        // 4. Re-detecting over the fixed source finds the call guarded: zero
        //    unguarded-boundary-call findings remain.
        const reFindings = unguardedFindings(tsRecord(fixed, record.path));
        expect(reFindings.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('preserves non-auto-fixable consumed calls with a recorded reason and no edits', () => {
    fc.assert(
      fc.property(consumedCallArb, (stmt) => {
        const content = `init();\n${stmt};\n`;
        const record = tsRecord(content);

        // 1. The consumed boundary call is detected but marked non-auto-fixable.
        const findings = unguardedFindings(record);
        expect(findings.length).toBe(1);
        expect(findings[0].autoFixable).toBe(false);

        // 2. The fixer preserves it with a non-empty reason and emits no edits.
        const outcome = errorBoundaryFixer.fix(findings[0], record);
        expect(outcome.preserved).toBe(true);
        expect(outcome.edits.length).toBe(0);
        expect(typeof outcome.preservationReason).toBe('string');
        expect((outcome.preservationReason ?? '').length).toBeGreaterThan(0);

        // 3. applyErrorBoundaryFix leaves the source byte-for-byte unchanged.
        const fixed = applyErrorBoundaryFix(content, findings[0]);
        expect(fixed).toBe(content);
      }),
      { numRuns: 100 },
    );
  });
});
