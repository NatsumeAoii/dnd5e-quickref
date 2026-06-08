// Feature: pre-ship-finalization, Property 6: Undetermined detection on missing input or ambiguous lockfiles
//
// Property 6: Undetermined detection on missing input or ambiguous lockfiles
//
// For any detection input, when a required input is absent or two or more
// distinct lockfiles are present, the affected result SHALL be 'undetermined'
// with a recorded reason, and the pass SHALL continue; otherwise the result
// SHALL be determined.
//
// **Validates: Requirements 2.6**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { detectProjectType } from '../ProjectTypeDetector.js';
import type { FileRecord, SourceLanguage } from '../types.js';

const UNDETERMINED = 'undetermined';
const MIN_RUNS = 100;

/** Known dependency lockfile basenames and the manager each identifies. */
const LOCKFILE_TO_MANAGER: Readonly<Record<string, string>> = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
};

const KNOWN_LOCKFILES: readonly string[] = Object.keys(LOCKFILE_TO_MANAGER);

/** Build a minimal in-memory FileRecord for a generated path. */
function record(
  path: string,
  content = '',
  language: SourceLanguage = 'other',
): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language,
  };
}

/** Count of distinct package managers implied by a set of lockfile names. */
function distinctManagers(lockfiles: readonly string[]): Set<string> {
  return new Set(lockfiles.map((name) => LOCKFILE_TO_MANAGER[name]));
}

describe('Property 6: Undetermined detection on missing input or ambiguous lockfiles', () => {
  it('marks packageManager undetermined (with a reason) on zero or multiple distinct lockfiles, determined on exactly one', () => {
    fc.assert(
      fc.property(
        // Any subset of the known lockfiles may be present in the tree.
        fc.subarray([...KNOWN_LOCKFILES]),
        // Arbitrary non-lockfile source noise to vary the inventory.
        fc.array(
          fc.constantFrom('src/a.ts', 'src/b.ts', 'src/c.css', 'index.html'),
          { maxLength: 5 },
        ),
        (lockfiles, noise) => {
          const records: FileRecord[] = [
            ...lockfiles.map((name) => record(name, '{}', 'json')),
            ...noise.map((p) => record(p, 'x', 'typescript')),
          ];

          const result = detectProjectType(records);
          const managers = distinctManagers(lockfiles);

          if (managers.size === 1) {
            // Exactly one distinct manager: the result is determined.
            expect(result.packageManager).toBe([...managers][0]);
            expect(result.packageManager).not.toBe(UNDETERMINED);
          } else {
            // Zero, or two-or-more distinct lockfiles: undetermined + reason.
            expect(result.packageManager).toBe(UNDETERMINED);
            expect(
              result.notes.some((note) => note.startsWith('packageManager')),
            ).toBe(true);
          }

          // The pass always continues and returns a well-formed result.
          expect(Array.isArray(result.notes)).toBe(true);
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });

  it('marks environment undetermined (with a reason) when the required package.json input is absent', () => {
    fc.assert(
      fc.property(
        // Source files that never include a package.json.
        fc.array(
          fc.constantFrom(
            'src/a.ts',
            'src/b.ts',
            'src/styles.css',
            'index.html',
            'README.md',
          ),
          { maxLength: 6 },
        ),
        (paths) => {
          // The generated paths never include package.json, so the required
          // input is guaranteed absent for this case.
          const records = paths.map((p) => record(p, 'content', 'typescript'));

          const result = detectProjectType(records);

          // A required input (package.json) is absent -> undetermined + reason.
          expect(result.environment).toBe(UNDETERMINED);
          expect(
            result.notes.some((note) => note.startsWith('environment')),
          ).toBe(true);
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });

  it('marks environment undetermined (with a reason) when package.json is present but declares no engines', () => {
    fc.assert(
      fc.property(
        // package.json objects that never carry a string "engines" constraint.
        fc.oneof(
          fc.constant<Record<string, unknown>>({}),
          fc.constant<Record<string, unknown>>({ name: 'pkg' }),
          fc.constant<Record<string, unknown>>({ engines: {} }),
          fc.constant<Record<string, unknown>>({ scripts: { build: 'vite' } }),
        ),
        (pkg) => {
          const records = [record('package.json', JSON.stringify(pkg), 'json')];

          const result = detectProjectType(records);

          expect(result.environment).toBe(UNDETERMINED);
          expect(
            result.notes.some((note) => note.startsWith('environment')),
          ).toBe(true);
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });

  it('returns determined results when required inputs are present and exactly one lockfile exists', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'package-lock.json',
          'yarn.lock',
          'pnpm-lock.yaml',
          'bun.lock',
        ),
        fc.constantFrom('>=18', '>=20', '>=22'),
        (lockfile, nodeVersion) => {
          const pkg = JSON.stringify({ engines: { node: nodeVersion } });
          const records: FileRecord[] = [
            record('package.json', pkg, 'json'),
            record(lockfile, '', 'other'),
          ];

          const result = detectProjectType(records);

          // Exactly one lockfile -> package manager is determined.
          expect(result.packageManager).not.toBe(UNDETERMINED);
          expect(result.packageManager).toBe(LOCKFILE_TO_MANAGER[lockfile]);

          // package.json with engines -> environment is determined.
          expect(result.environment).not.toBe(UNDETERMINED);
          expect(result.environment).toContain(nodeVersion);
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });
});
