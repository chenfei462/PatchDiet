import { describe, expect, it } from "vitest";

import type { ShrinkReport } from "../../packages/core/src/types.js";
import {
  renderGitHubComment,
  renderHtmlReport,
  renderMarkdownReport
} from "../../packages/report/src/index.js";

const report: ShrinkReport = {
  baseRef: "origin/main",
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
      reason: "formatting-only changes, checks unchanged",
      confidence: "high-confidence removal",
      category: "formatting-only"
    }
  ],
  kept: [
    {
      filePath: "src/auth/session.ts",
      hunkHeader: "@@ -5,6 +5,8 @@",
      reason: "required by auth regression test",
      confidence: "kept",
      category: "required-by-check"
    }
  ],
  needsHumanReview: [
    {
      filePath: "package.json",
      hunkHeader: "@@ -10,1 +10,1 @@",
      reason: "dependency bump may be outside task scope",
      confidence: "needs-human-review",
      category: "dependency-bump"
    }
  ],
  patchPath: ".patchdiet/cleanup.diff",
  cleanupBranch: "patchdiet/cleanup-2026-05-14"
};

describe("report renderers", () => {
  it("renders markdown with summary and evidence sections", () => {
    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain("# PatchDiet Report");
    expect(markdown).toContain("Base: `origin/main`");
    expect(markdown).toContain("Input diff: 4 files, 28 changed lines, 7 hunks");
    expect(markdown).toContain("Output diff: 2 files, 10 changed lines, 3 hunks");
    expect(markdown).toContain("Reduction: files -50%, lines -64%, hunks -57%");
    expect(markdown).toContain("formatting-only");
    expect(markdown).toContain("High-confidence removals");
    expect(markdown).toContain("Needs human review");
  });

  it("renders html with audit sections", () => {
    const html = renderHtmlReport(report);

    expect(html).toContain("<title>PatchDiet Report</title>");
    expect(html).toContain("patchdiet/cleanup-2026-05-14");
    expect(html).toContain("formatting-only changes, checks unchanged");
    expect(html).toContain("Evidence summary");
    expect(html).toContain("dependency bump may be outside task scope");
  });

  it("renders a github comment body", () => {
    const comment = renderGitHubComment(report);

    expect(comment).toContain("PatchDiet found a smaller equivalent patch.");
    expect(comment).toContain("Input: 4 files, 28 changed lines, 7 hunks");
    expect(comment).toContain("Minimal candidate: 2 files, 10 changed lines, 3 hunks");
    expect(comment).toContain("Reduction: files -50%, lines -64%, hunks -57%");
    expect(comment).toContain("Needs human review:");
    expect(comment).toContain("Cleanup patch artifact: .patchdiet/cleanup.diff");
  });
});
