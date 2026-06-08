// Feature: pre-ship-finalization
//
// Semantic Versioning 2.0.0 parsing, formatting, and precedence comparison.
//
// These are pure functions with no I/O. They back the VersionDetector
// (Requirement 8): parsing validates that a declared version conforms to
// SemVer (8.3) so non-conforming manifests can be left unchanged (8.4), and
// comparison resolves version conflicts to the highest-precedence value (8.2).
//
// Precedence follows the SemVer 2.0.0 specification (https://semver.org/):
//   - Major, minor, and patch are compared numerically.
//   - A version with a pre-release segment has LOWER precedence than the
//     associated normal version (1.0.0-alpha < 1.0.0).
//   - Build metadata is ignored entirely for precedence.

/**
 * A parsed semantic version.
 *
 * `prerelease` identifiers that are purely numeric are stored as `number`
 * (compared numerically); all other identifiers are stored as `string`.
 * `build` metadata identifiers are always stored as raw strings because they
 * never participate in precedence. `raw` preserves the original input string.
 */
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
  readonly build: readonly string[];
  readonly raw: string;
}

/**
 * Official SemVer 2.0.0 grammar (anchored). Capture groups:
 *   1: major, 2: minor, 3: patch, 4: pre-release (optional), 5: build (optional)
 *
 * Numeric core/identifiers reject leading zeros via `0|[1-9]\d*`.
 */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** A pre-release identifier that is composed solely of digits. */
const NUMERIC_IDENTIFIER = /^[0-9]+$/;

/**
 * Parse a version string into a {@link SemVer}, or return `null` when the
 * input does not conform to SemVer 2.0.0 (Requirement 8.3/8.4).
 *
 * Numeric pre-release identifiers are normalized to `number`; the grammar
 * guarantees they carry no leading zeros, so the conversion is lossless.
 */
export function parseSemVer(raw: string): SemVer | null {
  const match = SEMVER_PATTERN.exec(raw);
  if (match === null) {
    return null;
  }

  const [, majorText, minorText, patchText, prereleaseText, buildText] = match;

  // The three core groups are non-optional in the grammar, so they are always
  // present when the pattern matches.
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);

  const prerelease: (string | number)[] =
    prereleaseText === undefined
      ? []
      : prereleaseText
          .split('.')
          .map((identifier) =>
            NUMERIC_IDENTIFIER.test(identifier)
              ? Number(identifier)
              : identifier,
          );

  const build: string[] =
    buildText === undefined ? [] : buildText.split('.');

  return { major, minor, patch, prerelease, build, raw };
}

/**
 * Format a {@link SemVer} as `MAJOR.MINOR.PATCH` with an optional pre-release
 * segment. Build metadata is intentionally excluded because it does not affect
 * precedence and is not part of the version's precedence-bearing identity.
 */
export function formatSemVer(version: SemVer): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  if (version.prerelease.length === 0) {
    return core;
  }
  return `${core}-${version.prerelease.join('.')}`;
}

/**
 * Compare two pre-release identifiers per SemVer 2.0.0 rules:
 *   - Two numeric identifiers compare numerically.
 *   - Two alphanumeric identifiers compare lexically in ASCII sort order.
 *   - A numeric identifier always has lower precedence than an alphanumeric one.
 */
function compareIdentifier(
  a: string | number,
  b: string | number,
): -1 | 0 | 1 {
  const aIsNumber = typeof a === 'number';
  const bIsNumber = typeof b === 'number';

  if (aIsNumber && bIsNumber) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (aIsNumber) return -1;
  if (bIsNumber) return 1;

  // Both alphanumeric: compare as ASCII strings.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Compare the pre-release segments of two versions whose cores are equal.
 *
 * A version with no pre-release has higher precedence than one that has a
 * pre-release. When both have pre-release segments, identifiers are compared
 * left to right; if all shared identifiers are equal, the version with more
 * identifiers has higher precedence.
 */
function comparePrerelease(
  a: readonly (string | number)[],
  b: readonly (string | number)[],
): -1 | 0 | 1 {
  const aHasPrerelease = a.length > 0;
  const bHasPrerelease = b.length > 0;

  if (!aHasPrerelease && !bHasPrerelease) return 0;
  // No pre-release outranks any pre-release.
  if (!aHasPrerelease) return 1;
  if (!bHasPrerelease) return -1;

  const sharedLength = Math.min(a.length, b.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const result = compareIdentifier(a[index]!, b[index]!);
    if (result !== 0) {
      return result;
    }
  }

  // All shared identifiers equal: the longer set of identifiers wins.
  if (a.length < b.length) return -1;
  if (a.length > b.length) return 1;
  return 0;
}

/**
 * Compare two versions by SemVer 2.0.0 precedence, returning `-1` when `a`
 * precedes `b`, `1` when `a` follows `b`, and `0` when they have equal
 * precedence. Build metadata is ignored.
 */
export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}
