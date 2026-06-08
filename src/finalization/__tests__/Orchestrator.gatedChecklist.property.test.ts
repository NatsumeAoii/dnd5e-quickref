// Feature: pre-ship-finalization, Property 2: Checklist evaluation is gated on a fully-read inventory
//
// Validates: Requirements 1.3
//
// Property text: For any inventory containing at least one record that is
// unread, the orchestrator SHALL produce zero findings until every record is
// read or recorded as a read failure.
//
// A record is "unread" when its `content` is null AND its `readError` is null
// (it has been enumerated but neither read successfully nor recorded as a read
// failure). While any such pending record exists the inventory gate
// (Requirement 1.3) must stay closed: FinalizationOrchestrator.evaluateChecklist
// must run no detector and return zero findings, even when the supplied
// detectors would otherwise flag every file.
//
// Strategy: generate an inventory mixing read records, read-failure records, and
// at least one unread (pending) record. Run evaluateChecklist with a detector
// that would emit one finding per record. Assert the gate is reported closed and
// zero findings are produced. Then "resolve" every pending record (assign either
// content or a readError) and assert the gate opens and findings flow through,
// proving the zero-finding result was caused by gating rather than by an inert
// detector.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { FinalizationOrchestrator } from '../Orchestrator.js';
import type {
  Detector,
  FileRecord,
  Finding,
  SourceLanguage,
} from '../types.js';

/** The three resolution states a generated record can take. */
type RecordState = 'read' | 'read-failure' | 'unread';

/** Source languages used to give generated records a well-formed `language`. */
const LANGUAGES: readonly SourceLanguage[] = [
  'typescript',
  'javascript',
  'css',
  'html',
  'json',
  'markdown',
  'other',
];

/**
 * Build a well-formed FileRecord in the requested resolution state.
 *
 *  - `read`:         content present, no error (successfully read).
 *  - `read-failure`: content null, error present (recorded failure).
 *  - `unread`:       content null, error null (pending — keeps the gate closed).
 */
function makeRecord(
  index: number,
  language: SourceLanguage,
  state: RecordState,
): FileRecord {
  const path = `src/generated/file-${index}.${language}`;
  switch (state) {
    case 'read':
      return {
        path,
        content: `content of ${path}`,
        bytes: 16,
        readError: null,
        language,
      };
    case 'read-failure':
      return {
        path,
        content: null,
        bytes: 0,
        readError: 'EACCES: permission denied',
        language,
      };
    case 'unread':
      return {
        path,
        content: null,
        bytes: 0,
        readError: null,
        language,
      };
  }
}

/**
 * A detector that flags every record it is given. It produces one finding per
 * record so that, if the gate were open, evaluateChecklist would return a
 * non-empty list. Under a closed gate the orchestrator must never call this.
 */
const flagEveryRecordDetector: Detector = {
  domain: 'dead-code',
  detect(records: readonly FileRecord[]): readonly Finding[] {
    return records.map((record) => ({
      domain: 'dead-code' as const,
      path: record.path,
      location: { line: 1, column: 1 },
      kind: 'synthetic-finding',
      detail: `synthetic finding for ${record.path}`,
      autoFixable: true,
    }));
  },
}; 

/** Resolve a pending (unread) record by giving it content or a read failure. */
function resolveRecord(record: FileRecord, viaFailure: boolean): FileRecord {
  if (record.content !== null || record.readError !== null) {
    return record;
  }
  return viaFailure
    ? { ...record, readError: 'EACCES: permission denied' }
    : { ...record, content: `content of ${record.path}`, bytes: 16 };
}

/**
 * Generated record specification: a language, a resolution state, and (for the
 * resolve step) whether a pending record should be resolved via content or
 * failure.
 */
const recordSpecArbitrary = fc.record({
  language: fc.constantFrom(...LANGUAGES),
  state: fc.constantFrom<RecordState>('read', 'read-failure', 'unread'),
  resolveViaFailure: fc.boolean(),
});

/**
 * An inventory guaranteed to contain at least one unread record: a non-empty
 * list of arbitrary specs, with one spec forced to `unread` and spliced in at an
 * arbitrary position so the pending record is not always first.
 */
const inventoryWithUnreadArbitrary = fc
  .tuple(
    fc.array(recordSpecArbitrary, { minLength: 0, maxLength: 12 }),
    fc.boolean(),
    fc.nat(),
  )
  .map(([specs, forcedResolveViaFailure, insertAt]) => {
    const forcedUnread = {
      language: 'typescript' as SourceLanguage,
      state: 'unread' as RecordState,
      resolveViaFailure: forcedResolveViaFailure,
    };
    const position = specs.length === 0 ? 0 : insertAt % (specs.length + 1);
    const withForced = [
      ...specs.slice(0, position),
      forcedUnread,
      ...specs.slice(position),
    ];
    return withForced.map((spec, index) => ({
      record: makeRecord(index, spec.language, spec.state),
      resolveViaFailure: spec.resolveViaFailure,
    }));
  });

describe('FinalizationOrchestrator checklist gating on a fully-read inventory (Property 2)', () => {
  it('produces zero findings while any record is unread, and findings only after every record is resolved', () => {
    fc.assert(
      fc.property(inventoryWithUnreadArbitrary, (entries) => {
        const records = entries.map((entry) => entry.record);
        const orchestrator = new FinalizationOrchestrator();

        // Precondition: at least one unread (pending) record exists.
        const hasUnread = records.some(
          (record) => record.content === null && record.readError === null,
        );
        expect(hasUnread).toBe(true);

        // Gate must be closed and no findings produced while pending records exist.
        expect(orchestrator.isInventoryComplete(records)).toBe(false);
        const gatedFindings = orchestrator.evaluateChecklist(records, [
          flagEveryRecordDetector,
        ]);
        expect(gatedFindings).toEqual([]);

        // Resolve every pending record (read or record a read failure). The gate
        // must now open and the detector's findings must flow through, proving
        // the empty result above was due to gating, not an inert detector.
        const resolved = entries.map((entry) =>
          resolveRecord(entry.record, entry.resolveViaFailure),
        );
        expect(orchestrator.isInventoryComplete(resolved)).toBe(true);
        const openFindings = orchestrator.evaluateChecklist(resolved, [
          flagEveryRecordDetector,
        ]);
        expect(openFindings.length).toBe(resolved.length);
      }),
      { numRuns: 100 },
    );
  });

  it('keeps the gate closed for every detector count while a record stays unread', () => {
    fc.assert(
      fc.property(
        inventoryWithUnreadArbitrary,
        fc.integer({ min: 0, max: 5 }),
        (entries, detectorCount) => {
          const records = entries.map((entry) => entry.record);
          const orchestrator = new FinalizationOrchestrator();
          const detectors = Array.from(
            { length: detectorCount },
            () => flagEveryRecordDetector,
          );

          expect(orchestrator.isInventoryComplete(records)).toBe(false);
          expect(orchestrator.evaluateChecklist(records, detectors)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
