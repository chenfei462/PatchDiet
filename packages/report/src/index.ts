import { deflateSync } from "node:zlib";

import { buildReviewMetrics } from "../../core/src/insights.js";
import type { ShrinkReport } from "../../core/src/types.js";

export function renderMarkdownReport(report: ShrinkReport): string {
  return [
    "# PatchDiet Report",
    "",
    "## Summary",
    "",
    `Base: ${escapeMarkdownCodeSpan(report.baseRef)}`,
    `Head: ${escapeMarkdownCodeSpan(report.headRef)}`,
    `Input diff: ${formatSummary(report.input)}`,
    `Output diff: ${formatSummary(report.output)}`,
    `Test command: ${escapeMarkdownCodeSpan(report.testCommand.command)}`,
    `Test status: ${report.testCommand.status}`,
    `Test attempts: ${report.testCommand.attempts}`,
    `Test duration: ${report.testCommand.durationMs}ms`,
    "",
    "## Verification",
    ...renderVerificationMarkdown(report),
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
    `<p class=\"muted\"><strong>Base:</strong> <code>${escapeHtml(report.baseRef)}</code> <strong>Head:</strong> <code>${escapeHtml(report.headRef)}</code> <strong>Mode:</strong> ${escapeHtml(effectiveVerificationMode(report))}</p>`,
  renderVerificationHtml(report),
    renderEvidenceHtml("Removed", report.removals),
    renderEvidenceHtml("Kept", report.kept),
    renderEvidenceHtml("Needs human review", report.needsHumanReview),
    `<section><h2>Artifacts</h2><ul>${getArtifacts(report)
      .map((artifact) => `<li>${escapeHtml(`${artifact.label}: ${artifact.value}`)}</li>`)
      .join("")}</ul></section>`,
    "</body>",
    "</html>"
  ].join("");
}

export function renderGitHubComment(report: ShrinkReport): string {
  return [
    "<!-- patchdiet-comment -->",
    "## PatchDiet",
    "",
    verificationHeadline(report),
    "",
    "| Metric | Before | After |",
    "| --- | ---: | ---: |",
    `| Files | ${report.input.fileCount} | ${report.output.fileCount} |`,
    `| Hunks | ${report.input.hunkCount} | ${report.output.hunkCount} |`,
    `| Changed lines | ${report.input.changedLineCount} | ${report.output.changedLineCount} |`,
    "",
    `Tests: ${report.testCommand.status} with ${escapeMarkdownCodeSpan(report.testCommand.command)} (${report.testCommand.durationMs}ms, ${report.testCommand.attempts} attempt(s))`,
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

function renderVerificationHtml(report: ShrinkReport): string {
  const verification = report.verification;
  if (!verification) {
    return "<section><h2>Verification</h2><ul><li>Legacy report: no pinned final artifact evidence recorded.</li></ul></section>";
  }
  const { baseline, final: finalStage } = verification;
  const items = [
    `<li>Mode: ${escapeHtml(effectiveVerificationMode(report))}</li>`,
    `<li>Baseline (pinned HEAD <code>${escapeHtml(baseline.headCommitSha ?? "?")}</code>): ${escapeHtml(baseline.status)} in ${baseline.durationMs}ms</li>`,
    `<li>Final artifact (BASE <code>${escapeHtml(finalStage.baseCommitSha ?? "?")}</code> ← cleanup.diff): ${escapeHtml(finalStage.status)} in ${finalStage.durationMs}ms${finalStage.treesMatch === false ? " — TREE MISMATCH" : ""}</li>`
  ];
  if (finalStage.detail) {
    items.push(`<li>Final detail: ${escapeHtml(finalStage.detail)}</li>`);
  }
  if (!isReportVerifiedByEvidence(report)) {
    items.push("<li><strong>NOT VERIFIED</strong> — the final artifact was not proven (evidence does not support a verified claim).</li>");
  }
  return `<section><h2>Verification</h2><ul>${items.join("")}</ul></section>`;
}

/** Every record must prove a genuinely executed, successful, non-timed-out run. */
function commandsProveExecution(
  commands: { status: string; attempts: number; timedOut?: boolean; exitCode?: number }[]
): boolean {
  if (commands.length === 0) {
    return false;
  }
  return commands.every(
    (record) =>
      record.status === "passed"
      && record.attempts >= 1
      && record.timedOut !== true
      && record.exitCode === 0
  );
}

/**
 * P0-3 F5: the single source of truth for whether a report may claim
 * "verified". The serialized `mode` field is NEVER trusted on its own: a
 * contradictory report (mode=verified with a failed final stage, a tree
 * mismatch, missing/mismatched pinned SHAs, unexecuted final commands, or a
 * partial run) must render as NOT VERIFIED in every format. BOTH stages must
 * record nonempty executed-successful command arrays — a passing baseline
 * status without baseline command evidence proves nothing.
 */
export function isReportVerifiedByEvidence(report: ShrinkReport): boolean {
  const verification = report.verification;
  if (!verification) {
    return false; // Legacy report: no pinned final artifact evidence recorded.
  }
  if (report.mode !== "verified" || report.partial === true) {
    return false;
  }
  const { baseline, final } = verification;
  if (baseline.status !== "passed" || final.status !== "passed") {
    return false;
  }
  if (!commandsProveExecution(baseline.commands) || !commandsProveExecution(final.commands)) {
    return false;
  }
  // Both stages must have executed the SAME required oracle set, in the same
  // order: a verified claim whose baseline and final stages ran different
  // commands proves two different things and attests neither.
  if (
    baseline.commands.length !== final.commands.length
    || baseline.commands.some((record, index) => record.command !== final.commands[index]?.command)
  ) {
    return false;
  }
  if (final.treesMatch !== true) {
    return false;
  }
  if (
    final.expectedTreeSha === undefined
    || final.artifactTreeSha === undefined
    || final.expectedTreeSha !== final.artifactTreeSha
  ) {
    return false;
  }
  // The evidence must describe the exact pinned commits this report attests.
  if (
    final.baseCommitSha === undefined
    || final.baseCommitSha !== report.baseCommitSha
    || final.headCommitSha === undefined
    || final.headCommitSha !== report.headCommitSha
    || baseline.headCommitSha !== report.headCommitSha
  ) {
    return false;
  }
  return true;
}

/**
 * P0-3 F5: the mode a report may DISPLAY. Contradictory input renders as
 * unverified everywhere; the declared mode is surfaced separately as
 * "Declared mode" only when it disagrees.
 */
export function effectiveVerificationMode(report: ShrinkReport): "verified" | "unverified" {
  return isReportVerifiedByEvidence(report) ? "verified" : "unverified";
}

/**
 * P0-3: the GitHub headline must never claim verification from the baseline
 * alone — only a recorded, passed final artifact stage counts as verified.
 * Contradictory serialized input (mode=verified, failed evidence) renders as
 * NOT VERIFIED.
 */
function verificationHeadline(report: ShrinkReport): string {
  if (!report.verification) {
    return "PatchDiet generated a cleanup patch locally. This legacy report has no final artifact evidence — treat all verdicts as unverified. NOT VERIFIED";
  }
  return isReportVerifiedByEvidence(report)
    ? "PatchDiet generated a cleanup patch locally and verified the exact artifact with your tests (baseline and final BASE artifact)."
    : "PatchDiet generated a cleanup patch locally, but the final artifact could NOT be verified — treat removals as unproven. NOT VERIFIED";
}

function formatSummary(summary: ShrinkReport["input"]): string {
  return `${summary.fileCount} files, ${summary.changedLineCount} changed lines, ${summary.hunkCount} hunks`;
}

/**
 * P0-3: renders the verification evidence. Baseline and final stages are
 * always distinguishable; a report without recorded final evidence must never
 * be presented as verified, and an unverified run must visibly expose that.
 */
function renderVerificationMarkdown(report: ShrinkReport): string[] {
  const verification = report.verification;
  if (!verification) {
    return ["- NOT VERIFIED: legacy report — no pinned final artifact evidence was recorded. Treat every verdict as unverified."];
  }

  const { baseline, final: finalStage } = verification;
  const evidenceVerified = isReportVerifiedByEvidence(report);
  const effectiveMode = evidenceVerified ? "verified" : "unverified";
  const lines: string[] = [
    `- Mode: ${effectiveMode}${evidenceVerified ? "" : " (NOT VERIFIED)"}`,
    ...(report.mode !== undefined && report.mode !== effectiveMode
      ? [`- Declared mode: ${report.mode} (contradicted by recorded evidence)`]
      : []),
    `- Baseline (pinned HEAD ${baseline.headCommitSha ?? "?"}): ${baseline.status} — ` +
      `${baseline.commands.length} command(s), ${baseline.durationMs}ms`,
    `- Final artifact (BASE ${finalStage.baseCommitSha ?? "?"} ← cleanup.diff): ${finalStage.status} — ` +
      `${finalStage.commands.length} command(s), ${finalStage.durationMs}ms`
  ];
  if (finalStage.expectedTreeSha !== undefined || finalStage.artifactTreeSha !== undefined) {
    lines.push(
      `- Trees: expected ${finalStage.expectedTreeSha ?? "?"} / artifact ${finalStage.artifactTreeSha ?? "?"} — ` +
      `${finalStage.treesMatch ? "match" : "MISMATCH"}`
    );
  }
  if (finalStage.detail) {
    lines.push(`- Final detail: ${finalStage.detail}`);
  }
  if (report.partial) {
    lines.push(`- Partial: ${report.partialReason ?? ""}`);
  }
  if (!evidenceVerified) {
    lines.push(
      "- NOT VERIFIED: the final artifact was not proven (the recorded evidence does not support a verified claim); no automatic removals or delivery are trustworthy."
    );
  }
  return lines;
}

function renderEvidenceMarkdown(items: ShrinkReport["removals"]): string[] {
  if (items.length === 0) {
    return ["- none"];
  }

  return items.map(
    (item) =>
      `- ${escapeMarkdownCodeSpan(item.filePath)} ${escapeMarkdownText(item.hunkHeader)} (${escapeMarkdownText(item.category)}): ${escapeMarkdownText(item.reason)}`
  );
}

function renderEvidenceComment(items: ShrinkReport["removals"]): string[] {
  if (items.length === 0) {
    return ["- none"];
  }

  return items
    .slice(0, 6)
    .map(
      (item) =>
        `- ${escapeMarkdownCodeSpan(item.filePath)} (${escapeMarkdownText(item.category)}): ${escapeMarkdownText(item.reason)}`
    );
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

interface ArtifactEntry {
  label: string;
  value: string;
}

function getArtifacts(report: ShrinkReport): ArtifactEntry[] {
  // v2 report toggles: the artifact list is derived from report.artifacts —
  // the exact set of files THIS run wrote. Disabled formats never appear as
  // ghost paths, and no default path is invented for a file that was not
  // produced.
  const labels: Record<string, string> = {
    ".patchdiet/cleanup.diff": "Cleanup patch",
    ".patchdiet/report.md": "Markdown report",
    ".patchdiet/run.json": "JSON report",
    ".patchdiet/report.github.md": "GitHub comment report",
    ".patchdiet/report.html": "HTML report",
    ".patchdiet/evidence.md": "Evidence report",
    ".patchdiet/github-check.draft.md": "GitHub check draft (local only)"
  };
  const values: Record<string, string | undefined> = {
    ".patchdiet/cleanup.diff": report.patchPath,
    ".patchdiet/report.md": report.reportPath,
    ".patchdiet/run.json": report.reportJsonPath,
    ".patchdiet/github-check.draft.md": report.githubCheckDraftPath
  };
  const entries: ArtifactEntry[] = [];
  const seen = new Set<string>();
  for (const artifact of report.artifacts) {
    const label = labels[artifact];
    if (label === undefined || seen.has(artifact)) continue;
    seen.add(artifact);
    entries.push({ label, value: values[artifact] ?? artifact });
  }
  if (report.cleanupBranch !== undefined) {
    entries.push({ label: "Cleanup branch", value: report.cleanupBranch });
  }
  return entries;
}

function renderArtifactsMarkdown(report: ShrinkReport): string[] {
  return getArtifacts(report).map((artifact) => `- ${artifact.label}: ${escapeMarkdownText(artifact.value)}`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

/** Control characters (except tab) that can break markdown structure or hide payloads. */
const MARKDOWN_CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/g;

function flattenMarkdownControlChars(value: string): string {
  // CRLF/LF/CR line breaks all collapse to a single space so one value can
  // never push the rest of the report onto a new line or a new block.
  return value.replaceAll(/\r\n?/g, " ").replace(MARKDOWN_CONTROL_CHARS, " ");
}

/**
 * Escape a value that is rendered inside a markdown backtick code span
 * (file paths, refs, test commands).
 *
 * A raw backtick would close the span early and let the remainder of the value
 * render as live markdown — e.g. a malicious file name like
 * "`](https://evil.example)`" turns into a clickable link in a GitHub comment.
 * The fence is therefore widened past the longest backtick run in the value, a
 * space pads each side when the value itself starts or ends with a backtick
 * (so it cannot merge with the fence), and control characters such as newlines
 * are flattened so one value can never span several report lines.
 */
/**
 * Render a value as a markdown backtick code span (file paths, refs, test
 * commands). Returns the complete span, fences included, so call sites must
 * not wrap the result in extra backticks.
 *
 * A raw backtick would close the span early and let the remainder of the value
 * render as live markdown — e.g. a malicious file name like
 * "`](https://evil.example)`" turns into a clickable link in a GitHub comment.
 * Backslash escapes do not work inside code spans, so the fence is widened
 * past the longest backtick run in the value, a space pads each side when the
 * value itself starts or ends with a backtick (so it cannot merge with the
 * fence), and control characters such as newlines are flattened so one value
 * can never span several report lines.
 *
 * Values without backticks or control characters come back as `` `value` `` —
 * byte-identical to the previous unescaped rendering.
 */
export function escapeMarkdownCodeSpan(value: string): string {
  const sanitized = flattenMarkdownControlChars(value);
  // Longest run of backticks: split on non-backtick runs and take the largest remainder.
  const longestBacktickRun = sanitized
    .split(/[^`]+/)
    .reduce((max, part) => Math.max(max, part.length), 0);

  const fence = "`".repeat(longestBacktickRun + 1);
  const pad = sanitized.startsWith("`") || sanitized.endsWith("`") ? " " : "";

  return `${fence}${pad}${sanitized}${pad}${fence}`;
}

/**
 * Escape a value that is rendered as plain markdown text
 * (hunk headers, categories, reasons, artifact paths, branch names).
 *
 * Backslash-escape the characters that start inline markdown constructs
 * (code spans, links, images, autolinks/HTML tags) and flatten control
 * characters so one value can never break the report onto new lines or
 * inject new markdown blocks. Backslash itself is escaped first so the
 * escaping is idempotent under re-rendering.
 */
export function escapeMarkdownText(value: string): string {
  return flattenMarkdownControlChars(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("<", "\\<");
}

export interface DietCardModel {
  projectName: string;
  savedReviewTimePercent: number;
  changedLineReductionPercent: number;
  estimatedAttentionSavedMinutes: number;
  suggestedDeletionHunks: number;
  before: { files: number; hunks: number; lines: number };
  after: { files: number; hunks: number; lines: number };
}

export function buildDietCardModel(
  report: Pick<ShrinkReport, "input" | "output" | "removals">,
  options: { projectName?: string } = {}
): DietCardModel {
  const metrics = buildReviewMetrics(report as ShrinkReport);

  return {
    projectName: options.projectName ?? "PatchDiet",
    savedReviewTimePercent: metrics.savedReviewTimePercent,
    changedLineReductionPercent: metrics.changedLineReductionPercent,
    estimatedAttentionSavedMinutes: metrics.reviewMinutesBefore - metrics.reviewMinutesAfter,
    suggestedDeletionHunks: metrics.suggestedDeletionHunks,
    before: {
      files: metrics.before.fileCount,
      hunks: metrics.before.hunkCount,
      lines: metrics.before.changedLineCount
    },
    after: {
      files: metrics.after.fileCount,
      hunks: metrics.after.hunkCount,
      lines: metrics.after.changedLineCount
    }
  };
}

export function renderDietBadgeMarkdown(model: DietCardModel, imageUrl: string): string {
  return `![PatchDiet -${model.changedLineReductionPercent}%](${escapeMarkdownImageUrl(imageUrl)})`;
}

export function renderDietCardHtml(model: DietCardModel): string {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>PatchDiet Card - ${escapeHtml(model.projectName)}</title>`,
    "<style>",
    ":root{color-scheme:dark;--ink:#f5f1e8;--muted:#a9b4ac;--paper:#101513;--line:#314138;--accent:#9cf36b;--warn:#ffcc66;}",
    "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c100e;color:var(--ink);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
    ".card{width:min(920px,calc(100vw - 32px));aspect-ratio:1.91/1;background:linear-gradient(135deg,#101513 0%,#162019 55%,#0e1511 100%);border:1px solid var(--line);padding:42px;display:grid;grid-template-columns:1.15fr .85fr;gap:28px;box-shadow:0 28px 80px rgba(0,0,0,.45);}",
    ".brand{font-size:15px;text-transform:uppercase;letter-spacing:0;color:var(--accent);}.project{font-size:26px;margin-top:12px;color:var(--muted)}",
    "h1{font-family:Georgia,serif;font-weight:700;font-size:74px;line-height:.9;margin:42px 0 12px;letter-spacing:0;color:var(--ink)}",
    ".sub{font-size:22px;color:var(--muted);line-height:1.35;max-width:520px}.rail{display:grid;gap:14px;align-content:center}.row{border:1px solid var(--line);padding:18px;display:grid;grid-template-columns:1fr auto;gap:12px;background:rgba(255,255,255,.03)}",
    ".label{color:var(--muted);font-size:14px;text-transform:uppercase}.value{font-size:34px;color:var(--ink)}.after .value{color:var(--accent)}.badge{align-self:end;color:var(--warn);font-size:15px}",
    "</style>",
    "</head>",
    "<body>",
    "<main class=\"card\" aria-label=\"PatchDiet share card\">",
    "<section>",
    "<div class=\"brand\">PatchDiet / PR Auto-Cleaner</div>",
    `<div class=\"project\">${escapeHtml(model.projectName)}</div>`,
    `<h1>${model.changedLineReductionPercent}% review noise removed</h1>`,
    `<p class=\"sub\">${model.before.lines} changed lines became ${model.after.lines}. Estimated attention saved: ${model.estimatedAttentionSavedMinutes}m.</p>`,
    `<div class=\"badge\">Suggested deletion hunks: ${model.suggestedDeletionHunks}</div>`,
    "</section>",
    "<section class=\"rail\">",
    renderMetricRow("Before", `${model.before.files} files`, `${model.before.hunks} hunks / ${model.before.lines} lines`, false),
    renderMetricRow("After", `${model.after.files} files`, `${model.after.hunks} hunks / ${model.after.lines} lines`, true),
    renderMetricRow("Diff reduction", `-${model.changedLineReductionPercent}%`, "changed lines", true),
    "</section>",
    "</main>",
    "</body>",
    "</html>"
  ].join("");
}

export function renderDietCardSvg(model: DietCardModel): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628" viewBox="0 0 1200 628" role="img" aria-label="PatchDiet removed ${model.changedLineReductionPercent}% review noise">`,
    "<defs>",
    "<linearGradient id=\"bg\" x1=\"0\" x2=\"1\" y1=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#101513\"/><stop offset=\".55\" stop-color=\"#162019\"/><stop offset=\"1\" stop-color=\"#0e1511\"/></linearGradient>",
    "</defs>",
    "<rect width=\"1200\" height=\"628\" fill=\"url(#bg)\"/>",
    "<rect x=\"32\" y=\"32\" width=\"1136\" height=\"564\" fill=\"none\" stroke=\"#314138\"/>",
    "<text x=\"72\" y=\"96\" fill=\"#9cf36b\" font-family=\"Consolas,monospace\" font-size=\"24\">PatchDiet / PR Auto-Cleaner</text>",
    `<text x="72" y="142" fill="#a9b4ac" font-family="Consolas,monospace" font-size="32">${escapeXml(model.projectName)}</text>`,
    `<text x="72" y="266" fill="#f5f1e8" font-family="Georgia,serif" font-size="88" font-weight="700">${model.changedLineReductionPercent}%</text>`,
    "<text x=\"72\" y=\"334\" fill=\"#f5f1e8\" font-family=\"Georgia,serif\" font-size=\"70\" font-weight=\"700\">review noise removed</text>",
    `<text x="72" y="402" fill="#a9b4ac" font-family="Consolas,monospace" font-size="28">${model.before.lines} changed lines became ${model.after.lines}; ${model.estimatedAttentionSavedMinutes}m saved</text>`,
    renderSvgPanel(720, 120, "Before", `${model.before.files} files`, `${model.before.hunks} hunks / ${model.before.lines} lines`, "#f5f1e8"),
    renderSvgPanel(720, 270, "After", `${model.after.files} files`, `${model.after.hunks} hunks / ${model.after.lines} lines`, "#9cf36b"),
    renderSvgPanel(720, 420, "Diff reduction", `-${model.changedLineReductionPercent}%`, "changed lines", "#9cf36b"),
    "</svg>"
  ].join("");
}

export function renderDietCardPng(model: DietCardModel): Uint8Array {
  const width = 1200;
  const height = 628;
  const canvas = createRasterCanvas(width, height);

  canvas.fillGradient([16, 21, 19], [22, 32, 25], [14, 21, 17]);
  canvas.strokeRect(32, 32, 1136, 564, [49, 65, 56]);
  drawText(canvas, "PATCHDIET / PR AUTO-CLEANER", 72, 82, 4, [156, 243, 107]);
  drawText(canvas, fitText(model.projectName.toUpperCase(), 32), 72, 130, 4, [169, 180, 172]);
  drawText(canvas, `${model.changedLineReductionPercent}% REVIEW`, 72, 216, 8, [245, 241, 232]);
  drawText(canvas, "NOISE REMOVED", 72, 306, 7, [245, 241, 232]);
  drawText(canvas, `${model.before.lines} CHANGED LINES BECAME ${model.after.lines}; ${model.estimatedAttentionSavedMinutes}M SAVED`, 72, 384, 4, [169, 180, 172]);
  drawText(canvas, `SUGGESTED DELETION HUNKS: ${model.suggestedDeletionHunks}`, 72, 542, 3, [255, 204, 102]);
  drawPanel(canvas, 720, 120, "BEFORE", fitText(`${model.before.files} FILES`, 12), fitText(`${model.before.hunks} HUNKS / ${model.before.lines} LINES`, 18), [245, 241, 232]);
  drawPanel(canvas, 720, 270, "AFTER", fitText(`${model.after.files} FILES`, 12), fitText(`${model.after.hunks} HUNKS / ${model.after.lines} LINES`, 18), [156, 243, 107]);
  drawPanel(canvas, 720, 420, "DIFF REDUCTION", `-${model.changedLineReductionPercent}%`, "CHANGED LINES", [156, 243, 107]);

  return encodePng(width, height, canvas.pixels);
}

function renderMetricRow(label: string, value: string, detail: string, after: boolean): string {
  return [
    `<div class="row${after ? " after" : ""}">`,
    "<div>",
    `<div class="label">${escapeHtml(label)}</div>`,
    `<div class="value">${escapeHtml(value)}</div>`,
    "</div>",
    `<div class="label">${escapeHtml(detail)}</div>`,
    "</div>"
  ].join("");
}

function renderSvgPanel(x: number, y: number, label: string, value: string, detail: string, color: string): string {
  return [
    `<rect x="${x}" y="${y}" width="396" height="112" fill="rgba(255,255,255,.03)" stroke="#314138"/>`,
    `<text x="${x + 28}" y="${y + 38}" fill="#a9b4ac" font-family="Consolas,monospace" font-size="20">${escapeXml(label)}</text>`,
    `<text x="${x + 28}" y="${y + 82}" fill="${color}" font-family="Consolas,monospace" font-size="40">${escapeXml(value)}</text>`,
    `<text x="${x + 240}" y="${y + 82}" fill="#a9b4ac" font-family="Consolas,monospace" font-size="20">${escapeXml(detail)}</text>`
  ].join("");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeMarkdownImageUrl(value: string): string {
  return value
    .replaceAll(/[\u0000-\u001f\u007f]/g, "")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll(" ", "%20");
}

interface RasterCanvas {
  width: number;
  height: number;
  pixels: Uint8Array;
  fillGradient(start: RGB, middle: RGB, end: RGB): void;
  fillRect(x: number, y: number, width: number, height: number, color: RGB): void;
  strokeRect(x: number, y: number, width: number, height: number, color: RGB): void;
}

type RGB = [number, number, number];

function createRasterCanvas(width: number, height: number): RasterCanvas {
  const pixels = new Uint8Array(width * height * 4);

  function setPixel(x: number, y: number, color: RGB): void {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const offset = (y * width + x) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = 255;
  }

  return {
    width,
    height,
    pixels,
    fillGradient(start, middle, end) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const t = (x / width + y / height) / 2;
          const color = t < 0.55
            ? mixRgb(start, middle, t / 0.55)
            : mixRgb(middle, end, (t - 0.55) / 0.45);
          setPixel(x, y, color);
        }
      }
    },
    fillRect(x, y, rectWidth, rectHeight, color) {
      for (let py = y; py < y + rectHeight; py += 1) {
        for (let px = x; px < x + rectWidth; px += 1) {
          setPixel(px, py, color);
        }
      }
    },
    strokeRect(x, y, rectWidth, rectHeight, color) {
      this.fillRect(x, y, rectWidth, 2, color);
      this.fillRect(x, y + rectHeight - 2, rectWidth, 2, color);
      this.fillRect(x, y, 2, rectHeight, color);
      this.fillRect(x + rectWidth - 2, y, 2, rectHeight, color);
    }
  };
}

function drawPanel(canvas: RasterCanvas, x: number, y: number, label: string, value: string, detail: string, valueColor: RGB): void {
  canvas.fillRect(x, y, 396, 112, [22, 31, 25]);
  canvas.strokeRect(x, y, 396, 112, [49, 65, 56]);
  drawText(canvas, label, x + 28, y + 26, 3, [169, 180, 172]);
  drawText(canvas, value, x + 28, y + 70, 5, valueColor);
  drawText(canvas, detail, x + 240, y + 76, 2, [169, 180, 172]);
}

function drawText(canvas: RasterCanvas, text: string, x: number, y: number, scale: number, color: RGB): void {
  let cursor = x;

  for (const char of text.toUpperCase()) {
    const glyph = FONT[char] ?? FONT["?"];

    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== "1") {
          continue;
        }

        canvas.fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
      }
    }

    cursor += 6 * scale;
  }
}

function fitText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const scanlineLength = width * 4 + 1;
  const raw = new Uint8Array(scanlineLength * height);

  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * scanlineLength;
    raw[rawOffset] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rawOffset + 1);
  }

  return concatBytes([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", concatBytes([uint32(width), uint32(height), Uint8Array.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array())
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([...type].map((char) => char.charCodeAt(0)));
  const crcInput = concatBytes([typeBytes, data]);

  return concatBytes([uint32(data.length), typeBytes, data, uint32(crc32(crcInput))]);
}

function uint32(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ]);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const FONT: Record<string, string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "#": ["01010", "11111", "01010", "01010", "11111", "01010", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "11000", "11000"],
  "%": ["11001", "11010", "00100", "01000", "10110", "00110", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "?": ["11110", "00001", "00010", "00100", "00100", "00000", "00100"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  "J": ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"]
};

/**
 * v2 controls: the optional rich EVIDENCE report. Written only when
 * report.evidence is enabled; suppressing it never suppresses the mandatory
 * baseline/final verification evidence in the main report and run.json.
 */
export function renderEvidenceReport(report: ShrinkReport): string {
  const optional = report.optionalCommands ?? [];
  const targeted = report.targetedVerification;
  return [
    "# PatchDiet Evidence Report",
    "",
    "This report is OPTIONAL rich output (report.evidence). The mandatory",
    "baseline/final verification evidence always appears in report.md and run.json",
    "regardless of this toggle.",
    "",
    "## Verification stages",
    "",
    `Baseline: ${report.verification?.baseline.status ?? "not recorded"} (${report.verification?.baseline.durationMs ?? 0}ms)`,
    `Final artifact: ${report.verification?.final.status ?? "not recorded"} (${report.verification?.final.durationMs ?? 0}ms)`,
    report.verification?.final.artifactTreeSha !== undefined
      ? `Artifact tree: ${report.verification.final.artifactTreeSha}`
      : "Artifact tree: not recorded",
    report.verification?.final.treesMatch !== undefined
      ? `Trees match: ${report.verification.final.treesMatch}`
      : "Trees match: not recorded",
    "",
    "### Baseline commands",
    ...(report.verification?.baseline.commands ?? []).map((command) =>
      `- ${escapeMarkdownCodeSpan(command.command)}: ${command.status} (exit ${command.exitCode ?? "n/a"}, attempts ${command.attempts}, ${command.durationMs}ms)`
    ),
    "",
    "### Final artifact commands",
    ...(report.verification?.final.commands ?? []).map((command) =>
      `- ${escapeMarkdownCodeSpan(command.command)}: ${command.status} (exit ${command.exitCode ?? "n/a"}, attempts ${command.attempts}, ${command.durationMs}ms)`
    ),
    "",
    "## Optional advisory commands",
    "",
    ...(optional.length > 0
      ? optional.map((record) =>
          `- ${escapeMarkdownCodeSpan(record.command)}: ${record.status} (exit ${record.exitCode ?? "n/a"}, ${record.durationMs}ms, advisory)` +
          (record.mutatedTrackedSource ? " — MUTATED TRACKED SOURCE (artifact invalidated)" : "")
        )
      : ["- none configured"]),
    "",
    "Advisory commands never replace the required oracle and never upgrade a verdict.",
    "",
    "## Targeted-first screening",
    "",
    ...(targeted === undefined
      ? ["- not enabled for this run"]
      : [
          `- used: ${targeted.used}`,
          `- outcome: ${targeted.outcome}`,
          `- mapping provenance: ${escapeMarkdownText(targeted.mappingProvenance)}`,
          ...(targeted.commands.length > 0
            ? targeted.commands.map((command) => `- ${escapeMarkdownCodeSpan(command)}`)
            : []),
          `- ${escapeMarkdownText(targeted.detail)}`
        ]),
    "",
    "## Run audit",
    "",
    `Mode: ${report.mode ?? "unknown"}`,
    report.partial ? `Partial: ${escapeMarkdownText(report.partialReason ?? "yes")}` : "Partial: no",
    `Started: ${report.startedAt ?? "unknown"}`,
    `Finished: ${report.finishedAt ?? "unknown"}`,
    `Version: ${report.patchdietVersion ?? "unknown"}`,
    `Base commit: ${report.baseCommitSha ?? "unknown"}`,
    `Head commit: ${report.headCommitSha ?? "unknown"}`
  ].join("\n");
}

/**
 * v2 controls: the LOCAL GitHub check-run draft. External publication is
 * OUTSIDE the CLI's scope — this file is an explicit local draft with a
 * limitation statement; PatchDiet never posts it anywhere.
 */
export function renderGithubCheckDraft(report: ShrinkReport): string {
  return [
    "# GitHub check-run draft (LOCAL ONLY — NOT PUBLISHED)",
    "",
    "LIMITATION: external check-run publication is outside the PatchDiet CLI's",
    "scope. This file is a local draft for a human or an external integration to",
    "review; PatchDiet does not post, upload or transmit it anywhere.",
    "",
    "## Draft conclusion",
    "",
    `Conclusion: ${report.mode === "verified" ? "success" : "failure"}`,
    `Mode: ${report.mode ?? "unknown"}`,
    report.partial ? `Partial: ${escapeMarkdownText(report.partialReason ?? "yes")}` : "Partial: no",
    `Final artifact verification: ${report.verification?.final.status ?? "not recorded"}`,
    "",
    "## Draft summary text",
    "",
    `PatchDiet ${report.mode === "verified" ? "verified" : "could not verify"} the cleanup artifact for ` +
      `${escapeMarkdownText(report.baseRef)}...${escapeMarkdownText(report.headRef)}; ` +
      `${report.removals.length} removal(s), ${report.needsHumanReview.length} item(s) need human review.`
  ].join("\n");
}
