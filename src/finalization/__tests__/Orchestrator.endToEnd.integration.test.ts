// @vitest-environment node
//
// Feature: pre-ship-finalization
//
// End-to-end integration test for FinalizationOrchestrator.run (Task 20.2).
//
// Validates: Requirements 3.6, 14.1, 14.3, 15.1
//
// This drives the full pass against a real temporary fixture tree on disk,
// following the @ts-expect-error node-import convention used by the sibling
// integration tests (FileInventoryReads.test.ts,
// CommandRunner.selfTest.integration.test.ts). The fixture contains a handful of
// files carrying auto-fixable, deterministically-convergent defects:
//
//   - `.gitignore` missing the transient directories `dev/` and `scratch/`
//     (Requirement 7.3) — fixed idempotently by appending the missing rules.
//   - `src/app.ts` carrying a leftover debug `console.log` (Requirement 3.1) —
//     removed by the dead-code fixer.
//   - `package.json` missing the required `description` field (Requirement 12.1)
//     — added with a `[FILL IN]` placeholder, preserving existing values.
//
// The pass uses the default disk EditApplier (no editApplier is injected) so the
// converged edits persist to the temp tree and the second pass genuinely reads
// the finalized files from disk. Only a CommandRunner whose executor returns
// exit 0 for the lint/type-check/test gates is injected, so the pass converges
// deterministically without spawning real npm. All disk work is confined to the
// temp directory, which is removed after each test.
//
// Assertions, one per acceptance criterion:
//   15.1 — the rendered summary contains exactly one `## Finalization Summary`
//          heading and is well-formed (the expected subsections are present).
//   3.6 / 14.1 — the injected gates model the test suite passing, so the pass
//          introduces no new test-suite failures from its edits: every
//          verification command exits 0 and the report is marked completed.
//   14.3 — a second pass over the finalized tree is idempotent: it produces zero
//          new changed files and zero self-corrections, and stays completed.

// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { tmpdir } from 'node:os';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CommandRunner,
  type CommandResult,
} from '../CommandRunner';
import { FinalizationOrchestrator } from '../Orchestrator';
import {
  INCOMPLETE_NOTICE,
  SUMMARY_HEADING,
} from '../ReportBuilder';

/** Exit code reported for every gate so the pass converges to a passing state. */
const EXIT_OK = 0;

/** The project's verification commands the orchestrator runs at the final gate. */
const VERIFICATION_COMMANDS = ['npm run lint', 'npm run type-check', 'npm run test'];

/**
 * A deterministic executor that reports success for every command. The
 * orchestrator only runs the lint/type-check/test gates, so modelling them as
 * passing means the pass converges without spawning real processes — and, per
 * Requirements 3.6/14.1, models the existing test suite staying green after the
 * fixers' edits.
 */
const passingExecutor = (command: string): CommandResult => ({
  command,
  exitStatus: EXIT_OK,
  stdout: '',
  stderr: '',
});

/** Write a file inside the fixture tree, creating parent directories as needed. */
function writeFixtureFile(root: string, relativePath: string, content: string): void {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf-8');
}

/** Read a finalized file back from the fixture tree as UTF-8 text. */
function readFixtureFile(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf-8') as string;
}

/**
 * A `.gitignore` that covers every required category (build output, deps,
 * env/secrets, OS metadata, logs) and the transient dirs `temp/`/`tmp/`, but is
 * missing explicit rules for `dev/` and `scratch/` (Requirement 7.3). The fix
 * appends only the two missing rules and is idempotent on a second pass.
 */
const GITIGNORE_CONTENT = [
  '# Dependencies',
  'node_modules/',
  '',
  '# Build output',
  'dist/',
  '',
  '# Environment / secrets',
  '.env',
  '.env.*',
  '!.env.example',
  '',
  '# Logs',
  '*.log',
  '',
  '# OS files',
  '.DS_Store',
  'Thumbs.db',
  '',
  '# Transient working directories (partial)',
  'temp/',
  'tmp/',
  '',
].join('\n');

/**
 * A complete README satisfying every required onboarding topic (project
 * description via the intro under the H1, installation, configuration,
 * development, deployment), so no README deficiency findings block convergence
 * (Requirements 7.5/7.6).
 */
const README_CONTENT = [
  '# Fixture App',
  '',
  'A small fixture application used to exercise the finalization pass end to end.',
  '',
  '## Installation',
  '',
  'Run `npm install` to set up the project dependencies.',
  '',
  '## Configuration',
  '',
  'Copy the environment template and adjust the values for your machine.',
  '',
  '## Development',
  '',
  'Run `npm run dev` to start the local development server.',
  '',
  '## Deployment',
  '',
  'Deploy the built output to the static host of your choice.',
  '',
].join('\n');

/**
 * A valid `package.json` with the required `name`, `version`, `license`, and
 * `repository` fields, but deliberately missing `description` (Requirement 12.1).
 * The fixer adds `description` with a `[FILL IN]` placeholder; on a second pass
 * the now-populated field is no longer flagged, so the pass stays stable.
 */
const PACKAGE_JSON_CONTENT = `${JSON.stringify(
  {
    name: 'fixture-app',
    version: '1.0.0',
    private: true,
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/example/fixture-app.git',
    },
  },
  null,
  2,
)}\n`;

/**
 * A source entry file carrying a leftover debug `console.log` (Requirement 3.1).
 * Naming it `app.ts` marks it as an entry file so it is not separately flagged
 * as an unreferenced file; it declares no symbols, so the only finding is the
 * removable debug call. `export {}` keeps it a valid ES module after the fix.
 */
const APP_TS_CONTENT = ["console.log('debug output left in source');", 'export {};', ''].join('\n');

/** Build the full fixture tree under `root`. */
function createFixtureTree(root: string): void {
  writeFixtureFile(root, '.gitignore', GITIGNORE_CONTENT);
  writeFixtureFile(root, 'README.md', README_CONTENT);
  writeFixtureFile(root, 'package.json', PACKAGE_JSON_CONTENT);
  writeFixtureFile(root, 'src/app.ts', APP_TS_CONTENT);
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('FinalizationOrchestrator.run end-to-end (integration)', () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'finalization-e2e-'));
    createFixtureTree(fixtureRoot);
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('produces a single well-formed Finalization Summary and converges with passing gates', () => {
    const orchestrator = new FinalizationOrchestrator({
      commandRunner: new CommandRunner({ executor: passingExecutor }),
    });

    const { report, summary } = orchestrator.run(fixtureRoot);

    // Requirement 15.1 — exactly one summary heading.
    expect(countOccurrences(summary, SUMMARY_HEADING)).toBe(1);

    // Well-formed: the summary leads with the heading and carries the expected
    // subsections (project type, changed files, verification statuses).
    expect(summary.startsWith(SUMMARY_HEADING)).toBe(true);
    expect(summary).toContain('### Detected project type');
    expect(summary).toContain('### Changed and created files');
    expect(summary).toContain('### Verification command statuses');
    // A completed pass carries no early-termination notice (Requirement 15.7).
    expect(summary).not.toContain(INCOMPLETE_NOTICE);

    // Requirements 3.6 / 14.1 — the injected gates model the test suite passing,
    // so the pass introduces no new test-suite failures from its edits: every
    // verification command was run and exited 0, and the pass completed.
    expect(report.commandStatuses.map((result) => result.command)).toEqual(
      VERIFICATION_COMMANDS,
    );
    expect(report.commandStatuses.every((result) => result.exitStatus === EXIT_OK)).toBe(true);
    const testGate = report.commandStatuses.find((result) => result.command === 'npm run test');
    expect(testGate?.exitStatus).toBe(EXIT_OK);
    expect(report.completed).toBe(true);
    expect(report.remainingIssues).toHaveLength(0);

    // The pass actually fixed the seeded defects and persisted them to disk.
    expect(report.changedFiles.length).toBeGreaterThan(0);

    const appSource = readFixtureFile(fixtureRoot, 'src/app.ts');
    expect(appSource).not.toContain('console.log');

    const gitignore = readFixtureFile(fixtureRoot, '.gitignore');
    expect(gitignore).toContain('dev/');
    expect(gitignore).toContain('scratch/');

    const packageJson = readFixtureFile(fixtureRoot, 'package.json');
    expect(packageJson).toContain('"description"');
    // The missing field was filled with a tracked placeholder, reported back.
    expect(report.placeholders.length).toBeGreaterThan(0);
    expect(report.placeholders.some((ref) => ref.path === 'package.json')).toBe(true);
  });

  it('is idempotent: a second pass over the finalized tree yields no new fixes', () => {
    const orchestrator = new FinalizationOrchestrator({
      commandRunner: new CommandRunner({ executor: passingExecutor }),
    });

    // First pass finalizes the tree on disk.
    const first = orchestrator.run(fixtureRoot);
    expect(first.report.changedFiles.length).toBeGreaterThan(0);
    expect(first.report.completed).toBe(true);

    // Second pass re-enumerates the finalized files from disk (Requirement 14.3).
    const second = orchestrator.run(fixtureRoot);

    // Stable: zero new changed/created files and zero self-corrections.
    expect(second.report.changedFiles).toHaveLength(0);
    expect(second.report.selfCorrections).toHaveLength(0);
    expect(second.report.remainingIssues).toHaveLength(0);
    expect(second.report.completed).toBe(true);

    // The second summary is still a single well-formed report.
    expect(countOccurrences(second.summary, SUMMARY_HEADING)).toBe(1);
    expect(second.summary).not.toContain(INCOMPLETE_NOTICE);
  });
});
