// Feature: pre-ship-finalization, Property 39: Unexplained type-suppression directives are corrected or annotated
//
// Property 39 (design "Correctness Properties"):
//   For any `@ts-ignore` / `@ts-nocheck` directive that has no adjacent
//   explanatory comment, the fixer SHALL either correct the underlying error
//   (removing the directive) or add an adjacent explanatory comment. Directives
//   that already carry an explanation — either inline on the same line or on the
//   immediately preceding comment line — SHALL NOT be flagged.
//
// **Validates: Requirements 10.2**
//
// This test drives `detectTsJsSafety` + `fixTsJsSafety` from
// `src/finalization/detectors/tsJsSafety.ts`. It generates TypeScript source
// composed of independently-chosen directive blocks of three kinds:
//   - unexplained:     a bare `// @ts-ignore` with a code line before it,
//   - explained-inline: `// @ts-ignore <reason>` on the same line,
//   - explained-above:  an explanatory comment line directly above the directive.
// It then asserts the detector flags exactly the unexplained directives, the
// fixer responds to each with an inserted explanatory comment, and re-detecting
// the patched source yields zero suppression findings (the fix resolved them).

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  detectTsJsSafety,
  fixTsJsSafety,
  TS_JS_KINDS,
} from '../detectors/tsJsSafety';
import type { Edit, Finding, FileRecord } from '../types';

type BlockKind = 'unexplained' | 'explained-inline' | 'explained-above';

interface Block {
  readonly kind: BlockKind;
  readonly directive: 'ignore' | 'nocheck';
  /** Reason text for inline / above explanations (whole words). */
  readonly reason: string;
}

/** Build a TS FileRecord from raw content. */
function buildRecord(content: string): FileRecord {
  return {
    path: 'src/sample.ts',
    content,
    bytes: content.length,
    readError: null,
    language: 'typescript',
  };
}

/**
 * Assembles a source document from the chosen blocks. Returns the source text
 * together with the set of 1-based line numbers that carry an *unexplained*
 * directive (the expected suppression findings).
 *
 * Every block starts with a plain code line so that the line immediately
 * preceding an unexplained directive is never a comment (which the detector
 * would treat as an explanation).
 */
function assemble(blocks: readonly Block[]): {
  source: string;
  unexplainedLines: number[];
} {
  const lines: string[] = [];
  const unexplainedLines: number[] = [];

  blocks.forEach((block, index) => {
    // Code filler line — guarantees the line above an unexplained directive is
    // executable code, not a comment.
    lines.push(`const filler${index} = ${index};`);

    const directiveComment = `// @ts-${block.directive}`;

    switch (block.kind) {
      case 'unexplained': {
        lines.push(directiveComment);
        unexplainedLines.push(lines.length); // 1-based line of the directive
        break;
      }
      case 'explained-inline': {
        lines.push(`${directiveComment} ${block.reason}`);
        break;
      }
      case 'explained-above': {
        lines.push(`// ${block.reason}`);
        lines.push(directiveComment);
        break;
      }
    }
  });

  return { source: lines.join('\n'), unexplainedLines };
}

/**
 * Applies a set of single-line `insert` edits to source content. Each edit
 * inserts its (newline-terminated) text before the line named by `range.line`.
 * Edits are applied from the bottom up so earlier line numbers stay valid.
 */
function applyInserts(content: string, edits: readonly Edit[]): string {
  const lines = content.split('\n');
  const sorted = [...edits].sort(
    (a, b) => (b.range?.line ?? 0) - (a.range?.line ?? 0),
  );
  for (const edit of sorted) {
    const line = edit.range?.line ?? 1;
    const text = (edit.text ?? '').replace(/\n$/, '');
    lines.splice(line - 1, 0, text);
  }
  return lines.join('\n');
}

const reasonArb = fc
  .array(
    fc.constantFrom(
      'legacy',
      'required',
      'upstream',
      'typings',
      'missing',
      'api',
      'temporary',
      'narrowing',
    ),
    { minLength: 1, maxLength: 4 },
  )
  .map((words) => words.join(' '));

const blockArb: fc.Arbitrary<Block> = fc.record({
  kind: fc.constantFrom<BlockKind>(
    'unexplained',
    'explained-inline',
    'explained-above',
  ),
  directive: fc.constantFrom<'ignore' | 'nocheck'>('ignore', 'nocheck'),
  reason: reasonArb,
});

const suppressionFindings = (records: readonly FileRecord[]): Finding[] =>
  detectTsJsSafety(records).filter(
    (finding) => finding.kind === TS_JS_KINDS.tsSuppression,
  );

describe('Property 39: Unexplained type-suppression directives are corrected or annotated', () => {
  it('flags exactly the unexplained directives, and the fixer annotates each so re-detection is clean', () => {
    fc.assert(
      fc.property(
        fc.array(blockArb, { minLength: 1, maxLength: 10 }),
        (blocks) => {
          const { source, unexplainedLines } = assemble(blocks);
          const record = buildRecord(source);

          // 1. Detection flags exactly the unexplained directive lines.
          const findings = suppressionFindings([record]);
          const flaggedLines = findings
            .map((finding) => finding.location.line ?? -1)
            .sort((a, b) => a - b);
          expect(flaggedLines).toEqual(
            [...unexplainedLines].sort((a, b) => a - b),
          );

          // 2. Every flagged directive is corrected or annotated by the fixer:
          //    here the fixer inserts an adjacent explanatory comment.
          const allEdits: Edit[] = [];
          for (const finding of findings) {
            const outcome = fixTsJsSafety(finding, record);
            // The directive is annotated (not preserved as-is).
            expect(outcome.preserved).toBe(false);
            expect(outcome.edits.length).toBe(1);
            const [edit] = outcome.edits;
            expect(edit.kind).toBe('insert');
            // The inserted text is a non-empty explanatory comment.
            expect((edit.text ?? '').includes('//')).toBe(true);
            expect((edit.text ?? '').replace(/[/\s]/g, '').length).toBeGreaterThan(0);
            allEdits.push(edit);
          }

          // 3. Applying the fixes resolves the findings: the patched source has
          //    no remaining unexplained suppression directives.
          const patched = applyInserts(source, allEdits);
          const remaining = suppressionFindings([buildRecord(patched)]);
          expect(remaining).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('does not flag a directive explained inline on the same line', () => {
    const record = buildRecord(
      ['const value = 1;', '// @ts-ignore reason it is needed here'].join('\n'),
    );
    expect(suppressionFindings([record])).toEqual([]);
  });

  it('does not flag a directive explained by the preceding comment line', () => {
    const record = buildRecord(
      [
        'const value = 1;',
        '// upstream typings are wrong for this call',
        '// @ts-nocheck',
      ].join('\n'),
    );
    expect(suppressionFindings([record])).toEqual([]);
  });

  it('flags a bare directive with no adjacent explanation', () => {
    const record = buildRecord(['const value = 1;', '// @ts-ignore'].join('\n'));
    const findings = suppressionFindings([record]);
    expect(findings.length).toBe(1);
    expect(findings[0].location.line).toBe(2);
    expect(findings[0].kind).toBe(TS_JS_KINDS.tsSuppression);
  });
});
