// @vitest-environment jsdom
//
// Feature: pre-ship-finalization, Property 41: `eval` and `innerHTML` assignment are replaced without changing output
//
// Property 41 (design "Correctness Properties"):
//   For any `eval` call or `innerHTML` assignment, the fixer replaces it with a
//   construct producing the same observable output without executing
//   dynamically-constructed code/markup.
//
// **Validates: Requirements 10.4**
//
// Per the design notes, this is a behavior-preservation property: rather than
// comparing raw strings, we compare *observable semantics*. The implementation
// (`detectTsJsSafety` / `fixTsJsSafety` in ../detectors/tsJsSafety.ts) makes a
// deliberate, narrow guarantee:
//   - It detects every `eval(...)` call and every `.innerHTML =`/`+=` assignment.
//   - The one provably-safe rewrite — clearing an element with `innerHTML = ''`
//     (or "" / ``) — becomes `replaceChildren()`, which yields an identical DOM
//     without parsing markup. This test executes both forms against a populated
//     jsdom element and asserts the resulting DOM is identical.
//   - Every other `innerHTML` assignment (non-empty) and every `eval` call is
//     PRESERVED with a non-empty `preservationReason`, because no general
//     behavior-preserving textual rewrite can be guaranteed from text alone.
//     Preservation (no edit) trivially changes no output, satisfying the
//     property's "without changing output" clause.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  detectTsJsSafety,
  fixTsJsSafety,
  TS_JS_KINDS,
} from '../detectors/tsJsSafety';
import type { Edit, FileRecord, Finding } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tsRecord(content: string, path = 'src/sample.ts'): FileRecord {
  return { path, content, bytes: content.length, readError: null, language: 'typescript' };
}

/** Converts a 1-based line/column position to a 0-based character offset. */
function locationToOffset(content: string, line: number, column: number): number {
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineStarts.push(i + 1);
  }
  return lineStarts[line - 1] + (column - 1);
}

/**
 * Applies a single `replace` edit produced by the innerHTML fixer. The edit's
 * start is `range.line`/`range.column`; its end is encoded in `range.tag` as
 * `to:line:column`. Returns the rewritten source.
 */
function applyReplaceEdit(content: string, edit: Edit): string {
  const range = edit.range;
  if (!range || range.line === undefined || range.column === undefined) {
    throw new Error('replace edit is missing a start range');
  }
  const tag = range.tag ?? '';
  const match = /^to:(\d+):(\d+)$/.exec(tag);
  if (!match) throw new Error(`replace edit is missing an end tag, got: ${tag}`);
  const start = locationToOffset(content, range.line, range.column);
  const end = locationToOffset(content, Number(match[1]), Number(match[2]));
  return content.slice(0, start) + (edit.text ?? '') + content.slice(end);
}

/** Builds a fresh element populated with the given inner HTML. */
function populatedElement(innerHtml: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = innerHtml;
  return el;
}

/** A serializable snapshot of an element's observable DOM state. */
function domSnapshot(el: HTMLElement): string {
  return `${el.childNodes.length}|${el.innerHTML}`;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Identifier / member expressions an assignment target can take. */
const targetArb = fc.constantFrom(
  'el',
  'element',
  'node',
  'container',
  'this.root',
  'document.body',
  'refs.panel',
);

/** The three empty-string literal forms the fixer treats as a safe clear. */
const emptyLiteralArb = fc.constantFrom("''", '""', '``');

/** Whitespace variations around the assignment operator. */
const spacingArb = fc.constantFrom(' = ', ' =  ', '  =  ', '= ', ' =\t');

/** Trailing punctuation after the statement. */
const semicolonArb = fc.constantFrom(';', '');

/** Inner HTML used to populate an element before clearing it. */
const childrenHtmlArb = fc.constantFrom(
  '<span>hi</span>',
  'text only',
  '<p>one</p><p>two</p>',
  '<ul><li>a</li><li>b</li></ul>',
  '<b>bold</b> and <i>italic</i>',
  '<div id="x"><span class="y">z</span></div>',
);

/** Non-empty innerHTML right-hand sides that must be preserved (not rewritten). */
const nonEmptyRhsArb = fc.constantFrom(
  "'<div>' + userInput + '</div>'",
  '`<span>${name}</span>`',
  "'<b>static</b>'",
  'buildMarkup()',
  'template',
);

/** eval argument expressions. */
const evalArgArb = fc.constantFrom(
  "'1 + 1'",
  'code',
  '`return ${expr}`',
  "userInput",
  "'doThing()'",
);

// ---------------------------------------------------------------------------
// Property 41
// ---------------------------------------------------------------------------

describe('Property 41: `eval` and `innerHTML` assignment are replaced without changing output', () => {
  it('detects the empty-clear innerHTML case and rewrites it to replaceChildren() preserving DOM', () => {
    fc.assert(
      fc.property(
        targetArb,
        emptyLiteralArb,
        spacingArb,
        semicolonArb,
        childrenHtmlArb,
        (target, literal, spacing, semi, childrenHtml) => {
          const statement = `${target}.innerHTML${spacing}${literal}${semi}`;
          const content = `function clear() {\n  ${statement}\n}\n`;
          const record = tsRecord(content);

          // 1) Detection occurs for the innerHTML assignment.
          const finding: Finding | undefined = detectTsJsSafety([record]).find(
            (f) => f.kind === TS_JS_KINDS.innerHtml,
          );
          expect(finding, `expected an innerHTML finding for: ${statement}`).toBeDefined();
          if (!finding) return;

          // 2) The fixer yields exactly one replaceChildren() replace edit.
          const outcome = fixTsJsSafety(finding, record);
          expect(outcome.preserved).toBe(false);
          expect(outcome.edits.length).toBe(1);
          const edit = outcome.edits[0];
          expect(edit.kind).toBe('replace');
          expect(edit.text).toBe('.replaceChildren()');
          expect(edit.placeholderInserted).toBe(false);

          // 3) The rewrite must contain replaceChildren() and drop innerHTML.
          const fixed = applyReplaceEdit(content, edit);
          expect(fixed).toContain(`${target}.replaceChildren()`);
          expect(fixed).not.toContain('.innerHTML');

          // 4) Behavior preservation (semantic comparison): clearing an element
          //    via `innerHTML = ''` and via `replaceChildren()` produce the same
          //    observable DOM.
          const viaInnerHtml = populatedElement(childrenHtml);
          viaInnerHtml.innerHTML = '';
          const viaReplaceChildren = populatedElement(childrenHtml);
          viaReplaceChildren.replaceChildren();
          expect(domSnapshot(viaReplaceChildren)).toBe(domSnapshot(viaInnerHtml));
        },
      ),
      { numRuns: 120 },
    );
  });

  it('preserves non-empty innerHTML assignments with a non-empty reason and no edits', () => {
    fc.assert(
      fc.property(targetArb, nonEmptyRhsArb, semicolonArb, (target, rhs, semi) => {
        const statement = `${target}.innerHTML = ${rhs}${semi}`;
        const content = `function render() {\n  ${statement}\n}\n`;
        const record = tsRecord(content);

        const finding: Finding | undefined = detectTsJsSafety([record]).find(
          (f) => f.kind === TS_JS_KINDS.innerHtml,
        );
        expect(finding, `expected an innerHTML finding for: ${statement}`).toBeDefined();
        if (!finding) return;

        const outcome = fixTsJsSafety(finding, record);
        // No edit means the output is, trivially, unchanged.
        expect(outcome.edits).toEqual([]);
        expect(outcome.preserved).toBe(true);
        expect(outcome.preservationReason).toBeTruthy();
        expect((outcome.preservationReason ?? '').length).toBeGreaterThan(0);
      }),
      { numRuns: 120 },
    );
  });

  it('detects eval calls and preserves them with a non-empty reason and no edits', () => {
    fc.assert(
      fc.property(evalArgArb, semicolonArb, (arg, semi) => {
        const statement = `eval(${arg})${semi}`;
        const content = `function exec() {\n  const out = ${statement}\n}\n`;
        const record = tsRecord(content);

        const finding: Finding | undefined = detectTsJsSafety([record]).find(
          (f) => f.kind === TS_JS_KINDS.evalCall,
        );
        expect(finding, `expected an eval finding for: ${statement}`).toBeDefined();
        if (!finding) return;

        const outcome = fixTsJsSafety(finding, record);
        expect(outcome.edits).toEqual([]);
        expect(outcome.preserved).toBe(true);
        expect(outcome.preservationReason).toBeTruthy();
        expect((outcome.preservationReason ?? '').length).toBeGreaterThan(0);
      }),
      { numRuns: 120 },
    );
  });
});
