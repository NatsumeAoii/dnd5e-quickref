// Feature: pre-ship-finalization
//
// HtmlCompletenessDetector / Fixer (Domain: 'html', Requirement 9).
//
// Pure, deterministic functions over HTML file content. The detector builds an
// `HtmlMetadata` model from a document's `<head>` and validates it against the
// required-completeness rules; the fixer returns the edits needed to add any
// missing required tags (leaving pre-existing markup byte-for-byte unchanged)
// and to replace empty/malformed/underivable values with the `[FILL IN]`
// placeholder.
//
// No I/O is performed here. The detector consumes `FileRecord[]` and the fixer
// consumes a single `Finding` plus its backing `FileRecord`, returning `Edit[]`
// that only the EditApplier (a later task) acts on.
//
// Design references:
//   - "HtmlCompletenessDetector / Fixer" (Components and Interfaces)
//   - "HTML metadata model" (HtmlMetadata, OpenGraph, TwitterCard)
//   - Correctness Properties 33–37
//
// HTML parsing note: this module uses focused, anchored regular expressions
// over the document `<head>` rather than a full DOM parser. The toolkit runs in
// a Node context (no browser DOM) and must stay dependency-free and
// deterministic. The patterns are intentionally narrow and case-insensitive,
// matching the specific metadata tags Requirement 9 enumerates.

import {
  FILL_IN_PLACEHOLDER,
  type CodeLocation,
  type Detector,
  type Edit,
  type FileRecord,
  type Finding,
  type FixOutcome,
  type Fixer,
} from '../types';

// ---------------------------------------------------------------------------
// HTML metadata model (design "Data Models" > "HTML metadata model")
// ---------------------------------------------------------------------------

/** Open Graph metadata required by Requirement 9.3. */
export interface OpenGraph {
  readonly title: string | null;
  readonly description: string | null;
  readonly image: string | null;
  readonly url: string | null;
}

/** Twitter Card metadata required by Requirement 9.3. */
export interface TwitterCard {
  readonly card: string | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly image: string | null;
}

/**
 * The validated metadata model for a single HTML document.
 *
 * Fields are the raw extracted values (or `null` when absent). Validation
 * predicates (length bounds, exactly-one, absolute URL) are computed separately
 * by `validateHtmlMetadata` so the raw model stays a faithful representation of
 * what the document declares.
 */
export interface HtmlMetadata {
  readonly doctypeFirst: boolean;
  readonly htmlLang: string | null;
  readonly charset: string | null; // expect 'utf-8'
  readonly viewport: string | null;
  readonly title: string | null; // valid length 1..60
  readonly description: string | null; // valid length 50..160
  readonly faviconCount: number; // expect exactly 1
  readonly canonicalCount: number; // expect exactly 1, absolute URL
  readonly canonicalHref: string | null;
  readonly openGraph: OpenGraph;
  readonly twitterCard: TwitterCard;
}

// ---------------------------------------------------------------------------
// Validation bounds and constants (no magic numbers in logic below)
// ---------------------------------------------------------------------------

const TITLE_MIN_LENGTH = 1;
const TITLE_MAX_LENGTH = 60;
const DESCRIPTION_MIN_LENGTH = 50;
const DESCRIPTION_MAX_LENGTH = 160;
const EXPECTED_CHARSET = 'utf-8';
const EXACTLY_ONE = 1;

/** Finding kinds produced by this detector. Stable, machine-readable. */
export const HTML_FINDING_KIND = {
  doctypeMissing: 'html-doctype-missing',
  htmlLangMissing: 'html-lang-missing',
  charsetMissing: 'html-charset-missing',
  charsetMalformed: 'html-charset-malformed',
  viewportMissing: 'html-viewport-missing',
  titleMissing: 'html-title-missing',
  titleLength: 'html-title-length',
  descriptionMissing: 'html-description-missing',
  descriptionLength: 'html-description-length',
  faviconCount: 'html-favicon-count',
  canonicalCount: 'html-canonical-count',
  canonicalNotAbsolute: 'html-canonical-not-absolute',
  openGraphIncomplete: 'html-open-graph-incomplete',
  twitterCardIncomplete: 'html-twitter-card-incomplete',
} as const;

// ---------------------------------------------------------------------------
// Low-level extraction helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Returns the document `<head>` inner markup, or the whole document when no
 * `<head>` is present (so metadata can still be located in malformed docs).
 */
function extractHead(html: string): string {
  const match = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(html);
  return match ? match[1] : html;
}

/**
 * True when `<!DOCTYPE html>` (case-insensitive) is the first non-whitespace
 * markup in the document (Requirement 9.1).
 */
function isDoctypeFirst(html: string): boolean {
  return /^\s*<!DOCTYPE\s+html\b[^>]*>/i.test(html);
}

/** Extracts a `<html lang="...">` attribute value, or `null`. */
function extractHtmlLang(html: string): string | null {
  const tag = /<html\b[^>]*>/i.exec(html);
  if (!tag) {
    return null;
  }
  const lang = /\blang\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag[0]);
  if (!lang) {
    return null;
  }
  const value = lang[2] ?? lang[3] ?? '';
  return value;
}

/** Reads the value of a quoted HTML attribute from a single tag string. */
function readAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const match = re.exec(tag);
  if (!match) {
    return null;
  }
  return match[2] ?? match[3] ?? '';
}

/** Returns every `<meta ...>` tag string in the supplied markup. */
function allMetaTags(head: string): readonly string[] {
  return head.match(/<meta\b[^>]*>/gi) ?? [];
}

/** Returns every `<link ...>` tag string in the supplied markup. */
function allLinkTags(head: string): readonly string[] {
  return head.match(/<link\b[^>]*>/gi) ?? [];
}

/** Finds the first meta tag whose `name` (or `property`) equals `key`. */
function findMetaContent(
  metas: readonly string[],
  key: string,
  attr: 'name' | 'property',
): string | null {
  for (const tag of metas) {
    const id = readAttr(tag, attr);
    if (id !== null && id.toLowerCase() === key.toLowerCase()) {
      return readAttr(tag, 'content');
    }
  }
  return null;
}

/** Extracts the charset, supporting both `<meta charset>` and http-equiv. */
function extractCharset(metas: readonly string[]): string | null {
  for (const tag of metas) {
    const direct = readAttr(tag, 'charset');
    if (direct !== null) {
      return direct;
    }
    const httpEquiv = readAttr(tag, 'http-equiv');
    if (httpEquiv !== null && httpEquiv.toLowerCase() === 'content-type') {
      const content = readAttr(tag, 'content');
      const match = content ? /charset=([^;\s]+)/i.exec(content) : null;
      if (match) {
        return match[1];
      }
    }
  }
  return null;
}

/** Extracts the `<title>` text content, or `null` when absent. */
function extractTitle(head: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
  if (!match) {
    return null;
  }
  return match[1].trim();
}

/** Counts favicon link references (`rel` containing `icon`). */
function countFavicons(links: readonly string[]): number {
  let count = 0;
  for (const tag of links) {
    const rel = readAttr(tag, 'rel');
    if (rel === null) {
      continue;
    }
    const tokens = rel.toLowerCase().split(/\s+/);
    if (tokens.includes('icon') || tokens.includes('shortcut')) {
      count += 1;
    }
  }
  return count;
}

/** Returns all canonical link hrefs (`rel="canonical"`). */
function canonicalHrefs(links: readonly string[]): readonly string[] {
  const hrefs: string[] = [];
  for (const tag of links) {
    const rel = readAttr(tag, 'rel');
    if (rel !== null && rel.toLowerCase().trim() === 'canonical') {
      hrefs.push(readAttr(tag, 'href') ?? '');
    }
  }
  return hrefs;
}

/**
 * True when `value` is a non-empty absolute URL (has a scheme + authority, or
 * is protocol-relative). Relative paths and empty strings are rejected
 * (Requirement 9.2).
 */
function isAbsoluteUrl(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('//');
}

// ---------------------------------------------------------------------------
// Metadata model construction
// ---------------------------------------------------------------------------

/**
 * Builds the `HtmlMetadata` model from a complete HTML document string.
 * This is the single source of truth the detector and fixer both read from.
 */
export function buildHtmlMetadata(html: string): HtmlMetadata {
  const head = extractHead(html);
  const metas = allMetaTags(head);
  const links = allLinkTags(head);
  const canonicals = canonicalHrefs(links);

  return {
    doctypeFirst: isDoctypeFirst(html),
    htmlLang: extractHtmlLang(html),
    charset: extractCharset(metas),
    viewport: findMetaContent(metas, 'viewport', 'name'),
    title: extractTitle(head),
    description: findMetaContent(metas, 'description', 'name'),
    faviconCount: countFavicons(links),
    canonicalCount: canonicals.length,
    canonicalHref: canonicals.length > 0 ? canonicals[0] : null,
    openGraph: {
      title: findMetaContent(metas, 'og:title', 'property'),
      description: findMetaContent(metas, 'og:description', 'property'),
      image: findMetaContent(metas, 'og:image', 'property'),
      url: findMetaContent(metas, 'og:url', 'property'),
    },
    twitterCard: {
      card: findMetaContent(metas, 'twitter:card', 'name'),
      title: findMetaContent(metas, 'twitter:title', 'name'),
      description: findMetaContent(metas, 'twitter:description', 'name'),
      image: findMetaContent(metas, 'twitter:image', 'name'),
    },
  };
}

// ---------------------------------------------------------------------------
// Validation predicates (pure) — drive Properties 33–35
// ---------------------------------------------------------------------------

function isNonEmpty(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

function isTitleValid(title: string | null): boolean {
  if (title === null) {
    return false;
  }
  const len = title.trim().length;
  return len >= TITLE_MIN_LENGTH && len <= TITLE_MAX_LENGTH;
}

function isDescriptionValid(description: string | null): boolean {
  if (description === null) {
    return false;
  }
  const len = description.trim().length;
  return len >= DESCRIPTION_MIN_LENGTH && len <= DESCRIPTION_MAX_LENGTH;
}

function isCharsetValid(charset: string | null): boolean {
  return charset !== null && charset.trim().toLowerCase() === EXPECTED_CHARSET;
}

/** Open Graph is complete iff all four fields are present and non-empty. */
function isOpenGraphComplete(og: OpenGraph): boolean {
  return (
    isNonEmpty(og.title) &&
    isNonEmpty(og.description) &&
    isNonEmpty(og.image) &&
    isNonEmpty(og.url)
  );
}

/** Twitter Card is complete iff all four fields are present and non-empty. */
function isTwitterCardComplete(tc: TwitterCard): boolean {
  return (
    isNonEmpty(tc.card) &&
    isNonEmpty(tc.title) &&
    isNonEmpty(tc.description) &&
    isNonEmpty(tc.image)
  );
}

/**
 * Aggregate validity flags for an `HtmlMetadata` model. Exposed so tests
 * (Properties 33–35) can assert each rule independently.
 */
export interface HtmlValidation {
  readonly doctypeFirst: boolean;
  readonly htmlLang: boolean;
  readonly charset: boolean;
  readonly viewport: boolean;
  readonly title: boolean;
  readonly description: boolean;
  readonly favicon: boolean;
  readonly canonical: boolean;
  readonly openGraph: boolean;
  readonly twitterCard: boolean;
}

export function validateHtmlMetadata(meta: HtmlMetadata): HtmlValidation {
  return {
    doctypeFirst: meta.doctypeFirst,
    htmlLang: isNonEmpty(meta.htmlLang),
    charset: isCharsetValid(meta.charset),
    viewport: isNonEmpty(meta.viewport),
    title: isTitleValid(meta.title),
    description: isDescriptionValid(meta.description),
    favicon: meta.faviconCount === EXACTLY_ONE,
    canonical:
      meta.canonicalCount === EXACTLY_ONE && isAbsoluteUrl(meta.canonicalHref),
    openGraph: isOpenGraphComplete(meta.openGraph),
    twitterCard: isTwitterCardComplete(meta.twitterCard),
  };
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/** A `.html` file is treated as a shipped HTML_Document (Requirement 9). */
function isHtmlDocument(record: FileRecord): boolean {
  return record.language === 'html' || record.path.toLowerCase().endsWith('.html');
}

/** Builds a finding with a tag-based location (HTML findings locate by tag). */
function htmlFinding(
  path: string,
  kind: string,
  detail: string,
  tag: string,
): Finding {
  const location: CodeLocation = { tag };
  return {
    domain: 'html',
    path,
    location,
    kind,
    detail,
    autoFixable: true,
  };
}

/**
 * Detects HTML completeness defects across every shipped HTML document.
 *
 * Records whose `content` is `null` (read failures) are skipped — a finding
 * must be grounded in content actually read (Requirement 1.5). Every emitted
 * `Finding.path` is the path of a record present in `records`.
 */
export function detectHtmlCompleteness(
  records: readonly FileRecord[],
): readonly Finding[] {
  const findings: Finding[] = [];

  for (const record of records) {
    if (record.content === null || !isHtmlDocument(record)) {
      continue;
    }

    const html = record.content;
    const meta = buildHtmlMetadata(html);
    const valid = validateHtmlMetadata(meta);
    const path = record.path;

    if (!valid.doctypeFirst) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.doctypeMissing,
          '<!DOCTYPE html> must be the first markup in the document.',
          '<!DOCTYPE html>',
        ),
      );
    }

    if (!valid.htmlLang) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.htmlLangMissing,
          'The <html> element is missing a non-empty lang attribute.',
          '<html lang>',
        ),
      );
    }

    if (meta.charset === null) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.charsetMissing,
          'A UTF-8 charset meta tag is missing.',
          'meta[charset]',
        ),
      );
    } else if (!valid.charset) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.charsetMalformed,
          `Charset is "${meta.charset}" but must be UTF-8.`,
          'meta[charset]',
        ),
      );
    }

    if (!valid.viewport) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.viewportMissing,
          'A viewport meta tag with non-empty content is missing.',
          'meta[name=viewport]',
        ),
      );
    }

    if (meta.title === null) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.titleMissing,
          'A <title> element is missing.',
          '<title>',
        ),
      );
    } else if (!valid.title) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.titleLength,
          `Title length ${meta.title.trim().length} is outside the ${TITLE_MIN_LENGTH}-${TITLE_MAX_LENGTH} range.`,
          '<title>',
        ),
      );
    }

    if (meta.description === null) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.descriptionMissing,
          'A meta description is missing.',
          'meta[name=description]',
        ),
      );
    } else if (!valid.description) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.descriptionLength,
          `Description length ${meta.description.trim().length} is outside the ${DESCRIPTION_MIN_LENGTH}-${DESCRIPTION_MAX_LENGTH} range.`,
          'meta[name=description]',
        ),
      );
    }

    if (!valid.favicon) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.faviconCount,
          `Expected exactly one favicon reference but found ${meta.faviconCount}.`,
          'link[rel=icon]',
        ),
      );
    }

    if (meta.canonicalCount !== EXACTLY_ONE) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.canonicalCount,
          `Expected exactly one canonical URL but found ${meta.canonicalCount}.`,
          'link[rel=canonical]',
        ),
      );
    } else if (!isAbsoluteUrl(meta.canonicalHref)) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.canonicalNotAbsolute,
          'The canonical URL must be a non-empty absolute URL.',
          'link[rel=canonical]',
        ),
      );
    }

    if (!valid.openGraph) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.openGraphIncomplete,
          'Open Graph metadata (title, description, image, url) is incomplete.',
          'meta[property^=og:]',
        ),
      );
    }

    if (!valid.twitterCard) {
      findings.push(
        htmlFinding(
          path,
          HTML_FINDING_KIND.twitterCardIncomplete,
          'Twitter Card metadata (card, title, description, image) is incomplete.',
          'meta[name^=twitter:]',
        ),
      );
    }
  }

  return findings;
}

/** Detector object implementing the shared `Detector` contract. */
export const htmlCompletenessDetector: Detector = {
  domain: 'html',
  detect: detectHtmlCompleteness,
};

// ---------------------------------------------------------------------------
// Fixer
// ---------------------------------------------------------------------------
//
// The fixer never rewrites the document wholesale. It returns granular edits:
//   - `insert` edits add a missing required tag (or a missing attribute is
//     handled via a narrow `replace` of the opening <html> tag). Inserts leave
//     all pre-existing markup byte-for-byte unchanged (Requirement 9.5,
//     Property 36).
//   - `replace` edits swap only a malformed/empty value for a derivable value
//     (charset, viewport) or a `[FILL IN]` placeholder when the value cannot be
//     derived from project context (Requirements 9.4, 9.6, Property 37).
//
// Insertion target is encoded in `Edit.range.tag`:
//   'document-start' → before the first byte (DOCTYPE)
//   'head'           → inside <head> (metadata tags)
// The EditApplier (a later task) resolves these anchors.

/** Derivable default values (no project context required). */
const DERIVABLE = {
  doctype: '<!DOCTYPE html>',
  charset: '<meta charset="utf-8" />',
  viewport:
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  twitterCardType: 'summary',
} as const;

function insertEdit(
  path: string,
  text: string,
  anchor: string,
  placeholderInserted: boolean,
): Edit {
  return {
    kind: 'insert',
    path,
    range: { tag: anchor },
    text,
    placeholderInserted,
  };
}

function replaceEdit(
  path: string,
  tag: string,
  text: string,
  placeholderInserted: boolean,
): Edit {
  return {
    kind: 'replace',
    path,
    range: { tag },
    text,
    placeholderInserted,
  };
}

/**
 * Adds a non-empty `lang` attribute to the existing opening `<html>` tag,
 * preserving every other attribute byte-for-byte. Returns `null` when no
 * `<html>` tag is present (then the caller falls back to inserting one).
 */
function addLangToHtmlTag(html: string): string | null {
  const tag = /<html\b[^>]*>/i.exec(html);
  if (!tag) {
    return null;
  }
  const original = tag[0];
  // Insert lang right after `<html`, before any other attributes, so the rest
  // of the tag stays byte-identical.
  return original.replace(/^<html\b/i, `<html lang="${FILL_IN_PLACEHOLDER}"`);
}

/**
 * Returns the edits required to resolve a single HTML finding, or a
 * preservation outcome when the defect cannot be auto-fixed without risking
 * behavior or guessing which markup to remove (e.g. duplicate favicons).
 */
export function fixHtmlFinding(finding: Finding, record: FileRecord): FixOutcome {
  const path = finding.path;
  const html = record.content ?? '';

  switch (finding.kind) {
    case HTML_FINDING_KIND.doctypeMissing:
      return {
        edits: [insertEdit(path, DERIVABLE.doctype, 'document-start', false)],
        preserved: false,
      };

    case HTML_FINDING_KIND.htmlLangMissing: {
      const rewritten = addLangToHtmlTag(html);
      if (rewritten !== null) {
        return {
          edits: [replaceEdit(path, '<html>', rewritten, true)],
          preserved: false,
        };
      }
      // No <html> tag at all: insert a minimal one with a placeholder lang.
      return {
        edits: [
          insertEdit(
            path,
            `<html lang="${FILL_IN_PLACEHOLDER}">`,
            'document-start',
            true,
          ),
        ],
        preserved: false,
      };
    }

    case HTML_FINDING_KIND.charsetMissing:
      return {
        edits: [insertEdit(path, DERIVABLE.charset, 'head', false)],
        preserved: false,
      };

    case HTML_FINDING_KIND.charsetMalformed:
      // The correct value is derivable (UTF-8), so set it rather than a
      // placeholder.
      return {
        edits: [replaceEdit(path, 'meta[charset]', DERIVABLE.charset, false)],
        preserved: false,
      };

    case HTML_FINDING_KIND.viewportMissing:
      return {
        edits: [insertEdit(path, DERIVABLE.viewport, 'head', false)],
        preserved: false,
      };

    case HTML_FINDING_KIND.titleMissing:
      return {
        edits: [
          insertEdit(path, `<title>${FILL_IN_PLACEHOLDER}</title>`, 'head', true),
        ],
        preserved: false,
      };

    case HTML_FINDING_KIND.titleLength:
      // Out-of-bounds title is malformed; its correct value is underivable.
      return {
        edits: [
          replaceEdit(
            path,
            '<title>',
            `<title>${FILL_IN_PLACEHOLDER}</title>`,
            true,
          ),
        ],
        preserved: false,
      };

    case HTML_FINDING_KIND.descriptionMissing:
      return {
        edits: [
          insertEdit(
            path,
            `<meta name="description" content="${FILL_IN_PLACEHOLDER}" />`,
            'head',
            true,
          ),
        ],
        preserved: false,
      };

    case HTML_FINDING_KIND.descriptionLength:
      return {
        edits: [
          replaceEdit(
            path,
            'meta[name=description]',
            `<meta name="description" content="${FILL_IN_PLACEHOLDER}" />`,
            true,
          ),
        ],
        preserved: false,
      };

    case HTML_FINDING_KIND.faviconCount: {
      const meta = buildHtmlMetadata(html);
      if (meta.faviconCount === 0) {
        return {
          edits: [
            insertEdit(
              path,
              `<link rel="icon" href="${FILL_IN_PLACEHOLDER}" />`,
              'head',
              true,
            ),
          ],
          preserved: false,
        };
      }
      // More than one favicon: removing the duplicates could drop an
      // intentional multi-size/format set, so preserve and record the reason.
      return {
        edits: [],
        preserved: true,
        preservationReason: `Found ${meta.faviconCount} favicon references; not auto-removed because multiple icon sizes/formats may be intentional. Manual review required.`,
      };
    }

    case HTML_FINDING_KIND.canonicalCount: {
      const meta = buildHtmlMetadata(html);
      if (meta.canonicalCount === 0) {
        return {
          edits: [
            insertEdit(
              path,
              `<link rel="canonical" href="${FILL_IN_PLACEHOLDER}" />`,
              'head',
              true,
            ),
          ],
          preserved: false,
        };
      }
      // More than one canonical: ambiguous which to keep; preserve with reason.
      return {
        edits: [],
        preserved: true,
        preservationReason: `Found ${meta.canonicalCount} canonical URLs; not auto-removed because the authoritative URL cannot be derived. Manual review required.`,
      };
    }

    case HTML_FINDING_KIND.canonicalNotAbsolute:
      return {
        edits: [
          replaceEdit(
            path,
            'link[rel=canonical]',
            `<link rel="canonical" href="${FILL_IN_PLACEHOLDER}" />`,
            true,
          ),
        ],
        preserved: false,
      };

    case HTML_FINDING_KIND.openGraphIncomplete:
      return {
        edits: missingOpenGraphEdits(path, buildHtmlMetadata(html).openGraph),
        preserved: false,
      };

    case HTML_FINDING_KIND.twitterCardIncomplete:
      return {
        edits: missingTwitterCardEdits(path, buildHtmlMetadata(html).twitterCard),
        preserved: false,
      };

    default:
      // Unknown kind: leave untouched rather than risk a wrong edit.
      return {
        edits: [],
        preserved: true,
        preservationReason: `No HTML fix is defined for finding kind "${finding.kind}".`,
      };
  }
}

/** Builds insert edits for each absent Open Graph field (Requirement 9.3). */
function missingOpenGraphEdits(path: string, og: OpenGraph): readonly Edit[] {
  const edits: Edit[] = [];
  if (!isNonEmpty(og.title)) {
    edits.push(
      insertEdit(
        path,
        `<meta property="og:title" content="${FILL_IN_PLACEHOLDER}" />`,
        'head',
        true,
      ),
    );
  }
  if (!isNonEmpty(og.description)) {
    edits.push(
      insertEdit(
        path,
        `<meta property="og:description" content="${FILL_IN_PLACEHOLDER}" />`,
        'head',
        true,
      ),
    );
  }
  if (!isNonEmpty(og.image)) {
    edits.push(
      insertEdit(
        path,
        `<meta property="og:image" content="${FILL_IN_PLACEHOLDER}" />`,
        'head',
        true,
      ),
    );
  }
  if (!isNonEmpty(og.url)) {
    edits.push(
      insertEdit(
        path,
        `<meta property="og:url" content="${FILL_IN_PLACEHOLDER}" />`,
        'head',
        true,
      ),
    );
  }
  return edits;
}

/** Builds insert edits for each absent Twitter Card field (Requirement 9.3). */
function missingTwitterCardEdits(
  path: string,
  tc: TwitterCard,
): readonly Edit[] {
  const edits: Edit[] = [];
  if (!isNonEmpty(tc.card)) {
    // Card type has a sensible derivable default.
    edits.push(
      insertEdit(
        path,
        `<meta name="twitter:card" content="${DERIVABLE.twitterCardType}" />`,
        'head',
        false,
      ),
    );
  }
  if (!isNonEmpty(tc.title)) {
    edits.push(
      insertEdit(
        path,
        `<meta name="twitter:title" content="${FILL_IN_PLACEHOLDER}" />`,
        'head',
        true,
      ),
    );
  }
  if (!isNonEmpty(tc.description)) {
    edits.push(
      insertEdit(
        path,
        `<meta name="twitter:description" content="${FILL_IN_PLACEHOLDER}" />`,
        'head',
        true,
      ),
    );
  }
  if (!isNonEmpty(tc.image)) {
    edits.push(
      insertEdit(
        path,
        `<meta name="twitter:image" content="${FILL_IN_PLACEHOLDER}" />`,
        'head',
        true,
      ),
    );
  }
  return edits;
}

/** Fixer object implementing the shared `Fixer` contract. */
export const htmlCompletenessFixer: Fixer = {
  domain: 'html',
  fix: fixHtmlFinding,
};
