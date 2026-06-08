// Feature: pre-ship-finalization
//
// ReportBuilder — the final step of the finalization pass.
//
// The orchestrator produces a structured FinalizationReport (counts, paths,
// placeholders, command statuses). The ReportBuilder is the single pure
// function that renders that structured data into the human-readable
// `## Finalization Summary` markdown the spec mandates.
//
// Design responsibilities (Requirement 15):
//   - Emit exactly one `## Finalization Summary` heading (15.1).
//   - List every changed and created Project_File once, marked changed|created
//     (15.2).
//   - Include the detected project type, universal issues fixed, stack-specific
//     issues fixed, and configuration files corrected (15.3).
//   - List placeholders with path + location, verified-clean items,
//     self-corrections, and `.gitignore` additions (15.4).
//   - List restructured/recategorized items and issues remaining after the
//     final recheck (15.5).
//   - Render an explicit "none" for every empty list-bearing section (15.6).
//   - Indicate "pass did not complete" when `completed` is false (15.7).
//
// The builder performs no I/O and reads no files: it is a pure transform from
// FinalizationReport to string, which keeps it deterministic and testable.

import type { CommandResult } from './CommandRunner';
import type { ProjectType } from './ProjectTypeDetector';
import type {
  CodeLocation,
  FileChange,
  PlaceholderRef,
  ReadFailure,
} from './types';

/**
 * The structured result of a finalization pass. Every list-bearing field is a
 * readonly array so the report can render an explicit "none" for empty ones
 * (Requirement 15.6); `completed` is `false` when the pass terminated early
 * (Requirement 15.7).
 */
export interface FinalizationReport {
  /** Stack facts detected from the inventory (Requirement 15.3). */
  readonly detectedProjectType: ProjectType;
  /** Every changed/created file, each marked exactly once (Requirement 15.2). */
  readonly changedFiles: readonly FileChange[];
  /** Universal (stack-agnostic) issues fixed (Requirement 15.3). */
  readonly universalIssuesFixed: readonly string[];
  /** Stack-specific issues fixed (Requirement 15.3). */
  readonly stackIssuesFixed: readonly string[];
  /** Configuration files corrected or created (Requirement 15.3). */
  readonly configFilesCorrected: readonly string[];
  /** `[FILL IN]` placeholders requiring human completion (Requirement 15.4). */
  readonly placeholders: readonly PlaceholderRef[];
  /** Items verified clean during the pass (Requirement 15.4). */
  readonly verifiedClean: readonly string[];
  /** Self-corrections made during recheck (Requirement 15.4). */
  readonly selfCorrections: readonly string[];
  /** `.gitignore` additions for transient directories (Requirement 15.4). */
  readonly gitignoreAdditions: readonly string[];
  /** Files or folders restructured or recategorized (Requirement 15.5). */
  readonly restructured: readonly string[];
  /** Files that could not be read during the pass (Requirement 1.4). */
  readonly readFailures: readonly ReadFailure[];
  /** Verification command exit statuses (Requirement 14.5). */
  readonly commandStatuses: readonly CommandResult[];
  /** Issues remaining after the final recheck (Requirement 15.5). */
  readonly remainingIssues: readonly string[];
  /** `false` when the pass terminated before completion (Requirement 15.7). */
  readonly completed: boolean;
}

/** The heading every Finalization_Report is published under (Requirement 15.1). */
export const SUMMARY_HEADING = '## Finalization Summary';

/** The explicit marker rendered for an empty list-bearing section (15.6). */
export const NONE_MARKER = 'none';

/** The notice rendered when the pass did not complete (Requirement 15.7). */
export const INCOMPLETE_NOTICE =
  'Pass did not complete: this report covers only the changes applied before termination.';

/**
 * Render the single `## Finalization Summary` for a finalization pass.
 *
 * This is the only place the report markdown is assembled. It emits exactly one
 * summary heading (Requirement 15.1) and one subsection per reportable concern,
 * each rendering an explicit `none` when empty (Requirement 15.6). When the pass
 * terminated early, a "pass did not complete" notice is rendered immediately
 * after the heading (Requirement 15.7).
 */
export function buildFinalizationSummary(report: FinalizationReport): string {
  const sections: string[] = [SUMMARY_HEADING];

  // Early-termination notice sits directly under the heading so a reader sees
  // immediately that the report is partial (Requirement 15.7).
  if (!report.completed) {
    sections.push(INCOMPLETE_NOTICE);
  }

  sections.push(renderProjectType(report.detectedProjectType));
  sections.push(
    renderListSection(
      'Changed and created files',
      report.changedFiles.map(formatFileChange),
    ),
  );
  sections.push(
    renderListSection('Universal issues fixed', report.universalIssuesFixed),
  );
  sections.push(
    renderListSection('Stack-specific issues fixed', report.stackIssuesFixed),
  );
  sections.push(
    renderListSection(
      'Configuration files corrected or created',
      report.configFilesCorrected,
    ),
  );
  sections.push(
    renderListSection(
      'Placeholders requiring human completion',
      report.placeholders.map(formatPlaceholder),
    ),
  );
  sections.push(renderListSection('Verified clean', report.verifiedClean));
  sections.push(
    renderListSection('Self-corrections during recheck', report.selfCorrections),
  );
  sections.push(
    renderListSection(
      '.gitignore additions for transient directories',
      report.gitignoreAdditions,
    ),
  );
  sections.push(
    renderListSection('Restructured or recategorized', report.restructured),
  );
  sections.push(
    renderListSection(
      'Read failures',
      report.readFailures.map(formatReadFailure),
    ),
  );
  sections.push(
    renderListSection(
      'Verification command statuses',
      report.commandStatuses.map(formatCommandStatus),
    ),
  );
  sections.push(
    renderListSection('Remaining issues', report.remainingIssues),
  );

  return sections.join('\n\n');
}

/**
 * Render a titled section as a markdown bullet list, falling back to an explicit
 * "none" line when there are no entries (Requirement 15.6). Every section uses
 * this so empty sections are never silently omitted.
 */
function renderListSection(
  title: string,
  entries: readonly string[],
): string {
  const heading = `### ${title}`;
  if (entries.length === 0) {
    return `${heading}\n${NONE_MARKER}`;
  }
  const bullets = entries.map((entry) => `- ${entry}`).join('\n');
  return `${heading}\n${bullets}`;
}

/**
 * Render the detected project type (Requirement 15.3) as a labelled section.
 * Each detection field is always present; multi-value fields render "none" when
 * empty so the reader can tell detection ran but found nothing.
 */
function renderProjectType(projectType: ProjectType): string {
  const languages =
    projectType.primaryLanguages.length === 0
      ? NONE_MARKER
      : projectType.primaryLanguages
          .map(
            (entry) =>
              `${entry.language} (${entry.count} files, ${formatShare(entry.share)})`,
          )
          .join(', ');

  const keyConfigFiles =
    projectType.keyConfigFiles.length === 0
      ? NONE_MARKER
      : projectType.keyConfigFiles.join(', ');

  const lines = [
    `- Primary languages: ${languages}`,
    `- Runtime: ${projectType.runtime}`,
    `- Environment: ${projectType.environment}`,
    `- Package manager: ${projectType.packageManager}`,
    `- Key configuration files: ${keyConfigFiles}`,
    `- Build tooling: ${projectType.buildTooling}`,
    `- Deployment target: ${projectType.deploymentTarget}`,
  ];

  if (projectType.notes.length > 0) {
    lines.push(`- Notes: ${projectType.notes.join('; ')}`);
  }

  return `### Detected project type\n${lines.join('\n')}`;
}

/** Format a single changed/created entry, marking its kind (Requirement 15.2). */
function formatFileChange(change: FileChange): string {
  return `${change.path} (${change.kind})`;
}

/**
 * Format a placeholder with its file path and in-file location
 * (Requirement 15.4). The location renders whichever coordinates are present
 * (line/column for source, tag/selector for HTML/CSS).
 */
function formatPlaceholder(placeholder: PlaceholderRef): string {
  const location = formatLocation(placeholder.location);
  const key = placeholder.key.length > 0 ? ` — ${placeholder.key}` : '';
  return `${placeholder.path} (${location})${key}`;
}

/** Format a read failure with its path and reason (Requirement 1.4). */
function formatReadFailure(failure: ReadFailure): string {
  return `${failure.path}: ${failure.reason}`;
}

/** Format a verification command's exit status (Requirement 14.5). */
function formatCommandStatus(result: CommandResult): string {
  const verdict = result.exitStatus === 0 ? 'passed' : 'failed';
  return `${result.command} — exit ${result.exitStatus} (${verdict})`;
}

/**
 * Render a {@link CodeLocation} as a compact, human-readable coordinate. Source
 * findings use line/column; HTML/CSS findings use tag/selector. Falls back to
 * "location unknown" when no coordinate was supplied.
 */
function formatLocation(location: CodeLocation): string {
  const parts: string[] = [];
  if (location.line !== undefined) {
    parts.push(
      location.column !== undefined
        ? `line ${location.line}, column ${location.column}`
        : `line ${location.line}`,
    );
  }
  if (location.tag !== undefined) {
    parts.push(`tag ${location.tag}`);
  }
  if (location.selector !== undefined) {
    parts.push(`selector ${location.selector}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'location unknown';
}

/** Format a 0..1 language share as a whole-number percentage. */
function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}
