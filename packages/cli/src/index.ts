#!/usr/bin/env node

import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Command } from "commander";

import { loadPatchDietConfig, mergeConfigWithFlags } from "../../core/src/config.js";
import { parseUnifiedDiff, summarizeDiff } from "../../core/src/diff.js";
import { getDiff } from "../../core/src/git.js";
import { renderGitHubComment, renderHtmlReport, renderMarkdownReport } from "../../report/src/index.js";
import { countCandidates, runShrink } from "../../core/src/shrink.js";
import type { ShrinkReport } from "../../core/src/types.js";

const execFileAsync = promisify(execFile);
const program = new Command();
const targetCwd = process.env.PATCHDIET_TARGET_CWD
  ? resolve(process.env.PATCHDIET_TARGET_CWD)
  : process.cwd();

program.name("patchdiet").description("Shrink AI-generated pull requests into smaller reviewable patches.");

program
  .command("init")
  .description("create patchdiet.yaml in the current directory")
  .action(() => {
    const configPath = join(process.cwd(), "patchdiet.yaml");
    if (!existsSync(configPath)) {
      writeFileSync(
        configPath,
        [
          "version: 1",
          "base: origin/main",
          "commands:",
          "  required: []",
          "  optional: []",
          "reduction:",
          "  strategy: conservative",
          "  atom_granularity: hunk",
          "  max_runtime_minutes: 20",
          "  retry_flaky_tests: 2",
          "scope:",
          "  ignore_paths: []",
          "report:",
          "  html: true",
          "  markdown: true",
          "  github_comment: true"
        ].join("\n"),
        "utf8"
      );
    }
  });

program
  .command("check")
  .option("--base <ref>")
  .option("--head <ref>")
  .option("--json", "emit machine-readable JSON")
  .description("inspect diff statistics")
  .action(async (options: { base?: string; head?: string; json?: boolean }) => {
    const config = loadPatchDietConfig(targetCwd);
    const base = await resolveBaseRef(targetCwd, options.base, config.base);
    const head = options.head ?? "HEAD";
    const { diff } = await getDiff(targetCwd, base, head);
    const parsed = parseUnifiedDiff(diff);
    const summary = summarizeDiff(parsed);
    const result = {
      ...summary,
      candidateCount: countCandidates(parsed.files.map((file) => file.path))
    };

    process.stdout.write(options.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : renderCheckSummary({ base, head, ...result }));
  });

program
  .command("shrink")
  .option("--base <ref>")
  .option("--head <ref>")
  .option("--test <command>", "required check command", collectValue, [])
  .option("--create-branch", "create a cleanup branch")
  .option("--apply", "apply the cleanup patch to the target checkout")
  .option("--dry-run", "run verification and print a summary without writing .patchdiet artifacts")
  .option("--allow-test-file-removal", "allow PatchDiet to remove changed test files when checks still pass")
  .option("--timeout-ms <ms>", "timeout for each required command", parsePositiveInteger)
  .option("--retry-flaky-tests <count>", "retry failed required checks before giving up", parseNonNegativeInteger)
  .option("--json", "emit machine-readable JSON")
  .description("generate a conservative cleanup patch")
  .action(async (options: {
    base?: string;
    head?: string;
    test: string[];
    createBranch?: boolean;
    apply?: boolean;
    dryRun?: boolean;
    allowTestFileRemoval?: boolean;
    timeoutMs?: number;
    retryFlakyTests?: number;
    json?: boolean;
  }) => {
    const loadedConfig = loadPatchDietConfig(targetCwd);
    const base = await resolveBaseRef(targetCwd, options.base, loadedConfig.base);
    const head = options.head ?? "HEAD";
    const tests = options.test.length > 0
      ? options.test
      : loadedConfig.commands.required.length > 0
        ? loadedConfig.commands.required
        : await detectRequiredCommands(targetCwd);

    if (tests.length === 0) {
      throw new Error(noTestCommandMessage());
    }

    const config = mergeConfigWithFlags(loadedConfig, {
      base,
      test: tests
    });
    const report = await runShrink({
      cwd: targetCwd,
      baseRef: base,
      headRef: head,
      requiredCommands: config.commands.required,
      createBranch: options.createBranch,
      apply: options.apply,
      dryRun: options.dryRun,
      ignorePaths: config.scope.ignorePaths,
      allowTestFileRemoval: options.allowTestFileRemoval,
      commandTimeoutMs: options.timeoutMs ?? config.reduction.maxRuntimeMinutes * 60 * 1000,
      retryFlakyTests: options.retryFlakyTests ?? config.reduction.retryFlakyTests
    });

    if (!options.dryRun) {
      const reportDir = join(targetCwd, ".patchdiet");
      writeFileSync(join(reportDir, "run.json"), JSON.stringify(report, null, 2), "utf8");
      writeFileSync(join(reportDir, "report.md"), renderMarkdownReport(report), "utf8");
      writeFileSync(join(reportDir, "report.html"), renderHtmlReport(report), "utf8");
      writeFileSync(join(reportDir, "report.github.md"), renderGitHubComment(report), "utf8");
    }
    process.stdout.write(options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderShrinkSummary(report));
  });

program
  .command("doctor")
  .option("--base <ref>")
  .option("--head <ref>")
  .option("--test <command>", "required check command", collectValue, [])
  .description("check whether PatchDiet can run in this repository")
  .action(async (options: { base?: string; head?: string; test: string[] }) => {
    const config = loadPatchDietConfig(targetCwd);
    const lines = ["PatchDiet doctor", ""];
    let hasFailure = false;

    const git = await checkGit(targetCwd);
    lines.push(`git: ${git.ok ? "ok" : `failed (${git.message})`}`);
    hasFailure ||= !git.ok;

    const repo = await checkGitRepo(targetCwd);
    lines.push(`repository: ${repo.ok ? "ok" : `failed (${repo.message})`}`);
    hasFailure ||= !repo.ok;

    const base = repo.ok ? await resolveBaseRef(targetCwd, options.base, config.base).catch((error: Error) => {
      hasFailure = true;
      return `failed (${error.message})`;
    }) : "skipped";
    lines.push(`base: ${base}`);

    const head = options.head ?? "HEAD";
    const headStatus = repo.ok ? await refExists(targetCwd, head) : false;
    lines.push(`head: ${headStatus ? head : `${head} (not found)`}`);
    hasFailure ||= repo.ok && !headStatus;

    const worktree = repo.ok ? await getWorktreeStatus(targetCwd) : "skipped";
    lines.push(`worktree: ${worktree}`);

    const tests = options.test.length > 0
      ? options.test
      : config.commands.required.length > 0
        ? config.commands.required
        : await detectRequiredCommands(targetCwd);
    if (tests.length === 0) {
      lines.push("test: not detected");
      lines.push("test hint: patchdiet shrink --test \"npm test\"");
      hasFailure = true;
    } else {
      lines.push(`test: ${tests.join(" && ")}`);
    }

    const patchdietWritable = checkPatchDietWritable(targetCwd);
    lines.push(`.patchdiet: ${patchdietWritable.ok ? "writable" : `not writable (${patchdietWritable.message})`}`);
    hasFailure ||= !patchdietWritable.ok;

    process.stdout.write(`${lines.join("\n")}\n`);
    if (hasFailure) {
      process.exitCode = 1;
    }
  });

program
  .command("report")
  .option("--format <format>", "markdown|html|github|json", "markdown")
  .description("render an existing shrink report")
  .action((options: { format: "markdown" | "html" | "github" | "json" }) => {
    const jsonPath = join(targetCwd, ".patchdiet", "run.json");
    const report = JSON.parse(readFileSync(jsonPath, "utf8")) as ShrinkReport;

    switch (options.format) {
      case "html":
        process.stdout.write(renderHtmlReport(report));
        return;
      case "github":
        process.stdout.write(renderGitHubComment(report));
        return;
      case "json":
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      default:
        process.stdout.write(renderMarkdownReport(report));
    }
  });

program.parseAsync(process.argv).catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

function collectValue(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got: ${value}`);
  }
  return parsed;
}

async function resolveBaseRef(cwd: string, explicitBase: string | undefined, configBase: string): Promise<string> {
  if (explicitBase) {
    await assertRefExists(cwd, explicitBase);
    return explicitBase;
  }

  const candidates = [
    ...githubBaseCandidates(),
    configBase,
    "origin/main",
    "origin/master"
  ].filter(uniqueStrings);

  for (const candidate of candidates) {
    if (await refExists(cwd, candidate)) {
      return candidate;
    }
  }

  const upstreamMergeBase = await findUpstreamMergeBase(cwd);
  if (upstreamMergeBase) {
    return upstreamMergeBase;
  }

  throw new Error(
    [
      "Could not detect a base ref.",
      "Tried GitHub Actions PR refs, origin/main, origin/master, and upstream merge-base.",
      "Example: patchdiet shrink --base origin/main --head HEAD --test \"npm test\""
    ].join("\n")
  );
}

function githubBaseCandidates(): string[] {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (!baseRef) {
    return [];
  }

  return [`origin/${baseRef}`, baseRef];
}

async function findUpstreamMergeBase(cwd: string): Promise<string | undefined> {
  for (const upstreamRef of ["upstream/main", "upstream/master"]) {
    if (!(await refExists(cwd, upstreamRef))) {
      continue;
    }

    try {
      const { stdout } = await execFileAsync("git", ["merge-base", "HEAD", upstreamRef], { cwd });
      const mergeBase = stdout.trim();
      if (mergeBase) {
        return mergeBase;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function assertRefExists(cwd: string, ref: string): Promise<void> {
  if (!(await refExists(cwd, ref))) {
    throw new Error(`Git ref not found: ${ref}`);
  }
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function detectRequiredCommands(cwd: string): Promise<string[]> {
  const packageJsonPath = join(cwd, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      packageManager?: string;
      scripts?: Record<string, string>;
    };
    if (packageJson.scripts?.test) {
      if (packageJson.packageManager?.startsWith("pnpm") || existsSync(join(cwd, "pnpm-lock.yaml"))) {
        return ["pnpm test"];
      }
      if (packageJson.packageManager?.startsWith("yarn") || existsSync(join(cwd, "yarn.lock"))) {
        return ["yarn test"];
      }
      if (packageJson.packageManager?.startsWith("bun") || existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) {
        return ["bun test"];
      }
      return ["npm test"];
    }
  }

  if (existsSync(join(cwd, "pytest.ini")) || existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "setup.cfg"))) {
    return ["pytest"];
  }

  if (existsSync(join(cwd, "go.mod"))) {
    return ["go test ./..."];
  }

  if (existsSync(join(cwd, "Cargo.toml"))) {
    return ["cargo test"];
  }

  return [];
}

function noTestCommandMessage(): string {
  return [
    "No test command detected.",
    "PatchDiet only removes hunks after a local verification command passes.",
    "Examples:",
    "  patchdiet shrink --test \"npm test\"",
    "  patchdiet shrink --test \"pnpm test\"",
    "  patchdiet shrink --test \"pytest\""
  ].join("\n");
}

function renderShrinkSummary(report: ShrinkReport): string {
  const removedLines = report.input.changedLineCount - report.output.changedLineCount;
  const reduction = report.input.changedLineCount === 0
    ? 0
    : Math.round((removedLines / report.input.changedLineCount) * 100);

  return [
    "PatchDiet shrink complete",
    `Base: ${report.baseRef}`,
    `Head: ${report.headRef}`,
    `Test: ${report.testCommand.command} (${report.testCommand.status}, ${report.testCommand.durationMs}ms)`,
    `Before: ${formatSummary(report.input)}`,
    `After: ${formatSummary(report.output)}`,
    `Removed: ${report.removals.length} candidate(s), ${Math.max(0, reduction)}% fewer changed lines`,
    `Kept: ${report.kept.length} candidate(s)`,
    `Needs human review: ${report.needsHumanReview.length} candidate(s)`,
    "Safety: tests passing is not a semantic-equivalence proof.",
    "Review: inspect removed, kept, and needs-human-review candidates before applying cleanup.diff.",
    `Cleanup patch: ${report.patchPath ?? ".patchdiet/cleanup.diff"}`,
    `Report: ${report.reportPath ?? ".patchdiet/report.md"}`,
    report.patchPath ? "" : "Dry run: no artifacts written",
    report.removals.length === 0
      ? "Next: review kept and needs-human-review sections before applying cleanup.diff."
      : "Next: review .patchdiet/report.md and apply .patchdiet/cleanup.diff when it matches your intent.",
    ""
  ].filter((line) => line !== "").join("\n");
}

function renderCheckSummary(summary: ShrinkReport["input"] & { base: string; head: string; candidateCount: number }): string {
  return [
    "PatchDiet check",
    `Base: ${summary.base}`,
    `Head: ${summary.head}`,
    `Files: ${summary.fileCount}`,
    `Hunks: ${summary.hunkCount}`,
    `Lines: ${summary.changedLineCount} changed (+${summary.addedLineCount}/-${summary.removedLineCount})`,
    `Candidate paths: ${summary.candidateCount}`,
    summary.candidateCount === 0
      ? "Next: run patchdiet shrink after adding a local test command if this PR still feels noisy."
      : "Next: run patchdiet shrink to create .patchdiet/cleanup.diff after local tests pass.",
    ""
  ].join("\n");
}

function formatSummary(summary: ShrinkReport["input"]): string {
  return `${summary.fileCount} files, ${summary.changedLineCount} changed lines, ${summary.hunkCount} hunks`;
}

async function checkGit(cwd: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await execFileAsync("git", ["--version"], { cwd });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

async function checkGitRepo(cwd: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
    return stdout.trim() === "true"
      ? { ok: true }
      : { ok: false, message: "not inside a worktree" };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

async function getWorktreeStatus(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
  return stdout.trim() ? "dirty (PatchDiet will use temporary worktrees)" : "clean";
}

function checkPatchDietWritable(cwd: string): { ok: boolean; message?: string } {
  const patchdietDir = join(cwd, ".patchdiet");
  const probePath = join(patchdietDir, ".write-test");

  try {
    mkdirSync(patchdietDir, { recursive: true });
    writeFileSync(probePath, "ok", "utf8");
    accessSync(probePath, constants.W_OK);
    rmSync(probePath, { force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

function uniqueStrings(value: string, index: number, array: string[]): boolean {
  return array.indexOf(value) === index;
}
