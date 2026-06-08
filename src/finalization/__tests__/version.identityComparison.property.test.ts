// Feature: pre-ship-finalization, Property 30: Version identity comparison is exact
//
// Property 30 (design "Correctness Properties"):
//   For any set of declared manifest version strings, the comparison SHALL
//   report them identical if and only if every string is byte-for-byte equal.
//
// **Validates: Requirements 8.1**
//
// This test exercises `detectVersionConsistency` / `extractManifestVersions`
// from `src/finalization/VersionDetector.ts`. For a generated, non-empty subset
// of the Manifest_Files it assigns each file a version string, builds the
// corresponding `FileRecord`s (JSON `.version` for the package/lock/PWA
// manifests, a top `## [version]` heading for `CHANGELOG.md`), and asserts that
// `allIdentical` is true exactly when the declared version strings are all
// byte-for-byte equal. A reference predicate computed directly from the
// generated inputs — independent of the detector — decides the expected result,
// so a regression in the detector cannot silently agree with a broken oracle.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  detectVersionConsistency,
  MANIFEST_FILES,
} from '../VersionDetector';
import type { FileRecord, SourceLanguage } from '../types';

/** A single Manifest_File and the version string it declares. */
interface FileVersion {
  readonly file: string;
  readonly version: string;
}

/**
 * Version-string charset restricted to characters that round-trip identically
 * through both a JSON string value and a CHANGELOG `[token]` heading: digits,
 * letters, dot, plus, and dash. This deliberately excludes `]`, `"`, `\`, and
 * newlines so the declared string is reproduced byte-for-byte by every
 * extractor — keeping the test focused on the identity comparison rather than
 * on extraction quirks.
 */
const versionCharArb = fc.constantFrom(
  ...'0123456789abcdefABCDEF.+-'.split(''),
);

/** A non-empty version string from the safe charset. */
const versionStringArb = fc
  .array(versionCharArb, { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(''));

/**
 * A scenario: a non-empty subset of Manifest_Files, each assigned a version.
 * Two branches keep the all-identical case well represented despite the large
 * version space: one replicates a single version across every chosen file, the
 * other assigns versions independently (which still occasionally collides).
 */
const scenarioArb: fc.Arbitrary<readonly FileVersion[]> = fc
  .uniqueArray(fc.constantFrom(...MANIFEST_FILES), {
    minLength: 1,
    maxLength: MANIFEST_FILES.length,
  })
  .chain((files) =>
    fc.oneof(
      // All files declare the exact same version string.
      versionStringArb.map((version) =>
        files.map((file) => ({ file, version })),
      ),
      // Each file declares an independently generated version string.
      fc
        .tuple(...files.map(() => versionStringArb))
        .map((versions) =>
          files.map((file, index) => ({ file, version: versions[index] })),
        ),
    ),
  );

/** Build the `FileRecord` for one Manifest_File declaring `version`. */
function buildRecord({ file, version }: FileVersion): FileRecord {
  const isChangelog = file === 'CHANGELOG.md';
  const content = isChangelog
    ? `# Changelog\n\n## [${version}] - 2024-01-01\n\n- Notes.\n`
    : JSON.stringify({ name: 'fixture', version }, null, 2);
  const language: SourceLanguage = isChangelog ? 'markdown' : 'json';
  return {
    path: file,
    content,
    bytes: content.length,
    readError: null,
    language,
  };
}

/** The chosen files in the canonical MANIFEST_FILES order. */
function orderedFiles(scenario: readonly FileVersion[]): readonly FileVersion[] {
  return MANIFEST_FILES.map((file) =>
    scenario.find((entry) => entry.file === file),
  ).filter((entry): entry is FileVersion => entry !== undefined);
}

describe('Property 30: Version identity comparison is exact', () => {
  it('reports allIdentical iff every declared version is byte-for-byte equal', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const records = scenario.map(buildRecord);
        const comparison = detectVersionConsistency(records);

        // Extraction must round-trip every declared string byte-for-byte, in
        // canonical Manifest_File order, so the identity check operates on the
        // exact strings that were declared.
        const expectedOrder = orderedFiles(scenario);
        expect(comparison.versions.map((v) => v.file)).toEqual(
          expectedOrder.map((entry) => entry.file),
        );
        expect(comparison.versions.map((v) => v.rawVersion)).toEqual(
          expectedOrder.map((entry) => entry.version),
        );

        // Independent oracle: identical iff all declared strings are equal.
        const declared = expectedOrder.map((entry) => entry.version);
        const expectedIdentical = declared.every((v) => v === declared[0]);

        expect(comparison.allIdentical).toBe(expectedIdentical);
      }),
      { numRuns: 300 },
    );
  });

  it('flags a single differing byte as non-identical', () => {
    fc.assert(
      fc.property(
        versionStringArb,
        versionCharArb,
        (base, extraChar) => {
          // Two manifests: one with `base`, one with one extra byte appended.
          const differing = `${base}${extraChar}`;
          fc.pre(differing !== base);
          const records = [
            buildRecord({ file: 'package.json', version: base }),
            buildRecord({ file: 'package-lock.json', version: differing }),
          ];
          const comparison = detectVersionConsistency(records);
          expect(comparison.allIdentical).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('treats an empty or single-manifest set as trivially identical', () => {
    const empty = detectVersionConsistency([]);
    expect(empty.allIdentical).toBe(true);

    fc.assert(
      fc.property(versionStringArb, (version) => {
        const comparison = detectVersionConsistency([
          buildRecord({ file: 'package.json', version }),
        ]);
        expect(comparison.allIdentical).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
