import type { ShrinkReport } from "./types.js";

interface ReviewMetrics {
  before: { fileCount: number; hunkCount: number; changedLineCount: number };
  after: { fileCount: number; hunkCount: number; changedLineCount: number };
  changedLineReductionPercent: number;
  fileReductionPercent: number;
  hunkReductionPercent: number;
  savedReviewTimePercent: number;
  suggestedDeletionHunks: number;
  reviewMinutesBefore: number;
  reviewMinutesAfter: number;
}

interface VerifiedReceiptSummary {
  headline: string;
  hook: string;
  verificationStatus: string;
  projectName: string;
  reviewNoiseRemovedPercent: number;
  humanAttentionSavedMinutes: number;
  testCommand: string;
  testStatus: string;
  removedCount: number;
  keptCount: number;
  needsReviewCount: number;
  safetyNote: string;
  dietCardPath: string;
}

interface JudgeModeSummary {
  headline: string;
  hook: string;
  verificationStatus: string;
  verificationReceipt: string;
  reviewNoiseRemovedPercent: number;
  humanAttentionSavedMinutes: number;
  cliProofCommand: string;
}

interface DiffPreview {
  projectName: string;
  mode: string;
  verificationStatus: string;
  input: { fileCount: number; hunkCount: number; addedLineCount: number; removedLineCount: number; changedLineCount: number };
  output: { fileCount: number; hunkCount: number; addedLineCount: number; removedLineCount: number; changedLineCount: number };
  metrics: ReviewMetrics;
  suggestions: Array<{ filePath: string; hunkHeader: string; category: string; reason: string; verificationReceipt: string }>;
  disclaimer: string;
  judgeMode: JudgeModeSummary;
}

function estimateReviewMinutes(summary: { fileCount: number; hunkCount: number; changedLineCount: number }): number {
  return Math.max(1, Math.ceil(summary.changedLineCount / 20 + summary.fileCount * 0.75 + summary.hunkCount * 0.5));
}

function percentReduced(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((before - after) / before) * 100)));
}

export function buildReviewMetrics(report: ShrinkReport): ReviewMetrics {
  const reviewMinutesBefore = estimateReviewMinutes(report.input);
  const reviewMinutesAfter = estimateReviewMinutes(report.output);
  const suggestedDeletionHunks = report.removals.length;
  return {
    before: { fileCount: report.input.fileCount, hunkCount: report.input.hunkCount, changedLineCount: report.input.changedLineCount },
    after: { fileCount: report.output.fileCount, hunkCount: report.output.hunkCount, changedLineCount: report.output.changedLineCount },
    changedLineReductionPercent: percentReduced(report.input.changedLineCount, report.output.changedLineCount),
    fileReductionPercent: percentReduced(report.input.fileCount, report.output.fileCount),
    hunkReductionPercent: percentReduced(report.input.hunkCount, report.output.hunkCount),
    savedReviewTimePercent: percentReduced(reviewMinutesBefore, reviewMinutesAfter),
    suggestedDeletionHunks,
    reviewMinutesBefore,
    reviewMinutesAfter
  };
}

export function buildVerifiedReceiptSummary(
  report: ShrinkReport,
  options: { projectName: string }
): VerifiedReceiptSummary {
  const metrics = buildReviewMetrics(report);
  return {
    headline: "Verified Cleanup Receipt",
    hook: "Tests still pass. Review less diff.",
    verificationStatus: "verified",
    projectName: options.projectName,
    reviewNoiseRemovedPercent: metrics.changedLineReductionPercent,
    humanAttentionSavedMinutes: metrics.reviewMinutesBefore - metrics.reviewMinutesAfter,
    testCommand: report.testCommand.command,
    testStatus: report.testCommand.status,
    removedCount: report.removals.length,
    keptCount: report.kept.length,
    needsReviewCount: report.needsHumanReview.length,
    safetyNote: "PatchDiet only proves that the cleanup patch passes your configured checks. It is not a semantic-equivalence proof.",
    dietCardPath: ".patchdiet/diet-card.svg"
  };
}

export function analyzeDiffPreview(diff: string, options: { projectName: string }): DiffPreview {
  const lines = diff.split(/\r?\n/);
  const files: Array<{ path: string; hunks: Array<{ header: string; lines: Array<{ kind: string; text: string }> }> }> = [];
  let currentFile: { path: string; hunks: Array<{ header: string; lines: Array<{ kind: string; text: string }> }> } | undefined;
  let currentHunk: { header: string; lines: Array<{ kind: string; text: string }> } | undefined;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      currentHunk = undefined;
      currentFile = undefined;
      continue;
    }
    if (line.startsWith("--- a/")) continue;
    if (line.startsWith("+++ b/")) {
      const path = line.slice("+++ b/".length);
      currentFile = { path, hunks: [] };
      files.push(currentFile);
      currentHunk = undefined;
      continue;
    }
    if (line.startsWith("@@ ")) {
      if (!currentFile) continue;
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({ kind: "remove", text: line.slice(1) });
    } else {
      currentHunk.lines.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }

  const suggestions = files.flatMap((file) => {
    const category = classifyPreviewFile(file.path);
    if (!category) return [];
    return file.hunks.map((hunk) => ({
      filePath: file.path,
      hunkHeader: hunk.header,
      category,
      reason: previewReason(category),
      verificationReceipt: previewVerificationReceipt()
    }));
  });

  const suggestedPaths = new Set(suggestions.map((s) => s.filePath));
  const keptFiles = files.filter((f) => !suggestedPaths.has(f.path));

  const input = {
    fileCount: files.length,
    hunkCount: files.reduce((s, f) => s + f.hunks.length, 0),
    addedLineCount: files.flatMap((f) => f.hunks).flatMap((h) => h.lines).filter((l) => l.kind === "add").length,
    removedLineCount: files.flatMap((f) => f.hunks).flatMap((h) => h.lines).filter((l) => l.kind === "remove").length,
    changedLineCount: 0
  };
  input.changedLineCount = input.addedLineCount + input.removedLineCount;

  const output = {
    fileCount: keptFiles.length,
    hunkCount: keptFiles.reduce((s, f) => s + f.hunks.length, 0),
    addedLineCount: keptFiles.flatMap((f) => f.hunks).flatMap((h) => h.lines).filter((l) => l.kind === "add").length,
    removedLineCount: keptFiles.flatMap((f) => f.hunks).flatMap((h) => h.lines).filter((l) => l.kind === "remove").length,
    changedLineCount: 0
  };
  output.changedLineCount = output.addedLineCount + output.removedLineCount;

  const metrics = buildReviewMetrics({
    baseRef: "",
    headRef: "",
    input,
    output,
    testCommand: { command: "", status: "not-run", durationMs: 0, attempts: 1 },
    candidates: [],
    removals: suggestions,
    kept: [],
    needsHumanReview: [],
    artifacts: []
  } as unknown as ShrinkReport);

  return {
    projectName: options.projectName,
    mode: "preview",
    verificationStatus: "preview-only",
    input,
    output,
    metrics,
    suggestions,
    disclaimer: "Web demo preview uses local diff heuristics only. Run patchdiet shrink for test-verified cleanup decisions.",
    judgeMode: {
      headline: "Live PR Liposuction",
      hook: "AI wrote more. Humans review less.",
      verificationStatus: "preview-only",
      verificationReceipt: previewVerificationReceipt(),
      reviewNoiseRemovedPercent: metrics.changedLineReductionPercent,
      humanAttentionSavedMinutes: metrics.reviewMinutesBefore - metrics.reviewMinutesAfter,
      cliProofCommand: "patchdiet shrink --test \"npm test\""
    }
  };
}

function classifyPreviewFile(filePath: string): string | undefined {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  if (normalized === "readme.md" || normalized.startsWith("docs/") || normalized.endsWith(".md") || normalized.endsWith(".mdx") || normalized.endsWith(".txt")) {
    return "docs-only";
  }
  if (normalized.startsWith("dist/") || normalized.includes("/dist/") || normalized.startsWith("build/") || normalized.includes("/build/") || normalized.endsWith(".generated.ts") || normalized.endsWith(".generated.js") || normalized.endsWith(".min.js") || normalized.endsWith(".snap")) {
    return "generated-like";
  }
  return undefined;
}

function previewReason(category: string): string {
  switch (category) {
    case "docs-only":
      return "preview candidate: docs-only change that may be outside the PR intent";
    case "generated-like":
      return "preview candidate: generated-like artifact that reviewers may not need to inspect";
    default:
      return "preview candidate: run patchdiet shrink to verify with tests";
  }
}

function previewVerificationReceipt(): string {
  return "Preview only: no tests ran in the web demo. Verified cleanup receipt: run patchdiet shrink --test \"npm test\"; only removals that still pass checks should be treated as verified.";
}
