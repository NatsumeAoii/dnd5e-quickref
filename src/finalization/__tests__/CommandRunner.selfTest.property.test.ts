// Feature: pre-ship-finalization, Property 49: Self-test sequence passes only when all four steps pass
//
// Property 49 (design "Correctness Properties"):
//   cleanCheckoutSelfTest marks the sequence passed only if all four steps
//   (install, configure, build, run) pass; it short-circuits at the first
//   failing step so later steps are recorded as unexecuted (result === null).
//
// **Validates: Requirements 13.2**
//
// Strategy: construct a CommandRunner with an injected CommandExecutor
// (CommandRunnerOptions.executor) that returns a success/failure result per
// command, driven by a generated map from step name -> exit status. Because the
// default self-test commands are distinct per step, the executor can key its
// response on the configured command string. We then assert:
//   - report.passed === (every step's command exits 0)
//   - the first failing step short-circuits: every later step has result null
//     and passed false
//   - each executed step's `passed` flag equals (exitStatus === 0)
//   - steps preserve SELF_TEST_STEP_ORDER and length 4

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  CommandRunner,
  DEFAULT_SELF_TEST_COMMANDS,
  SELF_TEST_STEP_ORDER,
  type CommandExecutor,
  type CommandResult,
  type SelfTestStepName,
} from '../CommandRunner';

const MIN_CASES = 100;

/** A generated outcome for a single step: the exit status its command returns. */
type StepOutcomes = Readonly<Record<SelfTestStepName, number>>;

/**
 * Build an executor that maps each configured self-test command string to the
 * exit status declared for its step. Any unexpected command fails loudly so a
 * mis-wired test cannot silently pass.
 */
function makeExecutor(outcomes: StepOutcomes): CommandExecutor {
  const commandToStatus = new Map<string, number>();
  for (const name of SELF_TEST_STEP_ORDER) {
    commandToStatus.set(DEFAULT_SELF_TEST_COMMANDS[name], outcomes[name]);
  }

  return (command: string): CommandResult => {
    const status = commandToStatus.get(command);
    if (status === undefined) {
      throw new Error(`Unexpected command executed by self-test: ${command}`);
    }
    return {
      command,
      exitStatus: status,
      stdout: status === 0 ? 'ok' : '',
      stderr: status === 0 ? '' : 'failed',
    };
  };
}

/** Exit statuses: 0 (pass) plus assorted non-zero failure codes. */
const exitStatusArb = fc.constantFrom(0, 1, 2, 127, -1, 255);

const outcomesArb: fc.Arbitrary<StepOutcomes> = fc.record({
  install: exitStatusArb,
  configure: exitStatusArb,
  build: exitStatusArb,
  run: exitStatusArb,
});

describe('CommandRunner.cleanCheckoutSelfTest (Property 49)', () => {
  it('passes only when all four steps pass and short-circuits at the first failure', () => {
    fc.assert(
      fc.property(outcomesArb, (outcomes) => {
        const runner = new CommandRunner({ executor: makeExecutor(outcomes) });
        const report = runner.cleanCheckoutSelfTest();

        // Structure: exactly the four steps, in the documented order.
        expect(report.steps).toHaveLength(SELF_TEST_STEP_ORDER.length);
        expect(report.steps.map((step) => step.name)).toEqual([...SELF_TEST_STEP_ORDER]);

        // Index of the first step whose command fails, or -1 if all pass.
        const firstFailureIndex = SELF_TEST_STEP_ORDER.findIndex(
          (name) => outcomes[name] !== 0,
        );
        const allPass = firstFailureIndex === -1;

        // Overall sequence passes iff every step exits cleanly.
        expect(report.passed).toBe(allPass);

        report.steps.forEach((step, index) => {
          if (allPass || index < firstFailureIndex) {
            // Executed and clean: result captured, passed true.
            expect(step.result).not.toBeNull();
            expect(step.result?.exitStatus).toBe(0);
            expect(step.passed).toBe(true);
          } else if (index === firstFailureIndex) {
            // The failing step: executed but not clean.
            expect(step.result).not.toBeNull();
            expect(step.result?.exitStatus).toBe(outcomes[step.name]);
            expect(step.passed).toBe(false);
          } else {
            // After the first failure: short-circuited, unexecuted.
            expect(step.result).toBeNull();
            expect(step.passed).toBe(false);
          }
        });
      }),
      { numRuns: MIN_CASES },
    );
  });

  it('passes for the all-clean case and fails as soon as any single step fails', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SELF_TEST_STEP_ORDER.length - 1 }),
        (failingIndex) => {
          // Exactly one failing step at `failingIndex`, all others clean.
          const outcomes = Object.fromEntries(
            SELF_TEST_STEP_ORDER.map((name, index) => [
              name,
              index === failingIndex ? 1 : 0,
            ]),
          ) as StepOutcomes;

          const runner = new CommandRunner({ executor: makeExecutor(outcomes) });
          const report = runner.cleanCheckoutSelfTest();

          // A single failure anywhere fails the whole sequence.
          expect(report.passed).toBe(false);

          // Steps after the failure are never executed.
          for (let index = failingIndex + 1; index < report.steps.length; index += 1) {
            expect(report.steps[index]?.result).toBeNull();
            expect(report.steps[index]?.passed).toBe(false);
          }
        },
      ),
      { numRuns: MIN_CASES },
    );
  });
});
