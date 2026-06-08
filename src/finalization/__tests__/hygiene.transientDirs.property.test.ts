// Feature: pre-ship-finalization, Property 26: Transient directory rules are present and idempotent
//
// Property 26 (design "Correctness Properties"):
//   For any `.gitignore` missing an arbitrary subset of `dev/`, `temp/`,
//   `tmp/`, `scratch/`, the fixed `.gitignore` SHALL contain an explicit rule
//   for all four with no duplicate rules, and applying the fix again SHALL
//   produce no further change.
//
// **Validates: Requirements 7.3**
//
// This test exercises the pure idempotent append path in
// `src/finalization/detectors/hygiene.ts`:
//   - `ensureTransientDirRules(content)` — the direct fix entry point.
//   - `buildGitignoreAppend(content, header, rules)` — the underlying builder.
//   - `HygieneDetector` + `HygieneFixer` — the wired detect→fix flow whose
//     'insert' Edit is applied by appending its text (mirroring EditApplier).
//
// Strategy: generate a `.gitignore` body that includes an arbitrary subset of
// the four transient directory rules (in arbitrary order, interleaved with
// ignorable noise lines and unrelated rules). Then assert the three invariants
// on the fixed output and on its second application.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  TRANSIENT_DIRS,
  ensureTransientDirRules,
  buildGitignoreAppend,
  detectGitignoreState,
  HygieneDetector,
  HygieneFixer,
} from '../detectors/hygiene';
import type { FileRecord } from '../types';

const GITIGNORE_PATH = '.gitignore';

/** Noise lines the parser ignores; harmless filler around the real rules. */
const NOISE_LINES = ['', '# a comment', '   ', '# transient', '/dist/', '*.log'];

/** Count exact-match occurrences of a trimmed rule line in a `.gitignore` body. */
function countRuleLines(content: string, rule: string): number {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l === rule).length;
}

/** Assert all four transient rules are present exactly once (no duplicates). */
function assertAllPresentNoDuplicates(content: string): void {
  const state = detectGitignoreState(content);
  for (const dir of TRANSIENT_DIRS) {
    expect(state.transientDirs[dir]).toBe(true);
    // Exactly one explicit rule line for the directory — no duplicate rules.
    expect(countRuleLines(content, dir)).toBe(1);
  }
}

/**
 * Build a `.gitignore` body containing the chosen subset of transient rules
 * plus interleaved noise, in a shuffled order.
 */
function buildContent(
  includeFlags: readonly boolean[],
  noise: readonly string[],
  interleaveSeed: number,
): string {
  const ruleLines = TRANSIENT_DIRS.filter((_, i) => includeFlags[i]);
  const all = [...ruleLines, ...noise];
  // Deterministic rotation so rule lines are not always grouped first.
  const offset = all.length > 0 ? interleaveSeed % all.length : 0;
  const rotated = [...all.slice(offset), ...all.slice(0, offset)];
  return rotated.join('\n');
}

describe('Property 26: Transient directory rules are present and idempotent', () => {
  it('ensureTransientDirRules adds all four with no duplicates and is idempotent', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean()),
        fc.array(fc.constantFrom(...NOISE_LINES), { maxLength: 6 }),
        fc.nat(),
        (includeFlags, noise, interleaveSeed) => {
          const original = buildContent(includeFlags, noise, interleaveSeed);

          // First application: all four present, no duplicates.
          const first = ensureTransientDirRules(original);
          assertAllPresentNoDuplicates(first.content);

          // Only the genuinely-missing directories should be reported as added.
          const expectedAdded = TRANSIENT_DIRS.filter((_, i) => !includeFlags[i]);
          expect([...first.added].sort()).toEqual([...expectedAdded].sort());

          // Second application is a no-op: content unchanged, nothing added.
          const second = ensureTransientDirRules(first.content);
          expect(second.content).toBe(first.content);
          expect(second.added).toEqual([]);
          assertAllPresentNoDuplicates(second.content);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('buildGitignoreAppend never re-adds an already-present transient rule', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean()),
        fc.array(fc.constantFrom(...NOISE_LINES), { maxLength: 6 }),
        fc.nat(),
        (includeFlags, noise, interleaveSeed) => {
          const original = buildContent(includeFlags, noise, interleaveSeed);
          const { appendedText, addedRules } = buildGitignoreAppend(
            original,
            '# Transient working directories',
            [...TRANSIENT_DIRS],
          );

          // Appended text must contain only the missing rules, none already present.
          for (let i = 0; i < TRANSIENT_DIRS.length; i += 1) {
            const dir = TRANSIENT_DIRS[i];
            if (includeFlags[i]) {
              expect(addedRules).not.toContain(dir);
            } else {
              expect(addedRules).toContain(dir);
            }
          }

          // A subsequent append over the fixed content is empty (idempotence).
          const fixed = original + appendedText;
          const again = buildGitignoreAppend(
            fixed,
            '# Transient working directories',
            [...TRANSIENT_DIRS],
          );
          expect(again.appendedText).toBe('');
          expect(again.addedRules).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('HygieneDetector + HygieneFixer produce an idempotent transient-dir fix', () => {
    const detector = new HygieneDetector();
    const fixer = new HygieneFixer();

    fc.assert(
      fc.property(
        fc.tuple(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean()),
        fc.array(fc.constantFrom(...NOISE_LINES), { maxLength: 6 }),
        fc.nat(),
        (includeFlags, noise, interleaveSeed) => {
          const original = buildContent(includeFlags, noise, interleaveSeed);
          const record: FileRecord = {
            path: GITIGNORE_PATH,
            content: original,
            bytes: original.length,
            readError: null,
            language: 'other',
          };

          const transientFinding = detector
            .detect([record])
            .find((f) => f.kind === 'gitignore-missing-transient-dirs');

          const allAlreadyPresent = includeFlags.every((flag) => flag);
          if (allAlreadyPresent) {
            // Nothing missing: no transient finding, and original already valid.
            expect(transientFinding).toBeUndefined();
            assertAllPresentNoDuplicates(original);
            return;
          }

          expect(transientFinding).toBeDefined();
          const outcome = fixer.fix(transientFinding!, record);
          expect(outcome.preserved).toBe(false);
          expect(outcome.edits).toHaveLength(1);

          const edit = outcome.edits[0];
          expect(edit.kind).toBe('insert');
          expect(edit.path).toBe(GITIGNORE_PATH);

          // Apply the insert Edit the way EditApplier would (append to EOF).
          const fixedContent = original + (edit.text ?? '');
          assertAllPresentNoDuplicates(fixedContent);

          // Re-detecting over the fixed content yields no transient finding.
          const fixedRecord: FileRecord = {
            ...record,
            content: fixedContent,
            bytes: fixedContent.length,
          };
          const reFinding = detector
            .detect([fixedRecord])
            .find((f) => f.kind === 'gitignore-missing-transient-dirs');
          expect(reFinding).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});
