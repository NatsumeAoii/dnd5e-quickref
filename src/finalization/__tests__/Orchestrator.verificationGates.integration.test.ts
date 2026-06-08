// Feature: pre-ship-finalization
//
// Integration test for the final verification gates (task 18.4).
//
// Validates: Requirements 14.5, 14.6, 14.7
//
// This exercises FinalizationOrchestrator.runVerificationGates and
// runFinalizationLoop with every I/O and process boundary injected so the test
// is fully deterministic and fast (no real filesystem, no spawned processes):
//
//   - A CommandRunner built from CommandRunnerOptions.executor returns fixed
//     exit statuses for 'npm run lint' / 'npm run type-check' / 'npm run test'.
//   - An InMemoryEditApplier applies the synthetic fixer's edits.
//   - Synthetic domainPairs drive the recheck loop deterministically.
//
// Assertions, one per acceptance criterion:
//   14.5 — each verification command's exit status is recorded, in order, in
//          VerificationOutcome.commandStatuses, and each command runs exactly
//          once (no hidden retries).
//   14.6 — a failing gate re-enters the recheck loop; verifyReentries increments
//          and is bounded by MAX_VERIFY_REENTRIES.
//   14.7 — a regression (a gate failing after fixes) re-enters the loop, is
//          corrected on re-entry, and the re-entry count stays bounded.

import { describe, expect, it } from 'vitest';

import {
  FinalizationOrchestrator,
  MAX_VERIFY_REENTRIES,
  VERIFICATION_COMMANDS,
  type OrchestratorOptions,
} from '../Orchestrator.js';
import {
  CommandRunner,
  type CommandExecutor,
  type CommandResult,
} from '../CommandRunner.js';
import { InMemoryEditApplier } from '../EditApplier.js';
import type {
  Detector,
  FileRecord,
  Finding,
  FixOutcome,
  Fixer,
} from '../types.js';

/** The single synthetic source file the detectors operate over. */
const FLAG_PATH = 'src/synthetic/always.ts';

/** A fully-read, traceable inventory with one well-formed record. */
function syntheticRecords(): FileRecord[] {
  return [
    {
      path: FLAG_PATH,
      content: 'const value = 1;',
      bytes: 16,
      readError: null,
      language: 'typescript',
    },
  ];
}

/**
 * A detector that always flags the synthetic file. Because it ignores content,
 * the recheck loop can never reach a zero-finding cycle, which keeps a fixer
 * producing self-corrections on every re-entry — the condition under which a
 * failing gate is allowed to re-enter the loop (Requirements 14.6, 14.7).
 */
const alwaysFlagDetector: Detector = {
  domain: 'dead-code',
  detect(records: readonly FileRecord[]): readonly Finding[] {
    return records
      .filter((record) => record.path === FLAG_PATH && record.content !== null)
      .map((record) => ({
        domain: 'dead-code' as const,
        path: record.path,
        location: { line: 1 },
        kind: 'synthetic-always',
        detail: 'synthetic finding that always reappears',
        autoFixable: true,
      }));
  },
};

/** A fixer that always emits one edit, so every cycle records a self-correction. */
const alwaysFixer: Fixer = {
  domain: 'dead-code',
  fix(_finding: Finding, record: FileRecord): FixOutcome {
    return {
      edits: [
        {
          kind: 'replace',
          path: record.path,
          text: '// fixed by synthetic fixer',
          placeholderInserted: false,
        },
      ],
      preserved: false,
    };
  },
};

/** A detector that never flags anything: the recheck loop is immediately stable. */
const inertDetector: Detector = {
  domain: 'dead-code',
  detect(): readonly Finding[] {
    return [];
  },
};

/** Matching inert fixer (never consulted, but required to pair the domain). */
const inertFixer: Fixer = {
  domain: 'dead-code',
  fix(): FixOutcome {
    return { edits: [], preserved: false };
  },
};

/**
 * Build a deterministic executor that records every invocation and resolves a
 * command's exit status from `statusFor`. Returning the live status map lets a
 * test mutate exit statuses between gate runs to model a regression.
 */
function recordingExecutor(statusFor: (command: string) => number): {
  executor: CommandExecutor;
  calls: string[];
} {
  const calls: string[] = [];
  const executor: CommandExecutor = (command: string): CommandResult => {
    calls.push(command);
    return { command, exitStatus: statusFor(command), stdout: '', stderr: '' };
  };
  return { executor, calls };
}

/** Construct an orchestrator with the given executor and synthetic domain pairs. */
function makeOrchestrator(
  executor: CommandExecutor,
  domainPairs: OrchestratorOptions['domainPairs'],
): FinalizationOrchestrator {
  return new FinalizationOrchestrator({
    commandRunner: new CommandRunner({ executor }),
    editApplier: new InMemoryEditApplier(),
    domainPairs,
  });
}

describe('FinalizationOrchestrator final verification gates (integration)', () => {
  describe('Requirement 14.5 — each command exit status is recorded', () => {
    it('records every command, in order, with its exit status when all pass', () => {
      const { executor, calls } = recordingExecutor(() => 0);
      const orchestrator = makeOrchestrator(executor, [
        { detector: inertDetector, fixer: inertFixer },
      ]);

      const outcome = orchestrator.runVerificationGates();

      expect(outcome.commandStatuses.map((result) => result.command)).toEqual(
        VERIFICATION_COMMANDS,
      );
      expect(outcome.commandStatuses.map((result) => result.exitStatus)).toEqual(
        [0, 0, 0],
      );
      expect(outcome.allPassed).toBe(true);
      // No hidden retries: exactly one invocation per verification command.
      expect(calls).toEqual([...VERIFICATION_COMMANDS]);
    });

    it('records the failing command exit status and marks the gate not passed', () => {
      const failing: Record<string, number> = {
        'npm run lint': 0,
        'npm run type-check': 2,
        'npm run test': 0,
      };
      const { executor, calls } = recordingExecutor(
        (command) => failing[command] ?? 0,
      );
      const orchestrator = makeOrchestrator(executor, [
        { detector: inertDetector, fixer: inertFixer },
      ]);

      const outcome = orchestrator.runVerificationGates();

      expect(outcome.commandStatuses.map((result) => result.exitStatus)).toEqual(
        [0, 2, 0],
      );
      expect(outcome.allPassed).toBe(false);
      // Every command still runs exactly once even though one failed.
      expect(calls).toEqual([...VERIFICATION_COMMANDS]);
    });
  });

  describe('Requirement 14.6 — a failing gate re-enters the recheck loop, bounded', () => {
    it('increments verifyReentries up to MAX_VERIFY_REENTRIES when a gate keeps failing', () => {
      // 'npm run test' always fails; the always-flag detector keeps the fixer
      // making progress, so each failing gate is allowed to re-enter the loop.
      const { executor } = recordingExecutor((command) =>
        command === 'npm run test' ? 1 : 0,
      );
      const orchestrator = makeOrchestrator(executor, [
        { detector: alwaysFlagDetector, fixer: alwaysFixer },
      ]);

      const outcome = orchestrator.runFinalizationLoop(syntheticRecords());

      // The gate never passes, so the loop re-enters until the hard cap.
      expect(outcome.verification.allPassed).toBe(false);
      expect(outcome.verifyReentries).toBe(MAX_VERIFY_REENTRIES);
      expect(outcome.verifyReentries).toBeLessThanOrEqual(MAX_VERIFY_REENTRIES);
      // The final command statuses are recorded regardless of the failure.
      expect(outcome.verification.commandStatuses.map((r) => r.command)).toEqual(
        VERIFICATION_COMMANDS,
      );
      expect(outcome.stable).toBe(false);
    });

    it('stays bounded even when no fix can make progress', () => {
      // Inert detector => recheck is immediately stable and produces no
      // self-corrections, yet the gate keeps failing. Re-entry must still be
      // bounded (it stops as soon as a re-entry makes no progress).
      const { executor } = recordingExecutor((command) =>
        command === 'npm run test' ? 1 : 0,
      );
      const orchestrator = makeOrchestrator(executor, [
        { detector: inertDetector, fixer: inertFixer },
      ]);

      const outcome = orchestrator.runFinalizationLoop(syntheticRecords());

      expect(outcome.verification.allPassed).toBe(false);
      expect(outcome.verifyReentries).toBeGreaterThanOrEqual(1);
      expect(outcome.verifyReentries).toBeLessThanOrEqual(MAX_VERIFY_REENTRIES);
    });
  });

  describe('Requirement 14.7 — a regression re-enters the loop and is corrected', () => {
    it('re-enters when a previously-passing gate fails, then passes after re-fixing', () => {
      // Model a regression: 'npm run test' fails on the first gate run (a fix
      // introduced a regression) and passes on the next run after the recheck
      // loop re-applies fixes. lint/type-check always pass.
      let testRuns = 0;
      const statusFor = (command: string): number => {
        if (command === 'npm run test') {
          testRuns += 1;
          return testRuns === 1 ? 1 : 0;
        }
        return 0;
      };
      const { executor } = recordingExecutor(statusFor);
      const orchestrator = makeOrchestrator(executor, [
        { detector: alwaysFlagDetector, fixer: alwaysFixer },
      ]);

      const outcome = orchestrator.runFinalizationLoop(syntheticRecords());

      // The regression triggered exactly one re-entry, which corrected it.
      expect(outcome.verifyReentries).toBe(1);
      expect(outcome.verifyReentries).toBeLessThanOrEqual(MAX_VERIFY_REENTRIES);
      expect(outcome.verification.allPassed).toBe(true);
      // The re-entry re-ran the recheck loop and recorded self-corrections.
      expect(outcome.selfCorrections.length).toBeGreaterThan(0);
      // The final test command exited cleanly after the regression was fixed.
      const finalTest = outcome.verification.commandStatuses.find(
        (result) => result.command === 'npm run test',
      );
      expect(finalTest?.exitStatus).toBe(0);
    });
  });
});
