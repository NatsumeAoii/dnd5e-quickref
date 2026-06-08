// Feature: pre-ship-finalization, Property 24: .gitignore category coverage is detected correctly
//
// Property 24 (design "Correctness Properties"):
//   For any generated `.gitignore`, the detector SHALL report a category
//   (build output, dependency dirs, env/secret files, OS metadata, log files)
//   as covered if and only if at least one matching rule is present.
//
// **Validates: Requirements 7.1**
//
// This test exercises `detectGitignoreState` from
// `src/finalization/detectors/hygiene.ts`. It generates a `.gitignore` body by
// independently choosing, for each of the five categories, whether to include a
// rule for it, then asserts the corresponding `GitignoreState` flag is true iff
// that category's rule was included. The five rule forms used below are
// mutually isolated: each matches exactly one category's detector predicate, so
// inclusion of one never perturbs another category's coverage result.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  detectGitignoreState,
  type GitignoreState,
} from '../detectors/hygiene';

/**
 * One coverage category under test. `flag` is the `GitignoreState` boolean the
 * detector sets, and `ruleForms` are equivalent `.gitignore` lines that each
 * satisfy this category and only this category.
 */
interface CategorySpec {
  readonly flag: keyof Pick<
    GitignoreState,
    | 'hasBuildOutput'
    | 'hasDependencies'
    | 'hasEnvSecrets'
    | 'hasOsMetadata'
    | 'hasLogs'
  >;
  readonly ruleForms: readonly string[];
}

const CATEGORIES: readonly CategorySpec[] = [
  { flag: 'hasBuildOutput', ruleForms: ['/dist/', 'dist/', 'dist', 'build/', '/out/'] },
  { flag: 'hasDependencies', ruleForms: ['/node_modules/', 'node_modules/', 'node_modules'] },
  { flag: 'hasEnvSecrets', ruleForms: ['.env', '.env.local', '*.pem', '*.key'] },
  { flag: 'hasOsMetadata', ruleForms: ['.DS_Store', 'Thumbs.db', 'Desktop.ini'] },
  { flag: 'hasLogs', ruleForms: ['*.log', 'debug.log'] },
];

/** Comment / blank lines that the parser ignores; used as harmless noise. */
const NOISE_LINES = ['', '# a comment', '   ', '# build artifacts'];

describe('Property 24: .gitignore category coverage is detected correctly', () => {
  it('reports each category covered iff at least one matching rule is present', () => {
    fc.assert(
      fc.property(
        // Independently choose inclusion for each category.
        fc.tuple(...CATEGORIES.map(() => fc.boolean())),
        // Pick a concrete rule form for any included category.
        fc.tuple(
          ...CATEGORIES.map((c) =>
            fc.integer({ min: 0, max: c.ruleForms.length - 1 }),
          ),
        ),
        // Interleave ignorable noise lines and shuffle ordering.
        fc.array(fc.constantFrom(...NOISE_LINES), { maxLength: 4 }),
        fc.boolean(),
        (included, formIdx, noise, prependNoise) => {
          const ruleLines: string[] = [];
          CATEGORIES.forEach((category, i) => {
            if (included[i]) {
              ruleLines.push(category.ruleForms[formIdx[i]]);
            }
          });

          const lines = prependNoise
            ? [...noise, ...ruleLines]
            : [...ruleLines, ...noise];
          const content = lines.join('\n');

          const state = detectGitignoreState(content);

          CATEGORIES.forEach((category, i) => {
            expect(state[category.flag]).toBe(included[i]);
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reports all five categories uncovered for an empty or comment-only file', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...NOISE_LINES), { maxLength: 6 }),
        (noise) => {
          const state = detectGitignoreState(noise.join('\n'));
          expect(state.hasBuildOutput).toBe(false);
          expect(state.hasDependencies).toBe(false);
          expect(state.hasEnvSecrets).toBe(false);
          expect(state.hasOsMetadata).toBe(false);
          expect(state.hasLogs).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
