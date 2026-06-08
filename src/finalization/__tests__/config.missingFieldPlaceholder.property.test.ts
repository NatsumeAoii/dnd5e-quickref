// Feature: pre-ship-finalization, Property 48: Missing config fields are added with placeholders preserving existing values
//
// Property 48 (design "Correctness Properties"):
//   Adding a missing `package.json` field inserts it with `[FILL IN]` while
//   preserving all existing field values.
//
// **Validates: Requirements 12.5**
//
// Requirement 12.5: "WHEN a required configuration field is missing from a key
// configuration file, THE Finalization_Agent SHALL add it while preserving
// existing field values, inserting a Placeholder_Marker where the value cannot
// be derived from existing files."
//
// This test exercises `addMissingPackageFields` (the pure transform that the
// `configFixer` delegates to) and `configFixer` itself from
// `src/finalization/detectors/config.ts`. It generates `package.json` content
// with an arbitrary set of pre-existing fields and one or more required fields
// missing, applies the fix, and asserts that:
//   1. the result parses as valid JSON,
//   2. every missing field is present with the `FILL_IN_PLACEHOLDER` value,
//   3. every pre-existing field value is preserved byte-for-byte (deep equal).

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  addMissingPackageFields,
  configFixer,
  CONFIG_FINDING_KINDS,
  REQUIRED_PACKAGE_FIELDS,
  type RequiredPackageField,
} from '../detectors/config';
import {
  FILL_IN_PLACEHOLDER,
  type Edit,
  type FileRecord,
  type Finding,
} from '../types';

const PACKAGE_PATH = 'package.json';

/**
 * Keys used for arbitrary pre-existing fields. Deliberately disjoint from
 * `REQUIRED_PACKAGE_FIELDS` so that "existing" and "missing" never overlap and
 * the chosen missing fields are genuinely absent from the generated object.
 */
const EXISTING_KEY_POOL = [
  'scripts',
  'dependencies',
  'devDependencies',
  'author',
  'keywords',
  'main',
  'module',
  'type',
  'private',
  'homepage',
  'engines',
  'bugs',
] as const;

/** Arbitrary JSON-serializable values for pre-existing fields. */
const existingValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.array(fc.string(), { maxLength: 4 }),
  fc.dictionary(
    // Exclude `__proto__` so generators never produce null-prototype objects.
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,10}$/),
    fc.string(),
    { maxKeys: 4 },
  ),
);

/** A record of arbitrary pre-existing fields (possibly empty). */
const existingFieldsArb: fc.Arbitrary<Record<string, unknown>> = fc
  .uniqueArray(fc.constantFrom(...EXISTING_KEY_POOL), { maxLength: 6 })
  .chain((keys) =>
    fc
      .tuple(...keys.map(() => existingValueArb))
      .map((values) => {
        const obj: Record<string, unknown> = {};
        keys.forEach((key, index) => {
          obj[key] = values[index];
        });
        return obj;
      }),
  );

/** A non-empty subset of the required fields to treat as missing. */
const missingFieldsArb: fc.Arbitrary<RequiredPackageField[]> = fc
  .uniqueArray(fc.constantFrom(...REQUIRED_PACKAGE_FIELDS), {
    minLength: 1,
    maxLength: REQUIRED_PACKAGE_FIELDS.length,
  })
  .map((fields) => [...fields]);

/** Two-space and tab indentation are both common; cover both. */
const indentArb = fc.constantFrom('  ', '    ', '\t');

function makePackageRecord(content: string): FileRecord {
  return {
    path: PACKAGE_PATH,
    content,
    bytes: content.length,
    readError: null,
    language: 'json',
  };
}

describe('Property 48: Missing config fields are added with placeholders preserving existing values', () => {
  it('addMissingPackageFields inserts [FILL IN] for each missing field and preserves all existing values', () => {
    fc.assert(
      fc.property(
        existingFieldsArb,
        missingFieldsArb,
        indentArb,
        (existing, missingFields, indent) => {
          const original = JSON.stringify(existing, null, indent);

          const updated = addMissingPackageFields(original, missingFields);

          // 1. The result must parse as valid JSON.
          let parsed: Record<string, unknown>;
          expect(() => {
            parsed = JSON.parse(updated) as Record<string, unknown>;
          }).not.toThrow();
          parsed = JSON.parse(updated) as Record<string, unknown>;

          // Baseline: the original content round-tripped through JSON. Value
          // preservation is defined over serialized content, so we compare the
          // updated parse against this baseline rather than the raw generator
          // object (which fast-check may build with a null prototype).
          const baseline = JSON.parse(original) as Record<string, unknown>;

          // 2. Every missing field is present with the placeholder value.
          for (const field of missingFields) {
            expect(parsed[field]).toBe(FILL_IN_PLACEHOLDER);
          }

          // 3. Every pre-existing field value is preserved unchanged.
          for (const key of Object.keys(baseline)) {
            expect(parsed[key]).toStrictEqual(baseline[key]);
          }

          // The resulting object holds exactly the union of existing keys and
          // the newly added missing fields — nothing else is introduced.
          const expectedKeys = new Set([
            ...Object.keys(baseline),
            ...missingFields,
          ]);
          expect(new Set(Object.keys(parsed))).toStrictEqual(expectedKeys);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('configFixer adds a single missing field via [FILL IN] preserving every existing value', () => {
    fc.assert(
      fc.property(
        existingFieldsArb,
        fc.constantFrom(...REQUIRED_PACKAGE_FIELDS),
        indentArb,
        (existing, missingField, indent) => {
          const original = JSON.stringify(existing, null, indent);
          const record = makePackageRecord(original);

          const finding: Finding = {
            domain: 'config',
            path: PACKAGE_PATH,
            location: {},
            kind: CONFIG_FINDING_KINDS.missingPackageField,
            detail: `package.json is missing a non-empty "${missingField}" field`,
            autoFixable: true,
          };

          const outcome = configFixer.fix(finding, record);

          // The fixer applies an edit (it is not preserved) and flags the
          // placeholder insertion.
          expect(outcome.preserved).toBe(false);
          expect(outcome.edits.length).toBe(1);
          const edit: Edit = outcome.edits[0];
          expect(edit.kind).toBe('replace');
          expect(edit.path).toBe(PACKAGE_PATH);
          expect(edit.placeholderInserted).toBe(true);

          const updated = edit.text ?? '';
          const parsed = JSON.parse(updated) as Record<string, unknown>;
          const baseline = JSON.parse(original) as Record<string, unknown>;

          // The missing field now carries the placeholder.
          expect(parsed[missingField]).toBe(FILL_IN_PLACEHOLDER);

          // All pre-existing values are preserved unchanged.
          for (const key of Object.keys(baseline)) {
            expect(parsed[key]).toStrictEqual(baseline[key]);
          }
        },
      ),
      { numRuns: 120 },
    );
  });
});
