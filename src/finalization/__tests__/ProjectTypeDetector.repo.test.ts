// @vitest-environment node
//
// Feature: pre-ship-finalization, Task 3.4
//
// Unit test for project-type extraction from this repository's real files.
// Builds a FileRecord[] from the actual package.json, vite.config.ts,
// package-lock.json, and .github/workflows/deploy.yml, then asserts that
// detectProjectType reports the stack facts documented in the design.
//
// _Requirements: 2.2, 2.3, 2.4, 2.5_

// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { detectProjectType } from '../ProjectTypeDetector.js';
import type { FileRecord, SourceLanguage } from '../types.js';

/**
 * The four real repository files this test feeds to the detector. Each entry's
 * repo-relative POSIX path is what the detector matches against, and `language`
 * mirrors what the FileInventory derives from the file extension.
 */
const REPO_FILES: ReadonlyArray<{
  readonly path: string;
  readonly url: string;
  readonly language: SourceLanguage;
}> = [
  { path: 'package.json', url: '../../../package.json', language: 'json' },
  { path: 'vite.config.ts', url: '../../../vite.config.ts', language: 'typescript' },
  { path: 'package-lock.json', url: '../../../package-lock.json', language: 'json' },
  {
    path: '.github/workflows/deploy.yml',
    url: '../../../.github/workflows/deploy.yml',
    language: 'other',
  },
];

/** Read a real repository file into the shared FileRecord contract. */
function buildRecord(file: (typeof REPO_FILES)[number]): FileRecord {
  const fileUrl = new URL(file.url, import.meta.url);
  const content = readFileSync(fileUrl, 'utf8') as string;
  const bytes = (statSync(fileUrl) as { size: number }).size;
  return {
    path: file.path,
    content,
    bytes,
    readError: null,
    language: file.language,
  };
}

describe('detectProjectType over this repository (task 3.4)', () => {
  const records: readonly FileRecord[] = REPO_FILES.map(buildRecord);
  const projectType = detectProjectType(records);

  it('identifies npm as the package manager from the single lockfile (Req 2.3)', () => {
    expect(projectType.packageManager).toBe('npm');
  });

  it('identifies the Node >=22 environment from package.json engines (Req 2.2)', () => {
    expect(projectType.environment).toBe('Node >=22');
  });

  it('identifies Vite + tsc as the build tooling (Req 2.4)', () => {
    expect(projectType.buildTooling).toBe('Vite, tsc');
  });

  it('identifies GitHub Pages as the deployment target (Req 2.4)', () => {
    expect(projectType.deploymentTarget).toBe('GitHub Pages');
  });

  it('records the key configuration files present (Req 2.4)', () => {
    expect(projectType.keyConfigFiles).toEqual(['package.json', 'vite.config.ts']);
  });

  it('records the detected stack facts with no undetermined fields among them (Req 2.5)', () => {
    // None of the inputs above are absent or ambiguous, so every detection
    // result this test asserts must be determined rather than 'undetermined'.
    expect(projectType.packageManager).not.toBe('undetermined');
    expect(projectType.environment).not.toBe('undetermined');
    expect(projectType.buildTooling).not.toBe('undetermined');
    expect(projectType.deploymentTarget).not.toBe('undetermined');

    // The asserted fields are derived purely from real, present inputs; the only
    // expected note is the absence of an HTML entry, which is out of scope here.
    const assertedFieldNotes = projectType.notes.filter((note) =>
      /^(packageManager|environment|buildTooling|deploymentTarget):/.test(note),
    );
    expect(assertedFieldNotes).toEqual([]);
  });
});
