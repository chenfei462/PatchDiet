function flattenCell(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function escapeCell(value) {
  return flattenCell(value)
    .replace(/\\/gu, "\\\\")
    .replace(/\|/gu, "\\|");
}

function formatMetrics(metrics = {}) {
  const entries = [
    ["Saved review time", metrics.savedReviewTimePercent],
    ["Suggested deletion hunks", metrics.suggestedDeletionHunks]
  ];

  return entries
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([label, value]) => `${label}: ${value}${typeof value === "number" ? "%" : ""}`);
}

export function renderPreviewComment({ input, output, metrics, suggestions = [], disclaimer } = {}) {
  const lines = [
    "<!-- patchdiet-comment -->",
    "## PatchDiet",
    "",
    "### Preview",
    "",
    "🎨 **This is a preview.** No changes have been applied.",
    ""
  ];

  if (input || output) {
    lines.push("| Stage | Files | Hunks | Changed lines |", "|-------|-------|-------|---------------|");
    if (input) {
      lines.push(`| Input | ${input.fileCount ?? 0} | ${input.hunkCount ?? 0} | ${input.changedLineCount ?? 0} |`);
    }
    if (output) {
      lines.push(`| Output | ${output.fileCount ?? 0} | ${output.hunkCount ?? 0} | ${output.changedLineCount ?? 0} |`);
    }
    lines.push("");
  }

  const metricLines = formatMetrics(metrics);
  if (metricLines.length > 0) {
    lines.push(...metricLines.map((line) => `- ${line}`), "");
  }

  if (suggestions.length > 0) {
    lines.push("| File | Category | Reason |", "|------|----------|--------|");
    for (const suggestion of suggestions) {
      lines.push(
        `| ${escapeCell(suggestion.filePath)} | ${escapeCell(suggestion.category)} | ${escapeCell(suggestion.reason)} |`
      );
    }
    lines.push("");
  }

  lines.push(`*${disclaimer || "Preview mode"}.`);

  return lines.join("\n");
}
