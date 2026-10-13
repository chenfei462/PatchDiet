export type DiffLineKind = "context" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /**
   * Set when git's `\ No newline at end of file` marker directly follows this
   * line: the file version this line belongs to ends without a trailing
   * newline. The marker itself is never stored as a parsed line.
   */
  noNewlineAfter?: boolean;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
  binary?: boolean;
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  isRename?: boolean;
  isDelete?: boolean;
  /** True when the diff creates this file (`--- /dev/null`, `new file mode`). */
  isNew?: boolean;
  /**
   * Raw extended header block captured verbatim during parsing (the
   * `diff --git` line through the `+++` line: modes, rename/copy, similarity,
   * index). Enables byte-faithful re-serialization via `serializeUnifiedDiff`.
   */
  extendedHeaders?: string[];
  /**
   * Raw lines of a binary section captured verbatim: the `GIT binary patch`
   * line plus its literal/delta payload, or a `Binary files … differ` line.
   * `serializeUnifiedDiff` re-emits these byte-for-byte so kept binary changes
   * stay re-appliable.
   */
  binarySection?: string[];
  hunks: DiffHunk[];
}

export interface ParsedDiff {
  files: DiffFile[];
}

export interface DiffSummary {
  fileCount: number;
  hunkCount: number;
  addedLineCount: number;
  removedLineCount: number;
  changedLineCount: number;
}

export type CandidateCategory =
  | "formatting-only"
  | "docs-only"
  | "dependency-related"
  | "generated-like"
  | "unknown";

export type CandidateVerdict = "removed" | "kept" | "needs-human-review";

/** How risky a cleanup decision is when it lands in a report. */
export type RiskLevel = "low" | "medium" | "high";

/**
 * How a shrink run was verified.
 * - `verified`: baseline AND the final cleanup artifact both passed every
 *   required command, and the artifact tree identity was proven.
 * - `unverified`: the run completed but the final artifact could not be
 *   proven (final oracle failure, tree mismatch, budget exhaustion, …) —
 *   zero automatic removals are delivered in this mode.
 * - `preview`: kept for backwards compatibility with externally constructed
 *   reports; never produced by the engine anymore (dry runs now verify too).
 */
export type ShrinkMode = "verified" | "preview" | "unverified";

export interface EvidenceItem {
  filePath: string;
  hunkHeader: string;
  category: CandidateCategory;
  riskLevel?: RiskLevel;
  reason: string;
  confidence: "high-confidence removal" | "kept" | "needs-human-review";
}

export interface CandidateItem {
  filePath: string;
  hunkHeader: string;
  category: CandidateCategory;
  verdict: CandidateVerdict;
  reason: string;
  /** Stable digest of the pinned source edit, independent of the run verdict. */
  contentSha256?: string;
}

export interface TestCommandStatus {
  command: string;
  status: "passed" | "failed" | "not-run";
  durationMs: number;
  attempts: number;
}

/**
 * P0-3: one required command executed during a verification stage, with its
 * raw outcome. `attempts` includes retries; `exitCode` is the raw process
 * exit of the last attempt (0 on pass).
 */
export interface VerificationCommandRecord {
  command: string;
  status: "passed" | "failed" | "not-run";
  durationMs: number;
  attempts: number;
  exitCode?: number;
  timedOut?: boolean;
  /** Raw observed attempts; mixed pass/fail outcomes are inconclusive. */
  attemptRecords?: { exitCode: number; timedOut: boolean; durationMs: number }[];
}

/**
 * P0-3: evidence for one verification stage. `baseline` proves the pinned HEAD
 * itself passes the oracle; `final` proves the exact delivered cleanup artifact
 * (the kept patch applied onto the pinned BASE) passes the same oracle without
 * altering tracked source. Baseline and final evidence are always
 * distinguishable; a report without a `final` stage must never be rendered as
 * "verified".
 */
export interface VerificationStageEvidence {
  stage: "baseline" | "final";
  status: "passed" | "failed" | "not-run";
  commands: VerificationCommandRecord[];
  durationMs: number;
  /** Pinned BASE commit the artifact stage ran against. */
  baseCommitSha?: string;
  /** Pinned HEAD commit the run attests. */
  headCommitSha?: string;
  /** Expected HEAD-minus-removals tree (HEAD worktree, reverse removals). */
  expectedTreeSha?: string;
  /** Tree of the exact delivered cleanup.diff bytes applied onto BASE. */
  artifactTreeSha?: string;
  /** True when artifactTreeSha === expectedTreeSha. */
  treesMatch?: boolean;
  /** Human-readable failure detail when status is failed/not-run. */
  detail?: string;
}

/**
 * v2 controls: one configured OPTIONAL command executed as an advisory in an
 * isolated pinned-HEAD evaluation worktree. Advisory commands never replace
 * the required oracle and never upgrade a verdict; a failed optional command
 * is reported, not hidden. `mutatedTrackedSource` invalidates the artifact.
 */
export interface OptionalCommandRecord {
  command: string;
  status: "passed" | "failed" | "timedOut" | "not-run";
  exitCode?: number;
  timedOut?: boolean;
  durationMs: number;
  /** Always true: optional commands are advisory by construction. */
  advisory: true;
  /** True when `git write-tree` changed after the command ran. */
  mutatedTrackedSource?: boolean;
  /** Deterministic human-readable detail (includes the advisory limitation). */
  detail: string;
}

/**
 * v2 controls: provenance and outcome of the targeted-first screening pass.
 * Screening may REJECT candidates early; it never replaces the full required
 * combined/final oracle, which always runs.
 */
export interface TargetedVerificationEvidence {
  /** True when mapped test commands actually executed. */
  used: boolean;
  outcome: "passed" | "failed" | "skipped-no-mapping";
  /** The exact screening commands that ran (empty when skipped). */
  commands: string[];
  /** Where the mapping came from (e.g. "static-import-index:v1" or "caller-supplied"). */
  mappingProvenance: string;
  /** Human-readable detail, including the fallback diagnostic when skipped. */
  detail: string;
}

export interface ShrinkReport {
  mode?: ShrinkMode;
  reduction?: {
    strategy: "ddmin";
    selectedGroupIds: string[];
    attempts: { ids: string[]; key: string; verdict: "PASS" | "FAIL" | "INCONCLUSIVE"; cached: boolean }[];
    /** Present on AST-granular runs: the reduction unit was AST edits, not hunks. */
    atomGranularity?: "hunk" | "ast";
    /** Dependency groups actually considered by the reducer (member ids + reasons). */
    dependencyGroups?: { id: string; memberIds: string[]; reasons: string[] }[];
  };
  baseRef: string;
  headRef: string;
  durationMs?: number;
  input: DiffSummary;
  output: DiffSummary;
  testCommand: TestCommandStatus;
  candidates: CandidateItem[];
  removals: EvidenceItem[];
  kept: EvidenceItem[];
  needsHumanReview: EvidenceItem[];
  artifacts: string[];
  reportPath?: string;
  reportJsonPath?: string;
  cleanupBranch?: string;
  cleanupWorktreePath?: string;
  patchPath?: string;
  /** ISO-8601 timestamp captured when the shrink run started (L4 audit field). */
  startedAt?: string;
  /** ISO-8601 timestamp captured when the shrink run finished (L4 audit field). */
  finishedAt?: string;
  /** PatchDiet version that produced this report, read from package.json (L4 audit field). */
  patchdietVersion?: string;
  /** Resolved commit SHA of `baseRef` (L4 audit field). */
  baseCommitSha?: string;
  /** Resolved commit SHA of `headRef` (L4 audit field). */
  headCommitSha?: string;
  /** SHA-256 of the exact cleanup.diff bytes emitted for this run. */
  cleanupDiffSha256?: string;
  /** Original command-line arguments the run was invoked with (L4 audit field). */
  commandLineArgs?: string[];
  /**
   * True when the run could not complete all of its verification work (global
   * runtime budget exhausted, or the combined removal verification failed and
   * removals were downgraded to keep-only).
   */
  partial?: boolean;
  /** Human-readable explanation of why the report is partial. */
  partialReason?: string;
  /**
   * P0-3: pinned, attested commit SHAs. `baseCommitSha` is the merge-base the
   * three-dot diff was computed from (must equal the resolved BASE ref);
   * `headCommitSha` is the agent HEAD attested at run start — later movement
   * of the agent ref never changes these.
   */
  mergeBaseCommitSha?: string;
  /**
   * P0-3: stage evidence. `baseline` and `final` are always distinguishable;
   * `mode` is `verified` only when both passed and the artifact tree identity
   * was proven. Legacy externally constructed reports may omit this field —
   * renderers must not invent final evidence for them.
   */
  verification?: {
    baseline: VerificationStageEvidence;
    final: VerificationStageEvidence;
  };
  /** v2 controls: advisory optional commands actually executed (and only those). */
  optionalCommands?: OptionalCommandRecord[];
  /** v2 controls: targeted-first screening provenance and outcome. */
  targetedVerification?: TargetedVerificationEvidence;
  /** Advisory feedback memory affects trial order only, never eligibility or oracle authority. */
  feedbackRanking?: {
    enabled: true;
    supportThreshold: 2;
    recordsScanned: number;
    prioritizedCandidates: number;
    diagnostics: string[];
  };
  /** v2 controls: local GitHub check draft path when report.github_check is enabled. */
  githubCheckDraftPath?: string;
}
