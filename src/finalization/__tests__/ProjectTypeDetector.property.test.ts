// Feature: pre-ship-finalization, Property 5: Primary-language detection applies the 10% threshold and descending order
//
// Validates: Requirements 2.1
//
// Property text: For any multiset of source-file extensions, the detected
// primary languages SHALL contain exactly those types whose share is at least
// 10 percent of the source-file count, listed in descending order of file
// count.
//
// Strategy: generate an inventory of FileRecords whose languages are drawn from
// the recognized source languages plus the non-source `other` kind (which the
// detector must exclude from the source-file count). For each generated
// inventory we independently recompute the expected primary-language set and
// ordering from first principles, then assert the detector agrees.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { detectProjectType } from '../ProjectTypeDetector.js';
import type { FileRecord, SourceLanguage } from '../types.js';

/** The source languages the detector counts toward primary-language shares. */
const SOURCE_LANGUAGES: readonly SourceLanguage[] = [
  'typescript',
  'javascript',
  'css',
  'html',
  'json',
  'markdown',
];

/** Threshold the detector applies: a language must hold >= 10% of source files. */
const PRIMARY_LANGUAGE_THRESHOLD = 0.1;

/**
 * Build a minimal FileRecord for a given language. Only `language` affects
 * primary-language detection; the other fields are filled with valid, inert
 * values so the record is well-formed.
 */
function makeRecord(language: SourceLanguage, index: number): FileRecord {
  return {
    path: `src/generated/file-${index}.${language}`,
    content: '',
    bytes: 0,
    readError: null,
    language,
  };
}

/**
 * Independently compute the expected primary languages from an inventory,
 * mirroring the specified rule (not the implementation): count each source
 * language, exclude `other`, keep those whose share is >= 10%, and order by
 * descending count with language name as the deterministic tie-break.
 */
function expectedPrimaryLanguages(
  records: readonly FileRecord[],
): readonly { language: SourceLanguage; count: number; share: number }[] {
  const counts = new Map<SourceLanguage, number>();
  for (const record of records) {
    if (record.language === 'other') {
      continue;
    }
    counts.set(record.language, (counts.get(record.language) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return [];
  }

  return [...counts.entries()]
    .map(([language, count]) => ({ language, count, share: count / total }))
    .filter((entry) => entry.share >= PRIMARY_LANGUAGE_THRESHOLD)
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
}

/** Arbitrary inventory: a list of records over source languages and `other`. */
const inventoryArbitrary = fc
  .array(
    fc.constantFrom<SourceLanguage>(...SOURCE_LANGUAGES, 'other'),
    { minLength: 0, maxLength: 60 },
  )
  .map((languages) =>
    languages.map((language, index) => makeRecord(language, index)),
  );

describe('ProjectTypeDetector primary-language detection (Property 5)', () => {
  it('selects exactly the >=10% languages in descending count order', () => {
    fc.assert(
      fc.property(inventoryArbitrary, (records) => {
        const { primaryLanguages } = detectProjectType(records);
        const expected = expectedPrimaryLanguages(records);

        // Exact membership and ordering match the independently derived result.
        expect(primaryLanguages).toEqual(expected);

        const total = expected.reduce((sum, e) => sum + e.count, 0);

        // Every reported language meets the 10% threshold.
        for (const entry of primaryLanguages) {
          expect(entry.share).toBeGreaterThanOrEqual(
            PRIMARY_LANGUAGE_THRESHOLD,
          );
          // No `other` (non-source) language is ever reported.
          expect(entry.language).not.toBe('other');
        }

        // Counts are non-increasing (descending order by file count).
        for (let i = 1; i < primaryLanguages.length; i += 1) {
          expect(primaryLanguages[i - 1].count).toBeGreaterThanOrEqual(
            primaryLanguages[i].count,
          );
        }

        // Completeness: no qualifying language is omitted. Any source language
        // whose share reaches the threshold must appear in the result.
        if (total > 0) {
          const counts = new Map<SourceLanguage, number>();
          for (const record of records) {
            if (record.language === 'other') {
              continue;
            }
            counts.set(
              record.language,
              (counts.get(record.language) ?? 0) + 1,
            );
          }
          const reported = new Set(
            primaryLanguages.map((entry) => entry.language),
          );
          for (const [language, count] of counts) {
            const qualifies = count / total >= PRIMARY_LANGUAGE_THRESHOLD;
            expect(reported.has(language)).toBe(qualifies);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('reports no primary languages when only non-source files are present', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant<SourceLanguage>('other'), {
          minLength: 0,
          maxLength: 20,
        }),
        (languages) => {
          const records = languages.map((language, index) =>
            makeRecord(language, index),
          );
          expect(detectProjectType(records).primaryLanguages).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
