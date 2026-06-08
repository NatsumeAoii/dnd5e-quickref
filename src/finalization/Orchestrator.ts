// Feature: pre-ship-finalization
//
// FinalizationOrchestrator (orchestration layer).
//
// The orchestrator owns sequencing and is the single place that drives I/O
// (through FileInventory), edit application (through an injected EditApplier),
// and process execution (through CommandRunner). The pure detectors and fixers
// never touch disk; the orchestrator feeds them the in-memory inventory and
// collects their findings and edits.
//
// This module implements:
//
//   1. Inventory gate (Requirement 1.3): no checklist evaluation runs until the
//      inventory is fully read — every FileRecord must either have content
//      (read successfully) or a recorded readError (read failure).
//
//   2. Finding-trace filter (Requirements 1.5, 1.6): every finding must trace
//      back to a FileRecord that was read during the current pass.
//
//   3. Bounded recheck loop (Requirements 14.1–14.3, 14.8): run the full
//      checklist, apply fixes, re-detect over the changed inventory, stop on a
//      zero-finding cycle, and cap at 5 cycles recording any unresolved
//      findings.
//
//   4. Final verification gates (Requirements 14.5–14.7): run the project's
//      lint / type-check / test commands through the CommandRunner, record each
//      exit status, and re-enter the recheck loop on any non-success or
//      regression (bounded so the pass always terminates).
//
//   5. Placeholder accounting (Requirement 14.4): assert that no `[FILL IN]`
//      placeholder remains unresolved and undocumented — every occurrence in
//      the final inventory is enumerated for the report.
//
// The ten domain detectors/fixers, the VersionDetector, the CommandRunner, and
// an EditApplier are all wired here. Report assembly (ReportBuilder) and the
// disk-mutating EditApplier are added in tasks 19.1 and 20.1.

import {
  CommandRunner,
  type CommandResult,
} from './CommandRunner';
import { DiskEditApplier } from './DiskEditApplier';
import { InMemoryEditApplier, type EditApplier } from './EditApplier';
import { FileInventory } from './FileInventory';
import { detectProjectType, type ProjectType } from './ProjectTypeDetector';
import {
  buildFinalizationSummary,
  type FinalizationReport,
} from './ReportBuilder';
import { detectVersionConsistency } from './VersionDetector';
import { FILL_IN_PLACEHOLDER } from './types';
import type {
  Detector,
  Domain,
  Edit,
  FileChange,
  FileRecord,
  Finding,
  Fixer,
  PlaceholderRef,
  ReadFailure,
} from './types';

import { configDetector, configFixer } from './detectors/config';
import { cssDetector, cssFixer } from './detectors/css';
import { deadCodeDetector, deadCodeFixer } from './detectors/deadCode';
import {
  errorBoundaryDetector,
  errorBoundaryFixer,
} from './detectors/errorBoundary';
import { hardcodedDetector, hardcodedFixer } from './detectors/hardcoded';
import {
  htmlCompletenessDetector,
  htmlCompletenessFixer,
} from './detectors/html';
import { hygieneDetector, hygieneFixer } from './detectors/hygiene';
import { namingDetector, namingFixer } from './detectors/naming';
import { tsJsSafetyDetector, tsJsSafetyFixer } from './detectors/tsJsSafety';

/**
 * Hard cap on recheck cycles (Requirements 14.2, 14.8). The loop stops earlier
 * when a cycle yields zero new findings (Requirement 14.3); reaching this cap
 * with findings remaining is a reportable condition, not a crash.
 */
export const MAX_RECHECK_CYCLES = 5;

/**
 * Hard cap on how many times a failing verification gate may re-enter the
 * recheck loop (Requirement 14.6). Bounding this guarantees the pass always
 * terminates even when a command keeps failing for a reason the fixers cannot
 * resolve; the final command statuses are recorded either way.
 */
export const MAX_VERIFY_REENTRIES = 5;

/** The project's verification commands, run in order at the final gate (14.5). */
export const VERIFICATION_COMMANDS: readonly string[] = [
  'npm run lint',
  'npm run type-check',
  'npm run test',
];

/**
 * The result of the orchestrator's entry path: the fully-read inventory and the
 * project type detected from it.
 */
export interface PreparedPass {
  /** Every enumerated file, each read or recorded as a read failure. */
  readonly records: readonly FileRecord[];
  /** The stack facts detected from the inventory. */
  readonly projectType: ProjectType;
  /**
   * Whether the inventory is fully read and the checklist gate is open. When
   * `false`, the orchestrator must not evaluate any checklist domain.
   */
  readonly inventoryComplete: boolean;
}

/** One fix applied during a recheck cycle, recorded as a self-correction (15.4). */
export interface AppliedFix {
  readonly domain: Domain;
  readonly path: string;
  readonly kind: string;
  readonly detail: string;
}

/** A finding intentionally left unchanged by a fixer, with the recorded reason. */
export interface Preservation {
  readonly finding: Finding;
  readonly reason: string;
}

/** The outcome of applying every fixable finding in a single cycle. */
export interface FixApplication {
  /** The inventory after the cycle's edits were applied in memory. */
  readonly records: readonly FileRecord[];
  /** Paths of pre-existing files modified this cycle. */
  readonly changed: readonly string[];
  /** Paths of files created this cycle. */
  readonly created: readonly string[];
  /** Fixes that produced edits (self-corrections). */
  readonly appliedFixes: readonly AppliedFix[];
  /** Findings a fixer chose to preserve, with reasons. */
  readonly preservations: readonly Preservation[];
  /** Findings no fixer could resolve this cycle. */
  readonly unfixed: readonly Finding[];
}

/** The outcome of the bounded recheck loop (Requirements 14.1–14.3, 14.8). */
export interface RecheckOutcome {
  /** The inventory after the loop converged or hit the cap. */
  readonly records: readonly FileRecord[];
  /** Number of fix-applying cycles performed (0..MAX_RECHECK_CYCLES). */
  readonly cyclesRun: number;
  /** True when a cycle produced zero new findings (Requirement 14.3). */
  readonly stable: boolean;
  /** Findings still present when the loop ended (empty when stable) (14.8). */
  readonly unresolvedFindings: readonly Finding[];
  /** All paths changed across cycles. */
  readonly changedFiles: readonly string[];
  /** All paths created across cycles. */
  readonly createdFiles: readonly string[];
  /** Every fix applied across cycles (Requirement 15.4 self-corrections). */
  readonly selfCorrections: readonly AppliedFix[];
  /** Every preservation recorded across cycles. */
  readonly preservations: readonly Preservation[];
}

/** The outcome of the final verification gates (Requirements 14.5–14.7). */
export interface VerificationOutcome {
  /** One result per verification command, in run order (Requirement 14.5). */
  readonly commandStatuses: readonly CommandResult[];
  /** True only when every command exited with status 0. */
  readonly allPassed: boolean;
}

/** The full outcome of the recheck-and-verify phase wired by task 18.1. */
export interface FinalizationLoopOutcome {
  /** The inventory after all cycles and verification re-entries. */
  readonly records: readonly FileRecord[];
  /** The recheck outcome from the final pass through the loop. */
  readonly recheck: RecheckOutcome;
  /** The verification outcome from the final gate run. */
  readonly verification: VerificationOutcome;
  /** Number of times a failing gate re-entered the recheck loop. */
  readonly verifyReentries: number;
  /** All distinct paths changed across the whole phase. */
  readonly changedFiles: readonly string[];
  /** All distinct paths created across the whole phase. */
  readonly createdFiles: readonly string[];
  /** Every self-correction across the whole phase. */
  readonly selfCorrections: readonly AppliedFix[];
  /** Every preservation across the whole phase. */
  readonly preservations: readonly Preservation[];
  /** Every `[FILL IN]` placeholder in the final inventory, documented (15.4). */
  readonly placeholders: readonly PlaceholderRef[];
  /**
   * Count of `[FILL IN]` markers that are neither resolved nor documented. The
   * orchestrator drives this to zero (Requirement 14.4).
   */
  readonly undocumentedPlaceholders: number;
  /** True when the loop converged and every verification command passed. */
  readonly stable: boolean;
}

/** Maps each inspection domain to its detector and fixer. */
interface DomainPair {
  readonly detector: Detector;
  readonly fixer: Fixer;
}

/**
 * The ten domain detector/fixer pairs, wired in inspection order. Version
 * consistency is handled separately by {@link detectVersionConsistency} because
 * it compares across Manifest_Files rather than inspecting a single file.
 */
function defaultDomainPairs(): readonly DomainPair[] {
  return [
    { detector: deadCodeDetector, fixer: deadCodeFixer },
    { detector: hardcodedDetector, fixer: hardcodedFixer },
    { detector: errorBoundaryDetector, fixer: errorBoundaryFixer },
    { detector: namingDetector, fixer: namingFixer },
    { detector: hygieneDetector, fixer: hygieneFixer },
    { detector: htmlCompletenessDetector, fixer: htmlCompletenessFixer },
    { detector: tsJsSafetyDetector, fixer: tsJsSafetyFixer },
    { detector: cssDetector, fixer: cssFixer },
    { detector: configDetector, fixer: configFixer },
  ];
}

/** Options for constructing a {@link FinalizationOrchestrator}. */
export interface OrchestratorOptions {
  /** I/O boundary for enumerate/read. Defaults to a real {@link FileInventory}. */
  readonly inventory?: FileInventory;
  /** Process boundary for verification commands. Defaults to a real {@link CommandRunner}. */
  readonly commandRunner?: CommandRunner;
  /** Applies fixer edits. Defaults to the in-memory applier (task 20.1 adds the disk one). */
  readonly editApplier?: EditApplier;
  /** Domain detector/fixer pairs. Defaults to the ten production domains. */
  readonly domainPairs?: readonly DomainPair[];
  /** Verification command lines. Defaults to {@link VERIFICATION_COMMANDS}. */
  readonly verificationCommands?: readonly string[];
}

/**
 * Sequences the finalization pass. Construction is side-effect free; all I/O is
 * deferred to the injected boundaries. Every boundary is injectable so the
 * orchestration logic can be property-tested with synthetic inventories,
 * deterministic command executors, and the in-memory edit applier without
 * touching the real filesystem.
 */
export class FinalizationOrchestrator {
  readonly #inventory: FileInventory;
  readonly #commandRunner: CommandRunner;
  readonly #editApplier: EditApplier;
  readonly #editApplierInjected: boolean;
  readonly #domainPairs: readonly DomainPair[];
  readonly #verificationCommands: readonly string[];

  constructor(options: OrchestratorOptions = {}) {
    this.#inventory = options.inventory ?? new FileInventory();
    this.#commandRunner = options.commandRunner ?? new CommandRunner();
    this.#editApplier = options.editApplier ?? new InMemoryEditApplier();
    // When no applier is injected, the end-to-end run() persists edits to disk
    // through a DiskEditApplier scoped to the pass's rootDir; tests inject an
    // in-memory applier and keep the pure, no-I/O behavior.
    this.#editApplierInjected = options.editApplier !== undefined;
    this.#domainPairs = options.domainPairs ?? defaultDomainPairs();
    this.#verificationCommands =
      options.verificationCommands ?? VERIFICATION_COMMANDS;
  }

  /** The detectors of every wired domain, in inspection order. */
  get detectors(): readonly Detector[] {
    return this.#domainPairs.map((pair) => pair.detector);
  }

  // -------------------------------------------------------------------------
  // Entry path and gating (Requirements 1.3, 1.5, 1.6)
  // -------------------------------------------------------------------------

  /**
   * Entry path of the pass: enumerate the working tree, read every file fully,
   * and detect the project type.
   *
   * @param rootDir Absolute or relative path to the repository root.
   */
  prepare(rootDir: string): PreparedPass {
    const records = this.loadInventory(rootDir);
    return {
      records,
      projectType: detectProjectType(records),
      inventoryComplete: this.isInventoryComplete(records),
    };
  }

  /**
   * Enumerate and fully read the working tree via the FileInventory boundary.
   * Read failures arrive as records with `content: null` and a populated
   * `readError`, so a single unreadable file never aborts the pass (1.4).
   */
  loadInventory(rootDir: string): readonly FileRecord[] {
    const paths = this.#inventory.enumerate(rootDir);
    return this.#inventory.readAll(paths, rootDir);
  }

  /**
   * The inventory gate (Requirement 1.3). The inventory is complete only when
   * every record has been resolved: read (`content !== null`) or recorded as a
   * read failure (`readError !== null`).
   */
  isInventoryComplete(records: readonly FileRecord[]): boolean {
    return records.every(
      (record) => record.content !== null || record.readError !== null,
    );
  }

  /** Detect the project stack from the inventory. */
  analyzeProjectType(records: readonly FileRecord[]): ProjectType {
    return detectProjectType(records);
  }

  /**
   * Run the supplied detectors over the inventory under the gate, then keep only
   * traceable findings. Adds the cross-file version findings so manifest version
   * inconsistencies enter the same finding stream (Requirement 8).
   *
   * Gating (Requirement 1.3): while the inventory is incomplete, no detector
   * runs and zero findings are produced. Traceability (1.5, 1.6): findings whose
   * path is not a record path are discarded.
   */
  evaluateChecklist(
    records: readonly FileRecord[],
    detectors: readonly Detector[] = this.detectors,
  ): readonly Finding[] {
    if (!this.isInventoryComplete(records)) {
      return [];
    }
    const domainFindings = detectors.flatMap((detector) =>
      detector.detect(records),
    );
    const versionFindings = this.detectVersionFindings(records);
    return this.filterTraceableFindings(records, [
      ...domainFindings,
      ...versionFindings,
    ]);
  }

  /**
   * The finding-trace filter (Requirements 1.5, 1.6). Discards any finding whose
   * `path` is not the path of a FileRecord in the input set.
   */
  filterTraceableFindings(
    records: readonly FileRecord[],
    findings: readonly Finding[],
  ): readonly Finding[] {
    const knownPaths = new Set(records.map((record) => record.path));
    return findings.filter((finding) => knownPaths.has(finding.path));
  }

  /**
   * Convert the cross-file version comparison into findings (Requirement 8).
   * Version inconsistencies are reported but not auto-fixed here (there is no
   * single-file version fixer), so they surface as remaining issues. The
   * findings are anchored to `package.json` so they trace to a read file.
   */
  detectVersionFindings(records: readonly FileRecord[]): readonly Finding[] {
    const packageRecord = records.find(
      (record) => basename(record.path) === 'package.json',
    );
    if (packageRecord === undefined) {
      return [];
    }
    const comparison = detectVersionConsistency(records);
    const findings: Finding[] = [];

    if (comparison.versions.length > 1 && !comparison.allIdentical) {
      findings.push({
        domain: 'version',
        path: packageRecord.path,
        location: { line: 1 },
        kind: 'version-mismatch',
        detail:
          'Manifest versions are not byte-for-byte identical: ' +
          comparison.versions
            .map((entry) => `${entry.file}=${entry.rawVersion}`)
            .join(', '),
        autoFixable: false,
      });
    }

    const hasChangelog = comparison.versions.some(
      (entry) => entry.file === 'CHANGELOG.md',
    );
    if (hasChangelog && !comparison.changelogMatchesPackage) {
      findings.push({
        domain: 'version',
        path: packageRecord.path,
        location: { line: 1 },
        kind: 'changelog-version-mismatch',
        detail:
          'The most recent CHANGELOG.md entry does not match the declared package version.',
        autoFixable: false,
      });
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // Fix application
  // -------------------------------------------------------------------------

  /**
   * Apply every fixable finding for one cycle. For each finding the fixer for
   * its domain is consulted: edits are collected and applied in memory through
   * the EditApplier; a preserved finding is recorded with its reason; a finding
   * with no fixer, not auto-fixable, or yielding no edits is left unfixed.
   *
   * Fixers are pure — they only return edits. All mutation happens through the
   * injected {@link EditApplier}, so this method performs no disk I/O.
   */
  applyFixes(
    records: readonly FileRecord[],
    findings: readonly Finding[],
    editApplier: EditApplier = this.#editApplier,
  ): FixApplication {
    const recordByPath = new Map(
      records.map((record) => [record.path, record] as const),
    );
    const fixerByDomain = new Map<Domain, Fixer>(
      this.#domainPairs.map((pair) => [pair.fixer.domain, pair.fixer]),
    );

    const edits: Edit[] = [];
    const appliedFixes: AppliedFix[] = [];
    const preservations: Preservation[] = [];
    const unfixed: Finding[] = [];

    for (const finding of findings) {
      const fixer = fixerByDomain.get(finding.domain);
      const record = recordByPath.get(finding.path);

      if (fixer === undefined || record === undefined || !finding.autoFixable) {
        unfixed.push(finding);
        continue;
      }

      const outcome = fixer.fix(finding, record);

      if (outcome.preserved) {
        preservations.push({
          finding,
          reason:
            outcome.preservationReason ??
            'fixer preserved the finding without a recorded reason',
        });
        continue;
      }

      if (outcome.edits.length === 0) {
        unfixed.push(finding);
        continue;
      }

      edits.push(...outcome.edits);
      appliedFixes.push({
        domain: finding.domain,
        path: finding.path,
        kind: finding.kind,
        detail: finding.detail,
      });
    }

    const applied = editApplier.apply(records, edits);

    return {
      records: applied.records,
      changed: applied.changed,
      created: applied.created,
      appliedFixes,
      preservations,
      unfixed,
    };
  }

  // -------------------------------------------------------------------------
  // Bounded recheck loop (Requirements 14.1, 14.2, 14.3, 14.8)
  // -------------------------------------------------------------------------

  /**
   * Run the full checklist, apply fixes, and re-detect over the changed
   * inventory until a cycle yields zero new findings (stable, 14.3) or the cap
   * of {@link MAX_RECHECK_CYCLES} is reached (14.2, 14.8).
   *
   * When the cap is reached with findings still present, those findings are
   * returned as `unresolvedFindings` so the report can list them (14.8).
   */
  runRecheckLoop(
    records: readonly FileRecord[],
    editApplier: EditApplier = this.#editApplier,
  ): RecheckOutcome {
    let current = records;
    let cyclesRun = 0;
    let stable = false;

    const changedFiles = new Set<string>();
    const createdFiles = new Set<string>();
    const selfCorrections: AppliedFix[] = [];
    const preservations: Preservation[] = [];

    while (cyclesRun < MAX_RECHECK_CYCLES) {
      const findings = this.evaluateChecklist(current);
      const fixable = findings.filter((finding) => finding.autoFixable);

      // Stability is a cycle that produces no *actionable* new findings: either
      // no findings at all, or only findings nothing can fix (recorded as
      // unresolved below). Either way another cycle cannot make progress.
      if (findings.length === 0 || fixable.length === 0) {
        stable = findings.length === 0;
        if (!stable) {
          // Non-auto-fixable findings remain; record them as unresolved.
          return this.#finishRecheck(
            current,
            cyclesRun,
            false,
            findings,
            changedFiles,
            createdFiles,
            selfCorrections,
            preservations,
          );
        }
        break;
      }

      cyclesRun += 1;
      const application = this.applyFixes(current, fixable, editApplier);
      current = application.records;
      application.changed.forEach((path) => changedFiles.add(path));
      application.created.forEach((path) => createdFiles.add(path));
      selfCorrections.push(...application.appliedFixes);
      preservations.push(...application.preservations);
    }

    if (!stable) {
      // Cap reached: re-detect once to capture the findings that remain (14.8).
      const remaining = this.evaluateChecklist(current);
      return this.#finishRecheck(
        current,
        cyclesRun,
        false,
        remaining,
        changedFiles,
        createdFiles,
        selfCorrections,
        preservations,
      );
    }

    return this.#finishRecheck(
      current,
      cyclesRun,
      true,
      [],
      changedFiles,
      createdFiles,
      selfCorrections,
      preservations,
    );
  }

  #finishRecheck(
    records: readonly FileRecord[],
    cyclesRun: number,
    stable: boolean,
    unresolvedFindings: readonly Finding[],
    changedFiles: ReadonlySet<string>,
    createdFiles: ReadonlySet<string>,
    selfCorrections: readonly AppliedFix[],
    preservations: readonly Preservation[],
  ): RecheckOutcome {
    return {
      records,
      cyclesRun,
      stable,
      unresolvedFindings,
      changedFiles: [...changedFiles],
      createdFiles: [...createdFiles],
      selfCorrections,
      preservations,
    };
  }

  // -------------------------------------------------------------------------
  // Final verification gates (Requirements 14.5, 14.6, 14.7)
  // -------------------------------------------------------------------------

  /**
   * Run the project's verification commands (lint, type-check, test) exactly
   * once each in order, recording every exit status (Requirement 14.5). The
   * gate passes only when every command exits with status 0.
   */
  runVerificationGates(): VerificationOutcome {
    const commandStatuses = this.#verificationCommands.map((command) =>
      this.#commandRunner.run(command),
    );
    const allPassed = commandStatuses.every(
      (result) => result.exitStatus === 0,
    );
    return { commandStatuses, allPassed };
  }

  // -------------------------------------------------------------------------
  // Combined recheck-and-verify phase (Requirements 14.1–14.8)
  // -------------------------------------------------------------------------

  /**
   * Drive the recheck loop, then the verification gates, re-entering the loop
   * whenever a gate fails (Requirement 14.6) or a fix introduced a regression
   * (14.7). Re-entry is bounded by {@link MAX_VERIFY_REENTRIES} so the pass
   * always terminates; the final command statuses are recorded regardless.
   *
   * On completion, every `[FILL IN]` placeholder in the final inventory is
   * enumerated and the undocumented count is asserted to be zero (14.4).
   */
  runFinalizationLoop(
    records: readonly FileRecord[],
    editApplier: EditApplier = this.#editApplier,
  ): FinalizationLoopOutcome {
    let current = records;
    const changedFiles = new Set<string>();
    const createdFiles = new Set<string>();
    const selfCorrections: AppliedFix[] = [];
    const preservations: Preservation[] = [];

    let recheck = this.runRecheckLoop(current, editApplier);
    let verification = this.runVerificationGates();
    let verifyReentries = 0;

    this.#accumulate(
      recheck,
      changedFiles,
      createdFiles,
      selfCorrections,
      preservations,
    );
    current = recheck.records;

    // Re-enter the loop on a failing gate (14.6/14.7), bounded for termination.
    while (!verification.allPassed && verifyReentries < MAX_VERIFY_REENTRIES) {
      verifyReentries += 1;
      recheck = this.runRecheckLoop(current, editApplier);
      this.#accumulate(
        recheck,
        changedFiles,
        createdFiles,
        selfCorrections,
        preservations,
      );
      current = recheck.records;

      // No new fixes possible means re-running the gate cannot change its
      // result; stop re-entering to avoid spinning (still bounded by the cap).
      const madeProgress = recheck.selfCorrections.length > 0;
      verification = this.runVerificationGates();
      if (!madeProgress) {
        break;
      }
    }

    const placeholders = this.collectPlaceholders(current);
    const undocumentedPlaceholders = this.countUndocumentedPlaceholders(
      current,
      placeholders,
    );

    return {
      records: current,
      recheck,
      verification,
      verifyReentries,
      changedFiles: [...changedFiles],
      createdFiles: [...createdFiles],
      selfCorrections,
      preservations,
      placeholders,
      undocumentedPlaceholders,
      stable: recheck.stable && verification.allPassed,
    };
  }

  #accumulate(
    recheck: RecheckOutcome,
    changedFiles: Set<string>,
    createdFiles: Set<string>,
    selfCorrections: AppliedFix[],
    preservations: Preservation[],
  ): void {
    recheck.changedFiles.forEach((path) => changedFiles.add(path));
    recheck.createdFiles.forEach((path) => createdFiles.add(path));
    selfCorrections.push(...recheck.selfCorrections);
    preservations.push(...recheck.preservations);
  }

  // -------------------------------------------------------------------------
  // Placeholder accounting (Requirement 14.4)
  // -------------------------------------------------------------------------

  /**
   * Enumerate every `[FILL IN]` placeholder in the inventory with its file path
   * and location. Each occurrence becomes one {@link PlaceholderRef} so the
   * report can document them all (Requirement 15.4) and the orchestrator can
   * guarantee none is left undocumented (Requirement 14.4).
   */
  collectPlaceholders(records: readonly FileRecord[]): readonly PlaceholderRef[] {
    const refs: PlaceholderRef[] = [];
    for (const record of records) {
      if (record.content === null) {
        continue;
      }
      const lines = record.content.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        let column = line.indexOf(FILL_IN_PLACEHOLDER);
        while (column !== -1) {
          refs.push({
            path: record.path,
            location: { line: i + 1, column: column + 1 },
            key: line.trim(),
          });
          column = line.indexOf(FILL_IN_PLACEHOLDER, column + 1);
        }
      }
    }
    return refs;
  }

  /**
   * Count `[FILL IN]` markers that are neither resolved nor documented
   * (Requirement 14.4). `documented` is the set of placeholders the report will
   * enumerate; since {@link collectPlaceholders} produces one ref per
   * occurrence, documenting all of them drives this count to zero. A non-zero
   * result signals a bookkeeping gap that must be fixed before finalizing.
   */
  countUndocumentedPlaceholders(
    records: readonly FileRecord[],
    documented: readonly PlaceholderRef[],
  ): number {
    const totalOccurrences = this.collectPlaceholders(records).length;
    const undocumented = totalOccurrences - documented.length;
    return undocumented > 0 ? undocumented : 0;
  }

  // -------------------------------------------------------------------------
  // Report assembly (Requirement 15) — the final step of the pass
  // -------------------------------------------------------------------------

  /**
   * Run the finalization pass end-to-end and return both the structured report
   * and its rendered `## Finalization Summary` (Requirement 15.1).
   *
   * The pass gates on a fully-read inventory (Requirement 1.3): if enumeration
   * left any file neither read nor recorded as a read failure, the pass cannot
   * evaluate the checklist, so it terminates early and the report carries
   * `completed: false` (Requirement 15.7).
   *
   * @param rootDir Absolute or relative path to the repository root.
   */
  run(rootDir: string): { report: FinalizationReport; summary: string } {
    const prepared = this.prepare(rootDir);

    if (!prepared.inventoryComplete) {
      const report = this.#buildIncompleteReport(prepared);
      return { report, summary: buildFinalizationSummary(report) };
    }

    // The end-to-end pass persists converged edits to disk through a
    // DiskEditApplier scoped to this rootDir — the only disk-mutating component.
    // When a caller injected an applier (tests), that applier is honored instead
    // so the recheck loop keeps its pure, in-memory behavior.
    const editApplier = this.#resolveRunApplier(rootDir);

    const loop = this.runFinalizationLoop(prepared.records, editApplier);
    const report = this.buildReport(prepared, loop);
    return { report, summary: buildFinalizationSummary(report) };
  }

  /**
   * Select the applier the end-to-end {@link run} uses. An explicitly injected
   * applier wins (tests); otherwise a {@link DiskEditApplier} scoped to
   * `rootDir` persists edits to disk and untracks via the same CommandRunner.
   */
  #resolveRunApplier(rootDir: string): EditApplier {
    if (this.#editApplierInjected) {
      return this.#editApplier;
    }
    return new DiskEditApplier({
      rootDir,
      commandRunner: this.#commandRunner,
    });
  }

  /**
   * Assemble the structured {@link FinalizationReport} from the prepared pass
   * and the recheck-and-verify outcome. This is the single place the
   * orchestrator's bookkeeping is mapped onto the report's sections
   * (Requirements 15.2–15.5); rendering to markdown is delegated to the
   * {@link buildFinalizationSummary} ReportBuilder.
   *
   * `completed` is `true` only when the loop converged and every verification
   * command passed (Requirement 15.7).
   */
  buildReport(
    prepared: PreparedPass,
    loop: FinalizationLoopOutcome,
  ): FinalizationReport {
    return {
      detectedProjectType: prepared.projectType,
      changedFiles: this.#buildFileChanges(loop.changedFiles, loop.createdFiles),
      universalIssuesFixed: this.#issuesForDomains(
        loop.selfCorrections,
        UNIVERSAL_DOMAINS,
      ),
      stackIssuesFixed: this.#issuesForDomains(
        loop.selfCorrections,
        STACK_DOMAINS,
      ),
      configFilesCorrected: this.#configFilesCorrected(loop.selfCorrections),
      placeholders: loop.placeholders,
      verifiedClean: this.#verifiedClean(prepared.projectType, loop),
      selfCorrections: loop.selfCorrections.map(formatAppliedFix),
      gitignoreAdditions: this.#gitignoreAdditions(loop.selfCorrections),
      restructured: this.#restructured(loop.selfCorrections),
      readFailures: collectReadFailures(prepared.records),
      commandStatuses: loop.verification.commandStatuses,
      remainingIssues: this.#remainingIssues(loop),
      completed: loop.stable,
    };
  }

  /**
   * Build the early-termination report when the inventory gate never opened
   * (Requirement 1.3 / 15.7). Only the facts known before checklist evaluation
   * are populated; everything else renders an explicit "none" (15.6) and
   * `completed` is `false`.
   */
  #buildIncompleteReport(prepared: PreparedPass): FinalizationReport {
    return {
      detectedProjectType: prepared.projectType,
      changedFiles: [],
      universalIssuesFixed: [],
      stackIssuesFixed: [],
      configFilesCorrected: [],
      placeholders: [],
      verifiedClean: [],
      selfCorrections: [],
      gitignoreAdditions: [],
      restructured: [],
      readFailures: collectReadFailures(prepared.records),
      commandStatuses: [],
      remainingIssues: [
        'Inventory incomplete: one or more files were neither read nor recorded as a read failure, so the checklist could not be evaluated.',
      ],
      completed: false,
    };
  }

  /**
   * Build the changed/created file list, marking each path exactly once
   * (Requirement 15.2). A path that was both created and later modified in the
   * same pass is reported as `created` (its existence is the salient fact), so
   * the two lists stay disjoint.
   */
  #buildFileChanges(
    changed: readonly string[],
    created: readonly string[],
  ): readonly FileChange[] {
    const createdSet = new Set(created);
    const entries: FileChange[] = [];
    for (const path of createdSet) {
      entries.push({ path, kind: 'created' });
    }
    for (const path of new Set(changed)) {
      if (!createdSet.has(path)) {
        entries.push({ path, kind: 'changed' });
      }
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Describe the self-corrections whose domain is in the given set. */
  #issuesForDomains(
    selfCorrections: readonly AppliedFix[],
    domains: ReadonlySet<Domain>,
  ): readonly string[] {
    return selfCorrections
      .filter((fix) => domains.has(fix.domain))
      .map(formatAppliedFix);
  }

  /** Config files corrected or created (Requirement 15.3). */
  #configFilesCorrected(
    selfCorrections: readonly AppliedFix[],
  ): readonly string[] {
    const paths = new Set<string>();
    for (const fix of selfCorrections) {
      if (fix.domain === 'config') {
        paths.add(fix.path);
      }
    }
    return [...paths].sort((a, b) => a.localeCompare(b));
  }

  /** `.gitignore` additions for transient directories (Requirement 15.4). */
  #gitignoreAdditions(
    selfCorrections: readonly AppliedFix[],
  ): readonly string[] {
    return selfCorrections
      .filter(
        (fix) => fix.domain === 'hygiene' && fix.kind.startsWith('gitignore'),
      )
      .map(formatAppliedFix);
  }

  /** Files or folders restructured or recategorized (Requirement 15.5). */
  #restructured(selfCorrections: readonly AppliedFix[]): readonly string[] {
    return selfCorrections
      .filter(
        (fix) =>
          fix.domain === 'hygiene' &&
          (fix.kind.includes('relocate') ||
            fix.kind.includes('move') ||
            fix.kind.includes('loose-file')),
      )
      .map(formatAppliedFix);
  }

  /**
   * Items verified clean during the pass (Requirement 15.4). A verification
   * command that exited 0 is a clean signal; when the pass is fully stable the
   * checklist itself is reported clean.
   */
  #verifiedClean(
    _projectType: ProjectType,
    loop: FinalizationLoopOutcome,
  ): readonly string[] {
    const clean: string[] = [];
    for (const result of loop.verification.commandStatuses) {
      if (result.exitStatus === 0) {
        clean.push(`${result.command} (exit 0)`);
      }
    }
    if (loop.recheck.stable) {
      clean.push('Checklist recheck reached a zero-finding cycle.');
    }
    return clean;
  }

  /**
   * Issues remaining after the final recheck (Requirement 15.5). Combines
   * unresolved checklist findings (14.8), a failing verification gate (14.6),
   * and any undocumented placeholder accounting gap (14.4).
   */
  #remainingIssues(loop: FinalizationLoopOutcome): readonly string[] {
    const issues: string[] = [];
    for (const finding of loop.recheck.unresolvedFindings) {
      issues.push(
        `[${finding.domain}] ${finding.path}: ${finding.detail}`,
      );
    }
    if (!loop.verification.allPassed) {
      const failed = loop.verification.commandStatuses
        .filter((result) => result.exitStatus !== 0)
        .map((result) => `${result.command} (exit ${result.exitStatus})`)
        .join(', ');
      issues.push(`Verification commands did not all pass: ${failed}.`);
    }
    if (loop.undocumentedPlaceholders > 0) {
      issues.push(
        `${loop.undocumentedPlaceholders} unresolved [FILL IN] placeholder(s) remain undocumented.`,
      );
    }
    return issues;
  }
}

/** Extract the final path segment from a POSIX repo-relative path. */
function basename(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

/**
 * Universal (stack-agnostic) inspection domains. Their fixes are reported under
 * "universal issues fixed" (Requirement 15.3).
 */
const UNIVERSAL_DOMAINS: ReadonlySet<Domain> = new Set<Domain>([
  'dead-code',
  'hardcoded',
  'error-boundary',
  'naming',
  'hygiene',
  'version',
]);

/**
 * Stack-specific inspection domains (the Vite + TypeScript surface). Their fixes
 * are reported under "stack-specific issues fixed" (Requirement 15.3).
 */
const STACK_DOMAINS: ReadonlySet<Domain> = new Set<Domain>([
  'html',
  'ts-js-safety',
  'css',
  'config',
]);

/** Render an applied fix as a single human-readable report line. */
function formatAppliedFix(fix: AppliedFix): string {
  return `${fix.path} [${fix.kind}] — ${fix.detail}`;
}

/** Map read-failed records onto the report's read-failure list (1.4 / 15). */
function collectReadFailures(
  records: readonly FileRecord[],
): readonly ReadFailure[] {
  return records
    .filter((record) => record.readError !== null)
    .map((record) => ({
      path: record.path,
      reason: record.readError ?? 'unknown read failure',
    }));
}
