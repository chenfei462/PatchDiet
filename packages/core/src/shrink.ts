import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { renderMarkdownReport } from "../../report/src/index.js";
import { parseUnifiedDiff, summarizeDiff } from "./diff.js";
import { getDiff, runGit } from "./git.js";
import { runCommand } from "./runner.js";
import type { DiffFile, DiffHunk, EvidenceCategory, ShrinkReport } from "./types.js";

const execFileAsync = promisify(execFile);

export interface RunShrinkOptions {
  cwd: string;
  baseRef: string;
  headRef: string;
  requiredCommands: string[];
  optionalCommands?: string[];
  ignorePaths?: string[];
  maxRuntimeMinutes?: number;
  retryFlakyTests?: number;
  allowFormatOnlyRemoval?: boolean;
  flagDependencyBumps?: boolean;
  dryRun?: boolean;
  createBranch?: boolean;
  apply?: boolean;
}

interface HunkEvaluation {
  filePath: string;
  hunk: DiffHunk;
  index: number;
  verdict: "removed" | "kept" | "needs-human-review";
  reason: string;
  category: EvidenceCategory;
}

interface VerificationCommand {
  command: string;
  kind: "required" | "optional";
  baselinePassed: boolean;
}

export async function runShrink(
  options: RunShrinkOptions
): Promise<ShrinkReport> {
  const startedAt = Date.now();
  const commandOptions = {
    retries: options.retryFlakyTests ?? 0,
    maxOutputBytes: 16_384
  };

  const verificationCommands: VerificationCommand[] = [];
  for (const command of options.requiredCommands) {
    const result = await runCommand(command, options.cwd, {
      ...commandOptions,
      timeoutMs: remainingTimeoutMs(startedAt, options.maxRuntimeMinutes)
    });
    if (result.exitCode !== 0) {
      throw new Error(formatCommandFailure("required command failed", command, result));
    }
    verificationCommands.push({ command, kind: "required", baselinePassed: true });
  }

  for (const command of options.optionalCommands ?? []) {
    const result = await runCommand(command, options.cwd, {
      ...commandOptions,
      timeoutMs: remainingTimeoutMs(startedAt, options.maxRuntimeMinutes)
    });
    verificationCommands.push({ command, kind: "optional", baselinePassed: result.exitCode === 0 });
  }

  const { diff } = await getDiff(options.cwd, options.baseRef, options.headRef);
  const parsed = parseUnifiedDiff(diff);
  const input = summarizeDiff(parsed);

  const patchDir = join(options.cwd, ".patchdiet");
  mkdirSync(patchDir, { recursive: true });

  const evaluations: HunkEvaluation[] = [];
  for (const file of parsed.files) {
    if (matchesAnyPattern(file.path, options.ignorePaths ?? [])) {
      for (const [index, hunk] of file.hunks.entries()) {
        evaluations.push({
          filePath: file.path,
          hunk,
          index,
          verdict: "kept",
          reason: "ignored by scope.ignore_paths",
          category: "ignored-path"
        });
      }
      continue;
    }

    const fileEvaluation = file.hunks.length > 1
      ? await evaluateCandidate(file.path, file.hunks, -1, options, patchDir, verificationCommands, startedAt)
      : undefined;
    if (fileEvaluation?.verdict === "removed") {
      for (const [index, hunk] of file.hunks.entries()) {
        evaluations.push({
          ...fileEvaluation,
          hunk,
          index
        });
      }
      continue;
    }

    for (const [index, hunk] of file.hunks.entries()) {
      evaluations.push(
        await evaluateCandidate(file.path, [hunk], index, options, patchDir, verificationCommands, startedAt)
      );
    }
  }

  const keptFiles = parsed.files
    .map((file) => {
      const hunks = file.hunks.filter((_hunk, index) => {
        const evaluation = evaluations.find(
          (candidate) => candidate.filePath === file.path && candidate.index === index
        );
        return evaluation?.verdict !== "removed";
      });

      return {
        path: file.path,
        hunks
      };
    })
    .filter((file) => file.hunks.length > 0);

  const output = summarizeDiff({ files: keptFiles });
  const patchPath = join(patchDir, "cleanup.diff");
  const keptPatch = serializePatch(keptFiles);
  writeFileSync(patchPath, keptPatch, "utf8");

  const report: ShrinkReport = {
    baseRef: options.baseRef,
    input,
    output,
    removals: evaluations
      .filter((evaluation) => evaluation.verdict === "removed")
      .map((evaluation) => ({
        filePath: evaluation.filePath,
        hunkHeader: evaluation.hunk.header,
        reason: evaluation.reason,
        confidence: "high-confidence removal" as const,
        category: evaluation.category
      })),
    kept: evaluations
      .filter((evaluation) => evaluation.verdict === "kept")
      .map((evaluation) => ({
        filePath: evaluation.filePath,
        hunkHeader: evaluation.hunk.header,
        reason: evaluation.reason,
        confidence: "kept" as const,
        category: evaluation.category
      })),
    needsHumanReview: evaluations
      .filter((evaluation) => evaluation.verdict === "needs-human-review")
      .map((evaluation) => ({
        filePath: evaluation.filePath,
        hunkHeader: evaluation.hunk.header,
        reason: evaluation.reason,
        confidence: "needs-human-review" as const,
        category: evaluation.category
      })),
    patchPath
  };

  if (options.createBranch && !options.dryRun) {
    const cleanupBranch = `patchdiet/cleanup-${formatDateToken()}`;
    const worktreeRoot = join(patchDir, "worktrees");
    const cleanupWorktree = join(worktreeRoot, cleanupBranch.replaceAll("/", "-"));
    mkdirSync(worktreeRoot, { recursive: true });
    await runGit(["worktree", "add", cleanupWorktree, "-b", cleanupBranch, options.baseRef], options.cwd);
    await runGit(["apply", patchPath], cleanupWorktree);
    await runGit(["add", "."], cleanupWorktree);
    try {
      await runGit(["commit", "-m", "chore: patchdiet cleanup patch"], cleanupWorktree);
    } catch {
      // Keep the cleanup worktree even when there is nothing commit-worthy.
    }
    report.cleanupBranch = cleanupBranch;
    report.cleanupWorktreePath = cleanupWorktree;
  }

  if (options.apply && !options.dryRun) {
    await runGit(["apply", patchPath], options.cwd);
  }

  const reportPath = join(patchDir, "report.md");
  writeFileSync(reportPath, renderMarkdownReport(report), "utf8");
  report.reportPath = reportPath;
  const reportJsonPath = join(patchDir, "run.json");
  writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf8");
  report.reportJsonPath = reportJsonPath;

  return report;
}

export function countCandidates(paths: string[]): number {
  return paths.filter((path) => isUnrelatedPath(path)).length;
}

async function evaluateCandidate(
  filePath: string,
  hunks: DiffHunk[],
  index: number,
  options: RunShrinkOptions,
  patchDir: string,
  verificationCommands: VerificationCommand[],
  startedAt: number
): Promise<HunkEvaluation> {
  const hunk = hunks[0];
  if (!hunk) {
    throw new Error(`cannot evaluate empty hunk candidate for ${filePath}`);
  }

  if ((options.flagDependencyBumps ?? true) && isDependencyPath(filePath)) {
    return {
      filePath,
      hunk,
      index,
      verdict: "needs-human-review",
      reason: "dependency change needs human review before automatic removal",
      category: "dependency-bump"
    };
  }

  const evalRoot = join(patchDir, "eval");
  mkdirSync(evalRoot, { recursive: true });
  const safeName = `${sanitizeSegment(filePath)}-${index < 0 ? "file" : index}`;
  const worktreePath = join(evalRoot, safeName);
  const candidatePatchPath = join(evalRoot, `${safeName}.diff`);
  writeFileSync(candidatePatchPath, serializePatch([{ path: filePath, hunks }]), "utf8");

  try {
    await execFileAsync("git", ["worktree", "add", "--detach", worktreePath, options.headRef], {
      cwd: options.cwd
    });

    try {
      await execFileAsync("git", ["apply", "-R", candidatePatchPath], { cwd: worktreePath });
    } catch {
      return {
        filePath,
        hunk,
        index,
        verdict: "needs-human-review",
        reason: "reverse apply failed in temporary worktree",
        category: "reverse-apply-failed"
      };
    }

    for (const { command, kind, baselinePassed } of verificationCommands) {
      if (kind === "optional" && !baselinePassed) {
        continue;
      }

      const result = await runCommand(command, worktreePath, {
        retries: options.retryFlakyTests ?? 0,
        maxOutputBytes: 16_384,
        timeoutMs: remainingTimeoutMs(startedAt, options.maxRuntimeMinutes)
      });
      if (result.exitCode !== 0) {
        return {
          filePath,
          hunk,
          index,
          verdict: "kept",
          reason: `${kind === "optional" ? "optional check" : "required check"} '${command}' failed after revert`,
          category: "required-by-check"
        };
      }
    }

    const category = classifyRemoval(filePath, hunks, options);
    return {
      filePath,
      hunk,
      index,
      verdict: "removed",
      reason: `${removalReason(category)}; checks still passed after reverting ${index < 0 ? "this file" : "this hunk"}`,
      category
    };
  } finally {
    try {
      await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"], {
        cwd: options.cwd
      });
    } catch {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }
}

function serializePatch(files: DiffFile[]): string {
  return files.map((file) => serializeFilePatch(file)).join("");
}

function serializeFilePatch(file: DiffFile): string {
  const isNewFile = file.oldPath === "/dev/null" || file.hunks.every((hunk) => hunk.header.includes("-0,0"));
  const isDeletedFile = file.newPath === "/dev/null";
  const header = [
    `diff --git a/${file.path} b/${file.path}`,
    ...(isNewFile ? ["new file mode 100644"] : []),
    ...(isDeletedFile ? ["deleted file mode 100644"] : []),
    isNewFile ? "--- /dev/null" : `--- a/${file.path}`,
    isDeletedFile ? "+++ /dev/null" : `+++ b/${file.path}`
  ];

  const hunks = file.hunks.map((hunk) => {
    const body = hunk.lines.map((line) => {
      switch (line.kind) {
        case "add":
          return `+${line.text}`;
        case "remove":
          return `-${line.text}`;
        default:
          return ` ${line.text}`;
      }
    });

    return [hunk.header, ...body].join("\n");
  });

  return `${[...header, ...hunks].join("\n")}\n`;
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

function isDependencyPath(path: string): boolean {
  return path === "package.json"
    || path === "package-lock.json"
    || path === "pnpm-lock.yaml"
    || path === "yarn.lock"
    || path === "bun.lockb"
    || path.endsWith("/package.json")
    || path.endsWith("/package-lock.json");
}

function classifyRemoval(filePath: string, hunks: DiffHunk[], options: RunShrinkOptions): EvidenceCategory {
  if ((options.allowFormatOnlyRemoval ?? true) && hunks.every(isFormattingOnlyHunk)) {
    return "formatting-only";
  }

  if (isDocsOrCommentOnly(filePath, hunks)) {
    return "docs-comment-only";
  }

  if (isUnrelatedPath(filePath)) {
    return "unrelated-path";
  }

  return "unrelated-path";
}

function isFormattingOnlyHunk(hunk: DiffHunk): boolean {
  const removed = hunk.lines
    .filter((line) => line.kind === "remove")
    .map((line) => line.text.replaceAll(/\s+/g, ""));
  const added = hunk.lines
    .filter((line) => line.kind === "add")
    .map((line) => line.text.replaceAll(/\s+/g, ""));

  return removed.length > 0
    && added.length > 0
    && removed.join("\n") === added.join("\n");
}

function isDocsOrCommentOnly(filePath: string, hunks: DiffHunk[]): boolean {
  if (filePath.startsWith("docs/") || filePath.endsWith(".md")) {
    return true;
  }

  const changedLines = hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.kind === "add" || line.kind === "remove")
    .map((line) => line.text.trim())
    .filter((line) => line.length > 0);

  return changedLines.length > 0
    && changedLines.every((line) => line.startsWith("//") || line.startsWith("#") || line.startsWith("*"));
}

function removalReason(category: EvidenceCategory): string {
  switch (category) {
    case "formatting-only":
      return "formatting-only changes";
    case "docs-comment-only":
      return "docs/comment-only changes";
    case "unrelated-path":
      return "unrelated path candidate";
    default:
      return "not required by configured checks";
  }
}

function matchesAnyPattern(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(path, pattern));
}

function matchesPattern(path: string, pattern: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  if (normalizedPattern.startsWith("**/") && matchesPattern(path, normalizedPattern.slice(3))) {
    return true;
  }

  const escaped = normalizedPattern
    .replaceAll("\\", "/")
    .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`).test(path.replaceAll("\\", "/"));
}

function remainingTimeoutMs(startedAt: number, maxRuntimeMinutes?: number): number | undefined {
  if (!maxRuntimeMinutes) {
    return undefined;
  }

  const budget = maxRuntimeMinutes * 60_000;
  return Math.max(1, budget - (Date.now() - startedAt));
}

function formatCommandFailure(
  prefix: string,
  command: string,
  result: { exitCode: number; stdout: string; stderr: string; attempts: number; timedOut: boolean }
): string {
  const reason = result.timedOut ? "timed out" : `exited ${result.exitCode}`;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return `${prefix}: ${command} (${reason} after ${result.attempts} attempt${result.attempts === 1 ? "" : "s"})${output ? `\n${output}` : ""}`;
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
