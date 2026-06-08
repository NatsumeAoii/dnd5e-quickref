// Feature: pre-ship-finalization
//
// TsJsSafetyDetector / Fixer (Requirement 10).
//
// Flags unsafe TypeScript / JavaScript patterns and proposes behavior-preserving
// fixes or annotations:
//   - unjustified `any` types               (10.1)
//   - unexplained `@ts-ignore` / `@ts-nocheck` directives (10.2)
//   - floating promises                      (10.3)
//   - `eval` calls and `innerHTML` assignment (10.4)
//   - `tsconfig` strict-mode verification     (10.5, 10.6)
//
// Like every domain in this toolkit these are PURE functions over file content:
// the detector returns `Finding[]`, the fixer returns a `FixOutcome` describing
// edits, and neither touches disk. The orchestrator's EditApplier (a later task)
// is the only component that mutates files.
//
// Source scanning is text-based (no TypeScript compiler dependency). To avoid
// matching inside string literals and comments, the scanner first masks those
// regions, then runs pattern matches against the masked text while keeping the
// original text for justification checks and edit extraction.

import type {
  CodeLocation,
  Detector,
  Domain,
  Edit,
  FileRecord,
  Finding,
  Fixer,
  FixOutcome,
} from '../types';

const DOMAIN: Domain = 'ts-js-safety';

/** Machine-readable finding kinds emitted by this detector. */
export const TS_JS_KINDS = {
  anyType: 'any-type',
  tsSuppression: 'ts-suppression',
  floatingPromise: 'floating-promise',
  evalCall: 'eval-call',
  innerHtml: 'inner-html-assignment',
  tsconfigStrict: 'tsconfig-strict-disabled',
} as const;

/**
 * The individual compiler flags that `strict: true` turns on. When `strict` is
 * not enabled, or an individual flag is explicitly disabled, the detector names
 * the specific setting (Requirement 10.6).
 */
const STRICT_FAMILY_FLAGS: readonly string[] = [
  'noImplicitAny',
  'noImplicitThis',
  'alwaysStrict',
  'strictBindCallApply',
  'strictFunctionTypes',
  'strictNullChecks',
  'strictPropertyInitialization',
  'useUnknownInCatchVariables',
];

// ---------------------------------------------------------------------------
// Text scanning helpers
// ---------------------------------------------------------------------------

/**
 * Returns a copy of `src` where every character inside a string literal,
 * template literal, line comment, or block comment is replaced by a space.
 * Newlines are preserved so that index→line/column mapping stays accurate.
 *
 * This lets pattern matching ignore occurrences of tokens (such as the word
 * `eval` or `any`) that appear inside strings or comments.
 */
function maskStringsAndComments(src: string): string {
  const out = src.split('');
  const n = src.length;
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let state: State = 'code';
  let i = 0;

  const blank = (index: number): void => {
    if (src[index] !== '\n') out[index] = ' ';
  };

  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : '';

    if (state === 'code') {
      if (c === '/' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        out[i] = ' ';
        out[i + 1] = ' ';
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'") {
        out[i] = ' ';
        state = 'single';
        i += 1;
        continue;
      }
      if (c === '"') {
        out[i] = ' ';
        state = 'double';
        i += 1;
        continue;
      }
      if (c === '`') {
        out[i] = ' ';
        state = 'template';
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        i += 1;
        continue;
      }
      out[i] = ' ';
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (c === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        state = 'code';
        i += 2;
        continue;
      }
      blank(i);
      i += 1;
      continue;
    }

    // String / template states.
    if (c === '\\') {
      blank(i);
      if (i + 1 < n) blank(i + 1);
      i += 2;
      continue;
    }
    if (
      (state === 'single' && c === "'") ||
      (state === 'double' && c === '"') ||
      (state === 'template' && c === '`')
    ) {
      out[i] = ' ';
      state = 'code';
      i += 1;
      continue;
    }
    blank(i);
    i += 1;
  }

  return out.join('');
}

/** Precomputed line metadata for fast index→location mapping. */
interface LineIndex {
  readonly lineStarts: readonly number[];
}

function buildLineIndex(src: string): LineIndex {
  const lineStarts: number[] = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') lineStarts.push(i + 1);
  }
  return { lineStarts };
}

/** Maps a 0-based character offset to a 1-based line/column location. */
function offsetToLocation(index: LineIndex, offset: number): CodeLocation {
  const { lineStarts } = index;
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - lineStarts[low] + 1 };
}

/** Returns the raw text of a 1-based line number, or '' when out of range. */
function lineText(lines: readonly string[], line1: number): string {
  return line1 >= 1 && line1 <= lines.length ? lines[line1 - 1] : '';
}

/**
 * True when the given 1-based source line carries an adjacent comment that can
 * serve as a justification: either a comment on the same line, or a non-empty
 * comment on the immediately preceding line.
 */
function hasAdjacentComment(
  lines: readonly string[],
  maskedLines: readonly string[],
  line1: number,
): boolean {
  if (lineHasComment(lines, maskedLines, line1)) return true;
  // A preceding comment-only line is also "adjacent".
  for (let probe = line1 - 1; probe >= 1; probe--) {
    const raw = lineText(lines, probe).trim();
    if (raw === '') continue; // skip blank lines
    return isCommentOnlyLine(lines, maskedLines, probe);
  }
  return false;
}

/** True when a line contains a comment somewhere (line or block). */
function lineHasComment(
  lines: readonly string[],
  maskedLines: readonly string[],
  line1: number,
): boolean {
  return extractCommentText(lineText(lines, line1), maskedLines[line1 - 1] ?? '') !== '';
}

/** True when, after removing comments, a line has no executable code. */
function isCommentOnlyLine(
  lines: readonly string[],
  maskedLines: readonly string[],
  line1: number,
): boolean {
  const masked = maskedLines[line1 - 1] ?? '';
  const raw = lineText(lines, line1);
  const hasComment = extractCommentText(raw, masked) !== '';
  return hasComment && masked.trim() === '';
}

/**
 * Extracts the visible comment text on a line by diffing the raw line against
 * its masked counterpart: positions blanked in the mask but non-space in the
 * raw line belong to a string or comment. We then keep only the segments that
 * follow a comment opener so string contents are excluded.
 */
function extractCommentText(raw: string, masked: string): string {
  const lineCommentIndex = findCommentOpener(raw, masked, '//');
  const blockCommentIndex = findCommentOpener(raw, masked, '/*');
  let start = -1;
  if (lineCommentIndex >= 0) start = lineCommentIndex;
  if (blockCommentIndex >= 0 && (start < 0 || blockCommentIndex < start)) {
    start = blockCommentIndex;
  }
  if (start < 0) return '';
  return raw
    .slice(start)
    .replace(/^\/\/+/, '')
    .replace(/^\/\*+/, '')
    .replace(/\*+\/\s*$/, '')
    .trim();
}

/** Finds the index of a comment opener that the mask confirms is a comment. */
function findCommentOpener(raw: string, masked: string, opener: string): number {
  let from = 0;
  for (;;) {
    const idx = raw.indexOf(opener, from);
    if (idx < 0) return -1;
    // Confirmed a comment when the masking blanked these characters.
    if (masked[idx] === ' ' && masked[idx + 1] === ' ') return idx;
    from = idx + 1;
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function isScriptLanguage(record: FileRecord): boolean {
  return record.language === 'typescript' || record.language === 'javascript';
}

function isTsconfig(record: FileRecord): boolean {
  return /(^|\/)tsconfig[^/]*\.json$/.test(record.path);
}

/** Detects unjustified `any` type usages in a masked source string. */
function detectAnyTypes(
  path: string,
  masked: string,
  lineIndex: LineIndex,
  lines: readonly string[],
  maskedLines: readonly string[],
): Finding[] {
  const findings: Finding[] = [];
  // `any` appearing in type position: `: any`, `as any`, `<any`, `any[]`,
  // `| any`, `& any`, `Array<any>` etc. The leading group anchors the match to
  // a type context to avoid matching identifiers that merely contain "any".
  const pattern = /(?::|\bas\b|<|\||&|,)\s*(any)\b|\b(any)\s*\[\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) {
    const groupIndex = match[0].lastIndexOf('any');
    const offset = match.index + groupIndex;
    const location = offsetToLocation(lineIndex, offset);
    if (hasAdjacentComment(lines, maskedLines, location.line ?? 1)) continue;
    findings.push({
      domain: DOMAIN,
      path,
      location,
      kind: TS_JS_KINDS.anyType,
      detail:
        'Unjustified `any` type. Replace it with a specific type or add an ' +
        'adjacent comment explaining why a precise type is unavailable.',
      autoFixable: true,
    });
  }
  return findings;
}

/** Detects unexplained `@ts-ignore` / `@ts-nocheck` directives. */
function detectTypeSuppressions(
  path: string,
  lines: readonly string[],
  maskedLines: readonly string[],
): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const directiveMatch = /@ts-(ignore|nocheck)\b/.exec(raw);
    if (!directiveMatch) continue;
    const directive = `@ts-${directiveMatch[1]}`;
    // Explanation present when the directive comment carries extra text, or the
    // preceding line is an explanatory comment.
    const commentText = extractCommentText(raw, maskedLines[i] ?? '');
    const remainder = commentText
      .replace(/@ts-(ignore|nocheck)\b/, '')
      .replace(/^[\s:.\-—]+/, '')
      .trim();
    const explainedInline = remainder.length > 0;
    const explainedAbove = i > 0 && isCommentOnlyLine(lines, maskedLines, i);
    if (explainedInline || explainedAbove) continue;
    const column = raw.indexOf(directive) + 1;
    findings.push({
      domain: DOMAIN,
      path,
      location: { line: i + 1, column },
      kind: TS_JS_KINDS.tsSuppression,
      detail:
        `Unexplained \`${directive}\` directive. Correct the underlying type ` +
        'error and remove it, or add an adjacent comment stating why it is required.',
      autoFixable: true,
    });
  }
  return findings;
}

/**
 * Detects likely floating promises: expression-statement calls that look
 * promise-returning yet are not awaited, returned, voided, assigned, chained
 * with `.catch`, or annotated as intentionally unhandled.
 *
 * Purely textual detection is necessarily heuristic (no type information), so
 * this stays conservative: it only flags calls whose shape strongly implies a
 * promise (`fetch(...)`, `somethingAsync(...)`, or a `.then(...)` chain).
 */
function detectFloatingPromises(
  path: string,
  lineIndex: LineIndex,
  lines: readonly string[],
  maskedLines: readonly string[],
): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < maskedLines.length; i++) {
    const maskedLine = maskedLines[i];
    const trimmed = maskedLine.trim();
    if (trimmed === '') continue;

    // Must look like a standalone call statement.
    const isCallStatement = /^[\w$.[\]]+\s*\(.*\)\s*;?$/.test(trimmed) || trimmed.includes('.then(');
    if (!isCallStatement) continue;

    // Already handled or not an expression statement.
    if (/^(await|return|void|yield|const|let|var|import|export|if|for|while|switch)\b/.test(trimmed)) {
      continue;
    }
    // Assignment (handled / captured) — skip when `=` precedes the first call.
    const firstParen = trimmed.indexOf('(');
    const beforeParen = firstParen >= 0 ? trimmed.slice(0, firstParen) : trimmed;
    if (/[^=!<>]=[^=]/.test(beforeParen) || beforeParen.includes('=>')) continue;

    const looksPromise =
      /\bfetch\s*\(/.test(trimmed) ||
      /\b\w+Async\s*\(/.test(trimmed) ||
      /\.then\s*\(/.test(trimmed) ||
      /\bPromise\s*\.\s*(all|race|allSettled|any|resolve|reject)\s*\(/.test(trimmed);
    if (!looksPromise) continue;

    // A `.catch(...)` in the same statement means the rejection is handled.
    if (/\.catch\s*\(/.test(trimmed)) continue;

    // Adjacent comment marking it intentionally unhandled.
    if (hasAdjacentComment(lines, maskedLines, i + 1)) continue;

    const column = maskedLine.length - maskedLine.trimStart().length + 1;
    findings.push({
      domain: DOMAIN,
      path,
      location: offsetToLocation(lineIndex, lineIndex.lineStarts[i] + column - 1),
      kind: TS_JS_KINDS.floatingPromise,
      detail:
        'Floating promise. Await it, return it, or mark it as intentionally ' +
        'unhandled with an adjacent comment.',
      autoFixable: true,
    });
  }
  return findings;
}

/** Detects `eval(...)` calls in masked source. */
function detectEval(
  path: string,
  masked: string,
  lineIndex: LineIndex,
): Finding[] {
  const findings: Finding[] = [];
  const pattern = /\beval\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) {
    // Skip member access like `foo.eval(` which is not the global eval.
    if (match.index > 0 && masked[match.index - 1] === '.') continue;
    findings.push({
      domain: DOMAIN,
      path,
      location: offsetToLocation(lineIndex, match.index),
      kind: TS_JS_KINDS.evalCall,
      detail:
        'Use of `eval`. Replace it with a construct that produces the same ' +
        'output without executing a dynamically constructed string as code.',
      // Only the trivially-safe cases can be auto-replaced; the fixer decides.
      autoFixable: false,
    });
  }
  return findings;
}

/** Detects assignment to `.innerHTML` (including `+=`). */
function detectInnerHtml(
  path: string,
  masked: string,
  lineIndex: LineIndex,
): Finding[] {
  const findings: Finding[] = [];
  const pattern = /\.innerHTML\s*\+?=(?!=)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) {
    findings.push({
      domain: DOMAIN,
      path,
      location: offsetToLocation(lineIndex, match.index),
      kind: TS_JS_KINDS.innerHtml,
      detail:
        'Assignment to `innerHTML`. Replace it with a construct that produces ' +
        'the same output without executing dynamically constructed markup.',
      autoFixable: false,
    });
  }
  return findings;
}

/**
 * Strips comments from a JSONC string so it can be parsed with `JSON.parse`.
 * tsconfig files permit `//` and block comments.
 */
function stripJsonComments(src: string): string {
  return maskStringsAndCommentsKeepStrings(src);
}

/**
 * Like {@link maskStringsAndComments} but only blanks comments, preserving
 * string contents so the result remains valid JSON.
 */
function maskStringsAndCommentsKeepStrings(src: string): string {
  const out = src.split('');
  const n = src.length;
  type State = 'code' | 'line' | 'block' | 'string';
  let state: State = 'code';
  let i = 0;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        out[i] = ' ';
        out[i + 1] = ' ';
        state = 'block';
        i += 2;
        continue;
      }
      if (c === '"') {
        state = 'string';
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') state = 'code';
      else out[i] = ' ';
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        state = 'code';
        i += 2;
        continue;
      }
      if (c !== '\n') out[i] = ' ';
      i += 1;
      continue;
    }
    // string
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '"') state = 'code';
    i += 1;
  }
  return out.join('');
}

interface TsconfigOptions {
  readonly compilerOptions: Record<string, unknown>;
  readonly extends?: string;
}

function parseTsconfig(content: string): TsconfigOptions | null {
  try {
    const parsed = JSON.parse(stripJsonComments(content)) as {
      compilerOptions?: Record<string, unknown>;
      extends?: unknown;
    };
    return {
      compilerOptions: parsed.compilerOptions ?? {},
      extends: typeof parsed.extends === 'string' ? parsed.extends : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the effective compiler options for a tsconfig by merging its
 * `extends` chain (base first, then the file's own options) using only configs
 * available in the current record set. Bounded to avoid cyclic extends.
 */
function resolveEffectiveOptions(
  record: FileRecord,
  byPath: ReadonlyMap<string, FileRecord>,
): Record<string, unknown> | null {
  const seen = new Set<string>();
  const merge = (current: FileRecord): Record<string, unknown> | null => {
    if (seen.has(current.path) || current.content === null) return null;
    seen.add(current.path);
    const parsed = parseTsconfig(current.content);
    if (parsed === null) return null;
    let base: Record<string, unknown> = {};
    if (parsed.extends) {
      const basePath = resolveRelative(current.path, parsed.extends);
      const baseRecord = byPath.get(basePath) ?? byPath.get(`${basePath}.json`);
      if (baseRecord) {
        const resolved = merge(baseRecord);
        if (resolved) base = resolved;
      }
    }
    return { ...base, ...parsed.compilerOptions };
  };
  return merge(record);
}

/** Resolves a POSIX relative path against the directory of `fromPath`. */
function resolveRelative(fromPath: string, target: string): string {
  const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const segments = (fromDir ? `${fromDir}/${target}` : target).split('/');
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') stack.pop();
    else stack.push(segment);
  }
  return stack.join('/');
}

/**
 * Verifies tsconfig strict mode (Requirement 10.5) and, when it is not enabled,
 * reports the specific disabled setting (Requirement 10.6). The finding is not
 * auto-fixable: the fixer preserves the tsconfig unchanged.
 */
function detectTsconfigStrict(
  record: FileRecord,
  byPath: ReadonlyMap<string, FileRecord>,
): Finding[] {
  const options = resolveEffectiveOptions(record, byPath);
  if (options === null) return [];

  const strict = options['strict'];
  const disabled: string[] = [];
  if (strict !== true) {
    disabled.push('strict');
  }
  // Even with `strict: true`, an individual flag may be explicitly turned off.
  for (const flag of STRICT_FAMILY_FLAGS) {
    if (options[flag] === false) disabled.push(flag);
  }
  if (disabled.length === 0) return [];

  return [
    {
      domain: DOMAIN,
      path: record.path,
      location: { line: 1, column: 1 },
      kind: TS_JS_KINDS.tsconfigStrict,
      detail:
        `tsconfig strict mode is not fully enabled. Disabled setting(s): ` +
        `${disabled.join(', ')}. The tsconfig is left unchanged (Requirement 10.6).`,
      autoFixable: false,
    },
  ];
}

/**
 * Detects all Requirement-10 safety findings across the inventory. Pure: takes
 * read records, returns findings whose `path` is always a record in the input.
 */
export function detectTsJsSafety(records: readonly FileRecord[]): readonly Finding[] {
  const findings: Finding[] = [];
  const byPath = new Map<string, FileRecord>();
  for (const record of records) byPath.set(record.path, record);

  for (const record of records) {
    if (isTsconfig(record) && record.content !== null) {
      findings.push(...detectTsconfigStrict(record, byPath));
      continue;
    }
    if (!isScriptLanguage(record) || record.content === null) continue;

    const content = record.content;
    const masked = maskStringsAndComments(content);
    const lineIndex = buildLineIndex(content);
    const lines = content.split('\n');
    const maskedLines = masked.split('\n');

    findings.push(...detectAnyTypes(record.path, masked, lineIndex, lines, maskedLines));
    findings.push(...detectTypeSuppressions(record.path, lines, maskedLines));
    findings.push(...detectFloatingPromises(record.path, lineIndex, lines, maskedLines));
    findings.push(...detectEval(record.path, masked, lineIndex));
    findings.push(...detectInnerHtml(record.path, masked, lineIndex));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Fixing
// ---------------------------------------------------------------------------

/** Returns the leading whitespace of a line, used to indent inserted comments. */
function leadingIndent(line: string): string {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0] : '';
}

/** Builds an `insert` edit that adds a comment line above `line1`. */
function insertCommentAbove(
  path: string,
  lines: readonly string[],
  line1: number,
  comment: string,
): Edit {
  const indent = leadingIndent(lineText(lines, line1));
  return {
    kind: 'insert',
    path,
    range: { line: line1, column: 1 },
    text: `${indent}// ${comment}\n`,
    placeholderInserted: false,
  };
}

function annotateAny(path: string, lines: readonly string[], finding: Finding): FixOutcome {
  const line = finding.location.line ?? 1;
  return {
    edits: [
      insertCommentAbove(
        path,
        lines,
        line,
        'Reason: a precise type is not available here; `any` is used intentionally.',
      ),
    ],
    preserved: false,
  };
}

function annotateSuppression(
  path: string,
  lines: readonly string[],
  finding: Finding,
): FixOutcome {
  const line = finding.location.line ?? 1;
  return {
    edits: [
      insertCommentAbove(
        path,
        lines,
        line,
        'Reason: this type-suppression directive is required; underlying error cannot be resolved here.',
      ),
    ],
    preserved: false,
  };
}

function annotateFloatingPromise(
  path: string,
  lines: readonly string[],
  finding: Finding,
): FixOutcome {
  const line = finding.location.line ?? 1;
  return {
    edits: [
      insertCommentAbove(
        path,
        lines,
        line,
        'Intentionally unhandled promise (fire-and-forget); failures do not affect this path.',
      ),
    ],
    preserved: false,
  };
}

/**
 * Fixes an `innerHTML` assignment when it is a provably safe equivalence:
 * clearing the element (`= ''`) becomes `replaceChildren()`, which produces an
 * identical DOM without parsing markup. All other assignments are preserved
 * with a recorded reason, since a general behavior-preserving rewrite cannot be
 * guaranteed from text alone.
 */
function fixInnerHtml(
  path: string,
  record: FileRecord,
  finding: Finding,
): FixOutcome {
  const content = record.content ?? '';
  const lineIndex = buildLineIndex(content);
  const line = finding.location.line ?? 1;
  const column = finding.location.column ?? 1;
  const offset = lineIndex.lineStarts[line - 1] + column - 1;
  // Match `.innerHTML = ''` / `""` / empty template, optionally with `;`.
  const emptyAssign = /^\.innerHTML\s*=\s*(?:''|""|``)\s*/.exec(content.slice(offset));
  if (emptyAssign) {
    const endLocation = offsetToLocation(lineIndex, offset + emptyAssign[0].length);
    return {
      edits: [
        {
          kind: 'replace',
          path,
          range: {
            line,
            column,
            // Encode the end position via tag so the applier can span the match.
            tag: `to:${endLocation.line}:${endLocation.column}`,
          },
          text: '.replaceChildren()',
          placeholderInserted: false,
        },
      ],
      preserved: false,
    };
  }
  return {
    edits: [],
    preserved: true,
    preservationReason:
      'innerHTML assigns non-empty content; a general rewrite cannot guarantee ' +
      'identical observable output without executing the markup. Sanitize or ' +
      'build the DOM explicitly before shipping.',
  };
}

/**
 * `eval` has no universal behavior-preserving textual rewrite, so it is
 * preserved with a recorded reason for manual replacement. The detector still
 * reports it so it appears in the Finalization Summary.
 */
function preserveEval(): FixOutcome {
  return {
    edits: [],
    preserved: true,
    preservationReason:
      '`eval` cannot be rewritten automatically while guaranteeing identical ' +
      'output. Replace it manually with a non-eval construct (e.g. JSON.parse ' +
      'or a lookup table).',
  };
}

/** tsconfig is left unchanged per Requirement 10.6; report only. */
function preserveTsconfig(): FixOutcome {
  return {
    edits: [],
    preserved: true,
    preservationReason:
      'tsconfig configuration is left unchanged; the disabled strict setting is ' +
      'reported for manual resolution (Requirement 10.6).',
  };
}

/**
 * Produces the edits required to resolve a single TS/JS safety finding, or a
 * preservation outcome when the finding must be left as-is. Pure: never writes.
 */
export function fixTsJsSafety(finding: Finding, record: FileRecord): FixOutcome {
  if (finding.domain !== DOMAIN || finding.path !== record.path) {
    return {
      edits: [],
      preserved: true,
      preservationReason: 'Finding does not belong to this record or domain.',
    };
  }
  const lines = (record.content ?? '').split('\n');

  switch (finding.kind) {
    case TS_JS_KINDS.anyType:
      return annotateAny(finding.path, lines, finding);
    case TS_JS_KINDS.tsSuppression:
      return annotateSuppression(finding.path, lines, finding);
    case TS_JS_KINDS.floatingPromise:
      return annotateFloatingPromise(finding.path, lines, finding);
    case TS_JS_KINDS.innerHtml:
      return fixInnerHtml(finding.path, record, finding);
    case TS_JS_KINDS.evalCall:
      return preserveEval();
    case TS_JS_KINDS.tsconfigStrict:
      return preserveTsconfig();
    default:
      return {
        edits: [],
        preserved: true,
        preservationReason: `Unrecognized finding kind: ${finding.kind}.`,
      };
  }
}

/** Pure detector for the `ts-js-safety` domain. */
export const tsJsSafetyDetector: Detector = {
  domain: DOMAIN,
  detect: detectTsJsSafety,
};

/** Pure fixer for the `ts-js-safety` domain. */
export const tsJsSafetyFixer: Fixer = {
  domain: DOMAIN,
  fix: fixTsJsSafety,
};
