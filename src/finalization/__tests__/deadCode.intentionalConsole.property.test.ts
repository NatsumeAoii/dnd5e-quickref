// Feature: pre-ship-finalization, Property 8: Intentional console statements are preserved with recorded purpose
//
// Property 8 (design "Correctness Properties"):
//   For any console statement carrying an adjacent comment declaring an
//   intentional production purpose, the fixer preserves the statement and
//   records the declared purpose.
//
// **Validates: Requirements 3.2**
//
// Requirement 3.2:
//   WHERE a `console` statement has an adjacent code comment declaring an
//   intentional production purpose, THE Finalization_Agent SHALL preserve the
//   statement and record the declared purpose in the Finalization_Report.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  deadCodeDetector,
  deadCodeFixer,
  applyDeadCodeFix,
  DEAD_CODE_KINDS,
} from '../detectors/deadCode';
import { type FileRecord, type SourceLanguage } from '../types';

/**
 * Build a minimal FileRecord for a source string. The detector inspects only
 * `content` and `language`.
 */
function tsRecord(
  content: string,
  path = 'src/example.ts',
  language: SourceLanguage = 'typescript',
): FileRecord {
  return { path, content, bytes: content.length, readError: null, language };
}

/**
 * `console` methods that are NOT in the detector's allowed production-logging
 * set ('warn', 'error', 'info', 'assert'). Each of these is a candidate debug
 * call that, when carrying an intentional-purpose comment, becomes a preserved
 * `console-intentional` finding rather than a removable `console-debug` one.
 */
const NON_ALLOWED_CONSOLE_METHODS = [
  'log',
  'debug',
  'trace',
  'dir',
  'table',
  'group',
  'groupEnd',
  'count',
  'time',
  'timeEnd',
] as const;

/**
 * Phrases the detector's INTENTIONAL_CONSOLE_RE recognizes as declaring a
 * deliberate production purpose for an adjacent `console` call.
 */
const INTENTIONAL_PHRASES = [
  'intentional',
  'on purpose',
  'deliberate',
  'keep this',
  'keep for',
  'production log',
  'prod log',
  'do not remove',
] as const;

/** Safe alphanumeric words used to pad the comment around the phrase. */
const wordArb = fc.stringMatching(/^[a-z]{2,8}$/);

/** A safe single-quoted string argument that contains no comment markers. */
const argArb = fc
  .stringMatching(/^[A-Za-z0-9 ]{0,20}$/)
  .map((s) => `'${s}'`);

/** Indentation prefix, exercising both top-level and nested placement. */
const indentArb = fc.constantFrom('', '  ', '    ', '\t');

/**
 * Build a comment string embedding an intentional phrase amongst filler words,
 * for either a line (`//`) or block (`/* *\/`) comment.
 */
function buildComment(
  style: 'line' | 'block',
  phrase: string,
  lead: string,
  tail: string,
): string {
  const body = `${lead} ${phrase} ${tail}`.trim();
  return style === 'line' ? `// ${body}` : `/* ${body} */`;
}

describe('Property 8: Intentional console statements are preserved with recorded purpose', () => {
  it('preserves a console call with an intentional comment on the line above', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_ALLOWED_CONSOLE_METHODS),
        fc.constantFrom(...INTENTIONAL_PHRASES),
        fc.constantFrom<'line' | 'block'>('line', 'block'),
        wordArb,
        wordArb,
        argArb,
        indentArb,
        (method, phrase, style, lead, tail, arg, indent) => {
          const comment = buildComment(style, phrase, lead, tail);
          const content = `${indent}${comment}\n${indent}console.${method}(${arg});\n`;
          const record = tsRecord(content);

          const findings = deadCodeDetector.detect([record]);
          const intentional = findings.filter(
            (f) => f.kind === DEAD_CODE_KINDS.consoleIntentional,
          );

          // Exactly one intentional finding; never misclassified as debug.
          expect(intentional).toHaveLength(1);
          expect(
            findings.some((f) => f.kind === DEAD_CODE_KINDS.consoleDebug),
          ).toBe(false);

          // The intentional finding is not auto-fixable (it must be preserved).
          expect(intentional[0].autoFixable).toBe(false);

          // The fixer preserves the statement: no edits, preserved flag set.
          const outcome = deadCodeFixer.fix(intentional[0], record);
          expect(outcome.preserved).toBe(true);
          expect(outcome.edits).toHaveLength(0);

          // The declared purpose is recorded: the preservation reason carries
          // the finding detail, which quotes the intentional comment text.
          const reason = outcome.preservationReason ?? '';
          expect(reason.length).toBeGreaterThan(0);
          expect(reason).toContain(intentional[0].detail);
          expect(reason).toContain(comment.trim());

          // The source is left byte-for-byte unchanged by the fix.
          expect(applyDeadCodeFix(content, intentional[0])).toBe(content);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('preserves a console call with a trailing intentional comment on the same line', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_ALLOWED_CONSOLE_METHODS),
        fc.constantFrom(...INTENTIONAL_PHRASES),
        wordArb,
        wordArb,
        argArb,
        indentArb,
        (method, phrase, lead, tail, arg, indent) => {
          const comment = buildComment('line', phrase, lead, tail);
          const content = `${indent}console.${method}(${arg}); ${comment}\n`;
          const record = tsRecord(content);

          const findings = deadCodeDetector.detect([record]);
          const intentional = findings.filter(
            (f) => f.kind === DEAD_CODE_KINDS.consoleIntentional,
          );

          expect(intentional).toHaveLength(1);
          expect(
            findings.some((f) => f.kind === DEAD_CODE_KINDS.consoleDebug),
          ).toBe(false);
          expect(intentional[0].autoFixable).toBe(false);

          const outcome = deadCodeFixer.fix(intentional[0], record);
          expect(outcome.preserved).toBe(true);
          expect(outcome.edits).toHaveLength(0);

          const reason = outcome.preservationReason ?? '';
          expect(reason).toContain(intentional[0].detail);
          expect(reason).toContain(comment.trim());

          // The console statement is still present and unchanged after the fix.
          const fixed = applyDeadCodeFix(content, intentional[0]);
          expect(fixed).toBe(content);
          expect(fixed).toContain(`console.${method}(`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('distinguishes intentional from debug: an identical call without a purpose comment is removable', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_ALLOWED_CONSOLE_METHODS),
        argArb,
        indentArb,
        (method, arg, indent) => {
          // No intentional-purpose comment: this is a plain debug artifact.
          const content = `${indent}console.${method}(${arg});\n`;
          const record = tsRecord(content);

          const findings = deadCodeDetector.detect([record]);
          // It is classified as debug (removable), not intentional (preserved).
          expect(
            findings.some((f) => f.kind === DEAD_CODE_KINDS.consoleIntentional),
          ).toBe(false);
          const debug = findings.filter(
            (f) => f.kind === DEAD_CODE_KINDS.consoleDebug,
          );
          expect(debug).toHaveLength(1);
          expect(debug[0].autoFixable).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
