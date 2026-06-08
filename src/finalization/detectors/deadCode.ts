// Feature: pre-ship-finalization
//
// DeadCodeDetector (Requirement 3): a pure, deterministic detector that flags
// production-readiness defects in the "dead-code" domain:
//
//   - `console.*` debug calls (3.1) — console methods outside the allowed
//     logging set, separated into auto-removable debug calls and intentional
//     calls carrying a production-purpose comment (the latter are preserved by
//     the fixer, see 3.2).
//   - Commented-out code blocks that are neither documentation comments nor
//     license headers (3.4).
//   - Unreferenced imports / variables / functions / files (3.3) — a symbol is
//     flagged only when its reference count across all records is zero.
//   - Bare `TODO`/`FIXME` markers lacking both a reason and an owner/ticket
//     reference (3.5).
//
// The detector performs NO I/O: it takes the read inventory (`FileRecord[]`)
// and returns `Finding[]`. The matching fixer (task 6.2) is appended to the end
// of this file and consumes the `kind` values defined in `DEAD_CODE_KINDS`.
//
// Analysis is comment/string-aware rather than full-AST: the source is scanned
// once into a "masked" form where comment and string-literal characters are
// replaced by spaces (newlines preserved, so byte offsets stay aligned). Code
// detection runs over the masked form; comment detection runs over the
// extracted comment regions. This keeps the detector dependency-free and fast.
// Known limitation: regular-expression literals are not distinguished from
// division, so a `//` inside an unescaped regex literal could be misread; this
// pattern does not occur in the target codebase.

import type {
  CodeLocation,
  Detector,
  Edit,
  FileRecord,
  Finding,
  Fixer,
  FixOutcome,
  SourceLanguage,
} from '../types';

/**
 * Machine-readable `Finding.kind` values emitted by this detector. The fixer
 * branches on these, so they are the shared contract between detect and fix.
 */
export const DEAD_CODE_KINDS = {
  consoleDebug: 'console-debug',
  consoleIntentional: 'console-intentional',
  commentedCode: 'commented-out-code',
  unreferencedImport: 'unreferenced-import',
  unreferencedSymbol: 'unreferenced-symbol',
  bareTodo: 'bare-todo',
  unreferencedFile: 'unreferenced-file',
} as const;

/**
 * `console` methods that are legitimate production logging and therefore are
 * never treated as debug artifacts (mirrors the project's ESLint allowlist plus
 * `assert`). Every other `console.*` call is a debug call.
 */
const ALLOWED_CONSOLE_METHODS: ReadonlySet<string> = new Set([
  'warn',
  'error',
  'info',
  'assert',
]);

/** Matches a comment declaring that an adjacent `console` call is intentional. */
const INTENTIONAL_CONSOLE_RE =
  /\b(intentional|on purpose|deliberate|keep this|keep for|production log|prod log|do not remove)\b/i;

/** Source languages this detector inspects for code-level artifacts. */
const JS_TS_LANGUAGES: ReadonlySet<SourceLanguage> = new Set([
  'typescript',
  'javascript',
]);

// ---------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------

interface CommentToken {
  readonly type: 'line' | 'block';
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly text: string;
}

interface MaskedFile {
  readonly content: string;
  readonly codeMasked: string;
  readonly lineStarts: readonly number[];
  readonly comments: readonly CommentToken[];
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Counts whole-identifier occurrences of `name` in `text`. Uses identifier-aware
 * boundaries (`$` and `_` count as identifier characters) so `userId` does not
 * match inside `currentUserIdValue`.
 */
function countIdentifier(text: string, name: string): number {
  const re = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`, 'g');
  let count = 0;
  while (re.exec(text) !== null) {
    count++;
  }
  return count;
}

function isWithinComment(
  index: number,
  comments: readonly CommentToken[],
): boolean {
  return comments.some((c) => index >= c.startIndex && index < c.endIndex);
}

// ---------------------------------------------------------------------------
// Scanner: produce masked code + extracted comments in a single pass
// ---------------------------------------------------------------------------

function maskAndExtract(
  content: string,
  lineStarts: readonly number[],
): { codeMasked: string; comments: CommentToken[] } {
  const n = content.length;
  const masked = content.split('');
  const comments: CommentToken[] = [];
  type Mode = 'code' | 'line' | 'block' | 'string';
  let mode: Mode = 'code';
  let stringQuote = '';
  let commentStart = 0;
  let i = 0;

  const blank = (idx: number): void => {
    if (idx < n && content[idx] !== '\n' && content[idx] !== '\r') {
      masked[idx] = ' ';
    }
  };

  const pushComment = (type: 'line' | 'block', endIndex: number): void => {
    const start = indexToLocation(commentStart, lineStarts);
    const endProbe = Math.max(commentStart, endIndex - 1);
    const end = indexToLocation(endProbe, lineStarts);
    comments.push({
      type,
      startIndex: commentStart,
      endIndex,
      startLine: start.line,
      endLine: end.line,
      startColumn: start.column,
      text: content.slice(commentStart, endIndex),
    });
  };

  while (i < n) {
    const c = content[i];
    const next = i + 1 < n ? content[i + 1] : '';

    if (mode === 'code') {
      if (c === '/' && next === '/') {
        mode = 'line';
        commentStart = i;
        blank(i);
        blank(i + 1);
        i += 2;
      } else if (c === '/' && next === '*') {
        mode = 'block';
        commentStart = i;
        blank(i);
        blank(i + 1);
        i += 2;
      } else if (c === '"' || c === "'" || c === '`') {
        mode = 'string';
        stringQuote = c;
        blank(i);
        i++;
      } else {
        i++;
      }
      continue;
    }

    if (mode === 'line') {
      if (c === '\n') {
        pushComment('line', i);
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
        pushComment('block', i + 2);
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
      blank(i);
      mode = 'code';
      i++;
    } else {
      blank(i);
      i++;
    }
  }

  if (mode === 'line') {
    pushComment('line', n);
  } else if (mode === 'block') {
    pushComment('block', n);
  }

  return { codeMasked: masked.join(''), comments };
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function looksLikeCode(rawLine: string): boolean {
  const t = rawLine.trim();
  if (t.length === 0) {
    return false;
  }
  if (/[;{]\s*$/.test(t)) {
    return true;
  }
  if (/^[)}\]];?\s*$/.test(t)) {
    return true;
  }
  if (
    /^(export\s+)?(default\s+)?(declare\s+)?(import|const|let|var|function|class|interface|enum|type)\s+[A-Za-z_$]/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(if|for|while|switch|catch)\s*\(/.test(t)) {
    return true;
  }
  if (/^(return|throw|await|yield)\b/.test(t)) {
    return true;
  }
  if (/^[A-Za-z_$][\w$.[\]]*\s*=[^=]/.test(t)) {
    return true;
  }
  if (/^[A-Za-z_$][\w$.]*\(.*\)\s*;?\s*$/.test(t)) {
    return true;
  }
  return false;
}

function hasTodoMarker(text: string): boolean {
  return /\b(todo|fixme)\b/i.test(text);
}

function isDocComment(blockText: string): boolean {
  return blockText.startsWith('/**');
}

function isLicenseBlock(blockText: string): boolean {
  return /\b(license|copyright|\(c\)|spdx|permission is hereby granted|all rights reserved)\b/i.test(
    blockText,
  );
}

function stripLineCommentMarker(text: string): string {
  return text.replace(/^\s*\/\/+/, '');
}

function stripBlockInnerLine(line: string): string {
  return line
    .replace(/^\s*\/\*+/, '')
    .replace(/\*+\/\s*$/, '')
    .replace(/^\s*\*\s?/, '');
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
  return { domain: 'dead-code', path, location, kind, detail, autoFixable };
}

// ---------------------------------------------------------------------------
// Detectors (per concern)
// ---------------------------------------------------------------------------

function detectConsoleCalls(path: string, file: MaskedFile): Finding[] {
  const findings: Finding[] = [];
  const re = /console\s*\.\s*([A-Za-z]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(file.codeMasked)) !== null) {
    const method = match[1];
    if (ALLOWED_CONSOLE_METHODS.has(method)) {
      continue;
    }
    const { line, column } = indexToLocation(match.index, file.lineStarts);
    const intentionalComment = file.comments.find(
      (c) =>
        (c.endLine === line || c.endLine === line - 1) &&
        INTENTIONAL_CONSOLE_RE.test(c.text),
    );
    if (intentionalComment) {
      findings.push(
        makeFinding(
          path,
          { line, column },
          DEAD_CODE_KINDS.consoleIntentional,
          `console.${method} carries an intentional-purpose comment: "${intentionalComment.text.trim()}"`,
          false,
        ),
      );
    } else {
      findings.push(
        makeFinding(
          path,
          { line, column },
          DEAD_CODE_KINDS.consoleDebug,
          `Debug console.${method} call left in source.`,
          true,
        ),
      );
    }
  }
  return findings;
}

function detectCommentedOutCode(path: string, file: MaskedFile): Finding[] {
  const findings: Finding[] = [];
  const comments = file.comments;
  for (let idx = 0; idx < comments.length; idx++) {
    const comment = comments[idx];

    if (comment.type === 'block') {
      if (isDocComment(comment.text) || isLicenseBlock(comment.text)) {
        continue;
      }
      const innerLines = comment.text.split('\n');
      const codey = innerLines.some((raw) => {
        const inner = stripBlockInnerLine(raw);
        return !hasTodoMarker(inner) && looksLikeCode(inner);
      });
      if (codey) {
        findings.push(
          makeFinding(
            path,
            { line: comment.startLine, column: comment.startColumn },
            DEAD_CODE_KINDS.commentedCode,
            'Commented-out code block (not a documentation or license comment).',
            true,
          ),
        );
      }
      continue;
    }

    // Line comment: group consecutive code-looking line comments into one block.
    const inner = stripLineCommentMarker(comment.text);
    if (hasTodoMarker(inner) || !looksLikeCode(inner)) {
      continue;
    }
    const startComment = comment;
    let last = comment;
    let lineCount = 1;
    while (idx + 1 < comments.length) {
      const nextComment = comments[idx + 1];
      if (
        nextComment.type === 'line' &&
        nextComment.startLine === last.endLine + 1
      ) {
        const nextInner = stripLineCommentMarker(nextComment.text);
        if (!hasTodoMarker(nextInner) && looksLikeCode(nextInner)) {
          last = nextComment;
          lineCount++;
          idx++;
          continue;
        }
      }
      break;
    }
    findings.push(
      makeFinding(
        path,
        { line: startComment.startLine, column: startComment.startColumn },
        DEAD_CODE_KINDS.commentedCode,
        `Commented-out code (${lineCount} line${lineCount === 1 ? '' : 's'}).`,
        true,
      ),
    );
  }
  return findings;
}

function isQualifiedTodo(textAfterMarker: string): boolean {
  const hasOwner = /@[\w-]+|\([^)]*[A-Za-z][^)]*\)/.test(textAfterMarker);
  const hasTicket = /#\d+|\b[A-Z]{2,}-\d+\b|https?:\/\//.test(textAfterMarker);
  const reasonText = textAfterMarker
    .replace(/@[\w-]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#\d+/g, ' ')
    .replace(/\b[A-Z]{2,}-\d+\b/g, ' ')
    .replace(/[^A-Za-z]+/g, ' ')
    .trim();
  const reasonWords = reasonText.split(/\s+/).filter((w) => w.length >= 2);
  const hasReason = reasonWords.length >= 2;
  return hasReason && (hasOwner || hasTicket);
}

function detectBareTodos(
  path: string,
  comments: readonly CommentToken[],
  lineStarts: readonly number[],
): Finding[] {
  const findings: Finding[] = [];
  for (const comment of comments) {
    const markerRe = /\b(TODO|FIXME)\b[:\-\s]*/gi;
    let match: RegExpExecArray | null;
    while ((match = markerRe.exec(comment.text)) !== null) {
      const afterMarker = comment.text.slice(match.index + match[0].length);
      if (isQualifiedTodo(afterMarker)) {
        continue;
      }
      const absoluteIndex = comment.startIndex + match.index;
      const { line, column } = indexToLocation(absoluteIndex, lineStarts);
      findings.push(
        makeFinding(
          path,
          { line, column },
          DEAD_CODE_KINDS.bareTodo,
          `Bare ${match[1].toUpperCase()} marker lacking a reason and an owner or ticket reference.`,
          true,
        ),
      );
    }
  }
  return findings;
}

interface ImportBinding {
  readonly name: string;
  readonly statementStart: number;
  readonly statementEnd: number;
}

function extractImportBindings(
  content: string,
  comments: readonly CommentToken[],
): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const importRe =
    /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from\s*['"][^'"]+['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(content)) !== null) {
    if (isWithinComment(match.index, comments)) {
      continue;
    }
    const statementStart = match.index;
    const statementEnd = match.index + match[0].length;
    const names: string[] = [];
    if (match[1]) {
      names.push(match[1]);
    }
    if (match[3]) {
      names.push(match[3]);
    }
    if (match[2]) {
      for (const part of match[2].split(',')) {
        const cleaned = part.trim().replace(/^type\s+/, '');
        if (cleaned.length === 0) {
          continue;
        }
        const segments = cleaned.split(/\s+as\s+/);
        const binding = (segments[1] ?? segments[0]).trim();
        if (binding.length > 0) {
          names.push(binding);
        }
      }
    }
    for (const name of names) {
      bindings.push({ name, statementStart, statementEnd });
    }
  }
  return bindings;
}

function detectUnreferencedImports(path: string, file: MaskedFile): Finding[] {
  const findings: Finding[] = [];
  const bindings = extractImportBindings(file.content, file.comments);
  for (const binding of bindings) {
    const before = file.codeMasked.slice(0, binding.statementStart);
    const after = file.codeMasked.slice(binding.statementEnd);
    const references =
      countIdentifier(before, binding.name) +
      countIdentifier(after, binding.name);
    if (references === 0) {
      const { line, column } = indexToLocation(
        binding.statementStart,
        file.lineStarts,
      );
      findings.push(
        makeFinding(
          path,
          { line, column },
          DEAD_CODE_KINDS.unreferencedImport,
          `Imported binding "${binding.name}" is never referenced in this file.`,
          true,
        ),
      );
    }
  }
  return findings;
}

interface SymbolDeclaration {
  readonly name: string;
  readonly exported: boolean;
  readonly line: number;
}

function extractTopLevelDeclarations(file: MaskedFile): SymbolDeclaration[] {
  const declarations: SymbolDeclaration[] = [];
  const declRe =
    /^(export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
  const lines = file.codeMasked.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = declRe.exec(lines[i]);
    if (match) {
      declarations.push({
        name: match[3],
        exported: Boolean(match[1]),
        line: i + 1,
      });
    }
  }
  return declarations;
}

function detectUnreferencedSymbols(
  path: string,
  file: MaskedFile,
  allMasked: readonly string[],
): Finding[] {
  const findings: Finding[] = [];
  for (const declaration of extractTopLevelDeclarations(file)) {
    const totalReferences = declaration.exported
      ? allMasked.reduce(
          (sum, masked) => sum + countIdentifier(masked, declaration.name),
          0,
        )
      : countIdentifier(file.codeMasked, declaration.name);

    // The declaration itself contributes exactly one occurrence; anything more
    // means the symbol is referenced somewhere (Property 9 — remove iff zero).
    if (totalReferences <= 1) {
      findings.push(
        makeFinding(
          path,
          { line: declaration.line, column: 1 },
          DEAD_CODE_KINDS.unreferencedSymbol,
          `${declaration.exported ? 'Exported' : 'Local'} symbol "${declaration.name}" has no references across the project.`,
          !declaration.exported,
        ),
      );
    }
  }
  return findings;
}

/** Entry, configuration, declaration, and test files are never flagged as dead. */
function isEntryOrExcludedFile(path: string): boolean {
  return (
    /(^|\/)(main|index|app|sw|service-worker)\.[tj]sx?$/.test(path) ||
    /\.config\.[tj]s$/.test(path) ||
    /\.d\.ts$/.test(path) ||
    /\.(test|spec)\.[tj]sx?$/.test(path) ||
    /(^|\/)__tests__\//.test(path)
  );
}

function fileReferenceCandidates(path: string): string[] {
  const withoutExt = path.replace(/\.[tj]sx?$/, '');
  const basename = withoutExt.split('/').pop() ?? withoutExt;
  return basename.length > 0 ? [basename] : [];
}

function detectUnreferencedFiles(
  records: readonly FileRecord[],
  jsTsPaths: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];
  for (const path of jsTsPaths) {
    if (isEntryOrExcludedFile(path)) {
      continue;
    }
    const candidates = fileReferenceCandidates(path);
    if (candidates.length === 0) {
      continue;
    }
    const referenced = records.some((record) => {
      if (record.path === path || record.content === null) {
        return false;
      }
      return candidates.some((candidate) =>
        record.content!.includes(candidate),
      );
    });
    if (!referenced) {
      findings.push(
        makeFinding(
          path,
          { line: 1, column: 1 },
          DEAD_CODE_KINDS.unreferencedFile,
          'Source file is not referenced by any other project file.',
          false,
        ),
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Public detector
// ---------------------------------------------------------------------------

/**
 * The dead-code detector. Pure: it reads nothing from disk and depends only on
 * the supplied `FileRecord[]`.
 */
export const deadCodeDetector: Detector = {
  domain: 'dead-code',
  detect(records: readonly FileRecord[]): readonly Finding[] {
    const maskedFiles = new Map<string, MaskedFile>();
    for (const record of records) {
      if (record.content === null || !JS_TS_LANGUAGES.has(record.language)) {
        continue;
      }
      const lineStarts = getLineStarts(record.content);
      const { codeMasked, comments } = maskAndExtract(
        record.content,
        lineStarts,
      );
      maskedFiles.set(record.path, {
        content: record.content,
        codeMasked,
        lineStarts,
        comments,
      });
    }

    const allMasked = [...maskedFiles.values()].map((file) => file.codeMasked);
    const findings: Finding[] = [];

    for (const [path, file] of maskedFiles) {
      findings.push(...detectConsoleCalls(path, file));
      findings.push(...detectCommentedOutCode(path, file));
      findings.push(...detectBareTodos(path, file.comments, file.lineStarts));
      findings.push(...detectUnreferencedImports(path, file));
      findings.push(...detectUnreferencedSymbols(path, file, allMasked));
    }

    findings.push(
      ...detectUnreferencedFiles(records, new Set(maskedFiles.keys())),
    );

    return findings;
  },
};

// ===========================================================================
// Dead-code fixer (task 6.2)
//
// A pure, deterministic fixer that consumes the `kind` values in
// DEAD_CODE_KINDS and returns a `FixOutcome` (edits to apply, or a preservation
// outcome with a recorded reason). It performs NO I/O.
//
// Behavior contract per Requirement 3:
//   - console-debug (3.1)        → remove the debug call.
//   - console-intentional (3.2)  → PRESERVE; record the declared purpose.
//   - commented-out-code (3.4)   → remove the commented block.
//   - bare-todo (3.5)            → remove the bare marker (whole comment line),
//                                  or PRESERVE block-comment markers with a
//                                  reason (removing text from a multi-line
//                                  documentation comment needs manual review).
//   - unreferenced-import (3.3)  → remove the import statement only when every
//                                  binding it declares is unreferenced;
//                                  otherwise PRESERVE with a reason.
//   - unreferenced-symbol (3.3)  → remove a *local* symbol iff its reference
//                                  count is zero; PRESERVE exported symbols
//                                  (3.7 — a module export may be referenced by
//                                  another module, so removal could alter
//                                  observable behavior).
//   - unreferenced-file (3.7)    → PRESERVE; deleting a whole file is a
//                                  behavior-altering operation kept for review.
//
// Every removal is computed against a masked copy of the source (strings and
// comments blanked) so that braces, parentheses, and semicolons are matched in
// real code only. When a span cannot be determined safely, the fixer preserves
// the artifact with a recorded reason rather than guessing (3.7).
// ===========================================================================

/** Internal: the outcome of computing a fix, including the rewritten content. */
interface DeadCodeFixComputation {
  readonly edits: readonly Edit[];
  readonly preserved: boolean;
  readonly preservationReason?: string;
  readonly newContent: string;
}

interface MaskScan {
  readonly codeMasked: string;
  readonly comments: readonly CommentToken[];
  readonly lineStarts: readonly number[];
}

function scan(content: string): MaskScan {
  const lineStarts = getLineStarts(content);
  const { codeMasked, comments } = maskAndExtract(content, lineStarts);
  return { codeMasked, comments, lineStarts };
}

function toLocation(content: string, index: number): CodeLocation {
  return indexToLocation(index, getLineStarts(content));
}

/** A removal/replacement span expressed as a half-open `[start, end)` range. */
interface Span {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/** Builds the rewritten content and the matching `Edit` for a span. */
function applySpan(
  path: string,
  content: string,
  span: Span,
): DeadCodeFixComputation {
  const newContent =
    content.slice(0, span.start) + span.replacement + content.slice(span.end);
  const edit: Edit = {
    kind: span.replacement.length === 0 ? 'delete' : 'replace',
    path,
    range: toLocation(content, span.start),
    ...(span.replacement.length === 0 ? {} : { text: span.replacement }),
    placeholderInserted: false,
  };
  return { edits: [edit], preserved: false, newContent };
}

function preserve(content: string, reason: string): DeadCodeFixComputation {
  return { edits: [], preserved: true, preservationReason: reason, newContent: content };
}

/** Start offset (byte index) of 1-indexed `line` within `content`. */
function lineStartOffset(lineStarts: readonly number[], line: number): number {
  return lineStarts[line - 1];
}

/** Start offset of the line *after* 1-indexed `endLine` (or end of content). */
function lineAfterOffset(
  lineStarts: readonly number[],
  endLine: number,
  contentLength: number,
): number {
  return endLine < lineStarts.length ? lineStarts[endLine] : contentLength;
}

/** Builds a whole-line removal span covering `[startLine, endLine]` inclusive. */
function wholeLineSpan(
  content: string,
  lineStarts: readonly number[],
  startLine: number,
  endLine: number,
): Span {
  return {
    start: lineStartOffset(lineStarts, startLine),
    end: lineAfterOffset(lineStarts, endLine, content.length),
    replacement: '',
  };
}

/** True when `masked[from, to)` contains only whitespace. */
function isBlankRange(masked: string, from: number, to: number): boolean {
  return masked.slice(from, to).trim().length === 0;
}

// ---------------------------------------------------------------------------
// Span scanners (operate on masked code so literals never interfere)
// ---------------------------------------------------------------------------

/**
 * Given the index of a `console` token, returns the offset just past the end of
 * the full call expression (after the matched `)` and an optional trailing
 * `;`), or `null` when the call parentheses are unbalanced.
 */
function consoleCallEnd(masked: string, fromIndex: number): number | null {
  const open = masked.indexOf('(', fromIndex);
  if (open < 0) {
    return null;
  }
  let depth = 0;
  let i = open;
  for (; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  if (depth !== 0) {
    return null;
  }
  while (i < masked.length && (masked[i] === ' ' || masked[i] === '\t')) {
    i++;
  }
  if (masked[i] === ';') {
    i++;
  }
  return i;
}

/**
 * Returns the offset just past the end of a brace-bodied declaration
 * (`function`/`class`): the matching `}` plus an optional trailing `;`.
 * Returns `null` when no body brace is found before a top-level `;`.
 */
function blockDeclarationEnd(masked: string, fromIndex: number): number | null {
  let paren = 0;
  let brack = 0;
  let braceOpen = -1;
  for (let i = fromIndex; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') {
      paren++;
    } else if (c === ')') {
      paren--;
    } else if (c === '[') {
      brack++;
    } else if (c === ']') {
      brack--;
    } else if (c === '{' && paren === 0 && brack === 0) {
      braceOpen = i;
      break;
    } else if (c === ';' && paren === 0 && brack === 0) {
      return null;
    }
  }
  if (braceOpen < 0) {
    return null;
  }
  let depth = 0;
  let i = braceOpen;
  for (; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  if (depth !== 0) {
    return null;
  }
  while (i < masked.length && (masked[i] === ' ' || masked[i] === '\t')) {
    i++;
  }
  if (masked[i] === ';') {
    i++;
  }
  return i;
}

/**
 * Returns the offset just past the terminating `;` of a statement starting at
 * `fromIndex`, scanning at bracket depth zero. Returns `null` when no
 * terminating semicolon is found (in which case the span cannot be removed
 * safely).
 */
function statementEnd(masked: string, fromIndex: number): number | null {
  let paren = 0;
  let brack = 0;
  let brace = 0;
  for (let i = fromIndex; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') {
      paren++;
    } else if (c === ')') {
      paren--;
    } else if (c === '[') {
      brack++;
    } else if (c === ']') {
      brack--;
    } else if (c === '{') {
      brace++;
    } else if (c === '}') {
      brace--;
    } else if (c === ';' && paren === 0 && brack === 0 && brace === 0) {
      return i + 1;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-kind fix computation
// ---------------------------------------------------------------------------

function fixConsoleDebug(
  path: string,
  content: string,
  finding: Finding,
): DeadCodeFixComputation {
  const { codeMasked, comments, lineStarts } = scan(content);
  const re = /console\s*\.\s*([A-Za-z]+)/g;
  let match: RegExpExecArray | null;
  let target: { index: number } | null = null;
  while ((match = re.exec(codeMasked)) !== null) {
    const method = match[1];
    if (ALLOWED_CONSOLE_METHODS.has(method)) {
      continue;
    }
    const { line } = indexToLocation(match.index, lineStarts);
    if (line !== finding.location.line) {
      continue;
    }
    const intentional = comments.some(
      (c) =>
        (c.endLine === line || c.endLine === line - 1) &&
        INTENTIONAL_CONSOLE_RE.test(c.text),
    );
    if (intentional) {
      continue;
    }
    target = { index: match.index };
    break;
  }
  if (!target) {
    return preserve(content, 'no removable console call found at the recorded location');
  }

  const stmtStart = target.index;
  const stmtEnd = consoleCallEnd(codeMasked, stmtStart);
  if (stmtEnd === null) {
    return preserve(content, 'console call parentheses are unbalanced; left for manual review');
  }

  const startLine = indexToLocation(stmtStart, lineStarts).line;
  const endLine = indexToLocation(Math.max(stmtStart, stmtEnd - 1), lineStarts).line;
  const lineStartIdx = lineStartOffset(lineStarts, startLine);
  const nextNewline = content.indexOf('\n', stmtEnd);
  const suffixEnd = nextNewline < 0 ? content.length : nextNewline;
  const standalone =
    isBlankRange(codeMasked, lineStartIdx, stmtStart) &&
    isBlankRange(codeMasked, stmtEnd, suffixEnd);

  if (standalone) {
    return applySpan(path, content, wholeLineSpan(content, lineStarts, startLine, endLine));
  }
  // Inline call: remove just the statement span, consuming one trailing space
  // so neighbouring statements are not jammed together.
  let removeEnd = stmtEnd;
  if (content[removeEnd] === ' ') {
    removeEnd++;
  }
  return applySpan(path, content, { start: stmtStart, end: removeEnd, replacement: '' });
}

function fixCommentedCode(
  path: string,
  content: string,
  finding: Finding,
): DeadCodeFixComputation {
  const { codeMasked, comments, lineStarts } = scan(content);
  const idx = comments.findIndex(
    (c) =>
      c.startLine === finding.location.line &&
      (finding.location.column === undefined ||
        c.startColumn === finding.location.column),
  );
  if (idx < 0) {
    return preserve(content, 'no commented-out block found at the recorded location');
  }
  const comment = comments[idx];

  let endLine = comment.endLine;
  if (comment.type === 'line') {
    // Re-group consecutive code-looking line comments (mirrors the detector).
    let last = comment;
    for (let j = idx + 1; j < comments.length; j++) {
      const nextComment = comments[j];
      if (nextComment.type === 'line' && nextComment.startLine === last.endLine + 1) {
        last = nextComment;
        endLine = nextComment.endLine;
        continue;
      }
      break;
    }
  }

  const startLineIdx = lineStartOffset(lineStarts, comment.startLine);
  const lastNewline = content.indexOf('\n', comment.endIndex);
  const endLineSuffix = lastNewline < 0 ? content.length : lastNewline;
  const occupiesWholeLines =
    isBlankRange(codeMasked, startLineIdx, comment.startIndex) &&
    isBlankRange(codeMasked, comment.endIndex, endLineSuffix);

  if (occupiesWholeLines) {
    return applySpan(path, content, wholeLineSpan(content, lineStarts, comment.startLine, endLine));
  }
  // Inline comment with code on the same line: remove only the comment span and
  // any whitespace separating it from the preceding code.
  let start = comment.startIndex;
  while (start > startLineIdx && (content[start - 1] === ' ' || content[start - 1] === '\t')) {
    start--;
  }
  return applySpan(path, content, { start, end: comment.endIndex, replacement: '' });
}

function fixBareTodo(
  path: string,
  content: string,
  finding: Finding,
): DeadCodeFixComputation {
  const { codeMasked, comments, lineStarts } = scan(content);
  const markerLine = finding.location.line;
  if (markerLine === undefined) {
    return preserve(content, 'bare TODO marker has no recorded line');
  }
  const comment = comments.find(
    (c) => markerLine >= c.startLine && markerLine <= c.endLine,
  );
  if (!comment) {
    return preserve(content, 'no comment containing the TODO marker was found');
  }
  if (comment.type === 'block') {
    return preserve(
      content,
      'TODO marker is embedded in a block comment; removing text from a multi-line comment is left for manual review',
    );
  }

  const lineStartIdx = lineStartOffset(lineStarts, markerLine);
  const newline = content.indexOf('\n', comment.startIndex);
  const lineEnd = newline < 0 ? content.length : newline;
  const codeBeforeComment = !isBlankRange(codeMasked, lineStartIdx, comment.startIndex);

  if (codeBeforeComment) {
    // Trailing comment after code: drop the comment and its leading whitespace,
    // keep the code intact.
    let start = comment.startIndex;
    while (start > lineStartIdx && (content[start - 1] === ' ' || content[start - 1] === '\t')) {
      start--;
    }
    return applySpan(path, content, { start, end: lineEnd, replacement: '' });
  }
  // Comment-only line: remove the entire line.
  return applySpan(path, content, wholeLineSpan(content, lineStarts, markerLine, markerLine));
}

function fixUnreferencedImport(
  path: string,
  content: string,
  finding: Finding,
): DeadCodeFixComputation {
  const { codeMasked, comments, lineStarts } = scan(content);
  const bindings = extractImportBindings(content, comments);
  const target = bindings.find(
    (b) => indexToLocation(b.statementStart, lineStarts).line === finding.location.line,
  );
  if (!target) {
    return preserve(content, 'no import statement found at the recorded location');
  }

  // Every binding declared by the same statement must be unreferenced before
  // the whole statement can be removed without dropping a used binding.
  const group = bindings.filter((b) => b.statementStart === target.statementStart);
  const before = codeMasked.slice(0, target.statementStart);
  const after = codeMasked.slice(target.statementEnd);
  const anyReferenced = group.some(
    (b) => countIdentifier(before, b.name) + countIdentifier(after, b.name) > 0,
  );
  if (anyReferenced) {
    return preserve(
      content,
      'import statement declares other referenced bindings; removing this binding requires rewriting the statement and is left for manual review',
    );
  }

  const startLine = indexToLocation(target.statementStart, lineStarts).line;
  const endLine = indexToLocation(
    Math.max(target.statementStart, target.statementEnd - 1),
    lineStarts,
  ).line;
  return applySpan(path, content, wholeLineSpan(content, lineStarts, startLine, endLine));
}

function fixUnreferencedSymbol(
  path: string,
  content: string,
  finding: Finding,
): DeadCodeFixComputation {
  const maskScan = scan(content);
  const maskedFile: MaskedFile = {
    content,
    codeMasked: maskScan.codeMasked,
    lineStarts: maskScan.lineStarts,
    comments: maskScan.comments,
  };
  const declaration = extractTopLevelDeclarations(maskedFile).find(
    (d) => d.line === finding.location.line,
  );
  if (!declaration) {
    return preserve(content, 'no top-level declaration found at the recorded location');
  }

  // An exported symbol may be referenced by another module; removing it could
  // alter observable behavior, so it is retained with a reason (Requirement 3.7).
  if (declaration.exported) {
    return preserve(
      content,
      `exported symbol "${declaration.name}" may be referenced by another module; removal could alter observable behavior`,
    );
  }

  // Remove a local symbol iff its reference count in the file is zero (the sole
  // occurrence is the declaration itself). Requirement 3.3 / Property 9.
  if (countIdentifier(maskScan.codeMasked, declaration.name) > 1) {
    return preserve(
      content,
      `symbol "${declaration.name}" is referenced within the file; removal would alter behavior`,
    );
  }

  const { codeMasked, lineStarts } = maskScan;
  const declLineStart = lineStartOffset(lineStarts, declaration.line);
  const leadingWhitespace = /^[ \t]*/.exec(content.slice(declLineStart))?.[0].length ?? 0;
  const declStart = declLineStart + leadingWhitespace;
  const keyword = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(const|let|var|function|class)\b/.exec(
    codeMasked.slice(declStart),
  )?.[1];

  const end =
    keyword === 'function' || keyword === 'class'
      ? blockDeclarationEnd(codeMasked, declStart)
      : statementEnd(codeMasked, declStart);
  if (end === null) {
    return preserve(
      content,
      `could not determine the end of declaration "${declaration.name}" safely; left for manual review`,
    );
  }

  const endLine = indexToLocation(Math.max(declStart, end - 1), lineStarts).line;
  return applySpan(path, content, wholeLineSpan(content, lineStarts, declaration.line, endLine));
}

/**
 * Computes the fix for a single dead-code finding. Pure: returns the edits, the
 * rewritten content, and whether the artifact was preserved (with a reason).
 */
function computeDeadCodeFix(
  path: string,
  content: string,
  finding: Finding,
): DeadCodeFixComputation {
  switch (finding.kind) {
    case DEAD_CODE_KINDS.consoleDebug:
      return fixConsoleDebug(path, content, finding);
    case DEAD_CODE_KINDS.commentedCode:
      return fixCommentedCode(path, content, finding);
    case DEAD_CODE_KINDS.bareTodo:
      return fixBareTodo(path, content, finding);
    case DEAD_CODE_KINDS.unreferencedImport:
      return fixUnreferencedImport(path, content, finding);
    case DEAD_CODE_KINDS.unreferencedSymbol:
      return fixUnreferencedSymbol(path, content, finding);
    case DEAD_CODE_KINDS.consoleIntentional:
      // Requirement 3.2: preserve and record the declared production purpose.
      return preserve(
        content,
        `intentional console statement preserved; ${finding.detail}`,
      );
    case DEAD_CODE_KINDS.unreferencedFile:
      // Requirement 3.7: deleting an entire file is behavior-altering.
      return preserve(
        content,
        'removing an entire source file is a behavior-altering operation; retained for manual review',
      );
    default:
      return preserve(content, `unsupported dead-code finding kind "${finding.kind}"`);
  }
}

/**
 * Applies a dead-code fix to file content and returns the transformed string.
 * Pure and behavior-focused: when a finding is preserved (intentional console,
 * exported symbol, unreferenced file, or an unsafe span) the content is
 * returned unchanged.
 */
export function applyDeadCodeFix(content: string, finding: Finding): string {
  return computeDeadCodeFix(finding.path, content, finding).newContent;
}

/**
 * Pure fixer for the dead-code domain. Branches on `DEAD_CODE_KINDS` and returns
 * a `FixOutcome` of edits to apply, or a preservation outcome with a recorded
 * reason. Performs no I/O.
 */
export const deadCodeFixer: Fixer = {
  domain: 'dead-code',
  fix(finding: Finding, record: FileRecord): FixOutcome {
    if (record.content === null) {
      return {
        edits: [],
        preserved: true,
        preservationReason: 'file content is unavailable (read failed)',
      };
    }
    const result = computeDeadCodeFix(record.path, record.content, finding);
    return {
      edits: result.edits,
      preserved: result.preserved,
      ...(result.preservationReason === undefined
        ? {}
        : { preservationReason: result.preservationReason }),
    };
  },
};
