import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  renderEvidenceReport,
  renderGithubCheckDraft,
  renderGitHubComment,
  renderHtmlReport,
  renderMarkdownReport
} from "../../report/src/index.js";
import { createPresetConfig, loadPatchDietConfig } from "./config.js";
import { parseUnifiedDiff, serializeUnifiedDiff, summarizeDiff } from "./diff.js";
import { getDiff, runGit } from "./git.js";
import { candidateContentSha256 } from "./feedback.js";
import type { FeedbackRankingMemory } from "./feedback.js";
import { reduceGroups, type ReductionAttempt } from "./reducer.js";
import type { AstShrinkOutcome } from "./ast-shrink.js";
import { runCommand, runCommandDetailed } from "./runner.js";
import {
  assertRealDirectoryInside,
  assertRunOwnedPath,
  removeOwnedPath,
  removeOwnedPathSync,
  rmdirIfEmpty,
  writeOutputFileAtomic
} from "./safe-output.js";
import type {
  CandidateCategory,
  CandidateVerdict,
  DiffFile,
  DiffHunk,
  OptionalCommandRecord,
  ShrinkReport,
  TargetedVerificationEvidence,
  VerificationCommandRecord,
  VerificationStageEvidence
} from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Candidate verdicts are memoized per run so repeated identical patches (duplicate
 * hunks, or the same hunk in two files) are not re-verified.
 *
 * The key carries SHA256(patch) + headRef + the required commands, so a cached
 * verdict can only be reused for the exact same patch content on the exact same
 * commit context. A long-running process (GitHub App handling several PRs) can
 * therefore never hit a verdict from an older PR or commit.
 */
const CANDIDATE_VERDICT_CACHE_LIMIT = 512;
const candidateVerdictCache = new Map<string, { verdict: CandidateVerdict; reason: string }>();

/** Test hook: drops in-process memoization so each test starts from a clean slate. */
export function clearInProcessCachesForTests(): void {
  candidateVerdictCache.clear();
}

function candidateVerdictCacheKey({
  patch,
  headRef,
  requiredCommands,
  commandTimeoutMs
}: {
  patch: string;
  headRef: string;
  requiredCommands: string[];
  commandTimeoutMs?: number;
}): string {
  const hash = createHash("sha256");
  hash.update(patch, "utf8");
  hash.update("\u0000", "utf8");
  hash.update(headRef, "utf8");
  hash.update("\u0000", "utf8");
  hash.update(requiredCommands.join("\u0001"), "utf8");
  hash.update("\u0000", "utf8");
  hash.update(String(commandTimeoutMs ?? ""), "utf8");
  return hash.digest("hex");
}

function readCachedVerdict(key: string): { verdict: CandidateVerdict; reason: string } | undefined {
  return candidateVerdictCache.get(key);
}

function writeCachedVerdict(key: string, value: { verdict: CandidateVerdict; reason: string }): void {
  if (candidateVerdictCache.size >= CANDIDATE_VERDICT_CACHE_LIMIT) {
    const oldest = candidateVerdictCache.keys().next().value;
    if (oldest !== undefined) {
      candidateVerdictCache.delete(oldest);
    }
  }
  candidateVerdictCache.set(key, value);
}

/**
 * Eval worktrees that are currently alive in this process, keyed by worktree
 * path with the owning repository as the value. The SIGINT/SIGTERM/beforeExit
 * handlers below use this registry to clean up after a hard interrupt instead
 * of leaving `git worktree` metadata (and locked directories) behind.
 */
const activeWorktrees = new Map<string, string>();
let worktreeCleanupHandlersInstalled = false;

export function registerActiveWorktree(worktreePath: string, cwd: string): void {
  activeWorktrees.set(worktreePath, cwd);
}

function unregisterActiveWorktree(worktreePath: string): void {
  activeWorktrees.delete(worktreePath);
}

/**
 * Removes every worktree this process still has registered, then prunes the
 * owning repositories' stale worktree metadata. Synchronous on purpose: signal
 * handlers cannot await asynchronous cleanup.
 */
export function cleanupActiveWorktreesSync(): void {
  const owningRepos = new Set<string>();
  for (const [worktreePath, cwd] of activeWorktrees) {
    owningRepos.add(cwd);
    // P0-3 F2: guard BEFORE `git worktree remove --force` too — git itself
    // deletes through a redirected (junctioned) path, so the path must be
    // proven run-owned inside the owning repository before git touches it.
    if (!isRunOwnedPathGuardSafe(cwd, worktreePath)) {
      activeWorktrees.delete(worktreePath);
      continue;
    }
    try {
      execFileSync("git", ["worktree", "remove", worktreePath, "--force"], {
        cwd,
        stdio: "ignore",
        timeout: 30_000
      });
    } catch {
      try {
        // P0-3 F2: containment-guarded removal — never deletes through a
        // redirected ancestor outside the owning repository.
        removeOwnedPathSync(worktreePath, cwd);
      } catch {
        // Best effort — the prune below still drops the stale registration.
      }
    }
    activeWorktrees.delete(worktreePath);
  }
  for (const cwd of owningRepos) {
    try {
      execFileSync("git", ["worktree", "prune"], { cwd, stdio: "ignore", timeout: 30_000 });
    } catch {
      // Best effort.
    }
  }
}

/** Test hook: registers a worktree as if this process had created it. */
export function registerActiveWorktreeForTests(worktreePath: string, cwd: string): void {
  registerActiveWorktree(worktreePath, cwd);
}

/** Test hook: reports whether the process-level cleanup handlers are installed. */
export function areWorktreeCleanupHandlersInstalledForTests(): boolean {
  return worktreeCleanupHandlersInstalled;
}

function installWorktreeCleanupHandlers(): void {
  if (worktreeCleanupHandlersInstalled) {
    return;
  }
  worktreeCleanupHandlersInstalled = true;

  const exitAfterCleanup = (exitCode: number) => {
    cleanupActiveWorktreesSync();
    process.exit(exitCode);
  };

  process.once("SIGINT", () => exitAfterCleanup(130));
  process.once("SIGTERM", () => exitAfterCleanup(143));
  process.on("beforeExit", () => {
    cleanupActiveWorktreesSync();
  });
}

/** Kept for API compatibility; path-pattern deletion is no longer performed (P0-3). */
const STALE_EVAL_WORKTREE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * H5: removes eval worktrees orphaned by a crashed previous run so a later
 * shrink cannot get stuck failing `git worktree add` on the same candidates.
 * Only PatchDiet-owned worktree paths are ever considered; user worktrees are
 * left alone. Returns how many stale worktrees were cleaned up.
 */
/**
 * H5/P0-3: prunes stale git worktree METADATA. Since P0-3 every run owns a
 * unique `.patchdiet/eval/<runId>` path, so a crashed run can never collide
 * with a later one and there is nothing to reclaim by path pattern: deleting
 * a directory that merely looks like an eval worktree (even with an old
 * mtime) could destroy live user work. `git worktree prune` drops stale
 * registrations only — it never deletes directories. Returns 0 (kept for API
 * compatibility).
 */
export async function pruneStaleEvalWorktrees(
  cwd: string,
  _maxAgeMs: number = STALE_EVAL_WORKTREE_AGE_MS
): Promise<number> {
  try {
    await execFileAsync("git", ["worktree", "prune"], { cwd });
  } catch {
    // Not a repository (or git unavailable): nothing to clean here.
  }
  return 0;
}

/**
 * P0-3 F2: boolean form of the run-ownership guard for best-effort cleanup
 * paths that must skip (never force through) an unprovable path.
 */
function isRunOwnedPathGuardSafe(ownerRoot: string, path: string): boolean {
  try {
    assertRunOwnedPath(ownerRoot, path, "run-owned worktree path");
    return true;
  } catch {
    return false;
  }
}

/**
 * H5: creates an eval worktree, self-healing a stale registration or leftover
 * directory from a crashed earlier run by pruning and retrying once before
 * surfacing an actionable error.
 */
export async function createEvalWorktree(worktreePath: string, headRef: string, cwd: string): Promise<void> {
  // P0-3 F2: guard BEFORE `git worktree add`/rm — git deletes and populates
  // through redirected paths, so the path must be proven run-owned first.
  assertRunOwnedPath(cwd, worktreePath, "PatchDiet eval worktree path");
  try {
    await execFileAsync("git", ["worktree", "add", "--detach", worktreePath, headRef], { cwd });
    return;
  } catch {
    // Fall through to the prune-and-retry recovery below.
  }

  try {
    await execFileAsync("git", ["worktree", "prune"], { cwd });
  } catch {
    // A failing prune must not prevent the retry.
  }
  try {
    // P0-3 F2: containment-guarded — a leftover path is only cleared when the
    // whole ancestor chain is provably inside the owning repository.
    removeOwnedPathSync(worktreePath, cwd);
  } catch {
    // If the directory cannot be cleared the retry fails and reports below.
  }

  try {
    await execFileAsync("git", ["worktree", "add", "--detach", worktreePath, headRef], { cwd });
  } catch (retryError) {
    const detail = retryError instanceof Error ? retryError.message : String(retryError);
    throw new Error(
      `could not create PatchDiet eval worktree at ${worktreePath}: ` +
      `'git worktree add --detach' failed twice in ${cwd}. ` +
      `Stop processes holding that directory, then run 'git worktree prune' and ` +
      `delete '${worktreePath}' if it still exists before retrying. Last git error: ${detail}`
    );
  }
}

export async function removeEvalWorktree(worktreePath: string, cwd: string): Promise<void> {
  // P0-3 F2: guard BEFORE `git worktree remove --force` — see the cleanup
  // handler: git itself deletes through redirected (junctioned) paths.
  if (!isRunOwnedPathGuardSafe(cwd, worktreePath)) {
    unregisterActiveWorktree(worktreePath);
    return;
  }
  try {
    await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"], { cwd });
  } catch {
    try {
      // P0-3 F2: containment-guarded fallback removal.
      removeOwnedPathSync(worktreePath, cwd);
    } catch {
      // Best effort — the run-end prune still drops the stale registration.
    }
  } finally {
    unregisterActiveWorktree(worktreePath);
  }
}

export interface RunShrinkOptions {
  cwd: string;
  baseRef: string;
  headRef: string;
  requiredCommands: string[];
  strategy?: "conservative" | "ddmin";
  /**
   * Reduction unit granularity. `"hunk"` (default, v1-compatible) reduces
   * whole hunks; `"ast"` atomizes both pinned blobs into paired AST-level
   * edits and reduces those with the same ddmin + final-artifact pipeline.
   */
  atomGranularity?: "hunk" | "ast";
  /** AST mode: coalesce same-symbol/import/call/test edits into groups (default true). */
  dependencyGrouping?: boolean;
  /** Explicit task text feeding the advisory scope gate (never authorises removal). */
  taskText?: string;
  createBranch?: boolean;
  apply?: boolean;
  dryRun?: boolean;
  ignorePaths?: string[];
  /** Paths that a v2 safety policy reserves for human review. */
  protectPaths?: string[];
  /** v2 dependency manifests are never automatically removed. */
  dependencyManifestsHumanReview?: boolean;
  allowTestFileRemoval?: boolean;
  commandTimeoutMs?: number;
  retryFlakyTests?: number;
  /**
   * H8: global wall-clock budget for the whole run in milliseconds
   * (`reduction.max_runtime_minutes`). When the budget is exhausted no new
   * candidates are evaluated; verdicts already completed are kept and the
   * report is marked partial. Explicit values <= 0 disable the budget.
   */
  maxRuntimeMs?: number;
  /**
   * H8: maximum number of concurrently alive eval worktrees
   * (`performance.max_parallel_worktrees`). Candidates are evaluated with a
   * worktree pool of this size; the default of 1 keeps serial behavior.
   */
  maxParallelWorktrees?: number;
  /**
   * L4: original command-line arguments, recorded in run.json for auditing.
   * Defaults to this process's own argv.
   */
  commandLineArgs?: string[];
  /**
   * v2 report toggles. Only toggled-ON formats are written and listed in
   * `report.artifacts`; disabled formats produce no file and no ghost path in
   * `reportPath`/`reportJsonPath`/artifacts. Undefined fields default to the
   * historical v1 behavior (markdown/html/github/json on; evidence and
   * github_check off — the latter is a local draft when explicitly enabled).
   */
  report?: {
    html?: boolean;
    markdown?: boolean;
    githubComment?: boolean;
    evidence?: boolean;
    json?: boolean;
    githubCheck?: boolean;
  };
  /**
   * v2 controls: configured OPTIONAL commands. Executed as ADVISORY in an
   * isolated pinned-HEAD evaluation worktree with a bounded timeout; recorded
   * with their real exit/timedOut/duration. They never replace the required
   * oracle; a command that mutates tracked source invalidates the artifact.
   */
  optionalCommands?: string[];
  /**
   * v2 controls: run targeted-first mapped test commands. When a plan is
   * supplied and `available`, the mapped commands for each candidate's changed
   * files execute AFTER each trial removal and BEFORE that trial's full
   * required oracle; a targeted failure rejects the candidate. The full
   * required combined/final oracle always still runs and remains the removal
   * authority. When no reliable plan is available the caller passes
   * `available: false` and the report records the explicit full-oracle
   * fallback — targeted execution is never faked.
   */
  targetedFirst?: boolean;
  /**
   * v2 controls: targeted test mapping. `mappings` maps changed source paths
   * to ready-to-run test commands (the CLI derives them from the pinned
   * SQLite knowledge index via `buildTargetedPlan`); `provenance` records
   * where the mapping came from. When the CLI could not build a reliable
   * plan it passes `diagnostic` instead of mappings and the run records the
   * explicit full-oracle fallback. Mapped commands execute AFTER each trial
   * removal and BEFORE that trial's full required oracle; they may only
   * reject candidates, never replace the required combined/final oracle.
   */
  testMappings?: {
    provenance: string;
    mappings: Record<string, string[]>;
    /** Explicit fallback diagnostic when no reliable mapping was available. */
    diagnostic?: string;
    /** Mapped test files excluded because their runner recipe is unsupported. */
    unsupportedRecipes?: string[];
  };
  /**
   * v2 scope control (scope.allow_format_only_removal). When false, hunks
   * whose changes are whitespace/format-only go to human review instead of
   * being evaluated for removal. Default true (historical behavior).
   */
  allowFormatOnlyRemoval?: boolean;
  /**
   * v2 controls: when false the candidate-set verdict cache is disabled and
   * every ddmin trial executes against the oracle. Default true.
   */
  cacheTests?: boolean;
  /** Optional, explicitly requested ordering hints from bounded local feedback. */
  feedbackRanking?: FeedbackRankingMemory;
}

export interface HunkEvaluation {
  filePath: string;
  hunk: DiffHunk;
  index: number;
  verdict: CandidateVerdict;
  reason: string;
  category: CandidateCategory;
  contentSha256?: string;
}

/** Shared state threaded through candidate evaluation. */
export interface EvaluationContext {
  options: RunShrinkOptions;
  patchDir: string;
  /**
   * P0-3: unique run-owned scratch root (`.patchdiet/eval/<runId>`). Every
   * worktree and candidate patch of this run lives under it; cleanup removes
   * exactly this path and never shared siblings.
   */
  runEvalRoot: string;
  /**
   * P0-3: pinned commits attested at run start. All worktrees, diffs and tree
   * checks use these SHAs; later movement of the agent ref is irrelevant.
   */
  pinnedBaseSha: string;
  pinnedHeadSha: string;
  /**
   * Encoding the raw diff bytes were decoded with ("utf8" normally, "latin1"
   * when the diff contained non-UTF-8 bytes). Every patch file written back
   * to disk must use the same encoding so bytes round-trip exactly.
   */
  patchEncoding: "utf8" | "latin1";
  /** Size of the eval worktree pool (performance.max_parallel_worktrees). */
  maxParallelWorktrees: number;
  /** Global budget deadline (epoch ms); undefined when the budget is disabled. */
  deadlineAt?: number;
  budgetLabel: string;
  budgetSkips: { count: number };
  /** v2 controls: targeted test mapping threaded to per-trial screening. */
  targeted?: { provenance: string; mappings: Record<string, string[]> };
  /** v2 controls: targeted command usage observed across all trials. */
  targetedUsage: { executed: string[]; failedTrials: number };
  feedbackPrioritizedKeys: Set<string>;
}

export async function runShrink(
  options: RunShrinkOptions
): Promise<ShrinkReport> {
  // P0-1: fail closed on a missing or blank verification oracle BEFORE any
  // repository mutation (worktree pruning, .patchdiet creation, baseline
  // execution). With zero commands every candidate verdicts "removed"
  // trivially and the report claims "passed" — a cleanup labelled verified
  // with no oracle must never be producible, not even via the exported API.
  validateRequiredCommands(options.requiredCommands);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  // H5: hard-interrupt cleanup must be in place before the first worktree exists.
  installWorktreeCleanupHandlers();

  // H8: the global runtime budget (reduction.max_runtime_minutes) caps the whole
  // run; once it is exhausted no new candidate evaluations are started.
  const budgets = resolveBudgets(options);
  const deadlineAt = budgets.maxRuntimeMs !== undefined
    ? startedAtMs + budgets.maxRuntimeMs
    : undefined;
  const budgetLabel = budgets.maxRuntimeMs !== undefined
    ? formatBudgetLabel(budgets.maxRuntimeMs)
    : "no budget";
  const budgetSkips = { count: 0 };
  const partialReasons: string[] = [];
  const markPartial = (reason: string) => {
    partialReasons.push(reason);
  };
  // v2 controls: advisory optional command records and targeted screening
  // state, filled in below and surfaced in the report.
  const optionalRecords: OptionalCommandRecord[] = [];
  let targetedVerification: TargetedVerificationEvidence | undefined;

  // P0-3: pin the attested commits BEFORE any oracle run, output creation or
  // repository mutation. An unresolvable ref is a hard error — PatchDiet never
  // attests against an undefined or silently moving ref.
  const baseCommitSha = await resolveCommitShaStrict(options.baseRef, options.cwd);
  const headCommitSha = await resolveCommitShaStrict(options.headRef, options.cwd);
  const mergeBaseCommitSha = await resolveMergeBaseSha(baseCommitSha, headCommitSha, options.cwd);
  if (mergeBaseCommitSha !== baseCommitSha) {
    throw new Error(
      `ERROR: BASE ref '${options.baseRef}' (${baseCommitSha}) is not the merge-base of ` +
      `HEAD '${options.headRef}' (${headCommitSha}); a three-dot diff would not describe this PR.\n` +
      "PatchDiet fails closed here: rebase the agent branch onto BASE, or pass the merge-base as BASE."
    );
  }

  // P0-3: --apply mutates the live checkout; its strict preconditions (clean
  // live tree, live HEAD === pinned BASE) are validated BEFORE any output —
  // including .patchdiet — is created. Only PatchDiet's own .patchdiet output
  // is exempt from the cleanliness requirement; user dirty/untracked files
  // always block delivery.
  if (options.apply && !options.dryRun) {
    // Only PatchDiet's own precise artifact file names are exempt from the
    // cleanliness requirement (they may exist from a previous run); arbitrary
    // user content under .patchdiet always blocks delivery.
    await assertLiveCheckoutReadyForApply(options.cwd, baseCommitSha, PATCHDIET_OUTPUT_ALLOWLIST);
  }

  // M2: the dirty-tree warning stays informational — since P0-3 the baseline
  // no longer runs in the live tree at all (it runs in a clean pinned HEAD
  // worktree), so dirty user files cannot rescue a broken committed HEAD.
  await warnIfWorkingTreeDirty(options.cwd);

  // H5 (P0-3 F6): worktrees orphaned by a crashed previous run would make
  // `git worktree add` fail on the same candidates forever — but pruning
  // mutates repository metadata, so it may only run AFTER every precondition
  // (pinned refs, merge-base, apply readiness) has succeeded. An invalid ref
  // must never touch repository metadata.
  await pruneStaleEvalWorktrees(options.cwd).catch(() => 0);

  // P0-3: output containment. A symlink/junction .patchdiet or eval directory
  // pointing outside the repository is refused before anything is written or
  // recursively cleaned through it.
  const patchDir = join(options.cwd, ".patchdiet");
  assertRealDirectoryInside(options.cwd, patchDir, ".patchdiet output directory");
  assertRealDirectoryInside(patchDir, join(patchDir, "eval"), ".patchdiet/eval directory");

  // M2: eval scratch lives inside the target repository so required commands
  // resolve project-local tooling (node_modules) exactly like the baseline.
  const patchDirExisted = lstatPathExists(patchDir);
  mkdirSync(patchDir, { recursive: true });

  // P0-3: unique run-owned scratch root; cleanup removes exactly this path,
  // never shared eval siblings of concurrent or past runs.
  const runId = randomUUID();
  const runEvalRoot = join(patchDir, "eval", runId);
  mkdirSync(runEvalRoot, { recursive: true });

  // P0-3: a budget already exhausted before the baseline can never produce a
  // verified result — fail closed with cleanup (no report is emitted). The
  // shared .patchdiet created here is only ever rmdir'd when EMPTY, so
  // concurrent content placed inside it during the run survives.
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    await removeOwnedPath(runEvalRoot, options.cwd);
    await rmdirIfEmpty(join(patchDir, "eval"));
    if (options.dryRun && !patchDirExisted) {
      await rmdirIfEmpty(patchDir);
    }
    throw new Error(
      `ERROR: global runtime budget (${budgetLabel}) was exhausted before the baseline could run. ` +
      "PatchDiet will not attest a cleanup without an executed baseline."
    );
  }

  let report: ShrinkReport;
  try {
    // P0-3 F2: the ENTIRE scratch lifecycle — baseline execution and diff
    // capture included — sits inside this try/finally so any failure cleans
    // the run-owned eval root and, for dry runs, the .patchdiet dir this run
    // created (non-recursively: only when empty).
    const baselineStage = await runBaselineStage(options, headCommitSha, runEvalRoot, deadlineAt);
    if (baselineStage.status !== "passed") {
      const failed = baselineStage.commands.find((record) => record.status === "failed");
      const detail = baselineStage.detail
        ?? (failed?.timedOut && options.commandTimeoutMs
          ? `required command timed out after ${options.commandTimeoutMs}ms: ${failed.command}`
          : `required command failed: ${failed?.command ?? "(unknown)"}`);
      throw new Error(`${detail} (baseline on pinned HEAD ${headCommitSha})`);
    }

    const { diff, encoding } = await getDiff(options.cwd, baseCommitSha, headCommitSha);
    const parsed = parseUnifiedDiff(diff);
    const input = summarizeDiff(parsed);

  // Byte-fidelity guard (P0-2): a non-UTF-8 diff is decoded latin1 (reversible)
  // but its text can no longer be trusted as removal evidence — route the whole
  // diff to human review instead of auto-removing anything from it.
  const patchEncoding: "utf8" | "latin1" = encoding === "latin1" ? "latin1" : "utf8";
  if (patchEncoding === "latin1") {
    process.stderr.write(
      "[patchdiet] warning: diff contains non-UTF-8 bytes; it is preserved byte-for-byte " +
      "but the whole diff requires human review (no automatic removals will be made)\n"
    );
  }

  const ctx: EvaluationContext = {
    options,
    patchDir,
    runEvalRoot,
    pinnedBaseSha: baseCommitSha,
    pinnedHeadSha: headCommitSha,
    patchEncoding,
    maxParallelWorktrees: budgets.maxParallelWorktrees,
    deadlineAt,
    budgetLabel,
    budgetSkips,
    targeted: options.testMappings?.mappings !== undefined
      ? { provenance: options.testMappings.provenance, mappings: options.testMappings.mappings }
      : undefined,
    targetedUsage: { executed: [], failedTrials: 0 },
    feedbackPrioritizedKeys: new Set()
  };

    // AST granularity runs the dedicated atom-level pipeline: paired edits
    // from both pinned blobs, dependency groups, scope-gated eligibility and
    // the same mandatory combined + final artifact verification. The AST
    // branch is loaded LAZILY so the default hunk path never initializes the
    // parser/tree-sitter runtime — the standalone action bundle ships without
    // node_modules and must stay fully functional on hunks. When AST is
    // requested but its runtime dependencies are missing, the run fails with
    // a truthful error (never a silent hunk downgrade, never an auto-install).
    let evaluations: HunkEvaluation[];
    let reduction: ShrinkReport["reduction"];
    let astExpectedTreeSha: string | undefined;
    let astBuildKeptPatch: (() => string) | undefined;
    let combinedCompleted = true;
    if (options.atomGranularity === "ast" && patchEncoding === "utf8") {
      let outcome: AstShrinkOutcome;
      try {
        const { runAstShrink } = await import("./ast-shrink.js");
        outcome = await runAstShrink({ ctx, parsed, markPartial, taskText: options.taskText });
      } catch (error) {
        throw new Error(
          `AST-granularity shrink could not start: the AST runtime dependencies ` +
            `(tree-sitter grammar runtime) are not available in this installation. ` +
            `Install the full PatchDiet package or run without --granularity ast. ` +
            `Underlying error: ${(error as Error).message}`
        );
      }
      evaluations = outcome.evaluations;
      reduction = outcome.reduction;
      astExpectedTreeSha = outcome.expectedTreeSha;
      astBuildKeptPatch = outcome.buildKeptPatch;
      combinedCompleted = outcome.completed;
    } else {
      evaluations = await evaluateAllCandidates(parsed, ctx);

      // M3/P0-3: the final removals set is verified as a whole — every hunk
      // passing on its own does not prove the combination is safe. Any failure,
      // timeout, tree mutation or budget exhaustion downgrades every removal in
      // place; the expected HEAD-minus-removals tree is captured before the
      // oracle runs.
      const combined = options.strategy === "ddmin"
        ? await selectDdminRemovals(parsed, evaluations, ctx, markPartial)
        : await verifyCombinedRemovalSet(parsed, evaluations, ctx, markPartial);
      reduction = "reduction" in combined ? (combined.reduction as ShrinkReport["reduction"]) : undefined;
      combinedCompleted = combined.completed;
      astExpectedTreeSha = combined.completed && combined.expectedTreeSha !== undefined
        ? combined.expectedTreeSha
        : undefined;
    }

    if (budgetSkips.count > 0) {
      markPartial(
        `${budgetSkips.count} candidate(s) were not evaluated because the global runtime budget (${budgetLabel}) was exhausted; they require human review`
      );
    }

    // v2 controls: configured OPTIONAL commands run as ADVISORY in an isolated
    // pinned-HEAD evaluation worktree with a bounded timeout. Their real
    // outcome (exit code, timedOut, duration) is recorded and surfaced; a
    // failure is advisory and never replaces the required oracle — but a
    // command that MUTATES tracked source invalidates the artifact: every
    // removal is retained and the run is partial. Read-only verify/explain
    // never reach this code (they are separate commands).
    if (options.optionalCommands !== undefined && options.optionalCommands.length > 0 && !options.dryRun) {
      const advisoryWorktree = join(ctx.runEvalRoot, `optional-advisory-${randomUUID().slice(0, 8)}`);
      let mutatedAny = false;
      let identityUnverifiable = false;
      // Fail-closed tracked-source inspection. Each executed command is
      // inspected INDIVIDUALLY (snapshot before, tree compare after), so a
      // later command can never silently restore an earlier command's
      // mutation. A snapshot failure is fail-closed: unverifiable identity
      // invalidates the artifact exactly like an observed mutation.
      const snapshotTree = async (): Promise<string | undefined> => {
        try {
          await execFileAsync("git", ["add", "-u"], { cwd: advisoryWorktree });
          return await writeTreeOf(advisoryWorktree);
        } catch {
          return undefined;
        }
      };
      registerActiveWorktree(advisoryWorktree, options.cwd);
      try {
        await createEvalWorktree(advisoryWorktree, headCommitSha, options.cwd);
        for (const command of options.optionalCommands) {
          if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
            optionalRecords.push({
              command,
              status: "not-run",
              durationMs: 0,
              advisory: true,
              detail:
                "advisory optional command was not run: the global runtime budget was exhausted; " +
                "this never affects the required oracle verdict"
            });
            continue;
          }
          const treeBefore = await snapshotTree();
          if (treeBefore === undefined) {
            identityUnverifiable = true;
            optionalRecords.push({
              command,
              status: "not-run",
              durationMs: 0,
              advisory: true,
              detail:
                "advisory optional command was not run: tracked-source identity could not be established " +
                "(tree snapshot failed); the artifact is invalidated fail-closed"
            });
            break;
          }
          const result = await runCommandDetailed(command, advisoryWorktree, {
            timeoutMs: options.commandTimeoutMs
          });
          const status: OptionalCommandRecord["status"] = result.timedOut
            ? "timedOut"
            : result.exitCode === 0
              ? "passed"
              : "failed";
          const treeAfter = await snapshotTree();
          const mutatedHere = treeAfter === undefined ? true : treeAfter !== treeBefore;
          if (treeAfter === undefined) {
            identityUnverifiable = true;
          }
          if (mutatedHere) {
            mutatedAny = true;
          }
          optionalRecords.push({
            command,
            status,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
            advisory: true,
            mutatedTrackedSource: mutatedHere,
            detail:
              `advisory optional command ${status} (exit ${result.exitCode ?? "n/a"}); ` +
              (mutatedHere
                ? treeAfter === undefined
                  ? "tracked-source identity could not be verified after this command; fail-closed"
                  : "this command MUTATED tracked source in the evaluation environment"
                : "tracked source unchanged after this command") +
              "; advisory only — it never replaces the required oracle and never upgrades a verdict"
          });
        }
      } catch {
        // Worktree creation failed: record the advisory run as not executed.
        for (const command of options.optionalCommands) {
          if (!optionalRecords.some((record) => record.command === command)) {
            optionalRecords.push({
              command,
              status: "not-run",
              durationMs: 0,
              advisory: true,
              detail: "advisory optional command was not run: the isolated evaluation environment could not be created"
            });
          }
        }
      } finally {
        await removeEvalWorktree(advisoryWorktree, options.cwd);
      }
      if (mutatedAny || identityUnverifiable) {
        markPartial(
          identityUnverifiable
            ? "optional advisory commands could not be identity-checked (tree snapshot failed); fail-closed: the cleanup artifact is invalidated and every removal was retained for human review"
            : "optional advisory command(s) mutated tracked source in the evaluation environment; " +
              "the cleanup artifact is invalidated and every removal was retained for human review"
        );
        downgradeRemovals(
          evaluations,
          identityUnverifiable
            ? "an optional advisory command's source identity could not be verified; every removal was retained for human review"
            : "an optional advisory command mutated tracked source; every removal was retained for human review"
        );
        if (reduction) {
          reduction.selectedGroupIds = [];
        }
        astExpectedTreeSha = undefined;
      }
    }

    // P0-2: kept files keep every parsed metadata field (extendedHeaders,
    // binarySection, rename/is-new flags) — only the hunks are filtered by
    // verdict. Zero-hunk metadata sections (mode-only changes, empty new
    // files) have no verdicts at all and must not disappear from the output
    // patch; they are surfaced in the report as metadata-only placeholders.
    const buildKept = (): { keptFiles: DiffFile[]; keptPatch: string } => {
      if (astBuildKeptPatch !== undefined) {
        // AST mode: the kept patch is REGENERATED from the paired edits (BASE
        // -> reduced); hunk coordinates no longer describe the output.
        const keptPatch = astBuildKeptPatch();
        return { keptFiles: keptPatch.trim().length > 0 ? parseUnifiedDiff(keptPatch).files : [], keptPatch };
      }
      const keptFiles: DiffFile[] = [];
      for (const file of parsed.files) {
        const hunks = file.hunks.filter((_hunk, index) => {
          const evaluation = evaluations.find(
            (candidate) => candidate.filePath === file.path && candidate.index === index
          );
          return evaluation?.verdict !== "removed";
        });

        if (hunks.length > 0) {
          keptFiles.push({ ...file, hunks });
        } else if (file.hunks.length === 0 && (file.extendedHeaders?.length ?? 0) > 0) {
          keptFiles.push({ ...file, hunks });
        }
      }
      return { keptFiles, keptPatch: serializeUnifiedDiff({ files: keptFiles }) };
    };

    const patchPath = join(patchDir, "cleanup.diff");
    const keptPatchPath = join(runEvalRoot, "kept.diff");
    let { keptFiles, keptPatch } = buildKept();
    if (astBuildKeptPatch !== undefined && partialReasons.length > 0) {
      // AST mode, partial delivery: a partial run (fallback files, budget
      // skips, inconclusive search) must retain ALL removals — unverified
      // high-confidence removals are never published. The mandatory final
      // artifact verification below then proves the keep-all artifact itself.
      downgradeRemovals(evaluations, "the cleanup run is partial; every removal was retained for human review");
      if (reduction) {
        reduction.selectedGroupIds = [];
      }
      astExpectedTreeSha = await treeOf(headCommitSha, options.cwd);
      ({ keptFiles, keptPatch } = buildKept());
    }
    writeFileSync(keptPatchPath, keptPatch, patchEncoding);

    // Expected HEAD-minus-removals tree: captured by the combined stage in an
    // isolated pinned HEAD worktree; when nothing was removed (or everything
    // was downgraded) it is simply the pinned HEAD tree.
    const expectedTreeSha = astExpectedTreeSha !== undefined
      ? astExpectedTreeSha
      : await treeOf(headCommitSha, options.cwd);

    // P0-3: final artifact verification is MANDATORY — also for zero-removal
    // runs. The exact kept patch bytes are applied onto a clean detached work
    // tree at the pinned BASE and the full oracle runs on that exact artifact.
    const finalStage = await verifyFinalArtifact({
      ctx,
      keptPatchPath,
      expectedTreeSha,
      deadlineAt,
      markPartial
    });

    if (finalStage.status !== "passed") {
      // No completed final verification means zero automatic removals: the
      // delivered patch retains the original changes (kept-only).
      downgradeRemovals(evaluations, "the final cleanup artifact could not be verified");
      if (reduction) {
        reduction.selectedGroupIds = [];
      }
      ({ keptFiles, keptPatch } = buildKept());
      writeFileSync(keptPatchPath, keptPatch, patchEncoding);
    }

    const verified =
      finalStage.status === "passed"
      && finalStage.treesMatch === true
      && partialReasons.length === 0;

    const output = summarizeDiff({ files: keptFiles });
    if (!options.dryRun) {
      // P0-3 F1: atomic, containment-safe write — never writes through a
      // symlink/hardlink placed at the artifact path.
      writeOutputFileAtomic(options.cwd, patchPath, keptPatch, patchEncoding);
    }

    // v2 controls: targeted-first evidence. Recorded whenever the caller
    // enabled targeted_first — including the explicit fallback when no
    // reliable mapping was available (targeted execution is never faked).
    if (options.targetedFirst === true) {
      const mapping = options.testMappings;
      const executed = [...new Set(ctx.targetedUsage.executed)].sort();
      if (mapping === undefined || mapping.mappings === undefined) {
        targetedVerification = {
          used: false,
          outcome: "skipped-no-mapping",
          commands: [],
          mappingProvenance: "none",
          detail:
            "explicit fallback: no test mapping was supplied; the FULL required oracle ran " +
            "and remains the removal authority (targeted execution was not faked)"
        };
      } else if (mapping.diagnostic !== undefined) {
        targetedVerification = {
          used: false,
          outcome: "skipped-no-mapping",
          commands: [],
          mappingProvenance: mapping.provenance,
          detail: `explicit fallback: ${mapping.diagnostic}`
        };
      } else if (executed.length === 0) {
        targetedVerification = {
          used: false,
          outcome: "skipped-no-mapping",
          commands: [],
          mappingProvenance: mapping.provenance,
          detail:
            "explicit fallback: the mapping produced no executable commands for the trial sets" +
            (mapping.unsupportedRecipes && mapping.unsupportedRecipes.length > 0
              ? ` (unsupported runner recipes: ${mapping.unsupportedRecipes.join(", ")})`
              : "") +
            "; the FULL required oracle ran and remains the removal authority"
        };
      } else {
        targetedVerification = {
          used: true,
          outcome: ctx.targetedUsage.failedTrials > 0 ? "failed" : "passed",
          commands: executed,
          mappingProvenance: mapping.provenance,
          detail:
            `targeted mapped test commands executed on the actual removal state after each trial ` +
            `(${executed.length} unique command(s)); a targeted failure only rejects candidates` +
            (mapping.unsupportedRecipes && mapping.unsupportedRecipes.length > 0
              ? `; unsupported runner recipes excluded explicitly: ${mapping.unsupportedRecipes.join(", ")}`
              : "") +
            "; the FULL required combined/final oracle ran and remains the removal authority"
        };
      }
    }

    const baselineAttempts = baselineStage.commands.reduce((sum, record) => sum + record.attempts, 0);
    // Compatibility summary: command/duration/attempts describe the baseline
    // run, but `status` is the FINAL artifact verdict — a failed or not-run
    // final stage must never masquerade as a passed final verification.
    // v2 report toggles: `artifacts` lists ONLY files this run actually
    // writes (computed from the toggles before anything is emitted), so a
    // disabled format can never leave a ghost path in the report.
    const reportToggles = {
      html: options.report?.html ?? true,
      markdown: options.report?.markdown ?? true,
      githubComment: options.report?.githubComment ?? true,
      evidence: options.report?.evidence ?? false,
      json: options.report?.json ?? true,
      githubCheck: options.report?.githubCheck ?? false
    };
    const emittedArtifacts: string[] = options.dryRun ? [] : [".patchdiet/cleanup.diff"];
    if (!options.dryRun) {
      if (reportToggles.markdown) emittedArtifacts.push(".patchdiet/report.md");
      if (reportToggles.json) emittedArtifacts.push(".patchdiet/run.json");
      if (reportToggles.html) emittedArtifacts.push(".patchdiet/report.html");
      if (reportToggles.githubComment) emittedArtifacts.push(".patchdiet/report.github.md");
      if (reportToggles.evidence) emittedArtifacts.push(".patchdiet/evidence.md");
      if (reportToggles.githubCheck) emittedArtifacts.push(".patchdiet/github-check.draft.md");
    }
    report = {
      baseRef: options.baseRef,
      headRef: options.headRef,
      input,
      output,
      testCommand: {
        command: options.requiredCommands.join(" && "),
        status: finalStage.status,
        durationMs: baselineStage.durationMs,
        attempts: baselineAttempts
      },
      mode: verified ? "verified" : "unverified",
      verification: {
        baseline: {
          stage: "baseline",
          status: baselineStage.status,
          commands: baselineStage.commands,
          durationMs: baselineStage.durationMs,
          baseCommitSha,
          headCommitSha
        },
        final: finalStage
      },
      reduction,
      candidates: evaluations.map((evaluation) => ({
        filePath: evaluation.filePath,
        hunkHeader: evaluation.hunk.header,
        category: evaluation.category,
        verdict: evaluation.verdict,
        reason: evaluation.reason,
        contentSha256: evaluation.contentSha256 ?? candidateContentSha256(evaluation.filePath, evaluation.hunk)
      })),
      removals: evaluations
        .filter((evaluation) => evaluation.verdict === "removed")
        .map((evaluation) => ({
          filePath: evaluation.filePath,
          hunkHeader: evaluation.hunk.header,
          category: evaluation.category,
          reason: evaluation.reason,
          confidence: "high-confidence removal" as const
        })),
      kept: evaluations
        .filter((evaluation) => evaluation.verdict === "kept")
        .map((evaluation) => ({
          filePath: evaluation.filePath,
          hunkHeader: evaluation.hunk.header,
          category: evaluation.category,
          reason: evaluation.reason,
          confidence: "kept" as const
        })),
      needsHumanReview: evaluations
        .filter((evaluation) => evaluation.verdict === "needs-human-review")
        .map((evaluation) => ({
          filePath: evaluation.filePath,
          hunkHeader: evaluation.hunk.header,
          category: evaluation.category,
          reason: evaluation.reason,
          confidence: "needs-human-review" as const
        })),
      artifacts: emittedArtifacts,
      ...(optionalRecords.length > 0 ? { optionalCommands: optionalRecords } : {}),
      ...(targetedVerification !== undefined ? { targetedVerification } : {}),
      ...(options.feedbackRanking !== undefined ? { feedbackRanking: {
        enabled: true as const,
        supportThreshold: 2 as const,
        recordsScanned: options.feedbackRanking.recordsScanned,
        prioritizedCandidates: ctx.feedbackPrioritizedKeys.size,
        diagnostics: options.feedbackRanking.diagnostics,
      } } : {}),
      patchPath: options.dryRun ? undefined : patchPath,
      startedAt,
      patchdietVersion: readPatchDietVersion(),
      baseCommitSha,
      headCommitSha,
      ...(!options.dryRun ? { cleanupDiffSha256: createHash("sha256").update(Buffer.from(keptPatch, patchEncoding)).digest("hex") } : {}),
      mergeBaseCommitSha,
      commandLineArgs: options.commandLineArgs ?? process.argv.slice(2),
      partial: partialReasons.length > 0,
      partialReason: partialReasons.length > 0 ? partialReasons.join("; ") : undefined
    };

    // P0-2: zero-hunk metadata files (mode-only, empty new files) never reach
    // candidate evaluation, so without a placeholder they would be invisible
    // in the report while still being carried in the cleanup patch. They are
    // human-review items: file metadata is not content a patch verdict covers.
    for (const file of keptFiles) {
      if (file.hunks.length === 0) {
        const placeholder = {
          filePath: file.path,
          hunkHeader: "(metadata-only change — no hunks)",
          category: classifyCandidate(file.path, []),
          verdict: "needs-human-review" as const,
          reason: "metadata-only change preserved verbatim in the cleanup patch; requires human review",
          contentSha256: createHash("sha256").update(JSON.stringify(["metadata-v1", file.path, file.extendedHeaders ?? []])).digest("hex")
        };
        report.candidates.push(placeholder);
        report.needsHumanReview.push({
          filePath: placeholder.filePath,
          hunkHeader: placeholder.hunkHeader,
          category: placeholder.category,
          reason: placeholder.reason,
          confidence: "needs-human-review" as const
        });
      }
    }

    // P0-3: delivery is only allowed from a VERIFIED final artifact. An
    // unverified result blocks branch creation and apply, keeps every change
    // and is recorded as a partial reason.
    if (options.createBranch && !options.dryRun) {
      if (!verified) {
        markPartial("cleanup branch was not created because the final artifact could not be verified");
      } else {
        const branchInfo = await createCleanupBranch({
          options,
          patchDir,
          baseCommitSha,
          runId,
          keptPatchPath,
          keptPatch,
          artifactTreeSha: finalStage.artifactTreeSha!
        });
        report.cleanupBranch = branchInfo.branch;
        report.cleanupWorktreePath = branchInfo.worktree;
      }
    }

    if (options.apply && !options.dryRun) {
      if (!verified) {
        markPartial("nothing was applied because the final artifact could not be verified");
      } else {
        // Re-check the strict live preconditions immediately before mutation.
        // P0-3 F3: only the precise PatchDiet artifact allowlist and THIS
        // run's UUID eval root are exempt — never the whole .patchdiet tree.
        // Status paths are repo-relative, so the eval root is expressed
        // relatively too.
        const applyAllowlist = [...PATCHDIET_OUTPUT_ALLOWLIST, `.patchdiet/eval/${runId}`];
        await assertLiveCheckoutReadyForApply(options.cwd, baseCommitSha, applyAllowlist);
        if (keptPatch.trim().length === 0) {
          // Empty kept patch: the delivered artifact IS the BASE tree.
          const liveTree = await writeTreeOf(options.cwd);
          if (liveTree !== finalStage.artifactTreeSha) {
            throw new Error(
              "ERROR: --apply delivery mismatch: live tree does not match the verified artifact tree."
            );
          }
        } else {
          // Prove the patch applies before mutating anything, and capture the
          // pristine index tree for rollback verification.
          const initialTree = await writeTreeOf(options.cwd);
          let applyError: Error | undefined;
          try {
            await execFileAsync("git", ["apply", "--check", "--index", keptPatchPath], { cwd: options.cwd });
            await execFileAsync("git", ["apply", "--index", keptPatchPath], { cwd: options.cwd });
          } catch (error) {
            applyError = error instanceof Error ? error : new Error(String(error));
          }
          // P0-3 F7: EVERY post-mutation step is wrapped — any exception or
          // mismatch attempts a precise, verified rollback before reporting,
          // preserving the original failure detail and the truthful rollback
          // status. PatchDiet never resets or stashes.
          let liveTree: string | undefined;
          if (applyError === undefined) {
            try {
              liveTree = await writeTreeOf(options.cwd);
            } catch (error) {
              applyError = error instanceof Error ? error : new Error(String(error));
            }
          }
          if (applyError !== undefined || liveTree !== finalStage.artifactTreeSha) {
            const rollback = await rollbackAppliedCleanupPatch(
              options.cwd,
              keptPatchPath,
              initialTree,
              applyAllowlist
            );
            const originalDetail = applyError?.message ?? "live tree does not match the verified artifact";
            throw new Error(rollback.rolledBack
              ? `ERROR: --apply delivery failed (${originalDetail}); the application was rolled back ` +
                "and the live tree and index were verified restored. Nothing was delivered."
              : `ERROR: --apply delivery failed (${originalDetail}) AND the rollback could NOT be ` +
                `verified (${rollback.detail}). Your checkout may keep partially applied changes — ` +
                "inspect 'git status' before continuing. PatchDiet performed no reset and no stash.");
          }
        }
      }
    }

    report.durationMs = Date.now() - startedAtMs;
    report.finishedAt = new Date().toISOString();

    // v2 report toggles: ONLY enabled formats are written (each exactly once,
    // through the containment-safe atomic writer) and each write corresponds
    // to an entry already listed in report.artifacts. The stdout --json output
    // is an explicit user request and is unaffected by the file json toggle.
    if (!options.dryRun) {
      // Write ORDER matters: run.json is written LAST so the stored JSON
      // carries every final field (report paths, draft metadata) and equals
      // the report returned to the caller. Rich formats first, audit JSON last.
      if (reportToggles.markdown) {
        const reportPath = join(patchDir, "report.md");
        writeOutputFileAtomic(options.cwd, reportPath, renderMarkdownReport(report), "utf8");
        report.reportPath = reportPath;
      }
      if (reportToggles.html) {
        writeOutputFileAtomic(options.cwd, join(patchDir, "report.html"), renderHtmlReport(report), "utf8");
      }
      if (reportToggles.githubComment) {
        writeOutputFileAtomic(options.cwd, join(patchDir, "report.github.md"), renderGitHubComment(report), "utf8");
      }
      if (reportToggles.evidence) {
        writeOutputFileAtomic(options.cwd, join(patchDir, "evidence.md"), renderEvidenceReport(report), "utf8");
      }
      if (reportToggles.githubCheck) {
        // External check-run publication is OUTSIDE the CLI's scope: a local
        // draft with an explicit limitation is produced, never posted.
        const draftPath = join(patchDir, "github-check.draft.md");
        writeOutputFileAtomic(options.cwd, draftPath, renderGithubCheckDraft(report), "utf8");
        report.githubCheckDraftPath = draftPath;
      }
      if (reportToggles.json) {
        const reportJsonPath = join(patchDir, "run.json");
        // The path field is set BEFORE the write so the stored JSON equals the
        // returned report object field-for-field.
        report.reportJsonPath = reportJsonPath;
        writeOutputFileAtomic(options.cwd, reportJsonPath, JSON.stringify(report, null, 2), "utf8");
      }
    }
  } finally {
    // P0-3/H5: remove ONLY this run's scratch root (`.patchdiet/eval/<runId>`),
    // never the shared eval tree — sibling runs of concurrent or past runs
    // (and anything a user placed there) must survive. fs/promises rm is used
    // because Windows rmSync does not actually retry transient handles.
    await removeOwnedPath(runEvalRoot, options.cwd);
    // Leave the shared eval directory only if it is now empty (never destroys
    // sibling content: rmdir fails on non-empty directories).
    await rmdirIfEmpty(join(patchDir, "eval"));
    // H5/M2: dry runs must leave the target repository exactly as they found
    // it — but the shared .patchdiet is only rmdir'd when EMPTY, so content a
    // concurrent writer placed in it during the run is never destroyed.
    if (options.dryRun && !patchDirExisted) {
      await rmdirIfEmpty(patchDir);
    }
    // H5: final prune so the registration of any worktree that could not be
    // removed (locked directory, killed process) never blocks a future run.
    try {
      await execFileAsync("git", ["worktree", "prune"], { cwd: options.cwd });
    } catch {
      // Best effort.
    }
  }

  return report;
}

/**
 * H8: evaluates all candidates with a worktree pool of at most
 * `maxParallelWorktrees` concurrently alive worktrees (default 1 = serial).
 * Whole-file candidates go first; per-hunk candidates run only for files whose
 * whole-file patch was not proven removable. Results are assembled in original
 * diff order so reports stay deterministic.
 */
export async function evaluateAllCandidates(
  parsed: { files: DiffFile[] },
  ctx: EvaluationContext
): Promise<HunkEvaluation[]> {
  const { options } = ctx;

  // P0-2 byte-fidelity: a latin1 (non-UTF-8) diff is preserved byte-for-byte
  // but its lines are opaque bytes, not trustworthy text — no candidate is
  // evaluated or removed, everything goes to human review.
  if (ctx.patchEncoding === "latin1") {
    const reviews: HunkEvaluation[] = [];
    for (const file of parsed.files) {
      const category = classifyCandidate(file.path, file.hunks);
      for (const [index, hunk] of file.hunks.entries()) {
        reviews.push({
          filePath: file.path,
          hunk,
          index,
          verdict: "needs-human-review",
          reason: "diff contains non-UTF-8 bytes; the whole diff is preserved byte-for-byte and requires human review",
          category
        });
      }
    }
    return reviews;
  }

  const skipByFile = new Map<DiffFile, Omit<HunkEvaluation, "hunk" | "index">>();
  const evaluableFiles: DiffFile[] = [];
  for (const file of parsed.files) {
    const skippedEvaluation = getConservativeSkipEvaluation(file, options);
    if (skippedEvaluation) {
      skipByFile.set(file, skippedEvaluation);
    } else if (file.hunks.length > 0) {
      // v2 scope control: a file whose hunks are ALL format-only never reaches
      // any removal evaluation (whole-file or per-hunk) when the configured
      // policy disallows format-only removal.
      if (options.allowFormatOnlyRemoval === false && file.hunks.every((hunk) => isFormatOnlyHunk(hunk))) {
        skipByFile.set(file, {
          filePath: file.path,
          verdict: "needs-human-review",
          reason: "format-only change kept for human review (scope.allow_format_only_removal: false)",
          category: classifyCandidate(file.path, file.hunks)
        });
        continue;
      }
      evaluableFiles.push(file);
    }
  }

  // Feedback never adds a file to this list: conservative skips and format
  // protections ran above. It only changes trial scheduling among survivors.
  const priorities = options.feedbackRanking?.priorities ?? {};
  const hunkScore = (file: DiffFile, hunk: DiffHunk): number =>
    priorities[candidateContentSha256(file.path, hunk)] ?? 0;
  const originalFileOrder = new Map(evaluableFiles.map((file, index) => [file, index]));
  evaluableFiles.sort((a, b) =>
    Math.max(0, ...b.hunks.map((hunk) => hunkScore(b, hunk))) -
    Math.max(0, ...a.hunks.map((hunk) => hunkScore(a, hunk))) ||
    originalFileOrder.get(a)! - originalFileOrder.get(b)!);
  for (const file of evaluableFiles) {
    for (const hunk of file.hunks) {
      if (options.allowFormatOnlyRemoval === false && isFormatOnlyHunk(hunk)) continue;
      const key = candidateContentSha256(file.path, hunk);
      if (priorities[key] > 0) ctx.feedbackPrioritizedKeys.add(key);
    }
  }

  // Phase 1 — whole-file candidates.
  const fileRemoved = new Map<DiffFile, Omit<HunkEvaluation, "hunk" | "index">>();
  const wholeFileCandidates = options.allowFormatOnlyRemoval === false
    ? evaluableFiles.filter((file) => !file.hunks.some((hunk) => isFormatOnlyHunk(hunk)))
    : evaluableFiles;
  await forEachWithConcurrency(wholeFileCandidates, ctx.maxParallelWorktrees, async (file) => {
    const fileEvaluation = await evaluateFileCandidate(file, ctx);
    if (fileEvaluation?.verdict === "removed") {
      fileRemoved.set(file, fileEvaluation);
    }
  });

  // Phase 2 — per-hunk candidates for files that were not removed whole.
  interface HunkTask {
    file: DiffFile;
    hunk: DiffHunk;
    index: number;
    result?: HunkEvaluation;
  }
  const hunkTasks: HunkTask[] = [];
  const tasksByFile = new Map<DiffFile, Map<number, HunkTask>>();
  for (const file of evaluableFiles) {
    // P0-2: a new file is only removable as a whole — reversing a partial
    // hunks-only patch of a new-file diff leaves the file behind (or fails),
    // so per-hunk removal is never attempted for `isNew` files.
    if (fileRemoved.has(file) || file.isNew) {
      continue;
    }
    for (const [index, hunk] of file.hunks.entries()) {
      // v2 scope control: format-only hunks (every changed line pair differs
      // only in whitespace) are never auto-removed when the configured policy
      // disallows format-only removal. Applied BEFORE any oracle work.
      if (options.allowFormatOnlyRemoval === false && isFormatOnlyHunk(hunk)) {
        hunkTasks.push({ file, hunk, index, result: {
          filePath: file.path,
          hunk,
          index,
          verdict: "needs-human-review",
          reason: "format-only change kept for human review (scope.allow_format_only_removal: false)",
          category: classifyCandidate(file.path, [hunk])
        }});
        let byIndex = tasksByFile.get(file);
        if (!byIndex) {
          byIndex = new Map();
          tasksByFile.set(file, byIndex);
        }
        byIndex.set(index, hunkTasks[hunkTasks.length - 1]!);
        continue;
      }
      const task: HunkTask = { file, hunk, index };
      hunkTasks.push(task);
      let byIndex = tasksByFile.get(file);
      if (!byIndex) {
        byIndex = new Map();
        tasksByFile.set(file, byIndex);
      }
      byIndex.set(index, task);
    }
  }
  const originalTaskOrder = new Map(hunkTasks.map((task, index) => [task, index]));
  hunkTasks.sort((a, b) => hunkScore(b.file, b.hunk) - hunkScore(a.file, a.hunk) ||
    originalTaskOrder.get(a)! - originalTaskOrder.get(b)!);
  await forEachWithConcurrency(hunkTasks, ctx.maxParallelWorktrees, async (task) => {
    if (task.result !== undefined) return; // policy-protected format-only hunk
    task.result = await evaluateHunkCandidate(task.file, task.hunk, task.index, ctx);
  });

  const evaluations: HunkEvaluation[] = [];
  for (const file of parsed.files) {
    const skippedEvaluation = skipByFile.get(file);
    const removedWhole = fileRemoved.get(file);
    for (const [index, hunk] of file.hunks.entries()) {
      if (skippedEvaluation) {
        evaluations.push({ ...skippedEvaluation, hunk, index });
        continue;
      }
      if (removedWhole) {
        evaluations.push({ ...removedWhole, hunk, index });
        continue;
      }
      const task = tasksByFile.get(file)?.get(index);
      evaluations.push(task?.result ?? {
        filePath: file.path,
        hunk,
        index,
        verdict: "needs-human-review",
        reason: file.isNew
          ? "new-file hunks are only removable as a whole file; per-hunk removal is not attempted"
          : "candidate evaluation did not complete",
        category: classifyCandidate(file.path, [hunk])
      });
    }
  }
  return evaluations;
}

/** M3: downgrades every individually-verified removal back to human review. */
export function downgradeRemovals(evaluations: HunkEvaluation[], detail: string): void {
  for (const evaluation of evaluations) {
    if (evaluation.verdict !== "removed") {
      continue;
    }
    evaluation.verdict = "needs-human-review";
    evaluation.reason =
      `downgraded to keep-only: individually verified, but ${detail} during combined removal verification`;
  }
}

/** Search already eligible file groups against the pinned HEAD oracle. */
async function selectDdminRemovals(
  parsed: { files: DiffFile[] },
  evaluations: HunkEvaluation[],
  ctx: EvaluationContext,
  markPartial: (reason: string) => void,
): Promise<{ completed: boolean; expectedTreeSha?: string; reduction: {
  strategy: "ddmin";
  selectedGroupIds: string[];
  attempts: ReductionAttempt[];
} }> {
  const candidatePaths = [...new Set(evaluations
    .filter((evaluation) => evaluation.verdict === "removed")
    .map((evaluation) => evaluation.filePath))].sort();
  const groups = candidatePaths.map((path) => {
    const file = parsed.files.find((item) => item.path === path)!;
    const memberIds = evaluations
      .filter((evaluation) => evaluation.filePath === path && evaluation.verdict === "removed")
      .map((evaluation) => `${path}\0${evaluation.index}`);
    const contentHash = createHash("sha256")
      .update(serializeUnifiedDiff({ files: [{ ...file, hunks: file.hunks.filter((_hunk, index) =>
        memberIds.includes(`${path}\0${index}`)) }] }), ctx.patchEncoding)
      .digest("hex");
    return { id: path, contentHash, memberIds };
  });
  const reduction = { strategy: "ddmin" as const, selectedGroupIds: [] as string[], attempts: [] as ReductionAttempt[] };
  if (groups.length === 0) {
    return { completed: true, expectedTreeSha: await treeOf(ctx.pinnedHeadSha, ctx.options.cwd), reduction };
  }

  const context = {
    baseSha: ctx.pinnedBaseSha,
    headSha: ctx.pinnedHeadSha,
    requiredCommands: ctx.options.requiredCommands,
    environment: createHash("sha256").update(JSON.stringify([
      process.execPath, process.version, process.platform, process.arch,
      process.env.NODE_ENV ?? "", process.env.CI ?? "",
      ctx.options.commandTimeoutMs ?? null, ctx.options.retryFlakyTests ?? 0,
    ])).digest("hex"),
    toolVersion: readPatchDietVersion() ?? "unknown",
  };
  const evaluate = async (selectedIds: string[]) => {
    const selected = new Set(selectedIds);
    const trial = evaluations.map((evaluation) => ({
      ...evaluation,
      verdict: evaluation.verdict === "removed" && !selected.has(evaluation.filePath)
        ? "kept" as const : evaluation.verdict,
    }));
    const reasons: string[] = [];
    try {
      const proof = await verifyCombinedRemovalSet(parsed, trial, ctx, (reason) => reasons.push(reason));
      if (proof.completed) return "PASS" as const;
      return reasons.some((reason) => /budget|timed out|altered tracked source|inconclusive|conflict/i.test(reason))
        ? "INCONCLUSIVE" as const : "FAIL" as const;
    } catch {
      return "INCONCLUSIVE" as const;
    }
  };

  const result = await reduceGroups(groups, context, evaluate, {
    cache: ctx.options.cacheTests !== false,
    priority: Object.fromEntries(groups.map((group) => [group.id,
      Math.max(0, ...evaluations.filter((item) => item.filePath === group.id && item.verdict === "removed")
        .map((item) => ctx.options.feedbackRanking?.priorities[
          item.contentSha256 ?? candidateContentSha256(item.filePath, item.hunk)] ?? 0))]))
  });
  reduction.attempts = result.attempts;
  reduction.selectedGroupIds = result.selectedIds;
  if (result.inconclusive) {
    downgradeRemovals(evaluations, "at least one grouped oracle result was inconclusive");
    markPartial("ddmin search observed an inconclusive oracle result; all removals require human review");
    reduction.selectedGroupIds = [];
    return { completed: false, reduction };
  }
  if (result.selectedIds.length === 0) {
    downgradeRemovals(evaluations, "no passing grouped removal set was found");
    markPartial("ddmin found no passing grouped removal set; all removals require human review");
    return { completed: false, reduction };
  }

  const selected = new Set(result.selectedIds);
  for (const evaluation of evaluations) {
    if (evaluation.verdict === "removed" && !selected.has(evaluation.filePath)) {
      evaluation.verdict = "needs-human-review";
      evaluation.reason = "kept after ddmin: this group was not part of the passing combined removal set";
    }
  }
  const proof = await verifyCombinedRemovalSet(parsed, evaluations, ctx, markPartial);
  if (!proof.completed) reduction.selectedGroupIds = [];
  return { ...proof, reduction };
}

/**
 * M3/P0-3: verifies the final removals set as one unit in a clean worktree at
 * the pinned HEAD. The expected HEAD-minus-removals tree (`git add -u` +
 * `write-tree`) is captured BEFORE the oracle runs. Failure, timeout, tracked
 * source mutation by the commands, or budget exhaustion at any point
 * downgrades every removal so the output keeps all changes, and the report is
 * marked partial. A zero-removal set is trivially consistent and reports the
 * pinned HEAD tree as expected.
 */
async function verifyCombinedRemovalSet(
  parsed: { files: DiffFile[] },
  evaluations: HunkEvaluation[],
  ctx: EvaluationContext,
  markPartial: (reason: string) => void
): Promise<{ completed: boolean; expectedTreeSha?: string }> {
  const { options } = ctx;
  const removedHunksByPath = new Map<string, DiffHunk[]>();
  for (const evaluation of evaluations) {
    if (evaluation.verdict !== "removed") {
      continue;
    }
    const hunks = removedHunksByPath.get(evaluation.filePath) ?? [];
    hunks.push(evaluation.hunk);
    removedHunksByPath.set(evaluation.filePath, hunks);
  }

  if (removedHunksByPath.size === 0) {
    return {
      completed: true,
      expectedTreeSha: await treeOf(ctx.pinnedHeadSha, options.cwd)
    };
  }

  if (ctx.deadlineAt !== undefined && Date.now() >= ctx.deadlineAt) {
    downgradeRemovals(evaluations, "the global runtime budget was exhausted before combined verification");
    markPartial(
      "combined removal verification was skipped because the global runtime budget was exhausted; all removals were downgraded to keep-only"
    );
    return { completed: false };
  }

  const removalsFiles: DiffFile[] = [];
  for (const [path, hunks] of removedHunksByPath) {
    const original = parsed.files.find((file) => file.path === path);
    removalsFiles.push(original ? { ...original, hunks } : { path, hunks });
  }
  const removalsPatch = serializeUnifiedDiff({ files: removalsFiles });
  if (removalsPatch.trim().length === 0) {
    return {
      completed: true,
      expectedTreeSha: await treeOf(ctx.pinnedHeadSha, options.cwd)
    };
  }

  const worktreePath = join(ctx.runEvalRoot, "combined");
  const removalsPatchPath = join(ctx.runEvalRoot, "combined-removals.diff");
  writeFileSync(removalsPatchPath, removalsPatch, ctx.patchEncoding);
  registerActiveWorktree(worktreePath, options.cwd);

  try {
    await createEvalWorktree(worktreePath, ctx.pinnedHeadSha, options.cwd);

    try {
      await execFileAsync("git", ["apply", "-R", removalsPatchPath], { cwd: worktreePath });
    } catch {
      downgradeRemovals(evaluations, "the combined removal patch could not be applied as a whole");
      markPartial(
        "combined removal verification failed: the full removal set could not be reverse-applied as one patch; all removals were downgraded to keep-only"
      );
      return { completed: false };
    }

    // Stage the exact tracked result and capture the expected tree BEFORE any
    // oracle runs. Untracked command outputs never enter this tree.
    await execFileAsync("git", ["add", "-u"], { cwd: worktreePath });
    const expectedTreeSha = await writeTreeOf(worktreePath);

    // v2 targeted-first: mapped tests for the removal set run on the ACTUAL
    // combined removal state, BEFORE the full required stage. A targeted
    // failure only rejects the removal set (FAIL); it can never approve it.
    if (ctx.options.targetedFirst === true && ctx.targeted) {
      const targeted = await runTargetedCommandsForTrial(
        ctx,
        worktreePath,
        [...removedHunksByPath.keys()]
      );
      if (targeted === "failed") {
        downgradeRemovals(evaluations, "targeted mapped tests failed on the combined removal state");
        markPartial(
          "combined removal verification rejected by targeted screening: mapped tests failed on the actual removal state; all removals were downgraded to keep-only"
        );
        return { completed: false };
      }
      if (targeted === "unverifiable") {
        downgradeRemovals(evaluations, "targeted mapped tests could not be verified on the combined removal state");
        markPartial(
          "combined removal verification was inconclusive: targeted screening could not verify source identity or the budget ran out; all removals were downgraded to keep-only"
        );
        return { completed: false };
      }
    }

    const stage = await runVerificationStage(options.requiredCommands, worktreePath, options, ctx.deadlineAt);
    if (stage.status !== "passed") {
      const failed = stage.commands.find((record) => record.status === "failed");
      const detail = stage.oscillated
        ? "INCONCLUSIVE: a required command produced conflicting pass/fail attempts"
        : stage.detail
        ? stage.detail
        : failed?.timedOut
        ? `required command '${failed.command}' timed out`
        : `required command '${failed?.command ?? "(unknown)"}' failed`;
      downgradeRemovals(evaluations, `${detail} during combined removal verification`);
      markPartial(
        `combined removal verification failed: ${detail} when the full removal set was reverted together; all removals were downgraded to keep-only`
      );
      return { completed: false };
    }

    // Required commands must validate the artifact, not rewrite it: any
    // tracked-source change they make invalidates the captured tree.
    await execFileAsync("git", ["add", "-u"], { cwd: worktreePath });
    if ((await writeTreeOf(worktreePath)) !== expectedTreeSha) {
      downgradeRemovals(evaluations, "required commands altered tracked source during combined removal verification");
      markPartial(
        "combined removal verification failed: required commands altered tracked source in the verification worktree; all removals were downgraded to keep-only"
      );
      return { completed: false };
    }

    // Budget exhausted AFTER the candidates passed still forbids automatic
    // removals: the combined proof did not finish inside the budget.
    if (ctx.deadlineAt !== undefined && Date.now() >= ctx.deadlineAt) {
      downgradeRemovals(evaluations, "the global runtime budget was exhausted during combined removal verification");
      markPartial(
        "combined removal verification finished after the global runtime budget was exhausted; all removals were downgraded to keep-only"
      );
      return { completed: false };
    }

    return { completed: true, expectedTreeSha };
  } finally {
    await removeEvalWorktree(worktreePath, options.cwd);
  }
}

export function countCandidates(paths: string[]): number {
  return paths.filter((path) => isUnrelatedPath(path)).length;
}

// ── P0-3: pinned verification pipeline helpers ─────────────────────────────

interface VerificationStageResult {
  status: "passed" | "failed" | "not-run";
  commands: VerificationCommandRecord[];
  durationMs: number;
  /** True when configured attempts disagree in either order. */
  oscillated: boolean;
  detail?: string;
}

function resolveEffectiveTimeout(
  commandTimeoutMs: number | undefined,
  deadlineAt: number | undefined
): number | undefined {
  if (deadlineAt === undefined) {
    return commandTimeoutMs;
  }
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    return 1; // already expired: the command is not started below anyway
  }
  return commandTimeoutMs === undefined ? remaining : Math.min(commandTimeoutMs, remaining);
}

/**
 * Runs every required command in `cwd` with the shared safe runner semantics
 * (timeouts, retries), bounded by the global budget. Returns per-command
 * records for the evidence trail and an oscillation flag.
 */
export async function runVerificationStage(
  commands: string[],
  cwd: string,
  options: RunShrinkOptions,
  deadlineAt: number | undefined
): Promise<VerificationStageResult> {
  const records: VerificationCommandRecord[] = [];
  const startedAt = Date.now();
  let oscillated = false;
  const maxAttempts = 1 + (options.retryFlakyTests ?? 0);

  // P0 (transient-oracle fix): tracked-source identity is checked after EVERY
  // required command attempt. A command that mutates tracked source and is
  // later "restored" by the next command cannot hide the mutation — the
  // identity check happens per attempt, immediately after the command ran.
  // Snapshot failures are FAIL-CLOSED (unverifiable identity is treated like
  // an observed mutation), never best-effort.
  const snapshotIdentity = async (): Promise<string | undefined> => {
    try {
      await execFileAsync("git", ["add", "-u"], { cwd });
      return await writeTreeOf(cwd);
    } catch {
      return undefined;
    }
  };
  let identityFailure: string | undefined;
  const identityAtStart = await snapshotIdentity();
  if (identityAtStart === undefined) {
    identityFailure = "tracked-source identity could not be established before the required commands (tree snapshot failed); fail-closed";
  }

  outer: for (const command of commands) {
    if (identityFailure !== undefined) {
      records.push({ command, status: "not-run", durationMs: 0, attempts: 0 });
      continue;
    }
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      records.push({ command, status: "not-run", durationMs: 0, attempts: 0 });
      continue;
    }
    const attemptStartedAt = Date.now();
    let attempts = 0;
    let lastTimedOut = false;
    let lastExitCode: number | undefined;
    let passedOnce = false;
    let failedOnce = false;
    const attemptRecords: { exitCode: number; timedOut: boolean; durationMs: number }[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
        break;
      }
      attempts += 1;
      const singleStartedAt = Date.now();
      const result = await runCommand(command, cwd, {
        timeoutMs: resolveEffectiveTimeout(options.commandTimeoutMs, deadlineAt)
      });
      attemptRecords.push({
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: Date.now() - singleStartedAt
      });
      lastExitCode = result.exitCode;
      lastTimedOut = result.timedOut;
      if (result.exitCode === 0) {
        passedOnce = true;
      } else {
        failedOnce = true;
      }
      const identityAfter = await snapshotIdentity();
      if (identityAfter === undefined) {
        identityFailure =
          "tracked-source identity could not be verified after required command '" + command +
          "' (tree snapshot failed); fail-closed: source identity is mandatory";
      } else if (identityAfter !== identityAtStart) {
        identityFailure =
          "required command '" + command + "' altered tracked source (source-identity check changed); " +
          "a later restoring command cannot hide this mutation — fail-closed";
      }
      if (identityFailure !== undefined) {
        // REAL attempt evidence for the command that invalidated source: its
        // actual exit code, attempt count and duration are recorded (status
        // failed), and remaining commands get explicit not-run rows.
        records.push({
          command,
          status: "failed",
          durationMs: Date.now() - attemptStartedAt,
          attempts,
          exitCode: lastExitCode,
          timedOut: lastTimedOut,
          attemptRecords
        });
        continue outer;
      }
    }
    if (failedOnce && passedOnce) {
      oscillated = true;
    }
    const complete = attempts === maxAttempts;
    const passed = complete && passedOnce && !failedOnce;
    records.push({
      command,
      status: complete ? (passed ? "passed" : "failed") : "not-run",
      durationMs: Date.now() - attemptStartedAt,
      attempts,
      exitCode: lastExitCode,
      timedOut: lastTimedOut,
      attemptRecords
    });
  }

  const status = records.length > 0 && records.every((record) => record.status === "passed")
    ? "passed"
    : "failed";
  const notRun = records.some((record) => record.status === "not-run");
  return {
    status: (status === "passed" && !notRun && !oscillated && identityFailure === undefined) ? "passed" : "failed",
    commands: records,
    durationMs: Date.now() - startedAt,
    oscillated,
    detail: identityFailure !== undefined
      ? identityFailure
      : notRun
        ? "one or more required command attempts were not run because the budget was exhausted"
        : oscillated ? "INCONCLUSIVE: a required command produced conflicting pass/fail attempts" : undefined
  };
}

/** P0-3: baseline on a clean detached worktree at the pinned HEAD. */
async function runBaselineStage(
  options: RunShrinkOptions,
  headCommitSha: string,
  runEvalRoot: string,
  deadlineAt: number | undefined
): Promise<VerificationStageResult> {
  const baselineWorktree = join(runEvalRoot, "baseline");
  registerActiveWorktree(baselineWorktree, options.cwd);
  try {
    // P0-3 F4: the pinned HEAD tree is the reference the baseline must leave
    // intact — commands that rewrite tracked committed source cannot attest it.
    const headTreeSha = await treeOf(headCommitSha, options.cwd);
    await createEvalWorktree(baselineWorktree, headCommitSha, options.cwd);
    const stage = await runVerificationStage(options.requiredCommands, baselineWorktree, options, deadlineAt);
    // Retry contradictions fail closed at the baseline too: a flaky oracle
    // that failed and then passed proves nothing about the pinned HEAD.
    if (stage.oscillated) {
      return {
        ...stage,
        status: "failed",
        detail: "INCONCLUSIVE baseline: a required command produced conflicting pass/fail attempts; the pinned HEAD is not attested"
      };
    }
    await execFileAsync("git", ["add", "-u"], { cwd: baselineWorktree });
    if ((await writeTreeOf(baselineWorktree)) !== headTreeSha) {
      return {
        ...stage,
        status: "failed",
        detail: "required commands altered tracked committed source during baseline verification"
      };
    }
    return stage;
  } finally {
    await removeEvalWorktree(baselineWorktree, options.cwd);
  }
}

/**
 * P0-3: final artifact verification — the exact kept cleanup patch bytes are
 * applied with `git apply --index` onto a clean detached worktree at the
 * pinned BASE, the artifact tree must equal the expected HEAD-minus-removals
 * tree, and the full oracle runs on that exact artifact without altering
 * tracked source. Any failure downgrades all removals (caller) and blocks
 * delivery. Runs even when the removal set is empty.
 */
async function verifyFinalArtifact(params: {
  ctx: EvaluationContext;
  keptPatchPath: string;
  expectedTreeSha: string;
  deadlineAt: number | undefined;
  markPartial: (reason: string) => void;
}): Promise<VerificationStageEvidence> {
  const { ctx, keptPatchPath, expectedTreeSha, deadlineAt, markPartial } = params;
  const { options } = ctx;
  const baseCommitSha = ctx.pinnedBaseSha;
  const headCommitSha = ctx.pinnedHeadSha;

  const evidence = (
    over: Partial<VerificationStageEvidence>
  ): VerificationStageEvidence => ({
    stage: "final",
    status: "failed",
    commands: [],
    durationMs: 0,
    baseCommitSha,
    headCommitSha,
    expectedTreeSha,
    ...over
  });

  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    markPartial(
      "final artifact verification was not run because the global runtime budget was exhausted; nothing was automatically removed or delivered"
    );
    return evidence({ status: "not-run", detail: "not run: global runtime budget exhausted" });
  }

  const finalWorktree = join(ctx.runEvalRoot, "final-artifact");
  registerActiveWorktree(finalWorktree, options.cwd);
  const startedAt = Date.now();
  try {
    await createEvalWorktree(finalWorktree, baseCommitSha, options.cwd);

    let artifactTreeSha: string;
    if (keptPatchExistsEmpty(params)) {
      artifactTreeSha = await treeOf(baseCommitSha, options.cwd);
    } else {
      try {
        await execFileAsync("git", ["apply", "--index", keptPatchPath], { cwd: finalWorktree });
      } catch {
        const detail = "the kept cleanup patch could not be applied onto the pinned BASE";
        markPartial(`final artifact verification failed: ${detail}; all removals were downgraded to keep-only`);
        return evidence({ status: "failed", detail, durationMs: Date.now() - startedAt });
      }
      artifactTreeSha = await writeTreeOf(finalWorktree);
    }

    const treesMatch = artifactTreeSha === expectedTreeSha;
    if (!treesMatch) {
      const detail =
        `artifact tree mismatch: applying the kept cleanup patch onto the pinned BASE produced ` +
        `${artifactTreeSha} but the expected HEAD-minus-removals tree is ${expectedTreeSha}`;
      markPartial(`final artifact verification failed: ${detail}; all removals were downgraded to keep-only`);
      return evidence({ status: "failed", detail, artifactTreeSha, treesMatch, durationMs: Date.now() - startedAt });
    }

    const stage = await runVerificationStage(options.requiredCommands, finalWorktree, options, deadlineAt);
    if (stage.oscillated) {
      const detail =
        "INCONCLUSIVE: a required command produced conflicting pass/fail attempts; the final artifact is not attested";
      markPartial(`final artifact verification failed: ${detail}; all removals were downgraded to keep-only`);
      return evidence({
        status: "failed",
        detail,
        commands: stage.commands,
        durationMs: Date.now() - startedAt,
        artifactTreeSha,
        treesMatch
      });
    }
    if (stage.status !== "passed") {
      const failed = stage.commands.find((record) => record.status === "failed");
      const detail = failed?.timedOut
        ? `required command '${failed.command}' timed out on the final artifact`
        : `required command '${failed?.command ?? "(unknown)"}' failed on the final artifact`;
      markPartial(`final artifact verification failed: ${detail}; all removals were downgraded to keep-only`);
      return evidence({
        status: "failed",
        detail,
        commands: stage.commands,
        durationMs: Date.now() - startedAt,
        artifactTreeSha,
        treesMatch
      });
    }

    // The oracle validates the artifact — it must not rewrite tracked source.
    await execFileAsync("git", ["add", "-u"], { cwd: finalWorktree });
    if ((await writeTreeOf(finalWorktree)) !== artifactTreeSha) {
      const detail = "required commands altered tracked source in the final artifact worktree";
      markPartial(`final artifact verification failed: ${detail}; all removals were downgraded to keep-only`);
      return evidence({
        status: "failed",
        detail,
        commands: stage.commands,
        durationMs: Date.now() - startedAt,
        artifactTreeSha,
        treesMatch
      });
    }

    return evidence({
      status: "passed",
      commands: stage.commands,
      durationMs: Date.now() - startedAt,
      artifactTreeSha,
      treesMatch
    });
  } finally {
    await removeEvalWorktree(finalWorktree, options.cwd);
  }
}

function keptPatchExistsEmpty(params: { keptPatchPath: string }): boolean {
  // The caller passes the kept patch content indirectly; an empty patch means
  // the artifact IS the BASE tree. Reading the file keeps a single source of
  // truth for the exact bytes being verified.
  const content = readFileSync(params.keptPatchPath, "utf8");
  return content.trim().length === 0;
}

/**
 * P0-3 F7: reverses an applied cleanup patch and PROVES the rollback restored
 * the original state (index tree equals `initialTreeSha`, no user path left
 * dirty) before reporting success. Never resets, stashes or switches anything.
 * Exported for testing; used by the --apply delivery path.
 */
export async function rollbackAppliedCleanupPatch(
  cwd: string,
  patchPath: string,
  initialTreeSha: string,
  allowedUntrackedPrefixes: string[] = []
): Promise<{ rolledBack: boolean; detail?: string }> {
  try {
    await execFileAsync("git", ["apply", "-R", "--index", patchPath], { cwd });
  } catch (error) {
    return {
      rolledBack: false,
      detail: `reverse application failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  try {
    const restoredTree = await writeTreeOf(cwd);
    if (restoredTree !== initialTreeSha) {
      return {
        rolledBack: false,
        detail: `index tree ${restoredTree} still differs from the original ${initialTreeSha}`
      };
    }
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain", "-z", "--untracked-files=all"],
      { cwd, encoding: "buffer" }
    );
    const leftovers = parseStatusPorcelainZ(stdout).filter(
      (entry) =>
        !(
          entry.x === "?"
          && entry.y === "?"
          && isPathInsideAnyPrefix(entry.path, allowedUntrackedPrefixes)
        )
    );
    if (leftovers.length > 0) {
      return {
        rolledBack: false,
        detail: `${leftovers.length} path(s) are still dirty or untracked (e.g. '${leftovers[0]!.path}')`
      };
    }
    return { rolledBack: true };
  } catch (error) {
    return {
      rolledBack: false,
      detail: `rollback verification failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * P0-3: creates the cleanup branch from the pinned BASE, applies the exact
 * verified patch bytes, commits (hook/identity errors propagate), and proves
 * the DELIVERED commit tree equals the verified artifact tree — a commit hook
 * can amend the commit and restore the index afterwards, so the index alone
 * (write-tree) is not evidence of what was delivered. On ANY failure the
 * newly created ref and worktree are removed and the error rethrown; a
 * SUCCESSFUL worktree is unregistered from ephemeral cleanup so it remains
 * usable after the run returns.
 */
async function createCleanupBranch(params: {
  options: RunShrinkOptions;
  patchDir: string;
  baseCommitSha: string;
  runId: string;
  keptPatchPath: string;
  keptPatch: string;
  artifactTreeSha: string;
}): Promise<{ branch: string; worktree: string }> {
  const { options, patchDir, baseCommitSha, runId, keptPatchPath, keptPatch, artifactTreeSha } = params;
  const branch = `patchdiet/cleanup-${formatDateToken()}-${runId.slice(0, 8)}`;
  const worktreeRoot = join(patchDir, "worktrees");
  assertRealDirectoryInside(patchDir, worktreeRoot, ".patchdiet/worktrees directory");
  mkdirSync(worktreeRoot, { recursive: true });
  const worktree = join(worktreeRoot, branch.replaceAll("/", "-"));
  registerActiveWorktree(worktree, options.cwd);

  try {
    await runGit(["worktree", "add", worktree, "-b", branch, baseCommitSha], options.cwd);
    if (keptPatch.trim().length > 0) {
      await execFileAsync("git", ["apply", "--index", keptPatchPath], { cwd: worktree });
      const staged = (await execFileAsync("git", ["status", "--porcelain"], { cwd: worktree })).stdout;
      if (staged.trim().length > 0) {
        // Commit errors (hooks, identity, ...) are surfaced, never swallowed.
        await runGit(["commit", "-m", "chore: patchdiet cleanup patch"], worktree);
      }
    }
    // P0-3 F8: the actual delivered HEAD^{tree} is authoritative — not the
    // index. A hook may amend the commit (changing the delivered tree) and
    // then restore the index to the artifact tree to spoof an index check.
    const deliveredTree = (await execFileAsync("git", ["rev-parse", "HEAD^{tree}"], { cwd: worktree })).stdout.trim();
    if (deliveredTree !== artifactTreeSha) {
      throw new Error(
        "ERROR: cleanup branch delivered tree does not match the verified artifact tree; " +
        `delivered ${deliveredTree}, expected ${artifactTreeSha}. Refusing to report the branch.`
      );
    }
    // Success: the caller owns this worktree now — it must survive signal
    // handlers and later ephemeral cleanup.
    unregisterActiveWorktree(worktree);
    return { branch, worktree };
  } catch (error) {
    await removeEvalWorktree(worktree, options.cwd);
    try {
      await execFileAsync("git", ["branch", "-D", branch], { cwd: options.cwd });
    } catch {
      // The branch may never have been created; the original error is rethrown.
    }
    throw error;
  }
}

/**
 * P0-3 F3: parses `git status --porcelain -z` output robustly: NUL-separated
 * entries never break on quoted/unicode/space paths, and rename/copy entries
 * carry a second NUL-separated original-path token that must be consumed.
 */
export function parseStatusPorcelainZ(raw: Buffer | string): { x: string; y: string; path: string }[] {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  const tokens = text.split("\0");
  const entries: { x: string; y: string; path: string }[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token.length < 4) {
      continue; // "XY path" minimum; the trailing NUL yields an empty token.
    }
    const x = token[0]!;
    const y = token[1]!;
    const path = token.slice(3);
    entries.push({ x, y, path });
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      index += 1; // Skip the original-path token of a rename/copy entry.
    }
  }
  return entries;
}

/**
 * P0-3 F3: precise run-owned allowlist matching. Only EXACT run-created paths
 * (the run's UUID eval root and known emitted artifact files) may be exempt
 * from the cleanliness requirement — never a blanket directory prefix like
 * all of .patchdiet/**, which would hide user content placed there.
 */
export function isPathInsideAnyPrefix(candidate: string, prefixes: string[]): boolean {
  const normalized = candidate.replaceAll("\\", "/");
  return prefixes.some((prefix) => {
    const p = prefix.replaceAll("\\", "/").replace(/\/+$/, "");
    return normalized === p || normalized.startsWith(`${p}/`);
  });
}

/**
 * P0-3 F3: the EXACT set of artifact files PatchDiet emits under .patchdiet.
 * These (plus the run's own UUID eval root) are the only untracked paths
 * exempt from the --apply cleanliness requirement — a precise allowlist, never
 * a blanket .patchdiet/** prefix, so arbitrary user files placed there (e.g.
 * .patchdiet/user-note.txt) always block delivery.
 */
const PATCHDIET_OUTPUT_ALLOWLIST = [
  ".patchdiet/report.md",
  ".patchdiet/report.github.md",
  ".patchdiet/report.html",
  ".patchdiet/run.json",
  ".patchdiet/cleanup.diff"
];

/**
 * P0-3 F3: strict --apply preconditions. The live checkout must have NO dirty,
 * staged or untracked user paths — tracked modifications count even under
 * .patchdiet/** (that directory may contain tracked user source), and
 * UNTRACKED user content under .patchdiet counts too: only the precise
 * run-owned allowlist (`allowedUntrackedPrefixes`, e.g. this run's UUID eval
 * root and the cleanup.diff this run emitted) is exempt. The live HEAD must
 * be the pinned BASE. PatchDiet never switches, resets or stashes the
 * caller's checkout.
 */
async function assertLiveCheckoutReadyForApply(
  cwd: string,
  baseCommitSha: string,
  allowedUntrackedPrefixes: string[] = []
): Promise<void> {
  let statusRaw: Buffer;
  try {
    ({ stdout: statusRaw } = await execFileAsync(
      "git",
      ["status", "--porcelain", "-z", "--untracked-files=all"],
      { cwd, encoding: "buffer" }
    ));
  } catch {
    throw new Error("ERROR: --apply requires a usable git repository.");
  }
  const entries = parseStatusPorcelainZ(statusRaw);
  const foreign = entries.filter(
    (entry) =>
      !(
        entry.x === "?"
        && entry.y === "?"
        && isPathInsideAnyPrefix(entry.path, allowedUntrackedPrefixes)
      )
  );
  if (foreign.length > 0) {
    throw new Error(
      `ERROR: --apply requires a clean live checkout, but ${foreign.length} user path(s) are dirty, ` +
      `staged or untracked (e.g. '${foreign[0]!.path}'). This includes TRACKED and untracked ` +
      "files under .patchdiet/** that this run did not create. Commit or remove them first; " +
      "PatchDiet will not touch them."
    );
  }
  const liveHead = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
  if (liveHead !== baseCommitSha) {
    throw new Error(
      `ERROR: --apply requires the live checkout at the pinned BASE ${baseCommitSha}, but HEAD is ${liveHead}. ` +
      "Check out the BASE commit yourself; PatchDiet never switches or resets your checkout."
    );
  }
}

/** P0-3: strict ref resolution — an unresolvable ref is a hard error, never undefined. */
async function resolveCommitShaStrict(ref: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
      { cwd }
    );
    const sha = stdout.trim();
    if (/^[0-9a-f]{40}$/i.test(sha)) {
      return sha;
    }
  } catch {
    // Fall through to the fail-closed error.
  }
  throw new Error(
    `ERROR: could not resolve ref '${ref}' to a commit in ${cwd}. ` +
    "PatchDiet refuses to attest a diff against an unresolvable ref."
  );
}

async function resolveMergeBaseSha(a: string, b: string, cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["merge-base", a, b], { cwd });
  return stdout.trim();
}

/**
 * P0-3 F3: lstat-based existence — unlike existsSync this sees dangling
 * symlinks, which must never be treated as "absent" before writing through
 * them. Errors other than ENOENT fail closed.
 */
function lstatPathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function treeOf(commitSha: string, cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", `${commitSha}^{tree}`], { cwd });
  return stdout.trim();
}

export async function writeTreeOf(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["write-tree"], { cwd });
  return stdout.trim();
}

async function evaluateFileCandidate(
  file: DiffFile,
  ctx: EvaluationContext
): Promise<Omit<HunkEvaluation, "hunk" | "index"> | undefined> {
  const result = await evaluatePatchCandidate(ctx, {
    filePath: file.path,
    patchName: `${sanitizeSegment(file.path)}-file`,
    // P0-2: serialize with the file's original metadata (new-file mode, index,
    // rename headers) so reversing a whole-file removal has the intended git
    // semantics (truly deleting new files, restoring modes).
    patch: serializeUnifiedDiff({ files: [file] }),
    unit: "file"
  });

  return result
    ? {
        filePath: file.path,
        verdict: result.verdict,
        reason: result.reason,
        category: classifyCandidate(file.path, file.hunks)
      }
    : undefined;
}

async function evaluateHunkCandidate(
  file: DiffFile,
  hunk: DiffHunk,
  index: number,
  ctx: EvaluationContext
): Promise<HunkEvaluation> {
  const filePath = file.path;
  const result = await evaluatePatchCandidate(ctx, {
    filePath,
    patchName: `${sanitizeSegment(filePath)}-${index}`,
    patch: serializeUnifiedDiff({ files: [{ ...file, hunks: [hunk] }] }),
    unit: "hunk"
  });

  if (!result) {
    return {
      filePath,
      hunk,
      index,
      verdict: "needs-human-review",
      reason: "candidate could not be evaluated in a temporary worktree",
      category: classifyCandidate(filePath, [hunk])
    };
  }

  return {
    filePath,
    hunk,
    index,
    verdict: result.verdict,
    reason: result.reason,
    category: classifyCandidate(filePath, [hunk])
  };
}

/**
 * v2 targeted-first controls: run the mapped test commands for the given
 * changed files inside a trial worktree where a candidate removal has ALREADY
 * been applied. Executed BEFORE the trial's full required oracle; a targeted
 * failure may only REJECT the candidate — the full oracle always still runs.
 *
 * Outcomes:
 * - "passed": no mapping for these files (not "used") or all commands exited 0;
 * - "failed": a mapped command exited non-zero or timed out — the candidate
 *   must be rejected;
 * - "unverifiable": fail-closed — a tracked-source tree snapshot could not be
 *   taken, or the commands mutated tracked source, or the budget ran out
 *   mid-screening. The caller treats the trial as inconclusive.
 */
export async function runTargetedCommandsForTrial(
  ctx: EvaluationContext,
  worktreePath: string,
  changedFilePaths: readonly string[]
): Promise<"passed" | "failed" | "unverifiable"> {
  const plan = ctx.targeted;
  if (!ctx.options.targetedFirst || !plan) {
    return "passed"; // targeted-first disabled or no mapping supplied: stage is not "used"
  }
  const commands = [
    ...new Set(changedFilePaths.flatMap((filePath) => plan.mappings[filePath] ?? []))
  ].sort();
  if (commands.length === 0) {
    return "passed";
  }
  // Source-identity snapshots are MANDATORY: a failure here is fail-closed,
  // never best-effort — an unverifiable trial cannot pass.
  const snapshot = async (): Promise<string | undefined> => {
    try {
      await execFileAsync("git", ["add", "-u"], { cwd: worktreePath });
      return await writeTreeOf(worktreePath);
    } catch {
      return undefined;
    }
  };
  const treeBefore = await snapshot();
  if (treeBefore === undefined) {
    return "unverifiable";
  }
  for (const command of commands) {
    if (ctx.deadlineAt !== undefined && Date.now() >= ctx.deadlineAt) {
      return "unverifiable";
    }
    const result = await runCommand(command, worktreePath, { timeoutMs: ctx.options.commandTimeoutMs });
    ctx.targetedUsage.executed.push(command);
    if (result.exitCode !== 0) {
      ctx.targetedUsage.failedTrials += 1;
      return "failed";
    }
    const treeAfter = await snapshot();
    if (treeAfter === undefined || treeAfter !== treeBefore) {
      // A targeted command mutated tracked source (or identity cannot be
      // checked): fail closed — the removal state is not trustworthy.
      ctx.targetedUsage.failedTrials += 1;
      return "unverifiable";
    }
  }
  return "passed";
}

async function evaluatePatchCandidate(
  ctx: EvaluationContext,
  candidate: {
    filePath: string;
    patchName: string;
    patch: string;
    unit: "file" | "hunk";
  }
): Promise<{ verdict: CandidateVerdict; reason: string } | undefined> {
  const { options } = ctx;

  // H8: once the global runtime budget is exhausted, do not start new candidate
  // evaluations. Already-completed verdicts are kept; unverified candidates are
  // never guessed — they go to human review and the report is marked partial.
  if (ctx.deadlineAt !== undefined && Date.now() >= ctx.deadlineAt) {
    ctx.budgetSkips.count += 1;
    return {
      verdict: "needs-human-review",
      reason: `not evaluated because the global runtime budget (${ctx.budgetLabel}) was exhausted; requires human review`
    };
  }

  const safeName = candidate.patchName;
  const worktreePath = join(ctx.runEvalRoot, safeName);
  const candidatePatchPath = join(ctx.runEvalRoot, `${safeName}.diff`);
  writeFileSync(candidatePatchPath, candidate.patch, ctx.patchEncoding);
  registerActiveWorktree(worktreePath, options.cwd);

  try {
    await createEvalWorktree(worktreePath, ctx.pinnedHeadSha, options.cwd);

    try {
      await execFileAsync("git", ["apply", "-R", candidatePatchPath], { cwd: worktreePath });
    } catch {
      return {
        verdict: "needs-human-review",
        reason: `${candidate.unit} reverse apply failed in temporary worktree`
      };
    }

    // v2 targeted-first: mapped tests for this candidate's file run on the
    // ACTUAL removal state, before the full required oracle. A failure only
    // rejects this candidate; the required oracle below still runs for every
    // kept candidate and the combined/final verification is unchanged.
    const targeted = await runTargetedCommandsForTrial(ctx, worktreePath, [candidate.filePath]);
    if (targeted === "failed") {
      return {
        verdict: "kept",
        reason: `kept because targeted mapped tests failed after reverting this ${candidate.unit} ` +
          "(targeted screening rejects the candidate; the full required oracle remains authoritative)"
      };
    }
    if (targeted === "unverifiable") {
      return {
        verdict: "needs-human-review",
        reason: `targeted mapped tests could not be verified after reverting this ${candidate.unit} ` +
          "(source identity or runtime budget conflict); requires human review"
      };
    }

    // P0 transient-oracle fix: per-command tracked-source identity checks —
    // a required command that mutates source and a later one that restores it
    // cannot hide the mutation. Snapshot failures are fail-closed.
    const snapshotIdentity = async (): Promise<string | undefined> => {
      try {
        await execFileAsync("git", ["add", "-u"], { cwd: worktreePath });
        return await writeTreeOf(worktreePath);
      } catch {
        return undefined;
      }
    };
    const identityAtStart = await snapshotIdentity();
    if (identityAtStart === undefined) {
      return {
        verdict: "needs-human-review",
        reason: `tracked-source identity could not be established after reverting this ${candidate.unit} (tree snapshot failed); fail-closed`
      };
    }
    for (const command of options.requiredCommands) {
      const result = await runCommand(command, worktreePath, { timeoutMs: options.commandTimeoutMs });
      if (result.exitCode !== 0) {
        return {
          verdict: "kept",
          reason: result.timedOut
            ? `kept because '${command}' timed out after reverting this ${candidate.unit}`
            : `kept because '${command}' failed after reverting this ${candidate.unit}`
        };
      }
      const identityAfter = await snapshotIdentity();
      if (identityAfter === undefined || identityAfter !== identityAtStart) {
        return {
          verdict: "needs-human-review",
          reason:
            identityAfter === undefined
              ? `tracked-source identity could not be verified after '${command}' (tree snapshot failed); this ${candidate.unit} requires human review`
              : `required command '${command}' altered tracked source after reverting this ${candidate.unit}; a later restoring command cannot hide the mutation — requires human review`
        };
      }
    }

    return {
      verdict: "removed",
      reason: `removed because checks still passed after reverting this ${candidate.unit}`
    };
  } finally {
    await removeEvalWorktree(worktreePath, options.cwd);
  }
}

/** True when every changed line pair in the hunk differs only in whitespace. */
function isFormatOnlyHunk(hunk: DiffHunk): boolean {
  const removes = hunk.lines.filter((line) => line.kind === "remove");
  const adds = hunk.lines.filter((line) => line.kind === "add");
  if (removes.length === 0 || adds.length === 0 || removes.length !== adds.length) {
    return false;
  }
  const normalize = (text: string): string => text.replace(/\s+/g, "");
  return removes.every((remove, position) => normalize(remove.text) === normalize(adds[position]?.text ?? ""));
}

/** P0-1: rejects an empty oracle or any blank command before the run starts. */
function validateRequiredCommands(requiredCommands: string[]): void {
  if (requiredCommands.length === 0) {
    throw new Error(
      "ERROR: no required verification oracle configured.\n\n" +
      "Configure commands.required in patchdiet.yaml\n" +
      "or pass at least one --test command.\n\n" +
      "PatchDiet will not label an automatic cleanup as verified\n" +
      "without a verification oracle."
    );
  }
  for (let index = 0; index < requiredCommands.length; index += 1) {
    const command = requiredCommands[index] ?? "";
    if (command.trim().length === 0) {
      throw new Error(
        `required verification command at index ${index} is empty or blank ('${command}'); ` +
        "PatchDiet will not produce a verified cleanup without a real verification oracle."
      );
    }
  }
}

/**
 * Runs `worker` over `items` with at most `limit` outstanding promises. The
 * single-threaded event loop makes the shared cursor race-free; each worker
 * picks its next item synchronously before its first await.
 */
async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;
  const runners: Promise<void>[] = [];
  for (let slot = 0; slot < effectiveLimit; slot += 1) {
    runners.push((async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index]!);
      }
    })());
  }
  await Promise.all(runners);
}

interface ResolvedBudgets {
  maxRuntimeMs?: number;
  maxParallelWorktrees: number;
}

/**
 * H8: resolves the global runtime budget and the eval worktree pool size.
 * Explicit runShrink options win; otherwise the values come from the target
 * repository's patchdiet.yaml (`reduction.max_runtime_minutes`,
 * `performance.max_parallel_worktrees`), falling back to the documented
 * defaults when the file is absent or invalid.
 */
function resolveBudgets(options: RunShrinkOptions): ResolvedBudgets {
  let maxRuntimeMs = options.maxRuntimeMs;
  let maxParallelWorktrees = options.maxParallelWorktrees;

  if (maxRuntimeMs === undefined || maxParallelWorktrees === undefined) {
    let configured;
    try {
      configured = loadPatchDietConfig(options.cwd);
    } catch (error) {
      // An invalid patchdiet.yaml must not crash the run here — the CLI
      // surfaces the validation error on its own load. The engine falls back
      // to the safe defaults instead of guessing the user's intent.
      process.stderr.write(
        `[patchdiet] warning: ignoring invalid patchdiet.yaml for runtime budgets ` +
        `(${error instanceof Error ? error.message : String(error)})\n`
      );
      configured = createPresetConfig();
    }
    if (maxRuntimeMs === undefined) {
      maxRuntimeMs = configured.reduction.maxRuntimeMinutes * 60_000;
    }
    if (maxParallelWorktrees === undefined) {
      maxParallelWorktrees = configured.performance.max_parallel_worktrees ?? 1;
    }
  }

  return {
    maxRuntimeMs: maxRuntimeMs !== undefined && maxRuntimeMs > 0 ? maxRuntimeMs : undefined,
    maxParallelWorktrees: Math.max(1, Math.floor(maxParallelWorktrees))
  };
}

function formatBudgetLabel(maxRuntimeMs: number): string {
  if (maxRuntimeMs >= 60_000 && maxRuntimeMs % 60_000 === 0) {
    return `${maxRuntimeMs / 60_000}m`;
  }
  if (maxRuntimeMs >= 1_000) {
    return `${Math.round(maxRuntimeMs / 1_000)}s`;
  }
  return `${maxRuntimeMs}ms`;
}

/**
 * M2: mirrors the `patchdiet doctor` working-tree check. A dirty tree means the
 * baseline ran against uncommitted content while candidates are evaluated in
 * clean head worktrees — verdicts can be misleading, so say so on stderr.
 * PatchDiet's own `.patchdiet` artifacts are ignored so a follow-up run in an
 * otherwise clean repository is not flagged for our leftovers. Never throws.
 */
async function warnIfWorkingTreeDirty(cwd: string): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd }));
  } catch {
    // Doctor owns the full diagnostics; never fail a run over a warning.
    return;
  }

  const dirtyPaths = stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3))
    .filter((path) => path !== ".patchdiet" && !path.startsWith(".patchdiet/"));

  if (dirtyPaths.length > 0) {
    process.stderr.write(
      `[patchdiet] warning: working tree is dirty (${dirtyPaths.length} path(s), e.g. ${dirtyPaths[0]}). ` +
      `The run attests only committed content: the baseline executes in a clean worktree at the pinned HEAD, ` +
      `so uncommitted user changes are neither verified nor cleaned up.\n`
    );
  }
}

let cachedPatchDietVersion: string | undefined;
let patchDietVersionResolved = false;

/**
 * L4: reads the PatchDiet version from package.json, walking up from this
 * module's directory. A package named exactly "patchdiet" (the product root)
 * wins; otherwise the nearest package.json with a version is used. Returns
 * undefined when no version can be determined — auditability must never break
 * a shrink run.
 */
export function readPatchDietVersion(): string | undefined {
  if (patchDietVersionResolved) {
    return cachedPatchDietVersion;
  }
  patchDietVersionResolved = true;

  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    let fallback: string | undefined;
    for (let depth = 0; depth < 12; depth += 1) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
          name?: string;
          version?: string;
        };
        if (typeof pkg.version === "string" && pkg.version.length > 0) {
          if (pkg.name === "patchdiet") {
            cachedPatchDietVersion = pkg.version;
            return cachedPatchDietVersion;
          }
          if (fallback === undefined) {
            fallback = pkg.version;
          }
        }
      } catch {
        // No package.json at this level — keep walking up.
      }
      const parent = dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    cachedPatchDietVersion = fallback;
  } catch {
    cachedPatchDietVersion = undefined;
  }
  return cachedPatchDietVersion;
}

export function getConservativeSkipEvaluation(
  file: DiffFile,
  options: RunShrinkOptions
): Omit<HunkEvaluation, "hunk" | "index"> | undefined {
  const category = classifyCandidate(file.path, file.hunks);

  if (file.hunks.some((hunk) => hunk.binary)) {
    return {
      filePath: file.path,
      verdict: "needs-human-review",
      reason: "binary diff requires human review",
      category
    };
  }

  // Rename/copy and delete hunks change file identity, not just content, so a
  // reverted patch can never prove they are safe to drop. Mode changes are
  // equally non-content: a reversed text patch does not restore them. This
  // covers plain file mode flips (old/new mode), new/deleted file mode lines,
  // index lines carrying a mode, and the special identities symlink (120000)
  // and gitlink/submodule (160000) which appear WITHOUT old/new mode headers.
  if (
    file.extendedHeaders?.some(
      (header) =>
        /^(?:old|new) mode \d+$/.test(header)
        || /(?:^|[\s.])(?:120000|160000)$/.test(header)
    )
  ) {
    return {
      filePath: file.path,
      verdict: "needs-human-review",
      reason: "mode changes (file/symlink/submodule bits) require human review",
      category
    };
  }

  if (file.isRename || file.isDelete) {
    return {
      filePath: file.path,
      verdict: "needs-human-review",
      reason: file.isRename
        ? "rename/copy hunks require human review"
        : "deleted files require human review",
      category
    };
  }

  if (matchesAnyPattern(file.path, options.protectPaths ?? [])) {
    return {
      filePath: file.path,
      verdict: "needs-human-review",
      reason: "protected path requires human review by safety policy",
      category
    };
  }

  if (options.dependencyManifestsHumanReview && isDependencyPath(file.path)) {
    return {
      filePath: file.path,
      verdict: "needs-human-review",
      reason: "dependency manifest or lockfile requires human review by safety policy",
      category
    };
  }

  if (matchesAnyPattern(file.path, options.ignorePaths ?? [])) {
    return {
      filePath: file.path,
      verdict: "kept",
      reason: "kept because path is ignored by config",
      category
    };
  }

  if (!options.allowTestFileRemoval && isTestPath(file.path)) {
    return {
      filePath: file.path,
      verdict: "kept",
      reason: "kept because changed test files require human review by default",
      category
    };
  }

  return undefined;
}

function sanitizeSegment(value: string): string {
  return value.replaceAll(/[\\/:\s]+/g, "-");
}

function isUnrelatedPath(path: string): boolean {
  return path === "README.md"
    || path.startsWith("docs/")
    || path.endsWith("unused.ts")
    || path.endsWith("notes.py")
    || path.endsWith("scratch.txt")
    || path.endsWith("theme.js");
}

export function classifyCandidate(filePath: string, hunks: DiffHunk[]): CandidateCategory {
  if (isDocsPath(filePath)) {
    return "docs-only";
  }

  if (isDependencyPath(filePath)) {
    return "dependency-related";
  }

  if (isGeneratedLikePath(filePath)) {
    return "generated-like";
  }

  if (isFormattingOnly(hunks)) {
    return "formatting-only";
  }

  return "unknown";
}

function isFormattingOnly(hunks: DiffHunk[]): boolean {
  const added = hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.kind === "add")
    .map((line) => normalizeWhitespace(line.text));
  const removed = hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.kind === "remove")
    .map((line) => normalizeWhitespace(line.text));

  if (added.length === 0 && removed.length === 0) {
    return false;
  }

  if (added.every((line) => line === "") && removed.every((line) => line === "")) {
    return true;
  }

  return added.length === removed.length
    && added.every((line, index) => line === removed[index]);
}

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, "");
}

function isDocsPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  return normalized === "readme.md"
    || normalized.startsWith("docs/")
    || normalized.endsWith(".md")
    || normalized.endsWith(".mdx")
    || normalized.endsWith(".txt");
}

function isDependencyPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const name = normalized.split("/").at(-1) ?? normalized;
  return name === "package.json"
    || name === "package-lock.json"
    || name === "pnpm-lock.yaml"
    || name === "yarn.lock"
    || name === "bun.lockb"
    || name === "requirements.txt"
    || name === "poetry.lock"
    || name === "pyproject.toml"
    || name === "go.mod"
    || name === "go.sum"
    || name === "cargo.toml"
    || name === "cargo.lock";
}

function isGeneratedLikePath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  return normalized.includes("/dist/")
    || normalized.startsWith("dist/")
    || normalized.includes("/build/")
    || normalized.startsWith("build/")
    || normalized.endsWith(".min.js")
    || normalized.endsWith(".generated.ts")
    || normalized.endsWith(".generated.js")
    || normalized.endsWith(".snap");
}

function isTestPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  return segments.includes("test")
    || segments.includes("tests")
    || segments.includes("__tests__")
    || normalized.endsWith(".test.js")
    || normalized.endsWith(".test.ts")
    || normalized.endsWith(".spec.js")
    || normalized.endsWith(".spec.ts")
    || normalized.startsWith("test_")
    || normalized.includes("/test_");
}

function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}

/**
 * Translates a glob pattern into a regular expression source in a single pass.
 *
 * A single pass matters: chained replaceAll steps re-scan text inserted by
 * earlier steps, so the optional-directory group emitted for a mid-pattern
 * globstar-slash token used to have its own star re-translated into a
 * single-segment wildcard — which silently limited that globstar to exactly
 * one directory level. The same applied to a bare question mark, which acted
 * as a regex quantifier for the preceding character instead of matching
 * exactly one non-slash character.
 */
function globToRegExpSource(pattern: string): string {
  let source = "";
  let index = 0;
  while (index < pattern.length) {
    const rest = pattern.slice(index);
    const special = rest.match(/^[.+^${}()|[\]\\]/);
    if (special) {
      source += `\\${special[0]}`;
      index += special[0].length;
      continue;
    }
    if (rest.startsWith("**/")) {
      // A mid-pattern globstar matches zero or more whole directories, so
      // e.g. "scripts/**/*.js" also matches "scripts/build.js".
      source += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (rest.startsWith("**")) {
      source += ".*";
      index += 2;
      continue;
    }
    if (rest.startsWith("*")) {
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (rest.startsWith("?")) {
      source += "[^/]";
      index += 1;
      continue;
    }
    source += rest[0];
    index += 1;
  }
  return source;
}

export function matchesPattern(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const normalizedPattern = pattern.replaceAll("\\", "/");

  if (normalizedPath === normalizedPattern) {
    return true;
  }

  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    // The literal-prefix shortcut cannot handle a globstar before the suffix
    // (for example **/migrations/**); let the general matcher expand it.
    if (!/[?*]/.test(prefix)) {
      return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
    }
  }

  return new RegExp(`^${globToRegExpSource(normalizedPattern)}$`).test(normalizedPath);
}

function formatDateToken(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${now.getUTCDate()}`.padStart(2, "0");
  const hour = `${now.getUTCHours()}`.padStart(2, "0");
  const minute = `${now.getUTCMinutes()}`.padStart(2, "0");
  const second = `${now.getUTCSeconds()}`.padStart(2, "0");
  return `${year}-${month}-${day}-${hour}${minute}${second}`;
}
