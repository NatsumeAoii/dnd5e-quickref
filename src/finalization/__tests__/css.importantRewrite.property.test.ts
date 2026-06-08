// Feature: pre-ship-finalization, Property 43: Non-accessibility `!important` is rewritten preserving computed style, else preserved with reason
//
// Property 43 (design "Correctness Properties"):
//   For a non-accessibility `!important` declaration, the CSS fixer either
//     (a) rewrites it via increased selector specificity so the declaration
//         wins the cascade WITHOUT `!important`, producing an identical
//         computed style (same property, same value, higher specificity than
//         every competing declaration of that property), OR
//     (b) preserves the declaration and records a reason, when an identical
//         computed style cannot be guaranteed without `!important` (for example
//         a bare type selector whose final compound has no class or id to
//         duplicate).
//
// **Validates: Requirements 11.2, 11.3**
//
// This is a behavior-preservation property: it does not compare raw strings.
// Each generated case constructs a stylesheet where exactly one
// non-accessibility `!important` declaration is outranked by a competing,
// non-important declaration of the same property (so dropping `!important`
// naively would change the computed style). The test then asserts:
//   - BOOSTABLE selectors (a class/id on the final compound) are rewritten:
//     the fixer emits an edit whose winning rule carries the identical
//     declaration without `!important` at a strictly higher specificity than
//     the competitor, so the cascade still resolves to the same value.
//   - UN-BOOSTABLE selectors (a bare type selector) are preserved with a
//     recorded, non-empty reason and zero edits.
//
// Specificity is recomputed independently in this test so the assertion does
// not depend on the module's internal helpers.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { cssDetector, cssFixer } from '../detectors/css';
import type { FileRecord, Finding } from '../types';

// ---------------------------------------------------------------------------
// Independent specificity model (mirrors CSS cascade rules for the simple
// class/id/type selectors generated below).
// ---------------------------------------------------------------------------

type Specificity = [number, number, number];

/** Computes `[ids, classes, types]` specificity for a single (non-list) part. */
function specificity(selectorPart: string): Specificity {
  let part = selectorPart.trim();
  let a = 0;
  let b = 0;
  let c = 0;
  part = part.replace(/#[\w-]+/g, () => {
    a++;
    return ' ';
  });
  part = part.replace(/\.[\w-]+/g, () => {
    b++;
    return ' ';
  });
  for (const m of part.matchAll(/(^|[\s>+~])([a-zA-Z][\w-]*)/g)) {
    if (m[2]) c++;
  }
  return [a, b, c];
}

/** Lexicographic comparison (`> 0` when `x` wins the cascade over `y`). */
function compareSpecificity(x: Specificity, y: Specificity): number {
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Minimal rule parser for the fixer's emitted edit text (well-formed, flat).
// ---------------------------------------------------------------------------

interface ParsedRule {
  readonly selector: string;
  readonly body: string;
}

/** Extracts `selector { body }` blocks from flat, comment-free CSS text. */
function parseFlatRules(css: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    rules.push({ selector: m[1].trim(), body: m[2] });
  }
  return rules;
}

/** Highest specificity across a (possibly comma-separated) selector list. */
function maxListSpecificity(selectorList: string): Specificity {
  let best: Specificity = [0, 0, 0];
  for (const part of selectorList.split(',')) {
    const spec = specificity(part);
    if (compareSpecificity(spec, best) > 0) best = spec;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Stylesheet construction.
// ---------------------------------------------------------------------------

const PROPERTY = 'color';
const TARGET_VALUE = 'red';
const COMPETITOR_VALUE = 'blue';

function cssRecord(content: string): FileRecord {
  return {
    path: 'styles.css',
    content,
    bytes: content.length,
    readError: null,
    language: 'css',
  };
}

/** Finds the single non-accessibility `!important` finding for a selector. */
function importantFinding(record: FileRecord, selector: string): Finding | undefined {
  return cssDetector
    .detect([record])
    .find((f) => f.kind === 'important' && f.location.selector === selector);
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

const nameArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
      minLength: min,
      maxLength: max,
    })
    .map((chars) => chars.join(''));

const TYPE_NAMES = ['div', 'span', 'section', 'p', 'main', 'header', 'article'];

interface BoostableCase {
  readonly targetClass: string;
  readonly competitorClasses: readonly string[];
}

// A boostable target is a single class selector; the competitor is a chain of
// 1..6 classes of the SAME property without `!important`, so it outranks the
// target and forces a specificity rewrite (never an in-place no-op removal).
const boostableArb: fc.Arbitrary<BoostableCase> = fc.record({
  targetClass: nameArb(2, 6),
  competitorClasses: fc.array(nameArb(2, 6), { minLength: 1, maxLength: 6 }),
});

interface UnboostableCase {
  readonly targetType: string;
  readonly competitorClass: string;
  readonly competitorType: string;
}

// An un-boostable target is a bare type selector (no class/id on its final
// compound). The competitor (`.cls type`) outranks it, so the declaration
// cannot be raised above the competitor without `!important` and must be kept.
const unboostableArb: fc.Arbitrary<UnboostableCase> = fc.record({
  targetType: fc.constantFrom(...TYPE_NAMES),
  competitorClass: nameArb(2, 6),
  competitorType: fc.constantFrom(...TYPE_NAMES),
});

// ---------------------------------------------------------------------------
// Core assertions.
// ---------------------------------------------------------------------------

function checkBoostable(testCase: BoostableCase): void {
  const targetSelector = `.${testCase.targetClass}`;
  const competitorSelector = testCase.competitorClasses
    .map((cls) => `.${cls}`)
    .join('');
  const content =
    `${targetSelector} { ${PROPERTY}: ${TARGET_VALUE} !important; }\n` +
    `${competitorSelector} { ${PROPERTY}: ${COMPETITOR_VALUE}; }\n`;
  const record = cssRecord(content);

  const finding = importantFinding(record, targetSelector);
  expect(finding, `expected a non-accessibility !important finding for ${targetSelector}`).toBeDefined();
  if (!finding) return;

  const outcome = cssFixer.fix(finding, record);

  // A boostable declaration is rewritten, never preserved.
  expect(outcome.preserved).toBe(false);
  expect(outcome.edits.length).toBeGreaterThanOrEqual(1);

  const editText = outcome.edits.map((e) => e.text ?? '').join('\n');
  const rules = parseFlatRules(editText);
  expect(rules.length).toBeGreaterThanOrEqual(1);

  // The winning rule carries the identical declaration without `!important`.
  const winning = rules.find(
    (r) =>
      r.body.includes(`${PROPERTY}: ${TARGET_VALUE}`) &&
      !/!\s*important/i.test(r.body),
  );
  expect(winning, 'expected a rewritten rule carrying the target declaration without !important').toBeDefined();
  if (!winning) return;

  // Behavior preservation: the rewritten selector outranks the competitor, so
  // the cascade still resolves the property to the target value.
  const competitorSpec = specificity(competitorSelector);
  const targetSpec = specificity(targetSelector);
  const winningSpec = maxListSpecificity(winning.selector);
  expect(compareSpecificity(winningSpec, competitorSpec)).toBeGreaterThan(0);
  expect(compareSpecificity(winningSpec, targetSpec)).toBeGreaterThan(0);

  // The emitted edit text contains no `!important` for the rewritten property.
  expect(/!\s*important/i.test(editText)).toBe(false);
}

function checkUnboostable(testCase: UnboostableCase): void {
  const targetSelector = testCase.targetType;
  const competitorSelector = `.${testCase.competitorClass} ${testCase.competitorType}`;
  const content =
    `${targetSelector} { ${PROPERTY}: ${TARGET_VALUE} !important; }\n` +
    `${competitorSelector} { ${PROPERTY}: ${COMPETITOR_VALUE}; }\n`;
  const record = cssRecord(content);

  const finding = importantFinding(record, targetSelector);
  expect(finding, `expected a non-accessibility !important finding for ${targetSelector}`).toBeDefined();
  if (!finding) return;

  // Sanity: the competitor really does outrank the bare type target, so a naive
  // `!important` removal would change the computed style.
  expect(compareSpecificity(specificity(competitorSelector), specificity(targetSelector))).toBeGreaterThan(0);

  const outcome = cssFixer.fix(finding, record);

  // An un-boostable declaration is preserved with a recorded, non-empty reason
  // and produces no edits.
  expect(outcome.preserved).toBe(true);
  expect(outcome.edits).toHaveLength(0);
  expect(typeof outcome.preservationReason).toBe('string');
  expect((outcome.preservationReason ?? '').length).toBeGreaterThan(0);
  expect(outcome.preservationReason).toContain('preserved');
}

// ---------------------------------------------------------------------------
// Property 43.
// ---------------------------------------------------------------------------

describe('Property 43: Non-accessibility !important is rewritten preserving computed style, else preserved with reason', () => {
  it('rewrites a boostable !important to win the cascade without !important', () => {
    fc.assert(
      fc.property(boostableArb, (testCase) => {
        checkBoostable(testCase);
      }),
      { numRuns: 150 },
    );
  });

  it('preserves an un-boostable !important with a recorded reason', () => {
    fc.assert(
      fc.property(unboostableArb, (testCase) => {
        checkUnboostable(testCase);
      }),
      { numRuns: 150 },
    );
  });

  // Deterministic coverage so neither branch can hide behind generation luck.
  it('rewrites a class-selector !important above a multi-class competitor', () => {
    checkBoostable({ targetClass: 'button', competitorClasses: ['panel', 'active', 'wide'] });
  });

  it('preserves a bare-type !important outranked by a descendant rule', () => {
    checkUnboostable({ targetType: 'div', competitorClass: 'box', competitorType: 'div' });
  });
});
