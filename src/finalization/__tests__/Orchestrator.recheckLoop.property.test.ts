// Feature: pre-ship-finalization, Property 50: The recheck loop is bounded and terminates on stability
//
// Validates: Requirements 14.2, 14.3, 14.8
//
// Property text: The recheck loop runs at most MAX_RECHECK_CYCLES (5) cycles, it
// stops as soon as a cycle produces zero findings (stable), and when the cap is
// reached with findings still present it records them as unresolvedFindings.
//
// This test drives FinalizationOrchestrator.runRecheckLoop with synthetic
// detector/fixer pairs injected through OrchestratorOptions and an in-memory
// EditApplier, so the loop is exercised without any real filesystem, process, or
// production detector.
//
// Two kinds of synthetic files are generated:
//
//   - "counter" files whose content is a small integer R in [0, 4]. The detector
//     flags one finding while R > 0; the fixer decrements R by one. Such a file
//     converges to a zero-finding state after exactly R cycles, so an inventory
//     of counter files converges in max(R_i) cycles (<= 4), reaching a
//     zero-finding cycle within the cap (stable).
//
//   - a "pathological" file the detector always flags; its fixer applies a
//     benign edit that never removes the defect, so the loop can never reach a
//     zero-finding cycle and must hit MAX_RECHECK_CYCLES and record the finding
//     as unresolved (Requirement 14.8).
//
// The property asserts, across all generated inventories:
//   * cyclesRun is always bounded by MAX_RECHECK_CYCLES (14.2),
//   * the loop is stable iff a zero-finding cycle was reachable (14.3), and
//   * unresolvedFindings is populated exactly when the cap is reached with a
//     defect still present (14.8).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  FinalizationOrchestrator,
  MAX_RECHECK_CYCLES,
} from '../Orchestrator.js';
import { InMemoryEditApplier } from '../EditApplier.js';
import type {
  Detector,
  FileRecord,
  Finding,
  FixOutcome,
  Fixer,
} from '../types.js';

/** Marker content for the file that never converges. */
const PATHOLOGICAL_MARKER = 'NEVER';

/** Build a typescript FileRecord with the given repo-relative path and content. */
function makeRecord(path: string, content: string): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: 'typescript',
  };
}

/**
 * Synthetic detector over the `dead-code` domain.
 *
 *   - A record whose content contains {@link PATHOLOGICAL_MARKER} is always
 *     flagged (it can never be resolved).
 *   - A record whose content parses to an integer R > 0 is flagged once.
 *   - Any other record (R == 0, or non-numeric) is clean.
 */
const syntheticDetector: Detector = {
  domain: 'dead-code',
  detect(records: readonly FileRecord[]): readonly Finding[] {
    const findings: Finding[] = [];
    for (const record of records) {
      if (record.content === null) {
        continue;
      }
      if (record.content.includes(PATHOLOGICAL_MARKER)) {
        findings.push({
          domain: 'dead-code',
          path: record.path,
          location: { line: 1, column: 1 },
          kind: 'pathological',
          detail: `unresolvable synthetic defect in ${record.path}`,
          autoFixable: true,
        });
        continue;
      }
      const remaining = Number.parseInt(record.content.trim(), 10);
      if (Number.isFinite(remaining) && remaining > 0) {
        findings.push({
          domain: 'dead-code',
          path: record.path,
          location: { line: 1, column: 1 },
          kind: 'counter',
          detail: `${remaining} synthetic defect(s) remaining in ${record.path}`,
          autoFixable: true,
        });
      }
    }
    return findings;
  },
};

/**
 * Synthetic fixer over the `dead-code` domain.
 *
 *   - For a pathological file it returns a benign append edit that never removes
 *     the marker, so the detector keeps flagging it forever.
 *   - For a counter file it returns a whole-file replace that decrements the
 *     counter, making progress toward a zero-finding state.
 */
const syntheticFixer: Fixer = {
  domain: 'dead-code',
  fix(finding: Finding, record: FileRecord): FixOutcome {
    const content = record.content ?? '';
    if (content.includes(PATHOLOGICAL_MARKER)) {
      return {
        edits: [
          {
            kind: 'insert',
            path: record.path,
            text: '// touched but unresolved',
            placeholderInserted: false,
          },
        ],
        preserved: false,
      };
    }
    const remaining = Number.parseInt(content.trim(), 10);
    const next = Number.isFinite(remaining) ? Math.max(0, remaining - 1) : 0;
    return {
      edits: [
        {
          kind: 'replace',
          path: record.path,
          text: String(next),
          placeholderInserted: false,
        },
      ],
      preserved: false,
    };
  },
};

/** Construct an orchestrator wired to the synthetic domain and in-memory applier. */
function makeOrchestrator(): FinalizationOrchestrator {
  return new FinalizationOrchestrator({
    domainPairs: [{ detector: syntheticDetector, fixer: syntheticFixer }],
    editApplier: new InMemoryEditApplier(),
  });
}

/**
 * Generated inventory: zero or more counter files with R in [0, 4] plus an
 * optional pathological file. Counters are capped at 4 so a convergent
 * inventory always reaches a zero-finding cycle strictly before the loop cap,
 * keeping "stable iff convergent" unambiguous.
 */
const inventoryArbitrary = fc
  .record({
    counters: fc.array(fc.integer({ min: 0, max: MAX_RECHECK_CYCLES - 1 }), {
      minLength: 0,
      maxLength: 6,
    }),
    includePathological: fc.boolean(),
  })
  .map(({ counters, includePathological }) => {
    const records = counters.map((value, index) =>
      makeRecord(`src/work-${index}.ts`, String(value)),
    );
    if (includePathological) {
      records.push(makeRecord('src/never.ts', PATHOLOGICAL_MARKER));
    }
    return { records, counters, includePathological };
  });

describe('FinalizationOrchestrator.runRecheckLoop bounded, stable recheck loop (Property 50)', () => {
  it('is bounded by the cap, stable iff a zero-finding cycle is reached, and records unresolved findings when capped', () => {
    fc.assert(
      fc.property(inventoryArbitrary, ({ records, counters, includePathological }) => {
        const orchestrator = makeOrchestrator();
        const outcome = orchestrator.runRecheckLoop(records);

        // 14.2: the loop never exceeds the hard cap.
        expect(outcome.cyclesRun).toBeGreaterThanOrEqual(0);
        expect(outcome.cyclesRun).toBeLessThanOrEqual(MAX_RECHECK_CYCLES);

        if (includePathological) {
          // The pathological file can never be resolved, so no zero-finding
          // cycle is ever reached: the loop must run to the cap (14.2) ...
          expect(outcome.stable).toBe(false);
          expect(outcome.cyclesRun).toBe(MAX_RECHECK_CYCLES);
          // ... and the remaining defect must be recorded as unresolved (14.8).
          expect(outcome.unresolvedFindings.length).toBeGreaterThan(0);
          expect(
            outcome.unresolvedFindings.some(
              (finding) => finding.path === 'src/never.ts',
            ),
          ).toBe(true);
        } else {
          // A purely convergent inventory reaches a zero-finding cycle within
          // the cap, so the loop terminates on stability (14.3) ...
          const expectedCycles =
            counters.length === 0 ? 0 : Math.max(...counters);
          expect(outcome.stable).toBe(true);
          expect(outcome.cyclesRun).toBe(expectedCycles);
          // ... with no findings left unresolved (14.8).
          expect(outcome.unresolvedFindings).toEqual([]);
          // Every counter has been driven to zero.
          for (const record of outcome.records) {
            expect(record.content).toBe('0');
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('terminates immediately as stable when the inventory has no findings', () => {
    const orchestrator = makeOrchestrator();
    const outcome = orchestrator.runRecheckLoop([
      makeRecord('src/clean-a.ts', '0'),
      makeRecord('src/clean-b.ts', '0'),
    ]);

    expect(outcome.stable).toBe(true);
    expect(outcome.cyclesRun).toBe(0);
    expect(outcome.unresolvedFindings).toEqual([]);
  });

  it('caps at MAX_RECHECK_CYCLES and records unresolved findings for a non-converging inventory', () => {
    const orchestrator = makeOrchestrator();
    const outcome = orchestrator.runRecheckLoop([
      makeRecord('src/never.ts', PATHOLOGICAL_MARKER),
    ]);

    expect(outcome.cyclesRun).toBe(MAX_RECHECK_CYCLES);
    expect(outcome.stable).toBe(false);
    expect(outcome.unresolvedFindings.length).toBeGreaterThan(0);
  });
});
