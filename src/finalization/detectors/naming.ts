// Feature: pre-ship-finalization
//
// NamingDetector / Fixer (Requirement 6).
//
// Flags identifiers in non-test source files whose name is a case-insensitive
// match to one of the generic placeholders `foo`, `bar`, `temp`, or `test123`
// (Requirement 6.1) and renames them to a valid descriptive name that:
//   - is not itself a placeholder (6.1),
//   - follows the file's majority casing convention for the identifier's kind
//     (6.3),
//   - does not collide with an existing identifier in the file (6.4),
//   - and updates every static reference within the file so observable
//     behavior is unchanged (6.2).
//
// References that cannot be rewritten safely - string/dynamic references such
// as `obj['foo']` or member accesses such as `obj.foo` - cause the identifier
// to be left unchanged with a recorded reason (6.5).
//
// Everything here is a pure function over file content. No I/O is performed;
// the fixer returns a single whole-file `replace` Edit (a `replace` Edit whose
// `range` is omitted denotes a full-content replacement) which the EditApplier
// commits to disk in a later task.

import type {
  CodeLocation,
  Detector,
  Edit,
  FileRecord,
  Finding,
  Fixer,
  FixOutcome,
} from '../types';

/** The placeholder identifier set, matched case-insensitively (Requirement 6.1). */
const PLACEHOLDER_NAMES = ['foo', 'bar', 'temp', 'test123'] as const;

/** Lowercased placeholder -> descriptive base word used to build the new name. */
const BASE_WORD_BY_PLACEHOLDER: Readonly<Record<string, string>> = {
  foo: 'value',
  bar: 'item',
  temp: 'temporary',
  test123: 'sample',
};

const IDENTIFIER_TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Casing styles the toolkit recognizes for replacement-name construction. */
type Casing = 'camel' | 'pascal' | 'snake' | 'upper';

/** The declaration kind of an identifier, used to pick a casing convention. */
type IdentifierKind = 'type' | 'constant' | 'value';

const DEFAULT_CASING_BY_KIND: Readonly<Record<IdentifierKind, Casing>> = {
  type: 'pascal',
  constant: 'upper',
  value: 'camel',
};

const CASING_PRIORITY: Readonly<Record<IdentifierKind, readonly Casing[]>> = {
  type: ['pascal', 'camel', 'snake', 'upper'],
  constant: ['upper', 'snake', 'camel', 'pascal'],
  value: ['camel', 'pascal', 'snake', 'upper'],
};

// ---------------------------------------------------------------------------
// Source masking
// ---------------------------------------------------------------------------

interface MaskResult {
  /**
   * A copy of the source where every character that is part of a string
   * literal or comment is replaced with a space (newlines preserved), so that
   * identifier scanning sees only genuine code tokens. Template-literal
   * `${ ... }` interpolations are kept as code because they contain real
   * references.
   */
  readonly codeMask: string;
  /** The text of every string/template literal, used for dynamic-reference detection. */
  readonly stringLiterals: readonly string[];
}

/**
 * Classify each character of `content` as code or non-code (string/comment),
 * producing a length-preserving mask and the list of string-literal values.
 *
 * Implemented as an explicit character state machine so it is deterministic
 * and dependency-free. Template literals are handled so that interpolation
 * expressions remain visible as code while the surrounding text is masked.
 */
export function maskSource(content: string): MaskResult {
  const out: string[] = [];
  const stringLiterals: string[] = [];
  const length = content.length;

  // Open-brace balance for each active `${ ... }` template interpolation, so
  // we know when the expression ends and template text resumes.
  const templateExprBraces: number[] = [];

  let mode: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' =
    'code';
  let literalBuffer = '';

  const pushMasked = (ch: string): void => {
    out.push(ch === '\n' ? '\n' : ' ');
  };

  let i = 0;
  while (i < length) {
    const ch = content[i];
    const next = i + 1 < length ? content[i + 1] : '';

    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'line';
        pushMasked(ch);
        pushMasked(next);
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'block';
        pushMasked(ch);
        pushMasked(next);
        i += 2;
        continue;
      }
      if (ch === "'") {
        mode = 'single';
        literalBuffer = '';
        pushMasked(ch);
        i += 1;
        continue;
      }
      if (ch === '"') {
        mode = 'double';
        literalBuffer = '';
        pushMasked(ch);
        i += 1;
        continue;
      }
      if (ch === '`') {
        mode = 'template';
        literalBuffer = '';
        pushMasked(ch);
        i += 1;
        continue;
      }
      if (templateExprBraces.length > 0) {
        const top = templateExprBraces.length - 1;
        if (ch === '{') {
          templateExprBraces[top] += 1;
        } else if (ch === '}') {
          if (templateExprBraces[top] === 0) {
            templateExprBraces.pop();
            mode = 'template';
            literalBuffer = '';
            pushMasked(ch);
            i += 1;
            continue;
          }
          templateExprBraces[top] -= 1;
        }
      }
      out.push(ch);
      i += 1;
      continue;
    }

    if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
      }
      pushMasked(ch);
      i += 1;
      continue;
    }

    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        pushMasked(ch);
        pushMasked(next);
        i += 2;
        continue;
      }
      pushMasked(ch);
      i += 1;
      continue;
    }

    if (mode === 'single' || mode === 'double') {
      const quote = mode === 'single' ? "'" : '"';
      if (ch === '\\') {
        literalBuffer += ch;
        pushMasked(ch);
        if (next !== '') {
          literalBuffer += next;
          pushMasked(next);
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      if (ch === quote) {
        stringLiterals.push(literalBuffer);
        mode = 'code';
        pushMasked(ch);
        i += 1;
        continue;
      }
      if (ch === '\n') {
        // Unterminated literal; recover into code mode without dropping it.
        stringLiterals.push(literalBuffer);
        mode = 'code';
        pushMasked(ch);
        i += 1;
        continue;
      }
      literalBuffer += ch;
      pushMasked(ch);
      i += 1;
      continue;
    }

    // mode === 'template'
    if (ch === '\\') {
      literalBuffer += ch;
      pushMasked(ch);
      if (next !== '') {
        literalBuffer += next;
        pushMasked(next);
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (ch === '`') {
      stringLiterals.push(literalBuffer);
      mode = 'code';
      pushMasked(ch);
      i += 1;
      continue;
    }
    if (ch === '$' && next === '{') {
      stringLiterals.push(literalBuffer);
      literalBuffer = '';
      templateExprBraces.push(0);
      mode = 'code';
      pushMasked(ch);
      pushMasked(next);
      i += 2;
      continue;
    }
    literalBuffer += ch;
    pushMasked(ch);
    i += 1;
    continue;
  }

  return { codeMask: out.join(''), stringLiterals };
}

// ---------------------------------------------------------------------------
// Token scanning helpers
// ---------------------------------------------------------------------------

interface TokenOccurrence {
  readonly name: string;
  readonly index: number;
  readonly memberAccess: boolean;
}

/** Last non-space character before `index` in the mask, or '' if none. */
function precedingNonSpace(codeMask: string, index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = codeMask[i];
    if (ch !== ' ' && ch !== '\n' && ch !== '\t' && ch !== '\r') {
      return ch;
    }
  }
  return '';
}

/** All identifier tokens in the code regions of `codeMask`. */
function scanTokens(codeMask: string): readonly TokenOccurrence[] {
  const tokens: TokenOccurrence[] = [];
  IDENTIFIER_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IDENTIFIER_TOKEN.exec(codeMask)) !== null) {
    const index = match.index;
    const before = precedingNonSpace(codeMask, index);
    tokens.push({
      name: match[0],
      index,
      memberAccess: before === '.',
    });
  }
  return tokens;
}

/** 1-based line and column for a character offset. */
function locationFromOffset(content: string, offset: number): CodeLocation {
  let line = 1;
  let lastLineStart = 0;
  for (let i = 0; i < offset && i < content.length; i += 1) {
    if (content[i] === '\n') {
      line += 1;
      lastLineStart = i + 1;
    }
  }
  return { line, column: offset - lastLineStart + 1 };
}

/** Character offset for a 1-based line/column, clamped to content bounds. */
function offsetFromLocation(content: string, location: CodeLocation): number {
  const targetLine = location.line ?? 1;
  const targetColumn = location.column ?? 1;
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (line === targetLine) {
      break;
    }
    if (content[i] === '\n') {
      line += 1;
      lineStart = i + 1;
    }
  }
  return Math.min(lineStart + (targetColumn - 1), content.length);
}

// ---------------------------------------------------------------------------
// Naming convention helpers
// ---------------------------------------------------------------------------

/** Classify the casing style of an identifier name. */
export function classifyCasing(name: string): Casing {
  if (/^[A-Z][A-Z0-9]*$/.test(name)) {
    return 'upper';
  }
  if (name.includes('_')) {
    return /^[A-Z0-9_]+$/.test(name) ? 'upper' : 'snake';
  }
  return /^[A-Z]/.test(name) ? 'pascal' : 'camel';
}

/** Render a lowercase base word in the requested casing style. */
function applyCasing(baseWord: string, casing: Casing): string {
  const lower = baseWord.toLowerCase();
  switch (casing) {
    case 'camel':
    case 'snake':
      return lower;
    case 'pascal':
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    case 'upper':
      return lower.toUpperCase();
  }
}

/** Append a uniqueness suffix to a candidate name in a casing-appropriate way. */
function withSuffix(name: string, casing: Casing, counter: number): string {
  if (casing === 'snake' || casing === 'upper') {
    return `${name}_${counter}`;
  }
  return `${name}${counter}`;
}

/** Determine the declaration kind of `name` from its declaration site, if any. */
function determineKind(codeMask: string, name: string): IdentifierKind {
  const escaped = escapeForRegExp(name);
  if (new RegExp(`\\b(?:class|interface|type|enum)\\s+${escaped}\\b`).test(codeMask)) {
    return 'type';
  }
  if (
    new RegExp(`\\bconst\\s+${escaped}\\b`).test(codeMask) &&
    classifyCasing(name) === 'upper'
  ) {
    return 'constant';
  }
  return 'value';
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Names declared for a given identifier kind, used to detect the dominant casing. */
function declaredNamesForKind(
  codeMask: string,
  kind: IdentifierKind,
): readonly string[] {
  const names: string[] = [];
  const pattern =
    kind === 'type'
      ? /\b(?:class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
      : /\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g;
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(codeMask)) !== null) {
    const declared = match[1];
    if (kind === 'constant') {
      if (classifyCasing(declared) === 'upper') {
        names.push(declared);
      }
    } else {
      names.push(declared);
    }
  }
  return names;
}

/** Pick the dominant casing among declarations of the identifier's kind (6.3). */
function majorityCasing(
  codeMask: string,
  kind: IdentifierKind,
  excludeName: string,
): Casing {
  const counts: Record<Casing, number> = {
    camel: 0,
    pascal: 0,
    snake: 0,
    upper: 0,
  };
  for (const declared of declaredNamesForKind(codeMask, kind)) {
    if (declared === excludeName) {
      continue;
    }
    counts[classifyCasing(declared)] += 1;
  }

  const order = CASING_PRIORITY[kind];
  let best = order[0];
  let bestCount = counts[best];
  for (const casing of order) {
    if (counts[casing] > bestCount) {
      best = casing;
      bestCount = counts[casing];
    }
  }
  return bestCount === 0 ? DEFAULT_CASING_BY_KIND[kind] : best;
}

// ---------------------------------------------------------------------------
// Core analysis shared by detector and fixer
// ---------------------------------------------------------------------------

interface CandidateAnalysis {
  readonly name: string;
  readonly kind: IdentifierKind;
  /** Content offsets of every renameable (non-member) code occurrence. */
  readonly renameOffsets: readonly number[];
  /** First code occurrence offset, used as the finding location. */
  readonly firstOffset: number;
  /** True when the identifier can be safely renamed. */
  readonly fixable: boolean;
  /** Populated when `fixable` is false (Requirement 6.5). */
  readonly skipReason?: string;
}

function isPlaceholderName(name: string): boolean {
  return (PLACEHOLDER_NAMES as readonly string[]).includes(name.toLowerCase());
}

function isTestFile(path: string): boolean {
  return (
    /(^|\/)__tests__\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
  );
}

function isInspectableSource(record: FileRecord): boolean {
  if (record.content === null) {
    return false;
  }
  return record.language === 'typescript' || record.language === 'javascript';
}

/**
 * Analyze a single placeholder identifier within a file. Returns the rename
 * targets and a safety verdict shared by both the detector and the fixer so
 * the two never disagree.
 */
function analyzeCandidate(
  content: string,
  mask: MaskResult,
  tokens: readonly TokenOccurrence[],
  name: string,
): CandidateAnalysis {
  const occurrences = tokens.filter((token) => token.name === name);
  const firstOffset = occurrences[0]?.index ?? 0;
  const kind = determineKind(mask.codeMask, name);

  const hasMemberAccess = occurrences.some((token) => token.memberAccess);
  const hasStringReference = mask.stringLiterals.some(
    (literal) => literal === name,
  );

  if (hasStringReference) {
    return {
      name,
      kind,
      renameOffsets: [],
      firstOffset,
      fixable: false,
      skipReason: `'${name}' is referenced from a string or dynamic context; renaming could alter observable behavior`,
    };
  }
  if (hasMemberAccess) {
    return {
      name,
      kind,
      renameOffsets: [],
      firstOffset,
      fixable: false,
      skipReason: `'${name}' is used as a member/property reference; renaming could alter observable behavior`,
    };
  }

  const renameOffsets = occurrences
    .filter((token) => !token.memberAccess)
    .map((token) => token.index);

  return {
    name,
    kind,
    renameOffsets,
    firstOffset,
    fixable: renameOffsets.length > 0,
  };
}

/** Distinct placeholder identifier names appearing in a file, in first-seen order. */
function placeholderNamesIn(
  tokens: readonly TokenOccurrence[],
): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const token of tokens) {
    if (isPlaceholderName(token.name) && !seen.has(token.name)) {
      seen.add(token.name);
      ordered.push(token.name);
    }
  }
  return ordered;
}

/** Compute a collision-free replacement name for `analysis` within the file. */
function computeReplacementName(
  codeMask: string,
  tokens: readonly TokenOccurrence[],
  analysis: CandidateAnalysis,
): string {
  const casing = majorityCasing(codeMask, analysis.kind, analysis.name);
  const baseWord =
    BASE_WORD_BY_PLACEHOLDER[analysis.name.toLowerCase()] ?? 'value';
  const base = applyCasing(baseWord, casing);

  const existing = new Set<string>();
  for (const token of tokens) {
    if (token.name !== analysis.name) {
      existing.add(token.name);
    }
  }

  if (!existing.has(base)) {
    return base;
  }
  let counter = 2;
  let candidate = withSuffix(base, casing, counter);
  while (existing.has(candidate)) {
    counter += 1;
    candidate = withSuffix(base, casing, counter);
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/**
 * Detect placeholder identifiers across the inventory. One finding is produced
 * per distinct placeholder identifier name per non-test source file
 * (Requirement 6.1). Findings whose path is not backed by a read record are
 * impossible here because every finding is built from a record in `records`.
 */
export function detectNaming(
  records: readonly FileRecord[],
): readonly Finding[] {
  const findings: Finding[] = [];

  for (const record of records) {
    if (isTestFile(record.path) || !isInspectableSource(record)) {
      continue;
    }
    const content = record.content;
    if (content === null) {
      continue;
    }

    const mask = maskSource(content);
    const tokens = scanTokens(mask.codeMask);

    for (const name of placeholderNamesIn(tokens)) {
      const analysis = analyzeCandidate(content, mask, tokens, name);
      findings.push({
        domain: 'naming',
        path: record.path,
        location: locationFromOffset(content, analysis.firstOffset),
        kind: 'placeholder-identifier',
        detail: analysis.fixable
          ? `Placeholder identifier '${name}' should be renamed to a descriptive name`
          : `Placeholder identifier '${name}' detected but not auto-renameable: ${analysis.skipReason ?? 'no static reference found'}`,
        autoFixable: analysis.fixable,
      });
    }
  }

  return findings;
}

/** The naming detector (Requirement 6.1). */
export const namingDetector: Detector = {
  domain: 'naming',
  detect: detectNaming,
};

// ---------------------------------------------------------------------------
// Fixer
// ---------------------------------------------------------------------------

function preserve(reason: string): FixOutcome {
  return { edits: [], preserved: true, preservationReason: reason };
}

/** Extract the identifier token that spans the given content offset. */
function identifierAt(content: string, offset: number): string | null {
  if (offset < 0 || offset >= content.length) {
    return null;
  }
  if (!/[A-Za-z_$]/.test(content[offset])) {
    return null;
  }
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_$]/.test(content[start - 1])) {
    start -= 1;
  }
  let end = offset;
  while (end < content.length && /[A-Za-z0-9_$]/.test(content[end])) {
    end += 1;
  }
  return content.slice(start, end);
}

/** Rewrite `content`, replacing the name at each offset with `replacement`. */
function rewriteOccurrences(
  content: string,
  offsets: readonly number[],
  nameLength: number,
  replacement: string,
): string {
  const sorted = [...offsets].sort((a, b) => a - b);
  let result = '';
  let cursor = 0;
  for (const offset of sorted) {
    result += content.slice(cursor, offset);
    result += replacement;
    cursor = offset + nameLength;
  }
  result += content.slice(cursor);
  return result;
}

/**
 * Rename the placeholder identifier described by `finding` within `record`,
 * updating every static reference (Requirement 6.2). Returns a single
 * whole-file `replace` Edit, or a preservation outcome when the identifier
 * cannot be renamed safely (Requirement 6.5).
 */
export function fixNaming(finding: Finding, record: FileRecord): FixOutcome {
  if (record.content === null) {
    return preserve(`file '${record.path}' could not be read; rename skipped`);
  }
  const content = record.content;

  const offset = offsetFromLocation(content, finding.location);
  const name = identifierAt(content, offset);
  if (name === null || !isPlaceholderName(name)) {
    return preserve(
      `no placeholder identifier found at ${record.path}:${finding.location.line ?? '?'}; rename skipped`,
    );
  }

  const mask = maskSource(content);
  const tokens = scanTokens(mask.codeMask);
  const analysis = analyzeCandidate(content, mask, tokens, name);

  if (!analysis.fixable) {
    return preserve(
      analysis.skipReason ??
        `'${name}' has no static reference to update; rename skipped`,
    );
  }

  const replacement = computeReplacementName(mask.codeMask, tokens, analysis);
  const newContent = rewriteOccurrences(
    content,
    analysis.renameOffsets,
    name.length,
    replacement,
  );

  const edit: Edit = {
    kind: 'replace',
    path: record.path,
    text: newContent,
    placeholderInserted: false,
  };

  return { edits: [edit], preserved: false };
}

/** The naming fixer (Requirements 6.2-6.5). */
export const namingFixer: Fixer = {
  domain: 'naming',
  fix: fixNaming,
};
