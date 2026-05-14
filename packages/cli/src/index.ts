#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";

import { loadPatchDietConfig, mergeConfigWithFlags } from "../../core/src/config.js";
import { parseUnifiedDiff, summarizeDiff } from "../../core/src/diff.js";
import { getDiff } from "../../core/src/git.js";
import { renderGitHubComment, renderHtmlReport, renderMarkdownReport } from "../../report/src/index.js";
import { countCandidates, runShrink } from "../../core/src/shrink.js";
import type { ShrinkReport } from "../../core/src/types.js";

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
  .option("--test <command>", "required check command", collectValue, [])
  .option("--create-branch", "create a cleanup branch")
  .option("--apply", "apply the cleanup patch to the target checkout")
  .description("generate a conservative cleanup patch")
  .action(async (options: { base: string; head: string; test: string[]; createBranch?: boolean; apply?: boolean }) => {
    const config = mergeConfigWithFlags(loadPatchDietConfig(targetCwd), {
      base: options.base,
      test: options.test
    });
    const report = await runShrink({
      cwd: targetCwd,
      baseRef: options.base,
      headRef: options.head,
      requiredCommands: config.commands.required,
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

program.parseAsync(process.argv);

function collectValue(value: string, previous: string[]): string[] {
  return [...previous, value];
}
