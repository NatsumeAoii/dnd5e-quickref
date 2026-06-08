// Feature: pre-ship-finalization
//
// DiskEditApplier — the disk-mutating EditApplier and the ONLY component in the
// toolkit that writes to the working tree as part of the end-to-end pass.
//
// Pure fixers return Edit[]; the orchestrator's recheck loop converges using the
// in-memory applier (deterministic, no I/O). For the real end-to-end pass the
// orchestrator swaps in this applier so the converged edits are persisted to
// disk. To keep the in-memory recheck semantics identical, this class delegates
// the pure FileRecord transformation to {@link InMemoryEditApplier} and then
// reconciles the resulting target state onto disk:
//
//   - create  — write a new file (parent directories created as needed).
//   - replace — write the file's final content (whole-file or single-line).
//   - insert  — write the file's final content after the insertion.
//   - delete  — remove a single line (whole-file content rewrite) or, for a
//               whole-file delete, unlink the file from disk.
//   - move    — relocate content to `newPath` via `fs.rename` (ensuring the
//               destination directory exists) and remove the source.
//   - untrack — `git rm --cached` through the CommandRunner so the path leaves
//               version control while the file is preserved on disk (Req 7.4).
//
// The returned {@link ApplyResult} is exactly the in-memory result, so the
// orchestrator's bookkeeping (changed/created lists, recheck convergence) is
// unchanged whether the in-memory or the disk applier is used.
//
// Node built-in types are intentionally absent from this browser app's tsconfig
// (no `@types/node`; see FileInventory.ts for the same pattern), so the `node:`
// imports below are marked `@ts-expect-error` and re-typed locally to keep the
// rest of this module fully type-checked.

// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { existsSync as nodeExistsSync, mkdirSync as nodeMkdirSync, renameSync as nodeRenameSync, rmSync as nodeRmSync, writeFileSync as nodeWriteFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { dirname as nodeDirname, isAbsolute as nodeIsAbsolute, join as nodeJoin, resolve as nodeResolve } from 'node:path';

import { CommandRunner } from './CommandRunner';
import {
  InMemoryEditApplier,
  type ApplyResult,
  type EditApplier,
} from './EditApplier';
import type { Edit, FileRecord } from './types';

// Local typed views over the dynamically-typed Node imports. These keep the
// implementation body type-safe without leaking Node types into the project.
const existsSync = nodeExistsSync as (path: string) => boolean;
const mkdirSync = nodeMkdirSync as (
  path: string,
  options: { readonly recursive: true },
) => string | undefined;
const renameSync = nodeRenameSync as (from: string, to: string) => void;
const rmSync = nodeRmSync as (
  path: string,
  options?: { readonly force?: boolean },
) => void;
const writeFileSync = nodeWriteFileSync as (
  path: string,
  data: string,
  encoding: string,
) => void;
const dirname = nodeDirname as (path: string) => string;
const isAbsolute = nodeIsAbsolute as (path: string) => boolean;
const join = nodeJoin as (...paths: string[]) => string;
const resolve = nodeResolve as (...paths: string[]) => string;

/** Encoding used when writing file contents to disk. */
const TEXT_ENCODING = 'utf-8';

/** Options for constructing a {@link DiskEditApplier}. */
export interface DiskEditApplierOptions {
  /** Repository root used to resolve repo-relative POSIX paths to disk paths. */
  readonly rootDir: string;
  /**
   * Process boundary used to run `git rm --cached` for untrack edits. Defaults
   * to a {@link CommandRunner} scoped to `rootDir`. Inject a runner to test the
   * untrack path without spawning git.
   */
  readonly commandRunner?: CommandRunner;
  /**
   * The pure applier used to compute the target inventory state. Defaults to a
   * fresh {@link InMemoryEditApplier}. Exposed for testing only.
   */
  readonly inMemoryApplier?: EditApplier;
}

/**
 * Disk-mutating {@link EditApplier}. Computes the post-edit inventory with the
 * in-memory applier (so behavior matches the recheck loop exactly), then makes
 * the working tree match that target state. This is the single seam where the
 * finalization pass touches the filesystem and version control.
 */
export class DiskEditApplier implements EditApplier {
  readonly #rootDir: string;
  readonly #commandRunner: CommandRunner;
  readonly #inMemory: EditApplier;

  constructor(options: DiskEditApplierOptions) {
    this.#rootDir = resolve(options.rootDir);
    this.#commandRunner =
      options.commandRunner ?? new CommandRunner({ cwd: this.#rootDir });
    this.#inMemory = options.inMemoryApplier ?? new InMemoryEditApplier();
  }

  /**
   * Apply `edits` to `records`, persisting the result to disk, and return the
   * same {@link ApplyResult} the in-memory applier would produce.
   */
  apply(
    records: readonly FileRecord[],
    edits: readonly Edit[],
  ): ApplyResult {
    const result = this.#inMemory.apply(records, edits);

    const finalByPath = new Map(
      result.records.map((record) => [record.path, record] as const),
    );
    const originalByPath = new Map(
      records.map((record) => [record.path, record] as const),
    );

    // Paths whose disk effect is fully handled by a move or untrack, so the
    // generic write/delete reconciliation below must skip them.
    const movedPaths = new Set<string>();
    const untrackedPaths = new Set<string>();

    // 1. Moves: relocate via fs.rename, ensuring destination directories exist.
    for (const edit of edits) {
      if (edit.kind === 'move' && edit.newPath !== undefined) {
        this.#relocate(edit.path, edit.newPath, finalByPath);
        movedPaths.add(edit.path);
        movedPaths.add(edit.newPath);
      }
    }

    // 2. Untracks: `git rm --cached` removes the path from version control while
    //    leaving the file on disk untouched (Requirement 7.4).
    for (const edit of edits) {
      if (edit.kind === 'untrack') {
        untrackedPaths.add(edit.path);
        this.#untrack(edit.path);
      }
    }

    // 3. Writes: every created or changed file gets its final content written.
    //    A pure untrack leaves content unchanged, so it is preserved on disk
    //    rather than rewritten. Move destinations were already written in #relocate.
    const writePaths = new Set<string>([...result.created, ...result.changed]);
    for (const path of writePaths) {
      if (movedPaths.has(path)) {
        continue;
      }
      const finalRecord = finalByPath.get(path);
      if (finalRecord === undefined || finalRecord.content === null) {
        continue;
      }
      if (
        untrackedPaths.has(path) &&
        this.#contentUnchanged(originalByPath.get(path), finalRecord)
      ) {
        continue;
      }
      this.#writeFile(path, finalRecord.content);
    }

    // 4. Deletions: a file present originally but absent from the final
    //    inventory was deleted (or moved away). Move sources were already
    //    renamed off disk, so the existence guard skips them.
    for (const path of originalByPath.keys()) {
      if (finalByPath.has(path) || movedPaths.has(path)) {
        continue;
      }
      this.#deleteIfPresent(path);
    }

    return result;
  }

  /** Resolve a repo-relative POSIX path to an absolute disk path. */
  #toDiskPath(path: string): string {
    return isAbsolute(path) ? path : join(this.#rootDir, path);
  }

  /** Create the parent directory of a disk path if it does not already exist. */
  #ensureParentDir(diskPath: string): void {
    mkdirSync(dirname(diskPath), { recursive: true });
  }

  /** Write `content` to `path`, creating parent directories as needed. */
  #writeFile(path: string, content: string): void {
    const diskPath = this.#toDiskPath(path);
    this.#ensureParentDir(diskPath);
    writeFileSync(diskPath, content, TEXT_ENCODING);
  }

  /**
   * Relocate `sourcePath` to `destinationPath`. The destination directory is
   * created first; if the source exists it is renamed, otherwise the final
   * content is written fresh. When edits also changed the content during the
   * same batch, the destination is rewritten with the authoritative final
   * content so disk matches the in-memory result exactly.
   */
  #relocate(
    sourcePath: string,
    destinationPath: string,
    finalByPath: ReadonlyMap<string, FileRecord>,
  ): void {
    const sourceDisk = this.#toDiskPath(sourcePath);
    const destinationDisk = this.#toDiskPath(destinationPath);
    this.#ensureParentDir(destinationDisk);

    if (existsSync(sourceDisk)) {
      renameSync(sourceDisk, destinationDisk);
    }

    const finalRecord = finalByPath.get(destinationPath);
    if (finalRecord !== undefined && finalRecord.content !== null) {
      writeFileSync(destinationDisk, finalRecord.content, TEXT_ENCODING);
    }
  }

  /**
   * Remove `path` from version control while preserving the file on disk
   * (Requirement 7.4). Runs `git rm --cached` exactly once through the
   * CommandRunner; the result is captured but a non-zero status (e.g. the path
   * was never tracked) does not abort the pass.
   */
  #untrack(path: string): void {
    this.#commandRunner.run(`git rm --cached -- "${path}"`);
  }

  /** Delete a file from disk when it is present; a no-op otherwise. */
  #deleteIfPresent(path: string): void {
    const diskPath = this.#toDiskPath(path);
    if (existsSync(diskPath)) {
      rmSync(diskPath, { force: true });
    }
  }

  /** True when the original and final records carry identical text content. */
  #contentUnchanged(
    original: FileRecord | undefined,
    final: FileRecord,
  ): boolean {
    return original !== undefined && original.content === final.content;
  }
}
