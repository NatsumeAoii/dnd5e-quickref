// Feature: pre-ship-finalization, Property 51: No unresolved, undocumented placeholders remain
//
// Validates: Requirements 14.4
//
// Property text: The count of [FILL IN] markers that are neither resolved nor
// documented is zero — every occurrence is enumerated.
//
// Strategy: generate an inventory (FileRecord[]) where each file carries a
// controlled, known number of FILL_IN_PLACEHOLDER occurrences spread across
// lines (and sometimes multiple per line). Because the generator builds the
// content from a placeholder plan, the exact expected occurrence count is known
// independently of the implementation. The test then asserts:
//   1. collectPlaceholders enumerates exactly that many refs, each carrying the
//      backing record path and a populated line/column location.
//   2. Every enumerated ref's path is one of the input record paths and its
//      reported location actually points at a FILL_IN_PLACEHOLDER in that file.
//   3. countUndocumentedPlaceholders(records, collected) === 0 — once every
//      occurrence is documented (which collectPlaceholders does by construction),
//      no marker is left unresolved-and-undocumented (Requirement 14.4).
//   4. Documenting a strict subset leaves exactly the remaining count
//      undocumented, and an empty documented set leaves the full count
//      undocumented — confirming the accounting is exact, not vacuous.
//
// Read-failure records (content === null) contribute zero placeholders and must
// never be counted, so the generator mixes some in.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { FinalizationOrchestrator } from '../Orchestrator';
import { FileInventory } from '../FileInventory';
import { FILL_IN_PLACEHOLDER } from '../types';
import type { FileRecord, PlaceholderRef, SourceLanguage } from '../types';

/** Distinct repo-relative paths a generated record may use. */
const CANDIDATE_PATHS: readonly string[] = [
  'src/index.ts',
  'src/config.ts',
  'public/index.html',
  'styles/app.css',
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'vite.config.ts',
];

function pickLanguage(path: string): SourceLanguage {
  if (path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  return 'other';
}

/**
 * A plan for one file: the path and, per line, how many FILL_IN_PLACEHOLDER
 * tokens that line should contain (0 or more). `readable: false` models a
 * read-failure record that must contribute zero placeholders.
 */
interface FilePlan {
  readonly path: string;
  readonly perLineCounts: readonly number[];
  readonly readable: boolean;
}

/** Build the file content from a plan, returning content and total occurrences. */
function buildContent(plan: FilePlan): { content: string; occurrences: number } {
  const lines: string[] = [];
  let occurrences = 0;
  for (let i = 0; i < plan.perLineCounts.length; i += 1) {
    const count = plan.perLineCounts[i] ?? 0;
    occurrences += count;
    // Surround each marker with filler text so columns vary and markers can sit
    // mid-line, not only at column 1.
    const segments: string[] = [`line${i}`];
    for (let k = 0; k < count; k += 1) {
      segments.push(`key${k}=${FILL_IN_PLACEHOLDER}`);
    }
    lines.push(segments.join(' '));
  }
  return { content: lines.join('\n'), occurrences };
}

/** Materialize a plan into a FileRecord (read or read-failure). */
function toRecord(plan: FilePlan): { record: FileRecord; occurrences: number } {
  if (!plan.readable) {
    return {
      record: {
        path: plan.path,
        content: null,
        bytes: 0,
        readError: 'simulated read failure',
        language: pickLanguage(plan.path),
      },
      occurrences: 0,
    };
  }
  const { content, occurrences } = buildContent(plan);
  return {
    record: {
      path: plan.path,
      content,
      bytes: content.length,
      readError: null,
      language: pickLanguage(plan.path),
    },
    occurrences,
  };
}

/** An arbitrary plan: at least one line, each with 0..3 markers. */
function filePlanArbitrary(path: string): fc.Arbitrary<FilePlan> {
  return fc.record({
    path: fc.constant(path),
    perLineCounts: fc.array(fc.nat({ max: 3 }), { minLength: 1, maxLength: 8 }),
    readable: fc.boolean(),
  });
}

/**
 * An inventory of records over a distinct subset of paths, with the total known
 * placeholder occurrence count computed from the plans (not the implementation).
 */
const inventoryArbitrary: fc.Arbitrary<{
  records: readonly FileRecord[];
  totalOccurrences: number;
}> = fc
  .subarray([...CANDIDATE_PATHS], { minLength: 1, maxLength: CANDIDATE_PATHS.length })
  .chain((paths) =>
    fc.tuple(...paths.map((path) => filePlanArbitrary(path))),
  )
  .map((plans) => {
    const built = plans.map((plan) => toRecord(plan));
    return {
      records: built.map((b) => b.record),
      totalOccurrences: built.reduce((sum, b) => sum + b.occurrences, 0),
    };
  });

/** Assert a placeholder ref points at a real FILL_IN occurrence in the record. */
function refPointsAtPlaceholder(
  ref: PlaceholderRef,
  recordByPath: ReadonlyMap<string, FileRecord>,
): boolean {
  const record = recordByPath.get(ref.path);
  if (record === undefined || record.content === null) {
    return false;
  }
  const line = ref.location.line;
  const column = ref.location.column;
  if (line === undefined || column === undefined) {
    return false;
  }
  const text = record.content.split('\n')[line - 1] ?? '';
  return text.startsWith(FILL_IN_PLACEHOLDER, column - 1);
}

describe('Orchestrator placeholder accounting (Property 51)', () => {
  it('enumerates exactly the placeholders present, each traceable, and counts zero undocumented', () => {
    fc.assert(
      fc.property(inventoryArbitrary, ({ records, totalOccurrences }) => {
        const orchestrator = new FinalizationOrchestrator({
          inventory: new FileInventory(),
        });
        const recordByPath = new Map(records.map((r) => [r.path, r] as const));

        const collected = orchestrator.collectPlaceholders(records);

        // 1. Exactly as many refs as occurrences built into the inventory.
        expect(collected.length).toBe(totalOccurrences);

        // 2. Every ref is traceable to an input record and locates a real marker.
        const knownPaths = new Set(records.map((r) => r.path));
        for (const ref of collected) {
          expect(knownPaths.has(ref.path)).toBe(true);
          expect(ref.location.line).toBeGreaterThanOrEqual(1);
          expect(ref.location.column).toBeGreaterThanOrEqual(1);
          expect(refPointsAtPlaceholder(ref, recordByPath)).toBe(true);
        }

        // Read-failure records never contribute a placeholder.
        const failurePaths = new Set(
          records.filter((r) => r.content === null).map((r) => r.path),
        );
        for (const ref of collected) {
          expect(failurePaths.has(ref.path)).toBe(false);
        }

        // 3. Documenting every occurrence drives undocumented to zero (14.4).
        expect(
          orchestrator.countUndocumentedPlaceholders(records, collected),
        ).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it('counts exactly the remaining occurrences when only a subset is documented', () => {
    fc.assert(
      fc.property(
        inventoryArbitrary.chain((inventory) =>
          fc.tuple(
            fc.constant(inventory),
            fc.nat({ max: inventory.totalOccurrences }),
          ),
        ),
        ([{ records, totalOccurrences }, documentedCount]) => {
          const orchestrator = new FinalizationOrchestrator({
            inventory: new FileInventory(),
          });

          const collected = orchestrator.collectPlaceholders(records);
          expect(collected.length).toBe(totalOccurrences);

          // Document only a prefix subset of the enumerated refs.
          const documentedSubset = collected.slice(0, documentedCount);
          const expectedUndocumented = totalOccurrences - documentedCount;

          expect(
            orchestrator.countUndocumentedPlaceholders(
              records,
              documentedSubset,
            ),
          ).toBe(expectedUndocumented);

          // An empty documented set leaves the full count undocumented.
          expect(
            orchestrator.countUndocumentedPlaceholders(records, []),
          ).toBe(totalOccurrences);
        },
      ),
      { numRuns: 200 },
    );
  });
});
