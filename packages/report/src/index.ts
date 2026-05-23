import type { ShrinkReport } from "../../core/src/types.js";

export function renderMarkdownReport(report: ShrinkReport): string {
  return [
    "# PatchDiet Report",
    "",
    "## Summary",
    "",
    `Base: \`${report.baseRef}\``,
    `Head: \`${report.headRef}\``,
    `Input diff: ${formatSummary(report.input)}`,
    `Output diff: ${formatSummary(report.output)}`,
    `Test command: \`${report.testCommand.command}\``,
    `Test status: ${report.testCommand.status}`,
    `Test attempts: ${report.testCommand.attempts}`,
    `Test duration: ${report.testCommand.durationMs}ms`,
    "",
    "Safety: PatchDiet proves only that the cleanup patch passes the configured checks. It is not a semantic-equivalence proof.",
    "",
    "## Removed",
    ...renderEvidenceMarkdown(report.removals),
    "",
    "## Kept",
    ...renderEvidenceMarkdown(report.kept),
    "",
    "## Needs human review",
    ...renderEvidenceMarkdown(report.needsHumanReview),
    "",
    "## Artifacts",
    "",
    ...renderArtifactsMarkdown(report)
  ].join("\n");
}

export function renderHtmlReport(report: ShrinkReport): string {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<title>PatchDiet Report</title>",
    "<style>body{font-family:Arial,sans-serif;max-width:1040px;margin:40px auto;padding:0 16px;color:#17202a;}section{margin:28px 0;}li{margin:8px 0;}code{background:#f3f3f3;padding:2px 4px;border-radius:4px;}table{border-collapse:collapse;width:100%;margin:16px 0;}td,th{border:1px solid #d8dee4;padding:8px;text-align:left;}th{background:#f6f8fa;}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.panel{border:1px solid #d8dee4;border-radius:8px;padding:16px}.muted{color:#57606a}</style>",
    "</head>",
    "<body>",
    "<h1>PatchDiet Report</h1>",
    "<section class=\"summary\">",
    `<div class=\"panel\"><h2>Before</h2><p>${escapeHtml(formatSummary(report.input))}</p></div>`,
    `<div class=\"panel\"><h2>After</h2><p>${escapeHtml(formatSummary(report.output))}</p></div>`,
    `<div class=\"panel\"><h2>Tests</h2><p><code>${escapeHtml(report.testCommand.command)}</code></p><p>${escapeHtml(report.testCommand.status)} in ${report.testCommand.durationMs}ms over ${report.testCommand.attempts} attempt(s)</p></div>`,
    "</section>",
    "<p class=\"muted\"><strong>Safety:</strong> PatchDiet proves only that the cleanup patch passes the configured checks. It is not a semantic-equivalence proof.</p>",
    `<p class=\"muted\"><strong>Base:</strong> <code>${escapeHtml(report.baseRef)}</code> <strong>Head:</strong> <code>${escapeHtml(report.headRef)}</code></p>`,
    renderEvidenceHtml("Removed", report.removals),
    renderEvidenceHtml("Kept", report.kept),
    renderEvidenceHtml("Needs human review", report.needsHumanReview),
    `<section><h2>Artifacts</h2><ul>${renderArtifactsMarkdown(report).map((item) => `<li>${escapeHtml(item.replace(/^- /, ""))}</li>`).join("")}</ul></section>`,
    "</body>",
    "</html>"
  ].join("");
}

export function renderGitHubComment(report: ShrinkReport): string {
  return [
    "<!-- patchdiet-comment -->",
    "## PatchDiet",
    "",
    "Put your AI-generated PR on a diet. PatchDiet generated a cleanup patch locally and verified it with your tests.",
    "",
    "| Metric | Before | After |",
    "| --- | ---: | ---: |",
    `| Files | ${report.input.fileCount} | ${report.output.fileCount} |`,
    `| Hunks | ${report.input.hunkCount} | ${report.output.hunkCount} |`,
    `| Changed lines | ${report.input.changedLineCount} | ${report.output.changedLineCount} |`,
    "",
    `Tests: ${report.testCommand.status} with \`${report.testCommand.command}\` (${report.testCommand.durationMs}ms, ${report.testCommand.attempts} attempt(s))`,
    `Removed: ${report.removals.length} | Kept: ${report.kept.length} | Needs review: ${report.needsHumanReview.length}`,
    "Safety: Not a semantic-equivalence proof; PatchDiet only verifies the cleanup patch against the configured checks.",
    "",
    "Cleanup patch: download the workflow artifact or inspect `.patchdiet/cleanup.diff`.",
    "",
    "<details><summary>Why hunks were removed or kept</summary>",
    "",
    "**Removed**",
    ...renderEvidenceComment(report.removals),
    "",
    "**Kept**",
    ...renderEvidenceComment(report.kept),
    "",
    "**Needs human review**",
    ...renderEvidenceComment(report.needsHumanReview),
    "",
    "</details>"
  ].join("\n");
}

function formatSummary(summary: ShrinkReport["input"]): string {
  return `${summary.fileCount} files, ${summary.changedLineCount} changed lines, ${summary.hunkCount} hunks`;
}

function renderEvidenceMarkdown(items: ShrinkReport["removals"]): string[] {
  if (items.length === 0) {
    return ["- none"];
  }

  return items.map(
    (item) =>
      `- \`${item.filePath}\` ${item.hunkHeader} (${item.category}): ${item.reason}`
  );
}

function renderEvidenceComment(items: ShrinkReport["removals"]): string[] {
  if (items.length === 0) {
    return ["- none"];
  }

  return items.slice(0, 6).map((item) => `- \`${item.filePath}\` (${item.category}): ${item.reason}`);
}

function renderEvidenceHtml(title: string, items: ShrinkReport["removals"]): string {
  const list = items.length === 0
    ? "<li>none</li>"
    : items
        .map(
          (item) =>
            `<li><code>${escapeHtml(item.filePath)}</code> ${escapeHtml(item.hunkHeader)} <strong>${escapeHtml(item.category)}</strong>: ${escapeHtml(item.reason)}</li>`
        )
        .join("");

  return `<section><h2>${escapeHtml(title)}</h2><ul>${list}</ul></section>`;
}

function renderArtifactsMarkdown(report: ShrinkReport): string[] {
  return [
    `- Cleanup patch: ${report.patchPath ?? ".patchdiet/cleanup.diff"}`,
    `- Markdown report: ${report.reportPath ?? ".patchdiet/report.md"}`,
    `- JSON report: ${report.reportJsonPath ?? ".patchdiet/run.json"}`,
    `- GitHub comment report: .patchdiet/report.github.md`,
    `- HTML report: .patchdiet/report.html`,
    `- Cleanup branch: ${report.cleanupBranch ?? "not created"}`
  ];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
