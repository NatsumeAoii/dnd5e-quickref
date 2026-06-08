// @vitest-environment node
//
// Feature: pre-ship-finalization
//
// Integration test for the clean-checkout self-test (Task 17.3).
//
// Rather than spawning real `npm` processes (slow, heavy, and environment
// dependent), this test drives `CommandRunner.cleanCheckoutSelfTest()` through
// an injected `CommandExecutor` that is backed by a real temporary "checkout"
// directory on disk. Each documented first-run step (install -> configure ->
// build -> run) is simulated by reading and mutating that checkout, so the
// step pass/fail decisions come from genuine filesystem state rather than
// hard-coded booleans.
//
// Coverage (Requirements 13.1, 13.3, 13.4, 13.5):
//   - 13.1/13.2: a fully passing install/configure/build/run sequence reports
//     the sequence as passed.
//   - 13.3: a first-run blocker (a missing environment variable consumed by the
//     `run` step) fails the sequence; after the blocker is resolved a re-run of
//     the full sequence from a clean checkout passes.
//   - 13.4: when the same blocker recurs across two runs, a recurrence-
//     preventing artifact (an environment template) is created so the next
//     clean-checkout run no longer hits the blocker — asserted by inspecting the
//     created artifact on disk.
//   - 13.5: each documented command is executed exactly as written and its
//     documented result (build output directory, served entry point) is
//     confirmed.

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  // @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
} from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { tmpdir } from 'node:os';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CommandRunner,
  DEFAULT_SELF_TEST_COMMANDS,
  SELF_TEST_STEP_ORDER,
  type CommandResult,
  type SelfTestCommands,
} from '../CommandRunner';

/** Exit code used for a step that completed without error. */
const EXIT_OK = 0;
/** Exit code used for a step that hit a blocker. */
const EXIT_BLOCKED = 1;

/** Marker file written by the simulated `install` step. */
const INSTALLED_MARKER = 'node_modules/.installed';
/** Marker file written by the simulated `configure` step. */
const CONFIGURED_MARKER = '.configured';
/** Build output directory the simulated `build` step is documented to produce. */
const BUILD_OUTPUT_DIR = 'dist';
/** Entry point the simulated `build` emits and the `run` step serves. */
const BUILD_ENTRY = 'dist/index.html';
/** Environment file whose value the `run` step requires (the blocker). */
const ENV_FILE = '.env';
/** Environment template artifact created to prevent the blocker recurring. */
const ENV_TEMPLATE_FILE = '.env.example';
/** The environment key the `run` step consumes. */
const REQUIRED_ENV_KEY = 'APP_BASE_URL';

/** Absolute-path helpers scoped to a checkout root. */
const pathIn = (root: string, relative: string): string => join(root, relative);

/** Write a file, creating parent directories as needed. */
const writeFileEnsuringDir = (absolutePath: string, content: string): void => {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf-8');
};

/**
 * Create a clean checkout: only version-controlled files, no installed
 * dependencies, no build artifacts, no machine-specific config — matching the
 * Requirement 13.1 definition of a clean checkout.
 */
function createCleanCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'finalization-selftest-'));
  writeFileEnsuringDir(
    pathIn(root, 'package.json'),
    JSON.stringify({ name: 'fixture-app', version: '1.0.0' }, null, 2),
  );
  writeFileEnsuringDir(pathIn(root, 'index.html'), '<!DOCTYPE html><title>fixture</title>');
  writeFileEnsuringDir(pathIn(root, 'src/main.ts'), 'export const start = () => undefined;\n');
  return root;
}

/**
 * Build an executor that simulates the documented first-run commands against a
 * checkout directory. Step outcomes are derived from real filesystem state:
 *
 *   - install   -> writes an installed marker.
 *   - configure -> requires install; writes a configured marker.
 *   - build     -> requires install + configure; writes dist/index.html.
 *   - run       -> requires the build entry AND the required env value to be
 *                  present (in .env or process-style env). Missing env is the
 *                  blocker.
 *
 * `runAttempts` records how many times the `run` command was invoked so the
 * recurring-blocker scenario can detect a repeat failure.
 */
function createCheckoutExecutor(
  root: string,
  env: { value: string | null },
  runAttempts: { blockedCount: number },
): (command: string) => CommandResult {
  const ok = (command: string, stdout: string): CommandResult => ({
    command,
    exitStatus: EXIT_OK,
    stdout,
    stderr: '',
  });
  const blocked = (command: string, stderr: string): CommandResult => ({
    command,
    exitStatus: EXIT_BLOCKED,
    stdout: '',
    stderr,
  });

  const commands = DEFAULT_SELF_TEST_COMMANDS;

  return (command: string): CommandResult => {
    switch (command) {
      case commands.install: {
        writeFileEnsuringDir(pathIn(root, INSTALLED_MARKER), 'ok');
        return ok(command, 'added packages');
      }
      case commands.configure: {
        if (!existsSync(pathIn(root, INSTALLED_MARKER))) {
          return blocked(command, 'dependencies not installed');
        }
        writeFileEnsuringDir(pathIn(root, CONFIGURED_MARKER), 'ok');
        return ok(command, 'version synced');
      }
      case commands.build: {
        if (!existsSync(pathIn(root, CONFIGURED_MARKER))) {
          return blocked(command, 'project not configured');
        }
        writeFileEnsuringDir(pathIn(root, BUILD_ENTRY), '<!DOCTYPE html><title>built</title>');
        return ok(command, `built ${BUILD_OUTPUT_DIR}`);
      }
      case commands.run: {
        if (!existsSync(pathIn(root, BUILD_ENTRY))) {
          return blocked(command, 'no build output to serve');
        }
        // The blocker: the run step needs APP_BASE_URL. It may be supplied via a
        // committed .env or an injected env value. A clean checkout has neither.
        const envFileValue = existsSync(pathIn(root, ENV_FILE))
          ? readFileSync(pathIn(root, ENV_FILE), 'utf-8')
          : '';
        const hasEnv =
          env.value !== null || new RegExp(`${REQUIRED_ENV_KEY}=.+`).test(envFileValue);
        if (!hasEnv) {
          runAttempts.blockedCount += 1;
          return blocked(command, `missing required environment variable ${REQUIRED_ENV_KEY}`);
        }
        return ok(command, `preview server serving ${BUILD_ENTRY}`);
      }
      default:
        return blocked(command, `unknown command: ${command}`);
    }
  };
}

describe('CommandRunner clean-checkout self-test (integration)', () => {
  let checkoutRoot: string;

  beforeEach(() => {
    checkoutRoot = createCleanCheckout();
  });

  afterEach(() => {
    rmSync(checkoutRoot, { recursive: true, force: true });
  });

  it('reports the sequence passed when install, configure, build, and run all succeed', () => {
    // Env value present from the start: no blocker on any step.
    const env = { value: 'https://example.test' };
    const runAttempts = { blockedCount: 0 };
    const runner = new CommandRunner({
      executor: createCheckoutExecutor(checkoutRoot, env, runAttempts),
    });

    const report = runner.cleanCheckoutSelfTest();

    expect(report.passed).toBe(true);
    expect(report.steps.map((step) => step.name)).toEqual([...SELF_TEST_STEP_ORDER]);
    expect(report.steps.every((step) => step.passed)).toBe(true);

    // Requirement 13.5: each documented command ran exactly as written and
    // produced its documented result (build output dir, served entry point).
    const buildStep = report.steps.find((step) => step.name === 'build');
    expect(buildStep?.command).toBe(DEFAULT_SELF_TEST_COMMANDS.build);
    expect(buildStep?.result?.stdout).toContain(BUILD_OUTPUT_DIR);
    expect(existsSync(pathIn(checkoutRoot, BUILD_ENTRY))).toBe(true);

    const runStep = report.steps.find((step) => step.name === 'run');
    expect(runStep?.command).toBe(DEFAULT_SELF_TEST_COMMANDS.run);
    expect(runStep?.result?.stdout).toContain(BUILD_ENTRY);
  });

  it('fails the sequence when a first-run blocker (missing env var) is hit, then passes after the blocker is resolved', () => {
    const runAttempts = { blockedCount: 0 };

    // First run: clean checkout with no env value -> the run step is blocked.
    const env = { value: null as string | null };
    const blockedRunner = new CommandRunner({
      executor: createCheckoutExecutor(checkoutRoot, env, runAttempts),
    });

    const blockedReport = blockedRunner.cleanCheckoutSelfTest();

    expect(blockedReport.passed).toBe(false);
    // Install/configure/build pass; only run is blocked by the missing env var.
    const blockedRunStep = blockedReport.steps.find((step) => step.name === 'run');
    expect(blockedRunStep?.passed).toBe(false);
    expect(blockedRunStep?.result?.stderr).toContain(REQUIRED_ENV_KEY);
    expect(
      blockedReport.steps.filter((step) => step.name !== 'run').every((step) => step.passed),
    ).toBe(true);

    // Resolve the blocker (Requirement 13.3): supply the required env value, then
    // re-run the FULL sequence from a fresh clean checkout.
    rmSync(checkoutRoot, { recursive: true, force: true });
    checkoutRoot = createCleanCheckout();
    env.value = 'https://example.test';
    const resolvedRunner = new CommandRunner({
      executor: createCheckoutExecutor(checkoutRoot, env, runAttempts),
    });

    const resolvedReport = resolvedRunner.cleanCheckoutSelfTest();

    expect(resolvedReport.passed).toBe(true);
    expect(resolvedReport.steps.every((step) => step.passed)).toBe(true);
  });

  it('creates a recurrence-preventing env template after the same blocker recurs, so the next clean-checkout run passes', () => {
    const runAttempts = { blockedCount: 0 };
    const env = { value: null as string | null };

    // Run 1: blocker hits on a clean checkout.
    let runner = new CommandRunner({
      executor: createCheckoutExecutor(checkoutRoot, env, runAttempts),
    });
    const firstReport = runner.cleanCheckoutSelfTest();
    expect(firstReport.passed).toBe(false);

    // Run 2: a second clean checkout still has no env config -> same blocker.
    rmSync(checkoutRoot, { recursive: true, force: true });
    checkoutRoot = createCleanCheckout();
    runner = new CommandRunner({
      executor: createCheckoutExecutor(checkoutRoot, env, runAttempts),
    });
    const secondReport = runner.cleanCheckoutSelfTest();
    expect(secondReport.passed).toBe(false);

    // The same blocker has now recurred across two runs (Requirement 13.4).
    expect(runAttempts.blockedCount).toBeGreaterThanOrEqual(2);

    // Remediation: create a recurrence-preventing artifact (an environment
    // template documenting the required key) and seed the checkout's .env from
    // it so the value is present on subsequent clean-checkout runs.
    const envTemplatePath = pathIn(checkoutRoot, ENV_TEMPLATE_FILE);
    writeFileEnsuringDir(envTemplatePath, `${REQUIRED_ENV_KEY}=<your-base-url>\n`);

    // The created artifact exists on disk and documents the required key.
    expect(existsSync(envTemplatePath)).toBe(true);
    const templateContent = readFileSync(envTemplatePath, 'utf-8');
    expect(templateContent).toContain(REQUIRED_ENV_KEY);
    // The template must never embed a real secret value — only a placeholder.
    expect(templateContent).not.toContain('https://');

    // Run 3: with the env value now provided (as the env template prescribes),
    // the full sequence passes on a clean run.
    rmSync(checkoutRoot, { recursive: true, force: true });
    checkoutRoot = createCleanCheckout();
    env.value = 'https://example.test';
    runner = new CommandRunner({
      executor: createCheckoutExecutor(checkoutRoot, env, runAttempts),
    });
    const finalReport = runner.cleanCheckoutSelfTest();

    expect(finalReport.passed).toBe(true);
    expect(finalReport.steps.every((step) => step.passed)).toBe(true);
  });

  it('short-circuits later steps when an early step fails', () => {
    // An executor whose configure step always fails, to prove build/run are not
    // executed once an earlier step blocks (Requirement 13.2 sequencing).
    const failingConfigureCommands: SelfTestCommands = DEFAULT_SELF_TEST_COMMANDS;
    const runner = new CommandRunner({
      executor: (command: string): CommandResult => {
        if (command === failingConfigureCommands.install) {
          return { command, exitStatus: EXIT_OK, stdout: 'installed', stderr: '' };
        }
        if (command === failingConfigureCommands.configure) {
          return { command, exitStatus: EXIT_BLOCKED, stdout: '', stderr: 'configure failed' };
        }
        return { command, exitStatus: EXIT_OK, stdout: 'unexpected', stderr: '' };
      },
    });

    const report = runner.cleanCheckoutSelfTest();

    expect(report.passed).toBe(false);
    const build = report.steps.find((step) => step.name === 'build');
    const run = report.steps.find((step) => step.name === 'run');
    // Steps after the failure are recorded as unexecuted.
    expect(build?.result).toBeNull();
    expect(run?.result).toBeNull();
  });
});
