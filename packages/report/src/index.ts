import type { ShrinkReport } from "../../core/src/types.js";

export function renderMarkdownReport(report: ShrinkReport): string {
  return [
    "# PatchDiet Report",
    "",
    `Base: \`${report.baseRef}\``,
    `Input diff: ${formatSummary(report.input)}`,
    `Output diff: ${formatSummary(report.output)}`,
    "",
    "## High-confidence removals",
    ...renderEvidenceMarkdown(report.removals),
    "",
    "## Kept hunks",
    ...renderEvidenceMarkdown(report.kept),
    "",
    "## Needs human review",
    ...renderEvidenceMarkdown(report.needsHumanReview),
    "",
    `Cleanup branch: ${report.cleanupBranch ?? "not created"}`,
    `Cleanup patch: ${report.patchPath ?? "not generated"}`
  ].join("\n");
}

export function renderHtmlReport(report: ShrinkReport): string {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<title>PatchDiet Report</title>",
    "<style>body{font-family:Arial,sans-serif;max-width:960px;margin:40px auto;padding:0 16px;}section{margin:24px 0;}li{margin:8px 0;}code{background:#f3f3f3;padding:2px 4px;}</style>",
    "</head>",
    "<body>",
    "<h1>PatchDiet Report</h1>",
    `<p><strong>Base:</strong> <code>${escapeHtml(report.baseRef)}</code></p>`,
    `<p><strong>Input diff:</strong> ${escapeHtml(formatSummary(report.input))}</p>`,
    `<p><strong>Output diff:</strong> ${escapeHtml(formatSummary(report.output))}</p>`,
    renderEvidenceHtml("High-confidence removals", report.removals),
    renderEvidenceHtml("Kept hunks", report.kept),
    renderEvidenceHtml("Needs human review", report.needsHumanReview),
    `<p><strong>Cleanup branch:</strong> ${escapeHtml(report.cleanupBranch ?? "not created")}</p>`,
    `<p><strong>Cleanup patch:</strong> ${escapeHtml(report.patchPath ?? "not generated")}</p>`,
    "</body>",
    "</html>"
  ].join("");
}

export function renderGitHubComment(report: ShrinkReport): string {
  return [
    "PatchDiet found a smaller equivalent patch.",
    "",
    `Input: ${formatSummary(report.input)}`,
    `Minimal candidate: ${formatSummary(report.output)}`,
    "",
    "High-confidence removals:",
    ...renderEvidenceComment(report.removals),
    "",
    "Kept hunks:",
    ...renderEvidenceComment(report.kept),
    "",
    `Cleanup patch artifact: ${report.patchPath ?? "not generated"}`
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
      `- \`${item.filePath}\` ${item.hunkHeader}: ${item.reason}`
  );
}

function renderEvidenceComment(items: ShrinkReport["removals"]): string[] {
  if (items.length === 0) {
    return ["- none"];
  }

  return items.map((item) => `- ${item.filePath}: ${item.reason}`);
}

function renderEvidenceHtml(title: string, items: ShrinkReport["removals"]): string {
  const list = items.length === 0
    ? "<li>none</li>"
    : items
        .map(
          (item) =>
            `<li><code>${escapeHtml(item.filePath)}</code> ${escapeHtml(item.hunkHeader)}: ${escapeHtml(item.reason)}</li>`
        )
        .join("");

  return `<section><h2>${escapeHtml(title)}</h2><ul>${list}</ul></section>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
