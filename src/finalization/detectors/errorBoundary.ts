// Feature: pre-ship-finalization
//
// ErrorBoundaryDetector / Fixer (Requirement 5).
//
// Pure, deterministic analysis of error handling at external, I/O, and async
// boundaries. This module performs NO I/O: detectors take file content (via
// `FileRecord`) and return `Finding[]`; the fixer takes a finding plus its
// backing record and returns a `FixOutcome` describing the edits required to
// resolve it (or a preservation outcome when the finding must stand).
//
// Three defect classes are handled:
//   - 'empty-catch'             empty catch blocks that silently swallow errors (5.1)
//   - 'raw-error-exposure'      raw stack/path/message shown to the end user (5.2, 5.3)
//   - 'unguarded-boundary-call' external/IO/async calls with no error handling (5.4)
//
// Every fix preserves success-path observable outputs (5.5): empty-catch fixes
// only add a developer log (they do not change whether the error propagates),
// raw-exposure fixes only change the error-path message while logging the
// original detail, and unguarded-call fixes wrap the unchanged statement in a
// guard so the success path runs identically.
//
// Note on parsing: this module masks strings and comments before scanning so
// that braces, keywords, and call patterns are matched only in real code. It is
// a lightweight scanner, not a full lexer, so unusual constructs (for example a
// regular-expression literal containing quote or brace characters) may be
// scanned imprecisely. When a fix cannot be guaranteed behavior-preserving the
// fixer preserves the artifact with a recorded reason instead of guessing.

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
// Finding kinds (machine-readable `Finding.kind` values for this domain).
// ---------------------------------------------------------------------------

export const KIND_EMPTY_CATCH = 'empty-catch';
export const KIND_RAW_ERROR_EXPOSURE = 'raw-error-exposure';
export const KIND_UNGUARDED_BOUNDARY_CALL = 'unguarded-boundary-call';

/** Default error binding name used when a catch clause has no parameter. */
const DEFAULT_ERROR_BINDING = 'error';

/** Languages this domain inspects. Non-code files are ignored. */
const INSPECTED_LANGUAGES = new Set(['typescript', 'javascript']);

/**
 * External / I/O / async boundary call patterns. A match is a candidate
 * "unguarded boundary call" unless it sits inside a `try` block or has a
 * chained `.catch(...)` rejection handler. Patterns run against masked code
 * (strings and comments blanked) so matches inside literals are never flagged.
 */
const BOUNDARY_CALL_PATTERNS: readonly { readonly name: string; readonly regex: RegExp }[] = [
  { name: 'fetch', regex: /\bfetch\s*\(/g },
  { name: 'XMLHttpRequest', regex: /\bnew\s+XMLHttpRequest\b/g },
  { name: 'JSON.parse', regex: /\bJSON\s*\.\s*parse\s*\(/g },
  {
    name: 'fs',
    regex: /\b(?:readFile|writeFile|appendFile|readFileSync|writeFileSync|appendFileSync|mkdir|mkdirSync|unlink|unlinkSync)\s*\(/g,
  },
  {
    name: 'storage',
    regex: /\b(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem|clear)\s*\(/g,
  },
];

/** Keywords that look like a call/declaration but are not function names. */
const NON_NAME_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'do', 'with', 'else',
]);

// ---------------------------------------------------------------------------
// Internal artifact models (shared by detect and fix so logic is single-sourced).
// ---------------------------------------------------------------------------

interface EmptyCatchArtifact {
  readonly kind: typeof KIND_EMPTY_CATCH;
  readonly catchIndex: number;
  readonly bodyEnd: number; // index of the closing `}` of the catch body
  readonly paramName: string;
  readonly indent: string;
  readonly operation: string;
  readonly location: CodeLocation;
}

interface RawExposureArtifact {
  readonly kind: typeof KIND_RAW_ERROR_EXPOSURE;
  readonly exposureKind: 'sink' | 'alert';
  readonly stmtStart: number;
  readonly stmtEnd: number; // index just past the terminating `;`
  readonly lhs: string; // assignment target (sink) — empty for alert
  readonly expr: string; // error expression being exposed
  readonly indent: string;
  readonly operation: string;
  readonly location: CodeLocation;
}

interface UnguardedCallArtifact {
  readonly kind: typeof KIND_UNGUARDED_BOUNDARY_CALL;
  readonly callName: string;
  readonly stmtStart: number;
  readonly stmtEnd: number; // index just past the terminating `;`
  readonly indent: string;
  readonly operation: string;
  readonly autoFixable: boolean;
  readonly preservationReason?: string;
  readonly location: CodeLocation;
}

// ---------------------------------------------------------------------------
// Scanner helpers.
// ---------------------------------------------------------------------------

/**
 * Returns a copy of `content` with the inside of every string literal, template
 * literal, and comment replaced by spaces, while preserving newlines (and thus
 * every character offset and line number). Code outside literals/comments —
 * including template interpolation expressions — is left intact so that braces,
 * keywords, and call patterns can be matched reliably.
 */
export function maskStringsAndComments(content: string): string {
  const chars = content.split('');
  const n = content.length;
  const blank = (idx: number): void => {
    if (content[idx] !== '\n' && content[idx] !== '\r') chars[idx] = ' ';
  };

  type Ctx = { type: 'normal' | 'template'; depth: number };
  const stack: Ctx[] = [{ type: 'normal', depth: 0 }];
  let i = 0;

  while (i < n) {
    const top = stack[stack.length - 1];
    const c = content[i];
    const next = i + 1 < n ? content[i + 1] : '';

    if (top.type === 'normal') {
      if (c === '/' && next === '/') {
        while (i < n && content[i] !== '\n') {
          blank(i);
          i++;
        }
        continue;
      }
      if (c === '/' && next === '*') {
        blank(i);
        blank(i + 1);
        i += 2;
        while (i < n && !(content[i] === '*' && content[i + 1] === '/')) {
          blank(i);
          i++;
        }
        if (i < n) {
          blank(i);
          blank(i + 1);
          i += 2;
        }
        continue;
      }
      if (c === "'" || c === '"') {
        const quote = c;
        blank(i);
        i++;
        while (i < n && content[i] !== quote) {
          if (content[i] === '\\') {
            blank(i);
            blank(i + 1);
            i += 2;
            continue;
          }
          if (content[i] === '\n') break; // unterminated literal; stop blanking
          blank(i);
          i++;
        }
        if (i < n && content[i] === quote) {
          blank(i);
          i++;
        }
        continue;
      }
      if (c === '`') {
        blank(i);
        i++;
        stack.push({ type: 'template', depth: 0 });
        continue;
      }
      if (c === '{') {
        top.depth++;
        i++;
        continue;
      }
      if (c === '}') {
        if (top.depth === 0 && stack.length > 1) {
          // Closes a `${ ... }` interpolation; return to the template context.
          blank(i);
          i++;
          stack.pop();
          continue;
        }
        if (top.depth > 0) top.depth--;
        i++;
        continue;
      }
      i++;
      continue;
    }

    // template context
    if (c === '\\') {
      blank(i);
      blank(i + 1);
      i += 2;
      continue;
    }
    if (c === '`') {
      blank(i);
      i++;
      stack.pop();
      continue;
    }
    if (c === '$' && next === '{') {
      blank(i);
      blank(i + 1);
      i += 2;
      stack.push({ type: 'normal', depth: 0 });
      continue;
    }
    blank(i);
    i++;
  }

  return chars.join('');
}

/** Computes the 1-based line and column for a character index. */
function locate(content: string, index: number): CodeLocation {
  let line = 1;
  let column = 1;
  const limit = Math.min(index, content.length);
  for (let i = 0; i < limit; i++) {
    if (content[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

/** Returns the index of the `}` matching the `{` at `openIndex` (masked input). */
function matchBrace(masked: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Leading whitespace of the line containing `index`. */
function lineIndent(content: string, index: number): string {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  let end = lineStart;
  while (end < content.length && (content[end] === ' ' || content[end] === '\t')) end++;
  return content.slice(lineStart, end);
}

/** First non-whitespace index of the statement containing `index` (masked). */
function statementStart(masked: string, index: number): number {
  let i = index - 1;
  while (i >= 0) {
    const c = masked[i];
    if (c === ';' || c === '{' || c === '}') break;
    i--;
  }
  let start = i + 1;
  while (start < masked.length && /\s/.test(masked[start])) start++;
  return start;
}

/** Index just past the `;` ending the statement at `fromIndex`, else line end. */
function statementEnd(masked: string, fromIndex: number): number {
  for (let i = fromIndex; i < masked.length; i++) {
    if (masked[i] === ';') return i + 1;
    if (masked[i] === '\n') return i;
  }
  return masked.length;
}

/** Try-statement body ranges `[openBraceIndex, closeBraceIndex]` (masked). */
function tryBodyRanges(masked: string): readonly (readonly [number, number])[] {
  const ranges: [number, number][] = [];
  const re = /\btry\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked)) !== null) {
    const open = masked.indexOf('{', match.index);
    if (open === -1) continue;
    const close = matchBrace(masked, open);
    if (close === -1) continue;
    ranges.push([open, close]);
  }
  return ranges;
}

function isInsideAnyRange(
  index: number,
  ranges: readonly (readonly [number, number])[],
): boolean {
  return ranges.some(([start, end]) => index > start && index < end);
}

/**
 * Best-effort name of the function enclosing `index`, used to label the failed
 * operation in logs and user messages. Falls back to 'operation' when no
 * enclosing function can be identified.
 */
function enclosingOperation(masked: string, index: number): string {
  const region = masked.slice(0, index);
  const candidates: { idx: number; name: string }[] = [];

  const pushAll = (regex: RegExp, group: number): void => {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(region)) !== null) {
      const name = m[group];
      if (name && !NON_NAME_KEYWORDS.has(name)) candidates.push({ idx: m.index, name });
    }
  };

  pushAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g, 1);
  pushAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>)/g,
    1,
  );
  pushAll(/\b([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g, 1);

  if (candidates.length === 0) return 'operation';
  candidates.sort((a, b) => a.idx - b.idx);
  return candidates[candidates.length - 1].name;
}

// ---------------------------------------------------------------------------
// Detection.
// ---------------------------------------------------------------------------

/** Finds empty catch blocks (catch bodies with no executable statements). */
export function findEmptyCatches(content: string): readonly EmptyCatchArtifact[] {
  const masked = maskStringsAndComments(content);
  const results: EmptyCatchArtifact[] = [];
  const re = /\bcatch\b/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(masked)) !== null) {
    const catchIndex = match.index;
    let cursor = catchIndex + 'catch'.length;
    while (cursor < masked.length && /\s/.test(masked[cursor])) cursor++;

    let paramName = '';
    if (masked[cursor] === '(') {
      const closeParen = masked.indexOf(')', cursor);
      if (closeParen === -1) continue;
      paramName = content.slice(cursor + 1, closeParen).trim();
      cursor = closeParen + 1;
      while (cursor < masked.length && /\s/.test(masked[cursor])) cursor++;
    }

    if (masked[cursor] !== '{') continue;
    const bodyOpen = cursor;
    const bodyEnd = matchBrace(masked, bodyOpen);
    if (bodyEnd === -1) continue;

    const body = masked.slice(bodyOpen + 1, bodyEnd);
    if (body.trim() !== '') continue; // has executable statements

    results.push({
      kind: KIND_EMPTY_CATCH,
      catchIndex,
      bodyEnd,
      paramName: paramName === '' ? DEFAULT_ERROR_BINDING : paramName,
      indent: lineIndent(content, catchIndex),
      operation: enclosingOperation(masked, catchIndex),
      location: locate(content, catchIndex),
    });
  }

  return results;
}

/** Whether a masked expression exposes raw error stack/message detail. */
function exposesRawErrorDetail(maskedExpr: string): boolean {
  return /\.(?:stack|message)\b/.test(maskedExpr) || /\b(?:error|err|exception)\b/.test(maskedExpr);
}

/**
 * Finds raw error detail exposed to the user via a DOM text/markup sink or an
 * `alert(...)` call.
 */
export function findRawExposures(content: string): readonly RawExposureArtifact[] {
  const masked = maskStringsAndComments(content);
  const results: RawExposureArtifact[] = [];

  // DOM sink assignments: <expr>.textContent|innerText|innerHTML|outerHTML = <expr>;
  const sinkRe = /\.(?:textContent|innerText|innerHTML|outerHTML)\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = sinkRe.exec(masked)) !== null) {
    const eqIndex = m.index + m[0].length - 1;
    const stmtStart = statementStart(masked, m.index);
    const stmtEnd = statementEnd(masked, eqIndex);
    const rhsMasked = masked.slice(eqIndex + 1, stmtEnd).replace(/;?\s*$/, '');
    if (!exposesRawErrorDetail(rhsMasked)) continue;

    const lhs = content.slice(stmtStart, eqIndex).trim();
    const rhs = content.slice(eqIndex + 1, stmtEnd).replace(/;?\s*$/, '').trim();
    results.push({
      kind: KIND_RAW_ERROR_EXPOSURE,
      exposureKind: 'sink',
      stmtStart,
      stmtEnd,
      lhs,
      expr: rhs,
      indent: lineIndent(content, stmtStart),
      operation: enclosingOperation(masked, stmtStart),
      location: locate(content, stmtStart),
    });
  }

  // alert(...) / window.alert(...)
  const alertRe = /\b(?:window\s*\.\s*)?alert\s*\(/g;
  while ((m = alertRe.exec(masked)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const closeParen = matchParen(masked, openParen);
    if (closeParen === -1) continue;
    const argsMasked = masked.slice(openParen + 1, closeParen);
    if (!exposesRawErrorDetail(argsMasked)) continue;

    const stmtStart = statementStart(masked, m.index);
    const stmtEnd = statementEnd(masked, closeParen);
    const args = content.slice(openParen + 1, closeParen).trim();
    results.push({
      kind: KIND_RAW_ERROR_EXPOSURE,
      exposureKind: 'alert',
      stmtStart,
      stmtEnd,
      lhs: '',
      expr: args,
      indent: lineIndent(content, stmtStart),
      operation: enclosingOperation(masked, stmtStart),
      location: locate(content, stmtStart),
    });
  }

  results.sort((a, b) => a.stmtStart - b.stmtStart);
  return results;
}

/** Returns the index of the `)` matching the `(` at `openIndex` (masked input). */
function matchParen(masked: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Finds external / I/O / async boundary calls lacking surrounding handling. */
export function findUnguardedCalls(content: string): readonly UnguardedCallArtifact[] {
  const masked = maskStringsAndComments(content);
  const tryRanges = tryBodyRanges(masked);
  const results: UnguardedCallArtifact[] = [];
  const seen = new Set<number>();

  for (const { name, regex } of BOUNDARY_CALL_PATTERNS) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(masked)) !== null) {
      const callIndex = m.index;
      if (seen.has(callIndex)) continue;
      if (isInsideAnyRange(callIndex, tryRanges)) continue; // guarded by try

      const stmtStart = statementStart(masked, callIndex);
      const stmtEnd = statementEnd(masked, callIndex);
      const stmtMasked = masked.slice(stmtStart, stmtEnd);

      // A chained rejection handler already guards the call.
      if (/\.\s*catch\s*\(/.test(stmtMasked)) continue;

      seen.add(callIndex);

      // Auto-fixable only when the call is a standalone expression statement:
      // wrapping an assignment/return/declaration in a try block would move the
      // bound name out of scope and could alter observable behavior (5.5).
      const prefixMasked = masked.slice(stmtStart, callIndex);
      const consumed = /[=:]|(?:^|\b)(?:return|const|let|var|export|await\s+\w+\s*=)\b/.test(prefixMasked);
      const autoFixable = !consumed;

      results.push({
        kind: KIND_UNGUARDED_BOUNDARY_CALL,
        callName: name,
        stmtStart,
        stmtEnd,
        indent: lineIndent(content, stmtStart),
        operation: enclosingOperation(masked, stmtStart),
        autoFixable,
        preservationReason: autoFixable
          ? undefined
          : `${name} result is consumed by an assignment, declaration, or return; wrapping it in a guard would change binding scope, so it requires a manual refactor to preserve observable behavior`,
        location: locate(content, stmtStart),
      });
    }
  }

  results.sort((a, b) => a.stmtStart - b.stmtStart);
  return results;
}

// ---------------------------------------------------------------------------
// Detector.
// ---------------------------------------------------------------------------

function detectInRecord(record: FileRecord): Finding[] {
  if (record.content === null || !INSPECTED_LANGUAGES.has(record.language)) return [];
  const content = record.content;
  const findings: Finding[] = [];

  for (const artifact of findEmptyCatches(content)) {
    findings.push({
      domain: 'error-boundary',
      path: record.path,
      location: artifact.location,
      kind: KIND_EMPTY_CATCH,
      detail: `Empty catch block silently swallows errors in '${artifact.operation}'. Add logging, rethrow, or a recovery path.`,
      autoFixable: true,
    });
  }

  for (const artifact of findRawExposures(content)) {
    findings.push({
      domain: 'error-boundary',
      path: record.path,
      location: artifact.location,
      kind: KIND_RAW_ERROR_EXPOSURE,
      detail: `Raw error detail is exposed to the user via ${artifact.exposureKind === 'alert' ? 'alert()' : 'a DOM sink'} in '${artifact.operation}'. Show a sanitized message and log the detail for developers.`,
      autoFixable: true,
    });
  }

  for (const artifact of findUnguardedCalls(content)) {
    findings.push({
      domain: 'error-boundary',
      path: record.path,
      location: artifact.location,
      kind: KIND_UNGUARDED_BOUNDARY_CALL,
      detail: `Unguarded ${artifact.callName} call in '${artifact.operation}' has no surrounding error handling.`,
      autoFixable: artifact.autoFixable,
    });
  }

  return findings;
}

/** Pure detector for the error-boundary domain. */
export const errorBoundaryDetector: Detector = {
  domain: 'error-boundary',
  detect(records: readonly FileRecord[]): readonly Finding[] {
    const findings: Finding[] = [];
    for (const record of records) findings.push(...detectInRecord(record));
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Fixing.
// ---------------------------------------------------------------------------

function sameLocation(a: CodeLocation, b: CodeLocation): boolean {
  return a.line === b.line && a.column === b.column;
}

function safeUserMessage(operation: string): string {
  const label = operation === 'operation' ? 'the request' : operation;
  return `Could not complete ${label}. Please try again.`;
}

function buildEmptyCatchReplacement(artifact: EmptyCatchArtifact): string {
  const { paramName, indent, operation } = artifact;
  const inner = `${indent}    `;
  return (
    `catch (${paramName}) {\n` +
    `${inner}// Log the failure with the attempted operation; this preserves the original\n` +
    `${inner}// success-path behavior while making the swallowed error observable.\n` +
    `${inner}console.error('[${operation}] ${operation} failed', ${paramName});\n` +
    `${indent}}`
  );
}

function buildRawExposureReplacement(artifact: RawExposureArtifact): string {
  const { indent, operation, expr } = artifact;
  const message = safeUserMessage(operation);
  const logLine = `${indent}console.error('[${operation}] ${operation} failed', ${expr});`;
  if (artifact.exposureKind === 'alert') {
    return `${logLine}\n${indent}alert(${JSON.stringify(message)});`;
  }
  return `${logLine}\n${indent}${artifact.lhs} = ${JSON.stringify(message)};`;
}

function buildUnguardedCallReplacement(content: string, artifact: UnguardedCallArtifact): string {
  const { indent, operation, callName, stmtStart, stmtEnd } = artifact;
  const statement = content.slice(stmtStart, stmtEnd).trim();
  const inner = `${indent}    `;
  return (
    `try {\n` +
    `${inner}${statement}\n` +
    `${indent}} catch (${DEFAULT_ERROR_BINDING}) {\n` +
    `${inner}console.error('[${operation}] ${callName} failed', ${DEFAULT_ERROR_BINDING});\n` +
    `${indent}}`
  );
}

function makeReplaceEdit(
  path: string,
  content: string,
  start: number,
  text: string,
): Edit {
  return {
    kind: 'replace',
    path,
    range: locate(content, start),
    text,
    placeholderInserted: false,
  };
}

/**
 * Applies an error-boundary fix to file content and returns the transformed
 * string. Pure: locates the artifact matching `finding.location` and rewrites
 * the relevant span. Returns the content unchanged when the finding does not
 * match a known artifact or must be preserved.
 */
export function applyErrorBoundaryFix(content: string, finding: Finding): string {
  if (finding.kind === KIND_EMPTY_CATCH) {
    const artifact = findEmptyCatches(content).find((a) => sameLocation(a.location, finding.location));
    if (!artifact) return content;
    const replacement = buildEmptyCatchReplacement(artifact);
    return content.slice(0, artifact.catchIndex) + replacement + content.slice(artifact.bodyEnd + 1);
  }

  if (finding.kind === KIND_RAW_ERROR_EXPOSURE) {
    const artifact = findRawExposures(content).find((a) => sameLocation(a.location, finding.location));
    if (!artifact) return content;
    const replacement = buildRawExposureReplacement(artifact);
    return content.slice(0, artifact.stmtStart) + replacement + content.slice(artifact.stmtEnd);
  }

  if (finding.kind === KIND_UNGUARDED_BOUNDARY_CALL) {
    const artifact = findUnguardedCalls(content).find((a) => sameLocation(a.location, finding.location));
    if (!artifact || !artifact.autoFixable) return content;
    const replacement = buildUnguardedCallReplacement(content, artifact);
    return content.slice(0, artifact.stmtStart) + replacement + content.slice(artifact.stmtEnd);
  }

  return content;
}

/** Pure fixer for the error-boundary domain. */
export const errorBoundaryFixer: Fixer = {
  domain: 'error-boundary',
  fix(finding: Finding, record: FileRecord): FixOutcome {
    const noop: FixOutcome = { edits: [], preserved: true, preservationReason: 'no matching artifact found in current file content' };
    if (record.content === null) return noop;
    const content = record.content;

    if (finding.kind === KIND_EMPTY_CATCH) {
      const artifact = findEmptyCatches(content).find((a) => sameLocation(a.location, finding.location));
      if (!artifact) return noop;
      const replacement = buildEmptyCatchReplacement(artifact);
      return { edits: [makeReplaceEdit(record.path, content, artifact.catchIndex, replacement)], preserved: false };
    }

    if (finding.kind === KIND_RAW_ERROR_EXPOSURE) {
      const artifact = findRawExposures(content).find((a) => sameLocation(a.location, finding.location));
      if (!artifact) return noop;
      const replacement = buildRawExposureReplacement(artifact);
      return { edits: [makeReplaceEdit(record.path, content, artifact.stmtStart, replacement)], preserved: false };
    }

    if (finding.kind === KIND_UNGUARDED_BOUNDARY_CALL) {
      const artifact = findUnguardedCalls(content).find((a) => sameLocation(a.location, finding.location));
      if (!artifact) return noop;
      if (!artifact.autoFixable) {
        return {
          edits: [],
          preserved: true,
          preservationReason: artifact.preservationReason ?? 'wrapping this call could alter observable behavior',
        };
      }
      const replacement = buildUnguardedCallReplacement(content, artifact);
      return { edits: [makeReplaceEdit(record.path, content, artifact.stmtStart, replacement)], preserved: false };
    }

    return noop;
  },
};
