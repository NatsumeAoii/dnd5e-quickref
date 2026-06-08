// Feature: pre-ship-finalization
//
// HygieneDetector / Fixer (Requirement 7).
//
// Pure analysis core for repository hygiene. The detector reads the in-memory
// inventory (FileRecord[]) and reports findings; the fixer turns a single
// finding into behavior-preserving Edits. Neither performs any I/O — only
// FileInventory and EditApplier touch disk (see design "Architecture").
//
// Coverage:
//   - 7.1  .gitignore covers build output, deps, env/secrets, OS metadata, logs
//   - 7.2  negation rules protect must-track files
//   - 7.3  explicit, idempotent rules for dev/ temp/ tmp/ scratch/
//   - 7.4  tracked build artifacts / deps / secrets are untracked, kept on disk
//   - 7.5/7.6 README required sections are validated; deficiencies recorded
//   - 7.7/7.8 loose files are relocated (with reference updates) or removed

import type {
  CodeLocation,
  Detector,
  Edit,
  FileRecord,
  Finding,
  Fixer,
  FixOutcome,
} from '../types';

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** The four transient working directories that must have explicit rules (7.3). */
export const TRANSIENT_DIRS = ['dev/', 'temp/', 'tmp/', 'scratch/'] as const;
export type TransientDir = (typeof TRANSIENT_DIRS)[number];

/**
 * Coverage state derived from a `.gitignore` file (design "Repository hygiene
 * model"). A category is covered iff at least one non-negation rule matches it.
 */
export interface GitignoreState {
  readonly hasBuildOutput: boolean;
  readonly hasDependencies: boolean;
  readonly hasEnvSecrets: boolean;
  readonly hasOsMetadata: boolean;
  readonly hasLogs: boolean;
  readonly transientDirs: Record<TransientDir, boolean>;
  readonly negationRules: readonly string[];
}

/** A single parsed `.gitignore` line that carries semantic flags. */
export interface GitignoreRule {
  /** Original trimmed line including any leading `!`. */
  readonly raw: string;
  /** Pattern with leading `!` and leading `/` stripped, trailing `/` stripped. */
  readonly pattern: string;
  readonly negated: boolean;
  readonly dirOnly: boolean;
  readonly anchored: boolean;
}

/** The README topics required by Requirement 7.5. */
export const REQUIRED_README_TOPICS = [
  'project description',
  'installation',
  'configuration',
  'development',
  'deployment',
] as const;
export type ReadmeTopic = (typeof REQUIRED_README_TOPICS)[number];

/** Result of validating a README against the required topics. */
export interface ReadmeAnalysis {
  readonly exists: boolean;
  /** Topic -> satisfied (section present with real, non-placeholder content). */
  readonly topics: Record<ReadmeTopic, boolean>;
  /** Topics that are missing, empty, or placeholder-only. */
  readonly deficiencies: readonly ReadmeTopic[];
}

// ---------------------------------------------------------------------------
// Path classification helpers (pure)
// ---------------------------------------------------------------------------

const GITIGNORE_PATH = '.gitignore';
const README_PATH = 'README.md';

/** Basenames that are OS metadata noise. */
const OS_METADATA_FILES = new Set([
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
  'ehthumbs.db',
]);

/** Directory names that, when ignored, satisfy the build-output category. */
const BUILD_OUTPUT_DIRS = new Set(['dist', 'build', 'out', '.output', '.vite']);

/** Directory names that satisfy the dependencies category. */
const DEPENDENCY_DIRS = new Set([
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
]);

/** Extensions that mark a private-key / certificate secret file. */
const SECRET_EXTENSIONS = new Set([
  'pem',
  'key',
  'p12',
  'pfx',
  'cer',
  'crt',
  'der',
]);

/** Named private-key files with no extension. */
const SECRET_NAMES = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);

/** Root files that legitimately live at the repository root. */
const ROOT_ALLOWLIST = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'index.html',
  '.gitignore',
  '.gitattributes',
  '.npmrc',
  '.nvmrc',
  '.editorconfig',
  '.prettierrc',
  '.prettierignore',
]);

/** Lower-cased basename of a POSIX path. */
function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** First path segment (used to skip tooling / dot directories). */
function firstSegment(path: string): string {
  const idx = path.indexOf('/');
  return idx >= 0 ? path.slice(0, idx) : path;
}

/**
 * Whether hygiene should scan this path for artifacts / loose files. Tooling and
 * dot-directories (`.git`, `.github`, `.kiro`, `.vscode`, `.worktrees`) plus the
 * ignored `node_modules`/`dist` trees are out of scope for hygiene rewrites.
 */
function isScannablePath(path: string): boolean {
  const seg = firstSegment(path);
  if (seg.startsWith('.')) return false;
  return seg !== 'node_modules' && seg !== 'dist';
}

/** True when the file is a disposable transient artifact (7.8). */
export function isTransientArtifact(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (OS_METADATA_FILES.has(name)) return true;
  return /\.(log|tmp|temp|bak|backup|swp|swo|orig)$/.test(name);
}

/**
 * Classify a tracked file that should be untracked while preserved on disk
 * (7.4): build output, dependency directory, or secret. Returns `null` when the
 * file is a legitimate tracked file.
 */
export function classifyTrackedArtifact(
  path: string,
): 'build' | 'dependency' | 'secret' | null {
  const segments = path.split('/');
  if (segments.some((s) => DEPENDENCY_DIRS.has(s))) return 'dependency';
  if (segments.some((s) => BUILD_OUTPUT_DIRS.has(s) || s === 'coverage')) {
    return 'build';
  }
  if (/\.tsbuildinfo$/.test(path)) return 'build';
  if (isSecretFile(basename(path))) return 'secret';
  return null;
}

/** True when a basename denotes a secret file but not an example template. */
function isSecretFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.example') || lower.endsWith('.sample')) return false;
  if (lower === '.env') return true;
  if (/^\.env\..+/.test(lower)) return true;
  if (SECRET_NAMES.has(lower)) return true;
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  return SECRET_EXTENSIONS.has(ext);
}

/** True when a file must always be tracked even though a glob may ignore it. */
function isMustTrackFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return (
    name.endsWith('.example') ||
    name.endsWith('.sample') ||
    name.endsWith('.template') ||
    name === '.gitkeep' ||
    name === '.gitattributes'
  );
}

/**
 * Designated location for a clearly-misplaced root source file, or `null` when
 * no safe designated location can be derived (recorded as a deficiency instead).
 */
export function designatedLocation(path: string): string | null {
  if (path.includes('/')) return null; // only relocate root-level loose files
  const name = basename(path);
  if (ROOT_ALLOWLIST.has(name)) return null;
  if (name.startsWith('.')) return null; // dotfiles belong at root
  if (name.endsWith('.md')) return null; // docs belong at root
  if (/\.config\.(ts|js|mjs|cjs|json)$/.test(name)) return null;
  if (/^tsconfig.*\.json$/.test(name)) return null;
  if (/\.css$/.test(name)) return `src/css/${name}`;
  if (/\.(test|spec)\.(ts|js)$/.test(name)) return `src/__tests__/${name}`;
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) return `src/${name}`;
  return null;
}

// ---------------------------------------------------------------------------
// .gitignore parsing and coverage detection (pure)
// ---------------------------------------------------------------------------

/** Parse a `.gitignore` body into ordered, semantically-tagged rules. */
export function parseGitignoreRules(content: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    let body = negated ? line.slice(1) : line;
    const dirOnly = body.endsWith('/');
    if (dirOnly) body = body.slice(0, -1);
    const anchored = body.startsWith('/') || body.replace(/\/$/, '').includes('/');
    if (body.startsWith('/')) body = body.slice(1);
    rules.push({ raw: line, pattern: body, negated, dirOnly, anchored });
  }
  return rules;
}

/** Normalize a rule's core token for category comparison. */
function coreToken(rule: GitignoreRule): string {
  return rule.pattern.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Derive category coverage and transient-dir presence from a `.gitignore`. */
export function detectGitignoreState(content: string): GitignoreState {
  const rules = parseGitignoreRules(content);
  const positive = rules.filter((r) => !r.negated);

  const hasBuildOutput = positive.some((r) => BUILD_OUTPUT_DIRS.has(coreToken(r)));
  const hasDependencies = positive.some((r) =>
    DEPENDENCY_DIRS.has(coreToken(r)),
  );
  const hasEnvSecrets = positive.some((r) => isEnvOrSecretRule(r.pattern));
  const hasOsMetadata = positive.some((r) =>
    OS_METADATA_FILES.has(coreToken(r).toLowerCase()),
  );
  const hasLogs = positive.some(
    (r) => r.pattern === '*.log' || r.pattern.endsWith('.log'),
  );

  const transientDirs = {} as Record<TransientDir, boolean>;
  for (const dir of TRANSIENT_DIRS) {
    const token = dir.replace(/\/$/, '');
    transientDirs[dir] = positive.some((r) => coreToken(r) === token);
  }

  return {
    hasBuildOutput,
    hasDependencies,
    hasEnvSecrets,
    hasOsMetadata,
    hasLogs,
    transientDirs,
    negationRules: rules.filter((r) => r.negated).map((r) => r.raw),
  };
}

/** Whether a pattern covers the env/secret category. */
function isEnvOrSecretRule(pattern: string): boolean {
  if (/^\.env(\..+)?$/.test(pattern)) return true;
  const ext = pattern.startsWith('*.') ? pattern.slice(2) : '';
  return SECRET_EXTENSIONS.has(ext) || SECRET_NAMES.has(pattern.toLowerCase());
}

/** Convert a single gitignore rule to a RegExp anchored per gitignore rules. */
function ruleToRegExp(rule: GitignoreRule): RegExp {
  // Private-use-area sentinel for ** (never appears in a gitignore pattern and,
  // unlike a NUL byte, is not a control character — avoids no-control-regex).
  const globstarSentinel = '\uE000';
  const escaped = rule.pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, globstarSentinel) // placeholder for **
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replaceAll(globstarSentinel, '.*');
  const prefix = rule.anchored ? '^' : '(?:^|/)';
  // A pattern matches the entry itself and, for directories, everything beneath.
  const suffix = '(?:/.*)?$';
  return new RegExp(`${prefix}${escaped}${suffix}`);
}

/**
 * Resolve whether `path` is ignored by the ordered rule set. gitignore "last
 * matching pattern wins" semantics are honored, so a later negation re-tracks.
 */
export function isPathIgnored(
  path: string,
  rules: readonly GitignoreRule[],
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (ruleToRegExp(rule).test(path)) ignored = !rule.negated;
  }
  return ignored;
}

// ---------------------------------------------------------------------------
// .gitignore append builder (pure, idempotent)
// ---------------------------------------------------------------------------

interface GitignoreAppend {
  /** Text to append at end-of-file (empty when nothing is missing). */
  readonly appendedText: string;
  readonly addedRules: readonly string[];
}

/** Existing rule lines (trimmed) for duplicate detection. */
function existingLines(content: string): Set<string> {
  return new Set(content.split(/\r?\n/).map((l) => l.trim()));
}

/**
 * Build the text needed to append `rules` (and an optional section `header`)
 * to a `.gitignore`, skipping any rule already present. Returns empty text when
 * every rule is already present, which makes repeated application a no-op.
 */
export function buildGitignoreAppend(
  content: string,
  header: string | null,
  rules: readonly string[],
): GitignoreAppend {
  const existing = existingLines(content);
  const missing = rules.filter((r) => !existing.has(r.trim()));
  if (missing.length === 0) return { appendedText: '', addedRules: [] };

  const lines: string[] = [];
  if (header && !existing.has(header.trim())) lines.push(header);
  lines.push(...missing);

  const needsNewline = content.length > 0 && !content.endsWith('\n');
  const appendedText = `${needsNewline ? '\n' : ''}${lines.join('\n')}\n`;
  return { appendedText, addedRules: missing };
}

/**
 * Idempotently ensure all four transient directory rules exist. Exposed for
 * direct property testing of the idempotence invariant (design Property 26).
 */
export function ensureTransientDirRules(content: string): {
  content: string;
  added: readonly string[];
} {
  const { appendedText, addedRules } = buildGitignoreAppend(
    content,
    '# Transient working directories',
    [...TRANSIENT_DIRS],
  );
  return { content: content + appendedText, added: addedRules };
}

// ---------------------------------------------------------------------------
// README analysis (pure)
// ---------------------------------------------------------------------------

interface TopicMatcher {
  readonly topic: ReadmeTopic;
  readonly keywords: readonly RegExp[];
  /** When true, intro content under the H1 also satisfies the topic. */
  readonly introFallback?: boolean;
}

const README_MATCHERS: readonly TopicMatcher[] = [
  {
    topic: 'project description',
    keywords: [/description/, /about/, /overview/, /introduction/, /features/],
    introFallback: true,
  },
  {
    topic: 'installation',
    keywords: [
      /install/,
      /getting started/,
      /setup/,
      /prerequisite/,
      /quick start/,
    ],
  },
  {
    topic: 'configuration',
    keywords: [/config/, /environment/, /\benv\b/, /settings/],
  },
  {
    topic: 'development',
    keywords: [/develop/, /\bdev\b/, /usage/, /running/, /scripts/],
  },
  {
    topic: 'deployment',
    keywords: [/deploy/, /hosting/, /publish/, /production build/, /static host/],
  },
];

interface Heading {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

/** Match an ATX markdown heading line. */
function parseHeading(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
  if (!match) return null;
  return { level: match[1].length, text: match[2] };
}

/**
 * Placeholder-only content that does not satisfy a required section. A line is
 * placeholder when it consists solely of a known placeholder token, optionally
 * followed by trailing punctuation/whitespace. Anchoring to end-of-line (rather
 * than a trailing `\b`) correctly flags tokens that end in a non-word character
 * such as `[FILL IN]` and `...`, while legitimate prose that merely begins with
 * one of these words followed by meaningful text is left untouched.
 */
function isPlaceholderContent(line: string): boolean {
  return /^(todo|tbd|coming soon|lorem ipsum|placeholder|n\/a|x{2,}|\[fill in\]|\.{3})[\s.,:;!?-]*$/i.test(
    line,
  );
}

/** A line that counts as real section content. */
function isContentLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('#')) return false;
  if (/^[-*_]{3,}$/.test(trimmed)) return false; // horizontal rule
  if (/^```/.test(trimmed)) return false; // code fence marker
  if (isPlaceholderContent(trimmed)) return false;
  return true;
}

/** Validate the README body against the required topics (7.5/7.6). */
export function analyzeReadme(content: string): ReadmeAnalysis {
  const lines = content.split(/\r?\n/);
  const headings: Heading[] = [];
  lines.forEach((line, index) => {
    const parsed = parseHeading(line);
    if (parsed) headings.push({ ...parsed, line: index });
  });

  const topics = {} as Record<ReadmeTopic, boolean>;
  for (const matcher of README_MATCHERS) {
    topics[matcher.topic] = isTopicSatisfied(matcher, headings, lines);
  }

  const deficiencies = REQUIRED_README_TOPICS.filter((t) => !topics[t]);
  return { exists: true, topics, deficiencies };
}

function isTopicSatisfied(
  matcher: TopicMatcher,
  headings: readonly Heading[],
  lines: readonly string[],
): boolean {
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const text = heading.text.toLowerCase();
    if (!matcher.keywords.some((re) => re.test(text))) continue;
    if (sectionHasContent(heading, headings, i, lines)) return true;
  }
  if (matcher.introFallback && introHasContent(headings, lines)) return true;
  return false;
}

/** Content lines between a heading and the next heading of the same/higher level. */
function sectionHasContent(
  heading: Heading,
  headings: readonly Heading[],
  index: number,
  lines: readonly string[],
): boolean {
  let end = lines.length;
  for (let j = index + 1; j < headings.length; j += 1) {
    if (headings[j].level <= heading.level) {
      end = headings[j].line;
      break;
    }
  }
  for (let k = heading.line + 1; k < end; k += 1) {
    if (isContentLine(lines[k])) return true;
  }
  return false;
}

/** Content under the H1 title, before the first second-level-or-deeper heading. */
function introHasContent(
  headings: readonly Heading[],
  lines: readonly string[],
): boolean {
  const h1 = headings.find((h) => h.level === 1);
  const start = h1 ? h1.line + 1 : 0;
  const next = headings.find((h) => h.line >= start);
  const end = next ? next.line : lines.length;
  for (let k = start; k < end; k += 1) {
    if (isContentLine(lines[k])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Finding kinds and detail encoding
// ---------------------------------------------------------------------------

const KIND = {
  buildOutput: 'gitignore-missing-build-output',
  dependencies: 'gitignore-missing-dependencies',
  envSecrets: 'gitignore-missing-env-secrets',
  osMetadata: 'gitignore-missing-os-metadata',
  logs: 'gitignore-missing-logs',
  transientDirs: 'gitignore-missing-transient-dirs',
  negation: 'gitignore-add-negation',
  trackedArtifact: 'tracked-artifact',
  looseTransient: 'loose-file-transient',
  looseMisplaced: 'loose-file-misplaced',
  looseUnclassified: 'loose-file-unclassified',
  looseReference: 'loose-file-reference',
  readmeMissing: 'readme-missing',
  readmeDeficiency: 'readme-section-deficiency',
} as const;

/** Category metadata used to derive both detection and the fix text. */
const CATEGORY_RULES: Record<string, { header: string; rules: string[] }> = {
  [KIND.buildOutput]: { header: '# Build output', rules: ['/dist/'] },
  [KIND.dependencies]: { header: '# Dependencies', rules: ['/node_modules/'] },
  [KIND.envSecrets]: {
    header: '# Environment / secrets',
    rules: ['.env', '.env.*', '!.env.example', '*.pem', '*.key'],
  },
  [KIND.osMetadata]: {
    header: '# OS files',
    rules: ['.DS_Store', 'Thumbs.db', 'Desktop.ini'],
  },
  [KIND.logs]: { header: '# Logs', rules: ['*.log'] },
};

const RELOCATE_TO = 'relocate to ';
const REFERENCE_OLD = "old='";
const REFERENCE_NEW = "new='";

function encodeRelocateDetail(newPath: string): string {
  return `Misplaced root file; ${RELOCATE_TO}${newPath}`;
}

function parseRelocateTarget(detail: string): string | null {
  const idx = detail.indexOf(RELOCATE_TO);
  if (idx < 0) return null;
  const target = detail.slice(idx + RELOCATE_TO.length).trim();
  return target.length > 0 ? target : null;
}

function encodeReferenceDetail(oldPath: string, newPath: string): string {
  return `Update file reference ${REFERENCE_OLD}${oldPath}' ${REFERENCE_NEW}${newPath}'`;
}

function parseReference(
  detail: string,
): { oldPath: string; newPath: string } | null {
  const oldMatch = new RegExp(`${REFERENCE_OLD}([^']+)'`).exec(detail);
  const newMatch = new RegExp(`${REFERENCE_NEW}([^']+)'`).exec(detail);
  if (!oldMatch || !newMatch) return null;
  return { oldPath: oldMatch[1], newPath: newMatch[1] };
}

function encodeNegationDetail(path: string): string {
  return `Must-track file '${path}' is matched by an ignore rule; add a negation rule`;
}

function parseNegationPath(detail: string): string | null {
  const match = /'([^']+)'/.exec(detail);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Edit + finding factories
// ---------------------------------------------------------------------------

const NO_LOCATION: CodeLocation = {};

function finding(
  path: string,
  kind: string,
  detail: string,
  autoFixable: boolean,
  location: CodeLocation = NO_LOCATION,
): Finding {
  return { domain: 'hygiene', path, location, kind, detail, autoFixable };
}

function insertEdit(path: string, text: string): Edit {
  return { kind: 'insert', path, text, placeholderInserted: false };
}

function preservedOutcome(reason: string): FixOutcome {
  return { edits: [], preserved: true, preservationReason: reason };
}

function editOutcome(edits: readonly Edit[]): FixOutcome {
  return { edits, preserved: false };
}

// ---------------------------------------------------------------------------
// Reference scanning (pure)
// ---------------------------------------------------------------------------

/** Reference forms a relocated file could appear as in another file's text. */
function referenceForms(oldPath: string): string[] {
  return [oldPath, `./${oldPath}`, `/${oldPath}`];
}

/** Records (other than the file itself) whose content references `oldPath`. */
function findReferencingRecords(
  records: readonly FileRecord[],
  oldPath: string,
): FileRecord[] {
  const forms = referenceForms(oldPath);
  return records.filter(
    (r) =>
      r.path !== oldPath &&
      r.content !== null &&
      forms.some((form) => r.content!.includes(form)),
  );
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export class HygieneDetector implements Detector {
  readonly domain = 'hygiene' as const;

  detect(records: readonly FileRecord[]): readonly Finding[] {
    const findings: Finding[] = [];
    findings.push(...this.detectGitignore(records));
    findings.push(...this.detectReadme(records));
    findings.push(...this.detectArtifactsAndLooseFiles(records));
    return findings;
  }

  private detectGitignore(records: readonly FileRecord[]): Finding[] {
    const record = records.find((r) => r.path === GITIGNORE_PATH);
    if (!record || record.content === null) return [];
    const content = record.content;
    const state = detectGitignoreState(content);
    const rules = parseGitignoreRules(content);
    const findings: Finding[] = [];

    const categories: { covered: boolean; kind: string; label: string }[] = [
      { covered: state.hasBuildOutput, kind: KIND.buildOutput, label: 'build output directory' },
      { covered: state.hasDependencies, kind: KIND.dependencies, label: 'dependency directories' },
      { covered: state.hasEnvSecrets, kind: KIND.envSecrets, label: 'environment/secret files' },
      { covered: state.hasOsMetadata, kind: KIND.osMetadata, label: 'OS metadata files' },
      { covered: state.hasLogs, kind: KIND.logs, label: 'log files' },
    ];
    for (const category of categories) {
      if (!category.covered) {
        findings.push(
          finding(
            GITIGNORE_PATH,
            category.kind,
            `.gitignore is missing a rule for the ${category.label} category`,
            true,
          ),
        );
      }
    }

    const missingTransient = TRANSIENT_DIRS.filter((d) => !state.transientDirs[d]);
    if (missingTransient.length > 0) {
      findings.push(
        finding(
          GITIGNORE_PATH,
          KIND.transientDirs,
          `.gitignore is missing explicit rules for transient directories: ${missingTransient.join(', ')}`,
          true,
        ),
      );
    }

    for (const candidate of records) {
      if (!isMustTrackFile(candidate.path)) continue;
      if (!isPathIgnored(candidate.path, rules)) continue;
      const negation = `!${candidate.path}`;
      if (state.negationRules.includes(negation)) continue;
      findings.push(
        finding(GITIGNORE_PATH, KIND.negation, encodeNegationDetail(candidate.path), true),
      );
    }

    return findings;
  }

  private detectReadme(records: readonly FileRecord[]): Finding[] {
    const record = records.find((r) => r.path === README_PATH);
    if (!record || record.content === null) {
      return [
        finding(
          README_PATH,
          KIND.readmeMissing,
          'README.md is absent; required onboarding sections cannot be verified',
          false,
        ),
      ];
    }
    const analysis = analyzeReadme(record.content);
    return analysis.deficiencies.map((topic) =>
      finding(
        README_PATH,
        KIND.readmeDeficiency,
        `README.md is missing a complete "${topic}" section`,
        false,
      ),
    );
  }

  private detectArtifactsAndLooseFiles(
    records: readonly FileRecord[],
  ): Finding[] {
    const findings: Finding[] = [];
    for (const record of records) {
      const path = record.path;
      if (path === GITIGNORE_PATH || path === README_PATH) continue;
      if (!isScannablePath(path)) continue;

      const artifact = classifyTrackedArtifact(path);
      if (artifact) {
        findings.push(
          finding(
            path,
            KIND.trackedArtifact,
            `Tracked ${artifact} artifact should be untracked while preserved on disk`,
            true,
          ),
        );
        continue;
      }

      if (isTransientArtifact(path)) {
        findings.push(
          finding(path, KIND.looseTransient, 'Transient artifact should be removed', true),
        );
        continue;
      }

      findings.push(...this.detectLooseRootFile(path, records));
    }
    return findings;
  }

  private detectLooseRootFile(
    path: string,
    records: readonly FileRecord[],
  ): Finding[] {
    if (path.includes('/')) return []; // only root-level files are "loose"
    const name = basename(path);
    if (ROOT_ALLOWLIST.has(name) || name.startsWith('.')) return [];
    if (name.endsWith('.md')) return [];
    if (/\.config\.(ts|js|mjs|cjs|json)$/.test(name)) return [];
    if (/^tsconfig.*\.json$/.test(name)) return [];

    const target = designatedLocation(path);
    if (!target) {
      return [
        finding(
          path,
          KIND.looseUnclassified,
          'Root file is not a recognized root file and has no safe designated location',
          false,
        ),
      ];
    }

    const findings: Finding[] = [
      finding(path, KIND.looseMisplaced, encodeRelocateDetail(target), true),
    ];
    for (const ref of findReferencingRecords(records, path)) {
      findings.push(
        finding(ref.path, KIND.looseReference, encodeReferenceDetail(path, target), true),
      );
    }
    return findings;
  }
}

// ---------------------------------------------------------------------------
// Fixer
// ---------------------------------------------------------------------------

export class HygieneFixer implements Fixer {
  readonly domain = 'hygiene' as const;

  fix(finding: Finding, record: FileRecord): FixOutcome {
    switch (finding.kind) {
      case KIND.buildOutput:
      case KIND.dependencies:
      case KIND.envSecrets:
      case KIND.osMetadata:
      case KIND.logs:
        return this.fixCategory(finding, record);
      case KIND.transientDirs:
        return this.fixTransientDirs(record);
      case KIND.negation:
        return this.fixNegation(finding, record);
      case KIND.trackedArtifact:
        return this.fixTrackedArtifact(finding);
      case KIND.looseTransient:
        return this.fixLooseTransient(finding);
      case KIND.looseMisplaced:
        return this.fixLooseMisplaced(finding);
      case KIND.looseReference:
        return this.fixLooseReference(finding, record);
      case KIND.readmeMissing:
      case KIND.readmeDeficiency:
      case KIND.looseUnclassified:
        return preservedOutcome(
          'Recorded as a deficiency for human review; no safe automatic fix (Req 7.6/7.7)',
        );
      default:
        return preservedOutcome(`Unrecognized hygiene finding kind: ${finding.kind}`);
    }
  }

  private fixCategory(finding: Finding, record: FileRecord): FixOutcome {
    if (record.content === null) {
      return preservedOutcome('.gitignore content unavailable');
    }
    const spec = CATEGORY_RULES[finding.kind];
    if (!spec) return preservedOutcome(`No rule template for ${finding.kind}`);
    const { appendedText } = buildGitignoreAppend(record.content, spec.header, spec.rules);
    if (appendedText === '') {
      return preservedOutcome('Category rules already present');
    }
    return editOutcome([insertEdit(finding.path, appendedText)]);
  }

  private fixTransientDirs(record: FileRecord): FixOutcome {
    if (record.content === null) {
      return preservedOutcome('.gitignore content unavailable');
    }
    const { appendedText } = buildGitignoreAppend(
      record.content,
      '# Transient working directories',
      [...TRANSIENT_DIRS],
    );
    if (appendedText === '') {
      return preservedOutcome('Transient directory rules already present');
    }
    return editOutcome([insertEdit(record.path, appendedText)]);
  }

  private fixNegation(finding: Finding, record: FileRecord): FixOutcome {
    if (record.content === null) {
      return preservedOutcome('.gitignore content unavailable');
    }
    const path = parseNegationPath(finding.detail);
    if (!path) return preservedOutcome('Could not derive the must-track path');
    const { appendedText } = buildGitignoreAppend(record.content, null, [`!${path}`]);
    if (appendedText === '') {
      return preservedOutcome('Negation rule already present');
    }
    return editOutcome([insertEdit(finding.path, appendedText)]);
  }

  private fixTrackedArtifact(finding: Finding): FixOutcome {
    return editOutcome([
      { kind: 'untrack', path: finding.path, placeholderInserted: false },
    ]);
  }

  private fixLooseTransient(finding: Finding): FixOutcome {
    return editOutcome([
      { kind: 'delete', path: finding.path, placeholderInserted: false },
    ]);
  }

  private fixLooseMisplaced(finding: Finding): FixOutcome {
    const target = parseRelocateTarget(finding.detail);
    if (!target) return preservedOutcome('Could not derive the relocation target');
    return editOutcome([
      { kind: 'move', path: finding.path, newPath: target, placeholderInserted: false },
    ]);
  }

  private fixLooseReference(finding: Finding, record: FileRecord): FixOutcome {
    if (record.content === null) {
      return preservedOutcome('Referencing file content unavailable');
    }
    const parsed = parseReference(finding.detail);
    if (!parsed) return preservedOutcome('Could not derive the reference paths');

    let updated = record.content;
    for (const form of referenceForms(parsed.oldPath)) {
      const replacement = form.startsWith('./')
        ? `./${parsed.newPath}`
        : form.startsWith('/')
          ? `/${parsed.newPath}`
          : parsed.newPath;
      updated = updated.split(form).join(replacement);
    }
    if (updated === record.content) {
      return preservedOutcome('No reference text matched for replacement');
    }
    return editOutcome([
      { kind: 'replace', path: finding.path, text: updated, placeholderInserted: false },
    ]);
  }
}

// ---------------------------------------------------------------------------
// Shared singleton instances (detectors/fixers are stateless and pure)
// ---------------------------------------------------------------------------

export const hygieneDetector = new HygieneDetector();
export const hygieneFixer = new HygieneFixer();
