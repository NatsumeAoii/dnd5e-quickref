// Feature: pre-ship-finalization, Property 44: Accessibility `!important` is always preserved with justification
//
// Property 44 (design "Correctness Properties"):
//   For any `!important` declaration that appears inside an accessibility media
//   query (prefers-reduced-motion, prefers-contrast, prefers-color-scheme,
//   forced-colors), the CssQualityDetector SHALL flag it with the
//   `accessibility-important` kind and mark it NOT auto-fixable, and the
//   CssQualityFixer SHALL return `preserved: true` with a non-empty
//   justification (it never edits the declaration away).
//
// **Validates: Requirements 11.4, 11.5**
//
// This test drives `CssQualityDetector` + `CssQualityFixer` from
// `src/finalization/detectors/css.ts`. It generates a CSS stylesheet that
// places one or more `!important` declarations inside one of the four
// accessibility media queries (optionally nested, optionally with surrounding
// non-important declarations and sibling rules), runs the detector over a
// single-file inventory, and asserts that every generated accessibility
// `!important` is reported as `accessibility-important`, not auto-fixable, and
// preserved with a justification by the fixer.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { CssQualityDetector, CssQualityFixer } from '../detectors/css';
import type { FileRecord } from '../types';

const KIND_ACCESSIBILITY_IMPORTANT = 'accessibility-important';

/** The four accessibility media features the toolkit must always preserve. */
const ACCESSIBILITY_FEATURES = [
  'prefers-reduced-motion: reduce',
  'prefers-contrast: more',
  'prefers-color-scheme: dark',
  'forced-colors: active',
] as const;

/** A single declaration to emit inside a rule. */
interface DeclChoice {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
}

const PROPERTIES = [
  'animation',
  'transition',
  'color',
  'background-color',
  'border-color',
  'opacity',
  'transform',
] as const;

const VALUES = ['none', 'red', '#fff', '0', '1', 'initial', 'inherit'] as const;

const declArb: fc.Arbitrary<DeclChoice> = fc.record({
  property: fc.constantFrom(...PROPERTIES),
  value: fc.constantFrom(...VALUES),
  important: fc.boolean(),
});

/** A rule (selector + declarations) placed inside the accessibility query. */
interface RuleChoice {
  readonly selector: string;
  readonly declarations: readonly DeclChoice[];
}

const SELECTORS = ['*', '.box', '#main', 'a', 'button.primary', '.a .b'] as const;

const ruleArb: fc.Arbitrary<RuleChoice> = fc.record({
  selector: fc.constantFrom(...SELECTORS),
  // At least one declaration, at least one of which we force to be !important
  // below so each accessibility query contributes a guaranteed finding.
  declarations: fc.array(declArb, { minLength: 1, maxLength: 4 }),
});

/** Renders a declaration to CSS text. */
function renderDecl(decl: DeclChoice): string {
  return `  ${decl.property}: ${decl.value}${decl.important ? ' !important' : ''};`;
}

/** Renders a rule to CSS text. */
function renderRule(rule: RuleChoice): string {
  return `${rule.selector} {\n${rule.declarations.map(renderDecl).join('\n')}\n}`;
}

/**
 * Forces at least one `!important` declaration into a rule, so every generated
 * accessibility media block is guaranteed to contain an accessibility
 * `!important` finding.
 */
function withForcedImportant(rule: RuleChoice): RuleChoice {
  const hasImportant = rule.declarations.some((d) => d.important);
  if (hasImportant) return rule;
  const [first, ...rest] = rule.declarations;
  return { selector: rule.selector, declarations: [{ ...first, important: true }, ...rest] };
}

/** Counts the `!important` declarations across a set of rules. */
function countImportant(rules: readonly RuleChoice[]): number {
  return rules.reduce(
    (total, rule) => total + rule.declarations.filter((d) => d.important).length,
    0,
  );
}

function makeRecord(content: string): FileRecord {
  return {
    path: 'src/styles/accessibility.css',
    content,
    bytes: content.length,
    readError: null,
    language: 'css',
  };
}

describe('Property 44: Accessibility `!important` is always preserved with justification', () => {
  it('flags every accessibility !important as non-auto-fixable and preserves it with a reason', () => {
    fc.assert(
      fc.property(
        // Which of the four accessibility features wraps the block.
        fc.integer({ min: 0, max: ACCESSIBILITY_FEATURES.length - 1 }),
        // Rules placed inside the accessibility media query.
        fc.array(ruleArb, { minLength: 1, maxLength: 3 }),
        // Whether to nest the accessibility query inside a width media query.
        fc.boolean(),
        (featureIndex, rawRules, nested) => {
          const feature = ACCESSIBILITY_FEATURES[featureIndex];
          const rules = rawRules.map(withForcedImportant);
          const ruleText = rules.map(renderRule).join('\n');

          const accessibilityBlock = `@media (${feature}) {\n${ruleText}\n}`;
          const css = nested
            ? `@media (min-width: 600px) {\n${accessibilityBlock}\n}`
            : accessibilityBlock;

          const record = makeRecord(css);
          const detector = new CssQualityDetector();
          const fixer = new CssQualityFixer();

          const findings = detector.detect([record]);
          const accessibilityFindings = findings.filter(
            (f) => f.kind === KIND_ACCESSIBILITY_IMPORTANT,
          );

          // Every !important inside the accessibility query is flagged as an
          // accessibility-important finding (one per declaration).
          const expectedImportant = countImportant(rules);
          expect(accessibilityFindings.length).toBe(expectedImportant);

          // No accessibility !important is ever reported as a plain rewritable
          // 'important' finding.
          expect(findings.some((f) => f.kind === 'important')).toBe(false);

          for (const finding of accessibilityFindings) {
            // 11.4: detector marks the finding NOT auto-fixable.
            expect(finding.autoFixable).toBe(false);
            expect(finding.domain).toBe('css');

            // 11.5: fixer always preserves with a non-empty justification and
            // emits no edits.
            const outcome = fixer.fix(finding, record);
            expect(outcome.preserved).toBe(true);
            expect(outcome.edits).toHaveLength(0);
            expect(outcome.preservationReason).toBeDefined();
            expect((outcome.preservationReason ?? '').trim().length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('preserves !important for each of the four accessibility media features', () => {
    const detector = new CssQualityDetector();
    const fixer = new CssQualityFixer();

    for (const feature of ACCESSIBILITY_FEATURES) {
      const css = `@media (${feature}) {\n  .x {\n    transition: none !important;\n  }\n}`;
      const record = makeRecord(css);

      const findings = detector
        .detect([record])
        .filter((f) => f.kind === KIND_ACCESSIBILITY_IMPORTANT);

      expect(findings).toHaveLength(1);
      expect(findings[0].autoFixable).toBe(false);

      const outcome = fixer.fix(findings[0], record);
      expect(outcome.preserved).toBe(true);
      expect(outcome.edits).toHaveLength(0);
      expect((outcome.preservationReason ?? '').trim().length).toBeGreaterThan(0);
    }
  });
});
