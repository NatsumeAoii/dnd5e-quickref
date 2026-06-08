// Feature: pre-ship-finalization, Property 34: Exactly-one favicon and canonical with absolute URLs
//
// Property 34 (design "Correctness Properties", Requirement 9.2):
//   For any generated HTML document, the validator reports compliance iff there
//   is exactly one favicon reference and exactly one canonical declaration, each
//   with a non-empty absolute URL.
//
// **Validates: Requirements 9.2**
//
// This test drives `buildHtmlMetadata` + `validateHtmlMetadata` from
// `src/finalization/detectors/html.ts` over generated HTML documents whose
// favicon and canonical references are controlled by the generator. It asserts
// the exact equivalences:
//   - validation.favicon  === (faviconCount === 1)
//   - validation.canonical === (canonicalCount === 1 AND canonicalHref is a
//                               non-empty absolute URL)

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { buildHtmlMetadata, validateHtmlMetadata } from '../detectors/html';

const MIN_RUNS = 100;

/** A non-empty absolute URL (scheme://authority or protocol-relative). */
const absoluteUrlArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(
      fc.constantFrom('https', 'http', 'ftp'),
      fc.constantFrom('example.com', 'cdn.example.org', 'assets.test.io'),
      fc.constantFrom('', '/favicon.ico', '/page', '/a/b/c'),
    )
    .map(([scheme, host, path]) => `${scheme}://${host}${path}`),
  // Protocol-relative URLs are absolute per the detector's contract.
  fc
    .constantFrom('cdn.example.org/icon.png', 'example.com/canonical')
    .map((rest) => `//${rest}`),
);

/** A value that is NOT an absolute URL: relative paths, fragments, or empty. */
const nonAbsoluteUrlArb: fc.Arbitrary<string> = fc.constantFrom(
  '',
  '   ',
  '/favicon.ico',
  './icon.png',
  'page.html',
  '#section',
  '/canonical/path',
  'mailto:test@example.com', // scheme but no authority -> not absolute here
);

/** Builds a single `<link rel="icon">` tag with the given href. */
function faviconTag(href: string): string {
  return `<link rel="icon" href="${href}" />`;
}

/** Builds a single `<link rel="canonical">` tag with the given href. */
function canonicalTag(href: string): string {
  return `<link rel="canonical" href="${href}" />`;
}

/** Assembles a complete HTML document from head-level link tags. */
function buildDocument(links: readonly string[]): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    ...links,
    '<title>Test</title>',
    '</head>',
    '<body></body>',
    '</html>',
  ].join('\n');
}

describe('Property 34: exactly-one favicon and canonical with absolute URLs', () => {
  it('validates favicon compliance iff there is exactly one favicon reference', () => {
    fc.assert(
      fc.property(
        // 0..3 favicon references, each with an absolute href.
        fc.array(absoluteUrlArb, { minLength: 0, maxLength: 3 }),
        (faviconHrefs) => {
          const links = faviconHrefs.map(faviconTag);
          const html = buildDocument(links);

          const meta = buildHtmlMetadata(html);
          const validation = validateHtmlMetadata(meta);

          expect(meta.faviconCount).toBe(faviconHrefs.length);
          // Compliance iff exactly one favicon reference.
          expect(validation.favicon).toBe(faviconHrefs.length === 1);
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });

  it('validates canonical compliance iff exactly one canonical with a non-empty absolute URL', () => {
    fc.assert(
      fc.property(
        // 0..3 canonical declarations with mixed absolute/relative hrefs.
        fc.array(
          fc.oneof(
            absoluteUrlArb.map((href) => ({ href, absolute: true })),
            nonAbsoluteUrlArb.map((href) => ({ href, absolute: false })),
          ),
          { minLength: 0, maxLength: 3 },
        ),
        (canonicals) => {
          const links = canonicals.map((c) => canonicalTag(c.href));
          const html = buildDocument(links);

          const meta = buildHtmlMetadata(html);
          const validation = validateHtmlMetadata(meta);

          expect(meta.canonicalCount).toBe(canonicals.length);

          // The detector reads the FIRST canonical href into canonicalHref.
          const firstAbsolute =
            canonicals.length > 0 ? canonicals[0].absolute : false;
          const expectedCanonicalValid =
            canonicals.length === 1 && firstAbsolute;

          expect(validation.canonical).toBe(expectedCanonicalValid);
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });

  it('reports joint compliance iff exactly one favicon and one absolute canonical', () => {
    fc.assert(
      fc.property(
        fc.array(absoluteUrlArb, { minLength: 0, maxLength: 2 }),
        fc.array(
          fc.oneof(
            absoluteUrlArb.map((href) => ({ href, absolute: true })),
            nonAbsoluteUrlArb.map((href) => ({ href, absolute: false })),
          ),
          { minLength: 0, maxLength: 2 },
        ),
        (faviconHrefs, canonicals) => {
          const links = [
            ...faviconHrefs.map(faviconTag),
            ...canonicals.map((c) => canonicalTag(c.href)),
          ];
          const html = buildDocument(links);

          const meta = buildHtmlMetadata(html);
          const validation = validateHtmlMetadata(meta);

          const faviconOk = faviconHrefs.length === 1;
          const canonicalOk =
            canonicals.length === 1 && canonicals[0].absolute;

          expect(validation.favicon).toBe(faviconOk);
          expect(validation.canonical).toBe(canonicalOk);

          // The combined favicon+canonical compliance is the conjunction.
          expect(validation.favicon && validation.canonical).toBe(
            faviconOk && canonicalOk,
          );
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });
});
