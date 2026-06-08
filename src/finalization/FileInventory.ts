// Feature: pre-ship-finalization
//
// FileInventory — the I/O boundary that enumerates and reads the working tree.
//
// This is the only module in the toolkit (besides CommandRunner / EditApplier)
// permitted to touch the filesystem. It produces `FileRecord[]` from real files
// so the pure detectors downstream operate entirely on in-memory content.
//
// Contract (design "Components and Interfaces" + Requirements 1.1, 1.2, 1.4):
//   - enumerate(rootDir): every path in the working tree, excluding the
//     contents of `node_modules/`, `dist/`, and `.git/`. Paths are repo-relative
//     and use POSIX separators.
//   - readAll(paths): full first-byte-to-last-byte reads. A read failure yields
//     a FileRecord with `content: null` and a populated `readError`, and never
//     drops the other files.
//
// Node built-in types are intentionally absent from the browser app tsconfig
// (the project depends on no `@types/node`; see the existing tests under
// `src/__tests__`). Following that established convention, the `node:` imports
// below are marked `@ts-expect-error` and re-typed locally so the rest of this
// module stays fully type-checked.

// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { readdirSync as nodeReaddirSync, readFileSync as nodeReadFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the browser app tsconfig.
import { isAbsolute as nodeIsAbsolute, join as nodeJoin, relative as nodeRelative, resolve as nodeResolve, sep as nodeSep } from 'node:path';

import type { FileRecord, SourceLanguage } from './types';

/** A directory entry as returned by `readdirSync(..., { withFileTypes: true })`. */
interface Dirent {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

/**
 * Minimal view of a Node `Buffer` returned by `readFileSync(path)` with no
 * encoding argument. Only the members this module uses are declared.
 */
interface NodeBuffer {
  readonly length: number;
  toString(encoding?: string): string;
  includes(value: number): boolean;
}

// Local typed views over the dynamically-typed Node imports. These keep the
// implementation body type-safe without leaking Node types into the project.
const readdirSync = nodeReaddirSync as (
  path: string,
  options: { readonly withFileTypes: true },
) => Dirent[];
const readFileSync = nodeReadFileSync as (path: string) => NodeBuffer;
const resolve = nodeResolve as (...paths: string[]) => string;
const join = nodeJoin as (...paths: string[]) => string;
const relative = nodeRelative as (from: string, to: string) => string;
const isAbsolute = nodeIsAbsolute as (p: string) => boolean;
const sep = nodeSep as string;

/**
 * Directory names whose contents are excluded from enumeration (Requirement 1.1).
 * The match is on a path segment, so a directory named exactly one of these at
 * any depth is skipped along with everything beneath it.
 */
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.git',
]);

/**
 * Maps a lowercased file extension (without the dot) to a SourceLanguage.
 * Extensions not listed here resolve to `'other'`.
 */
const EXTENSION_LANGUAGE: ReadonlyMap<string, SourceLanguage> = new Map([
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

/** UTF-8 encoding label used for decoding file contents. */
const TEXT_ENCODING = 'utf-8';

/** Byte value of NUL, used as a heuristic to detect binary (non-text) files. */
const NUL_BYTE = 0;

/**
 * Convert any OS-specific path to repo-relative POSIX form.
 * The inventory contract requires forward slashes regardless of platform so
 * downstream path comparisons (exclusion checks, manifest matching) are stable.
 */
function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

/**
 * Derive the SourceLanguage from a path's extension. Returns `'other'` when the
 * extension is unrecognized or the file has no extension.
 */
function languageForPath(posixPath: string): SourceLanguage {
  const lastSlash = posixPath.lastIndexOf('/');
  const fileName = lastSlash === -1 ? posixPath : posixPath.slice(lastSlash + 1);
  const lastDot = fileName.lastIndexOf('.');
  // No dot, or a leading-dot dotfile with no further extension (e.g. ".gitignore").
  if (lastDot <= 0) {
    return 'other';
  }
  const ext = fileName.slice(lastDot + 1).toLowerCase();
  return EXTENSION_LANGUAGE.get(ext) ?? 'other';
}

/**
 * Stringify an unknown thrown value into a stable, human-readable reason.
 * Read failures arrive as thrown errors of varying shapes; this normalizes them
 * for the `readError` field without leaking non-string internals.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/**
 * The filesystem-backed inventory. Construction is side-effect free; all I/O
 * happens inside `enumerate` and `readAll`.
 */
export class FileInventory {
  /**
   * Enumerate every file under `rootDir`, excluding the contents of
   * `node_modules/`, `dist/`, and `.git/` at any depth.
   *
   * @param rootDir Absolute or relative path to the repository root.
   * @returns Repo-relative POSIX paths, sorted for deterministic ordering.
   */
  enumerate(rootDir: string): readonly string[] {
    const absoluteRoot = resolve(rootDir);
    const collected: string[] = [];
    this.#walk(absoluteRoot, absoluteRoot, collected);
    // Sort so enumeration order is deterministic across platforms/filesystems.
    return collected.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /**
   * Recursively descend `currentDir`, appending repo-relative POSIX file paths
   * to `out`. Directories in the exclusion set are skipped entirely (their
   * contents are never read). Only regular files are enumerated; symbolic links
   * and other special entries are ignored to avoid cycles and escaping the tree.
   */
  #walk(absoluteRoot: string, currentDir: string, out: string[]): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      // A directory we cannot list contributes no files. Individual file read
      // failures are surfaced by readAll; an unreadable directory simply yields
      // nothing rather than aborting the whole enumeration.
      return;
    }

    for (const entry of entries) {
      const childAbsolute = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        this.#walk(absoluteRoot, childAbsolute, out);
        continue;
      }

      // Only enumerate real files; skip symlinks and other non-regular entries.
      if (!entry.isFile()) {
        continue;
      }

      out.push(toPosix(relative(absoluteRoot, childAbsolute)));
    }
  }

  /**
   * Read every path fully (first byte to last byte) and produce a FileRecord
   * for each. A read failure produces a record with `content: null` and a
   * populated `readError`; the remaining paths are still read so no file is
   * dropped (Requirement 1.4).
   *
   * @param paths Repo-relative POSIX paths (typically from `enumerate`).
   * @param rootDir Root used to resolve relative paths to disk. Defaults to the
   *   current working directory when omitted.
   */
  readAll(paths: readonly string[], rootDir: string = '.'): readonly FileRecord[] {
    const absoluteRoot = resolve(rootDir);
    return paths.map((path) => this.#readOne(path, absoluteRoot));
  }

  /**
   * Read a single path into a FileRecord. Never throws: I/O failures are
   * captured into the returned record's `readError`.
   */
  #readOne(path: string, absoluteRoot: string): FileRecord {
    const language = languageForPath(path);
    const diskPath = isAbsolute(path) ? path : join(absoluteRoot, path);

    try {
      const buffer = readFileSync(diskPath);
      const bytes = buffer.length;

      // Treat files containing a NUL byte as unreadable binary content: there is
      // no meaningful text for detectors to analyze. Recorded as a read failure
      // so the file is surfaced rather than silently producing garbage content.
      if (buffer.includes(NUL_BYTE)) {
        return {
          path,
          content: null,
          bytes,
          readError: 'binary content (contains NUL byte) is not readable as text',
          language,
        };
      }

      return {
        path,
        content: buffer.toString(TEXT_ENCODING),
        bytes,
        readError: null,
        language,
      };
    } catch (error) {
      return {
        path,
        content: null,
        bytes: 0,
        readError: describeError(error),
        language,
      };
    }
  }
}
