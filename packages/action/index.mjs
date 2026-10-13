import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { loadPatchDietConfig, mergeConfigWithFlags } from "../core/src/config.js";
import { runShrink } from "../core/src/shrink.js";
import { renderGitHubComment, renderHtmlReport, renderMarkdownReport } from "../report/src/index.js";

const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
const base = optionalInput("INPUT_BASE");
const head = optionalInput("INPUT_HEAD");
const testCommand = optionalInput("INPUT_TEST");
const githubToken = process.env.INPUT_GITHUB_TOKEN;
const targetCwd = resolve(workspace);
const execFileAsync = promisify(execFile);

const loadedConfig = loadPatchDietConfig(targetCwd);
const baseRef = base ?? await resolveBaseRef(targetCwd, loadedConfig.base);
const headRef = head ?? "HEAD";
const tests = testCommand
  ? [testCommand]
  : loadedConfig.commands.required.length > 0
    ? loadedConfig.commands.required
    : await detectRequiredCommands(targetCwd);

if (tests.length === 0) {
  throw new Error("No test command detected. Set the action 'test' input, for example: test: npm test");
}

const config = mergeConfigWithFlags(loadedConfig, {
  base: baseRef,
  test: tests
});

// Trust-boundary annotation: patchdiet.yaml is read from the checked-out PR
// head, so a PR that modifies it also chooses (unless the workflow sets the
// `test` input) the commands PatchDiet executes in this run. Flag that loudly
// without blocking the run.
await warnIfConfigFromPullRequest(targetCwd, baseRef, headRef);

const report = await runShrink({
  cwd: targetCwd,
  baseRef,
  headRef,
  requiredCommands: config.commands.required,
  ignorePaths: config.scope.ignorePaths,
  commandTimeoutMs: config.reduction.maxRuntimeMinutes * 60 * 1000,
  retryFlakyTests: config.reduction.retryFlakyTests
});

writeFileSync(join(targetCwd, ".patchdiet", "run.json"), JSON.stringify(report, null, 2), "utf8");
writeFileSync(join(targetCwd, ".patchdiet", "report.md"), renderMarkdownReport(report), "utf8");
writeFileSync(join(targetCwd, ".patchdiet", "report.html"), renderHtmlReport(report), "utf8");
writeFileSync(join(targetCwd, ".patchdiet", "report.github.md"), renderGitHubComment(report), "utf8");

const commentPath = join(workspace, ".patchdiet", "report.github.md");
if (!existsSync(commentPath)) {
  process.exit(0);
}

const body = readFileSync(commentPath, "utf8");
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
}

if (process.env.GITHUB_OUTPUT) {
  writeOutputs(process.env.GITHUB_OUTPUT, workspace);
}

if (githubToken) {
  await maybePublishComment({
    body,
    githubToken,
    eventPath: process.env.GITHUB_EVENT_PATH,
    apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com"
  });
}

function writeOutputs(outputPath, workspace) {
  const patchdietDir = join(workspace, ".patchdiet");
  appendFileSync(
    outputPath,
    [
      `report-md=${join(patchdietDir, "report.md")}`,
      `report-github=${join(patchdietDir, "report.github.md")}`,
      `report-html=${join(patchdietDir, "report.html")}`,
      `run-json=${join(patchdietDir, "run.json")}`,
      `cleanup-diff=${join(patchdietDir, "cleanup.diff")}`
    ].join("\n") + "\n"
  );
}

function optionalInput(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

async function warnIfConfigFromPullRequest(cwd, baseRef, headRef) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-only", `${baseRef}...${headRef}`],
      { cwd }
    );
    const changedFiles = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!changedFiles.includes("patchdiet.yaml")) {
      return;
    }

    console.error(
      "[patchdiet] WARNING: patchdiet.yaml was modified in this PR. " +
        "The commands executed in this run are read from patchdiet.yaml, so they come from the PR rather than the base branch. " +
        "Review the patchdiet.yaml changes before trusting this report."
    );

    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        [
          "> [!WARNING]",
          "> **`patchdiet.yaml` was modified in this pull request.**",
          "> The commands executed in this run are read from `patchdiet.yaml`, so they come from the PR rather than the base branch.",
          "> Review the `patchdiet.yaml` changes before trusting this report.",
          ""
        ].join("\n") + "\n",
        "utf8"
      );
    }
  } catch (error) {
    // The check is advisory: never block the run because the diff could not be read.
    console.error(
      "[patchdiet] Could not check whether patchdiet.yaml was modified in this PR: " +
        (error instanceof Error ? error.message : String(error))
    );
  }
}

async function resolveBaseRef(cwd, configBase) {
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

  throw new Error("Could not detect a base ref. Set the action 'base' input, for example: base: origin/main");
}

function githubBaseCandidates() {
  const baseRef = process.env.GITHUB_BASE_REF;
  return baseRef ? [`origin/${baseRef}`, baseRef] : [];
}

async function findUpstreamMergeBase(cwd) {
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

async function refExists(cwd, ref) {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

function uniqueStrings(value, index, array) {
  return array.indexOf(value) === index;
}

async function maybePublishComment({ body, githubToken, eventPath, apiUrl }) {
  if (!eventPath || !existsSync(eventPath)) {
    console.log("GitHub token detected, but no event payload was available for comment publishing.");
    return;
  }

  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const issueNumber = event.pull_request?.number ?? event.issue?.number;
  const repoFullName = event.repository?.full_name;

  if (!issueNumber || !repoFullName) {
    console.log("GitHub token detected, but the event payload does not include a pull request target.");
    return;
  }

  const commentsUrl = `${apiUrl}/repos/${repoFullName}/issues/${issueNumber}/comments`;
  const existing = await fetch(commentsUrl, {
    headers: githubHeaders(githubToken)
  });

  if (!existing.ok) {
    console.log(`Could not publish PatchDiet PR comment: ${existing.status} ${existing.statusText}. Falling back to step summary and artifacts.`);
    return;
  }

  const comments = await existing.json();
  const previous = Array.isArray(comments)
    ? comments.find((comment) => typeof comment.body === "string" && comment.body.includes("<!-- patchdiet-comment -->"))
    : undefined;

  const response = await fetch(
    previous?.id
      ? `${apiUrl}/repos/${repoFullName}/issues/comments/${previous.id}`
      : commentsUrl,
    {
      method: previous?.id ? "PATCH" : "POST",
      headers: githubHeaders(githubToken),
      body: JSON.stringify({ body })
    }
  );

  if (!response.ok) {
    console.log(`Could not publish PatchDiet PR comment: ${response.status} ${response.statusText}. Falling back to step summary and artifacts.`);
  }
}

async function detectRequiredCommands(cwd) {
  const packageJsonPath = join(cwd, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
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

function githubHeaders(githubToken) {
  return {
    authorization: `Bearer ${githubToken}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "user-agent": "patchdiet-action"
  };
}
