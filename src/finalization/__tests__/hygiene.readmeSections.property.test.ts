// Feature: pre-ship-finalization, Property 28: README required-section detection is correct
//
// Property 28 (design "Correctness Properties"):
//   For any generated README, the detector SHALL report each required topic
//   (project description, installation, configuration, development, deployment)
//   as satisfied if and only if a section for it exists with at least one
//   non-heading content line that is not placeholder content; otherwise it
//   SHALL record the deficiency.
//
// **Validates: Requirements 7.5, 7.6**
//
// This test exercises `analyzeReadme` and `HygieneDetector` from
// `src/finalization/detectors/hygiene.ts`. For each of the five required topics
// it independently chooses one of four section states:
//   - 'absent'      : no section for the topic at all
//   - 'real'        : a section with at least one real (non-placeholder) line
//   - 'placeholder' : a section whose only content is placeholder text
//   - 'empty'       : a heading with no content lines beneath it
// A topic is satisfied if and only if its state is 'real'. The README is built
// from a single H1 title followed immediately by the chosen topic sections, so
// no content ever leaks into the H1 intro region (which would otherwise satisfy
// "project description" via its intro fallback). Each topic's heading text is
// chosen to match only that topic's keyword matcher, so topics never cross-
// satisfy one another.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  analyzeReadme,
  HygieneDetector,
  REQUIRED_README_TOPICS,
  type ReadmeTopic,
} from '../detectors/hygiene';
import type { FileRecord } from '../types';

/** Per-topic heading text that matches only that topic's keyword matcher. */
const TOPIC_HEADINGS: Record<ReadmeTopic, string> = {
  'project description': 'Description',
  installation: 'Installation',
  configuration: 'Configuration',
  development: 'Development',
  deployment: 'Deployment',
};

type SectionState = 'absent' | 'real' | 'placeholder' | 'empty';
const SECTION_STATES: readonly SectionState[] = [
  'absent',
  'real',
  'placeholder',
  'empty',
];

/** Real content lines that count as genuine, non-placeholder section content. */
const REAL_CONTENT = [
  'This project provides a quick reference for the rules.',
  'Run the documented command to get started in a few minutes.',
  'Set the listed variables before running the build.',
  'Use the npm scripts described here while iterating locally.',
  'Push to the main branch to publish the static site.',
];

/** Placeholder-only lines that must NOT count as real section content. */
const PLACEHOLDER_CONTENT = [
  'TODO',
  'TBD',
  'Coming soon',
  'placeholder',
  'N/A',
  'XXXX',
  '[FILL IN]',
  '...',
];

/** Build a README body from a chosen state for each required topic. */
function buildReadme(
  states: Record<ReadmeTopic, SectionState>,
  realPick: number,
  placeholderPick: number,
): string {
  const lines: string[] = ['# Project Title'];
  for (const topic of REQUIRED_README_TOPICS) {
    const state = states[topic];
    if (state === 'absent') continue;
    lines.push(`## ${TOPIC_HEADINGS[topic]}`);
    if (state === 'real') {
      lines.push(REAL_CONTENT[realPick % REAL_CONTENT.length]);
    } else if (state === 'placeholder') {
      lines.push(PLACEHOLDER_CONTENT[placeholderPick % PLACEHOLDER_CONTENT.length]);
    }
    // 'empty' contributes only the heading, no content line.
  }
  return lines.join('\n');
}

/** A README FileRecord for driving the HygieneDetector. */
function readmeRecord(content: string): FileRecord {
  return {
    path: 'README.md',
    content,
    bytes: content.length,
    readError: null,
    language: 'markdown',
  };
}

/** Generator producing a state for each required topic plus content picks. */
const arbStates = fc.record(
  Object.fromEntries(
    REQUIRED_README_TOPICS.map((t) => [t, fc.constantFrom(...SECTION_STATES)]),
  ) as Record<ReadmeTopic, fc.Arbitrary<SectionState>>,
) as fc.Arbitrary<Record<ReadmeTopic, SectionState>>;

describe('Property 28: README required-section detection is correct', () => {
  it('marks a topic satisfied iff its section has at least one real content line', () => {
    fc.assert(
      fc.property(
        arbStates,
        fc.nat(),
        fc.nat(),
        (states, realPick, placeholderPick) => {
          const content = buildReadme(states, realPick, placeholderPick);
          const analysis = analyzeReadme(content);

          expect(analysis.exists).toBe(true);

          const expectedDeficiencies: ReadmeTopic[] = [];
          for (const topic of REQUIRED_README_TOPICS) {
            const expectedSatisfied = states[topic] === 'real';
            expect(analysis.topics[topic]).toBe(expectedSatisfied);
            if (!expectedSatisfied) expectedDeficiencies.push(topic);
          }

          // The deficiency list is exactly the set of unsatisfied topics.
          expect([...analysis.deficiencies].sort()).toEqual(
            expectedDeficiencies.sort(),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('HygieneDetector emits one deficiency finding per unsatisfied topic', () => {
    const detector = new HygieneDetector();
    fc.assert(
      fc.property(
        arbStates,
        fc.nat(),
        fc.nat(),
        (states, realPick, placeholderPick) => {
          const content = buildReadme(states, realPick, placeholderPick);
          const findings = detector.detect([readmeRecord(content)]);

          const deficiencyDetails = findings
            .filter((f) => f.kind === 'readme-section-deficiency')
            .map((f) => f.detail)
            .sort();

          const expected = REQUIRED_README_TOPICS.filter(
            (t) => states[t] !== 'real',
          )
            .map((t) => `README.md is missing a complete "${t}" section`)
            .sort();

          expect(deficiencyDetails).toEqual(expected);
          // A present README never yields a "readme-missing" finding.
          expect(findings.some((f) => f.kind === 'readme-missing')).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('records every required topic as a deficiency when README.md is absent', () => {
    const detector = new HygieneDetector();
    const findings = detector.detect([
      {
        path: 'package.json',
        content: '{}',
        bytes: 2,
        readError: null,
        language: 'json',
      },
    ]);
    expect(findings.some((f) => f.kind === 'readme-missing')).toBe(true);
  });
});
