// @vitest-environment node
//
// Feature: pre-ship-finalization, Task 4.6
//
// Unit test for CHANGELOG-vs-package version equality in the VersionDetector.
// Builds a FileRecord[] from this repository's real CHANGELOG.md and
// package.json, then asserts the detector compares the top CHANGELOG entry
// version against the declared package version (changelogMatchesPackage).
// A second, synthetic case where the two versions differ verifies that both
// versions are still recorded so the mismatch is reportable (Requirement 8.6).
//
// _Requirements: 8.5, 8.6_

// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { detectVersionConsistency } from '../VersionDetector.js';
import type { FileRecord } from '../types.js';

/**
 * The two real Manifest_Files this test feeds to the detector. Each entry's
 * repo-relative POSIX path is what the detector matches against, and `language`
 * mirrors what the FileInventory derives from the file extension.
 */
const MANIFEST_FILES: ReadonlyArray<{
  readonly path: string;
  readonly url: string;
  readonly language: FileRecord['language'];
}> = [
  { path: 'package.json', url: '../../../package.json', language: 'json' },
  { path: 'CHANGELOG.md', url: '../../../CHANGELOG.md', language: 'markdown' },
];

/** Read a real repository file into the shared FileRecord contract. */
function buildRecord(file: (typeof MANIFEST_FILES)[number]): FileRecord {
  const fileUrl = new URL(file.url, import.meta.url);
  const content = readFileSync(fileUrl, 'utf8') as string;
  const bytes = (statSync(fileUrl) as { size: number }).size;
  return {
    path: file.path,
    content,
    bytes,
    readError: null,
    language: file.language,
  };
}

describe('VersionDetector CHANGELOG-vs-package equality (task 4.6)', () => {
  describe('against this repository (Req 8.5)', () => {
    const records: readonly FileRecord[] = MANIFEST_FILES.map(buildRecord);
    const comparison = detectVersionConsistency(records);

    it('records a version for both package.json and CHANGELOG.md', () => {
      const files = comparison.versions.map((entry) => entry.file);
      expect(files).toContain('package.json');
      expect(files).toContain('CHANGELOG.md');
    });

    it('finds the top CHANGELOG entry equal to the declared package version', () => {
      const changelog = comparison.versions.find(
        (entry) => entry.file === 'CHANGELOG.md',
      );
      const pkg = comparison.versions.find(
        (entry) => entry.file === 'package.json',
      );
      // Byte-for-byte identity is what the detector reports.
      expect(changelog?.rawVersion).toBe(pkg?.rawVersion);
      expect(comparison.changelogMatchesPackage).toBe(true);
    });
  });

  describe('synthetic mismatch case (Req 8.6)', () => {
    // Reuse the real package.json so the declared package version is genuine,
    // but pair it with a CHANGELOG whose top entry intentionally differs.
    const realPackage = buildRecord(MANIFEST_FILES[0]!);
    const declaredVersion = JSON.parse(realPackage.content ?? '{}').version as string;
    const changelogVersion = '9.9.9';

    const mismatchedChangelog: FileRecord = {
      path: 'CHANGELOG.md',
      content: [
        '# Changelog',
        '',
        `## [${changelogVersion}] - 2099-01-01`,
        '',
        '### Added',
        '- A future entry that does not match the package version.',
        '',
      ].join('\n'),
      bytes: 0,
      readError: null,
      language: 'markdown',
    };

    const comparison = detectVersionConsistency([realPackage, mismatchedChangelog]);

    it('confirms the two versions actually differ', () => {
      expect(changelogVersion).not.toBe(declaredVersion);
    });

    it('reports changelogMatchesPackage as false', () => {
      expect(comparison.changelogMatchesPackage).toBe(false);
    });

    it('records both the CHANGELOG and the package versions for reporting', () => {
      const changelog = comparison.versions.find(
        (entry) => entry.file === 'CHANGELOG.md',
      );
      const pkg = comparison.versions.find(
        (entry) => entry.file === 'package.json',
      );
      expect(changelog?.rawVersion).toBe(changelogVersion);
      expect(pkg?.rawVersion).toBe(declaredVersion);
    });
  });
});
