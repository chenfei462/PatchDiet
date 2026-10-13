export function parseUnifiedDiff(input) {
  const lines = input.split(/\r?\n/);
  const files = [];
  let currentFile;
  let currentHunk;
  let pendingOldPath;
  let pendingNewPath;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      currentHunk = undefined;
      currentFile = undefined;
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      pendingOldPath = match?.[1];
      pendingNewPath = match?.[2];
      continue;
    }

    if (line.startsWith("--- a/")) {
      pendingOldPath = line.slice("--- a/".length);
      continue;
    }

    if (line.startsWith("+++ b/")) {
      pendingNewPath = line.slice("+++ b/".length);
      currentFile = { path: pendingNewPath, hunks: [] };
      files.push(currentFile);
      currentHunk = undefined;
      continue;
    }

    if (line.startsWith("Binary files ") && line.includes(" and ") && line.endsWith(" differ")) {
      const path = parseBinaryPath(line);
      if (path) {
        files.push({ path, hunks: [{ header: "Binary files differ", lines: [], binary: true }] });
      }
      currentFile = undefined;
      currentHunk = undefined;
      continue;
    }

    if (line.startsWith("GIT binary patch")) {
      const path = pendingNewPath ?? pendingOldPath;
      if (path) {
        files.push({ path, hunks: [{ header: "GIT binary patch", lines: [], binary: true }] });
      }
      currentFile = undefined;
      currentHunk = undefined;
      continue;
    }

    if (line.startsWith("@@ ")) {
      if (!currentFile) {
        continue;
      }
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({ kind: "remove", text: line.slice(1) });
    } else {
      currentHunk.lines.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }

  return { files };
}

export function summarizeDiff(parsed) {
  const allLines = parsed.files.flatMap((file) => file.hunks).flatMap((hunk) => hunk.lines);
  const addedLineCount = allLines.filter((line) => line.kind === "add").length;
  const removedLineCount = allLines.filter((line) => line.kind === "remove").length;
  return {
    fileCount: parsed.files.length,
    hunkCount: parsed.files.reduce((sum, file) => sum + file.hunks.length, 0),
    addedLineCount,
    removedLineCount,
    changedLineCount: addedLineCount + removedLineCount
  };
}

export function analyzeDiffPreview(diff, options = {}) {
  const parsed = parseUnifiedDiff(diff);
  const suggestions = parsed.files.flatMap((file) => getPreviewSuggestions(file));
  const suggestedPaths = new Set(suggestions.map((item) => item.filePath));
  const keptFiles = parsed.files.filter((file) => !suggestedPaths.has(file.path));
  const input = summarizeDiff(parsed);
  const output = summarizeDiff({ files: keptFiles });
  const metrics = buildReviewMetrics(input, output, suggestions.length);
  return {
    projectName: options.projectName ?? "pasted-diff",
    mode: "preview",
    verificationStatus: "preview-only",
    input,
    output,
    metrics,
    suggestions,
    disclaimer:
      "Web demo preview uses local diff heuristics only. Run patchdiet shrink for test-verified cleanup decisions.",
    judgeMode: buildJudgeModeSummary(metrics)
  };
}

function buildJudgeModeSummary(metrics) {
  return {
    headline: "Live PR Liposuction",
    hook: "AI wrote more. Humans review less.",
    verificationStatus: "preview-only",
    verificationReceipt:
      previewVerificationReceipt(),
    reviewNoiseRemovedPercent: metrics.changedLineReductionPercent,
    humanAttentionSavedMinutes: metrics.reviewMinutesBefore - metrics.reviewMinutesAfter,
    cliProofCommand: "patchdiet shrink --test \"npm test\""
  };
}

function buildReviewMetrics(input, output, suggestedDeletionHunks) {
  const reviewMinutesBefore = estimateReviewMinutes(input);
  const reviewMinutesAfter = estimateReviewMinutes(output);
  return {
    before: {
      fileCount: input.fileCount,
      hunkCount: input.hunkCount,
      changedLineCount: input.changedLineCount
    },
    after: {
      fileCount: output.fileCount,
      hunkCount: output.hunkCount,
      changedLineCount: output.changedLineCount
    },
    changedLineReductionPercent: percentReduced(input.changedLineCount, output.changedLineCount),
    fileReductionPercent: percentReduced(input.fileCount, output.fileCount),
    hunkReductionPercent: percentReduced(input.hunkCount, output.hunkCount),
    savedReviewTimePercent: percentReduced(reviewMinutesBefore, reviewMinutesAfter),
    suggestedDeletionHunks,
    reviewMinutesBefore,
    reviewMinutesAfter
  };
}

function getPreviewSuggestions(file) {
  const category = classifyPreviewFile(file.path);
  if (!category) {
    return [];
  }

  return file.hunks.map((hunk) => ({
    filePath: file.path,
    hunkHeader: hunk.header,
    category,
    reason: previewReason(category),
    verificationReceipt: previewVerificationReceipt()
  }));
}

function previewReason(category) {
  switch (category) {
    case "docs-only":
      return "preview candidate: docs-only change that may be outside the PR intent";
    case "generated-like":
      return "preview candidate: generated-like artifact that reviewers may not need to inspect";
    default:
      return "preview candidate: run patchdiet shrink to verify with tests";
  }
}

function previewVerificationReceipt() {
  return "Preview only: no tests ran in the web demo. Verified cleanup receipt: run patchdiet shrink --test \"npm test\"; only removals that still pass checks should be treated as verified.";
}

function classifyPreviewFile(filePath) {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  if (
    normalized === "readme.md"
    || normalized.startsWith("docs/")
    || normalized.endsWith(".md")
    || normalized.endsWith(".mdx")
    || normalized.endsWith(".txt")
  ) {
    return "docs-only";
  }
  if (
    normalized.startsWith("dist/")
    || normalized.includes("/dist/")
    || normalized.startsWith("build/")
    || normalized.includes("/build/")
    || normalized.endsWith(".generated.ts")
    || normalized.endsWith(".generated.js")
    || normalized.endsWith(".min.js")
    || normalized.endsWith(".snap")
  ) {
    return "generated-like";
  }
  return undefined;
}

function parseBinaryPath(line) {
  const match = /^Binary files (.+) and (.+) differ$/.exec(line);
  const newPath = normalizeBinaryEndpoint(match?.[2]);
  const oldPath = normalizeBinaryEndpoint(match?.[1]);
  return newPath ?? oldPath;
}

function normalizeBinaryEndpoint(value) {
  if (!value || value === "/dev/null") {
    return undefined;
  }
  return value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
}

function estimateReviewMinutes(summary) {
  return Math.max(1, Math.ceil(summary.changedLineCount / 20 + summary.fileCount * 0.75 + summary.hunkCount * 0.5));
}

function percentReduced(before, after) {
  if (before <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(((before - after) / before) * 100)));
}
