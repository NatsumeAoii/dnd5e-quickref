// Feature: pre-ship-finalization
//
// CommandRunner is the *process boundary* of the finalization toolkit. It is the
// only component permitted to spawn external processes. Detectors and fixers are
// pure; the orchestrator drives verification (lint / type-check / test / build)
// and the clean-checkout self-test through this class.
//
// Two responsibilities (design "CommandRunner"):
//   - run(command): execute a single command, capturing the command string,
//     exit status, stdout, and stderr. There are NO hidden retries — each call
//     is exactly one invocation (Requirement 13 / 14.5).
//   - cleanCheckoutSelfTest(): simulate the documented first-run sequence
//     (install -> configure -> build -> run). Each step passes only if it exits
//     cleanly, and the whole sequence passes only if all four steps pass
//     (Requirements 13.1, 13.2, 13.3, 13.5).
//
// Node built-in types are intentionally absent from this browser app's tsconfig
// (see src/__tests__/*.test.ts for the same pattern), so the single node import
// is annotated with `@ts-expect-error`. All values crossing that untyped
// boundary are coerced to known types before use.

// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { spawnSync } from 'node:child_process';

/**
 * Exit status reported when a command never produced a numeric exit code (for
 * example it could not be spawned, or was terminated by a signal). A negative
 * value can never collide with a real process exit code (0–255), so callers can
 * treat any non-zero status uniformly as failure.
 */
const NO_CLEAN_EXIT = -1;

/** Encoding used to decode child-process stdout/stderr into strings. */
const OUTPUT_ENCODING = 'utf-8';

/**
 * The result of running exactly one command. Captured verbatim for the
 * Finalization_Report so every external invocation and its exit status is
 * auditable (Requirement 14.5).
 */
export interface CommandResult {
  /** The command line exactly as it was invoked. */
  readonly command: string;
  /** Process exit code, or {@link NO_CLEAN_EXIT} when none was produced. */
  readonly exitStatus: number;
  /** Captured standard output. */
  readonly stdout: string;
  /** Captured standard error. */
  readonly stderr: string;
}

/** The four ordered steps of the documented first-run sequence. */
export type SelfTestStepName = 'install' | 'configure' | 'build' | 'run';

/** The fixed order in which the self-test steps are executed. */
export const SELF_TEST_STEP_ORDER: readonly SelfTestStepName[] = [
  'install',
  'configure',
  'build',
  'run',
];

/**
 * The command line to run for each self-test step. Supplied to the
 * CommandRunner so the documented first-run commands are explicit and
 * overridable per project.
 */
export type SelfTestCommands = Readonly<Record<SelfTestStepName, string>>;

/**
 * Documented first-run commands for this project (Vite + TypeScript, npm).
 *
 * - install: `npm ci` installs exactly the locked dependency tree, which is the
 *   correct clean-checkout install (no `package-lock.json` drift).
 * - configure: `npm run sync-version` propagates the CHANGELOG version into the
 *   generated manifests, the project's only configuration step.
 * - build: `npm run build` type-checks and produces the `dist/` bundle.
 * - run: `npm run preview` serves the built bundle. Because preview is a
 *   long-running server, callers performing the real sequence should pass a
 *   bounded command (or an injected {@link CommandExecutor}); the integration
 *   test supplies an appropriate runnable check.
 */
export const DEFAULT_SELF_TEST_COMMANDS: SelfTestCommands = {
  install: 'npm ci',
  configure: 'npm run sync-version',
  build: 'npm run build',
  run: 'npm run preview',
};

/** One executed (or skipped) step of the self-test sequence. */
export interface SelfTestStep {
  /** Which first-run step this is. */
  readonly name: SelfTestStepName;
  /** The command line configured for the step. */
  readonly command: string;
  /**
   * The captured result, or `null` when the step was not executed because an
   * earlier step failed and short-circuited the sequence.
   */
  readonly result: CommandResult | null;
  /** True only when the step executed and exited cleanly. */
  readonly passed: boolean;
}

/**
 * Outcome of the clean-checkout self-test. `passed` is true only when all four
 * steps executed and passed (Requirement 13.2).
 */
export interface SelfTestReport {
  /** Steps in {@link SELF_TEST_STEP_ORDER}; trailing steps may be unexecuted. */
  readonly steps: readonly SelfTestStep[];
  /** True if and only if all four steps executed without error. */
  readonly passed: boolean;
}

/**
 * Executes a single command and returns its captured result. Injecting an
 * executor lets the orchestrator and tests drive the self-test sequence logic
 * without spawning real processes.
 */
export type CommandExecutor = (command: string) => CommandResult;

/** Options controlling how the default (real) executor spawns processes. */
export interface CommandRunnerOptions {
  /** Working directory for spawned commands. Defaults to the current directory. */
  readonly cwd?: string;
  /**
   * Per-command timeout in milliseconds. When exceeded the process is killed
   * and the command is reported as failed. Defaults to no timeout.
   */
  readonly timeoutMs?: number;
  /** Command lines for each self-test step. Defaults to {@link DEFAULT_SELF_TEST_COMMANDS}. */
  readonly selfTestCommands?: SelfTestCommands;
  /**
   * Executor used to run commands. Defaults to a synchronous executor backed by
   * `child_process.spawnSync`. Provide a custom executor to test sequencing or
   * to route commands through a different runner.
   */
  readonly executor?: CommandExecutor;
}

/**
 * Reads a possibly-undefined buffer/string value coming from the untyped node
 * boundary and returns a decoded string. `spawnSync` may hand back a `Buffer`,
 * a string, or `null`, so every case is normalized here.
 */
function decodeStream(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  // Buffer (and other objects) expose a faithful toString(encoding).
  if (typeof (value as { toString?: unknown }).toString === 'function') {
    return (value as { toString(encoding?: string): string }).toString(OUTPUT_ENCODING);
  }
  return String(value);
}

/**
 * CommandRunner — the process boundary for the finalization toolkit.
 *
 * Construct with no arguments to use the real synchronous executor, or pass an
 * {@link CommandExecutor} to drive the sequence logic deterministically.
 */
export class CommandRunner {
  readonly #cwd: string | undefined;
  readonly #timeoutMs: number | undefined;
  readonly #selfTestCommands: SelfTestCommands;
  readonly #executor: CommandExecutor;

  constructor(options: CommandRunnerOptions = {}) {
    this.#cwd = options.cwd;
    this.#timeoutMs = options.timeoutMs;
    this.#selfTestCommands = options.selfTestCommands ?? DEFAULT_SELF_TEST_COMMANDS;
    this.#executor = options.executor ?? ((command) => this.#runWithSpawnSync(command));
  }

  /**
   * Run a single command exactly once and capture its result. No retries are
   * performed: one call to {@link run} is one process invocation
   * (Requirement 13 / 14.5).
   */
  run(command: string): CommandResult {
    return this.#executor(command);
  }

  /**
   * Simulate the documented first-run sequence from a clean checkout:
   * install -> configure -> build -> run (Requirement 13.1).
   *
   * Each step runs in order and is marked passed only when it exits cleanly
   * (Requirement 13.2). The sequence short-circuits at the first failing step —
   * later steps depend on earlier ones, so they are recorded as unexecuted
   * (`result: null`, `passed: false`). The overall sequence passes only when all
   * four steps executed and passed.
   */
  cleanCheckoutSelfTest(): SelfTestReport {
    const steps: SelfTestStep[] = [];
    let aborted = false;

    for (const name of SELF_TEST_STEP_ORDER) {
      const command = this.#selfTestCommands[name];

      if (aborted) {
        // An earlier step failed; this step is not executed.
        steps.push({ name, command, result: null, passed: false });
        continue;
      }

      const result = this.run(command);
      const passed = result.exitStatus === 0;
      steps.push({ name, command, result, passed });

      if (!passed) {
        aborted = true;
      }
    }

    const passed =
      steps.length === SELF_TEST_STEP_ORDER.length && steps.every((step) => step.passed);

    return { steps, passed };
  }

  /**
   * Default executor: run the command synchronously through the shell and
   * capture its exit status and streams. Failures to spawn (or signal kills)
   * surface as {@link NO_CLEAN_EXIT} with the error text on stderr.
   */
  #runWithSpawnSync(command: string): CommandResult {
    const spawnOptions: {
      shell: boolean;
      encoding: string;
      cwd?: string;
      timeout?: number;
      maxBuffer: number;
    } = {
      shell: true,
      encoding: OUTPUT_ENCODING,
      maxBuffer: 64 * 1024 * 1024,
    };
    if (this.#cwd !== undefined) {
      spawnOptions.cwd = this.#cwd;
    }
    if (this.#timeoutMs !== undefined) {
      spawnOptions.timeout = this.#timeoutMs;
    }

    const outcome: unknown = spawnSync(command, [], spawnOptions);
    const record = (outcome ?? {}) as {
      status?: unknown;
      stdout?: unknown;
      stderr?: unknown;
      error?: unknown;
    };

    const stdout = decodeStream(record.stdout);
    let stderr = decodeStream(record.stderr);

    // A spawn-level error (command not found, timeout) carries no exit code.
    const spawnError = record.error;
    if (spawnError !== undefined && spawnError !== null) {
      const message =
        typeof (spawnError as { message?: unknown }).message === 'string'
          ? (spawnError as { message: string }).message
          : String(spawnError);
      stderr = stderr.length > 0 ? `${stderr}\n${message}` : message;
    }

    const status = record.status;
    const exitStatus = typeof status === 'number' ? status : NO_CLEAN_EXIT;

    return { command, exitStatus, stdout, stderr };
  }
}
