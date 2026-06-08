// Feature: pre-ship-finalization, Property 14: Underivable configuration values yield a recorded placeholder
//
// Property 14 (design "Correctness Properties"):
//   For any required configuration value that cannot be determined from project
//   context, the fixer SHALL insert a `[FILL IN]` marker at the configuration
//   reference and SHALL record the unresolved key.
//
// **Validates: Requirements 4.5**
//
// Concretely, the secret-elimination path of `hardcodedFixer` cannot derive the
// runtime value of a removed secret from project context. It therefore emits an
// environment-template edit (kind 'create', targeting `.env.example`) that
// carries the unresolved key together with the `FILL_IN_PLACEHOLDER` token, and
// marks that edit with `placeholderInserted: true`. This test exercises
// `hardcodedDetector` + `hardcodedFixer` from
// `src/finalization/detectors/hardcoded.ts` over generated secret-bearing
// source and asserts that placeholder/recorded-key behaviour.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  hardcodedDetector,
  hardcodedFixer,
  HARDCODED_KINDS,
  DEFAULT_ENV_TEMPLATE_PATH,
} from '../detectors/hardcoded';
import {
  FILL_IN_PLACEHOLDER,
  type Edit,
  type FileRecord,
  type SourceLanguage,
} from '../types';

const SOURCE_PATH = 'src/feature.ts';

function makeRecord(
  content: string,
  path = SOURCE_PATH,
  language: SourceLanguage = 'typescript',
): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language,
  };
}

/**
 * Identifier names that the detector classifies as secrets by name. None of
 * these are UPPER_SNAKE (so they are not treated as intentional public
 * constants), and each carries a recognizable secret segment.
 */
const SECRET_NAMES = [
  'apiKey',
  'apikey',
  'password',
  'accessToken',
  'refreshToken',
  'clientSecret',
  'authToken',
  'privateKey',
  'encryptionKey',
  'signingKey',
] as const;

/**
 * Secret-shaped VALUES that trip the detector's value heuristics regardless of
 * the assignment name. Used to cover the "secret by value" classification path.
 */
const STRONG_SECRET_VALUES = [
  'AKIAIOSFODNN7EXAMPLE',
  ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_'),
  ['sk', 'live', 'abcdefghijklmnop0123456789'].join('_'),
  ['xoxb', '1234567890', 'abcdefghijklmnop'].join('-'),
];

const quoteArb = fc.constantFrom('"', "'");

/**
 * A non-secret-shaped value to assign to a secret-named variable. Kept free of
 * whitespace and quote characters so the generated source stays well-formed.
 */
const opaqueValueArb = fc.stringMatching(/^[A-Za-z0-9]{12,40}$/);

/**
 * Collect every environment-template edit emitted by a fix outcome (kind
 * 'create' targeting the default env template path).
 */
function envTemplateEdits(edits: readonly Edit[]): readonly Edit[] {
  return edits.filter(
    (e) => e.kind === 'create' && e.path === DEFAULT_ENV_TEMPLATE_PATH,
  );
}

describe('Property 14: Underivable configuration values yield a recorded placeholder', () => {
  it('emits a [FILL IN] env-template entry with placeholderInserted for secrets detected by name', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SECRET_NAMES),
        opaqueValueArb,
        quoteArb,
        (name, value, quote) => {
          const content = `const ${name} = ${quote}${value}${quote};\n`;
          const record = makeRecord(content);

          // The literal is classified as a secret to eliminate.
          const secrets = hardcodedDetector
            .detect([record])
            .filter((f) => f.kind === HARDCODED_KINDS.secret);
          expect(secrets.length).toBe(1);

          const outcome = hardcodedFixer.fix(secrets[0], record);
          expect(outcome.preserved).toBe(false);

          // Exactly one environment-template edit carries the unresolved key.
          const envEdits = envTemplateEdits(outcome.edits);
          expect(envEdits.length).toBe(1);
          const envEdit = envEdits[0];

          // The edit is flagged as a placeholder insertion (Req 4.5).
          expect(envEdit.placeholderInserted).toBe(true);

          // It inserts the `[FILL IN]` marker at the configuration reference.
          const envText = envEdit.text ?? '';
          expect(envText).toContain(FILL_IN_PLACEHOLDER);

          // The unresolved key is recorded: a VITE_-prefixed env key derived
          // from the secret's name, written as `KEY=[FILL IN]`.
          expect(envText).toMatch(/\bVITE_[A-Z0-9_]+=/);
          const keyMatch = /\b(VITE_[A-Z0-9_]+)=/.exec(envText);
          expect(keyMatch).not.toBeNull();
          const recordedKey = (keyMatch as RegExpExecArray)[1];
          expect(envText).toContain(`${recordedKey}=${FILL_IN_PLACEHOLDER}`);

          // The original secret value is never written into the env template.
          expect(envText).not.toContain(value);

          // The source reference now points at the same recorded env key.
          const sourceEdit = outcome.edits.find(
            (e) => e.kind === 'replace' && e.path === SOURCE_PATH,
          );
          expect(sourceEdit).toBeDefined();
          const newSource = (sourceEdit as Edit).text ?? '';
          expect(newSource).toContain(`import.meta.env.${recordedKey}`);
          expect(newSource).not.toContain(value);
        },
      ),
      { numRuns: 120 },
    );
  });

  it('emits a [FILL IN] env-template entry with placeholderInserted for secrets detected by value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STRONG_SECRET_VALUES),
        fc.constantFrom('config', 'setting', 'value', 'data'),
        quoteArb,
        (secretValue, name, quote) => {
          const content = `const ${name} = ${quote}${secretValue}${quote};\n`;
          const record = makeRecord(content);

          const secrets = hardcodedDetector
            .detect([record])
            .filter((f) => f.kind === HARDCODED_KINDS.secret);
          expect(secrets.length).toBe(1);

          const outcome = hardcodedFixer.fix(secrets[0], record);
          expect(outcome.preserved).toBe(false);

          const envEdits = envTemplateEdits(outcome.edits);
          expect(envEdits.length).toBe(1);
          const envEdit = envEdits[0];

          expect(envEdit.placeholderInserted).toBe(true);

          const envText = envEdit.text ?? '';
          expect(envText).toContain(FILL_IN_PLACEHOLDER);

          // The unresolved key is recorded as `KEY=[FILL IN]`.
          const keyMatch = /\b(VITE_[A-Z0-9_]+)=/.exec(envText);
          expect(keyMatch).not.toBeNull();
          const recordedKey = (keyMatch as RegExpExecArray)[1];
          expect(envText).toContain(`${recordedKey}=${FILL_IN_PLACEHOLDER}`);

          // The original secret value never appears in the env template.
          expect(envText).not.toContain(secretValue);
        },
      ),
      { numRuns: 100 },
    );
  });
});
