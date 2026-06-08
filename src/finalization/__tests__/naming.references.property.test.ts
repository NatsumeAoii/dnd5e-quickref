// Feature: pre-ship-finalization, Property 20: Renames update all static references and preserve binding
//
// Validates: Requirements 6.2
//
// Property 20 (design "Correctness Properties"):
//   For any placeholder identifier with N static references, the rename SHALL
//   update all N references so that every reference resolves to the same
//   binding and the program's observable behavior is unchanged.
//
// This exercises `namingDetector` + `namingFixer` from
// `src/finalization/detectors/naming.ts`. Both are pure functions over
// `FileRecord[]`, so the test generates a non-test source that declares a
// placeholder identifier with N static (non-string, non-member) references,
// runs detect -> fix, applies the resulting whole-file replace, and asserts:
//   - all N occurrences of the old name are renamed to the new name,
//   - no occurrence of the old name remains as a code reference, and
//   - the count of the new identifier equals the old occurrence count.
//
// Occurrence counting uses the detector's own `maskSource` so that only
// genuine code tokens are counted (string-literal and comment text excluded).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { maskSource, namingDetector, namingFixer } from '../detectors/naming';
import type { FileRecord, FixOutcome } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_PATH = 'src/feature.ts';

function makeRecord(path: string, content: string): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: 'typescript',
  };
}

/**
 * Count occurrences of `name` as a whole code token (string literals and
 * comments are masked out by `maskSource`). Identifier boundaries follow the
 * `[A-Za-z0-9_$]` token character class the detector uses.
 */
function countCodeToken(content: string, name: string): number {
  const { codeMask } = maskSource(content);
  const pattern = new RegExp(
    `(?<![A-Za-z0-9_$])${escapeRegExp(name)}(?![A-Za-z0-9_$])`,
    'g',
  );
  return (codeMask.match(pattern) ?? []).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract the single whole-file `replace` edit the naming fixer emits and
 * return its new content, or `null` when no such edit is present.
 */
function applyWholeFileReplace(
  record: FileRecord,
  outcome: FixOutcome,
): string | null {
  const edit = outcome.edits.find(
    (e) =>
      e.kind === 'replace' &&
      e.path === record.path &&
      e.range === undefined,
  );
  return edit && edit.text !== undefined ? edit.text : null;
}

// ---------------------------------------------------------------------------
// Scenario generator
// ---------------------------------------------------------------------------

interface Scenario {
  /** The exact placeholder identifier name as it appears in source. */
  readonly name: string;
  /** Number of additional reference statements beyond declaration + return. */
  readonly extraRefs: number;
}

// Every value is a case-insensitive match to the placeholder set
// (foo, bar, temp, test123) per Requirement 6.1, in varied casings so the
// rename machinery is exercised across casing conventions.
const placeholderNameArb = fc.constantFrom(
  'foo',
  'Foo',
  'FOO',
  'bar',
  'Bar',
  'temp',
  'Temp',
  'TEMP',
  'test123',
  'Test123',
);

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  name: placeholderNameArb,
  extraRefs: fc.integer({ min: 0, max: 6 }),
});

/**
 * Build a single-file TypeScript source that declares the placeholder
 * identifier and references it exclusively through static (non-string,
 * non-member) code references, so the fixer treats it as auto-renameable.
 *
 * Total occurrences of the name = 1 (declaration) + extraRefs + 1 (return).
 */
function buildSource(scenario: Scenario): string {
  const { name, extraRefs } = scenario;
  const lines = [`const ${name} = 0;`, `function compute() {`, `  let acc = 0;`];
  for (let i = 0; i < extraRefs; i += 1) {
    lines.push(`  acc = acc + ${name};`);
  }
  lines.push(`  return acc + ${name};`, `}`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Property 20
// ---------------------------------------------------------------------------

describe('Property 20: Renames update all static references and preserve binding', () => {
  it('renames every static reference of a placeholder identifier and leaves none behind', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const content = buildSource(scenario);
        const record = makeRecord(SOURCE_PATH, content);

        const oldCount = countCodeToken(content, scenario.name);
        // declaration + extraRefs + return => at least 2 occurrences.
        expect(oldCount).toBe(scenario.extraRefs + 2);

        // Detection surfaces exactly one auto-fixable placeholder finding.
        const findings = namingDetector
          .detect([record])
          .filter((f) => f.kind === 'placeholder-identifier');
        expect(findings.length).toBe(1);
        expect(findings[0].autoFixable).toBe(true);

        // Fixing performs a real rename, not a preservation.
        const outcome = namingFixer.fix(findings[0], record);
        expect(outcome.preserved).toBe(false);

        const newContent = applyWholeFileReplace(record, outcome);
        expect(newContent).not.toBeNull();
        const fixed = newContent as string;

        // Recover the new name: the identifier at the declaration site.
        const declMatch = fixed.match(/^const\s+([A-Za-z_$][\w$]*)\s*=/);
        expect(declMatch).not.toBeNull();
        const newName = (declMatch as RegExpMatchArray)[1];

        // The replacement is a genuinely different, non-placeholder name.
        expect(newName).not.toBe(scenario.name);

        // No occurrence of the old name remains as a code reference.
        expect(countCodeToken(fixed, scenario.name)).toBe(0);

        // The new identifier appears exactly as many times as the old one did:
        // all N references were updated and none were dropped or duplicated.
        expect(countCodeToken(fixed, newName)).toBe(oldCount);
      }),
      { numRuns: 200 },
    );
  });
});
