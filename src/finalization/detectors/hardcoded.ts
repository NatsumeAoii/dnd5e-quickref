// Feature: pre-ship-finalization
//
// HardcodedValueDetector / Fixer (design "HardcodedValueDetector / Fixer",
// Requirement 4).
//
// Pure analysis of hardcoded literals in TypeScript / JavaScript source. This
// module performs NO I/O: every function operates over `FileRecord[]` (or raw
// strings already read by the FileInventory) and returns structured
// `Finding`/`FixOutcome` values. The orchestrator and EditApplier (later tasks)
// are the only components that touch disk.
//
// Each hardcoded literal is classified into exactly one of three categories:
//
//   1. secret / credential (4.1, 4.2) — API keys, tokens, passwords, private
//      keys, access tokens. The fixer replaces the literal with a configuration
//      reference (`import.meta.env.VITE_<KEY>`) so the original literal no
//      longer appears in source, and adds the corresponding key to an
//      environment template using a NON-SECRET placeholder. The original secret
//      value is NEVER written into the template or any emitted edit (4.2).
//
//   2. config URL / port / absolute path (4.3) — a literal referenced for
//      application configuration or behavior that is embedded directly in code.
//      The fixer hoists it to a single named-constant definition referenced
//      everywhere else in the file (exactly one definition location).
//
//   3. intentional public constant (4.4) — a stable, public literal already
//      declared as a named constant (UPPER_SNAKE), inside a frozen config
//      object, in a `*.config.*` file, or a well-known public namespace URL.
//      The fixer preserves it and records which preservation conditions hold.
//
// When a required configuration value cannot be derived from project context
// (e.g. a secret's runtime value), a `[FILL IN]` placeholder is emitted in the
// environment template and the unresolved key is recorded (4.5). A file whose
// content could not be read is left unchanged (4.6).
//
// Following the established fixer convention in this toolkit (see
// `config.ts`), in-file rewrites are expressed as a single whole-file `replace`
// edit (an Edit of kind 'replace' with no `range` and `text` set to the full
// new file content). This avoids offset arithmetic across multiple edits.

import {
  FILL_IN_PLACEHOLDER,
  type CodeLocation,
  type Detector,
  type Edit,
  type FileRecord,
  type Finding,
  type FixOutcome,
  type Fixer,
  type SourceLanguage,
} from '../types';

/**
 * Machine-readable `Finding.kind` values emitted by this detector. The fixer
 * branches on these, so they are the shared contract between detect and fix.
 */
export const HARDCODED_KINDS = {
  secret: 'secret-literal',
  configLiteral: 'config-literal',
  intentionalConstant: 'intentional-public-constant',
} as const;

/** The recommended environment-template filename when none exists yet. */
export const DEFAULT_ENV_TEMPLATE_PATH = '.env.example';

/** Source languages this detector inspects. */
const JS_TS_LANGUAGES: ReadonlySet<SourceLanguage> = new Set([
  'typescript',
  'javascript',
]);

/**
 * Identifier names (case-insensitive) that mark their assigned value as a
 * secret. Matched as a whole-word-ish segment inside the identifier so
 * `tokenizer` or `passwordless` do not trigger on `token` / `password`.
 */
const SECRET_NAME_RE =
  /(?:^|[_$-])(?:api[_-]?key|apikey|secret|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|privatekey|auth[_-]?token|bearer|credential|encryption[_-]?key|signing[_-]?key|app[_-]?key)(?:$|[_$-]|s$)/i;

/**
 * Strong value-shape signals that a literal is a secret regardless of the name
 * it is assigned to. These are high-precision prefixes/headers that essentially
 * never appear in non-secret strings.
 */
const STRONG_SECRET_VALUE_RES: readonly RegExp[] = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, // PEM private key
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/, // Stripe-style keys
  /\bghp_[A-Za-z0-9]{20,}\b/, // GitHub personal access token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack token
];

/**
 * Well-known public namespace URLs that are intentional, stable, and public by
 * nature (e.g. the SVG namespace). Treated as intentional public constants
 * rather than configuration literals to hoist.
 */
const WELL_KNOWN_PUBLIC_URLS: ReadonlySet<string> = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/2000/xmlns/',
]);

// ---------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------

interface StringLiteral {
  /** Value with surrounding quotes stripped. */
  readonly value: string;
  /** The quote character used (`'`, `"`, or backtick). */
  readonly quote: string;
  /** Index of the opening quote in the original content. */
  readonly startIndex: number;
  /** Index just past the closing quote in the original content. */
  readonly endIndex: number;
  /** 1-based line of the opening quote. */
  readonly line: number;
  /** 1-based column of the opening quote. */
  readonly column: number;
  /** True for template literals containing `${...}` interpolation. */
  readonly hasInterpolation: boolean;
}

interface ScannedFile {
  readonly content: string;
  /** Content with comment and string-literal characters blanked to spaces. */
  readonly codeMasked: string;
  readonly lineStarts: readonly number[];
  readonly strings: readonly StringLiteral[];
}

type LiteralCategory = 'secret' | 'config' | 'intentional';

interface ConfigKind {
  readonly type: 'url' | 'port' | 'path';
}

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

function getLineStarts(content: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function indexToLocation(
  index: number,
  lineStarts: readonly number[],
): { line: number; column: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  let line = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= index) {
      line = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { line: line + 1, column: index - lineStarts[line] + 1 };
}

function locationToIndex(
  location: CodeLocation,
  lineStarts: readonly number[],
): number | null {
  if (location.line === undefined || location.column === undefined) {
    return null;
  }
  const lineIndex = location.line - 1;
  if (lineIndex < 0 || lineIndex >= lineStarts.length) {
    return null;
  }
  return lineStarts[lineIndex] + (location.column - 1);
}

// ---------------------------------------------------------------------------
// Tokenizer: blank comments + strings, collecting string-literal tokens
// ---------------------------------------------------------------------------

/**
 * Scan the source once, producing a "masked" copy where every comment and
 * string-literal character is replaced by a space (newlines preserved so byte
 * offsets stay aligned), and collecting each string literal with its position.
 *
 * Numeric scans (ports) run over the masked form so they never match digits
 * inside strings or comments; string classification runs over the collected
 * literals so commented-out URLs/secrets are ignored.
 */
function scanFile(content: string, lineStarts: readonly number[]): ScannedFile {
  const n = content.length;
  const masked = content.split('');
  const strings: StringLiteral[] = [];
  type Mode = 'code' | 'line' | 'block' | 'string';
  let mode: Mode = 'code';
  let stringQuote = '';
  let stringStart = 0;
  let i = 0;

  const blank = (idx: number): void => {
    if (idx < n && content[idx] !== '\n' && content[idx] !== '\r') {
      masked[idx] = ' ';
    }
  };

  const pushString = (closeIndex: number): void => {
    const endIndex = closeIndex + 1;
    const raw = content.slice(stringStart + 1, closeIndex);
    const { line, column } = indexToLocation(stringStart, lineStarts);
    strings.push({
      value: raw,
      quote: stringQuote,
      startIndex: stringStart,
      endIndex,
      line,
      column,
      hasInterpolation: stringQuote === '`' && raw.includes('${'),
    });
  };

  while (i < n) {
    const c = content[i];
    const next = i + 1 < n ? content[i + 1] : '';

    if (mode === 'code') {
      if (c === '/' && next === '/') {
        mode = 'line';
        blank(i);
        blank(i + 1);
        i += 2;
      } else if (c === '/' && next === '*') {
        mode = 'block';
        blank(i);
        blank(i + 1);
        i += 2;
      } else if (c === '"' || c === "'" || c === '`') {
        mode = 'string';
        stringQuote = c;
        stringStart = i;
        blank(i);
        i++;
      } else {
        i++;
      }
      continue;
    }

    if (mode === 'line') {
      if (c === '\n') {
        mode = 'code';
      } else {
        blank(i);
      }
      i++;
      continue;
    }

    if (mode === 'block') {
      if (c === '*' && next === '/') {
        blank(i);
        blank(i + 1);
        mode = 'code';
        i += 2;
      } else {
        blank(i);
        i++;
      }
      continue;
    }

    // mode === 'string'
    if (c === '\\') {
      blank(i);
      blank(i + 1);
      i += 2;
    } else if (c === stringQuote) {
      pushString(i);
      blank(i);
      mode = 'code';
      i++;
    } else {
      blank(i);
      i++;
    }
  }

  // Unterminated string at EOF: record what we have so detection still runs.
  if (mode === 'string') {
    pushString(n);
  }

  return {
    content,
    codeMasked: masked.join(''),
    lineStarts,
    strings,
  };
}

// ---------------------------------------------------------------------------
// Assignment-name extraction
// ---------------------------------------------------------------------------

const IDENTIFIER_TAIL_RE = /[A-Za-z0-9_$]+$/;
const QUOTED_KEY_TAIL_RE = /['"]([A-Za-z0-9_$.-]+)['"]\s*$/;
const ASSIGNMENT_OPERATOR_CHARS: ReadonlySet<string> = new Set([
  '=',
  '<',
  '>',
  '!',
  '+',
  '-',
  '*',
  '/',
  '%',
  '&',
  '|',
  '^',
]);

/**
 * Determine the identifier or object key a literal is assigned to, by scanning
 * the masked code backwards from the literal. Recognizes `name = '...'`,
 * `name: '...'`, and `'name': '...'`. Returns `null` when no assignment target
 * is found (for example a bare argument or array element).
 */
function precedingAssignmentName(
  masked: string,
  content: string,
  literalStart: number,
): string | null {
  let i = literalStart - 1;
  while (i >= 0 && /\s/.test(masked[i])) {
    i--;
  }
  if (i < 0) {
    return null;
  }

  const connector = masked[i];
  if (connector === '=') {
    // Reject comparison / arrow / compound-assignment operators (e.g. `==`,
    // `=>`, `+=`) by inspecting the character preceding the `=`.
    const before = i > 0 ? masked[i - 1] : '';
    if (ASSIGNMENT_OPERATOR_CHARS.has(before)) {
      return null;
    }
  } else if (connector !== ':') {
    return null;
  }

  i--;
  while (i >= 0 && /\s/.test(masked[i])) {
    i--;
  }
  if (i < 0) {
    return null;
  }

  const head = content.slice(0, i + 1);
  const quoted = QUOTED_KEY_TAIL_RE.exec(head);
  if (quoted) {
    return quoted[1];
  }
  const ident = IDENTIFIER_TAIL_RE.exec(head);
  return ident ? ident[0] : null;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function isUrl(value: string): boolean {
  return /^(?:https?|wss?|ftp):\/\/\S+$/i.test(value.trim());
}

function isAbsolutePath(value: string): boolean {
  const v = value.trim();
  // Windows drive path: C:\... or C:/...
  if (/^[A-Za-z]:[\\/]/.test(v)) {
    return true;
  }
  // POSIX absolute path rooted at a recognized system/user directory, so route
  // strings ('/api/users') and module specifiers ('/components') are excluded.
  return /^\/(?:usr|home|var|etc|opt|tmp|root|bin|sbin|lib|mnt|srv|Users|Applications)\//.test(
    v,
  );
}

function isSecretByName(name: string | null): boolean {
  return name !== null && SECRET_NAME_RE.test(name);
}

function isSecretByValue(value: string): boolean {
  return STRONG_SECRET_VALUE_RES.some((re) => re.test(value));
}

function isUpperSnake(name: string | null): boolean {
  return name !== null && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(name);
}

/** Whether the file is a configuration module where literals are intentional. */
function isConfigFile(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  return base === 'config.ts' || base === 'config.js' || /\.config\.[tj]s$/.test(path);
}

/**
 * Decide whether a config-shaped literal sits in an intentional public-constant
 * context: assigned to an UPPER_SNAKE name, inside a frozen config object, or in
 * a configuration module. Secrets are never treated as intentional here.
 */
function isIntentionalContext(
  scanned: ScannedFile,
  literal: StringLiteral,
  name: string | null,
  path: string,
): boolean {
  if (WELL_KNOWN_PUBLIC_URLS.has(literal.value.trim())) {
    return true;
  }
  if (isUpperSnake(name)) {
    return true;
  }
  if (isConfigFile(path)) {
    return true;
  }
  // Inside an `Object.freeze(` / `as const` declaration span preceding the
  // literal on the masked code (heuristic, comment/string-safe).
  const window = scanned.codeMasked.slice(
    Math.max(0, literal.startIndex - 400),
    literal.startIndex,
  );
  return /Object\s*\.\s*freeze\s*\(/.test(window);
}

interface ClassifiedLiteral {
  readonly literal: StringLiteral;
  readonly name: string | null;
  readonly category: LiteralCategory;
  readonly configKind: ConfigKind | null;
}

function classifyStringLiteral(
  scanned: ScannedFile,
  literal: StringLiteral,
  path: string,
): ClassifiedLiteral | null {
  if (literal.hasInterpolation) {
    return null;
  }
  const name = precedingAssignmentName(
    scanned.codeMasked,
    scanned.content,
    literal.startIndex,
  );

  if (isSecretByName(name) || isSecretByValue(literal.value)) {
    return { literal, name, category: 'secret', configKind: null };
  }

  let configKind: ConfigKind | null = null;
  if (isUrl(literal.value)) {
    configKind = { type: 'url' };
  } else if (isAbsolutePath(literal.value)) {
    configKind = { type: 'path' };
  }

  if (configKind === null) {
    return null; // Ordinary string; not an inappropriate hardcoded value.
  }

  const category: LiteralCategory = isIntentionalContext(
    scanned,
    literal,
    name,
    path,
  )
    ? 'intentional'
    : 'config';

  return { literal, name, category, configKind };
}

// ---------------------------------------------------------------------------
// Port (numeric) detection over masked code
// ---------------------------------------------------------------------------

interface PortFinding {
  readonly name: string | null;
  readonly value: string;
  readonly index: number;
  readonly intentional: boolean;
}

const PORT_ASSIGN_RE =
  /([A-Za-z_$][\w$]*[Pp][Oo][Rr][Tt][\w$]*)\s*[:=]\s*(\d{2,5})/g;
const PORT_LISTEN_RE = /\.listen\(\s*(\d{2,5})/g;

function detectPorts(scanned: ScannedFile, path: string): PortFinding[] {
  const ports: PortFinding[] = [];
  let match: RegExpExecArray | null;

  PORT_ASSIGN_RE.lastIndex = 0;
  while ((match = PORT_ASSIGN_RE.exec(scanned.codeMasked)) !== null) {
    const name = match[1];
    // The finding index must point at the port digits, not the identifier, so
    // hoistPort's slice check reads the number it is about to hoist.
    const valueIndex = match.index + match[0].lastIndexOf(match[2]);
    ports.push({
      name,
      value: match[2],
      index: valueIndex,
      intentional: isUpperSnake(name) || isConfigFile(path),
    });
  }

  PORT_LISTEN_RE.lastIndex = 0;
  while ((match = PORT_LISTEN_RE.exec(scanned.codeMasked)) !== null) {
    const valueIndex = match.index + match[0].indexOf(match[1]);
    ports.push({
      name: null,
      value: match[1],
      index: valueIndex,
      intentional: isConfigFile(path),
    });
  }

  return ports;
}

// ---------------------------------------------------------------------------
// Finding factory
// ---------------------------------------------------------------------------

function makeFinding(
  path: string,
  location: CodeLocation,
  kind: string,
  detail: string,
  autoFixable: boolean,
): Finding {
  return { domain: 'hardcoded', path, location, kind, detail, autoFixable };
}

// ---------------------------------------------------------------------------
// Public detector
// ---------------------------------------------------------------------------

/**
 * The hardcoded-value detector. Pure: it reads nothing from disk and depends
 * only on the supplied `FileRecord[]`.
 */
export const hardcodedDetector: Detector = {
  domain: 'hardcoded',

  detect(records: readonly FileRecord[]): readonly Finding[] {
    const findings: Finding[] = [];

    for (const record of records) {
      if (record.content === null || !JS_TS_LANGUAGES.has(record.language)) {
        continue;
      }
      const lineStarts = getLineStarts(record.content);
      const scanned = scanFile(record.content, lineStarts);

      // String literals: secrets, config URLs/paths, intentional constants.
      // Track config values already reported to emit one finding per distinct
      // value (the fixer hoists every occurrence in the file at once).
      const reportedConfigValues = new Set<string>();

      for (const literal of scanned.strings) {
        const classified = classifyStringLiteral(scanned, literal, record.path);
        if (classified === null) {
          continue;
        }
        const location: CodeLocation = {
          line: literal.line,
          column: literal.column,
        };

        if (classified.category === 'secret') {
          findings.push(
            makeFinding(
              record.path,
              location,
              HARDCODED_KINDS.secret,
              `Hardcoded secret/credential literal${
                classified.name ? ` assigned to "${classified.name}"` : ''
              } must be replaced with a configuration reference.`,
              true,
            ),
          );
          continue;
        }

        if (classified.category === 'intentional') {
          findings.push(
            makeFinding(
              record.path,
              location,
              HARDCODED_KINDS.intentionalConstant,
              describeIntentional(classified),
              false,
            ),
          );
          continue;
        }

        // category === 'config'
        if (reportedConfigValues.has(literal.value)) {
          continue;
        }
        reportedConfigValues.add(literal.value);
        const occurrences = countLiteralOccurrences(
          scanned.strings,
          literal.value,
          literal.quote,
        );
        findings.push(
          makeFinding(
            record.path,
            location,
            HARDCODED_KINDS.configLiteral,
            `Hardcoded configuration ${classified.configKind?.type ?? 'value'} should be hoisted to a single named constant (${occurrences} occurrence${
              occurrences === 1 ? '' : 's'
            }).`,
            true,
          ),
        );
      }

      // Numeric ports.
      for (const port of detectPorts(scanned, record.path)) {
        const location = indexToLocation(port.index, lineStarts);
        if (port.intentional) {
          findings.push(
            makeFinding(
              record.path,
              location,
              HARDCODED_KINDS.intentionalConstant,
              `Port ${port.value} is an intentional public constant${
                port.name ? ` ("${port.name}")` : ''
              }: declared as a named constant; stable; non-secret.`,
              false,
            ),
          );
        } else {
          findings.push(
            makeFinding(
              record.path,
              location,
              HARDCODED_KINDS.configLiteral,
              `Hardcoded port ${port.value} should be hoisted to a single named constant.`,
              true,
            ),
          );
        }
      }
    }

    return findings;
  },
};

function describeIntentional(classified: ClassifiedLiteral): string {
  const conditions: string[] = [];
  if (isUpperSnake(classified.name)) {
    conditions.push('declared as a named UPPER_SNAKE constant (intentional)');
  }
  if (WELL_KNOWN_PUBLIC_URLS.has(classified.literal.value.trim())) {
    conditions.push('well-known public namespace URL (stable, public)');
  }
  conditions.push('non-secret (public)');
  return `Intentional public constant preserved: ${conditions.join('; ')}.`;
}

function countLiteralOccurrences(
  strings: readonly StringLiteral[],
  value: string,
  quote: string,
): number {
  return strings.filter((s) => s.value === value && s.quote === quote).length;
}

// ===========================================================================
// Fixer
// ===========================================================================

/**
 * Fixes hardcoded-value findings.
 *   - secret-literal: replaces every occurrence of the secret literal with an
 *     `import.meta.env.VITE_<KEY>` reference and emits an environment-template
 *     edit carrying the key with a `[FILL IN]` placeholder. The original secret
 *     value never appears in any emitted edit (4.1, 4.2, 4.5).
 *   - config-literal: hoists the literal to a single named-constant definition
 *     referenced everywhere else in the file (4.3).
 *   - intentional-public-constant: preserved with conditions recorded (4.4).
 * A file that could not be read is left unchanged (4.6).
 */
export const hardcodedFixer: Fixer = {
  domain: 'hardcoded',

  fix(finding: Finding, record: FileRecord): FixOutcome {
    if (record.content === null) {
      return {
        edits: [],
        preserved: true,
        preservationReason: `Source file "${record.path}" could not be read and was left unchanged.`,
      };
    }

    switch (finding.kind) {
      case HARDCODED_KINDS.secret:
        return fixSecret(finding, record);
      case HARDCODED_KINDS.configLiteral:
        return fixConfigLiteral(finding, record);
      case HARDCODED_KINDS.intentionalConstant:
        return {
          edits: [],
          preserved: true,
          preservationReason: finding.detail,
        };
      default:
        return {
          edits: [],
          preserved: true,
          preservationReason: 'unknown finding kind',
        };
    }
  },
};

function fixSecret(finding: Finding, record: FileRecord): FixOutcome {
  const content = record.content as string;
  const lineStarts = getLineStarts(content);
  const scanned = scanFile(content, lineStarts);
  const target = locateLiteral(scanned, finding.location, lineStarts);
  if (target === null) {
    return {
      edits: [],
      preserved: true,
      preservationReason: 'could not locate the secret literal to replace',
    };
  }

  const name = precedingAssignmentName(
    scanned.codeMasked,
    content,
    target.startIndex,
  );

  // When the secret has no named binding (for example a secret literal passed
  // inline as a call argument) the environment-variable key cannot be derived
  // from project context. In that case the configuration reference itself
  // becomes a `[FILL IN]` placeholder so a human supplies the real key, and the
  // source edit is flagged as a placeholder insertion (4.5).
  const derivable = name !== null;
  const envKey = derivable ? deriveEnvKey(name) : FILL_IN_PLACEHOLDER;
  const reference = derivable
    ? `import.meta.env.${envKey}`
    : `import.meta.env['${FILL_IN_PLACEHOLDER}']`;

  // Replace EVERY occurrence of the exact secret literal so it cannot survive
  // anywhere in the file (Property 11).
  const occurrences = scanned.strings.filter(
    (s) => s.value === target.value && s.quote === target.quote,
  );
  const replacements = occurrences.map((s) => ({
    startIndex: s.startIndex,
    endIndex: s.endIndex,
    text: reference,
  }));
  const newContent = applyReplacements(content, replacements);

  const sourceEdit: Edit = {
    kind: 'replace',
    path: record.path,
    text: newContent,
    placeholderInserted: !derivable,
  };

  // Environment template gains the key with a non-secret placeholder. The
  // original secret value is never written here (4.2). EditApplier merges a
  // 'create' edit into an existing template by appending absent keys. When the
  // key was underivable, the unresolved key is recorded as the placeholder
  // token itself.
  const envComment = derivable
    ? `# ${envKey}: provide this value via environment configuration.`
    : `# ${envKey}: configuration key could not be derived; provide the env key and value.`;
  const envEntry = `${envComment}\n${envKey}=${FILL_IN_PLACEHOLDER}\n`;
  const envEdit: Edit = {
    kind: 'create',
    path: DEFAULT_ENV_TEMPLATE_PATH,
    text: envEntry,
    placeholderInserted: true,
  };

  return { edits: [sourceEdit, envEdit], preserved: false };
}

function fixConfigLiteral(finding: Finding, record: FileRecord): FixOutcome {
  const content = record.content as string;
  const lineStarts = getLineStarts(content);
  const scanned = scanFile(content, lineStarts);

  const portValue = parsePortFromDetail(finding.detail);
  if (portValue !== null) {
    return hoistPort(record, content, scanned, finding, portValue);
  }

  const target = locateLiteral(scanned, finding.location, lineStarts);
  if (target === null) {
    return {
      edits: [],
      preserved: true,
      preservationReason: 'could not locate the configuration literal to hoist',
    };
  }

  const name = precedingAssignmentName(
    scanned.codeMasked,
    content,
    target.startIndex,
  );
  const constName = deriveConstName(name, target.value, existingNames(scanned));
  const occurrences = scanned.strings.filter(
    (s) => s.value === target.value && s.quote === target.quote,
  );

  // Avoid replacing the literal that sits at the constant definition itself: if
  // the only occurrence is the value of an existing UPPER_SNAKE constant, there
  // is nothing to hoist. Otherwise replace every occurrence with the constant.
  const replacements = occurrences.map((s) => ({
    startIndex: s.startIndex,
    endIndex: s.endIndex,
    text: constName,
  }));
  const definition = `const ${constName} = ${target.quote}${target.value}${target.quote};\n`;
  const insertIndex = afterImportsIndex(scanned);
  const withReplacements = applyReplacements(content, [
    ...replacements,
    { startIndex: insertIndex, endIndex: insertIndex, text: definition },
  ]);

  const edit: Edit = {
    kind: 'replace',
    path: record.path,
    text: withReplacements,
    placeholderInserted: false,
  };
  return { edits: [edit], preserved: false };
}

function hoistPort(
  record: FileRecord,
  content: string,
  scanned: ScannedFile,
  finding: Finding,
  portValue: string,
): FixOutcome {
  const lineStarts = scanned.lineStarts;
  const findingIndex = locationToIndex(finding.location, lineStarts);
  if (findingIndex === null) {
    return {
      edits: [],
      preserved: true,
      preservationReason: 'could not locate the hardcoded port to hoist',
    };
  }

  // Confirm the digits at the located position match the reported port.
  const slice = content.slice(findingIndex, findingIndex + portValue.length);
  if (slice !== portValue) {
    return {
      edits: [],
      preserved: true,
      preservationReason: 'port literal no longer matches the recorded location',
    };
  }

  const constName = deriveConstName(null, `PORT_${portValue}`, existingNames(scanned));
  const definition = `const ${constName} = ${portValue};\n`;
  const insertIndex = afterImportsIndex(scanned);
  const newContent = applyReplacements(content, [
    {
      startIndex: findingIndex,
      endIndex: findingIndex + portValue.length,
      text: constName,
    },
    { startIndex: insertIndex, endIndex: insertIndex, text: definition },
  ]);

  const edit: Edit = {
    kind: 'replace',
    path: record.path,
    text: newContent,
    placeholderInserted: false,
  };
  return { edits: [edit], preserved: false };
}

// ---------------------------------------------------------------------------
// Fixer helpers
// ---------------------------------------------------------------------------

function locateLiteral(
  scanned: ScannedFile,
  location: CodeLocation,
  lineStarts: readonly number[],
): StringLiteral | null {
  const index = locationToIndex(location, lineStarts);
  if (index === null) {
    return null;
  }
  return scanned.strings.find((s) => s.startIndex === index) ?? null;
}

interface Replacement {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly text: string;
}

/**
 * Apply a set of non-overlapping replacements to `content`. Insertions use an
 * empty range (`startIndex === endIndex`). Applied from the highest index down
 * so earlier offsets remain valid.
 */
function applyReplacements(
  content: string,
  replacements: readonly Replacement[],
): string {
  const ordered = [...replacements].sort((a, b) => b.startIndex - a.startIndex);
  let result = content;
  for (const r of ordered) {
    result = result.slice(0, r.startIndex) + r.text + result.slice(r.endIndex);
  }
  return result;
}

/**
 * Derive a Vite client environment-variable key from an assignment name. Always
 * carries the `VITE_` prefix required for `import.meta.env` exposure. Only
 * called when a binding name is available; underivable secrets use the
 * `[FILL IN]` placeholder instead (see `fixSecret`).
 */
function deriveEnvKey(name: string): string {
  const base = toUpperSnake(name);
  const trimmed = base.length > 0 ? base : 'SECRET';
  return trimmed.startsWith('VITE_') ? trimmed : `VITE_${trimmed}`;
}

/** Derive a unique UPPER_SNAKE constant name for a hoisted config literal. */
function deriveConstName(
  name: string | null,
  value: string,
  taken: ReadonlySet<string>,
): string {
  let base = name ? toUpperSnake(name) : '';
  if (base.length === 0) {
    base = toUpperSnake(hostOrHintFromValue(value));
  }
  if (base.length === 0) {
    base = 'HOISTED_CONSTANT';
  }
  if (/^[0-9]/.test(base)) {
    base = `C_${base}`;
  }
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix++;
  }
  return candidate;
}

function hostOrHintFromValue(value: string): string {
  const urlMatch = /^(?:https?|wss?|ftp):\/\/([^/:]+)/i.exec(value.trim());
  if (urlMatch) {
    return `${urlMatch[1]}_URL`;
  }
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/')) {
    return 'FILE_PATH';
  }
  return value;
}

function toUpperSnake(name: string): string {
  return name
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

/** Collect identifier names already declared at top level (collision set). */
function existingNames(scanned: ScannedFile): ReadonlySet<string> {
  const names = new Set<string>();
  const declRe =
    /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|enum|type)\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = declRe.exec(scanned.codeMasked)) !== null) {
    names.add(match[1]);
  }
  return names;
}

/**
 * Index just after the last top-level `import ... from '...'` statement, where a
 * hoisted constant definition is inserted. Returns 0 when no imports exist.
 */
function afterImportsIndex(scanned: ScannedFile): number {
  const importRe = /(?:^|\n)\s*import\b[^\n]*from\s*['"][^'"]+['"]\s*;?/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(scanned.codeMasked)) !== null) {
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd === 0) {
    return 0;
  }
  // Advance to the start of the next line so the constant sits on its own line.
  let idx = lastEnd;
  while (idx < scanned.content.length && scanned.content[idx] !== '\n') {
    idx++;
  }
  if (idx < scanned.content.length) {
    idx++; // move past the newline
  }
  return idx;
}

function parsePortFromDetail(detail: string): string | null {
  const match = /Hardcoded port (\d{2,5})/.exec(detail);
  return match ? match[1] : null;
}
