// Feature: pre-ship-finalization, Property 33: HTML required elements and length bounds are validated correctly
//
// Property 33 (design "Correctness Properties"):
//   For any generated HTML document, `validateHtmlMetadata` SHALL report a rule
//   as valid if and only if that rule actually holds in the document:
//     - DOCTYPE appears as the first markup,
//     - the <html> element declares a non-empty `lang`,
//     - the charset meta tag is set to UTF-8,
//     - the viewport meta tag has non-empty content,
//     - the <title> length is within 1..60 characters,
//     - the meta description length is within 50..160 characters.
//
// **Validates: Requirements 9.1**
//
// This test drives `buildHtmlMetadata` + `validateHtmlMetadata` from
// `src/finalization/detectors/html.ts`. For each of the six required rules it
// independently generates one of several variants (present-valid, present-but-
// invalid, or absent), assembles a single HTML document from those choices,
// computes the expected validity of each rule from the same choices, and
// asserts the validator's per-rule flags match the expectation exactly. Because
// each variant is chosen independently, the generated space spans fully-valid
// documents, fully-invalid documents, and every mixture in between.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  buildHtmlMetadata,
  validateHtmlMetadata,
} from '../detectors/html';

// Bounds duplicated from the implementation so the test asserts the *intended*
// contract rather than re-deriving it from the code under test.
const TITLE_MIN = 1;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 50;
const DESCRIPTION_MAX = 160;

/** A string of exactly `length` safe characters (letters, no whitespace). */
function letters(length: number): string {
  return 'x'.repeat(length);
}

// --- Per-rule variant generators ------------------------------------------
// Each generator yields a fragment plus the expected validity it should
// produce, so expectation and document stay in lockstep.

interface DoctypeChoice {
  readonly present: boolean;
}

interface LangChoice {
  readonly kind: 'valid' | 'empty' | 'absent';
}

interface CharsetChoice {
  readonly kind: 'utf8' | 'wrong' | 'absent';
}

interface ViewportChoice {
  readonly kind: 'valid' | 'empty' | 'absent';
}

interface TitleChoice {
  readonly kind: 'valid' | 'empty' | 'tooLong' | 'absent';
  readonly length: number;
}

interface DescriptionChoice {
  readonly kind: 'valid' | 'tooShort' | 'tooLong' | 'absent';
  readonly length: number;
}

const doctypeArb: fc.Arbitrary<DoctypeChoice> = fc.record({
  present: fc.boolean(),
});

const langArb: fc.Arbitrary<LangChoice> = fc.record({
  kind: fc.constantFrom('valid', 'empty', 'absent'),
});

const charsetArb: fc.Arbitrary<CharsetChoice> = fc.record({
  kind: fc.constantFrom('utf8', 'wrong', 'absent'),
});

const viewportArb: fc.Arbitrary<ViewportChoice> = fc.record({
  kind: fc.constantFrom('valid', 'empty', 'absent'),
});

const titleArb: fc.Arbitrary<TitleChoice> = fc
  .constantFrom('valid', 'empty', 'tooLong', 'absent')
  .chain((kind) => {
    switch (kind) {
      case 'valid':
        return fc
          .integer({ min: TITLE_MIN, max: TITLE_MAX })
          .map((length) => ({ kind, length }) as TitleChoice);
      case 'tooLong':
        return fc
          .integer({ min: TITLE_MAX + 1, max: TITLE_MAX + 60 })
          .map((length) => ({ kind, length }) as TitleChoice);
      default:
        // 'empty' and 'absent' carry no meaningful length.
        return fc.constant({ kind, length: 0 } as TitleChoice);
    }
  });

const descriptionArb: fc.Arbitrary<DescriptionChoice> = fc
  .constantFrom('valid', 'tooShort', 'tooLong', 'absent')
  .chain((kind) => {
    switch (kind) {
      case 'valid':
        return fc
          .integer({ min: DESCRIPTION_MIN, max: DESCRIPTION_MAX })
          .map((length) => ({ kind, length }) as DescriptionChoice);
      case 'tooShort':
        return fc
          .integer({ min: 0, max: DESCRIPTION_MIN - 1 })
          .map((length) => ({ kind, length }) as DescriptionChoice);
      case 'tooLong':
        return fc
          .integer({ min: DESCRIPTION_MAX + 1, max: DESCRIPTION_MAX + 90 })
          .map((length) => ({ kind, length }) as DescriptionChoice);
      default:
        return fc.constant({ kind, length: 0 } as DescriptionChoice);
    }
  });

// --- Document assembly ------------------------------------------------------

function buildDocument(
  doctype: DoctypeChoice,
  lang: LangChoice,
  charset: CharsetChoice,
  viewport: ViewportChoice,
  title: TitleChoice,
  description: DescriptionChoice,
): string {
  const lines: string[] = [];

  if (doctype.present) {
    lines.push('<!DOCTYPE html>');
  }

  const htmlOpen =
    lang.kind === 'valid'
      ? '<html lang="en">'
      : lang.kind === 'empty'
        ? '<html lang="">'
        : '<html>';
  lines.push(htmlOpen);
  lines.push('<head>');

  if (charset.kind === 'utf8') {
    lines.push('<meta charset="utf-8" />');
  } else if (charset.kind === 'wrong') {
    lines.push('<meta charset="iso-8859-1" />');
  }

  if (viewport.kind === 'valid') {
    lines.push(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    );
  } else if (viewport.kind === 'empty') {
    lines.push('<meta name="viewport" content="" />');
  }

  if (title.kind === 'valid' || title.kind === 'tooLong') {
    lines.push(`<title>${letters(title.length)}</title>`);
  } else if (title.kind === 'empty') {
    lines.push('<title></title>');
  }

  if (description.kind !== 'absent') {
    lines.push(
      `<meta name="description" content="${letters(description.length)}" />`,
    );
  }

  lines.push('</head>');
  lines.push('<body></body>');
  lines.push('</html>');

  return lines.join('\n');
}

// --- Expected validity ------------------------------------------------------

function expectedTitleValid(title: TitleChoice): boolean {
  if (title.kind !== 'valid' && title.kind !== 'tooLong') {
    return false;
  }
  return title.length >= TITLE_MIN && title.length <= TITLE_MAX;
}

function expectedDescriptionValid(description: DescriptionChoice): boolean {
  if (description.kind === 'absent') {
    return false;
  }
  return (
    description.length >= DESCRIPTION_MIN &&
    description.length <= DESCRIPTION_MAX
  );
}

describe('Property 33: HTML required elements and length bounds are validated correctly', () => {
  it('reports each required rule valid iff it actually holds in the document', () => {
    fc.assert(
      fc.property(
        doctypeArb,
        langArb,
        charsetArb,
        viewportArb,
        titleArb,
        descriptionArb,
        (doctype, lang, charset, viewport, title, description) => {
          const html = buildDocument(
            doctype,
            lang,
            charset,
            viewport,
            title,
            description,
          );

          const validation = validateHtmlMetadata(buildHtmlMetadata(html));

          // DOCTYPE first.
          expect(validation.doctypeFirst).toBe(doctype.present);
          // Non-empty <html lang>.
          expect(validation.htmlLang).toBe(lang.kind === 'valid');
          // UTF-8 charset.
          expect(validation.charset).toBe(charset.kind === 'utf8');
          // Non-empty viewport.
          expect(validation.viewport).toBe(viewport.kind === 'valid');
          // Title length 1..60.
          expect(validation.title).toBe(expectedTitleValid(title));
          // Description length 50..160.
          expect(validation.description).toBe(
            expectedDescriptionValid(description),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reports all six rules valid for a fully-conforming document', () => {
    const html = buildDocument(
      { present: true },
      { kind: 'valid' },
      { kind: 'utf8' },
      { kind: 'valid' },
      { kind: 'valid', length: 30 },
      { kind: 'valid', length: 100 },
    );

    const validation = validateHtmlMetadata(buildHtmlMetadata(html));

    expect(validation.doctypeFirst).toBe(true);
    expect(validation.htmlLang).toBe(true);
    expect(validation.charset).toBe(true);
    expect(validation.viewport).toBe(true);
    expect(validation.title).toBe(true);
    expect(validation.description).toBe(true);
  });

  it('reports all six rules invalid for a bare, non-conforming document', () => {
    const html = '<html>\n<head></head>\n<body></body>\n</html>';

    const validation = validateHtmlMetadata(buildHtmlMetadata(html));

    expect(validation.doctypeFirst).toBe(false);
    expect(validation.htmlLang).toBe(false);
    expect(validation.charset).toBe(false);
    expect(validation.viewport).toBe(false);
    expect(validation.title).toBe(false);
    expect(validation.description).toBe(false);
  });
});
