// Feature: pre-ship-finalization
//
// ConfigCorrectnessDetector / Fixer (design "ConfigCorrectnessDetector / Fixer",
// Requirement 12).
//
// Pure analysis of key configuration files. This module performs NO I/O: every
// function operates over `FileRecord[]` (or raw strings already read by the
// FileInventory) and returns structured `Finding`/`FixOutcome` values. The
// orchestrator and EditApplier (later tasks) are the only components that touch
// disk.
//
// Responsibilities:
//   - Verify required `package.json` fields are present and non-empty (12.1).
//   - Verify the bundler `outDir`, the `.gitignore` build-output exclusion, and
//     the deploy directory all resolve to the same directory (12.2); record
//     conflicting paths WITHOUT auto-editing them (12.6).
//   - Verify the environment template documents every env var key the project
//     reads (12.3).
//   - Add missing `package.json` fields with `[FILL IN]` while preserving every
//     existing value (12.5).

import {
  FILL_IN_PLACEHOLDER,
  type Detector,
  type Edit,
  type FileRecord,
  type Finding,
  type FixOutcome,
  type Fixer,
} from '../types';

/**
 * The `package.json` fields that must be present and non-empty for a shippable
 * project (Requirement 12.1).
 */
export const REQUIRED_PACKAGE_FIELDS = [
  'name',
  'version',
  'description',
  'license',
  'repository',
] as const;

export type RequiredPackageField = (typeof REQUIRED_PACKAGE_FIELDS)[number];

/**
 * Vite injects these `import.meta.env` keys at build time regardless of any
 * `.env` file, so reading them never requires an environment-template entry.
 * See https://vitejs.dev/guide/env-and-mode (content rephrased for compliance).
 */
const VITE_BUILTIN_ENV_KEYS: ReadonlySet<string> = new Set([
  'MODE',
  'BASE_URL',
  'PROD',
  'DEV',
  'SSR',
  'LEGACY',
]);

/** Finding kinds emitted by this detector. */
export const CONFIG_FINDING_KINDS = {
  missingPackageField: 'missing-package-field',
  outputDirMismatch: 'output-dir-mismatch',
  envTemplateMissingKey: 'env-template-missing-key',
} as const;

// ---------------------------------------------------------------------------
// package.json field verification (Requirement 12.1)
// ---------------------------------------------------------------------------

/** The verification result for a single required `package.json` field. */
export interface PackageFieldResult {
  readonly field: RequiredPackageField;
  readonly present: boolean;
}

/**
 * Parse `package.json` content and report, for each required field, whether it
 * is present with a non-empty value.
 *
 * A field is "present" only when it holds a non-empty value:
 *   - strings must be non-empty after trimming,
 *   - the `repository` object must carry a non-empty `url`,
 *   - the `license` object (SPDX expression form) must carry a non-empty `type`.
 *
 * Returns an empty array when the content is not parseable as a JSON object, so
 * the caller can treat an unreadable manifest as "all fields missing".
 */
export function verifyPackageJsonFields(
  content: string,
): readonly PackageFieldResult[] {
  const parsed = safeParseObject(content);
  return REQUIRED_PACKAGE_FIELDS.map((field) => ({
    field,
    present: parsed !== null && isFieldPopulated(parsed[field]),
  }));
}

function isFieldPopulated(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // repository: { type, url } — require a non-empty url.
    if (typeof record.url === 'string') {
      return record.url.trim().length > 0;
    }
    // license: { type, url } — require a non-empty type.
    if (typeof record.type === 'string') {
      return record.type.trim().length > 0;
    }
    return Object.keys(record).length > 0;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Output-directory triple match (Requirements 12.2, 12.6)
// ---------------------------------------------------------------------------

/** The three directory references that must resolve to the same directory. */
export interface OutputDirSources {
  /** Bundler `build.outDir`, or `null` when not declared. */
  readonly bundlerOutDir: string | null;
  /** `.gitignore` build-output exclusion, or `null` when absent. */
  readonly gitignoreExclusion: string | null;
  /** Deploy-config artifact directory, or `null` when absent. */
  readonly deployDir: string | null;
}

/** The result of comparing the three output-directory references. */
export interface OutputDirComparison extends OutputDirSources {
  /**
   * True only when all three sources are present and normalize to the same
   * directory. A `null` source makes the triple incomplete and therefore a
   * mismatch (Requirement 12.2 requires all three to match).
   */
  readonly allMatch: boolean;
  /** Distinct normalized directory names observed across present sources. */
  readonly normalized: readonly string[];
}

/**
 * Normalize a directory reference to a comparable canonical form by stripping a
 * leading `./`, leading/trailing slashes, and surrounding whitespace.
 * `dist`, `/dist/`, and `./dist` all normalize to `dist`.
 */
export function normalizeDirPath(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('./')) {
    value = value.slice(2);
  }
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Extract `build.outDir` from a Vite config file's content. */
export function extractBundlerOutDir(viteConfigContent: string): string | null {
  const match = viteConfigContent.match(/outDir\s*:\s*['"`]([^'"`]+)['"`]/);
  return match ? match[1] : null;
}

/**
 * Extract the build-output directory exclusion from `.gitignore`. Looks for the
 * first rule that targets a recognized build-output directory (`dist`, `build`,
 * or `out`) so that incidental ignores (deps, logs) are not mistaken for it.
 */
export function extractGitignoreBuildExclusion(
  gitignoreContent: string,
): string | null {
  const buildDirNames = new Set(['dist', 'build', 'out']);
  for (const rawLine of gitignoreContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    if (buildDirNames.has(normalizeDirPath(line))) {
      return line;
    }
  }
  return null;
}

/**
 * Extract the deploy artifact directory from a GitHub Actions workflow that
 * uploads a Pages artifact (`path: ./dist`).
 */
export function extractDeployDir(workflowContent: string): string | null {
  const match = workflowContent.match(/^\s*path\s*:\s*['"]?([^\s'"#]+)['"]?/m);
  return match ? match[1] : null;
}

/** Compare the three output-directory references (Requirement 12.2). */
export function compareOutputDirs(
  sources: OutputDirSources,
): OutputDirComparison {
  const present = [
    sources.bundlerOutDir,
    sources.gitignoreExclusion,
    sources.deployDir,
  ].filter((value): value is string => value !== null);

  const normalized = [...new Set(present.map(normalizeDirPath))];

  const allPresent =
    sources.bundlerOutDir !== null &&
    sources.gitignoreExclusion !== null &&
    sources.deployDir !== null;

  return {
    ...sources,
    allMatch: allPresent && normalized.length === 1,
    normalized,
  };
}

// ---------------------------------------------------------------------------
// Environment-template completeness (Requirement 12.3)
// ---------------------------------------------------------------------------

/**
 * Collect every environment-variable key the project reads through
 * `import.meta.env.<KEY>` or `process.env.<KEY>`, excluding Vite's build-time
 * built-ins. Only TypeScript and JavaScript records are scanned.
 */
export function extractEnvKeysRead(
  records: readonly FileRecord[],
): readonly string[] {
  const pattern =
    /(?:import\.meta\.env|process\.env)\.([A-Za-z_][A-Za-z0-9_]*)/g;
  const keys = new Set<string>();

  for (const record of records) {
    if (record.content === null) {
      continue;
    }
    if (record.language !== 'typescript' && record.language !== 'javascript') {
      continue;
    }
    for (const match of record.content.matchAll(pattern)) {
      const key = match[1];
      if (!VITE_BUILTIN_ENV_KEYS.has(key)) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}

/** Parse the documented keys from an environment-template file's content. */
export function extractEnvTemplateKeys(
  templateContent: string,
): readonly string[] {
  const keys = new Set<string>();
  for (const rawLine of templateContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) {
      keys.add(match[1]);
    }
  }
  return [...keys];
}

/** A record whose path matches a recognized environment-template filename. */
export function findEnvTemplateRecord(
  records: readonly FileRecord[],
): FileRecord | null {
  const isTemplate = (path: string): boolean => {
    const base = path.split('/').pop() ?? path;
    return (
      base === '.env.example' ||
      base === '.env.template' ||
      base === '.env.sample' ||
      /^\.env\..+\.example$/.test(base)
    );
  };
  return records.find((record) => isTemplate(record.path)) ?? null;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

function findRecord(
  records: readonly FileRecord[],
  predicate: (record: FileRecord) => boolean,
): FileRecord | null {
  return records.find(predicate) ?? null;
}

function byBasename(name: string): (record: FileRecord) => boolean {
  return (record) => (record.path.split('/').pop() ?? record.path) === name;
}

/**
 * Detects configuration-correctness defects across the key configuration files.
 * Pure: returns findings without performing any I/O.
 */
export const configDetector: Detector = {
  domain: 'config',

  detect(records: readonly FileRecord[]): readonly Finding[] {
    const findings: Finding[] = [];

    findings.push(...detectMissingPackageFields(records));
    findings.push(...detectOutputDirMismatch(records));
    findings.push(...detectEnvTemplateGaps(records));

    return findings;
  },
};

function detectMissingPackageFields(
  records: readonly FileRecord[],
): readonly Finding[] {
  const pkg = findRecord(records, byBasename('package.json'));
  if (pkg === null || pkg.content === null) {
    return [];
  }

  const results = verifyPackageJsonFields(pkg.content);
  return results
    .filter((result) => !result.present)
    .map((result) => ({
      domain: 'config' as const,
      path: pkg.path,
      location: {},
      kind: CONFIG_FINDING_KINDS.missingPackageField,
      detail: `package.json is missing a non-empty "${result.field}" field`,
      autoFixable: true,
    }));
}

function detectOutputDirMismatch(
  records: readonly FileRecord[],
): readonly Finding[] {
  const vite = findRecord(
    records,
    (record) =>
      record.path === 'vite.config.ts' || record.path === 'vite.config.js',
  );
  const gitignore = findRecord(records, byBasename('.gitignore'));
  const workflow = findRecord(
    records,
    (record) =>
      record.path.startsWith('.github/workflows/') &&
      (record.path.endsWith('.yml') || record.path.endsWith('.yaml')),
  );

  // Without a bundler config there is no authoritative output directory to
  // compare against; skip rather than emit an unfounded finding (Req 1.5).
  if (vite === null || vite.content === null) {
    return [];
  }

  const comparison = compareOutputDirs({
    bundlerOutDir: extractBundlerOutDir(vite.content),
    gitignoreExclusion:
      gitignore?.content != null
        ? extractGitignoreBuildExclusion(gitignore.content)
        : null,
    deployDir:
      workflow?.content != null ? extractDeployDir(workflow.content) : null,
  });

  if (comparison.allMatch) {
    return [];
  }

  const conflicting = [
    `bundler outDir=${formatSource(comparison.bundlerOutDir)}`,
    `.gitignore exclusion=${formatSource(comparison.gitignoreExclusion)}`,
    `deploy dir=${formatSource(comparison.deployDir)}`,
  ].join(', ');

  // Reported against the bundler config but NOT auto-edited (Requirement 12.6).
  return [
    {
      domain: 'config',
      path: vite.path,
      location: {},
      kind: CONFIG_FINDING_KINDS.outputDirMismatch,
      detail: `Output directory references do not all match: ${conflicting}`,
      autoFixable: false,
    },
  ];
}

function formatSource(value: string | null): string {
  return value === null ? '(absent)' : value;
}

function detectEnvTemplateGaps(
  records: readonly FileRecord[],
): readonly Finding[] {
  const keysRead = extractEnvKeysRead(records);
  if (keysRead.length === 0) {
    return [];
  }

  const template = findEnvTemplateRecord(records);
  const documented = new Set(
    template?.content != null ? extractEnvTemplateKeys(template.content) : [],
  );

  // When no template exists, every read key is undocumented; report against the
  // template path it should live in.
  const templatePath = template?.path ?? '.env.example';

  return keysRead
    .filter((key) => !documented.has(key))
    .map((key) => ({
      domain: 'config' as const,
      path: templatePath,
      location: {},
      kind: CONFIG_FINDING_KINDS.envTemplateMissingKey,
      detail: `Environment template is missing a documented entry for "${key}"`,
      autoFixable: true,
    }));
}

// ---------------------------------------------------------------------------
// Fixer
// ---------------------------------------------------------------------------

/**
 * Insert the given missing fields into `package.json` content with a
 * `[FILL IN]` placeholder value, preserving every existing byte. Fields are
 * appended just before the final closing brace. Returns the original content
 * unchanged when it is not a parseable JSON object or has no closing brace.
 */
export function addMissingPackageFields(
  content: string,
  missingFields: readonly RequiredPackageField[],
): string {
  if (missingFields.length === 0 || safeParseObject(content) === null) {
    return content;
  }

  const closeIndex = content.lastIndexOf('}');
  if (closeIndex === -1) {
    return content;
  }

  const head = content.slice(0, closeIndex);
  const tail = content.slice(closeIndex);

  const indent = detectIndent(content);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';

  const additions = missingFields
    .map((field) => `${indent}"${field}": "${FILL_IN_PLACEHOLDER}"`)
    .join(`,${newline}`);

  // Determine whether the object already has at least one property so we know
  // if a separating comma is required before the additions.
  const trimmedHead = head.replace(/\s+$/, '');
  const hasExistingProperty = !trimmedHead.endsWith('{');
  const separator = hasExistingProperty ? `,${newline}` : newline;

  const trailingWhitespace = head.slice(trimmedHead.length);
  const closingIndent = trailingWhitespace.includes('\n')
    ? trailingWhitespace.slice(trailingWhitespace.lastIndexOf('\n') + 1)
    : '';

  return `${trimmedHead}${separator}${additions}${newline}${closingIndent}${tail}`;
}

function detectIndent(content: string): string {
  const match = content.match(/\n([ \t]+)"/);
  return match ? match[1] : '  ';
}

/**
 * Fixes configuration-correctness findings.
 *   - missing-package-field: adds the field with `[FILL IN]`, preserving values.
 *   - output-dir-mismatch: preserved without auto-editing (Requirement 12.6).
 *   - env-template-missing-key: adds a documented (non-secret) template entry.
 */
export const configFixer: Fixer = {
  domain: 'config',

  fix(finding: Finding, record: FileRecord): FixOutcome {
    switch (finding.kind) {
      case CONFIG_FINDING_KINDS.missingPackageField:
        return fixMissingPackageField(finding, record);
      case CONFIG_FINDING_KINDS.outputDirMismatch:
        return preserveOutputDirMismatch(finding);
      case CONFIG_FINDING_KINDS.envTemplateMissingKey:
        return fixEnvTemplateKey(finding, record);
      default:
        return { edits: [], preserved: true, preservationReason: 'unknown finding kind' };
    }
  },
};

function fixMissingPackageField(
  finding: Finding,
  record: FileRecord,
): FixOutcome {
  if (record.content === null) {
    return {
      edits: [],
      preserved: true,
      preservationReason: 'package.json could not be read',
    };
  }

  const field = extractFieldName(finding.detail);
  if (field === null) {
    return {
      edits: [],
      preserved: true,
      preservationReason: 'could not determine missing field name',
    };
  }

  const updated = addMissingPackageFields(record.content, [field]);
  if (updated === record.content) {
    return {
      edits: [],
      preserved: true,
      preservationReason: 'package.json is not editable JSON object content',
    };
  }

  const edit: Edit = {
    kind: 'replace',
    path: record.path,
    text: updated,
    placeholderInserted: true,
  };
  return { edits: [edit], preserved: false };
}

function extractFieldName(detail: string): RequiredPackageField | null {
  const match = detail.match(/"([^"]+)"/);
  if (match === null) {
    return null;
  }
  const candidate = match[1];
  return (REQUIRED_PACKAGE_FIELDS as readonly string[]).includes(candidate)
    ? (candidate as RequiredPackageField)
    : null;
}

function preserveOutputDirMismatch(finding: Finding): FixOutcome {
  // Requirement 12.6: record the conflicting paths but never auto-edit them.
  return {
    edits: [],
    preserved: true,
    preservationReason: `Output-directory paths conflict and require manual reconciliation: ${finding.detail}`,
  };
}

function fixEnvTemplateKey(finding: Finding, record: FileRecord): FixOutcome {
  const key = extractEnvKeyFromDetail(finding.detail);
  if (key === null) {
    return {
      edits: [],
      preserved: true,
      preservationReason: 'could not determine missing env key',
    };
  }

  const templateExists = record.content !== null && record.path === finding.path;
  const entry = `# ${key}: document this environment variable.${'\n'}${key}=`;

  if (templateExists) {
    const base = record.content ?? '';
    const separator = base.length > 0 && !base.endsWith('\n') ? '\n' : '';
    const edit: Edit = {
      kind: 'replace',
      path: record.path,
      text: `${base}${separator}${entry}\n`,
      placeholderInserted: false,
    };
    return { edits: [edit], preserved: false };
  }

  // No template file yet — create one carrying the documented key.
  const edit: Edit = {
    kind: 'create',
    path: finding.path,
    text: `${entry}\n`,
    placeholderInserted: false,
  };
  return { edits: [edit], preserved: false };
}

function extractEnvKeyFromDetail(detail: string): string | null {
  const match = detail.match(/"([^"]+)"/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Parse JSON content, returning the object on success or `null` otherwise. */
function safeParseObject(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
