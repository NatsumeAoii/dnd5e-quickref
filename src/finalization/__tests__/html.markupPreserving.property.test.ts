// Feature: pre-ship-finalization, Property 36: HTML fixes preserve pre-existing markup byte-for-byte
//
// Property 36 (design "Correctness Properties"):
//   When the HTML fixer adds a missing required tag, every byte of the
//   document's pre-existing markup SHALL remain unchanged. The fix is purely
//   additive: new markup is inserted at a structural boundary and no existing
//   character is replaced, moved, or deleted.
//
// **Validates: Requirements 9.4, 9.5**
//
// Strategy
// --------
// `fixHtmlFinding` (exposed via `htmlCompletenessFixer`) does not mutate disk;
// it returns `Edit[]`. For a missing required tag it returns `insert` edits
// anchored at a structural boundary (`'document-start'` for the DOCTYPE,
// `'head'` for metadata tags). The byte-for-byte guarantee therefore lives at
// the edit contract: the fixer must emit *insert* edits at *boundary* anchors,
// never a `replace`/`delete` over a range of existing characters.
//
// Each generated case:
//   1. Builds a fully-valid HTML document with rich, randomized pre-existing
//      markup (a comment, body text, generated title/description, and a full
//      set of social-metadata tags).
//   2. Removes exactly one required element to produce `reduced` and seed a
//      single finding.
//   3. Runs the detector, takes the targeted finding, and runs the fixer.
//   4. Asserts the fixer's edits are all additive inserts at a boundary anchor
//      and that the inserted markup introduces the expected element.
//   5. Applies the inserts additively (modeling the EditApplier built in a
//      later task) and asserts `reduced` survives byte-for-byte: it is either a
//      preserved suffix (DOCTYPE prepend) or splits into a preserved prefix and
//      suffix around the insertion point (head insert).

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  htmlCompletenessDetector,
  htmlCompletenessFixer,
  HTML_FINDING_KIND,
} from '../detectors/html';
import type { Edit, FileRecord } from '../types';

// ---------------------------------------------------------------------------
// Document construction.
// ---------------------------------------------------------------------------

interface DocParts {
  readonly lang: string;
  readonly title: string;
  readonly description: string;
  readonly headComment: string;
  readonly bodyText: string;
}

/** Ordered, keyed `<head>` entries for a fully-valid document. */
function headEntries(parts: DocParts): readonly (readonly [string, string])[] {
  return [
    ['charset', '<meta charset="utf-8" />'],
    [
      'viewport',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    ],
    ['title', `<title>${parts.title}</title>`],
    ['description', `<meta name="description" content="${parts.description}" />`],
    ['favicon', '<link rel="icon" href="/favicon.ico" />'],
    ['canonical', '<link rel="canonical" href="https://example.com/page" />'],
    ['og:title', '<meta property="og:title" content="Example OG Title" />'],
    [
      'og:description',
      '<meta property="og:description" content="Example OG description text." />',
    ],
    ['og:image', '<meta property="og:image" content="https://example.com/og.png" />'],
    ['og:url', '<meta property="og:url" content="https://example.com/page" />'],
    ['twitter:card', '<meta name="twitter:card" content="summary" />'],
    [
      'twitter:title',
      '<meta name="twitter:title" content="Example Twitter Title" />',
    ],
    [
      'twitter:description',
      '<meta name="twitter:description" content="Example twitter description." />',
    ],
    ['twitter:image', '<meta name="twitter:image" content="https://example.com/tw.png" />'],
  ];
}

/**
 * Builds a complete HTML document, omitting any entry whose key is in `omit`.
 * The special key `'doctype'` drops the leading DOCTYPE declaration.
 */
function buildDoc(parts: DocParts, omit: ReadonlySet<string>): string {
  const head = headEntries(parts)
    .filter(([key]) => !omit.has(key))
    .map(([, markup]) => `  ${markup}`)
    .join('\n');
  const doctypeLine = omit.has('doctype') ? '' : '<!DOCTYPE html>\n';
  return (
    `${doctypeLine}<html lang="${parts.lang}">\n` +
    `<head>\n` +
    `  ${parts.headComment}\n` +
    `${head}\n` +
    `</head>\n` +
    `<body>\n` +
    `  <p>${parts.bodyText}</p>\n` +
    `</body>\n` +
    `</html>\n`
  );
}

function htmlRecord(content: string): FileRecord {
  return {
    path: 'index.html',
    content,
    bytes: content.length,
    readError: null,
    language: 'html',
  };
}

// ---------------------------------------------------------------------------
// Additive insert application (models the later EditApplier).
// ---------------------------------------------------------------------------

type Anchor = 'document-start' | 'head';

const HEAD_CLOSE = /<\/head\s*>/i;

/** Applies boundary-anchored insert edits additively, never touching existing bytes. */
function applyInserts(reduced: string, inserts: readonly Edit[], anchor: Anchor): string {
  const block = inserts.map((edit) => edit.text).join('\n');
  if (anchor === 'document-start') {
    return `${block}\n${reduced}`;
  }
  const idx = reduced.search(HEAD_CLOSE);
  return reduced.slice(0, idx) + block + '\n' + reduced.slice(idx);
}

/** Asserts every byte of `reduced` survives in `result` (only new markup added). */
function assertPreserved(reduced: string, result: string, anchor: Anchor): void {
  expect(result.length).toBeGreaterThan(reduced.length);
  if (anchor === 'document-start') {
    // The whole original document is preserved as a byte-for-byte suffix.
    expect(result.slice(result.length - reduced.length)).toBe(reduced);
    return;
  }
  // Head insert: the original splits into a preserved prefix and suffix around
  // the insertion point, and the two halves recompose the original exactly.
  const idx = reduced.search(HEAD_CLOSE);
  const before = reduced.slice(0, idx);
  const after = reduced.slice(idx);
  expect(before + after).toBe(reduced);
  expect(result.startsWith(before)).toBe(true);
  expect(result.endsWith(after)).toBe(true);
}

// ---------------------------------------------------------------------------
// Scenarios: each removes one required element and expects an additive insert.
// ---------------------------------------------------------------------------

interface Scenario {
  readonly name: string;
  readonly omit: readonly string[];
  readonly kind: string;
  readonly anchor: Anchor;
  /** Lowercase substring the inserted markup must contain. */
  readonly contains: string;
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'missing DOCTYPE',
    omit: ['doctype'],
    kind: HTML_FINDING_KIND.doctypeMissing,
    anchor: 'document-start',
    contains: '<!doctype',
  },
  {
    name: 'missing charset',
    omit: ['charset'],
    kind: HTML_FINDING_KIND.charsetMissing,
    anchor: 'head',
    contains: 'charset',
  },
  {
    name: 'missing viewport',
    omit: ['viewport'],
    kind: HTML_FINDING_KIND.viewportMissing,
    anchor: 'head',
    contains: 'viewport',
  },
  {
    name: 'missing title',
    omit: ['title'],
    kind: HTML_FINDING_KIND.titleMissing,
    anchor: 'head',
    contains: '<title',
  },
  {
    name: 'missing description',
    omit: ['description'],
    kind: HTML_FINDING_KIND.descriptionMissing,
    anchor: 'head',
    contains: 'name="description"',
  },
  {
    name: 'missing favicon',
    omit: ['favicon'],
    kind: HTML_FINDING_KIND.faviconCount,
    anchor: 'head',
    contains: 'rel="icon"',
  },
  {
    name: 'missing canonical',
    omit: ['canonical'],
    kind: HTML_FINDING_KIND.canonicalCount,
    anchor: 'head',
    contains: 'canonical',
  },
  {
    name: 'incomplete Open Graph',
    omit: ['og:title'],
    kind: HTML_FINDING_KIND.openGraphIncomplete,
    anchor: 'head',
    contains: 'og:title',
  },
  {
    name: 'incomplete Twitter Card',
    omit: ['twitter:image'],
    kind: HTML_FINDING_KIND.twitterCardIncomplete,
    anchor: 'head',
    contains: 'twitter:image',
  },
];

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const LETTERS_SPACES = [...LETTERS, ' ', ' '];

/** Letters-only string of `min..max` length (trimmed length is identical). */
const lettersArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...LETTERS), { minLength: min, maxLength: max })
    .map((chars) => chars.join(''));

/** Benign text that never introduces a `<`, `>`, or quote. */
const proseArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...LETTERS_SPACES), { minLength: min, maxLength: max })
    .map((chars) => chars.join(''));

const docPartsArb: fc.Arbitrary<DocParts> = fc.record({
  lang: fc.constantFrom('en', 'en-US', 'fr', 'id', 'de'),
  title: lettersArb(1, 60),
  description: lettersArb(50, 160),
  headComment: proseArb(1, 30).map((text) => `<!-- ${text} -->`),
  bodyText: proseArb(0, 40),
});

const scenarioArb: fc.Arbitrary<Scenario> = fc.constantFrom(...SCENARIOS);

// ---------------------------------------------------------------------------
// Core assertion shared by the property and the enumerated unit cases.
// ---------------------------------------------------------------------------

function checkScenario(parts: DocParts, scenario: Scenario): void {
  const reduced = buildDoc(parts, new Set(scenario.omit));
  const record = htmlRecord(reduced);

  // The detector must flag the seeded defect.
  const finding = htmlCompletenessDetector
    .detect([record])
    .find((f) => f.kind === scenario.kind);
  expect(finding, `expected '${scenario.kind}' for ${scenario.name}`).toBeDefined();
  if (!finding) {
    return;
  }

  const outcome = htmlCompletenessFixer.fix(finding, record);

  // A missing required tag is auto-fixable: the fixer adds it, never preserves.
  expect(outcome.preserved).toBe(false);

  // Every edit is an additive insert — no replace/delete over existing markup.
  expect(outcome.edits.length).toBeGreaterThanOrEqual(1);
  expect(outcome.edits.every((edit) => edit.kind === 'insert')).toBe(true);

  const inserts = outcome.edits;
  for (const edit of inserts) {
    // Inserts target a structural boundary, never a positional range into
    // existing content.
    expect(edit.range?.tag === 'document-start' || edit.range?.tag === 'head').toBe(
      true,
    );
    expect(edit.range?.line).toBeUndefined();
    expect(edit.range?.column).toBeUndefined();
    expect(typeof edit.text).toBe('string');
    expect((edit.text ?? '').trim().startsWith('<')).toBe(true);
  }

  // All of one finding's inserts share a single anchor.
  const anchor = inserts[0].range?.tag as Anchor;
  expect(anchor).toBe(scenario.anchor);
  expect(inserts.every((edit) => edit.range?.tag === anchor)).toBe(true);

  // The inserted markup introduces the expected element.
  const block = inserts.map((edit) => edit.text ?? '').join('');
  expect(block.toLowerCase()).toContain(scenario.contains);

  // Applying the inserts additively preserves the pre-existing markup
  // byte-for-byte.
  const result = applyInserts(reduced, inserts, anchor);
  assertPreserved(reduced, result, anchor);
}

// ---------------------------------------------------------------------------
// Property 36.
// ---------------------------------------------------------------------------

describe('Property 36: HTML fixes preserve pre-existing markup byte-for-byte', () => {
  it('adds the missing required tag while leaving all other markup unchanged', () => {
    fc.assert(
      fc.property(docPartsArb, scenarioArb, (parts, scenario) => {
        checkScenario(parts, scenario);
      }),
      { numRuns: 200 },
    );
  });

  // Deterministic coverage: exercise every scenario at least once so a
  // never-generated branch cannot hide a regression.
  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    'additively fixes "%s" without rewriting existing markup',
    (_name, scenario) => {
      const parts: DocParts = {
        lang: 'en',
        title: 'A Concise Page Title',
        description:
          'A meta description of sufficient length to satisfy the lower bound rule.',
        headComment: '<!-- pre-existing comment that must be preserved -->',
        bodyText: 'Existing body content that must remain byte for byte.',
      };
      checkScenario(parts, scenario);
    },
  );
});
