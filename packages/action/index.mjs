import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
const base = process.env.INPUT_BASE ?? "origin/main";
const head = process.env.INPUT_HEAD ?? "HEAD";
const testCommand = process.env.INPUT_TEST;
const lintCommand = process.env.INPUT_LINT;
const typecheckCommand = process.env.INPUT_TYPECHECK;
const githubToken = process.env.INPUT_GITHUB_TOKEN;
const actionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = join(actionRoot, "dist", "packages", "cli", "src", "index.js");

if (!existsSync(cliPath)) {
  execFileSync("npm", ["run", "build"], { cwd: actionRoot, stdio: "inherit", env: process.env });
}

execFileSync(
  "node",
  [
    cliPath,
    "shrink",
    "--base",
    base,
    "--head",
    head,
    ...(testCommand ? ["--test", testCommand] : []),
    ...(lintCommand ? ["--lint", lintCommand] : []),
    ...(typecheckCommand ? ["--typecheck", typecheckCommand] : [])
  ],
  { cwd: workspace, stdio: "inherit", env: { ...process.env, PATCHDIET_TARGET_CWD: workspace } }
);

const commentPath = join(workspace, ".patchdiet", "report.github.md");
if (!existsSync(commentPath)) {
  process.exit(0);
}

const body = readFileSync(commentPath, "utf8");
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
}

if (githubToken) {
  await maybePostComment({
    body,
    githubToken,
    eventPath: process.env.GITHUB_EVENT_PATH,
    apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com"
  });
}

async function maybePostComment({ body, githubToken, eventPath, apiUrl }) {
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

  const response = await fetch(`${apiUrl}/repos/${repoFullName}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${githubToken}`,
      "content-type": "application/json",
      "user-agent": "patchdiet-action"
    },
    body: JSON.stringify({ body })
  });

  if (!response.ok) {
    throw new Error(`Failed to post PatchDiet comment: ${response.status} ${response.statusText}`);
  }
}
