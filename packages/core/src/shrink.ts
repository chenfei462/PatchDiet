import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { renderMarkdownReport } from "../../report/src/index.js";
import { parseUnifiedDiff, summarizeDiff } from "./diff.js";
import { getDiff, runGit } from "./git.js";
import { runCommand } from "./runner.js";
import type { CandidateCategory, CandidateVerdict, DiffFile, DiffHunk, ShrinkReport } from "./types.js";

const execFileAsync = promisify(execFile);

export interface RunShrinkOptions {
  cwd: string;
  baseRef: string;
  headRef: string;
  requiredCommands: string[];
  createBranch?: boolean;
  apply?: boolean;
  dryRun?: boolean;
  ignorePaths?: string[];
  allowTestFileRemoval?: boolean;
  commandTimeoutMs?: number;
  retryFlakyTests?: number;
}

interface HunkEvaluation {
  filePath: string;
  hunk: DiffHunk;
  index: number;
  verdict: CandidateVerdict;
  reason: string;
  category: CandidateCategory;
}

export async function runShrink(
  options: RunShrinkOptions
): Promise<ShrinkReport> {
  const baseline = await runRequiredCommands(options.requiredCommands, options.cwd, options);

  const { diff } = await getDiff(options.cwd, options.baseRef, options.headRef);
  const parsed = parseUnifiedDiff(diff);
  const input = summarizeDiff(parsed);

  const patchDir = options.dryRun
    ? mkdtempSync(join(tmpdir(), "patchdiet-dry-run-"))
    : join(options.cwd, ".patchdiet");
  mkdirSync(patchDir, { recursive: true });

  const evaluations: HunkEvaluation[] = [];
  for (const file of parsed.files) {
    const skippedEvaluation = getConservativeSkipEvaluation(file, options);
    if (skippedEvaluation) {
      for (const [index, hunk] of file.hunks.entries()) {
        evaluations.push({ ...skippedEvaluation, hunk, index });
      }
      continue;
    }

    const fileEvaluation = await evaluateFileCandidate(file, options, patchDir);
    if (fileEvaluation?.verdict === "removed") {
      for (const [index, hunk] of file.hunks.entries()) {
        evaluations.push({ ...fileEvaluation, hunk, index });
      }
      continue;
    }

    for (const [index, hunk] of file.hunks.entries()) {
      evaluations.push(await evaluateHunkCandidate(file.path, hunk, index, options, patchDir));
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
  if (!options.dryRun) {
    writeFileSync(patchPath, keptPatch, "utf8");
  }

  const report: ShrinkReport = {
    baseRef: options.baseRef,
    headRef: options.headRef,
    input,
    output,
    testCommand: {
      command: options.requiredCommands.join(" && "),
      status: "passed",
      durationMs: baseline.durationMs,
      attempts: baseline.attempts
    },
    candidates: evaluations.map((evaluation) => ({
      filePath: evaluation.filePath,
      hunkHeader: evaluation.hunk.header,
      category: evaluation.category,
      verdict: evaluation.verdict,
      reason: evaluation.reason
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
    artifacts: [
      ".patchdiet/report.md",
      ".patchdiet/report.github.md",
      ".patchdiet/report.html",
      ".patchdiet/run.json",
      ".patchdiet/cleanup.diff"
    ],
    patchPath: options.dryRun ? undefined : patchPath
  };

  if (options.createBranch && !options.dryRun) {
    const cleanupBranch = `patchdiet/cleanup-${formatDateToken()}`;
    const worktreeRoot = join(patchDir, "worktrees");
    const cleanupWorktree = join(worktreeRoot, cleanupBranch.replaceAll("/", "-"));
    mkdirSync(worktreeRoot, { recursive: true });
    await runGit(["worktree", "add", cleanupWorktree, "-b", cleanupBranch, options.baseRef], options.cwd);
    if (keptPatch.trim().length > 0) {
      await runGit(["apply", patchPath], cleanupWorktree);
      await runGit(["add", "."], cleanupWorktree);
      try {
        await runGit(["commit", "-m", "chore: patchdiet cleanup patch"], cleanupWorktree);
      } catch {
        // Keep the cleanup worktree even when there is nothing commit-worthy.
      }
    }
    report.cleanupBranch = cleanupBranch;
    report.cleanupWorktreePath = cleanupWorktree;
  }

  if (options.apply && !options.dryRun) {
    await runGit(["apply", patchPath], options.cwd);
  }

  if (!options.dryRun) {
    const reportPath = join(patchDir, "report.md");
    writeFileSync(reportPath, renderMarkdownReport(report), "utf8");
    report.reportPath = reportPath;
    const reportJsonPath = join(patchDir, "run.json");
    writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf8");
    report.reportJsonPath = reportJsonPath;
  }

  if (options.dryRun) {
    rmSync(patchDir, { recursive: true, force: true });
  }

  return report;
}

export function countCandidates(paths: string[]): number {
  return paths.filter((path) => isUnrelatedPath(path)).length;
}

async function evaluateFileCandidate(
  file: DiffFile,
  options: RunShrinkOptions,
  patchDir: string
): Promise<Omit<HunkEvaluation, "hunk" | "index"> | undefined> {
  const result = await evaluatePatchCandidate({
    filePath: file.path,
    patchName: `${sanitizeSegment(file.path)}-file`,
    patch: serializePatch([file]),
    options,
    patchDir,
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
  filePath: string,
  hunk: DiffHunk,
  index: number,
  options: RunShrinkOptions,
  patchDir: string
): Promise<HunkEvaluation> {
  const result = await evaluatePatchCandidate({
    filePath,
    patchName: `${sanitizeSegment(filePath)}-${index}`,
    patch: serializePatch([{ path: filePath, hunks: [hunk] }]),
    options,
    patchDir,
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

async function evaluatePatchCandidate({
  filePath,
  patchName,
  patch,
  options,
  patchDir,
  unit
}: {
  filePath: string;
  patchName: string;
  patch: string;
  options: RunShrinkOptions;
  patchDir: string;
  unit: "file" | "hunk";
}): Promise<{ verdict: CandidateVerdict; reason: string } | undefined> {
  const evalRoot = join(patchDir, "eval");
  mkdirSync(evalRoot, { recursive: true });
  const safeName = patchName;
  const worktreePath = join(evalRoot, safeName);
  const candidatePatchPath = join(evalRoot, `${safeName}.diff`);
  writeFileSync(candidatePatchPath, patch, "utf8");

  try {
    await execFileAsync("git", ["worktree", "add", "--detach", worktreePath, options.headRef], {
      cwd: options.cwd
    });

    try {
      await execFileAsync("git", ["apply", "-R", candidatePatchPath], { cwd: worktreePath });
    } catch {
      return {
        verdict: "needs-human-review",
        reason: `${unit} reverse apply failed in temporary worktree`
      };
    }

    for (const command of options.requiredCommands) {
      const result = await runCommand(command, worktreePath, { timeoutMs: options.commandTimeoutMs });
      if (result.exitCode !== 0) {
        return {
          verdict: "kept",
          reason: result.timedOut
            ? `kept because '${command}' timed out after reverting this ${unit}`
            : `kept because '${command}' failed after reverting this ${unit}`
        };
      }
    }

    return {
      verdict: "removed",
      reason: `removed because checks still passed after reverting this ${unit}`
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

async function runRequiredCommands(
  commands: string[],
  cwd: string,
  options: RunShrinkOptions
): Promise<{ attempts: number; durationMs: number }> {
  const startedAt = Date.now();
  let attempts = 0;
  const maxAttempts = 1 + (options.retryFlakyTests ?? 0);

  for (const command of commands) {
    let passed = false;
    let lastTimedOut = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts += 1;
      const result = await runCommand(command, cwd, { timeoutMs: options.commandTimeoutMs });
      lastTimedOut = result.timedOut;
      if (result.exitCode === 0) {
        passed = true;
        break;
      }
    }

    if (!passed) {
      if (lastTimedOut && options.commandTimeoutMs) {
        throw new Error(`required command timed out after ${options.commandTimeoutMs}ms: ${command}`);
      }
      throw new Error(`required command failed: ${command}`);
    }
  }

  return {
    attempts,
    durationMs: Date.now() - startedAt
  };
}

function getConservativeSkipEvaluation(
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

function serializePatch(files: DiffFile[]): string {
  return files.map((file) => serializeFilePatch(file)).join("");
}

function serializeFilePatch(file: DiffFile): string {
  const serializableHunks = file.hunks.filter((hunk) => !hunk.binary);
  if (serializableHunks.length === 0) {
    return "";
  }

  const header = [
    `diff --git a/${file.path} b/${file.path}`,
    `--- a/${file.path}`,
    `+++ b/${file.path}`
  ];

  const hunks = serializableHunks.map((hunk) => {
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

function classifyCandidate(filePath: string, hunks: DiffHunk[]): CandidateCategory {
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
  return normalized === "package.json"
    || normalized === "package-lock.json"
    || normalized === "pnpm-lock.yaml"
    || normalized === "yarn.lock"
    || normalized === "bun.lockb"
    || normalized === "requirements.txt"
    || normalized === "poetry.lock"
    || normalized === "pyproject.toml"
    || normalized === "go.mod"
    || normalized === "go.sum"
    || normalized === "cargo.toml"
    || normalized === "cargo.lock";
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

function matchesPattern(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const normalizedPattern = pattern.replaceAll("\\", "/");

  if (normalizedPath === normalizedPattern) {
    return true;
  }

  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }

  const escaped = normalizedPattern
    .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", ".*")
    .replaceAll("*", "[^/]*");
  return new RegExp(`^${escaped}$`).test(normalizedPath);
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
