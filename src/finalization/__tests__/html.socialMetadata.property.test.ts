// Feature: pre-ship-finalization, Property 35: Open Graph and Twitter Card completeness is detected
//
// Property 35 (design "Correctness Properties"):
//   For any generated HTML document, the validator reports social-metadata
//   completeness iff all required Open Graph fields (title, description, image,
//   url) and Twitter Card fields (card, title, description, image) are present
//   with non-empty values (non-empty URLs for the asset/url fields).
//
// **Validates: Requirements 9.3**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  buildHtmlMetadata,
  validateHtmlMetadata,
  detectHtmlCompleteness,
  HTML_FINDING_KIND,
} from '../detectors/html';
import { type FileRecord } from '../types';

/**
 * State of a single metadata field in the generated document:
 *   - 'absent'      : the tag is omitted entirely
 *   - 'empty'       : the tag is present with an empty content value
 *   - 'whitespace'  : the tag is present with whitespace-only content
 *   - 'present'     : the tag is present with a non-empty content value
 *
 * A field counts as "complete" only in the 'present' case (validateHtmlMetadata
 * trims, so 'empty' and 'whitespace' are both incomplete).
 */
type FieldState = 'absent' | 'empty' | 'whitespace' | 'present';

const fieldStateArb: fc.Arbitrary<FieldState> = fc.constantFrom(
  'absent',
  'empty',
  'whitespace',
  'present',
);

/** A non-empty content value (leading non-space char ensures trim() non-empty). */
const textValueArb = fc.constantFrom(
  'Sample Title',
  'A',
  '0',
  'Production Ready Page',
  'D&D 5e Reference',
  'x',
);

/** A non-empty URL value for the asset/url fields (og:image, og:url, etc.). */
const urlValueArb = fc.constantFrom(
  'https://example.com/',
  'https://cdn.example.com/img/banner.png',
  'https://example.com/page',
  '//example.com/protocol-relative',
  'https://a.example.com/x',
);

interface FieldSpec {
  /** The HTML attribute pair selecting the meta tag, e.g. `property="og:title"`. */
  readonly selector: string;
  /** State drawn for this field. */
  readonly state: FieldState;
  /** Non-empty value to use when state is 'present'. */
  readonly value: string;
}

/** Renders a single meta tag for a field spec, or '' when absent. */
function renderMeta(spec: FieldSpec): string {
  switch (spec.state) {
    case 'absent':
      return '';
    case 'empty':
      return `    <meta ${spec.selector} content="" />\n`;
    case 'whitespace':
      return `    <meta ${spec.selector} content="   " />\n`;
    case 'present':
      return `    <meta ${spec.selector} content="${spec.value}" />\n`;
    default:
      return '';
  }
}

/** A field is complete (present & non-empty) only in the 'present' state. */
function isComplete(spec: FieldSpec): boolean {
  return spec.state === 'present';
}

/** Builds a field-spec arbitrary for a given selector and value generator. */
function fieldArb(
  selector: string,
  valueArb: fc.Arbitrary<string>,
): fc.Arbitrary<FieldSpec> {
  return fc.record({
    selector: fc.constant(selector),
    state: fieldStateArb,
    value: valueArb,
  });
}

/** The four Open Graph fields (title/description text, image/url are URLs). */
const openGraphArb = fc.record({
  title: fieldArb('property="og:title"', textValueArb),
  description: fieldArb('property="og:description"', textValueArb),
  image: fieldArb('property="og:image"', urlValueArb),
  url: fieldArb('property="og:url"', urlValueArb),
});

/** The four Twitter Card fields (card/title/description text, image URL). */
const twitterCardArb = fc.record({
  card: fieldArb('name="twitter:card"', textValueArb),
  title: fieldArb('name="twitter:title"', textValueArb),
  description: fieldArb('name="twitter:description"', textValueArb),
  image: fieldArb('name="twitter:image"', urlValueArb),
});

/** Assembles a full HTML document embedding the supplied social meta tags. */
function buildDocument(
  og: { title: FieldSpec; description: FieldSpec; image: FieldSpec; url: FieldSpec },
  tc: {
    card: FieldSpec;
    title: FieldSpec;
    description: FieldSpec;
    image: FieldSpec;
  },
): string {
  const ogTags =
    renderMeta(og.title) +
    renderMeta(og.description) +
    renderMeta(og.image) +
    renderMeta(og.url);
  const tcTags =
    renderMeta(tc.card) +
    renderMeta(tc.title) +
    renderMeta(tc.description) +
    renderMeta(tc.image);

  return (
    `<!DOCTYPE html>\n` +
    `<html lang="en">\n` +
    `  <head>\n` +
    `    <meta charset="utf-8" />\n` +
    `    <title>Sample Document Title</title>\n` +
    ogTags +
    tcTags +
    `  </head>\n` +
    `  <body></body>\n` +
    `</html>\n`
  );
}

function htmlRecord(content: string, path = 'index.html'): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: 'html',
  };
}

describe('Property 35: Open Graph and Twitter Card completeness is detected', () => {
  it('reports Open Graph complete iff all four OG fields are present and non-empty', () => {
    fc.assert(
      fc.property(openGraphArb, twitterCardArb, (og, tc) => {
        const html = buildDocument(og, tc);
        const meta = buildHtmlMetadata(html);
        const validation = validateHtmlMetadata(meta);

        const expectedComplete =
          isComplete(og.title) &&
          isComplete(og.description) &&
          isComplete(og.image) &&
          isComplete(og.url);

        expect(validation.openGraph).toBe(expectedComplete);
      }),
      { numRuns: 100 },
    );
  });

  it('reports Twitter Card complete iff all four card fields are present and non-empty', () => {
    fc.assert(
      fc.property(openGraphArb, twitterCardArb, (og, tc) => {
        const html = buildDocument(og, tc);
        const meta = buildHtmlMetadata(html);
        const validation = validateHtmlMetadata(meta);

        const expectedComplete =
          isComplete(tc.card) &&
          isComplete(tc.title) &&
          isComplete(tc.description) &&
          isComplete(tc.image);

        expect(validation.twitterCard).toBe(expectedComplete);
      }),
      { numRuns: 100 },
    );
  });

  it('emits an incompleteness finding exactly when a social section is incomplete', () => {
    fc.assert(
      fc.property(openGraphArb, twitterCardArb, (og, tc) => {
        const html = buildDocument(og, tc);
        const record = htmlRecord(html);
        const findings = detectHtmlCompleteness([record]);

        const ogComplete =
          isComplete(og.title) &&
          isComplete(og.description) &&
          isComplete(og.image) &&
          isComplete(og.url);
        const tcComplete =
          isComplete(tc.card) &&
          isComplete(tc.title) &&
          isComplete(tc.description) &&
          isComplete(tc.image);

        const hasOgFinding = findings.some(
          (f) => f.kind === HTML_FINDING_KIND.openGraphIncomplete,
        );
        const hasTcFinding = findings.some(
          (f) => f.kind === HTML_FINDING_KIND.twitterCardIncomplete,
        );

        // A finding is raised iff the corresponding section is incomplete.
        expect(hasOgFinding).toBe(!ogComplete);
        expect(hasTcFinding).toBe(!tcComplete);
      }),
      { numRuns: 100 },
    );
  });

  it('reports both sections complete when every field is present (sanity anchor)', () => {
    fc.assert(
      fc.property(
        textValueArb,
        textValueArb,
        urlValueArb,
        urlValueArb,
        textValueArb,
        textValueArb,
        textValueArb,
        urlValueArb,
        (ogT, ogD, ogI, ogU, tcC, tcT, tcD, tcI) => {
          const og = {
            title: { selector: 'property="og:title"', state: 'present' as const, value: ogT },
            description: {
              selector: 'property="og:description"',
              state: 'present' as const,
              value: ogD,
            },
            image: { selector: 'property="og:image"', state: 'present' as const, value: ogI },
            url: { selector: 'property="og:url"', state: 'present' as const, value: ogU },
          };
          const tc = {
            card: { selector: 'name="twitter:card"', state: 'present' as const, value: tcC },
            title: { selector: 'name="twitter:title"', state: 'present' as const, value: tcT },
            description: {
              selector: 'name="twitter:description"',
              state: 'present' as const,
              value: tcD,
            },
            image: { selector: 'name="twitter:image"', state: 'present' as const, value: tcI },
          };

          const validation = validateHtmlMetadata(buildHtmlMetadata(buildDocument(og, tc)));
          expect(validation.openGraph).toBe(true);
          expect(validation.twitterCard).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
