// Feature: pre-ship-finalization, Property 14: Underivable configuration values yield a recorded placeholder
//
// Property 14 (design "Correctness Properties"):
//   For any required configuration value that cannot be determined from project
//   context, the fixer SHALL insert a `[FILL IN]` marker at the configuration
//   reference and SHALL record the unresolved key.
//
// **Validates: Requirements 4.5**
//
// This test covers the *underivable* branch specifically. When a secret literal
// has no named binding (for example a secret value passed inline as a call
// argument), the environment-variable key cannot be derived from project
// context. In that case `hardcodedFixer` replaces the literal in source with an
// `import.meta.env['[FILL IN]']` reference, flags the source edit with
// `placeholderInserted: true`, and records the unresolved key in the
// environment template. The companion test `hardcoded.placeholder.property.test`
// covers the derivable (named-binding) branch.
//
// Exercises `hardcodedDetector` / `hardcodedFixer` / `HARDCODED_KINDS` from
// `src/finalization/detectors/hardcoded.ts` and `FILL_IN_PLACEHOLDER` from
// `src/finalization/types.ts`. Both detector and fixer are pure functions over
// `FileRecord[]`.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

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
 * Secret-shaped values that the detector classifies as secrets purely by value
 * shape (high-precision prefixes/headers), so they are detected even when
 * passed inline with no named binding to derive a key from.
 */
const STRONG_SECRET_VALUES = [
  'AKIAIOSFODNN7EXAMPLE',
  ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_'),
  ['sk', 'live', 'abcdefghijklmnop0123456789'].join('_'),
  ['sk', 'test', 'abcdefghijklmnop0123456789'].join('_'),
  ['xoxb', '1234567890', 'abcdefghijklmnop'].join('-'),
  ['xoxp', '9876543210', 'zyxwvutsrqponml'].join('-'),
];

const quoteArb = fc.constantFrom('"', "'");

/**
 * Function names that take the secret inline as their sole argument. None
 * provide an assignment target, so the secret has no named binding and its env
 * key is underivable.
 */
const CALL_NAMES = [
  'authenticate',
  'connect',
  'initClient',
  'login',
  'configure',
] as const;

/**
 * Build a source file in which the secret literal is passed inline as a call
 * argument. There is no `name = ...` or `name: ...` assignment, so
 * `precedingAssignmentName` finds no binding and the env key is underivable.
 */
function buildInlineCallSource(
  callName: string,
  secret: string,
  quote: string,
): string {
  return `export function start() {\n  return ${callName}(${quote}${secret}${quote});\n}\n`;
}

function sourceReplaceEdit(edits: readonly Edit[]): Edit | undefined {
  return edits.find(
    (e) => e.kind === 'replace' && e.path === SOURCE_PATH && e.range === undefined,
  );
}

function envTemplateEdit(edits: readonly Edit[]): Edit | undefined {
  return edits.find(
    (e) => e.kind === 'create' && e.path === DEFAULT_ENV_TEMPLATE_PATH,
  );
}

describe('Property 14: Underivable configuration values yield a recorded placeholder', () => {
  it('inserts import.meta.env[[FILL IN]] in source with placeholderInserted for secrets with no named binding', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CALL_NAMES),
        fc.constantFrom(...STRONG_SECRET_VALUES),
        quoteArb,
        (callName, secret, quote) => {
          const content = buildInlineCallSource(callName, secret, quote);
          const record = makeRecord(content);

          // The inline literal is classified as a secret to eliminate.
          const secrets = hardcodedDetector
            .detect([record])
            .filter((f) => f.kind === HARDCODED_KINDS.secret);
          expect(secrets.length).toBe(1);

          const outcome = hardcodedFixer.fix(secrets[0], record);
          expect(outcome.preserved).toBe(false);

          // The secret-fix source edit is flagged as a placeholder insertion
          // because the configuration key was underivable (Req 4.5).
          const sourceEdit = sourceReplaceEdit(outcome.edits);
          expect(sourceEdit).toBeDefined();
          expect((sourceEdit as Edit).placeholderInserted).toBe(true);

          // The replacement text contains the `[FILL IN]` marker at the
          // configuration reference: import.meta.env['[FILL IN]'].
          const newSource = (sourceEdit as Edit).text ?? '';
          expect(newSource).toContain(FILL_IN_PLACEHOLDER);
          expect(newSource).toContain(
            `import.meta.env['${FILL_IN_PLACEHOLDER}']`,
          );

          // The original secret value no longer appears in the source.
          expect(newSource).not.toContain(secret);

          // The unresolved key is recorded in the environment template with the
          // placeholder token, and the secret value never leaks into it.
          const envEdit = envTemplateEdit(outcome.edits);
          expect(envEdit).toBeDefined();
          expect((envEdit as Edit).placeholderInserted).toBe(true);
          const envText = (envEdit as Edit).text ?? '';
          expect(envText).toContain(FILL_IN_PLACEHOLDER);
          expect(envText).not.toContain(secret);
        },
      ),
      { numRuns: 150 },
    );
  });
});
