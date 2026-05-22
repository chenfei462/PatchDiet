#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";

import type { PatchDietConfig, ResolvedCommands } from "../../core/src/config.js";
import { loadPatchDietConfig, mergeConfigWithFlags } from "../../core/src/config.js";
import { parseUnifiedDiff, summarizeDiff } from "../../core/src/diff.js";
import { getDiff } from "../../core/src/git.js";
import { detectPackageManagerCommands } from "../../core/src/package-manager.js";
import { renderGitHubComment, renderHtmlReport, renderMarkdownReport } from "../../report/src/index.js";
import { countCandidates, runShrink } from "../../core/src/shrink.js";
import type { ShrinkReport } from "../../core/src/types.js";

const program = new Command();
const targetCwd = process.env.PATCHDIET_TARGET_CWD
  ? resolve(process.env.PATCHDIET_TARGET_CWD)
  : process.cwd();

program
  .name("patchdiet")
  .description("Shrink AI-generated pull requests into smaller reviewable patches.")
  .addHelpText("after", [
    "",
    "First run:",
    "  npx patchdiet shrink --base origin/main --head HEAD",
    "",
    "Zero config works for root JS repos with npm, pnpm, or yarn and a package.json test script.",
    "Run patchdiet init to make detected or explicit commands durable.",
    "PatchDiet will not guess workspace, package-directory, or non-JS commands."
  ].join("\n"));

program
  .command("init")
  .description("create patchdiet.yaml in the current directory")
  .action(() => {
    const cwd = process.cwd();
    const configPath = join(cwd, "patchdiet.yaml");
    if (existsSync(configPath)) {
      process.stdout.write([
        "patchdiet.yaml already exists.",
        "Next: npx patchdiet shrink --base origin/main --head HEAD"
      ].join("\n") + "\n");
      return;
    }

    const detectedCommands = detectPackageManagerCommands(cwd);
    writeFileSync(
      configPath,
      renderDefaultConfig(detectedCommands?.required ?? [], detectedCommands?.optional ?? []),
      "utf8"
    );
    process.stdout.write(renderInitSummary(detectedCommands));
  });

program
  .command("check")
  .requiredOption("--base <ref>")
  .requiredOption("--head <ref>")
  .description("inspect diff statistics")
  .action(async (options: { base: string; head: string }) => {
    const { diff } = await getDiff(targetCwd, options.base, options.head);
    const parsed = parseUnifiedDiff(diff);
    const summary = summarizeDiff(parsed);
    process.stdout.write(
      `${JSON.stringify(
        {
          ...summary,
          candidateCount: countCandidates(parsed.files.map((file) => file.path))
        },
        null,
        2
      )}\n`
    );
  });

program
  .command("shrink")
  .requiredOption("--base <ref>")
  .requiredOption("--head <ref>")
  .option("--test <command>", "required check command", collectValue)
  .option("--lint <command>", "optional lint command", collectValue)
  .option("--typecheck <command>", "optional typecheck command", collectValue)
  .option("--dry-run", "generate cleanup artifacts without applying or creating a branch")
  .option("--create-branch", "create a cleanup branch")
  .option("--apply", "apply the cleanup patch to the target checkout")
  .description("generate a conservative cleanup patch")
  .addHelpText("after", [
    "",
    "Zero config: root JS repos with npm, pnpm, or yarn and a package.json test script.",
    "PatchDiet will not guess workspace, monorepo, package-directory, or non-JS commands.",
    "If detection fails, pass --test or run patchdiet init and edit commands.required.",
    "",
    "Examples:",
    "  patchdiet shrink --base origin/main --head HEAD",
    "  patchdiet shrink --base origin/main --head HEAD --test \"pnpm --filter app test\""
  ].join("\n"))
  .action(async (options: {
    base: string;
    head: string;
    test?: string[];
    lint?: string[];
    typecheck?: string[];
    dryRun?: boolean;
    createBranch?: boolean;
    apply?: boolean;
  }) => {
    const loadedConfig = loadPatchDietConfig(targetCwd);
    const detectedCommands = detectPackageManagerCommands(targetCwd);
    assertCanResolveVerificationCommands(targetCwd, loadedConfig, {
      test: options.test,
      lint: options.lint,
      typecheck: options.typecheck
    }, detectedCommands);
    const config = mergeConfigWithFlags(
      loadedConfig,
      {
        base: options.base,
        test: options.test,
        lint: options.lint,
        typecheck: options.typecheck
      },
      detectedCommands
    );
    const report = await runShrink({
      cwd: targetCwd,
      baseRef: options.base,
      headRef: options.head,
      requiredCommands: config.commands.required,
      optionalCommands: config.commands.optional,
      ignorePaths: config.scope.ignorePaths,
      maxRuntimeMinutes: config.reduction.maxRuntimeMinutes,
      retryFlakyTests: config.reduction.retryFlakyTests,
      allowFormatOnlyRemoval: config.scope.allowFormatOnlyRemoval,
      flagDependencyBumps: config.scope.flagDependencyBumps,
      dryRun: options.dryRun,
      createBranch: options.createBranch,
      apply: options.apply
    });

    const reportDir = join(targetCwd, ".patchdiet");
    writeFileSync(join(reportDir, "run.json"), JSON.stringify(report, null, 2), "utf8");
    writeFileSync(join(reportDir, "report.md"), renderMarkdownReport(report), "utf8");
    writeFileSync(join(reportDir, "report.html"), renderHtmlReport(report), "utf8");
    writeFileSync(join(reportDir, "report.github.md"), renderGitHubComment(report), "utf8");
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

await program
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });

function collectValue(value: string, previous?: string[]): string[] {
  return [...(previous ?? []), value];
}

function renderDefaultConfig(requiredCommands: string[], optionalCommands: string[]): string {
  return [
    "version: 1",
    "base: origin/main",
    "commands:",
    ...renderCommandSection("required", requiredCommands),
    ...renderCommandSection("optional", optionalCommands),
    "reduction:",
    "  strategy: conservative",
    "  atom_granularity: hunk",
    "  max_runtime_minutes: 20",
    "  retry_flaky_tests: 2",
    "scope:",
    "  ignore_paths: []",
    "  allow_format_only_removal: true",
    "  flag_dependency_bumps: true",
    "report:",
    "  html: true",
    "  markdown: true",
    "  github_comment: true"
  ].join("\n");
}

function renderCommandSection(label: "required" | "optional", commands: string[]): string[] {
  return commands.length > 0
    ? [`  ${label}:`, ...commands.map((command) => `    - ${command}`)]
    : [`  ${label}: []`];
}

function renderInitSummary(detectedCommands: ResolvedCommands | undefined): string {
  const lines = ["Created patchdiet.yaml."];
  const requiredCommands = detectedCommands?.required;
  if (hasCommands(requiredCommands)) {
    lines.push(`Detected root JS commands: ${requiredCommands.join(", ")}.`);
    lines.push("Edit commands.required if this repo needs a workspace filter, package target, or non-JS test command.");
    lines.push("Next: npx patchdiet shrink --base origin/main --head HEAD");
  } else {
    lines.push("No root JS test script was detected.");
    lines.push("Edit commands.required before running shrink.");
    lines.push("Then: npx patchdiet shrink --base origin/main --head HEAD");
  }
  return `${lines.join("\n")}\n`;
}

function assertCanResolveVerificationCommands(
  cwd: string,
  config: PatchDietConfig,
  flags: { test?: string[]; lint?: string[]; typecheck?: string[] },
  detectedCommands: ResolvedCommands | undefined
): void {
  if (hasCommands(flags.test) || hasCommands(config.commands.required) || hasCommands(detectedCommands?.required)) {
    return;
  }

  if (existsSync(join(cwd, "package.json"))) {
    throw new Error([
      "PatchDiet found package.json, but no root test script.",
      "Supported zero-config path: root JS repos with npm, pnpm, or yarn and a package.json test script.",
      "PatchDiet will not guess workspace, monorepo, package-directory, or non-JS commands.",
      "Next: pass --test explicitly, or run patchdiet init and edit commands.required.",
      "Example: patchdiet shrink --base origin/main --head HEAD --test \"pnpm --filter app test\""
    ].join("\n"));
  }

  throw new Error([
    "PatchDiet could not infer a verification command.",
    "Supported zero-config path: root JS repos with npm, pnpm, or yarn and a package.json test script.",
    "PatchDiet will not guess non-JS commands.",
    "Next: pass --test explicitly, or run patchdiet init and edit commands.required.",
    "Example: patchdiet shrink --base origin/main --head HEAD --test \"python -m pytest\""
  ].join("\n"));
}

function hasCommands(commands: string[] | undefined): commands is string[] {
  return Array.isArray(commands) && commands.length > 0;
}
