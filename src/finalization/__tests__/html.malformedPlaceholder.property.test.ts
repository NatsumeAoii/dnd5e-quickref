// Feature: pre-ship-finalization, Property 37: Empty or malformed required tags become recorded placeholders
//
// Property 37 (design "Correctness Properties"):
//   For any required HTML element or metadata tag that is present but empty or
//   malformed (and whose correct value cannot be derived from project context),
//   the fixer SHALL replace its value with the `[FILL IN]` Placeholder_Marker
//   and SHALL record the insertion (`placeholderInserted: true`).
//
// **Validates: Requirements 9.6**
//
// This test exercises `htmlCompletenessDetector` / `htmlCompletenessFixer`
// (`fixHtmlFinding`) and the `FILL_IN_PLACEHOLDER` token from `types.ts`. Each
// generated document is otherwise fully valid, so injecting exactly one
// malformed/empty required tag yields exactly one finding whose fix can be
// asserted in isolation.
//
// Underivable malformed tags covered (value cannot be derived from context, so
// they become recorded `[FILL IN]` placeholders):
//   - `<html lang>` present but empty       → html-lang-missing
//   - `<title>` empty or length > 60        → html-title-length
//   - meta description empty or out of 50-160 range → html-description-length
//   - canonical href empty or non-absolute  → html-canonical-not-absolute
//
// Derivable malformed tag (NOT a placeholder): an empty/malformed `charset` has
// a single correct value (UTF-8) that is always derivable, so the fixer
// corrects it to `utf-8` with `placeholderInserted: false`. This is asserted in
// a dedicated case below so the placeholder/derivable boundary is explicit.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  htmlCompletenessDetector,
  htmlCompletenessFixer,
  HTML_FINDING_KIND,
} from '../detectors/html';
import {
  FILL_IN_PLACEHOLDER,
  type Edit,
  type FileRecord,
} from '../types';

const HTML_PATH = 'index.html';

function makeRecord(content: string): FileRecord {
  return {
    path: HTML_PATH,
    content,
    bytes: content.length,
    readError: null,
    language: 'html',
  };
}

// Word characters only: no spaces (so trimmed length equals raw length) and no
// quotes (so injected values never break attribute extraction).
const LETTERS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

function lettersOfLength(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...LETTERS), { minLength: min, maxLength: max })
    .map((chars) => chars.join(''));
}

// A description whose trimmed length is comfortably inside the valid 50-160
// range, used in the otherwise-valid base document.
const VALID_DESCRIPTION = 'a'.repeat(80);
const VALID_TITLE = 'Reference Guide';

interface DocOverrides {
  readonly htmlOpen?: string;
  readonly charsetTag?: string;
  readonly titleTag?: string;
  readonly descriptionTag?: string;
  readonly canonicalTag?: string;
}

/**
 * Builds a complete, fully valid HTML document, applying at most one override
 * to inject a single malformed/empty required tag. With no overrides the
 * document produces zero findings.
 */
function buildDoc(overrides: DocOverrides = {}): string {
  const htmlOpen = overrides.htmlOpen ?? '<html lang="en">';
  const charsetTag = overrides.charsetTag ?? '<meta charset="utf-8" />';
  const titleTag = overrides.titleTag ?? `<title>${VALID_TITLE}</title>`;
  const descriptionTag =
    overrides.descriptionTag ??
    `<meta name="description" content="${VALID_DESCRIPTION}" />`;
  const canonicalTag =
    overrides.canonicalTag ??
    '<link rel="canonical" href="https://example.com/" />';

  return [
    '<!DOCTYPE html>',
    htmlOpen,
    '<head>',
    charsetTag,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    titleTag,
    descriptionTag,
    '<link rel="icon" href="https://example.com/favicon.ico" />',
    canonicalTag,
    '<meta property="og:title" content="Reference Guide" />',
    '<meta property="og:description" content="A quick reference guide." />',
    '<meta property="og:image" content="https://example.com/og.png" />',
    '<meta property="og:url" content="https://example.com/" />',
    '<meta name="twitter:card" content="summary" />',
    '<meta name="twitter:title" content="Reference Guide" />',
    '<meta name="twitter:description" content="A quick reference guide." />',
    '<meta name="twitter:image" content="https://example.com/og.png" />',
    '</head>',
    '<body></body>',
    '</html>',
  ].join('\n');
}

interface MalformedCase {
  /** The complete document with one malformed/empty required tag injected. */
  readonly html: string;
  /** The finding kind the malformation should produce. */
  readonly kind: string;
  /**
   * A distinctive multi-character substring of the injected malformed value
   * that must NOT survive into the fixer's replacement, or `null` when the
   * malformed value is empty/whitespace-only (in which case survival is not
   * meaningfully detectable, since normal markup contains spaces). The
   * placeholder-insertion assertions always run; this only gates the
   * value-eradication assertion.
   */
  readonly distinctive: string | null;
}

// 1. Empty `<html lang>` — present but blank. The fixer adds a placeholder
// `lang` attribute; the original whitespace value is not a distinctive token,
// so survival is not asserted (only placeholder insertion is).
const langCase: fc.Arbitrary<MalformedCase> = fc
  .constantFrom('', ' ', '   ')
  .map((lang) => ({
    html: buildDoc({ htmlOpen: `<html lang="${lang}">` }),
    kind: HTML_FINDING_KIND.htmlLangMissing,
    distinctive: null,
  }));

// A malformed value is only treated as a "distinctive" eradication token when
// it is long enough that it cannot collide with ordinary markup characters
// (e.g. a single 'a' appears in `name="description"`). Short values still
// exercise the placeholder-insertion path; only the value-eradication assertion
// is gated on this.
const MIN_DISTINCTIVE_LENGTH = 3;

function distinctiveOf(value: string): string | null {
  return value.length >= MIN_DISTINCTIVE_LENGTH ? value : null;
}

// 2. `<title>` empty or longer than the 60-character maximum.
const titleCase: fc.Arbitrary<MalformedCase> = fc
  .oneof(fc.constant(''), lettersOfLength(61, 90))
  .map((title) => ({
    html: buildDoc({ titleTag: `<title>${title}</title>` }),
    kind: HTML_FINDING_KIND.titleLength,
    distinctive: distinctiveOf(title),
  }));

// 3. Meta description empty or outside the 50-160 character range.
const descriptionCase: fc.Arbitrary<MalformedCase> = fc
  .oneof(fc.constant(''), lettersOfLength(1, 49), lettersOfLength(161, 220))
  .map((description) => ({
    html: buildDoc({
      descriptionTag: `<meta name="description" content="${description}" />`,
    }),
    kind: HTML_FINDING_KIND.descriptionLength,
    distinctive: distinctiveOf(description),
  }));

// 4. Canonical href empty or non-absolute. Distinctive relative tokens (no
// scheme, no `//` prefix) are flagged as non-absolute and must be eradicated
// by the replacement; the empty value is not survival-checked.
const canonicalCase: fc.Arbitrary<MalformedCase> = fc
  .oneof(
    fc.constant(''),
    lettersOfLength(5, 20).map((token) => `relative-${token}`),
    lettersOfLength(5, 20).map((token) => `path/to/${token}`),
  )
  .map((href) => ({
    html: buildDoc({ canonicalTag: `<link rel="canonical" href="${href}" />` }),
    kind: HTML_FINDING_KIND.canonicalNotAbsolute,
    distinctive: href.length > 0 ? href : null,
  }));

const malformedCaseArb: fc.Arbitrary<MalformedCase> = fc.oneof(
  langCase,
  titleCase,
  descriptionCase,
  canonicalCase,
);

function placeholderEdit(edits: readonly Edit[]): Edit | undefined {
  return edits.find((edit) => edit.placeholderInserted);
}

describe('Property 37: Empty or malformed required tags become recorded placeholders', () => {
  it('replaces an empty/malformed underivable required tag with [FILL IN] and records the insertion', () => {
    fc.assert(
      fc.property(malformedCaseArb, ({ html, kind, distinctive }) => {
        const record = makeRecord(html);

        // The otherwise-valid base means exactly one finding is produced, and
        // it is the targeted malformed-tag kind.
        const findings = htmlCompletenessDetector.detect([record]);
        expect(findings.length).toBe(1);
        expect(findings[0].kind).toBe(kind);

        const outcome = htmlCompletenessFixer.fix(findings[0], record);

        // The malformed value is corrected, not preserved.
        expect(outcome.preserved).toBe(false);

        // A placeholder-bearing edit is emitted and flagged as such.
        const edit = placeholderEdit(outcome.edits);
        expect(edit).toBeDefined();
        expect((edit as Edit).placeholderInserted).toBe(true);

        // The replacement value is the [FILL IN] Placeholder_Marker.
        const text = (edit as Edit).text ?? '';
        expect(text).toContain(FILL_IN_PLACEHOLDER);

        // A distinctive malformed value never survives into the replacement.
        if (distinctive !== null) {
          expect(text).not.toContain(distinctive);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('corrects an empty/malformed charset to UTF-8 without inserting a placeholder (derivable value)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', ' ', 'utf8', 'latin1', 'iso-8859-1', 'UTF-16'),
        (charset) => {
          const html = buildDoc({ charsetTag: `<meta charset="${charset}" />` });
          const record = makeRecord(html);

          const findings = htmlCompletenessDetector.detect([record]);
          expect(findings.length).toBe(1);
          expect(findings[0].kind).toBe(HTML_FINDING_KIND.charsetMalformed);

          const outcome = htmlCompletenessFixer.fix(findings[0], record);
          expect(outcome.preserved).toBe(false);

          // Charset's correct value is always derivable (UTF-8), so the fix is a
          // concrete correction, not a [FILL IN] placeholder.
          expect(outcome.edits.length).toBe(1);
          const edit = outcome.edits[0];
          expect(edit.placeholderInserted).toBe(false);
          const text = edit.text ?? '';
          expect(text).not.toContain(FILL_IN_PLACEHOLDER);
          expect(text.toLowerCase()).toContain('utf-8');
        },
      ),
      { numRuns: 120 },
    );
  });
});
