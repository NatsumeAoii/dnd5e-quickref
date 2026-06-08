// Feature: pre-ship-finalization, Property 31: Version conflicts resolve to the highest-precedence version
//
// Property 31 (design "Correctness Properties"):
//   For any set of conflicting conforming versions declared across the
//   Manifest_Files, the version selected for alignment SHALL be the
//   highest-precedence SemVer in the set by SemVer 2.0.0 precedence, so every
//   Manifest_File can be updated to that single value.
//
// **Validates: Requirements 8.2**
//
// This test exercises `detectVersionConsistency` from
// `src/finalization/VersionDetector.ts`. It generates sets of conflicting (not
// byte-for-byte identical) but individually conforming SemVer strings, assigns
// them across the Manifest_Files (package.json / package-lock.json /
// manifest.json as JSON `.version`, CHANGELOG.md as the top entry version),
// and asserts the `selected` version equals the maximum of the set as ranked
// by `compareSemVer` from SemVer.ts — used here as an independent oracle.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { detectVersionConsistency } from '../VersionDetector';
import { parseSemVer, compareSemVer, type SemVer } from '../SemVer';
import type { FileRecord } from '../types';

/**
 * The Manifest_Files that declare a version, paired with how their content is
 * built from a raw version string. The order mirrors `MANIFEST_FILES` in the
 * detector so generated assignments line up with the inspected files.
 */
const MANIFEST_BUILDERS: readonly {
  readonly path: string;
  readonly build: (version: string) => string;
  readonly language: FileRecord['language'];
}[] = [
  {
    path: 'package.json',
    build: (version) => JSON.stringify({ name: 'pkg', version }, null, 2),
    language: 'json',
  },
  {
    path: 'package-lock.json',
    build: (version) =>
      JSON.stringify({ name: 'pkg', version, lockfileVersion: 3 }, null, 2),
    language: 'json',
  },
  {
    path: 'manifest.json',
    build: (version) => JSON.stringify({ name: 'app', version }, null, 2),
    language: 'json',
  },
  {
    path: 'CHANGELOG.md',
    build: (version) =>
      `# Changelog\n\n## [${version}] - 2024-01-01\n\n- Initial release.\n`,
    language: 'markdown',
  },
];

/**
 * Generate a conforming SemVer string. Numeric core groups are kept small so
 * conflicts and ties occur frequently; an optional pre-release segment
 * exercises pre-release precedence (1.0.0-alpha < 1.0.0).
 */
const coreArb = fc.tuple(
  fc.nat({ max: 5 }),
  fc.nat({ max: 5 }),
  fc.nat({ max: 5 }),
);

/** A single pre-release identifier: numeric (no leading zeros) or alphanumeric. */
const prereleaseIdentifierArb = fc.oneof(
  fc.nat({ max: 20 }).map((n) => String(n)),
  fc.constantFrom('alpha', 'beta', 'rc', 'rc1', 'dev', 'x'),
);

const prereleaseArb = fc.oneof(
  fc.constant(''),
  fc
    .array(prereleaseIdentifierArb, { minLength: 1, maxLength: 3 })
    .map((ids) => `-${ids.join('.')}`),
);

const semverStringArb: fc.Arbitrary<string> = fc
  .tuple(coreArb, prereleaseArb)
  .map(([[major, minor, patch], pre]) => `${major}.${minor}.${patch}${pre}`);

/**
 * A set of conflicting conforming versions: between two and four distinct raw
 * strings (distinctness guarantees a genuine conflict, i.e. not byte-for-byte
 * identical), each assigned to one Manifest_File in declaration order.
 */
const conflictingSetArb: fc.Arbitrary<readonly string[]> = fc
  .uniqueArray(semverStringArb, { minLength: 2, maxLength: MANIFEST_BUILDERS.length })
  .filter((versions) => {
    // Reject sets whose distinct raw strings collapse to the same parse, so the
    // assigned files truly carry different declared versions.
    const raws = new Set(versions);
    return raws.size >= 2;
  });

function recordFor(index: number, version: string): FileRecord {
  const builder = MANIFEST_BUILDERS[index];
  const content = builder.build(version);
  return {
    path: builder.path,
    content,
    bytes: content.length,
    readError: null,
    language: builder.language,
  };
}

/** Independent oracle: the highest-precedence version by `compareSemVer`. */
function maxByPrecedence(parsed: readonly SemVer[]): SemVer {
  return parsed.reduce((best, current) =>
    compareSemVer(current, best) > 0 ? current : best,
  );
}

describe('Property 31: Version conflicts resolve to the highest-precedence version', () => {
  it('selects the maximum SemVer of the conflicting set', () => {
    fc.assert(
      fc.property(conflictingSetArb, (versions) => {
        const records = versions.map((version, index) =>
          recordFor(index, version),
        );

        const comparison = detectVersionConsistency(records);

        // A genuine conflict: the declared versions are not byte-for-byte equal.
        expect(comparison.allIdentical).toBe(false);

        // Every declared version conforms, so a selection must exist.
        expect(comparison.selected).not.toBeNull();
        const selected = comparison.selected as SemVer;

        // Oracle: the maximum by SemVer precedence over the parsed inputs.
        const parsed = versions.map((version) => {
          const semver = parseSemVer(version);
          expect(semver).not.toBeNull();
          return semver as SemVer;
        });
        const expectedMax = maxByPrecedence(parsed);

        // The selected version ties with the oracle maximum (equal precedence).
        expect(compareSemVer(selected, expectedMax)).toBe(0);

        // And it dominates every declared version: nothing outranks it.
        for (const entry of comparison.versions) {
          expect(entry.parsed).not.toBeNull();
          expect(compareSemVer(entry.parsed as SemVer, selected)).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('aligns every Manifest_File to the selected version (none outranks it)', () => {
    fc.assert(
      fc.property(conflictingSetArb, (versions) => {
        const records = versions.map((version, index) =>
          recordFor(index, version),
        );

        const comparison = detectVersionConsistency(records);
        const selected = comparison.selected as SemVer;

        // The selected version is itself one of the declared versions, so every
        // file can be updated to a value that is present in the set.
        const matchesADeclared = comparison.versions.some(
          (entry) =>
            entry.parsed !== null &&
            compareSemVer(entry.parsed, selected) === 0,
        );
        expect(matchesADeclared).toBe(true);

        // Each Manifest_File that declares a version is represented exactly once.
        expect(comparison.versions.length).toBe(records.length);
      }),
      { numRuns: 200 },
    );
  });
});
