import { describe, expect, it } from "vitest";

import type { ShrinkReport } from "../../packages/core/src/types.js";
import {
  renderGitHubComment,
  renderHtmlReport,
  renderMarkdownReport
} from "../../packages/report/src/index.js";

const report: ShrinkReport = {
  baseRef: "origin/main",
  headRef: "HEAD",
  input: {
    fileCount: 4,
    hunkCount: 7,
    addedLineCount: 18,
    removedLineCount: 10,
    changedLineCount: 28
  },
  output: {
    fileCount: 2,
    hunkCount: 3,
    addedLineCount: 7,
    removedLineCount: 3,
    changedLineCount: 10
  },
  removals: [
    {
      filePath: "src/ui/Button.tsx",
      hunkHeader: "@@ -1,3 +1,3 @@",
      category: "formatting-only",
      reason: "formatting-only changes, checks unchanged",
      confidence: "high-confidence removal"
    }
  ],
  kept: [
    {
      filePath: "src/auth/session.ts",
      hunkHeader: "@@ -5,6 +5,8 @@",
      category: "unknown",
      reason: "required by auth regression test",
      confidence: "kept"
    }
  ],
  needsHumanReview: [
    {
      filePath: "package.json",
      hunkHeader: "@@ -10,1 +10,1 @@",
      category: "dependency-related",
      reason: "dependency bump may be outside task scope",
      confidence: "needs-human-review"
    }
  ],
  patchPath: ".patchdiet/cleanup.diff",
  cleanupBranch: "patchdiet/cleanup-2026-05-14",
  candidates: [
    {
      filePath: "src/ui/Button.tsx",
      hunkHeader: "@@ -1,3 +1,3 @@",
      category: "formatting-only",
      verdict: "removed",
      reason: "checks still passed after reverting this hunk"
    },
    {
      filePath: "package.json",
      hunkHeader: "@@ -10,1 +10,1 @@",
      category: "dependency-related",
      verdict: "needs-human-review",
      reason: "dependency bump may be outside task scope"
    }
  ],
  testCommand: {
    command: "npm test",
    status: "passed",
    durationMs: 1234,
    attempts: 2
  },
  artifacts: [
    ".patchdiet/report.md",
    ".patchdiet/report.github.md",
    ".patchdiet/report.html",
    ".patchdiet/cleanup.diff"
  ]
};

describe("report renderers", () => {
  it("renders markdown with summary and evidence sections", () => {
    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain("# PatchDiet Report");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("Base: `origin/main`");
    expect(markdown).toContain("Test command: `npm test`");
    expect(markdown).toContain("Test status: passed");
    expect(markdown).toContain("Test attempts: 2");
    expect(markdown).toContain("PatchDiet proves only that the cleanup patch passes the configured checks");
    expect(markdown).toContain("Input diff: 4 files, 28 changed lines, 7 hunks");
    expect(markdown).toContain("Output diff: 2 files, 10 changed lines, 3 hunks");
    expect(markdown).toContain("## Removed");
    expect(markdown).toContain("## Kept");
    expect(markdown).toContain("## Needs human review");
    expect(markdown).toContain("## Artifacts");
    expect(markdown).toContain("dependency-related");
  });

  it("renders html with audit sections", () => {
    const html = renderHtmlReport(report);

    expect(html).toContain("<title>PatchDiet Report</title>");
    expect(html).toContain("Before");
    expect(html).toContain("After");
    expect(html).toContain("patchdiet/cleanup-2026-05-14");
    expect(html).toContain("formatting-only changes, checks unchanged");
    expect(html).toContain("dependency bump may be outside task scope");
    expect(html).toContain("dependency-related");
    expect(html).toContain("passes the configured checks");
  });

  it("renders a github comment body", () => {
    const comment = renderGitHubComment(report);

    expect(comment).toContain("## PatchDiet");
    expect(comment).toContain("| Before | After |");
    expect(comment).toContain("| Files | 4 | 2 |");
    expect(comment).toContain("| Hunks | 7 | 3 |");
    expect(comment).toContain("| Changed lines | 28 | 10 |");
    expect(comment).toContain("Tests: passed");
    expect(comment).toContain("Not a semantic-equivalence proof");
    expect(comment).toContain("cleanup.diff");
  });
});
