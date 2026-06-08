// Feature: pre-ship-finalization, Property 29: Loose files are relocated or removed appropriately
//
// Property 29 (design "Correctness Properties"):
//   For any loose file: if it is non-transient and misplaced, the fixer SHALL
//   relocate it to its designated location and update every reference; if it is
//   a transient artifact, the fixer SHALL remove it and record the removal.
//
// **Validates: Requirements 7.7, 7.8**
//
// This test drives the real `HygieneDetector`/`HygieneFixer` from
// `src/finalization/detectors/hygiene.ts` together with the pure classifiers
// `isTransientArtifact` and `designatedLocation`. For each generated case it:
//   - builds an in-memory inventory containing one loose file (transient or a
//     misplaced non-transient source file) plus optional referencing files,
//   - runs the detector to obtain findings,
//   - feeds each relevant finding to the fixer, and
//   - asserts the resulting Edit kinds:
//       * transient loose file  -> exactly one 'delete' edit,
//       * misplaced source file -> exactly one 'move' edit to the designated
//         location, plus one reference-updating 'replace' edit per referencing
//         file.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import type { FileRecord, Finding, SourceLanguage } from '../types';
import {
  HygieneDetector,
  HygieneFixer,
  isTransientArtifact,
  designatedLocation,
} from '../detectors/hygiene';

const detector = new HygieneDetector();
const fixer = new HygieneFixer();

// ---------------------------------------------------------------------------
// Inventory helpers
// ---------------------------------------------------------------------------

function languageFor(path: string): SourceLanguage {
  if (/\.tsx?$/.test(path)) return 'typescript';
  if (/\.(js|mjs|cjs)$/.test(path)) return 'javascript';
  if (/\.css$/.test(path)) return 'css';
  if (/\.html?$/.test(path)) return 'html';
  if (/\.json$/.test(path)) return 'json';
  if (/\.md$/.test(path)) return 'markdown';
  return 'other';
}

function record(path: string, content: string): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: languageFor(path),
  };
}

function findingsFor(records: FileRecord[], path: string, kind: string): Finding[] {
  return detector
    .detect(records)
    .filter((f) => f.path === path && f.kind === kind);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A lowercase identifier-ish word that never collides with root allowlist names. */
const word = fc
  .stringMatching(/^[a-z]{3,8}$/)
  .filter((w) => !['index', 'package', 'yarn', 'pnpm'].includes(w));

/** Transient artifact placed where the detector will scan it. */
const TRANSIENT_EXTS = ['log', 'tmp', 'temp', 'bak', 'backup', 'swp', 'swo', 'orig'];
const OS_METADATA = ['.DS_Store', 'Thumbs.db', 'Desktop.ini', 'ehthumbs.db'];
const SCANNABLE_DIRS = ['', 'src/', 'assets/', 'public/'];

const transientLooseFile = fc.oneof(
  // extension-based transient (root or sub-directory)
  fc.record({
    dir: fc.constantFrom(...SCANNABLE_DIRS),
    name: word,
    ext: fc.constantFrom(...TRANSIENT_EXTS),
  }).map(({ dir, name, ext }) => `${dir}${name}.${ext}`),
  // OS-metadata file inside a non-dot sub-directory (root dotfiles are not scanned)
  fc.record({
    dir: fc.constantFrom('src/', 'assets/', 'public/'),
    name: fc.constantFrom(...OS_METADATA),
  }).map(({ dir, name }) => `${dir}${name}`),
);

/** Misplaced, non-transient root source file with a derivable designated home. */
const MISPLACED_EXTS = ['ts', 'tsx', 'js', 'mjs', 'cjs', 'css'];
const misplacedRootFile = fc
  .record({ name: word, ext: fc.constantFrom(...MISPLACED_EXTS) })
  .map(({ name, ext }) => `${name}.${ext}`)
  // keep only files the project knows how to relocate
  .filter((p) => designatedLocation(p) !== null);

// ---------------------------------------------------------------------------
// Property 29 — transient artifacts are removed
// ---------------------------------------------------------------------------

describe('Property 29: Loose files are relocated or removed appropriately', () => {
  it('transient loose files yield exactly one delete edit', () => {
    fc.assert(
      fc.property(transientLooseFile, fc.string(), (loosePath, body) => {
        // Sanity: the generated file is genuinely transient.
        expect(isTransientArtifact(loosePath)).toBe(true);

        const records = [record(loosePath, body)];
        const findings = findingsFor(records, loosePath, 'loose-file-transient');

        expect(findings).toHaveLength(1);

        const outcome = fixer.fix(findings[0], records[0]);
        expect(outcome.preserved).toBe(false);
        expect(outcome.edits).toHaveLength(1);

        const edit = outcome.edits[0];
        expect(edit.kind).toBe('delete');
        expect(edit.path).toBe(loosePath);
        expect(edit.placeholderInserted).toBe(false);
      }),
      { numRuns: 150 },
    );
  });

  it('misplaced non-transient files yield a move edit plus reference-update edits', () => {
    fc.assert(
      fc.property(
        misplacedRootFile,
        fc.array(word, { minLength: 0, maxLength: 4 }),
        (loosePath, consumerWords) => {
          const target = designatedLocation(loosePath);
          expect(target).not.toBeNull();
          expect(isTransientArtifact(loosePath)).toBe(false);

          // Distinct referencing files, each importing the loose file.
          const consumerNames = Array.from(new Set(consumerWords));
          const consumers = consumerNames.map((name, i) =>
            record(`src/consumer_${i}_${name}.ts`, `import x from './${loosePath}';\n`),
          );
          const records = [record(loosePath, 'export const x = 1;\n'), ...consumers];

          // --- relocation: exactly one move edit to the designated location ---
          const moveFindings = findingsFor(records, loosePath, 'loose-file-misplaced');
          expect(moveFindings).toHaveLength(1);

          const moveOutcome = fixer.fix(moveFindings[0], records[0]);
          expect(moveOutcome.preserved).toBe(false);
          expect(moveOutcome.edits).toHaveLength(1);
          expect(moveOutcome.edits[0].kind).toBe('move');
          expect(moveOutcome.edits[0].path).toBe(loosePath);
          expect(moveOutcome.edits[0].newPath).toBe(target);

          // --- reference updates: one replace edit per referencing file ---
          const allFindings = detector.detect(records);
          const refFindings = allFindings.filter(
            (f) => f.kind === 'loose-file-reference',
          );
          expect(refFindings).toHaveLength(consumers.length);

          for (const refFinding of refFindings) {
            const consumer = consumers.find((c) => c.path === refFinding.path);
            expect(consumer).toBeDefined();

            const refOutcome = fixer.fix(refFinding, consumer!);
            expect(refOutcome.preserved).toBe(false);
            expect(refOutcome.edits).toHaveLength(1);

            const edit = refOutcome.edits[0];
            expect(edit.kind).toBe('replace');
            expect(edit.path).toBe(consumer!.path);
            // The old reference must no longer appear; the new one must.
            expect(edit.text).toContain(target!);
            expect(edit.text).not.toContain(`./${loosePath}`);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
