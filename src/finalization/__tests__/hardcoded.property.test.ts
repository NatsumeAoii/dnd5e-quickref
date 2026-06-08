// Feature: pre-ship-finalization, Property 12: Config literals are hoisted to a single definition
//
// Validates: Requirements 4.3
//
// Property 12 (design "Correctness Properties"):
//   For any source containing a configuration URL, port, or absolute path
//   repeated one or more times, the fixed output SHALL contain exactly one
//   definition location for that value referenced everywhere else.
//
// This exercises `hardcodedDetector` + `hardcodedFixer` from
// `src/finalization/detectors/hardcoded.ts`. Both are pure functions over
// `FileRecord[]`, so the test feeds generated source through detect -> fix,
// applies the resulting whole-file replace, and asserts the hoisting invariant
// directly on the rewritten text and via a second detection pass.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  HARDCODED_KINDS,
  hardcodedDetector,
  hardcodedFixer,
} from '../detectors/hardcoded';
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract the single whole-file `replace` edit a config-literal fix emits and
 * return its new content, or `null` when no such edit is present.
 */
function applyWholeFileReplace(
  record: FileRecord,
  outcome: FixOutcome,
): string | null {
  const edit = outcome.edits.find(
    (e) => e.kind === 'replace' && e.path === record.path && e.range === undefined,
  );
  return edit && edit.text !== undefined ? edit.text : null;
}

function countConfigFindings(record: FileRecord): number {
  return hardcodedDetector
    .detect([record])
    .filter((f) => f.kind === HARDCODED_KINDS.configLiteral).length;
}

// ---------------------------------------------------------------------------
// Scenario generators
// ---------------------------------------------------------------------------

type Scenario =
  | { kind: 'url' | 'path'; value: string; varName: string; occurrences: number }
  | { kind: 'port'; value: string; varName: string };

const urlScenario: fc.Arbitrary<Scenario> = fc
  .record({
    scheme: fc.constantFrom('https', 'http'),
    host: fc.constantFrom(
      'api.example.com',
      'cdn.example.org',
      'service.test.io',
      'data.host.net',
      'assets.example.dev',
    ),
    route: fc.constantFrom('/v1', '/v1/users', '/assets/data', '/config/app', '/static/img'),
    varName: fc.constantFrom(
      'endpointUrl',
      'resourceUrl',
      'apiBase',
      'serviceLocation',
      'dataSource',
    ),
    occurrences: fc.integer({ min: 1, max: 4 }),
  })
  .map(({ scheme, host, route, varName, occurrences }) => ({
    kind: 'url' as const,
    value: `${scheme}://${host}${route}`,
    varName,
    occurrences,
  }));

const pathScenario: fc.Arbitrary<Scenario> = fc
  .record({
    root: fc.constantFrom('/usr', '/home', '/var', '/opt', '/etc'),
    sub: fc.constantFrom(
      'local/data',
      'app/config.json',
      'share/assets',
      'lib/module',
      'cache/files',
    ),
    varName: fc.constantFrom(
      'resourcePath',
      'filePath',
      'dataLocation',
      'assetDir',
      'outputPath',
    ),
    occurrences: fc.integer({ min: 1, max: 4 }),
  })
  .map(({ root, sub, varName, occurrences }) => ({
    kind: 'path' as const,
    value: `${root}/${sub}`,
    varName,
    occurrences,
  }));

const portScenario: fc.Arbitrary<Scenario> = fc
  .record({
    port: fc.integer({ min: 1024, max: 65535 }),
    varName: fc.constantFrom('serverPort', 'listenPort', 'httpPort', 'devPort', 'appPort'),
  })
  .map(({ port, varName }) => ({
    kind: 'port' as const,
    value: String(port),
    varName,
  }));

const scenarioArb: fc.Arbitrary<Scenario> = fc.oneof(
  urlScenario,
  pathScenario,
  portScenario,
);

/**
 * Build a single-file TypeScript source embedding exactly one distinct config
 * literal. String literals (URL/path) are repeated `occurrences` times; the
 * port literal appears once (assigned to a port-named variable).
 */
function buildSource(scenario: Scenario): string {
  if (scenario.kind === 'port') {
    return (
      `const ${scenario.varName} = ${scenario.value};\n` +
      `function startup() {\n` +
      `  return ${scenario.varName};\n` +
      `}\n`
    );
  }
  const lines = [`const ${scenario.varName} = "${scenario.value}";`, `function useResource() {`];
  for (let i = 1; i < scenario.occurrences; i++) {
    lines.push(`  consume("${scenario.value}");`);
  }
  lines.push(`  return ${scenario.varName};`, `}`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Property 12
// ---------------------------------------------------------------------------

describe('Property 12: Config literals are hoisted to a single definition', () => {
  it('hoists every repeated config URL/port/path to exactly one definition referenced elsewhere', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const content = buildSource(scenario);
        const record = makeRecord(SOURCE_PATH, content);

        // Detection surfaces exactly one config-literal finding for the value
        // (string occurrences are de-duplicated; the port appears once).
        const findings = hardcodedDetector
          .detect([record])
          .filter((f) => f.kind === HARDCODED_KINDS.configLiteral);
        expect(findings.length).toBe(1);

        // Fixing performs a real hoist, not a preservation.
        const outcome = hardcodedFixer.fix(findings[0], record);
        expect(outcome.preserved).toBe(false);

        const newContent = applyWholeFileReplace(record, outcome);
        expect(newContent).not.toBeNull();
        const fixed = newContent as string;

        // The hoisted value now lives in a single named-constant definition.
        if (scenario.kind === 'port') {
          const defRe = new RegExp(
            `const [A-Z_][A-Z0-9_]* = ${escapeRegExp(scenario.value)};`,
            'g',
          );
          expect((fixed.match(defRe) ?? []).length).toBe(1);
        } else {
          const quoted = `"${scenario.value}"`;
          // Exactly one definition location for the literal value.
          expect(fixed.split(quoted).length - 1).toBe(1);
          const defRe = new RegExp(
            `const [A-Z_][A-Z0-9_]* = ${escapeRegExp(quoted)};`,
          );
          expect(defRe.test(fixed)).toBe(true);
        }

        // Re-detecting the fixed output finds no further config literals to
        // hoist: the duplication is gone and the value sits in one definition.
        expect(countConfigFindings(makeRecord(SOURCE_PATH, fixed))).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
