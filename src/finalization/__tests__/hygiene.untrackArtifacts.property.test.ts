// Feature: pre-ship-finalization, Property 27: Tracked artifacts are untracked while preserved on disk
//
// Property 27 (design "Correctness Properties"):
//   For any set of tracked files, every file that is a build artifact,
//   dependency directory, or secret SHALL be removed from version control with
//   the on-disk file preserved and the path recorded, and non-artifact files
//   SHALL remain tracked.
//
// **Validates: Requirements 7.4**
//
// This test exercises the hygiene detector/fixer pipeline in
// `src/finalization/detectors/hygiene.ts`:
//   - `classifyTrackedArtifact` classifies a path as build / dependency /
//     secret, or `null` for a legitimate file.
//   - `HygieneDetector.detect` raises a `tracked-artifact` finding for each
//     classified, scannable artifact.
//   - `HygieneFixer.fix` turns that finding into a single `untrack` edit, which
//     removes the path from version control while leaving the on-disk file
//     intact (an `untrack` edit, never a `delete`).
//
// The generators produce only *scannable* artifact paths (the detector skips
// dot-directories and the already-ignored `node_modules/` and `dist/` trees),
// so a classified artifact is guaranteed to surface as a detector finding.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  HygieneDetector,
  HygieneFixer,
  classifyTrackedArtifact,
} from '../detectors/hygiene';
import type { FileRecord } from '../types';

const TRACKED_ARTIFACT_KIND = 'tracked-artifact';

/** Build a minimal FileRecord; hygiene classification is path-driven only. */
function record(path: string): FileRecord {
  return {
    path,
    content: '',
    bytes: 0,
    readError: null,
    language: 'other',
  };
}

// ---------------------------------------------------------------------------
// Generators for each artifact category (scannable paths only)
// ---------------------------------------------------------------------------

const segment = fc.constantFrom('app', 'pkg', 'sub', 'a', 'feature', 'inner');
const fileStem = fc.constantFrom('index', 'main', 'bundle', 'data', 'chunk', 'output');

/** Optional nested sub-path inside an artifact directory. */
const nested = fc
  .array(segment, { maxLength: 2 })
  .map((parts) => (parts.length ? `${parts.join('/')}/` : ''));

/** Build-output artifacts: build/, out/, coverage/ trees and *.tsbuildinfo. */
const buildArtifact = fc.oneof(
  fc.tuple(fc.constantFrom('build', 'out', 'coverage'), nested, fileStem).map(
    ([dir, mid, stem]) => `${dir}/${mid}${stem}.js`,
  ),
  fc.tuple(nested, fc.constantFrom('tsconfig', 'app', 'project')).map(
    ([mid, stem]) => `${mid}${stem}.tsbuildinfo`,
  ),
);

/** Dependency directories (node_modules is excluded from scanning). */
const dependencyArtifact = fc
  .tuple(fc.constantFrom('vendor', 'bower_components', 'jspm_packages'), nested, fileStem)
  .map(([dir, mid, stem]) => `${dir}/${mid}${stem}.js`);

/** Secret files: env files and private-key / certificate material under a dir. */
const secretArtifact = fc.oneof(
  // .env / .env.* placed under a non-dot directory so the path is scannable.
  fc.tuple(segment, fc.constantFrom('.env', '.env.local', '.env.production')).map(
    ([dir, name]) => `${dir}/${name}`,
  ),
  // Private-key / certificate extensions (root-level non-dot names are scannable).
  fc.tuple(fc.option(segment, { nil: '' }), fileStem, fc.constantFrom('pem', 'key', 'p12', 'pfx', 'cer', 'crt')).map(
    ([dir, stem, ext]) => `${dir ? `${dir}/` : ''}${stem}.${ext}`,
  ),
  // Named keyfiles with no extension, under a directory.
  fc.tuple(segment, fc.constantFrom('id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519')).map(
    ([dir, name]) => `${dir}/${name}`,
  ),
);

const artifactCase = fc.oneof(
  buildArtifact.map((path) => ({ path, expected: 'build' as const })),
  dependencyArtifact.map((path) => ({ path, expected: 'dependency' as const })),
  secretArtifact.map((path) => ({ path, expected: 'secret' as const })),
);

/** Legitimate, non-artifact source files nested under safe directories. */
const nonArtifact = fc
  .tuple(
    fc.constantFrom('src', 'lib', 'app', 'styles', 'pages'),
    nested,
    fileStem,
    fc.constantFrom('ts', 'tsx', 'js', 'css', 'json'),
  )
  .map(([dir, mid, stem, ext]) => `${dir}/${mid}${stem}.${ext}`);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 27: Tracked artifacts are untracked while preserved on disk', () => {
  const detector = new HygieneDetector();
  const fixer = new HygieneFixer();

  it('classifies build / dependency / secret artifacts and yields an untrack edit (preserving on disk)', () => {
    fc.assert(
      fc.property(artifactCase, ({ path, expected }) => {
        // 1. Pure classification matches the expected category.
        expect(classifyTrackedArtifact(path)).toBe(expected);

        const records = [record(path)];
        const findings = detector.detect(records);

        // 2. The detector raises exactly one tracked-artifact finding for the path.
        const artifactFindings = findings.filter(
          (f) => f.path === path && f.kind === TRACKED_ARTIFACT_KIND,
        );
        expect(artifactFindings).toHaveLength(1);
        const finding = artifactFindings[0];
        expect(finding.domain).toBe('hygiene');
        expect(finding.autoFixable).toBe(true);

        // 3. The fixer untracks the file: a single `untrack` edit on the same
        //    path, never a `delete`, so the on-disk file is preserved.
        const outcome = fixer.fix(finding, records[0]);
        expect(outcome.preserved).toBe(false);
        expect(outcome.edits).toHaveLength(1);
        const edit = outcome.edits[0];
        expect(edit.kind).toBe('untrack');
        expect(edit.kind).not.toBe('delete');
        expect(edit.path).toBe(path);
      }),
      { numRuns: 200 },
    );
  });

  it('leaves non-artifact files classified as null with no tracked-artifact finding (remain tracked)', () => {
    fc.assert(
      fc.property(nonArtifact, (path) => {
        // Non-artifacts are not classified as removable.
        expect(classifyTrackedArtifact(path)).toBeNull();

        const findings = detector.detect([record(path)]);
        const artifactFindings = findings.filter(
          (f) => f.path === path && f.kind === TRACKED_ARTIFACT_KIND,
        );
        // No untrack action is produced, so the file remains tracked.
        expect(artifactFindings).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  it('untracks every classified artifact in a mixed tracked-file set while leaving non-artifacts tracked', () => {
    fc.assert(
      fc.property(
        fc.array(artifactCase, { minLength: 1, maxLength: 6 }),
        fc.array(nonArtifact, { maxLength: 6 }),
        (artifacts, nonArtifacts) => {
          // Deduplicate paths so each FileRecord path is unique.
          const seen = new Set<string>();
          const artifactPaths = artifacts
            .map((a) => a.path)
            .filter((p) => !seen.has(p) && (seen.add(p), true));
          const nonArtifactPaths = nonArtifacts.filter(
            (p) => !seen.has(p) && (seen.add(p), true),
          );

          const records = [...artifactPaths, ...nonArtifactPaths].map(record);
          const findings = detector.detect(records);

          const untracked = new Set(
            findings
              .filter((f) => f.kind === TRACKED_ARTIFACT_KIND)
              .map((f) => f.path),
          );

          // Every classified artifact is flagged and untracked on disk-preserving.
          for (const path of artifactPaths) {
            expect(untracked.has(path)).toBe(true);
            const finding = findings.find(
              (f) => f.path === path && f.kind === TRACKED_ARTIFACT_KIND,
            )!;
            const outcome = fixer.fix(finding, record(path));
            expect(outcome.edits).toHaveLength(1);
            expect(outcome.edits[0].kind).toBe('untrack');
          }

          // No non-artifact is untracked.
          for (const path of nonArtifactPaths) {
            expect(untracked.has(path)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
