// Feature: pre-ship-finalization, Property 25: Negation rules protect must-track files
//
// Property 25 (design "Correctness Properties"):
//   For any must-track file that is matched by an ignore rule, the fixer SHALL
//   add a negation rule that re-tracks the file and SHALL record the added rule.
//
// **Validates: Requirements 7.2**
//
// This test exercises the `HygieneDetector` / `HygieneFixer` pair from
// `src/finalization/detectors/hygiene.ts`. Must-track files are those whose
// basename ends with `.example`, `.sample`, or `.template`, or is exactly
// `.gitkeep` or `.gitattributes`.
//
// For each generated case we build an in-memory inventory containing a
// `.gitignore` whose rules match a must-track file (so the file would be
// excluded) plus the must-track file itself. We then assert:
//   1. the file is genuinely ignored by the generated rule set (test setup is
//      meaningful), and the detector emits exactly one negation finding for it;
//   2. the fixer turns that finding into a single insert edit whose text adds
//      the negation rule `!<path>` (the rule is recorded on the edit); and
//   3. after applying the appended text, the file is no longer ignored —
//      i.e. the negation rule re-tracks it.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import type { FileRecord } from '../types';
import {
  hygieneDetector,
  hygieneFixer,
  parseGitignoreRules,
  isPathIgnored,
} from '../detectors/hygiene';

/** Machine-readable kind the detector uses for negation findings. */
const NEGATION_KIND = 'gitignore-add-negation';

/** Words used to build varied but well-formed file names. */
const SAFE_WORDS = [
  'config',
  'env',
  'settings',
  'data',
  'defaults',
  'app',
  'site',
] as const;

/** Optional directory prefixes (empty string = repository root). */
const DIRS = ['', 'config/', 'src/assets/', 'public/'] as const;

/** Must-track suffixes (Requirement 7.2 / design `isMustTrackFile`). */
const SUFFIXES = ['.example', '.sample', '.template'] as const;

/** Must-track files identified by an exact basename. */
const FIXED_NAMES = ['.gitkeep', '.gitattributes'] as const;

/** Harmless lines the gitignore parser ignores; used as noise. */
const NOISE_LINES = ['', '# managed rules', '   ', '# do not edit'] as const;

interface MustTrackFile {
  readonly path: string;
  /** The must-track suffix when suffix-based, otherwise null. */
  readonly suffix: string | null;
}

/** POSIX basename of a path. */
function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

const suffixedArb: fc.Arbitrary<MustTrackFile> = fc
  .record({
    dir: fc.constantFrom(...DIRS),
    word: fc.constantFrom(...SAFE_WORDS),
    suffix: fc.constantFrom(...SUFFIXES),
  })
  .map(({ dir, word, suffix }) => ({ path: `${dir}${word}${suffix}`, suffix }));

const fixedArb: fc.Arbitrary<MustTrackFile> = fc
  .record({
    dir: fc.constantFrom(...DIRS),
    name: fc.constantFrom(...FIXED_NAMES),
  })
  .map(({ dir, name }) => ({ path: `${dir}${name}`, suffix: null }));

const mustTrackArb: fc.Arbitrary<MustTrackFile> = fc.oneof(suffixedArb, fixedArb);

/**
 * Ignore-rule forms guaranteed to match `file`. `*` matches any single path
 * segment, the exact basename matches by name anywhere, and `*<suffix>` matches
 * any suffix-based must-track file.
 */
function matchingRuleForms(file: MustTrackFile): string[] {
  const forms = ['*', basename(file.path)];
  if (file.suffix) forms.push(`*${file.suffix}`);
  return forms;
}

function makeRecord(path: string, content: string): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: path.endsWith('.md') ? 'markdown' : 'other',
  };
}

describe('Property 25: Negation rules protect must-track files', () => {
  it('adds a negation rule that re-tracks a matched must-track file and records it', () => {
    fc.assert(
      fc.property(
        mustTrackArb,
        fc.nat(),
        fc.array(fc.constantFrom(...NOISE_LINES), { maxLength: 4 }),
        fc.boolean(),
        (file, ruleChoice, noise, prependNoise) => {
          const ruleForms = matchingRuleForms(file);
          const ignoreRule = ruleForms[ruleChoice % ruleForms.length];

          const gitignoreLines = prependNoise
            ? [...noise, ignoreRule]
            : [ignoreRule, ...noise];
          const gitignoreContent = gitignoreLines.join('\n');

          const gitignoreRecord = makeRecord('.gitignore', gitignoreContent);
          const mustTrackRecord = makeRecord(file.path, 'tracked content\n');
          const records: readonly FileRecord[] = [
            gitignoreRecord,
            mustTrackRecord,
          ];

          // Setup is meaningful: the file is genuinely ignored to begin with.
          const initialRules = parseGitignoreRules(gitignoreContent);
          expect(isPathIgnored(file.path, initialRules)).toBe(true);

          // 1. The detector emits exactly one negation finding for this file.
          const findings = hygieneDetector.detect(records);
          const negationFindings = findings.filter(
            (f) => f.kind === NEGATION_KIND && f.detail.includes(file.path),
          );
          expect(negationFindings).toHaveLength(1);
          const negationFinding = negationFindings[0];
          expect(negationFinding.path).toBe('.gitignore');

          // 2. The fixer adds the negation rule `!<path>` as a single insert
          //    edit (the rule is recorded on the edit's text).
          const outcome = hygieneFixer.fix(negationFinding, gitignoreRecord);
          expect(outcome.preserved).toBe(false);
          expect(outcome.edits).toHaveLength(1);
          const edit = outcome.edits[0];
          expect(edit.kind).toBe('insert');
          expect(edit.path).toBe('.gitignore');
          expect(edit.text ?? '').toContain(`!${file.path}`);

          // 3. Applying the edit re-tracks the file: it is no longer ignored.
          const fixedContent = gitignoreContent + (edit.text ?? '');
          const fixedRules = parseGitignoreRules(fixedContent);
          expect(isPathIgnored(file.path, fixedRules)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('is idempotent: re-running the fix once the negation exists makes no change', () => {
    fc.assert(
      fc.property(mustTrackArb, (file) => {
        const gitignoreContent = `*\n!${file.path}\n`;
        const gitignoreRecord = makeRecord('.gitignore', gitignoreContent);
        const records: readonly FileRecord[] = [
          gitignoreRecord,
          makeRecord(file.path, 'tracked content\n'),
        ];

        // With the negation already present the file is tracked, so the
        // detector raises no negation finding for it.
        const findings = hygieneDetector.detect(records);
        const negationFindings = findings.filter(
          (f) => f.kind === NEGATION_KIND && f.detail.includes(file.path),
        );
        expect(negationFindings).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
