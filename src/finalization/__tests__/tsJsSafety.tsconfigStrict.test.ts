// @vitest-environment node
//
// Feature: pre-ship-finalization, Task 13.6
//
// Unit test for tsconfig strict-mode verification in the ts-js-safety domain.
// Covers two paths:
//   - strict-on: this repository's real tsconfig.json (strict: true) produces
//     no `tsconfig-strict-disabled` finding (Requirement 10.5).
//   - strict-off: a tsconfig with `strict` disabled, and one with an individual
//     strict-family flag disabled, each produce a finding that names the
//     specific disabled setting, while the fixer leaves the tsconfig unchanged
//     (Requirement 10.6).
//
// _Requirements: 10.5, 10.6_

// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  detectTsJsSafety,
  fixTsJsSafety,
  TS_JS_KINDS,
} from '../detectors/tsJsSafety.js';
import type { FileRecord } from '../types.js';

/** Build a tsconfig FileRecord from raw JSON content. */
function buildTsconfigRecord(path: string, content: string): FileRecord {
  return {
    path,
    content,
    bytes: content.length,
    readError: null,
    language: 'json',
  };
}

/** Read this repository's real tsconfig.json into a FileRecord. */
function readRealTsconfig(): FileRecord {
  const fileUrl = new URL('../../../tsconfig.json', import.meta.url);
  const content = readFileSync(fileUrl, 'utf8') as string;
  const bytes = (statSync(fileUrl) as { size: number }).size;
  return {
    path: 'tsconfig.json',
    content,
    bytes,
    readError: null,
    language: 'json',
  };
}

describe('tsconfig strict-mode verification (task 13.6)', () => {
  describe('strict-on: the real repository tsconfig (Req 10.5)', () => {
    const record = readRealTsconfig();
    const findings = detectTsJsSafety([record]);

    it('confirms the fixture actually enables strict mode', () => {
      const parsed = JSON.parse(record.content ?? '{}') as {
        compilerOptions?: { strict?: unknown };
      };
      expect(parsed.compilerOptions?.strict).toBe(true);
    });

    it('produces no tsconfig-strict-disabled finding', () => {
      const strictFindings = findings.filter(
        (finding) => finding.kind === TS_JS_KINDS.tsconfigStrict,
      );
      expect(strictFindings).toEqual([]);
    });
  });

  describe('strict-off: strict explicitly disabled (Req 10.6)', () => {
    const content = JSON.stringify(
      { compilerOptions: { target: 'ES2022', strict: false } },
      null,
      2,
    );
    const record = buildTsconfigRecord('tsconfig.json', content);
    const findings = detectTsJsSafety([record]);
    const strictFinding = findings.find(
      (finding) => finding.kind === TS_JS_KINDS.tsconfigStrict,
    );

    it('reports a tsconfig-strict-disabled finding naming the `strict` setting', () => {
      expect(strictFinding).toBeDefined();
      expect(strictFinding?.path).toBe('tsconfig.json');
      expect(strictFinding?.detail).toContain('strict');
      // The finding is reported but not auto-fixable: the tsconfig is preserved.
      expect(strictFinding?.autoFixable).toBe(false);
    });

    it('leaves the tsconfig unchanged via the fixer (no edits, preserved)', () => {
      const outcome = fixTsJsSafety(strictFinding!, record);
      expect(outcome.edits).toEqual([]);
      expect(outcome.preserved).toBe(true);
      expect(outcome.preservationReason).toBeTruthy();
      // The record content is untouched by the pure fixer.
      expect(record.content).toBe(content);
    });
  });

  describe('strict-off: an individual strict-family flag disabled (Req 10.6)', () => {
    // `strict: true` is on, but a specific strict-family flag is turned off.
    const content = JSON.stringify(
      { compilerOptions: { strict: true, strictNullChecks: false } },
      null,
      2,
    );
    const record = buildTsconfigRecord('tsconfig.json', content);
    const findings = detectTsJsSafety([record]);
    const strictFinding = findings.find(
      (finding) => finding.kind === TS_JS_KINDS.tsconfigStrict,
    );

    it('names the specific disabled flag rather than `strict`', () => {
      expect(strictFinding).toBeDefined();
      expect(strictFinding?.detail).toContain('strictNullChecks');
    });

    it('leaves the tsconfig unchanged via the fixer', () => {
      const outcome = fixTsJsSafety(strictFinding!, record);
      expect(outcome.edits).toEqual([]);
      expect(outcome.preserved).toBe(true);
      expect(record.content).toBe(content);
    });
  });
});
