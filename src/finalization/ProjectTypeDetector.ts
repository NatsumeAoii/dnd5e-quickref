// Feature: pre-ship-finalization
//
// ProjectTypeDetector (pure analysis core).
//
// Derives the project's stack facts from the read file inventory so that the
// correct stack-specific checks can be applied later in the pass. This module
// performs no I/O: it operates only over the `FileRecord[]` produced by the
// FileInventory and returns a structured `ProjectType`.
//
// Detection rules (design "ProjectTypeDetector", Requirements 2.1-2.6):
//   - Primary languages: each source-file type whose share is >= 10% of the
//     total source-file count, listed in descending order of file count.
//   - Runtime, environment, package manager, build tooling, and deployment
//     target are derived from the contents of the relevant configuration files.
//   - When a required detection input is absent, or two or more distinct
//     dependency lockfiles are present, the affected field is marked
//     `'undetermined'` and the reason is recorded in `notes`; the pass
//     continues regardless.

import type { FileRecord, SourceLanguage } from './types.js';

/** Value used for any scalar detection field that cannot be determined. */
const UNDETERMINED = 'undetermined';

/** Minimum share (fraction of total source files) for a primary language. */
const PRIMARY_LANGUAGE_THRESHOLD = 0.1;

/**
 * The proportion of the source-file inventory occupied by a single language.
 * `count` is the absolute file count; `share` is `count / totalSourceFiles`
 * as a fraction in the range (0, 1].
 */
export interface LanguageShare {
  readonly language: SourceLanguage;
  readonly count: number;
  readonly share: number;
}

/**
 * The detected project stack. Scalar fields are `'undetermined'` when the
 * required input is absent or ambiguous; `notes` records the reason for every
 * such case (Requirement 2.6). Array fields are simply empty when nothing is
 * detected.
 */
export interface ProjectType {
  /** Source-file types with share >= 10%, descending by file count. */
  readonly primaryLanguages: readonly LanguageShare[];
  readonly runtime: string;
  readonly environment: string;
  readonly packageManager: string;
  readonly keyConfigFiles: readonly string[];
  readonly buildTooling: string;
  readonly deploymentTarget: string;
  /** Reasons for any `'undetermined'` result. */
  readonly notes: readonly string[];
}

/** Lockfile basename -> the package/dependency manager it identifies. */
const LOCKFILE_MANAGERS: ReadonlyMap<string, string> = new Map([
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
]);

/**
 * Recognized configuration-file basenames (exact match) and the regular
 * expressions for families with variable names (e.g. `tsconfig.app.json`).
 */
const EXACT_CONFIG_FILES: ReadonlySet<string> = new Set([
  'package.json',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  'eslint.config.cjs',
  'postcss.config.js',
  'postcss.config.mjs',
  'postcss.config.cjs',
  'tailwind.config.js',
  'tailwind.config.ts',
]);

const CONFIG_FILE_PATTERNS: readonly RegExp[] = [
  /^tsconfig(\..+)?\.json$/,
  /^vite\.config\.(ts|js|mjs|cjs|cts|mts)$/,
  /^vitest\.config\.(ts|js|mjs|cjs|cts|mts)$/,
  /^\.eslintrc(\..+)?$/,
  /^\.stylelintrc(\..+)?$/,
];

/**
 * Detect the project type from the read inventory. Pure: no I/O, deterministic
 * for a given input (ties broken by language name for stable ordering).
 */
export function detectProjectType(
  records: readonly FileRecord[],
): ProjectType {
  const notes: string[] = [];

  const primaryLanguages = detectPrimaryLanguages(records, notes);
  const packageJson = parsePackageJson(records, notes);
  const hasHtmlEntry = records.some((record) => record.language === 'html');

  const runtime = detectRuntime(packageJson, hasHtmlEntry, notes);
  const environment = detectEnvironment(packageJson, notes);
  const packageManager = detectPackageManager(records, notes);
  const keyConfigFiles = detectKeyConfigFiles(records);
  const buildTooling = detectBuildTooling(records, packageJson, notes);
  const deploymentTarget = detectDeploymentTarget(records, notes);

  return {
    primaryLanguages,
    runtime,
    environment,
    packageManager,
    keyConfigFiles,
    buildTooling,
    deploymentTarget,
    notes,
  };
}

/**
 * Compute the language shares and return those at or above the 10% threshold,
 * sorted by descending count then language name (Requirement 2.1).
 */
function detectPrimaryLanguages(
  records: readonly FileRecord[],
  notes: string[],
): readonly LanguageShare[] {
  const counts = new Map<SourceLanguage, number>();
  for (const record of records) {
    if (record.language === 'other') {
      continue;
    }
    counts.set(record.language, (counts.get(record.language) ?? 0) + 1);
  }

  const totalSourceFiles = [...counts.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  if (totalSourceFiles === 0) {
    notes.push(
      'primaryLanguages: no recognized source files were found in the inventory.',
    );
    return [];
  }

  return [...counts.entries()]
    .map(([language, count]) => ({
      language,
      count,
      share: count / totalSourceFiles,
    }))
    .filter((entry) => entry.share >= PRIMARY_LANGUAGE_THRESHOLD)
    .sort(
      (a, b) =>
        b.count - a.count || a.language.localeCompare(b.language),
    );
}

/**
 * The subset of `package.json` fields this detector reads. Parsed defensively
 * because the file may be malformed or absent.
 */
interface PackageJson {
  readonly engines?: Record<string, unknown>;
  readonly scripts?: Record<string, unknown>;
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
}

/** Parse the root `package.json`, recording a note when absent or malformed. */
function parsePackageJson(
  records: readonly FileRecord[],
  notes: string[],
): PackageJson | null {
  const record = records.find((entry) => entry.path === 'package.json');
  if (record === undefined || record.content === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(record.content);
    if (parsed === null || typeof parsed !== 'object') {
      notes.push('package.json: top-level value is not an object.');
      return null;
    }
    return parsed as PackageJson;
  } catch {
    notes.push('package.json: contents are not valid JSON.');
    return null;
  }
}

/**
 * Runtime is `'browser'` when an HTML entry is present (a browser SPA),
 * otherwise `'node'` when a `package.json` is present. Undetermined when
 * neither signal exists (Requirement 2.6).
 */
function detectRuntime(
  packageJson: PackageJson | null,
  hasHtmlEntry: boolean,
  notes: string[],
): string {
  if (hasHtmlEntry) {
    return 'browser';
  }
  if (packageJson !== null) {
    return 'node';
  }
  notes.push(
    'runtime: no HTML entry or package.json present to determine the runtime.',
  );
  return UNDETERMINED;
}

/**
 * Environment is derived from `package.json` `engines` (for example
 * `Node >=22`). Undetermined when `package.json` is absent or declares no
 * engine constraints (Requirement 2.6).
 */
function detectEnvironment(
  packageJson: PackageJson | null,
  notes: string[],
): string {
  if (packageJson === null) {
    notes.push('environment: package.json is absent or unreadable.');
    return UNDETERMINED;
  }
  const engines = packageJson.engines;
  if (engines === undefined || typeof engines !== 'object') {
    notes.push('environment: package.json declares no "engines" field.');
    return UNDETERMINED;
  }
  const entries = Object.entries(engines)
    .filter(([, value]) => typeof value === 'string')
    .map(([name, value]) => `${capitalize(name)} ${value as string}`);
  if (entries.length === 0) {
    notes.push('environment: "engines" field declares no string constraints.');
    return UNDETERMINED;
  }
  return entries.join(', ');
}

/**
 * Identify the package manager from the single dependency lockfile present.
 * Two or more distinct lockfiles, or no lockfile, yields `'undetermined'`
 * with a recorded reason (Requirements 2.3, 2.6).
 */
function detectPackageManager(
  records: readonly FileRecord[],
  notes: string[],
): string {
  const managers = new Set<string>();
  const lockfiles: string[] = [];
  for (const record of records) {
    const manager = LOCKFILE_MANAGERS.get(basename(record.path));
    if (manager !== undefined) {
      managers.add(manager);
      lockfiles.push(basename(record.path));
    }
  }

  if (managers.size === 0) {
    notes.push('packageManager: no dependency lockfile present.');
    return UNDETERMINED;
  }
  if (managers.size > 1) {
    notes.push(
      `packageManager: multiple distinct lockfiles present (${lockfiles
        .sort()
        .join(', ')}).`,
    );
    return UNDETERMINED;
  }
  return [...managers][0];
}

/** Collect the recognized configuration files present, sorted by path. */
function detectKeyConfigFiles(
  records: readonly FileRecord[],
): readonly string[] {
  const found = records
    .filter((record) => isConfigFile(basename(record.path)))
    .map((record) => record.path);
  return [...new Set(found)].sort();
}

/** True when a basename matches a known config file name or family pattern. */
function isConfigFile(name: string): boolean {
  if (EXACT_CONFIG_FILES.has(name)) {
    return true;
  }
  return CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Build tooling is derived from Vite config presence / dependencies and from a
 * `tsc` invocation in the build script. Undetermined when no signal is found
 * (Requirement 2.6).
 */
function detectBuildTooling(
  records: readonly FileRecord[],
  packageJson: PackageJson | null,
  notes: string[],
): string {
  const tools: string[] = [];

  const hasViteConfig = records.some((record) =>
    /^vite\.config\.(ts|js|mjs|cjs|cts|mts)$/.test(basename(record.path)),
  );
  const hasViteDep =
    hasDependency(packageJson, 'vite') ||
    hasDependency(packageJson, 'vite', 'dependencies');
  if (hasViteConfig || hasViteDep) {
    tools.push('Vite');
  }

  const buildScript = readScript(packageJson, 'build');
  if (buildScript !== null && /\btsc\b/.test(buildScript)) {
    tools.push('tsc');
  }

  if (tools.length === 0) {
    notes.push(
      'buildTooling: no recognized build tooling (Vite config/dependency or tsc build script) was found.',
    );
    return UNDETERMINED;
  }
  return tools.join(', ');
}

/**
 * Deployment target is detected from CI workflow files under
 * `.github/workflows/`. GitHub Pages is recognized from the Pages deploy
 * actions. Undetermined when no deployment configuration is found
 * (Requirement 2.6).
 */
function detectDeploymentTarget(
  records: readonly FileRecord[],
  notes: string[],
): string {
  const workflows = records.filter(
    (record) =>
      record.path.startsWith('.github/workflows/') &&
      record.content !== null,
  );
  for (const workflow of workflows) {
    const content = (workflow.content ?? '').toLowerCase();
    if (
      content.includes('deploy-pages') ||
      content.includes('upload-pages-artifact') ||
      content.includes('github pages')
    ) {
      return 'GitHub Pages';
    }
  }

  if (workflows.length === 0) {
    notes.push(
      'deploymentTarget: no CI workflow files present under .github/workflows/.',
    );
  } else {
    notes.push(
      'deploymentTarget: workflow files present but no recognized deployment target was identified.',
    );
  }
  return UNDETERMINED;
}

/** Read a named script string from `package.json`, or `null` if unavailable. */
function readScript(
  packageJson: PackageJson | null,
  name: string,
): string | null {
  const scripts = packageJson?.scripts;
  if (scripts === undefined || typeof scripts !== 'object') {
    return null;
  }
  const value = (scripts as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

/** True when a dependency is declared in the given section (default devDeps). */
function hasDependency(
  packageJson: PackageJson | null,
  name: string,
  section: 'dependencies' | 'devDependencies' = 'devDependencies',
): boolean {
  const deps = packageJson?.[section];
  if (deps === undefined || typeof deps !== 'object') {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(deps, name);
}

/** Extract the final path segment from a POSIX repo-relative path. */
function basename(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

/** Capitalize the first character of a non-empty string. */
function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}
