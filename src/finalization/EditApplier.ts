// Feature: pre-ship-finalization
//
// EditApplier — the seam between pure fixers (which return Edit[]) and the
// records the recheck loop re-detects over.
//
// Fixers never touch disk; they return edits. The recheck loop (Orchestrator,
// task 18.1) needs to *apply* those edits so the next detection pass runs over
// the corrected content and the loop can converge. This module provides an
// in-memory applier that transforms `FileRecord[] + Edit[]` into a new
// `FileRecord[]` without performing any I/O.
//
// Disk mutation (writing files, moving on disk, `git rm --cached`) belongs to
// task 20.1, which adds a disk-writing applier implementing the same
// {@link EditApplier} interface. Keeping the interface here lets the loop be
// driven by either an in-memory applier (tests, recheck convergence) or the
// real disk applier (the end-to-end pass) without changing the loop.

import type { Edit, FileRecord, SourceLanguage } from './types';

/**
 * The result of applying a batch of edits to an in-memory inventory.
 *
 * `records` is the new inventory after every edit was applied. `changed` lists
 * the paths of pre-existing files whose content (or tracking state) was
 * modified; `created` lists paths of files that did not exist before. The two
 * lists are disjoint and each path appears at most once, which is exactly what
 * the Finalization_Report needs to mark each entry as changed or created
 * (Requirement 15.2).
 */
export interface ApplyResult {
  readonly records: readonly FileRecord[];
  readonly changed: readonly string[];
  readonly created: readonly string[];
}

/**
 * Applies fixer edits to an inventory. Implementations may be pure (in-memory,
 * used by the recheck loop and tests) or disk-mutating (task 20.1). The loop
 * depends only on this contract.
 */
export interface EditApplier {
  apply(records: readonly FileRecord[], edits: readonly Edit[]): ApplyResult;
}

/** Maps a lowercased extension (without dot) to a SourceLanguage. */
const EXTENSION_LANGUAGE: ReadonlyMap<string, SourceLanguage> = new Map<
  string,
  SourceLanguage
>([
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['css', 'css'],
  ['html', 'html'],
  ['htm', 'html'],
  ['json', 'json'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
]);

/** Derive the SourceLanguage for a created file from its path extension. */
function languageForPath(path: string): SourceLanguage {
  const lastSlash = path.lastIndexOf('/');
  const fileName = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0) {
    return 'other';
  }
  const ext = fileName.slice(lastDot + 1).toLowerCase();
  return EXTENSION_LANGUAGE.get(ext) ?? 'other';
}

/** UTF-8 byte length of a string (FileRecord.bytes is the on-disk byte count). */
function byteLength(text: string): number {
  // TextEncoder is available in both the browser app target and Node/vitest.
  return new TextEncoder().encode(text).length;
}

/** Build a fresh FileRecord for newly created in-memory content. */
function makeRecord(path: string, content: string): FileRecord {
  return {
    path,
    content,
    bytes: byteLength(content),
    readError: null,
    language: languageForPath(path),
  };
}

/** Replace the content of an existing record, recomputing its byte length. */
function withContent(record: FileRecord, content: string): FileRecord {
  return { ...record, content, bytes: byteLength(content) };
}

/**
 * A mutable working copy of a single file while its edits are applied. `exists`
 * tracks whether the file was in the original inventory (to classify the result
 * as changed vs created); `deleted` marks a file removed by a delete/move edit.
 */
interface WorkingFile {
  path: string;
  content: string;
  existed: boolean;
  original: FileRecord | null;
  touched: boolean;
  deleted: boolean;
}

/**
 * In-memory {@link EditApplier}. Applies edits to copies of the records and
 * returns a new inventory. Performs no I/O, so it is deterministic and safe to
 * run inside the recheck loop and in property tests.
 *
 * Supported edit kinds:
 *   - `create`  — add a new file (or overwrite when one already exists at path).
 *   - `replace` — whole-file replace when no positional `range` is given;
 *                 single-line replace when `range.line` is present.
 *   - `insert`  — insert `text` before `range.line`, or append when no range.
 *   - `delete`  — delete a single line (`range.line`) or the whole file (no range).
 *   - `move`    — relocate content to `newPath`; the source path is removed.
 *   - `untrack` — leave content on disk unchanged; marks the file changed so the
 *                 report records the untracking (Requirement 7.4).
 *
 * Edits are applied in array order on a per-file working copy, so later edits
 * observe the effects of earlier ones. Conflicting whole-file replaces resolve
 * last-write-wins; faithful multi-region merging is the disk applier's concern
 * (task 20.1).
 */
export class InMemoryEditApplier implements EditApplier {
  apply(records: readonly FileRecord[], edits: readonly Edit[]): ApplyResult {
    const files = new Map<string, WorkingFile>();
    for (const record of records) {
      files.set(record.path, {
        path: record.path,
        content: record.content ?? '',
        existed: true,
        original: record,
        touched: false,
        deleted: false,
      });
    }

    for (const edit of edits) {
      this.#applyOne(files, edit);
    }

    const resultRecords: FileRecord[] = [];
    const changed: string[] = [];
    const created: string[] = [];

    for (const file of files.values()) {
      if (file.deleted) {
        continue;
      }
      if (!file.existed) {
        resultRecords.push(makeRecord(file.path, file.content));
        created.push(file.path);
        continue;
      }
      if (file.original !== null && file.touched) {
        resultRecords.push(withContent(file.original, file.content));
        changed.push(file.path);
      } else if (file.original !== null) {
        resultRecords.push(file.original);
      }
    }

    return { records: resultRecords, changed, created };
  }

  #applyOne(files: Map<string, WorkingFile>, edit: Edit): void {
    switch (edit.kind) {
      case 'create':
        this.#applyCreate(files, edit);
        return;
      case 'replace':
        this.#applyReplace(files, edit);
        return;
      case 'insert':
        this.#applyInsert(files, edit);
        return;
      case 'delete':
        this.#applyDelete(files, edit);
        return;
      case 'move':
        this.#applyMove(files, edit);
        return;
      case 'untrack':
        this.#applyUntrack(files, edit);
        return;
      default:
        // Exhaustive: EditKind has no other members.
        return;
    }
  }

  /** Fetch the working file for a path, creating an empty one if absent. */
  #ensure(files: Map<string, WorkingFile>, path: string): WorkingFile {
    let file = files.get(path);
    if (file === undefined) {
      file = {
        path,
        content: '',
        existed: false,
        original: null,
        touched: false,
        deleted: false,
      };
      files.set(path, file);
    }
    return file;
  }

  #applyCreate(files: Map<string, WorkingFile>, edit: Edit): void {
    const file = this.#ensure(files, edit.path);
    if (file.existed) {
      // A `create` against an existing file behaves as an append-or-replace:
      // appending keeps prior documented entries (e.g. env templates).
      const base = file.content;
      const separator =
        base.length > 0 && !base.endsWith('\n') ? '\n' : '';
      file.content = `${base}${separator}${edit.text ?? ''}`;
    } else {
      file.content = edit.text ?? '';
    }
    file.deleted = false;
    file.touched = true;
  }

  #applyReplace(files: Map<string, WorkingFile>, edit: Edit): void {
    const file = this.#ensure(files, edit.path);
    const line = edit.range?.line;
    if (line === undefined) {
      file.content = edit.text ?? '';
      file.touched = true;
      return;
    }
    const lines = file.content.split('\n');
    const index = line - 1;
    if (index < 0 || index >= lines.length) {
      // Out-of-range line: nothing to replace deterministically; leave as-is.
      return;
    }
    lines[index] = edit.text ?? '';
    file.content = lines.join('\n');
    file.touched = true;
  }

  #applyInsert(files: Map<string, WorkingFile>, edit: Edit): void {
    const file = this.#ensure(files, edit.path);
    const text = edit.text ?? '';
    const line = edit.range?.line;
    if (line === undefined) {
      const separator =
        file.content.length > 0 && !file.content.endsWith('\n') ? '\n' : '';
      file.content = `${file.content}${separator}${text}`;
      file.touched = true;
      return;
    }
    const lines = file.content.split('\n');
    const index = Math.max(0, Math.min(line - 1, lines.length));
    lines.splice(index, 0, text);
    file.content = lines.join('\n');
    file.touched = true;
  }

  #applyDelete(files: Map<string, WorkingFile>, edit: Edit): void {
    const file = files.get(edit.path);
    if (file === undefined) {
      return;
    }
    const line = edit.range?.line;
    if (line === undefined) {
      // Whole-file removal (e.g. a transient loose artifact, Requirement 7.8).
      file.deleted = true;
      file.touched = true;
      return;
    }
    const lines = file.content.split('\n');
    const index = line - 1;
    if (index < 0 || index >= lines.length) {
      return;
    }
    lines.splice(index, 1);
    file.content = lines.join('\n');
    file.touched = true;
  }

  #applyMove(files: Map<string, WorkingFile>, edit: Edit): void {
    if (edit.newPath === undefined) {
      return;
    }
    const source = files.get(edit.path);
    if (source === undefined) {
      return;
    }
    const destination = this.#ensure(files, edit.newPath);
    destination.content = source.content;
    destination.deleted = false;
    destination.touched = true;
    source.deleted = true;
    source.touched = true;
  }

  #applyUntrack(files: Map<string, WorkingFile>, edit: Edit): void {
    const file = files.get(edit.path);
    if (file === undefined) {
      return;
    }
    // Untracking removes the path from version control but preserves the file on
    // disk (Requirement 7.4). In-memory the content is unchanged; we mark it
    // touched so the report records the untracking as a change.
    file.touched = true;
  }
}
