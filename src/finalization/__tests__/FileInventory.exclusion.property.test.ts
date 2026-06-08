// @vitest-environment node
//
// Feature: pre-ship-finalization, Property 1: Inventory excludes ignored directories and is complete
//
// Validates: Requirements 1.1
//
// Property text: For any generated file tree, enumeration SHALL return every
// path that is not under node_modules/, dist/, or .git/, and SHALL return no
// path that is under any of those directories.
//
// Strategy: generate a random file tree (directory segments drawn from a pool
// that mixes ordinary names with the three excluded names at arbitrary depth),
// materialize it on a fresh temp directory, run FileInventory.enumerate, and
// compare the result against an independently computed expectation. The
// expectation is derived from the set of files actually created on disk: a file
// is expected iff none of its *directory* segments is an excluded directory
// name. Each generated tree uses its own temp directory which is removed after
// the run.

// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { tmpdir } from 'node:os';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { FileInventory } from '../FileInventory.js';

/**
 * Directory names whose contents the inventory must exclude (Requirement 1.1).
 * Mirrors the exclusion set in FileInventory; the test redefines it
 * independently rather than importing a private constant.
 */
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.git',
]);

/**
 * Directory-segment pool. Ordinary names are mixed with the three excluded
 * names so generated trees place files both inside and outside ignored
 * directories at varying depths.
 */
const DIRECTORY_SEGMENTS: readonly string[] = [
  'src',
  'lib',
  'public',
  'a',
  'b',
  'nested',
  'node_modules',
  'dist',
  '.git',
];

/** Filenames (distinct from directory-segment names) with recognized extensions. */
const FILE_NAMES: readonly string[] = [
  'index.ts',
  'main.js',
  'data.json',
  'notes.md',
  'style.css',
  'page.html',
  'plain.txt',
];

/** A single generated file path as an array of segments (dirs..., filename). */
const filePathArbitrary = fc
  .tuple(
    fc.array(fc.constantFrom(...DIRECTORY_SEGMENTS), {
      minLength: 0,
      maxLength: 4,
    }),
    fc.constantFrom(...FILE_NAMES),
  )
  .map(([dirs, name]) => [...dirs, name]);

/** A generated file tree: a list of segment-arrays. */
const fileTreeArbitrary = fc.array(filePathArbitrary, {
  minLength: 0,
  maxLength: 25,
});

/** True when any *directory* segment (all but the filename) is excluded. */
function isUnderExcludedDirectory(segments: readonly string[]): boolean {
  const directorySegments = segments.slice(0, -1);
  return directorySegments.some((segment) => EXCLUDED_DIRECTORIES.has(segment));
}

describe('FileInventory.enumerate exclusion and completeness (Property 1)', () => {
  it('returns exactly the files not under node_modules/, dist/, or .git/', () => {
    fc.assert(
      fc.property(fileTreeArbitrary, (tree) => {
        const root = mkdtempSync(join(tmpdir(), 'finalization-exclusion-'));
        try {
          // Materialize the tree. A path may collide with another that uses it
          // as a directory prefix (file-vs-directory); such writes throw and
          // are skipped, and the expectation is computed from what actually
          // landed on disk so the comparison stays exact.
          const createdPosix = new Set<string>();
          for (const segments of tree) {
            const posixPath = segments.join('/');
            if (createdPosix.has(posixPath)) {
              continue;
            }
            const absolutePath = join(root, ...segments);
            try {
              mkdirSync(dirname(absolutePath), { recursive: true });
              writeFileSync(absolutePath, `content of ${posixPath}`, 'utf-8');
              createdPosix.add(posixPath);
            } catch {
              // File/directory name collision — skip; never counted as expected.
            }
          }

          // Independently derive the expected set: every created file whose
          // directory segments include none of the excluded names.
          const expected = [...createdPosix]
            .filter((posixPath) => !isUnderExcludedDirectory(posixPath.split('/')))
            .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

          const inventory = new FileInventory();
          const actual = inventory.enumerate(root);

          // Completeness + exclusion in one exact comparison.
          expect([...actual]).toEqual(expected);

          // Exclusion, stated directly: no returned path is under an excluded
          // directory at any depth.
          for (const posixPath of actual) {
            expect(isUnderExcludedDirectory(posixPath.split('/'))).toBe(false);
          }
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});
