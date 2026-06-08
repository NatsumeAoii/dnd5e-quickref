// Feature: pre-ship-finalization, Property 47: Environment template completeness is detected
//
// Property 47 (design "Correctness Properties"):
//   The detector reports an env-template gap if and only if a read env-var key
//   (`import.meta.env.<KEY>` / `process.env.<KEY>`, excluding Vite build-time
//   built-ins) is not documented in the environment template file.
//
// **Validates: Requirements 12.3**
//
// This test exercises `extractEnvKeysRead`, `extractEnvTemplateKeys`, and the
// `configDetector` from `src/finalization/detectors/config.ts`.
//
// Strategy: generate a set of distinct env-var keys, and for each key
// independently decide whether the project source reads it and whether the env
// template documents it. The source files reference read keys through either
// `import.meta.env.<KEY>` or `process.env.<KEY>`; the template documents its
// chosen subset as `KEY=` lines. The expected env-template gaps are exactly the
// keys that are read but not documented, so the flagged keys must equal that
// set. Documented-but-unread keys (extra documentation) and unread/undocumented
// keys must never be flagged.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  extractEnvKeysRead,
  extractEnvTemplateKeys,
  configDetector,
  CONFIG_FINDING_KINDS,
} from '../detectors/config';
import type { FileRecord } from '../types';

/**
 * Vite's build-time built-ins. Reading these never requires a template entry,
 * so the generator excludes them to keep the property's input space valid.
 */
const VITE_BUILTINS = ['MODE', 'BASE_URL', 'PROD', 'DEV', 'SSR', 'LEGACY'];

const IDENT_HEAD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_'.split('');
const IDENT_TAIL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('');

/** Generates a syntactically valid env-var identifier that is not a built-in. */
const envKeyArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...IDENT_HEAD),
    fc.array(fc.constantFrom(...IDENT_TAIL), { minLength: 0, maxLength: 10 }),
  )
  .map(([head, tail]) => head + tail.join(''))
  .filter((key) => !VITE_BUILTINS.includes(key));

/** One generated key with its read/documented assignment. */
interface KeyPlan {
  readonly key: string;
  readonly read: boolean;
  readonly documented: boolean;
}

const keyPlanArb: fc.Arbitrary<KeyPlan> = fc.record({
  key: envKeyArb,
  read: fc.boolean(),
  documented: fc.boolean(),
});

/** A set of key plans with unique keys (case-sensitive, like the detector). */
const keyPlansArb: fc.Arbitrary<readonly KeyPlan[]> = fc.uniqueArray(
  keyPlanArb,
  { minLength: 0, maxLength: 12, selector: (plan) => plan.key },
);

const sourceLanguageArb = fc.constantFrom<'typescript' | 'javascript'>(
  'typescript',
  'javascript',
);

const accessFormArb = fc.constantFrom<'import.meta.env' | 'process.env'>(
  'import.meta.env',
  'process.env',
);

function makeRecord(
  path: string,
  content: string,
  language: FileRecord['language'],
): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language,
  };
}

describe('Property 47: Environment template completeness is detected', () => {
  it('flags an env key iff it is read but not documented in the template', () => {
    fc.assert(
      fc.property(
        keyPlansArb,
        sourceLanguageArb,
        // For each read key choose an access form (import.meta.env / process.env).
        fc.array(accessFormArb, { minLength: 12, maxLength: 12 }),
        // Spread read keys across one or two source files.
        fc.boolean(),
        fc.constantFrom('.env.example', '.env.template', '.env.sample'),
        (plans, language, accessForms, splitSources, templateName) => {
          const readKeys = plans.filter((p) => p.read).map((p) => p.key);
          const documentedKeys = plans
            .filter((p) => p.documented)
            .map((p) => p.key);

          // Build source lines that reference each read key.
          const sourceLines = readKeys.map((key, i) => {
            const form = accessForms[i % accessForms.length];
            return `const v${i} = ${form}.${key};`;
          });

          // Optionally split the read references across two source files so the
          // detector must aggregate keys from multiple records.
          const records: FileRecord[] = [];
          if (splitSources && sourceLines.length > 1) {
            const mid = Math.floor(sourceLines.length / 2);
            records.push(
              makeRecord('src/a.ts', sourceLines.slice(0, mid).join('\n'), language),
              makeRecord('src/b.ts', sourceLines.slice(mid).join('\n'), language),
            );
          } else {
            records.push(makeRecord('src/app.ts', sourceLines.join('\n'), language));
          }

          // Build the env template documenting its chosen subset.
          const templateContent = documentedKeys
            .map((key) => `${key}=placeholder`)
            .join('\n');
          records.push(
            makeRecord(templateName, templateContent, 'other'),
          );

          // Expected gap set: read keys that are not documented.
          const documentedSet = new Set(documentedKeys);
          const expectedGaps = new Set(
            readKeys.filter((key) => !documentedSet.has(key)),
          );

          // --- Verify the building-block extractors first. ---
          const keysRead = new Set(extractEnvKeysRead(records));
          expect(keysRead).toEqual(new Set(readKeys));

          const templateKeys = new Set(extractEnvTemplateKeys(templateContent));
          expect(templateKeys).toEqual(documentedSet);

          // --- Verify the detector reports exactly the expected gaps. ---
          const findings = configDetector
            .detect(records)
            .filter((f) => f.kind === CONFIG_FINDING_KINDS.envTemplateMissingKey);

          const flagged = new Set(
            findings.map((f) => {
              const match = f.detail.match(/"([^"]+)"/);
              return match ? match[1] : '';
            }),
          );

          expect(flagged).toEqual(expectedGaps);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('flags every read key when no template documents anything', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(envKeyArb, { minLength: 1, maxLength: 8 }),
        (keys) => {
          const source = keys
            .map((key, i) => `const v${i} = import.meta.env.${key};`)
            .join('\n');
          const records: FileRecord[] = [
            makeRecord('src/app.ts', source, 'typescript'),
            makeRecord('.env.example', '', 'other'),
          ];

          const findings = configDetector
            .detect(records)
            .filter((f) => f.kind === CONFIG_FINDING_KINDS.envTemplateMissingKey);
          const flagged = new Set(
            findings.map((f) => f.detail.match(/"([^"]+)"/)?.[1] ?? ''),
          );

          expect(flagged).toEqual(new Set(keys));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('flags nothing when every read key is documented (and ignores Vite built-ins)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(envKeyArb, { minLength: 0, maxLength: 8 }),
        (keys) => {
          // Read the documented keys plus all Vite built-ins (never flagged).
          const readLines = [
            ...keys.map((key, i) => `const v${i} = import.meta.env.${key};`),
            ...VITE_BUILTINS.map((b, i) => `const b${i} = import.meta.env.${b};`),
          ];
          const template = keys.map((key) => `${key}=x`).join('\n');
          const records: FileRecord[] = [
            makeRecord('src/app.ts', readLines.join('\n'), 'typescript'),
            makeRecord('.env.example', template, 'other'),
          ];

          const findings = configDetector
            .detect(records)
            .filter((f) => f.kind === CONFIG_FINDING_KINDS.envTemplateMissingKey);

          expect(findings).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
