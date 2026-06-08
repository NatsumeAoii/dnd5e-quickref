// Feature: pre-ship-finalization, Property 46: Output-directory triple match is detected without auto-editing on mismatch
//
// Property 46 (design "Correctness Properties"):
//   The output-dir triple (bundler `outDir`, `.gitignore` build-output
//   exclusion, deploy directory) SHALL be reported as matching if and only if
//   all three are present and normalize to the same directory. On a mismatch
//   the conflict SHALL be recorded as a finding and the fixer SHALL preserve it
//   WITHOUT auto-editing (it produces no edits and records a reason).
//
// **Validates: Requirements 12.2, 12.6**
//
// This test exercises `compareOutputDirs`, the `configDetector`, and the
// `configFixer` from `src/finalization/detectors/config.ts`. It generates the
// three directory values independently — each may be absent (null) or one of
// several `./` and trailing-slash variants of a build-output directory name —
// and asserts:
//   1. `compareOutputDirs.allMatch` is true iff all three are present and their
//      normalized forms are identical.
//   2. The detector emits exactly one `output-dir-mismatch` finding (marked
//      NOT auto-fixable) iff the three present sources do not all match.
//   3. The fixer, given such a finding, makes no edits, sets `preserved: true`,
//      and records a preservation reason (Requirement 12.6: never auto-edit).

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  compareOutputDirs,
  configDetector,
  configFixer,
  normalizeDirPath,
  CONFIG_FINDING_KINDS,
  type OutputDirSources,
} from '../detectors/config';
import type { FileRecord, Finding, SourceLanguage } from '../types';

/**
 * Recognized build-output directory names. Restricted to the set the
 * `.gitignore` build-exclusion extractor recognizes so the detector path can
 * be driven precisely through real config content.
 */
const BUILD_DIR_NAMES = ['dist', 'build', 'out'] as const;

/**
 * Produce equivalent textual variants of a directory name. Every variant
 * normalizes back to the bare name, so they are interchangeable for matching.
 */
function variantsOf(name: string): readonly string[] {
  return [name, `./${name}`, `${name}/`, `/${name}/`, `  ${name}  `];
}

/** Arbitrary that yields a concrete directory string (a name + a variant). */
const dirValueArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...BUILD_DIR_NAMES),
    fc.integer({ min: 0, max: variantsOf('x').length - 1 }),
  )
  .map(([name, idx]) => variantsOf(name)[idx]);

/** Arbitrary for one of the three sources: either absent (null) or a value. */
const sourceArb: fc.Arbitrary<string | null> = fc.option(dirValueArb, {
  nil: null,
});

function record(
  path: string,
  content: string,
  language: SourceLanguage,
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
 * Build the configuration records that drive the detector for a given triple.
 * A `null` source means the corresponding file/field is simply omitted, so the
 * source resolves to `null` inside the detector exactly as in `compareOutputDirs`.
 */
function buildRecords(sources: OutputDirSources): FileRecord[] {
  const records: FileRecord[] = [];

  // Bundler config is required for the detector to run at all.
  const outDir = sources.bundlerOutDir;
  const viteContent =
    outDir === null
      ? `export default { build: {} };\n`
      : `export default { build: { outDir: '${outDir}' } };\n`;
  records.push(record('vite.config.ts', viteContent, 'typescript'));

  if (sources.gitignoreExclusion !== null) {
    records.push(
      record('.gitignore', `node_modules\n${sources.gitignoreExclusion}\n`, 'other'),
    );
  }

  if (sources.deployDir !== null) {
    const workflow = [
      'jobs:',
      '  deploy:',
      '    steps:',
      '      - uses: actions/upload-pages-artifact@v3',
      '        with:',
      `          path: ${sources.deployDir}`,
      '',
    ].join('\n');
    records.push(record('.github/workflows/deploy.yml', workflow, 'other'));
  }

  return records;
}

describe('Property 46: output-directory triple match is detected without auto-editing on mismatch', () => {
  it('compareOutputDirs.allMatch is true iff all three are present and normalize equal', () => {
    fc.assert(
      fc.property(sourceArb, sourceArb, sourceArb, (bundler, gitignore, deploy) => {
        const sources: OutputDirSources = {
          bundlerOutDir: bundler,
          gitignoreExclusion: gitignore,
          deployDir: deploy,
        };

        const comparison = compareOutputDirs(sources);

        const present = [bundler, gitignore, deploy].filter(
          (v): v is string => v !== null,
        );
        const allPresent = present.length === 3;
        const normalizedSet = new Set(present.map(normalizeDirPath));
        const expectedMatch = allPresent && normalizedSet.size === 1;

        expect(comparison.allMatch).toBe(expectedMatch);
        // Normalized set reflects exactly the distinct present, normalized dirs.
        expect([...comparison.normalized].sort()).toEqual([...normalizedSet].sort());
      }),
      { numRuns: 200 },
    );
  });

  it('detector flags a non-auto-fixable mismatch iff the present triple does not all match; fixer never auto-edits', () => {
    fc.assert(
      fc.property(sourceArb, sourceArb, sourceArb, (bundler, gitignore, deploy) => {
        const sources: OutputDirSources = {
          bundlerOutDir: bundler,
          gitignoreExclusion: gitignore,
          deployDir: deploy,
        };
        const records = buildRecords(sources);

        const findings = configDetector
          .detect(records)
          .filter((f) => f.kind === CONFIG_FINDING_KINDS.outputDirMismatch);

        const shouldMatch = compareOutputDirs(sources).allMatch;

        if (shouldMatch) {
          expect(findings).toHaveLength(0);
          return;
        }

        // Mismatch: exactly one finding, reported but not auto-fixable.
        expect(findings).toHaveLength(1);
        const finding = findings[0];
        expect(finding.autoFixable).toBe(false);
        expect(finding.domain).toBe('config');
        // Reported against the bundler config, which is always present here.
        expect(finding.path).toBe('vite.config.ts');

        // Requirement 12.6: the fixer must preserve without auto-editing.
        const viteRecord = records.find((r) => r.path === 'vite.config.ts')!;
        const outcome = configFixer.fix(finding, viteRecord);
        expect(outcome.edits).toHaveLength(0);
        expect(outcome.preserved).toBe(true);
        expect(outcome.preservationReason).toBeTruthy();
      }),
      { numRuns: 200 },
    );
  });

  it('records a preservation reason for any output-dir-mismatch finding regardless of detail', () => {
    fc.assert(
      fc.property(fc.string(), (detail) => {
        const finding: Finding = {
          domain: 'config',
          path: 'vite.config.ts',
          location: {},
          kind: CONFIG_FINDING_KINDS.outputDirMismatch,
          detail,
          autoFixable: false,
        };
        const rec = record('vite.config.ts', 'export default {};\n', 'typescript');

        const outcome = configFixer.fix(finding, rec);

        expect(outcome.edits).toHaveLength(0);
        expect(outcome.preserved).toBe(true);
        expect(typeof outcome.preservationReason).toBe('string');
        expect(outcome.preservationReason!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
