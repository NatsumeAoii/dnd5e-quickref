// @vitest-environment node
//
// Feature: pre-ship-finalization, Property 3: Read failures are recorded and never drop other files
//
// Validates: Requirements 1.4
//
// Property text: For any file set where an arbitrary subset fails to read, the
// resulting records SHALL contain one entry with a populated readError for each
// failing file and SHALL still contain every successfully read file.
//
// Strategy: generate a mix of paths that are readable (real files written to a
// temp fixture tree) and paths that fail to read (nonexistent paths, and paths
// pointing at directories rather than files). The two groups are interleaved in
// an arbitrary order, passed through FileInventory.readAll, and the resulting
// records are checked: every failing path yields a record with content === null
// and a populated readError, every readable path yields a record with non-null
// content and a null readError, and no input path is dropped or duplicated.

// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { tmpdir } from 'node:os';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { FileInventory } from '../FileInventory';

/** Root temp directory holding all generated fixtures for this test run. */
let fixtureRoot: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'finalization-readfail-'));
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/**
 * A classified input path: `readable` paths point at a real file written to
 * disk; `failing` paths point at something that cannot be read as a text file
 * (a nonexistent path or a directory).
 */
interface ClassifiedPath {
  readonly relPath: string;
  readonly kind: 'readable' | 'failing';
}

/**
 * Arbitrary that produces a set of distinct relative path segments. Distinct
 * names keep readable and failing paths from colliding on disk and let us
 * assert one record per input path without ambiguity.
 */
const distinctNamesArbitrary = fc
  .uniqueArray(
    fc
      .tuple(
        fc.constantFrom('a', 'b', 'c', 'nested', 'deep', 'mod', 'util'),
        fc.integer({ min: 0, max: 9999 }),
      )
      .map(([prefix, n]) => `${prefix}-${n}`),
    { minLength: 1, maxLength: 12 },
  );

/**
 * Build an interleaved scenario: split distinct names into readable files
 * (written to disk under a unique sub-directory) and failing paths (a mix of
 * nonexistent paths and directory paths). Returns the classified paths in their
 * generated order alongside the absolute fixture sub-directory used.
 */
const scenarioArbitrary = distinctNamesArbitrary.chain((names) =>
  fc
    .array(fc.boolean(), { minLength: names.length, maxLength: names.length })
    .chain((isReadableFlags) =>
      // A failing path is either a nonexistent file or a directory. Pick which
      // kind of failure each failing path uses.
      fc
        .array(fc.boolean(), { minLength: names.length, maxLength: names.length })
        .map((failingIsDirFlags) => {
          const classified: ClassifiedPath[] = names.map((name, index) => ({
            relPath: name,
            kind: isReadableFlags[index] ? 'readable' : 'failing',
          }));
          return { classified, failingIsDirFlags };
        }),
    ),
);

describe('FileInventory.readAll read-failure recording (Property 3)', () => {
  it('records a populated readError for every failing path and keeps every readable file', () => {
    fc.assert(
      fc.property(scenarioArbitrary, ({ classified, failingIsDirFlags }) => {
        // Each property run gets its own isolated sub-directory so files from
        // different runs never interfere.
        const runDir = mkdtempSync(join(fixtureRoot, 'run-'));

        const readablePaths = new Set<string>();
        const failingPaths = new Set<string>();

        classified.forEach((entry, index) => {
          const absolutePath = join(runDir, entry.relPath);
          if (entry.kind === 'readable') {
            mkdirSync(dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, `content for ${entry.relPath}\n`, 'utf-8');
            readablePaths.add(entry.relPath);
          } else if (failingIsDirFlags[index]) {
            // A directory at this path: readFileSync will fail (EISDIR).
            mkdirSync(absolutePath, { recursive: true });
            failingPaths.add(entry.relPath);
          } else {
            // Nonexistent path: never created on disk (ENOENT).
            failingPaths.add(entry.relPath);
          }
        });

        const inputPaths = classified.map((entry) => entry.relPath);
        const inventory = new FileInventory();
        const records = inventory.readAll(inputPaths, runDir);

        // No file is dropped: exactly one record per input path, same order.
        expect(records).toHaveLength(inputPaths.length);
        expect(records.map((record) => record.path)).toEqual(inputPaths);

        for (const record of records) {
          if (failingPaths.has(record.path)) {
            // Failing paths: content null with a populated readError.
            expect(record.content).toBeNull();
            expect(record.readError).not.toBeNull();
            expect((record.readError as string).length).toBeGreaterThan(0);
          } else {
            // Readable files survive with content and no error.
            expect(readablePaths.has(record.path)).toBe(true);
            expect(record.content).not.toBeNull();
            expect(record.readError).toBeNull();
          }
        }

        // Every readable file is still present in the output.
        const recordedReadable = new Set(
          records
            .filter((record) => record.readError === null)
            .map((record) => record.path),
        );
        for (const readablePath of readablePaths) {
          expect(recordedReadable.has(readablePath)).toBe(true);
        }

        // Every failing path is present with a recorded error.
        const recordedFailing = new Set(
          records
            .filter((record) => record.readError !== null)
            .map((record) => record.path),
        );
        for (const failingPath of failingPaths) {
          expect(recordedFailing.has(failingPath)).toBe(true);
        }

        rmSync(runDir, { recursive: true, force: true });
      }),
      { numRuns: 100 },
    );
  });
});
