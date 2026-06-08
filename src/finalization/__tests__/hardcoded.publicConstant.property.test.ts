// Feature: pre-ship-finalization, Property 13: Intentional public constants are preserved with conditions recorded
//
// Property 13 (design "Correctness Properties"):
//   For any literal classified as intentional, stable, and public, the fixer
//   SHALL preserve it and SHALL record which preservation conditions are
//   satisfied.
//
// **Validates: Requirements 4.4**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  hardcodedDetector,
  hardcodedFixer,
  HARDCODED_KINDS,
} from '../detectors/hardcoded';
import { type FileRecord, type SourceLanguage } from '../types';

/**
 * Build a minimal FileRecord for a source string. The detector inspects only
 * `content` and `language`; `path` selects config-file vs ordinary-file rules.
 */
function tsRecord(
  content: string,
  path = 'src/example.ts',
  language: SourceLanguage = 'typescript',
): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language,
  };
}

/**
 * UPPER_SNAKE constant names that are NOT classified as secrets (none match the
 * detector's secret-name pattern) and that, for the port cases, contain the
 * `PORT` segment the port detector requires.
 */
const UPPER_SNAKE_URL_NAMES = [
  'API_BASE_URL',
  'ASSET_HOST',
  'CDN_ENDPOINT',
  'PUBLIC_URL',
  'DOCS_LINK',
  'CANONICAL_ORIGIN',
] as const;

const UPPER_SNAKE_PATH_NAMES = [
  'CONFIG_PATH',
  'DATA_ROOT',
  'CACHE_DIR',
  'INSTALL_PREFIX',
] as const;

const UPPER_SNAKE_PORT_NAMES = [
  'SERVER_PORT',
  'DEV_PORT',
  'HTTP_PORT',
  'DEFAULT_PORT',
  'LISTEN_PORT',
] as const;

/** Lowercase identifier names (intentional only by virtue of a config file). */
const CONFIG_FILE_NAMES = ['apiBase', 'assetHost', 'cdnEndpoint', 'publicUrl'] as const;

/** Configuration-module paths where literals are treated as intentional. */
const CONFIG_FILE_PATHS = [
  'src/config.ts',
  'src/app.config.ts',
  'src/runtime.config.js',
] as const;

/**
 * Well-known public namespace URLs the detector treats as intentional, stable,
 * and public regardless of the assigned name or file. Must match the
 * `WELL_KNOWN_PUBLIC_URLS` set in the detector.
 */
const WELL_KNOWN_PUBLIC_URLS = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/2000/xmlns/',
] as const;

/** Lowercase keys used inside a frozen config object (intentional by freeze). */
const FROZEN_OBJECT_KEYS = ['assetHost', 'apiBase', 'cdnEndpoint', 'docsLink'] as const;

const quoteArb = fc.constantFrom('"', "'");

/** A URL value that satisfies the detector's `isUrl` check (no whitespace). */
const urlArb = fc
  .stringMatching(/^[a-z0-9]{3,12}$/)
  .chain((host) =>
    fc
      .stringMatching(/^[a-z0-9/-]{1,16}$/)
      .map((path) => `https://${host}.example.com/${path}`),
  );

/** A POSIX absolute path rooted at a directory the detector recognizes. */
const absolutePathArb = fc
  .constantFrom('/usr/local', '/home/app', '/var/www', '/opt/site')
  .chain((root) =>
    fc.stringMatching(/^[a-z0-9_-]{2,12}$/).map((seg) => `${root}/${seg}`),
  );

/** A port number in the conventional 2–5 digit range the detector matches. */
const portArb = fc.integer({ min: 1024, max: 65535 });

describe('Property 13: Intentional public constants are preserved with conditions recorded', () => {
  it('preserves UPPER_SNAKE config URL/path constants and records the conditions', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({
            name: fc.constantFrom(...UPPER_SNAKE_URL_NAMES),
            value: urlArb,
          }),
          fc.record({
            name: fc.constantFrom(...UPPER_SNAKE_PATH_NAMES),
            value: absolutePathArb,
          }),
        ),
        quoteArb,
        ({ name, value }, quote) => {
          const content = `const ${name} = ${quote}${value}${quote};\n`;
          const record = tsRecord(content);

          const findings = hardcodedDetector.detect([record]);

          // The literal is classified as an intentional public constant, never
          // as a config-literal to hoist or a secret.
          const intentional = findings.filter(
            (f) => f.kind === HARDCODED_KINDS.intentionalConstant,
          );
          expect(intentional.length).toBe(1);
          expect(
            findings.some((f) => f.kind === HARDCODED_KINDS.configLiteral),
          ).toBe(false);
          expect(findings.some((f) => f.kind === HARDCODED_KINDS.secret)).toBe(
            false,
          );

          // The fixer preserves the literal: it emits no edits.
          const outcome = hardcodedFixer.fix(intentional[0], record);
          expect(outcome.preserved).toBe(true);
          expect(outcome.edits).toHaveLength(0);

          // It records which preservation conditions are satisfied: the
          // UPPER_SNAKE-constant condition and the non-secret/public condition.
          const reason = outcome.preservationReason ?? '';
          expect(reason.length).toBeGreaterThan(0);
          expect(reason).toBe(intentional[0].detail);
          expect(reason).toMatch(/UPPER_SNAKE/);
          expect(reason).toMatch(/non-secret|public/i);

          // The source is unchanged: the literal still appears.
          expect(record.content).toContain(value);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('preserves UPPER_SNAKE port constants and records the conditions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...UPPER_SNAKE_PORT_NAMES),
        portArb,
        (name, port) => {
          const content = `const ${name} = ${port};\n`;
          const record = tsRecord(content);

          const intentional = hardcodedDetector
            .detect([record])
            .filter((f) => f.kind === HARDCODED_KINDS.intentionalConstant);
          expect(intentional.length).toBe(1);

          const outcome = hardcodedFixer.fix(intentional[0], record);
          expect(outcome.preserved).toBe(true);
          expect(outcome.edits).toHaveLength(0);

          const reason = outcome.preservationReason ?? '';
          expect(reason).toBe(intentional[0].detail);
          // Records the satisfied conditions: declared as a named constant,
          // stable, and non-secret.
          expect(reason).toMatch(/intentional public constant/i);
          expect(reason).toMatch(/named constant/i);
          expect(reason).toMatch(/non-secret/i);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('preserves config-file URL literals (intentional by module) with a recorded reason', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONFIG_FILE_NAMES),
        fc.constantFrom(...CONFIG_FILE_PATHS),
        urlArb,
        quoteArb,
        (name, path, value, quote) => {
          const language: SourceLanguage = path.endsWith('.js')
            ? 'javascript'
            : 'typescript';
          const content = `const ${name} = ${quote}${value}${quote};\n`;
          const record = tsRecord(content, path, language);

          const intentional = hardcodedDetector
            .detect([record])
            .filter((f) => f.kind === HARDCODED_KINDS.intentionalConstant);
          expect(intentional.length).toBe(1);

          const outcome = hardcodedFixer.fix(intentional[0], record);
          expect(outcome.preserved).toBe(true);
          expect(outcome.edits).toHaveLength(0);

          const reason = outcome.preservationReason ?? '';
          expect(reason).toBe(intentional[0].detail);
          expect(reason).toMatch(/preserved/i);
          expect(reason).toMatch(/non-secret|public/i);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('preserves well-known public namespace URLs (stable, public) with a recorded reason', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WELL_KNOWN_PUBLIC_URLS),
        // A lowercase name in an ordinary file: intentional ONLY because the
        // value is a well-known public namespace URL.
        fc.constantFrom('namespace', 'svgNs', 'xmlNs', 'xlinkNs'),
        quoteArb,
        (value, name, quote) => {
          const content = `const ${name} = ${quote}${value}${quote};\n`;
          const record = tsRecord(content);

          const findings = hardcodedDetector.detect([record]);
          const intentional = findings.filter(
            (f) => f.kind === HARDCODED_KINDS.intentionalConstant,
          );
          expect(intentional.length).toBe(1);
          // Never misclassified as a config literal to hoist or a secret.
          expect(
            findings.some((f) => f.kind === HARDCODED_KINDS.configLiteral),
          ).toBe(false);
          expect(findings.some((f) => f.kind === HARDCODED_KINDS.secret)).toBe(
            false,
          );

          const outcome = hardcodedFixer.fix(intentional[0], record);
          expect(outcome.preserved).toBe(true);
          expect(outcome.edits).toHaveLength(0);

          const reason = outcome.preservationReason ?? '';
          expect(reason).toBe(intentional[0].detail);
          expect(reason).toMatch(/well-known public namespace URL/i);
          expect(reason).toMatch(/non-secret|public/i);

          // The source literal is preserved unchanged.
          expect(record.content).toContain(value);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('preserves config URL literals inside an Object.freeze context with a recorded reason', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FROZEN_OBJECT_KEYS),
        urlArb,
        quoteArb,
        (key, value, quote) => {
          // The literal is intentional because it sits inside an
          // `Object.freeze({ ... })` config object, not because of its name.
          const content =
            `const settings = Object.freeze({\n` +
            `  ${key}: ${quote}${value}${quote},\n` +
            `});\n`;
          const record = tsRecord(content);

          const findings = hardcodedDetector.detect([record]);
          const intentional = findings.filter(
            (f) => f.kind === HARDCODED_KINDS.intentionalConstant,
          );
          expect(intentional.length).toBe(1);
          expect(
            findings.some((f) => f.kind === HARDCODED_KINDS.configLiteral),
          ).toBe(false);

          const outcome = hardcodedFixer.fix(intentional[0], record);
          expect(outcome.preserved).toBe(true);
          expect(outcome.edits).toHaveLength(0);

          const reason = outcome.preservationReason ?? '';
          expect(reason).toBe(intentional[0].detail);
          expect(reason).toMatch(/preserved/i);
          expect(reason).toMatch(/non-secret|public/i);

          // The source literal is preserved unchanged.
          expect(record.content).toContain(value);
        },
      ),
      { numRuns: 100 },
    );
  });
});
