// Feature: pre-ship-finalization, Property 7: Debug artifacts are removed and absent after the fix
//
// Validates: Requirements 3.1, 3.4, 3.5
//
// Property 7 (design "Correctness Properties"):
//   For any source containing debug artifacts (`console.*` debug calls, non-doc
//   commented-out code, or bare `TODO`/`FIXME`) without a preservation
//   annotation, re-detecting the fixed output SHALL find zero such artifacts.
//
// This exercises `deadCodeDetector` + the dead-code fixer (`applyDeadCodeFix`)
// from `src/finalization/detectors/deadCode.ts`. Both are pure functions over
// file content. The test generates a TypeScript source embedding debug
// artifacts (and no preservation annotations), drives detect -> fix to a fixed
// point, and asserts a second detection pass finds zero debug artifacts.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DEAD_CODE_KINDS,
  applyDeadCodeFix,
  deadCodeDetector,
} from '../detectors/deadCode';
import type { FileRecord, Finding } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_PATH = 'src/feature.ts';

/**
 * The three "debug artifact" kinds Property 7 targets (Requirements 3.1, 3.4,
 * 3.5). Unreferenced imports/symbols/files are a different concern (3.3) and are
 * intentionally excluded from the fix loop and the final assertion.
 */
const DEBUG_ARTIFACT_KINDS: ReadonlySet<string> = new Set([
  DEAD_CODE_KINDS.consoleDebug,
  DEAD_CODE_KINDS.commentedCode,
  DEAD_CODE_KINDS.bareTodo,
]);

function makeRecord(path: string, content: string): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: 'typescript',
  };
}

/** Detect only the debug-artifact findings (the subset Property 7 governs). */
function detectDebugArtifacts(content: string): readonly Finding[] {
  return deadCodeDetector
    .detect([makeRecord(SOURCE_PATH, content)])
    .filter((f) => DEBUG_ARTIFACT_KINDS.has(f.kind));
}

/**
 * Apply the dead-code fixer to every debug artifact, re-detecting after each
 * single edit so byte offsets stay fresh. Returns the rewritten source plus a
 * flag indicating whether any fix failed to make progress (which would leave a
 * debug artifact in place and surface as a property counterexample).
 */
function removeAllDebugArtifacts(content: string): {
  fixed: string;
  stalled: boolean;
} {
  let current = content;
  // Generous cap: each iteration removes (or groups) at least one artifact.
  for (let i = 0; i < 500; i++) {
    const findings = detectDebugArtifacts(current);
    if (findings.length === 0) {
      return { fixed: current, stalled: false };
    }
    const next = applyDeadCodeFix(current, findings[0]);
    if (next === current) {
      // A debug artifact the detector still reports but the fixer left
      // unchanged: report rather than spin forever.
      return { fixed: current, stalled: true };
    }
    current = next;
  }
  return { fixed: current, stalled: true };
}

// ---------------------------------------------------------------------------
// Artifact generators
// ---------------------------------------------------------------------------

type Artifact =
  | { readonly type: 'console'; readonly method: string }
  | { readonly type: 'commentLine'; readonly code: string }
  | { readonly type: 'commentBlock'; readonly code: string }
  | {
      readonly type: 'todo';
      readonly marker: 'TODO' | 'FIXME';
      readonly trailing: string;
    };

// `console` methods that are NOT in the production allowlist (warn/error/
// info/assert) and are therefore treated as debug calls (Requirement 3.1).
const DEBUG_CONSOLE_METHODS = [
  'log',
  'debug',
  'trace',
  'dir',
  'table',
  'group',
  'count',
];

// Snippets that `looksLikeCode` reliably classifies as code, so a line/block
// comment wrapping them is flagged as commented-out code (Requirements 3.4).
const CODE_SNIPPETS = [
  'const value = 1;',
  'let count = 0;',
  'return value;',
  'doThing();',
  'items.push(value);',
  'total += amount;',
];

// Trailing text for bare TODO/FIXME markers: never includes an owner
// (@handle / parenthesized) or a ticket (#123 / ABC-123 / URL), so each stays
// "bare" and lacking the qualifying context (Requirement 3.5).
const TODO_TRAILING = ['', 'fix later', 'handle edge case', 'clean this up'];

const consoleArtifact: fc.Arbitrary<Artifact> = fc
  .constantFrom(...DEBUG_CONSOLE_METHODS)
  .map((method) => ({ type: 'console' as const, method }));

const commentLineArtifact: fc.Arbitrary<Artifact> = fc
  .constantFrom(...CODE_SNIPPETS)
  .map((code) => ({ type: 'commentLine' as const, code }));

const commentBlockArtifact: fc.Arbitrary<Artifact> = fc
  .constantFrom(...CODE_SNIPPETS)
  .map((code) => ({ type: 'commentBlock' as const, code }));

const todoArtifact: fc.Arbitrary<Artifact> = fc
  .record({
    marker: fc.constantFrom('TODO' as const, 'FIXME' as const),
    trailing: fc.constantFrom(...TODO_TRAILING),
  })
  .map(({ marker, trailing }) => ({ type: 'todo' as const, marker, trailing }));

const artifactArb: fc.Arbitrary<Artifact> = fc.oneof(
  consoleArtifact,
  commentLineArtifact,
  commentBlockArtifact,
  todoArtifact,
);

/** Real (non-artifact) filler statements interleaved between artifacts. */
const FILLER_LINES = [
  'accumulator += step;',
  'process(accumulator);',
  'register(handler);',
];

const INDENT = '  ';

function renderArtifact(artifact: Artifact): string {
  switch (artifact.type) {
    case 'console':
      return `${INDENT}console.${artifact.method}("debug marker");`;
    case 'commentLine':
      return `${INDENT}// ${artifact.code}`;
    case 'commentBlock':
      return `${INDENT}/* ${artifact.code} */`;
    case 'todo':
      return `${INDENT}// ${artifact.marker}${artifact.trailing ? ' ' + artifact.trailing : ''}`;
  }
}

/**
 * Build a single TypeScript source embedding the generated artifacts (and some
 * filler) inside a function body. No preservation annotations are emitted, so
 * every artifact is a removal candidate.
 */
function buildSource(artifacts: readonly Artifact[], fillers: readonly number[]): string {
  const body: string[] = [];
  artifacts.forEach((artifact, index) => {
    body.push(renderArtifact(artifact));
    const fillerIndex = fillers[index];
    if (fillerIndex !== undefined && fillerIndex >= 0) {
      body.push(`${INDENT}${FILLER_LINES[fillerIndex % FILLER_LINES.length]}`);
    }
  });
  return (
    'function run(accumulator, step, handler, process, register) {\n' +
    body.join('\n') +
    `\n${INDENT}return accumulator;\n}\n`
  );
}

// ---------------------------------------------------------------------------
// Property 7
// ---------------------------------------------------------------------------

describe('Property 7: Debug artifacts are removed and absent after the fix', () => {
  it('removes every console/commented-code/bare-TODO artifact so re-detection finds none', () => {
    fc.assert(
      fc.property(
        fc.array(artifactArb, { minLength: 1, maxLength: 7 }),
        fc.array(fc.integer({ min: -1, max: 2 }), { minLength: 0, maxLength: 7 }),
        (artifacts, fillers) => {
          const content = buildSource(artifacts, fillers);

          // Precondition: the generated source actually contains debug
          // artifacts, otherwise the property would be vacuously true.
          const initial = detectDebugArtifacts(content);
          expect(initial.length).toBeGreaterThan(0);

          const { fixed, stalled } = removeAllDebugArtifacts(content);

          // Every artifact was removable (the fixer never stalled on one).
          expect(stalled).toBe(false);

          // Re-detecting the fixed output finds zero debug artifacts.
          expect(detectDebugArtifacts(fixed).length).toBe(0);
        },
      ),
      { numRuns: 150 },
    );
  });
});
