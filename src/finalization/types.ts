// Feature: pre-ship-finalization
//
// Shared contracts for the finalization toolkit.
//
// The toolkit is organized into three layers (see design "Architecture"):
//   - Pure analysis core: detectors and fixers operate over file contents and
//     return structured results without performing any I/O.
//   - I/O boundary: FileInventory (enumerate/read) and EditApplier (write/move).
//   - Process boundary: CommandRunner (lint / type-check / test / build).
//
// This module defines the data contracts every layer shares. Detectors and
// fixers are pure functions over these types, which makes them deterministic
// and property-testable.

/**
 * The literal placeholder token inserted wherever a required value cannot be
 * derived from project context. Tracked as a first-class marker so the report
 * can enumerate every insertion with its file path and location.
 *
 * This is the single source of truth for the token; never inline the string.
 */
export const FILL_IN_PLACEHOLDER = '[FILL IN]';

/**
 * Source language of a file, derived from its extension by the FileInventory.
 * `other` covers any extension that is not one of the recognized source kinds
 * (for example images, fonts, or lockfiles).
 */
export type SourceLanguage =
  | 'typescript'
  | 'javascript'
  | 'css'
  | 'html'
  | 'json'
  | 'markdown'
  | 'other';

/**
 * Location of a finding or edit within a file. In-source findings use
 * `line`/`column`; HTML and CSS findings use `tag`/`selector` instead.
 * All fields are optional because different domains locate findings
 * differently, but at least one is expected to be populated.
 */
export interface CodeLocation {
  readonly line?: number;
  readonly column?: number;
  readonly tag?: string;
  readonly selector?: string;
}

/**
 * A file read from the working tree.
 *
 * `content` is the complete file contents (first byte to last byte) on success,
 * or `null` when the read failed. On failure `readError` carries the reason and
 * enumeration continues, so a failed read never drops other files
 * (Requirement 1.4). The FileInventory class that produces these records is
 * implemented in a later task; this is the shared data contract.
 */
export interface FileRecord {
  /** Repo-relative path using POSIX separators. */
  readonly path: string;
  /** Full file contents, or `null` when the read failed. */
  readonly content: string | null;
  /** Byte length of the file on disk. */
  readonly bytes: number;
  /** Reason the read failed, or `null` when content is present. */
  readonly readError: string | null;
  /** Language derived from the file extension. */
  readonly language: SourceLanguage;
}

/**
 * The ten inspection domains. Each domain implements the Detector/Fixer
 * contract below. Version consistency is handled by the `version` domain.
 */
export type Domain =
  | 'dead-code'
  | 'hardcoded'
  | 'error-boundary'
  | 'naming'
  | 'hygiene'
  | 'version'
  | 'html'
  | 'ts-js-safety'
  | 'css'
  | 'config';

/**
 * A single production-readiness defect located in a specific file.
 *
 * `path` must be the path of a FileRecord that was read during the current
 * pass; findings whose path is not in the input record set are discarded
 * (Requirements 1.5, 1.6).
 */
export interface Finding {
  readonly domain: Domain;
  /** Backing FileRecord.path (Requirement 1.5). */
  readonly path: string;
  /** Line/column or tag/selector locating the finding. */
  readonly location: CodeLocation;
  /** Short machine-readable kind, e.g. 'empty-catch', 'console-debug'. */
  readonly kind: string;
  /** Human-readable description of the defect. */
  readonly detail: string;
  /** Whether a fixer can apply an automatic, behavior-preserving fix. */
  readonly autoFixable: boolean;
}

/**
 * The kinds of mutation an Edit can describe. Only the EditApplier (a later
 * task) acts on these; fixers merely return them.
 */
export type EditKind =
  | 'replace'
  | 'insert'
  | 'delete'
  | 'move'
  | 'untrack'
  | 'create';

/**
 * A single proposed mutation. Fixers return edits; they never touch disk.
 * `newPath` is used by `move`; `range` locates in-file edits; `text` carries
 * replacement or inserted content.
 */
export interface Edit {
  readonly kind: EditKind;
  readonly path: string;
  /** Destination path for a `move` edit. */
  readonly newPath?: string;
  /** Target range for an in-file edit. */
  readonly range?: CodeLocation;
  /** Replacement or inserted content. */
  readonly text?: string;
  /** True when this edit introduces a `[FILL IN]` placeholder. */
  readonly placeholderInserted: boolean;
}

/**
 * The result of attempting to fix a finding.
 *
 * When a finding must be left as-is (for example, a removal that would alter
 * observable behavior), `edits` is empty, `preserved` is `true`, and
 * `preservationReason` records why.
 */
export interface FixOutcome {
  readonly edits: readonly Edit[];
  /** True when the finding was intentionally left unchanged. */
  readonly preserved: boolean;
  /** Reason recorded when `preserved` is true. */
  readonly preservationReason?: string;
}

/**
 * Pure detector for a single inspection domain. Takes the read inventory and
 * returns findings without performing any I/O.
 */
export interface Detector {
  readonly domain: Domain;
  detect(records: readonly FileRecord[]): readonly Finding[];
}

/**
 * Pure fixer for a single inspection domain. Returns the edits required to
 * resolve a finding, or a preservation outcome when the finding must stand.
 */
export interface Fixer {
  readonly domain: Domain;
  fix(finding: Finding, record: FileRecord): FixOutcome;
}

/**
 * A `[FILL IN]` placeholder requiring human completion, with the file path,
 * location, and the configuration/metadata key it stands in for.
 */
export interface PlaceholderRef {
  readonly path: string;
  readonly location: CodeLocation;
  readonly key: string;
}

/**
 * A file that could not be read during enumeration, recorded with its reason
 * so the report can surface it without dropping the file (Requirement 1.4).
 */
export interface ReadFailure {
  readonly path: string;
  readonly reason: string;
}

/**
 * A single entry in the Finalization_Report's changed/created file list.
 *
 * `kind` distinguishes a pre-existing file that was modified (`'changed'`) from
 * a file that did not exist before the pass (`'created'`). The report marks
 * every such entry exactly once (Requirement 15.2).
 */
export interface FileChange {
  /** Repo-relative POSIX path of the affected file. */
  readonly path: string;
  /** Whether the file was modified or newly created. */
  readonly kind: 'changed' | 'created';
}
