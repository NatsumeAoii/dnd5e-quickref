// Feature: pre-ship-finalization, Property 4: Every finding is traceable to a read file
//
// Validates: Requirements 1.5, 1.6
//
// Property text: For any records and any detector, every produced Finding.path
// SHALL be the path of a FileRecord present in the input set; findings whose
// path is not in the set SHALL be discarded.
//
// Strategy: generate a set of FileRecords (the inventory) and a set of
// candidate findings whose paths are drawn from a pool that mixes in-set paths
// (paths that belong to a generated record) with out-of-set paths (paths that
// are guaranteed not to belong to any record). Run the Orchestrator's
// finding-trace filter and assert:
//   1. Every surviving finding's path is the path of some input record
//      (soundness: nothing untraceable survives — Requirement 1.6).
//   2. Every input finding whose path is in the record set survives
//      (completeness: no traceable finding is wrongly discarded — Requirement 1.5).
//   3. The filter preserves order and identity of the surviving findings (it
//      only drops, never reorders or mutates).
//
// The detector path is also covered: a synthetic detector that emits the
// generated findings is run through `evaluateChecklist` over a fully-read
// inventory, asserting the same traceability guarantee end-to-end.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { FinalizationOrchestrator } from '../Orchestrator';
import { FileInventory } from '../FileInventory';
import type {
  Detector,
  Domain,
  FileRecord,
  Finding,
  SourceLanguage,
} from '../types';

/** Domains a generated finding may belong to. */
const DOMAINS: readonly Domain[] = [
  'dead-code',
  'hardcoded',
  'error-boundary',
  'naming',
  'hygiene',
  'version',
  'html',
  'ts-js-safety',
  'css',
  'config',
];

/** Languages a generated record may report. */
const LANGUAGES: readonly SourceLanguage[] = [
  'typescript',
  'javascript',
  'css',
  'html',
  'json',
  'markdown',
  'other',
];

/**
 * Distinct repo-relative paths that may belong to a generated record. Kept
 * disjoint from {@link OUT_OF_SET_PATHS} so an "out" path can never accidentally
 * coincide with an "in" path.
 */
const IN_SET_PATHS: readonly string[] = [
  'src/index.ts',
  'src/main.ts',
  'src/util/helpers.ts',
  'public/index.html',
  'styles/app.css',
  'package.json',
  'README.md',
  'CHANGELOG.md',
];

/**
 * Paths that are guaranteed never to appear as a record path. A finding using
 * one of these must be discarded (Requirement 1.6).
 */
const OUT_OF_SET_PATHS: readonly string[] = [
  'phantom/ghost.ts',
  'does/not/exist.css',
  'unread/file.html',
  'imaginary.json',
  '',
];

/** Build a successfully-read FileRecord for the given path. */
function readRecord(path: string, content: string): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: pickLanguage(path),
  };
}

function pickLanguage(path: string): SourceLanguage {
  if (path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  return 'other';
}

/** A subset of in-set paths, deduplicated, materialized as read records. */
const recordsArbitrary: fc.Arbitrary<readonly FileRecord[]> = fc
  .subarray([...IN_SET_PATHS], { minLength: 0, maxLength: IN_SET_PATHS.length })
  .map((paths) => paths.map((path) => readRecord(path, `content of ${path}`)));

/**
 * A finding whose path is drawn from a pool combining the chosen in-set paths
 * with the fixed out-of-set pool, so each generated finding is either traceable
 * or not by construction.
 */
function findingArbitrary(
  inSetPaths: readonly string[],
): fc.Arbitrary<Finding> {
  const pathPool =
    inSetPaths.length > 0
      ? [...inSetPaths, ...OUT_OF_SET_PATHS]
      : [...OUT_OF_SET_PATHS];
  return fc.record({
    domain: fc.constantFrom(...DOMAINS),
    path: fc.constantFrom(...pathPool),
    location: fc.record({ line: fc.nat({ max: 1000 }) }),
    kind: fc.constantFrom('console-debug', 'empty-catch', 'any-type', 'naming'),
    detail: fc.string(),
    autoFixable: fc.boolean(),
  });
}

/** A detector that re-emits a fixed list of findings, ignoring its input. */
function fixedDetector(findings: readonly Finding[]): Detector {
  return {
    domain: 'dead-code',
    detect: () => findings,
  };
}

describe('Orchestrator finding-trace filter (Property 4)', () => {
  it('keeps exactly the findings whose path is in the record set', () => {
    fc.assert(
      fc.property(
        recordsArbitrary.chain((records) => {
          const inSetPaths = records.map((r) => r.path);
          return fc.tuple(
            fc.constant(records),
            fc.array(findingArbitrary(inSetPaths), {
              minLength: 0,
              maxLength: 30,
            }),
          );
        }),
        ([records, findings]) => {
          const orchestrator = new FinalizationOrchestrator({ inventory: new FileInventory() });
          const knownPaths = new Set(records.map((r) => r.path));

          const survivors = orchestrator.filterTraceableFindings(
            records,
            findings,
          );

          // Soundness (Requirement 1.6): nothing untraceable survives.
          for (const finding of survivors) {
            expect(knownPaths.has(finding.path)).toBe(true);
          }

          // Completeness (Requirement 1.5): every traceable finding survives,
          // in the original order and by identity (the filter only drops).
          const expected = findings.filter((f) => knownPaths.has(f.path));
          expect(survivors).toEqual(expected);
          for (let i = 0; i < expected.length; i += 1) {
            expect(survivors[i]).toBe(expected[i]);
          }

          // Every discarded finding was genuinely out of set.
          const discarded = findings.filter((f) => !survivors.includes(f));
          for (const finding of discarded) {
            expect(knownPaths.has(finding.path)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('discards untraceable findings when run through evaluateChecklist', () => {
    fc.assert(
      fc.property(
        recordsArbitrary
          .filter((records) => records.length > 0)
          .chain((records) => {
            const inSetPaths = records.map((r) => r.path);
            return fc.tuple(
              fc.constant(records),
              fc.array(findingArbitrary(inSetPaths), {
                minLength: 1,
                maxLength: 30,
              }),
            );
          }),
        ([records, findings]) => {
          const orchestrator = new FinalizationOrchestrator({ inventory: new FileInventory() });
          const knownPaths = new Set(records.map((r) => r.path));

          // A fully-read inventory opens the gate, so the detector runs and the
          // trace filter applies to its output.
          const result = orchestrator.evaluateChecklist(records, [
            fixedDetector(findings),
          ]);

          const expected = findings.filter((f) => knownPaths.has(f.path));
          expect(result).toEqual(expected);
          for (const finding of result) {
            expect(knownPaths.has(finding.path)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

