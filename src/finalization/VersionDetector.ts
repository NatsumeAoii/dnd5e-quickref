// Feature: pre-ship-finalization
//
// VersionDetector (pure analysis core).
//
// Compares the version declared across the project's Manifest_Files and reports
// whether they agree. This module performs no I/O: it operates only over the
// `FileRecord[]` produced by the FileInventory and returns a structured
// `VersionComparison`. The fixer/orchestrator layers act on the result.
//
// Manifest_Files (Requirement 8, "Manifest_File" definition):
//   - package.json        -> JSON `.version`
//   - package-lock.json   -> JSON root `.version`
//   - manifest.json (PWA) -> JSON `.version` (often absent; omitted when so)
//   - CHANGELOG.md        -> the version in the most recent (top) entry heading
//
// Behavior (Requirements 8.1, 8.2, 8.5, 8.6):
//   - 8.1: declared version strings are compared byte-for-byte for identity.
//   - 8.2: when conforming versions conflict, the highest-precedence SemVer is
//          selected so every Manifest_File can be aligned to it.
//   - 8.3/8.4: each declared version is validated against SemVer; a
//          non-conforming value parses to `null` so its file is left unchanged.
//   - 8.5/8.6: the top CHANGELOG.md entry's version is compared byte-for-byte
//          against the declared package version.

import {
  parseSemVer,
  compareSemVer,
  type SemVer,
} from './SemVer.js';
import type { FileRecord } from './types.js';

/**
 * The repo-relative basenames of the Manifest_Files inspected for version
 * consistency. `manifest.json` is the PWA manifest; it only contributes when
 * it actually declares a `version`.
 */
export const MANIFEST_FILES: readonly string[] = [
  'package.json',
  'package-lock.json',
  'manifest.json',
  'CHANGELOG.md',
];

/** The Manifest_File whose version is treated as the declared package version. */
const PACKAGE_MANIFEST = 'package.json';

/** The Manifest_File whose top entry is compared against the package version. */
const CHANGELOG_MANIFEST = 'CHANGELOG.md';

/**
 * A version declared by a single Manifest_File.
 *
 * `rawVersion` is the exact string as read (for byte-for-byte comparison).
 * `parsed` is the SemVer interpretation, or `null` when the value does not
 * conform to semantic versioning, in which case the file is left unchanged
 * (Requirement 8.4).
 */
export interface ManifestVersion {
  /** Manifest_File basename, e.g. `package.json`, `CHANGELOG.md`. */
  readonly file: string;
  /** The declared version string exactly as read. */
  readonly rawVersion: string;
  /** Parsed SemVer, or `null` when non-conforming (Requirement 8.4). */
  readonly parsed: SemVer | null;
}

/**
 * The outcome of comparing versions across the Manifest_Files.
 *
 * `versions` lists every Manifest_File that declares a version. `allIdentical`
 * is the byte-for-byte identity check (Requirement 8.1). `selected` is the
 * highest-precedence conforming version, the value every file should align to
 * when there is a conflict (Requirement 8.2); it is `null` when no declared
 * version conforms to SemVer. `changelogMatchesPackage` records whether the
 * top CHANGELOG.md entry equals the declared package version byte-for-byte
 * (Requirements 8.5, 8.6).
 */
export interface VersionComparison {
  readonly versions: readonly ManifestVersion[];
  readonly allIdentical: boolean;
  readonly selected: SemVer | null;
  readonly changelogMatchesPackage: boolean;
}

/**
 * Build the {@link VersionComparison} for the read inventory. Pure and
 * deterministic: the same records always yield the same comparison.
 */
export function detectVersionConsistency(
  records: readonly FileRecord[],
): VersionComparison {
  const versions = extractManifestVersions(records);

  return {
    versions,
    allIdentical: areVersionsIdentical(versions),
    selected: selectHighestPrecedence(versions),
    changelogMatchesPackage: doesChangelogMatchPackage(versions),
  };
}

/**
 * Extract one {@link ManifestVersion} for each Manifest_File that declares a
 * version. Files that are absent, unreadable, malformed, or that declare no
 * version are simply omitted (there is nothing to compare). The result is
 * ordered to follow {@link MANIFEST_FILES} for stable, deterministic output.
 */
export function extractManifestVersions(
  records: readonly FileRecord[],
): readonly ManifestVersion[] {
  const versions: ManifestVersion[] = [];

  for (const file of MANIFEST_FILES) {
    const record = records.find((entry) => basename(entry.path) === file);
    if (record === undefined || record.content === null) {
      continue;
    }

    const rawVersion =
      file === CHANGELOG_MANIFEST
        ? extractChangelogVersion(record.content)
        : extractJsonVersion(record.content);

    if (rawVersion === null) {
      continue;
    }

    versions.push({
      file,
      rawVersion,
      parsed: parseSemVer(rawVersion),
    });
  }

  return versions;
}

/**
 * Read the `version` field from a JSON manifest, returning the exact string
 * value or `null` when the file is not valid JSON, is not an object, or
 * declares no string `version`.
 */
function extractJsonVersion(content: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const version = (parsed as Record<string, unknown>)['version'];
  return typeof version === 'string' ? version : null;
}

/**
 * Heading of the form `## [VERSION] - date` (any heading level, any number of
 * leading `#`). The first match scanning top-down is the most recent entry.
 * The bracketed token is captured verbatim for byte-for-byte comparison.
 */
const CHANGELOG_ENTRY_PATTERN = /^#{1,6}\s*\[([^\]]+)\]/m;

/**
 * Extract the version of the most recent (top-most) CHANGELOG.md entry. Returns
 * the bracketed token exactly as written, or `null` when no bracketed entry
 * heading is present. A non-version token such as `Unreleased` is returned
 * as-is so the caller can detect the mismatch (it will not parse as SemVer and
 * will not equal the package version byte-for-byte).
 */
function extractChangelogVersion(content: string): string | null {
  const match = CHANGELOG_ENTRY_PATTERN.exec(content);
  if (match === null) {
    return null;
  }
  return match[1];
}

/**
 * Byte-for-byte identity across every declared version (Requirement 8.1). An
 * empty or single-element set is trivially identical.
 */
function areVersionsIdentical(
  versions: readonly ManifestVersion[],
): boolean {
  if (versions.length <= 1) {
    return true;
  }
  const first = versions[0]!.rawVersion;
  return versions.every((entry) => entry.rawVersion === first);
}

/**
 * Select the highest-precedence conforming version (Requirement 8.2). Versions
 * that do not parse are ignored (they are left unchanged per 8.4). Returns
 * `null` when no declared version conforms to SemVer.
 */
function selectHighestPrecedence(
  versions: readonly ManifestVersion[],
): SemVer | null {
  let selected: SemVer | null = null;
  for (const entry of versions) {
    if (entry.parsed === null) {
      continue;
    }
    if (selected === null || compareSemVer(entry.parsed, selected) > 0) {
      selected = entry.parsed;
    }
  }
  return selected;
}

/**
 * Whether the top CHANGELOG.md entry's version equals the declared package
 * version byte-for-byte (Requirements 8.5, 8.6). Returns `false` when either
 * the CHANGELOG.md entry or the package version is absent, so callers should
 * consult `versions` to distinguish "absent" from "mismatched".
 */
function doesChangelogMatchPackage(
  versions: readonly ManifestVersion[],
): boolean {
  const changelog = versions.find(
    (entry) => entry.file === CHANGELOG_MANIFEST,
  );
  const packageVersion = versions.find(
    (entry) => entry.file === PACKAGE_MANIFEST,
  );
  if (changelog === undefined || packageVersion === undefined) {
    return false;
  }
  return changelog.rawVersion === packageVersion.rawVersion;
}

/** Extract the final path segment from a POSIX repo-relative path. */
function basename(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}
