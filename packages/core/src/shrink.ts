import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { renderMarkdownReport } from "../../report/src/index.js";
import { parseUnifiedDiff, summarizeDiff } from "./diff.js";
import { getDiff, runGit } from "./git.js";
import { runCommand } from "./runner.js";
import type { DiffFile, DiffHunk, ShrinkReport } from "./types.js";

const execFileAsync = promisify(execFile);

export interface RunShrinkOptions {
  cwd: string;
  baseRef: string;
  headRef: string;
  requiredCommands: string[];
  createBranch?: boolean;
  apply?: boolean;
}

interface HunkEvaluation {
  filePath: string;
  hunk: DiffHunk;
  index: number;
  verdict: "removed" | "kept" | "needs-human-review";
  reason: string;
}

export async function runShrink(
  options: RunShrinkOptions
): Promise<ShrinkReport> {
  for (const command of options.requiredCommands) {
    const result = await runCommand(command, options.cwd);
    if (result.exitCode !== 0) {
      throw new Error(`required command failed: ${command}`);
    }
  }

  const { diff } = await getDiff(options.cwd, options.baseRef, options.headRef);
  const parsed = parseUnifiedDiff(diff);
  const input = summarizeDiff(parsed);

  const patchDir = join(options.cwd, ".patchdiet");
  mkdirSync(patchDir, { recursive: true });

  const evaluations: HunkEvaluation[] = [];
  for (const file of parsed.files) {
    for (const [index, hunk] of file.hunks.entries()) {
      evaluations.push(await evaluateCandidate(file.path, hunk, index, options, patchDir));
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
        confidence: "high-confidence removal" as const
      })),
    kept: evaluations
      .filter((evaluation) => evaluation.verdict === "kept")
      .map((evaluation) => ({
        filePath: evaluation.filePath,
        hunkHeader: evaluation.hunk.header,
        reason: evaluation.reason,
        confidence: "kept" as const
      })),
    needsHumanReview: evaluations
      .filter((evaluation) => evaluation.verdict === "needs-human-review")
      .map((evaluation) => ({
        filePath: evaluation.filePath,
        hunkHeader: evaluation.hunk.header,
        reason: evaluation.reason,
        confidence: "needs-human-review" as const
      })),
    patchPath
  };

  if (options.createBranch) {
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

  if (options.apply) {
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
  hunk: DiffHunk,
  index: number,
  options: RunShrinkOptions,
  patchDir: string
): Promise<HunkEvaluation> {
  const evalRoot = join(patchDir, "eval");
  mkdirSync(evalRoot, { recursive: true });
  const safeName = `${sanitizeSegment(filePath)}-${index}`;
  const worktreePath = join(evalRoot, safeName);
  const candidatePatchPath = join(evalRoot, `${safeName}.diff`);
  writeFileSync(candidatePatchPath, serializePatch([{ path: filePath, hunks: [hunk] }]), "utf8");

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
        reason: "reverse apply failed in temporary worktree"
      };
    }

    for (const command of options.requiredCommands) {
      const result = await runCommand(command, worktreePath);
      if (result.exitCode !== 0) {
        return {
          filePath,
          hunk,
          index,
          verdict: "kept",
          reason: `required because '${command}' failed after revert`
        };
      }
    }

    return {
      filePath,
      hunk,
      index,
      verdict: "removed",
      reason: "checks still passed after reverting this hunk"
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
  const header = [
    `diff --git a/${file.path} b/${file.path}`,
    `--- a/${file.path}`,
    `+++ b/${file.path}`
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
