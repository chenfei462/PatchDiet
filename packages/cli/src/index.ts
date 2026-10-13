#!/usr/bin/env node

import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Command } from "commander";

import { loadPatchDietConfig, mergeConfigWithFlags } from "../../core/src/config.js";
import { parseUnifiedDiff, summarizeDiff } from "../../core/src/diff.js";
import { getDiff } from "../../core/src/git.js";
import { renderGitHubComment, renderHtmlReport, renderMarkdownReport, buildDietCardModel, renderDietBadgeMarkdown, renderDietCardHtml, renderDietCardPng, renderDietCardSvg } from "../../report/src/index.js";
import { countCandidates, runShrink } from "../../core/src/shrink.js";
import { loadFeedbackPriorities, recordFeedback, showFeedback } from "../../core/src/feedback.js";
import { indexRepository } from "../../knowledge/src/index.js";
import { buildTargetedPlan } from "../../core/src/targeted.js";
import { analyzeDiffScope } from "./scope-analysis.js";
import { extractOptionalCloudIntent, type IntentSourceDocument } from "../../intent/src/index.js";
import { explainAtoms, renderExplanationMarkdown, renderScopeJson, renderScopeMarkdown } from "../../scope/src/index.js";
import type { ShrinkReport } from "../../core/src/types.js";

const execFileAsync = promisify(execFile);
const program = new Command();
const targetCwd = process.env.PATCHDIET_TARGET_CWD
  ? resolve(process.env.PATCHDIET_TARGET_CWD)
  : process.cwd();

program.name("patchdiet").description("Shrink AI-generated pull requests into smaller reviewable patches.");

// Real packaged version, read from the nearest package.json walking up from
// this module: source runs resolve to packages/cli/package.json; the
// published dist layout (dist/packages/cli/src/index.js) walks up to the
// canonical root package.json. No hardcoded version copy to drift.
function resolveCliVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    const manifestPath = join(dir, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string; version?: string };
        if (manifest.name === "patchdiet" || manifest.name === "@patchdiet/cli") {
          return manifest.version ?? "unknown";
        }
      } catch {
        // unreadable manifest here: keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "unknown";
}

program.version(resolveCliVersion(), "-V, --version", "print the PatchDiet CLI version");

program
  .command("init")
  .option("--v2", "create a version 2 configuration with currently supported reduction settings")
  .description("create patchdiet.yaml in the current directory")
  .action((options: { v2?: boolean }) => {
    const configPath = join(process.cwd(), "patchdiet.yaml");
    if (!existsSync(configPath)) {
      const lines = options.v2 ? [
        "version: 2",
        "base: origin/main",
        "commands:",
        "  required: []",
        "  optional: []",
        "reduction:",
        "  strategy: ddmin",
        // AST granularity and dependency grouping default ON: the runtime is
        // proven (real JS/Python/TS gates) and integrated in this version.
        "  atom_granularity: ast",
        "  dependency_grouping: true",
        "  final_verification: true",
        "  max_runtime_minutes: 20",
        "  retry_flaky_tests: 2",
        "verification:",
        // Targeted-first stays off in the template: it requires a built index
        // ('patchdiet index'); without it the run falls back to the full oracle.
        "  targeted_first: false",
        "  full_required_at_end: true",
        "knowledge:",
        "  database: .patchdiet/knowledge.sqlite",
        "  languages: [typescript, javascript, python]",
        "scope:",
        "  ignore_paths: []",
        "report:",
        "  html: true",
        "  markdown: true",
        "  github_comment: true",
        "  json: true",
        "  evidence: true",
        "safety:",
        "  mode: local",
        "  allow_upload: false",
        "  protect: ['**/migrations/**', '**/generated/**', '**/vendor/**']",
        "  dependency_manifests: human-review",
        "  unsupported_diff: human-review"
      ] : [
        "version: 1",
        "base: origin/main",
        "language: generic",
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
        "  github_comment: true",
        "safety:",
        "  mode: local",
        "  allow_upload: false",
        "intelligence:",
        "  mode: local-only",
        "performance:",
        "  max_parallel_worktrees: 1",
        "  cache_tests: false"
      ];
      writeFileSync(
        configPath,
        lines.join("\n"),
        "utf8"
      );
    }
  });

program
  .command("index")
  .option("--ref <ref>", "commit or ref to index", "HEAD")
  .option("--database <path>", "repository-local SQLite database path")
  .option(
    "--coverage <path>",
    "bounded local coverage input: schemaVersion:1 per-test JSON (optional per-test 'lines' intervals), LCOV tracefile, Istanbul JSON or coverage.py JSON",
  )
  .option(
    "--merged-prs <path>",
    "caller-supplied merged-PR snapshot JSON (repo-local, strict, bounded); requires knowledge.history.merged_prs enabled",
  )
  .option("--json", "emit machine-readable JSON")
  .description("build or update the local semantic repository index")
  .action(async (options: { ref: string; database?: string; coverage?: string; mergedPrs?: string; json?: boolean }) => {
    const config = loadPatchDietConfig(targetCwd);
    const result = await indexRepository({
      cwd: targetCwd,
      ref: options.ref,
      databasePath: options.database ?? config.knowledge?.database,
      languages: config.knowledge?.languages,
      rules: config.knowledge ? { globs: config.knowledge.rules.autoDiscover } : undefined,
      coveragePath: options.coverage,
      history: {
        git: config.knowledge?.history?.git ?? true,
        mergedPrsEnabled: config.knowledge?.history?.mergedPrs === true,
        mergedPrsPath: options.mergedPrs,
      },
    });
    const coverageSummary = result.coverage === null
      ? null
      : `Coverage: ${result.coverage.format} source '${result.coverage.source}' (${result.coverage.tests} per-test entr(y/ies), ${result.coverage.aggregateFiles} aggregate file(s), ${result.coverage.lineRows} line rows)` +
        (result.coverage.diagnostics.length > 0 ? `\nCoverage diagnostics: ${result.coverage.diagnostics.join("; ")}` : "");
    // Truthful history summary: every enabled-but-unavailable merged-PR
    // diagnostic is printed, never hidden behind the JSON flag.
    const historyLines: string[] = [];
    if (result.history.enabled) {
      historyLines.push(
        `History: ${result.history.collected ? `${result.history.commits} commit(s)` : "not collected"} at ${result.repo.commit}` +
          ` (co-change pairs: ${result.history.cochangePairs}, truncated: ${result.history.truncated ? "yes" : "no"}, shallow: ${result.history.shallow ? "yes" : "no"})`,
      );
      for (const diagnostic of result.history.diagnostics) {
        historyLines.push(`History diagnostic: ${diagnostic}`);
      }
    }
    // Merged-PR lines are printed whenever the FEATURE is on — including the
    // configured-off-history case, whose unavailability must stay visible.
    if (result.history.mergedPrs !== null) {
      if (result.history.mergedPrs.ingested > 0) {
        historyLines.push(
          `Merged PRs: ${result.history.mergedPrs.ingested} caller-asserted record(s) ingested (labels are unverified caller assertions, not GitHub authentication)`,
        );
      }
      for (const diagnostic of result.history.mergedPrs.diagnostics) {
        historyLines.push(`Merged-PR diagnostic: ${diagnostic}`);
      }
    }
    process.stdout.write(options.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : [
          `Indexed ${result.files.total} files at ${result.repo.commit}`,
          `Database: ${result.databasePath}`,
          coverageSummary,
          ...historyLines
        ].filter((line) => line !== null).join("\n") + "\n");
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
  .command("intent-extract")
  .description("extract local intent and optionally request bounded cloud suggestions")
  .requiredOption("--sources <repo-local-json>", "JSON array of intent source documents")
  .option("--provider-url <https-url>", "explicit cloud intent provider endpoint")
  .option("--model <name>", "explicit provider model name")
  .option("--upload-consent", "permit upload of the named source documents")
  .action(async (options: { sources: string; providerUrl?: string; model?: string; uploadConsent?: boolean }) => {
    const root = realpathSync(targetCwd);
    const requestedPath = resolve(root, options.sources);
    if (lstatSync(requestedPath).isSymbolicLink()) throw new Error("Intent source file must not be a symlink");
    const path = realpathSync(requestedPath);
    if (!path.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}`) || !lstatSync(path).isFile()) {
      throw new Error("Intent source file must be a regular repository-local JSON file");
    }
    if (lstatSync(path).size > 16 * 1024) throw new Error("Intent source file exceeds 16 KiB");
    const sources = JSON.parse(readFileSync(path, "utf8")) as IntentSourceDocument[];
    if (Boolean(options.providerUrl) !== Boolean(options.model)) throw new Error("Provider URL and model must be specified together");
    const apiToken = process.env.PATCHDIET_INTENT_API_TOKEN ?? "";
    const provider = options.providerUrl ? { url: options.providerUrl, model: options.model!, apiToken } : undefined;
    const result = await extractOptionalCloudIntent(sources, { provider, uploadConsent: options.uploadConsent });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program
  .command("verify")
  .description("analyze task scope from a Git diff without modifying the repository or running checks")
  .option("--base <ref>")
  .option("--head <ref>")
  .option("--task <text>", "explicit task description")
  .option("--task-file <path>", "UTF-8 task description file")
  .option("--json", "emit machine-readable Scope Map")
  .action(async (options: { base?: string; head?: string; task?: string; taskFile?: string; json?: boolean }) => {
    const config = loadPatchDietConfig(targetCwd);
    const base = await resolveBaseRef(targetCwd, options.base, config.base);
    const report = await analyzeDiffScope({ cwd: targetCwd, base, head: options.head ?? "HEAD", task: options.task, taskFile: options.taskFile });
    process.stdout.write(`${options.json ? renderScopeJson(report) : renderScopeMarkdown(report)}\n`);
  });

program
  .command("explain")
  .description("retrieve evidence for changed atoms without modifying the repository")
  .option("--base <ref>")
  .option("--head <ref>")
  .option("--task <text>", "explicit task description")
  .option("--task-file <path>", "UTF-8 task description file")
  .option("--atom <id>", "filter by atom ID")
  .option("--file <path>", "filter by changed file")
  .option("--symbol <name>", "filter by changed symbol")
  .option("--json", "emit machine-readable explanations")
  .action(async (options: { base?: string; head?: string; task?: string; taskFile?: string; atom?: string; file?: string; symbol?: string; json?: boolean }) => {
    const config = loadPatchDietConfig(targetCwd);
    const base = await resolveBaseRef(targetCwd, options.base, config.base);
    const report = await analyzeDiffScope({ cwd: targetCwd, base, head: options.head ?? "HEAD", task: options.task, taskFile: options.taskFile });
    const explanations = explainAtoms({ atomId: options.atom, file: options.file, symbol: options.symbol }, report);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(explanations, null, 2)}\n`);
    } else if (explanations.length === 0) {
      process.stdout.write("No changed atoms match the requested filter.\n");
    } else {
      process.stdout.write(explanations.map(renderExplanationMarkdown).join("\n"));
    }
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
  .option("--task <text>", "explicit task description feeding the advisory scope gate")
  .option("--task-file <path>", "UTF-8 task description file feeding the advisory scope gate")
  .option("--strategy <strategy>", "reduction search: conservative or ddmin")
  .option("--granularity <granularity>", "reduction unit: hunk (v1) or ast")
  .option("--feedback-ranking", "use repeated repository-local decisions only to order eligible trials")
  .option("--timeout-ms <ms>", "timeout for each required command", parsePositiveInteger)
  .option("--retry-flaky-tests <count>", "retry failed required checks before giving up", parseNonNegativeInteger)
  .option("--final-verify", "mandatory final artifact verification (always on; cannot be disabled)")
  .option("--no-final-verify", "rejected: final artifact verification cannot be disabled")
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
    task?: string;
    taskFile?: string;
    strategy?: string;
    granularity?: string;
    feedbackRanking?: boolean;
    timeoutMs?: number;
    retryFlakyTests?: number;
    finalVerify?: boolean;
    json?: boolean;
  }) => {
    // Hard safety rule: final artifact verification is mandatory. The
    // explicit --final-verify switch is accepted (and recorded via the run's
    // final stage); a --no-final-verify attempt is a config error.
    if (options.finalVerify === false) {
      throw new Error(
        "ERROR: --no-final-verify is rejected: the final artifact verification is mandatory in every mode."
      );
    }
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
    // Explicit task inputs: --task wins over --task-file; the file must be
    // readable UTF-8 and is read at the resolved path (local snapshot only).
    let taskText: string | undefined;
    if (options.task !== undefined) {
      taskText = options.task;
    } else if (options.taskFile !== undefined) {
      const taskPath = isAbsolute(options.taskFile) ? options.taskFile : resolve(targetCwd, options.taskFile);
      taskText = readFileSync(taskPath, "utf8");
    }
    const strategy = options.strategy ?? config.reduction.strategy;
    if (strategy !== "conservative" && strategy !== "ddmin") {
      throw new Error(`ERROR: unknown --strategy '${strategy}' (expected conservative or ddmin)`);
    }
    const granularity = options.granularity ?? config.reduction.atomGranularity;
    if (granularity !== "hunk" && granularity !== "ast") {
      throw new Error(`ERROR: unknown --granularity '${granularity}' (expected hunk or ast)`);
    }
    // v2 controls: build the targeted mapping plan from the pinned SQLite
    // knowledge index when targeted_first is enabled. Every failure mode
    // (missing/stale/unreadable index, no mapping, unsupported runner) yields
    // an unavailable plan whose diagnostic the engine records verbatim.
    const targetedFirst = config.verification?.targetedFirst === true;
    let testMappings: Parameters<typeof runShrink>[0]["testMappings"];
    if (targetedFirst) {
      const changedPaths = parseUnifiedDiff((await getDiff(targetCwd, base, head)).diff).files.map((file) => file.path);
      let headSha: string | undefined;
      let repoRoot: string | undefined;
      try {
        headSha = (await execFileAsync("git", ["rev-parse", "--verify", head], { cwd: targetCwd })).stdout.trim();
        repoRoot = (await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: targetCwd })).stdout.trim();
      } catch {
        headSha = undefined;
        repoRoot = undefined;
      }
      const hasPytest =
        existsSync(join(targetCwd, "pytest.ini")) ||
        existsSync(join(targetCwd, "pyproject.toml")) ||
        existsSync(join(targetCwd, "setup.cfg"));
      const plan = buildTargetedPlan({
        cwd: targetCwd,
        databasePath: config.knowledge?.database,
        changedPaths,
        hasPytest,
        pinnedHeadSha: headSha,
        expectedRepoRoot: repoRoot
      });
      testMappings = {
        provenance: plan.provenance,
        mappings: plan.mappings,
        diagnostic: plan.diagnostic,
        unsupportedRecipes: plan.unsupportedRecipes
      };
    }

    const report = await runShrink({
      cwd: targetCwd,
      baseRef: base,
      headRef: head,
      requiredCommands: config.commands.required,
      strategy,
      atomGranularity: granularity,
      dependencyGrouping: config.reduction.dependencyGrouping,
      taskText,
      createBranch: options.createBranch,
      apply: options.apply,
      dryRun: options.dryRun,
      ignorePaths: config.scope.ignorePaths,
      protectPaths: config.safety.protect,
      dependencyManifestsHumanReview: config.safety.dependencyManifests === "human-review",
      allowTestFileRemoval: options.allowTestFileRemoval,
      allowFormatOnlyRemoval: config.scope.allowFormatOnlyRemoval,
      commandTimeoutMs: options.timeoutMs ?? config.reduction.maxRuntimeMinutes * 60 * 1000,
      retryFlakyTests: options.retryFlakyTests ?? config.reduction.retryFlakyTests,
      // v2 runtime controls: budget, concurrency, cache and report toggles are
      // wired from the resolved config — no accepted field stays decorative.
      maxRuntimeMs: config.reduction.maxRuntimeMinutes * 60 * 1000,
      maxParallelWorktrees: config.performance.max_parallel_worktrees,
      cacheTests: config.version === 2 ? config.performance.cache_tests ?? true : undefined,
      report: {
        html: config.report.html,
        markdown: config.report.markdown,
        githubComment: config.report.githubComment,
        evidence: config.report.evidence ?? false,
        // v1 keeps the historical run.json output; v2 honors report.json.
        json: config.report.json ?? config.version < 2,
        githubCheck: config.report.githubCheck ?? false
      },
      optionalCommands: config.commands.optional,
      targetedFirst,
      testMappings,
      feedbackRanking: options.feedbackRanking ? loadFeedbackPriorities(targetCwd) : undefined
    });

    // All report files are emitted by the engine (single containment-safe
    // atomic writer, artifacts list matches the files actually created). The
    // stdout --json output is an explicit user request and is unaffected by
    // the file json toggle.
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

program
  .command("card")
  .description("re-render the Diet Card from an existing .patchdiet/run.json")
  .option("--project <name>", "project name shown on the card")
  .option("--format <format>", "svg|html|png|badge", "svg")
  .option("--output <path>", "output path (defaults under .patchdiet/)")
  .option("--badge-url <url>", "image URL used by --format badge")
  .action((options: { project?: string; format: "svg" | "html" | "png" | "badge"; output?: string; badgeUrl?: string }) => {
    const jsonPath = join(targetCwd, ".patchdiet", "run.json");
    const report = JSON.parse(readFileSync(jsonPath, "utf8")) as ShrinkReport;
    const model = buildDietCardModel(report, { projectName: options.project });
    const outputPath = options.output
      ? resolve(targetCwd, options.output)
      : join(targetCwd, ".patchdiet", defaultCardFileName(options.format));

    mkdirSync(join(outputPath, ".."), { recursive: true });

    switch (options.format) {
      case "html":
        writeFileSync(outputPath, renderDietCardHtml(model), "utf8");
        break;
      case "png":
        writeFileSync(outputPath, renderDietCardPng(model));
        break;
      case "badge": {
        if (!options.badgeUrl) {
          throw new Error("--format badge requires --badge-url");
        }
        writeFileSync(outputPath, `${renderDietBadgeMarkdown(model, options.badgeUrl)}\n`, "utf8");
        break;
      }
      default:
        writeFileSync(outputPath, renderDietCardSvg(model), "utf8");
    }

    process.stdout.write(`${outputPath}\n`);
  });

const feedback = program.command("feedback").description("record or show local human decisions bound to a shrink run");
feedback.command("record")
  .requiredOption("--candidate <ordinal>", "zero-based candidate ordinal in run.json")
  .requiredOption("--path <path>", "repository-relative candidate path as shown in run.json")
  .requiredOption("--verdict <verdict>", "accepted|rejected|wrong_scope|uncertain")
  .option("--note <text>", "inert reviewer note (up to 2000 characters)")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { candidate: string; path: string; verdict: string; note?: string; json?: boolean }) => {
    const result = await recordFeedback(targetCwd, options);
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` :
      `Recorded ${result.feedback.length} decision(s) for report ${result.runRef.reportSha256}.\n`);
  });
feedback.command("show")
  .option("--json", "emit machine-readable JSON")
  .action((options: { json?: boolean }) => {
    const result = showFeedback(targetCwd);
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` :
      result.feedback.length === 0 ? "No decisions recorded for this run.\n" :
        result.feedback.map((entry) => `${entry.candidateOrdinal}\t${entry.path}\t${entry.verdict}`).join("\n") + "\n");
  });

program.parseAsync(process.argv).catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

function collectValue(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function defaultCardFileName(format: "svg" | "html" | "png" | "badge"): string {
  switch (format) {
    case "html":
      return "diet-card.html";
    case "png":
      return "diet-card.png";
    case "badge":
      return "patchdiet-badge.md";
    default:
      return "diet-card.svg";
  }
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

  // v2 report toggles: only files THIS run actually wrote are named. A
  // disabled report format is never advertised (no ghost paths).
  const artifactLines: string[] = [];
  const artifactLabel: Record<string, string> = {
    ".patchdiet/cleanup.diff": "Cleanup patch",
    ".patchdiet/report.md": "Report",
    ".patchdiet/run.json": "JSON report",
    ".patchdiet/report.html": "HTML report",
    ".patchdiet/report.github.md": "GitHub comment report",
    ".patchdiet/evidence.md": "Evidence report",
    ".patchdiet/github-check.draft.md": "GitHub check draft (local only)"
  };
  for (const artifact of report.artifacts) {
    const label = artifactLabel[artifact];
    if (label === undefined) continue;
    const written =
      artifact === ".patchdiet/cleanup.diff" ? report.patchPath
      : artifact === ".patchdiet/report.md" ? report.reportPath
      : artifact === ".patchdiet/run.json" ? report.reportJsonPath
      : artifact === ".patchdiet/github-check.draft.md" ? report.githubCheckDraftPath
      : undefined;
    artifactLines.push(label + ": " + (written ?? artifact));
  }
  const nextHint = report.removals.length === 0
    ? "Next: review kept and needs-human-review sections before applying cleanup.diff."
    : report.artifacts.includes(".patchdiet/report.md")
      ? "Next: review .patchdiet/report.md and apply .patchdiet/cleanup.diff when it matches your intent."
      : "Next: review the candidates and apply .patchdiet/cleanup.diff when it matches your intent.";

  return [
    "PatchDiet shrink complete",
    "Base: " + report.baseRef,
    "Head: " + report.headRef,
    "Test: " + report.testCommand.command + " (" + report.testCommand.status + ", " + report.testCommand.durationMs + "ms)",
    "Before: " + formatSummary(report.input),
    "After: " + formatSummary(report.output),
    "Removed: " + report.removals.length + " candidate(s), " + Math.max(0, reduction) + "% fewer changed lines",
    "Kept: " + report.kept.length + " candidate(s)",
    "Needs human review: " + report.needsHumanReview.length + " candidate(s)",
    "Safety: tests passing is not a semantic-equivalence proof.",
    "Review: inspect removed, kept, and needs-human-review candidates before applying cleanup.diff.",
    ...artifactLines,
    report.patchPath ? "" : "Dry run: no artifacts written",
    nextHint,
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
