// Feature: pre-ship-finalization, Property 45: Required `package.json` fields are validated
//
// Property 45 (design "Correctness Properties"):
//   For any `package.json`, the validator SHALL report each required field
//   (name, version, description, license, repository) as present if and only if
//   it holds a non-empty value. "Non-empty" is object-aware: a `repository`
//   object counts only with a non-empty `url`, and a `license` object counts
//   only with a non-empty `type`.
//
// **Validates: Requirements 12.1**
//
// This test exercises `verifyPackageJsonFields` and `configDetector` from
// `src/finalization/detectors/config.ts`. For each of the five required fields
// it independently chooses a value variant (omitted, null, empty/non-empty
// string, or an object whose `url`/`type` is empty/non-empty), builds a
// `package.json` from those choices, and asserts the validator reports each
// field present iff an independent reference predicate says the value is
// non-empty. A second property feeds the same manifests through `configDetector`
// and asserts it emits exactly one auto-fixable `missing-package-field` finding
// per absent field.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  verifyPackageJsonFields,
  configDetector,
  REQUIRED_PACKAGE_FIELDS,
  CONFIG_FINDING_KINDS,
} from '../detectors/config';
import type { FileRecord } from '../types';

/**
 * A generated value for one field, tagged with how it should appear in the
 * manifest. `kind: 'omit'` means the key is left out of the object entirely.
 */
type FieldChoice =
  | { readonly kind: 'omit' }
  | { readonly kind: 'value'; readonly value: unknown };

/**
 * Independent reference predicate for "this value is a non-empty field value".
 * Mirrors the specification in Requirement 12.1 (object-aware for
 * `repository.url` / `license.type`) without reusing the implementation, so a
 * regression in the detector cannot silently agree with a broken oracle.
 */
function referencePresent(choice: FieldChoice): boolean {
  if (choice.kind === 'omit') {
    return false;
  }
  const value = choice.value;
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.url === 'string') {
      return record.url.trim().length > 0;
    }
    if (typeof record.type === 'string') {
      return record.type.trim().length > 0;
    }
    return Object.keys(record).length > 0;
  }
  return false;
}

/** Strings that are empty after trimming (must read as "not present"). */
const EMPTY_STRINGS = ['', '   ', '\t', '\n  '] as const;

/** A non-empty string: prefixing with 'a' guarantees non-empty after trim. */
const nonEmptyStringArb = fc.string().map((s) => `a${s}`);

/**
 * Per-field value variants covering every branch of the non-empty rule:
 * omitted, null, empty/non-empty string, object with empty/non-empty `url`,
 * and object with empty/non-empty `type`.
 */
const fieldChoiceArb: fc.Arbitrary<FieldChoice> = fc.oneof(
  fc.constant<FieldChoice>({ kind: 'omit' }),
  fc.constant<FieldChoice>({ kind: 'value', value: null }),
  fc.constantFrom(...EMPTY_STRINGS).map<FieldChoice>((value) => ({
    kind: 'value',
    value,
  })),
  nonEmptyStringArb.map<FieldChoice>((value) => ({ kind: 'value', value })),
  fc.constantFrom('', '  ').map<FieldChoice>((url) => ({
    kind: 'value',
    value: { type: 'git', url },
  })),
  nonEmptyStringArb.map<FieldChoice>((url) => ({
    kind: 'value',
    value: { type: 'git', url },
  })),
  fc.constantFrom('', '  ').map<FieldChoice>((type) => ({
    kind: 'value',
    value: { type },
  })),
  nonEmptyStringArb.map<FieldChoice>((type) => ({
    kind: 'value',
    value: { type },
  })),
);

/** Build a `package.json` string from one choice per required field. */
function buildManifest(choices: readonly FieldChoice[]): string {
  const obj: Record<string, unknown> = {};
  REQUIRED_PACKAGE_FIELDS.forEach((field, index) => {
    const choice = choices[index];
    if (choice.kind === 'value') {
      obj[field] = choice.value;
    }
  });
  return JSON.stringify(obj, null, 2);
}

/** A tuple of one independent choice per required field. */
const choicesArb = fc.tuple(
  ...REQUIRED_PACKAGE_FIELDS.map(() => fieldChoiceArb),
);

function packageRecord(content: string): FileRecord {
  return {
    path: 'package.json',
    content,
    bytes: content.length,
    readError: null,
    language: 'json',
  };
}

describe('Property 45: Required package.json fields are validated', () => {
  it('reports each required field present iff it holds a non-empty value', () => {
    fc.assert(
      fc.property(choicesArb, (choices) => {
        const content = buildManifest(choices);
        const results = verifyPackageJsonFields(content);

        // One result per required field, in declaration order.
        expect(results.map((r) => r.field)).toEqual([...REQUIRED_PACKAGE_FIELDS]);

        results.forEach((result, index) => {
          expect(result.present).toBe(referencePresent(choices[index]));
        });
      }),
      { numRuns: 300 },
    );
  });

  it('configDetector emits exactly one auto-fixable finding per absent field', () => {
    fc.assert(
      fc.property(choicesArb, (choices) => {
        const content = buildManifest(choices);
        const findings = configDetector
          .detect([packageRecord(content)])
          .filter((f) => f.kind === CONFIG_FINDING_KINDS.missingPackageField);

        const expectedMissing = REQUIRED_PACKAGE_FIELDS.filter(
          (_field, index) => !referencePresent(choices[index]),
        );

        // Every absent field is reported once and flagged auto-fixable.
        expect(findings).toHaveLength(expectedMissing.length);
        for (const field of expectedMissing) {
          const finding = findings.find((f) => f.detail.includes(`"${field}"`));
          expect(finding).toBeDefined();
          expect(finding?.autoFixable).toBe(true);
          expect(finding?.path).toBe('package.json');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('treats an unparseable manifest as all fields missing', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', 'not json', '[]', '"a string"', '{ broken'),
        (content) => {
          const results = verifyPackageJsonFields(content);
          expect(results).toHaveLength(REQUIRED_PACKAGE_FIELDS.length);
          for (const result of results) {
            expect(result.present).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
