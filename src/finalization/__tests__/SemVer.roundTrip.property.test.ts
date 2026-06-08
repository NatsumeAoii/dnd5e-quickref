// Feature: pre-ship-finalization, Property 32: SemVer parsing round-trips and rejects non-conforming input
//
// Property 32 (design "Correctness Properties"):
//   For any valid SemVer 2.0.0 string, parsing then formatting SHALL yield a
//   version equivalent to the input ignoring build metadata (build metadata is
//   excluded from `formatSemVer`). For any non-conforming string, the parser
//   SHALL reject it by returning `null`.
//
// **Validates: Requirements 8.3, 8.4**
//
// This test exercises `parseSemVer` and `formatSemVer` from
// `src/finalization/SemVer.ts`.
//
//   - The round-trip property builds valid SemVer strings from independently
//     generated core numbers plus optional pre-release and build segments,
//     parses them, and asserts that re-formatting reproduces the input with the
//     build metadata stripped. It also confirms the parsed core/pre-release
//     fields match the generated parts so the round-trip is not vacuously true.
//   - The rejection property generates strings that violate the SemVer grammar
//     (leading zeros, missing components, negative or non-numeric core,
//     empty/invalid identifiers, illegal characters) and asserts the parser
//     returns `null`.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { parseSemVer, formatSemVer } from '../SemVer';

/**
 * A non-negative integer with no leading zeros, rendered as a string. SemVer
 * core numbers and numeric identifiers use exactly this shape (`0|[1-9]\d*`).
 */
const numericComponentArb = fc.nat({ max: 1_000_000 });

/**
 * An alphanumeric pre-release identifier guaranteed to contain at least one
 * non-digit (so it is never reinterpreted as a numeric identifier) and to carry
 * no leading-zero ambiguity. Characters are limited to the SemVer identifier
 * alphabet `[0-9A-Za-z-]`.
 */
const alphanumericIdentifierArb = fc
  .stringMatching(/^[0-9A-Za-z-]*$/)
  .map((s) => `id${s}`);

/**
 * A single pre-release identifier: either a bare numeric identifier (no leading
 * zeros) or an alphanumeric identifier.
 */
const prereleaseIdentifierArb = fc.oneof(
  numericComponentArb.map((n) => String(n)),
  alphanumericIdentifierArb,
);

/** A dot-separated pre-release segment, e.g. `alpha.1` (1..4 identifiers). */
const prereleaseArb = fc
  .array(prereleaseIdentifierArb, { minLength: 1, maxLength: 4 })
  .map((parts) => parts.join('.'));

/**
 * A build-metadata identifier: any non-empty run of the build alphabet
 * `[0-9A-Za-z-]`. Unlike pre-release, build identifiers may have leading zeros.
 */
const buildIdentifierArb = fc.stringMatching(/^[0-9A-Za-z-]+$/);

/** A dot-separated build segment, e.g. `build.001.sha` (1..3 identifiers). */
const buildArb = fc
  .array(buildIdentifierArb, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join('.'));

/** The independently-chosen parts of a valid SemVer string. */
interface SemVerParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
  readonly build: string | null;
}

const validPartsArb: fc.Arbitrary<SemVerParts> = fc.record({
  major: numericComponentArb,
  minor: numericComponentArb,
  patch: numericComponentArb,
  prerelease: fc.option(prereleaseArb, { nil: null }),
  build: fc.option(buildArb, { nil: null }),
});

/** Render the parts as a SemVer 2.0.0 string. */
function renderSemVer(parts: SemVerParts): string {
  let result = `${parts.major}.${parts.minor}.${parts.patch}`;
  if (parts.prerelease !== null) {
    result += `-${parts.prerelease}`;
  }
  if (parts.build !== null) {
    result += `+${parts.build}`;
  }
  return result;
}

/** The same string with any build metadata removed (the expected format output). */
function renderWithoutBuild(parts: SemVerParts): string {
  let result = `${parts.major}.${parts.minor}.${parts.patch}`;
  if (parts.prerelease !== null) {
    result += `-${parts.prerelease}`;
  }
  return result;
}

describe('Property 32: SemVer parsing round-trips and rejects non-conforming input', () => {
  it('parses any valid SemVer string and re-formats it ignoring build metadata', () => {
    fc.assert(
      fc.property(validPartsArb, (parts) => {
        const input = renderSemVer(parts);
        const parsed = parseSemVer(input);

        // A conforming string must parse.
        expect(parsed).not.toBeNull();
        if (parsed === null) {
          return;
        }

        // Core numbers survive the round-trip exactly.
        expect(parsed.major).toBe(parts.major);
        expect(parsed.minor).toBe(parts.minor);
        expect(parsed.patch).toBe(parts.patch);

        // Pre-release identifiers round-trip (numeric ones normalize to number).
        const expectedPrerelease =
          parts.prerelease === null
            ? []
            : parts.prerelease
                .split('.')
                .map((id) => (/^[0-9]+$/.test(id) ? Number(id) : id));
        expect(parsed.prerelease).toEqual(expectedPrerelease);

        // Formatting yields the input with build metadata stripped.
        expect(formatSemVer(parsed)).toBe(renderWithoutBuild(parts));
      }),
      { numRuns: 200 },
    );
  });

  it('formatting is idempotent: re-parsing the formatted output is stable', () => {
    fc.assert(
      fc.property(validPartsArb, (parts) => {
        const parsed = parseSemVer(renderSemVer(parts));
        expect(parsed).not.toBeNull();
        if (parsed === null) {
          return;
        }
        const formatted = formatSemVer(parsed);
        const reparsed = parseSemVer(formatted);
        expect(reparsed).not.toBeNull();
        expect(reparsed === null ? null : formatSemVer(reparsed)).toBe(formatted);
      }),
      { numRuns: 200 },
    );
  });

  it('rejects non-conforming version strings by returning null', () => {
    /**
     * Generators for strings that are NOT valid SemVer 2.0.0. Each branch
     * produces input the grammar must reject.
     */
    const nonConformingArb = fc.oneof(
      // Fewer than three numeric components.
      fc.tuple(numericComponentArb, numericComponentArb).map(
        ([a, b]) => `${a}.${b}`,
      ),
      numericComponentArb.map((a) => `${a}`),
      // More than three numeric components.
      fc
        .tuple(
          numericComponentArb,
          numericComponentArb,
          numericComponentArb,
          numericComponentArb,
        )
        .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
      // Leading zeros in a core component (e.g. 01.0.0).
      fc
        .tuple(
          fc.integer({ min: 1, max: 999 }),
          numericComponentArb,
          numericComponentArb,
        )
        .map(([a, b, c]) => `0${a}.${b}.${c}`),
      // Non-numeric core component.
      fc
        .tuple(alphanumericIdentifierArb, numericComponentArb, numericComponentArb)
        .map(([a, b, c]) => `${a}.${b}.${c}`),
      // Negative core component.
      fc
        .tuple(
          fc.integer({ min: 1, max: 999 }),
          numericComponentArb,
          numericComponentArb,
        )
        .map(([a, b, c]) => `-${a}.${b}.${c}`),
      // Empty pre-release segment (trailing hyphen with nothing after it).
      fc
        .tuple(numericComponentArb, numericComponentArb, numericComponentArb)
        .map(([a, b, c]) => `${a}.${b}.${c}-`),
      // Pre-release with an empty identifier (consecutive dots).
      fc
        .tuple(numericComponentArb, numericComponentArb, numericComponentArb)
        .map(([a, b, c]) => `${a}.${b}.${c}-alpha..1`),
      // Illegal character in the build/identifier alphabet (underscore, space).
      fc
        .tuple(numericComponentArb, numericComponentArb, numericComponentArb)
        .map(([a, b, c]) => `${a}.${b}.${c}+build_meta`),
      fc
        .tuple(numericComponentArb, numericComponentArb, numericComponentArb)
        .map(([a, b, c]) => `${a}.${b}.${c} `),
      // Completely unrelated text.
      fc.constantFrom('', 'latest', 'v', '..', 'x.y.z', '1.0', '1..0'),
    );

    fc.assert(
      fc.property(nonConformingArb, (input) => {
        expect(parseSemVer(input)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });
});
