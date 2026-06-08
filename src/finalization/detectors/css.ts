// Feature: pre-ship-finalization
//
// CssQualityDetector / Fixer (Requirement 11).
//
// Pure, deterministic analysis of CSS quality:
//   - 11.1 Removes a CSS @import when (and only when) its referenced stylesheet
//     has no rule matching project markup and is not referenced by any other
//     retained stylesheet.
//   - 11.2 Rewrites a non-accessibility `!important` declaration into an
//     equivalent rule that produces the identical computed style through
//     increased selector specificity, without `!important`.
//   - 11.3 When identical computed style cannot be reproduced without
//     `!important`, preserves the declaration and records the reason.
//   - 11.4/11.5 Always preserves `!important` inside an accessibility media
//     query (prefers-reduced-motion, prefers-contrast, prefers-color-scheme,
//     forced-colors) and records the justification.
//
// This module performs NO I/O: detector takes the read inventory, fixer takes a
// single finding plus its backing record, and both return structured results.
// Behavior preservation is verified structurally (selector specificity and the
// set of matched elements) before any edit is emitted, per the design's
// conservative-fixer principle: when an edit cannot be guaranteed to preserve
// computed style, the fixer preserves the declaration with a reason instead.

import type {
  Detector,
  Edit,
  FileRecord,
  Finding,
  Fixer,
  FixOutcome,
} from '../types';

/**
 * A single CSS declaration (`property: value`) with its `!important` flag and
 * 1-based source line. Internal to the CSS domain; not a shared contract.
 */
interface CssDeclaration {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
  readonly line: number;
}

/** Media features that mark a media query as an accessibility query (11.4). */
const ACCESSIBILITY_MEDIA_FEATURES: readonly string[] = [
  'prefers-reduced-motion',
  'prefers-contrast',
  'prefers-color-scheme',
  'forced-colors',
];

/** Finding kinds emitted by this domain. */
const KIND_UNUSED_IMPORT = 'unused-import';
const KIND_IMPORTANT = 'important';
const KIND_ACCESSIBILITY_IMPORTANT = 'accessibility-important';

/** Matches a trailing `!important` flag (with optional whitespace). */
const IMPORTANT_FLAG = /!\s*important\s*$/i;

/** Upper bound on how many times a token is duplicated to raise specificity. */
const MAX_SPECIFICITY_BOOST = 8;

// ---------------------------------------------------------------------------
// CSS parsing (offset- and line-aware, comment/string/paren safe)
// ---------------------------------------------------------------------------

/** A `@import` statement located within a stylesheet. */
interface CssImport {
  /** Resolved, normalized href (no quotes, no `url()` wrapper, no query/hash). */
  readonly target: string;
  /** 1-based line of the statement. */
  readonly line: number;
}

/** A style rule (selector list + declarations) with its media-query context. */
interface CssRule {
  /** Raw selector text, which may be a comma-separated list. */
  readonly selector: string;
  readonly declarations: CssDeclaration[];
  /** Preludes of every enclosing `@media`/`@supports` block, outermost first. */
  readonly mediaPreludes: readonly string[];
  /** 1-based line of the selector. */
  readonly line: number;
}

interface ParsedCss {
  readonly rules: readonly CssRule[];
  readonly imports: readonly CssImport[];
}

/** Specificity triple `[ids, classes/attrs/pseudo-classes, types/pseudo-elements]`. */
type Specificity = readonly [number, number, number];

interface ScopeFrame {
  readonly type: 'media' | 'rule' | 'other';
  readonly prelude: string;
  rule?: MutableRule;
}

interface MutableRule {
  selector: string;
  declarations: CssDeclaration[];
  mediaPreludes: string[];
  line: number;
}

/** Returns the 1-based line number for a character offset. */
function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/** Splits a declaration body (`prop: value`) into a structured declaration. */
function makeDeclaration(
  text: string,
  start: number,
  content: string,
): CssDeclaration | null {
  const colon = text.indexOf(':');
  if (colon <= 0) return null;
  const property = text.slice(0, colon).trim();
  if (property === '' || property.startsWith('@')) return null;
  let value = text.slice(colon + 1).trim();
  const important = IMPORTANT_FLAG.test(value);
  if (important) value = value.replace(IMPORTANT_FLAG, '').trim();
  if (value === '') return null;
  return { property, value, important, line: lineAt(content, start) };
}

/** Extracts the href from an `@import` statement, or `null` when absent. */
function extractImportTarget(statement: string): string | null {
  const urlMatch = /url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec(statement);
  if (urlMatch) return urlMatch[2].trim();
  const stringMatch = /@import\s+(['"])([^'"]+)\1/i.exec(statement);
  if (stringMatch) return stringMatch[2].trim();
  return null;
}

/** Advances past a string literal beginning at `start`; returns the end index. */
function skipString(content: string, start: number): number {
  const quote = content[start];
  let i = start + 1;
  while (i < content.length && content[i] !== quote) {
    if (content[i] === '\\') i++;
    i++;
  }
  return i + 1;
}

/** Advances past a balanced parenthesized group beginning at `start`. */
function skipParens(content: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '/' && content[i + 1] === '*') {
      const close = content.indexOf('*/', i + 2);
      i = close === -1 ? content.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(content, i);
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/** Parses a stylesheet into its rules and imports without performing any I/O. */
function parseCss(content: string): ParsedCss {
  const rules: CssRule[] = [];
  const imports: CssImport[] = [];
  const stack: ScopeFrame[] = [];
  let buffer = '';
  let bufferStart = -1;
  let i = 0;

  const mediaPreludes = (): string[] =>
    stack.filter((f) => f.type === 'media').map((f) => f.prelude);

  const append = (from: number, to: number): void => {
    if (bufferStart < 0) bufferStart = from;
    buffer += content.slice(from, to);
  };

  while (i < content.length) {
    const ch = content[i];

    if (ch === '/' && content[i + 1] === '*') {
      const close = content.indexOf('*/', i + 2);
      i = close === -1 ? content.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = skipString(content, i);
      append(i, end);
      i = end;
      continue;
    }
    if (ch === '(') {
      const end = skipParens(content, i);
      append(i, end);
      i = end;
      continue;
    }

    if (ch === '{') {
      const prelude = buffer.trim();
      const selStart = bufferStart;
      buffer = '';
      bufferStart = -1;
      if (/^@(media|supports)\b/i.test(prelude)) {
        stack.push({ type: 'media', prelude });
      } else if (prelude.startsWith('@')) {
        stack.push({ type: 'other', prelude });
      } else {
        stack.push({
          type: 'rule',
          prelude,
          rule: {
            selector: prelude,
            declarations: [],
            mediaPreludes: mediaPreludes(),
            line: lineAt(content, Math.max(selStart, 0)),
          },
        });
      }
      i++;
      continue;
    }

    if (ch === ';') {
      const statement = buffer.trim();
      const statementStart = bufferStart;
      buffer = '';
      bufferStart = -1;
      const top = stack[stack.length - 1];
      if (top?.type === 'rule' && top.rule) {
        const decl = makeDeclaration(statement, Math.max(statementStart, 0), content);
        if (decl) top.rule.declarations.push(decl);
      } else if (/^@import\b/i.test(statement)) {
        const target = extractImportTarget(statement);
        if (target) {
          imports.push({ target, line: lineAt(content, Math.max(statementStart, 0)) });
        }
      }
      i++;
      continue;
    }

    if (ch === '}') {
      const top = stack[stack.length - 1];
      const trailing = buffer.trim();
      const trailingStart = bufferStart;
      buffer = '';
      bufferStart = -1;
      if (top?.type === 'rule' && top.rule && trailing !== '') {
        const decl = makeDeclaration(trailing, Math.max(trailingStart, 0), content);
        if (decl) top.rule.declarations.push(decl);
      }
      if (top) {
        if (top.type === 'rule' && top.rule) {
          rules.push({
            selector: top.rule.selector,
            declarations: top.rule.declarations,
            mediaPreludes: top.rule.mediaPreludes,
            line: top.rule.line,
          });
        }
        stack.pop();
      }
      i++;
      continue;
    }

    append(i, i + 1);
    i++;
  }

  return { rules, imports };
}

/** True when a media-query prelude targets an accessibility preference. */
function isAccessibilityMedia(prelude: string): boolean {
  const lower = prelude.toLowerCase();
  return ACCESSIBILITY_MEDIA_FEATURES.some((feature) => lower.includes(feature));
}

// ---------------------------------------------------------------------------
// Markup signals and selector matching (Requirement 11.1)
// ---------------------------------------------------------------------------

/** The element signals extracted from project HTML markup. */
interface MarkupSignals {
  readonly tags: ReadonlySet<string>;
  readonly ids: ReadonlySet<string>;
  readonly classes: ReadonlySet<string>;
}

/** Collects tag names, ids, and classes referenced across all HTML records. */
function collectMarkup(records: readonly FileRecord[]): MarkupSignals {
  const tags = new Set<string>();
  const ids = new Set<string>();
  const classes = new Set<string>();
  for (const record of records) {
    if (record.language !== 'html' || record.content === null) continue;
    const html = record.content;
    for (const m of html.matchAll(/<([a-zA-Z][\w-]*)/g)) tags.add(m[1].toLowerCase());
    for (const m of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) {
      ids.add(m[1].trim());
    }
    for (const m of html.matchAll(/\bclass\s*=\s*["']([^"']+)["']/g)) {
      for (const cls of m[1].split(/\s+/)) if (cls) classes.add(cls);
    }
  }
  return { tags, ids, classes };
}

/** True when at least one simple token in `selector` matches the markup. */
function selectorMatchesMarkup(selector: string, markup: MarkupSignals): boolean {
  if (selector.includes('*')) return true;
  let recognized = false;
  for (const m of selector.matchAll(/#([\w-]+)/g)) {
    recognized = true;
    if (markup.ids.has(m[1])) return true;
  }
  for (const m of selector.matchAll(/\.([\w-]+)/g)) {
    recognized = true;
    if (markup.classes.has(m[1])) return true;
  }
  for (const m of selector.matchAll(/(^|[\s>+~,(])([a-zA-Z][\w-]*)/g)) {
    const tag = m[2].toLowerCase();
    recognized = true;
    if (markup.tags.has(tag)) return true;
  }
  // A selector with no recognizable simple token is treated as matching, so an
  // import is only ever flagged unused on positive evidence (no false removal).
  return !recognized;
}

/** True when any rule in the referenced stylesheet matches project markup. */
function stylesheetMatchesMarkup(content: string, markup: MarkupSignals): boolean {
  const { rules } = parseCss(content);
  return rules.some((rule) => selectorMatchesMarkup(rule.selector, markup));
}

/** Normalizes a POSIX-style path, resolving `.` and `..` segments. */
function normalizePosix(path: string): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** Resolves an import href relative to the importing file's directory. */
function resolveImportTarget(fromFile: string, target: string): string {
  const clean = target.split('?')[0].split('#')[0];
  if (clean.startsWith('/')) return normalizePosix(clean.slice(1));
  const slash = fromFile.lastIndexOf('/');
  const dir = slash === -1 ? '' : fromFile.slice(0, slash);
  return normalizePosix(dir ? `${dir}/${clean}` : clean);
}

/** Finds the record whose path matches a resolved import target, if any. */
function findTargetRecord(
  resolved: string,
  records: readonly FileRecord[],
): FileRecord | null {
  for (const record of records) {
    if (normalizePosix(record.path) === resolved) return record;
  }
  for (const record of records) {
    const path = normalizePosix(record.path);
    if (path.endsWith(`/${resolved}`) || resolved.endsWith(`/${path}`)) return record;
  }
  return null;
}

/** True when another retained stylesheet imports the same target. */
function referencedByOtherStylesheet(
  resolved: string,
  origin: FileRecord,
  records: readonly FileRecord[],
): boolean {
  for (const record of records) {
    if (record === origin || record.language !== 'css' || record.content === null) {
      continue;
    }
    const { imports } = parseCss(record.content);
    for (const imp of imports) {
      if (resolveImportTarget(record.path, imp.target) === resolved) return true;
    }
  }
  return false;
}

/** True when an import is unused per Requirement 11.1's definition. */
function isImportUnused(
  imp: CssImport,
  origin: FileRecord,
  records: readonly FileRecord[],
  markup: MarkupSignals,
): boolean {
  const resolved = resolveImportTarget(origin.path, imp.target);
  const target = findTargetRecord(resolved, records);
  // Cannot prove the target is unused without its contents: never remove.
  if (!target || target.content === null) return false;
  if (stylesheetMatchesMarkup(target.content, markup)) return false;
  if (referencedByOtherStylesheet(resolved, origin, records)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Specificity analysis and behavior-preserving `!important` rewriting
// ---------------------------------------------------------------------------

/** Computes the specificity of a single (non-list) selector. */
function computeSpecificity(selectorPart: string): Specificity {
  let part = selectorPart.trim();
  let a = 0;
  let b = 0;
  let c = 0;
  // Pseudo-elements count as type selectors; remove first so `:` rules don't.
  part = part.replace(/::[\w-]+/g, () => {
    c++;
    return ' ';
  });
  part = part.replace(/#[\w-]+/g, () => {
    a++;
    return ' ';
  });
  part = part.replace(/\.[\w-]+/g, () => {
    b++;
    return ' ';
  });
  part = part.replace(/\[[^\]]*\]/g, () => {
    b++;
    return ' ';
  });
  part = part.replace(/:[\w-]+(\([^)]*\))?/g, () => {
    b++;
    return ' ';
  });
  for (const m of part.matchAll(/(^|[\s>+~])([a-zA-Z][\w-]*)/g)) {
    if (m[2]) c++;
  }
  return [a, b, c];
}

/** Lexicographic comparison of two specificities (`> 0` when `x` wins). */
function compareSpecificity(x: Specificity, y: Specificity): number {
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

/** Splits a selector list into its top-level comma-separated parts. */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

/** Returns the final compound segment of a selector part (after combinators). */
function lastCompound(part: string): string {
  const segments = part.split(/[\s>+~]+/).filter((s) => s !== '');
  return segments.length === 0 ? part : segments[segments.length - 1];
}

/**
 * Picks a class or id token from the last compound that can be duplicated to
 * raise specificity without changing the set of matched elements. Prefers an id
 * (raises the `a` component) over a class. Returns `null` when the last compound
 * has no class or id (e.g. a bare type selector), where boosting is unsafe.
 */
function pickBoostToken(part: string): { token: string; isId: boolean } | null {
  const compound = lastCompound(part);
  const idMatch = /#[\w-]+/.exec(compound);
  if (idMatch) return { token: idMatch[0], isId: true };
  const classMatch = /\.[\w-]+/.exec(compound);
  if (classMatch) return { token: classMatch[0], isId: false };
  return null;
}

/**
 * Boosts one selector part so its specificity is strictly greater than
 * `target`, by duplicating a class/id token from its last compound. Returns the
 * rewritten part, or `null` when no safe boost reaches the target specificity.
 */
function boostPart(part: string, target: Specificity): string | null {
  if (compareSpecificity(computeSpecificity(part), target) > 0) return part;
  const boost = pickBoostToken(part);
  if (!boost) return null;
  let boosted = part;
  for (let k = 0; k < MAX_SPECIFICITY_BOOST; k++) {
    boosted += boost.token;
    if (compareSpecificity(computeSpecificity(boosted), target) > 0) return boosted;
  }
  return null;
}

/** Serializes a declaration back to CSS text. */
function renderDeclaration(decl: CssDeclaration): string {
  return `  ${decl.property}: ${decl.value}${decl.important ? ' !important' : ''};`;
}

/** Serializes a rule (selector + declarations) back to CSS text. */
function renderRule(selector: string, declarations: readonly CssDeclaration[]): string {
  const body = declarations.map(renderDeclaration).join('\n');
  return `${selector} {\n${body}\n}`;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/** Detects CSS quality defects across the read inventory (pure). */
export class CssQualityDetector implements Detector {
  readonly domain = 'css' as const;

  detect(records: readonly FileRecord[]): readonly Finding[] {
    const findings: Finding[] = [];
    const markup = collectMarkup(records);
    for (const record of records) {
      if (record.language !== 'css' || record.content === null) continue;
      const parsed = parseCss(record.content);
      this.collectImportFindings(parsed, record, records, markup, findings);
      this.collectImportantFindings(parsed, record, findings);
    }
    return findings;
  }

  private collectImportFindings(
    parsed: ParsedCss,
    record: FileRecord,
    records: readonly FileRecord[],
    markup: MarkupSignals,
    out: Finding[],
  ): void {
    for (const imp of parsed.imports) {
      if (!isImportUnused(imp, record, records, markup)) continue;
      out.push({
        domain: 'css',
        path: record.path,
        location: { line: imp.line },
        kind: KIND_UNUSED_IMPORT,
        detail: `Unused CSS import '${imp.target}': referenced stylesheet matches no project markup and is not referenced by any other retained stylesheet.`,
        autoFixable: true,
      });
    }
  }

  private collectImportantFindings(
    parsed: ParsedCss,
    record: FileRecord,
    out: Finding[],
  ): void {
    for (const rule of parsed.rules) {
      const accessible = rule.mediaPreludes.some(isAccessibilityMedia);
      for (const decl of rule.declarations) {
        if (!decl.important) continue;
        out.push(
          accessible
            ? {
                domain: 'css',
                path: record.path,
                location: { line: decl.line, selector: rule.selector },
                kind: KIND_ACCESSIBILITY_IMPORTANT,
                detail: `'!important' on '${decl.property}' inside an accessibility media query is preserved.`,
                autoFixable: false,
              }
            : {
                domain: 'css',
                path: record.path,
                location: { line: decl.line, selector: rule.selector },
                kind: KIND_IMPORTANT,
                detail: `Non-accessibility '!important' on '${decl.property}' should be rewritten via increased specificity.`,
                autoFixable: true,
              },
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Fixer
// ---------------------------------------------------------------------------

/** Builds a preservation outcome with a recorded reason. */
function preserve(reason: string): FixOutcome {
  return { edits: [], preserved: true, preservationReason: reason };
}

/** Fixes CSS quality findings, preserving computed style or recording why not. */
export class CssQualityFixer implements Fixer {
  readonly domain = 'css' as const;

  fix(finding: Finding, record: FileRecord): FixOutcome {
    if (record.content === null) {
      return preserve('File content was unavailable, so no CSS edit could be made.');
    }
    switch (finding.kind) {
      case KIND_UNUSED_IMPORT:
        return this.removeUnusedImport(finding, record);
      case KIND_ACCESSIBILITY_IMPORTANT:
        return this.preserveAccessibilityImportant(finding);
      case KIND_IMPORTANT:
        return this.rewriteImportant(finding, record);
      default:
        return preserve(`Unrecognized CSS finding kind '${finding.kind}'.`);
    }
  }

  /** Requirement 11.1: delete the unused import statement. */
  private removeUnusedImport(finding: Finding, record: FileRecord): FixOutcome {
    const edit: Edit = {
      kind: 'delete',
      path: record.path,
      range: { line: finding.location.line },
      placeholderInserted: false,
    };
    return { edits: [edit], preserved: false };
  }

  /** Requirements 11.4/11.5: always preserve, recording the justification. */
  private preserveAccessibilityImportant(finding: Finding): FixOutcome {
    const features = ACCESSIBILITY_MEDIA_FEATURES.join(', ');
    return preserve(
      `'!important' preserved inside an accessibility media query (${features}) to guarantee the accessibility preference reliably overrides other styles (selector '${finding.location.selector ?? ''}').`,
    );
  }

  /**
   * Requirements 11.2/11.3: rewrite a non-accessibility `!important` so it wins
   * the cascade through specificity, preserving identical computed style, or
   * preserve it with a reason when that cannot be guaranteed.
   */
  private rewriteImportant(finding: Finding, record: FileRecord): FixOutcome {
    const content = record.content as string;
    const parsed = parseCss(content);
    const located = this.locateTarget(parsed, finding);
    if (!located) {
      return preserve('Target `!important` declaration could not be located for rewriting.');
    }
    const { rule, declaration } = located;

    const competing = this.collectCompeting(parsed, rule, declaration);
    if (competing.hasImportant) {
      return preserve(
        `'!important' on '${declaration.property}' preserved: another '!important' declaration of the same property competes, so removing it cannot guarantee an identical computed style.`,
      );
    }

    const parts = splitSelectorList(rule.selector);
    if (parts.length === 0) {
      return preserve('Selector could not be parsed for a specificity-preserving rewrite.');
    }

    // No competing declaration outranks the target: dropping `!important` alone
    // keeps it winning, producing an identical computed style.
    if (this.alreadyWins(parts, competing.maxSpecificity)) {
      return this.emitInPlaceRemoval(rule, declaration, record.path);
    }

    return this.emitSpecificityRewrite(
      rule,
      declaration,
      parts,
      competing.maxSpecificity,
      record.path,
    );
  }

  /** Finds the rule and declaration referenced by an `!important` finding. */
  private locateTarget(
    parsed: ParsedCss,
    finding: Finding,
  ): { rule: CssRule; declaration: CssDeclaration } | null {
    const selector = finding.location.selector;
    const line = finding.location.line;
    for (const rule of parsed.rules) {
      if (rule.selector !== selector) continue;
      const declaration = rule.declarations.find(
        (d) => d.important && (line === undefined || d.line === line),
      );
      if (declaration) return { rule, declaration };
    }
    return null;
  }

  /** Summarizes other declarations of the same property in the stylesheet. */
  private collectCompeting(
    parsed: ParsedCss,
    targetRule: CssRule,
    target: CssDeclaration,
  ): { hasImportant: boolean; maxSpecificity: Specificity } {
    const property = target.property.toLowerCase();
    let hasImportant = false;
    let maxSpecificity: Specificity = [0, 0, 0];
    for (const rule of parsed.rules) {
      for (const decl of rule.declarations) {
        const isTarget = rule === targetRule && decl === target;
        if (isTarget || decl.property.toLowerCase() !== property) continue;
        if (decl.important) hasImportant = true;
        for (const part of splitSelectorList(rule.selector)) {
          const spec = computeSpecificity(part);
          if (compareSpecificity(spec, maxSpecificity) > 0) maxSpecificity = spec;
        }
      }
    }
    return { hasImportant, maxSpecificity };
  }

  /** True when every selector part already outranks the competing maximum. */
  private alreadyWins(parts: readonly string[], competitor: Specificity): boolean {
    return parts.every((part) => compareSpecificity(computeSpecificity(part), competitor) > 0);
  }

  /** Emits a rewrite that removes only `!important`, leaving the rule otherwise intact. */
  private emitInPlaceRemoval(
    rule: CssRule,
    target: CssDeclaration,
    path: string,
  ): FixOutcome {
    const declarations = rule.declarations.map((decl) =>
      decl === target ? { ...decl, important: false } : decl,
    );
    const edit: Edit = {
      kind: 'replace',
      path,
      range: { line: rule.line, selector: rule.selector },
      text: renderRule(rule.selector, declarations),
      placeholderInserted: false,
    };
    return { edits: [edit], preserved: false };
  }

  /**
   * Emits a rewrite that moves the target declaration into a new,
   * higher-specificity rule (matching the identical elements) so it wins the
   * cascade without `!important`, leaving sibling declarations untouched.
   */
  private emitSpecificityRewrite(
    rule: CssRule,
    target: CssDeclaration,
    parts: readonly string[],
    competitor: Specificity,
    path: string,
  ): FixOutcome {
    const boostedParts: string[] = [];
    for (const part of parts) {
      const boosted = boostPart(part, competitor);
      if (boosted === null) {
        return preserve(
          `'!important' on '${target.property}' preserved: selector '${rule.selector}' cannot be raised above the competing specificity without '!important' (no class or id available on its final compound).`,
        );
      }
      boostedParts.push(boosted);
    }

    const remaining = rule.declarations.filter((decl) => decl !== target);
    const boostedRule = renderRule(boostedParts.join(', '), [{ ...target, important: false }]);
    const text =
      remaining.length === 0
        ? boostedRule
        : `${renderRule(rule.selector, remaining)}\n${boostedRule}`;

    const edit: Edit = {
      kind: 'replace',
      path,
      range: { line: rule.line, selector: rule.selector },
      text,
      placeholderInserted: false,
    };
    return { edits: [edit], preserved: false };
  }
}

/** Shared detector instance for orchestrator wiring. */
export const cssDetector: Detector = new CssQualityDetector();

/** Shared fixer instance for orchestrator wiring. */
export const cssFixer: Fixer = new CssQualityFixer();
