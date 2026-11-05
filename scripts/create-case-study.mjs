import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const insightsModulePath = join(process.cwd(), "dist", "packages", "core", "src", "insights.js");
if (!existsSync(insightsModulePath)) {
  runNpm(["run", "build"], process.cwd());
}
const { analyzeDiffPreview } = await import(pathToFileURL(insightsModulePath).href);

const outDir = join(process.cwd(), "docs", "case-studies");
mkdirSync(outDir, { recursive: true });

const prUrl = process.env.PATCHDIET_CASE_PR_URL ?? "https://github.com/octocat/Hello-World/pull/6";
const prMatch = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)\/?$/.exec(prUrl);
if (!prMatch) {
  throw new Error("PATCHDIET_CASE_PR_URL must be a GitHub pull request URL");
}
const [, repository, pullRequest] = prMatch;
const slug = `${repository.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-pr-${pullRequest}`;
const projectName = `${repository}#${pullRequest}`;
const diff = process.env.PATCHDIET_CASE_DIFF ?? `diff --git a/README b/README
index c57eff55e..980a0d5f1 100644
--- a/README
+++ b/README
@@ -1 +1 @@
-Hello World!
\\ No newline at end of file
+Hello World!
`;
const preview = analyzeDiffPreview(diff, { projectName });

writeFileSync(join(outDir, `${slug}.diff`), diff, "utf8");
writeFileSync(
  join(outDir, `${slug}.md`),
  [
    `# Case Study: ${repository} PR #${pullRequest}`,
    "",
    "Status: reproducible public PR preview",
    "",
    "This case study uses a public GitHub pull request diff. It is intentionally small and does not claim that PatchDiet ran the repository test suite. It proves the PR URL fetch and case-study workflow, not a dramatic shrink result.",
    "",
    `PR: ${prUrl}`,
    `Repository: \`${repository}\``,
    "PatchDiet mode: Web demo preview / diff analysis",
    "Test command: not applicable; repository has no configured automated test command for this sample",
    "",
    "## Before / After",
    "",
    "| Metric | Before | After |",
    "| --- | ---: | ---: |",
    `| Files | ${preview.input.fileCount} | ${preview.output.fileCount} |`,
    `| Hunks | ${preview.input.hunkCount} | ${preview.output.hunkCount} |`,
    `| Changed lines | ${preview.input.changedLineCount} | ${preview.output.changedLineCount} |`,
    `| Suggested deletion hunks | 0 | ${preview.metrics.suggestedDeletionHunks} |`,
    `| Estimated review-time saved | 0% | ${preview.metrics.savedReviewTimePercent}% |`,
    "",
    "## Reproduce",
    "",
    "```bash",
    "npm ci",
    "npm run build",
    "npm run demo",
    "# Open http://127.0.0.1:4173/demo/ and paste:",
    `# ${prUrl}`,
    "```",
    "",
    "Or inspect the saved diff:",
    "",
    "```bash",
    `cat docs/case-studies/${slug}.diff`,
    "```",
    "",
    "## Notes",
    "",
    "- The PR changes only a trailing newline in README.",
    "- PatchDiet preview should not invent removals here.",
    "- This is useful as a public smoke case for PR URL fetching and honest labeling.",
    ""
  ].join("\n"),
  "utf8"
);

console.log(`Wrote docs/case-studies/${slug}.md`);

function runNpm(args, cwd, stdio = "inherit") {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...args], { cwd, stdio });
    return;
  }

  execFileSync("npm", args, { cwd, stdio });
}
