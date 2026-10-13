import { describe, expect, it } from "vitest";

import {
  analyzeDiffPreview,
  buildVerifiedReceiptSummary,
  buildReviewMetrics
} from "../../packages/core/src/insights.js";
import type { ShrinkReport } from "../../packages/core/src/types.js";

const sampleDiff = `diff --git a/src/feature.ts b/src/feature.ts
index 1111111..2222222 100644
--- a/src/feature.ts
+++ b/src/feature.ts
@@ -1,2 +1,5 @@
 export function keep() {
+  console.log("debug");
+  return 42;
   return 1;
 }
diff --git a/README.md b/README.md
index 3333333..4444444 100644
--- a/README.md
+++ b/README.md
@@ -0,0 +1,3 @@
+# Unrelated notes
+This came from a broad PR.
+Reviewers do not need it.
diff --git a/src/generated.generated.ts b/src/generated.generated.ts
index 5555555..6666666 100644
--- a/src/generated.generated.ts
+++ b/src/generated.generated.ts
@@ -0,0 +1,2 @@
+export const generated = true;
+export const noisy = true;
`;

const report: ShrinkReport = {
  baseRef: "origin/main",
  headRef: "HEAD",
  input: {
    fileCount: 4,
    hunkCount: 6,
    addedLineCount: 90,
    removedLineCount: 10,
    changedLineCount: 100
  },
  output: {
    fileCount: 2,
    hunkCount: 3,
    addedLineCount: 30,
    removedLineCount: 10,
    changedLineCount: 40
  },
  testCommand: {
    command: "npm test",
    status: "passed",
    durationMs: 1250,
    attempts: 1
  },
  candidates: [],
  removals: [
    {
      filePath: "README.md",
      hunkHeader: "@@ -0,0 +1,3 @@",
      category: "docs-only",
      reason: "removed because checks still passed after reverting this hunk",
      confidence: "high-confidence removal"
    }
  ],
  kept: [],
  needsHumanReview: [],
  artifacts: []
};

describe("PatchDiet insights", () => {
  it("estimates review savings from a shrink report", () => {
    const metrics = buildReviewMetrics(report);

    expect(metrics.before.fileCount).toBe(4);
    expect(metrics.after.fileCount).toBe(2);
    expect(metrics.changedLineReductionPercent).toBe(60);
    expect(metrics.savedReviewTimePercent).toBeGreaterThan(40);
    expect(metrics.suggestedDeletionHunks).toBe(1);
  });

  it("builds a verified cleanup receipt from a shrink report", () => {
    const receipt = buildVerifiedReceiptSummary(report, { projectName: "sample-cart-pr" });

    expect(receipt).toEqual({
      headline: "Verified Cleanup Receipt",
      hook: "Tests still pass. Review less diff.",
      verificationStatus: "verified",
      projectName: "sample-cart-pr",
      reviewNoiseRemovedPercent: 60,
      humanAttentionSavedMinutes: expect.any(Number),
      testCommand: "npm test",
      testStatus: "passed",
      removedCount: 1,
      keptCount: 0,
      needsReviewCount: 0,
      safetyNote:
        "PatchDiet only proves that the cleanup patch passes your configured checks. It is not a semantic-equivalence proof.",
      dietCardPath: ".patchdiet/diet-card.svg"
    });
  });

  it("creates a no-test preview from a pasted diff for the web demo", () => {
    const preview = analyzeDiffPreview(sampleDiff, { projectName: "sample-pr" });

    expect(preview.projectName).toBe("sample-pr");
    expect(preview.mode).toBe("preview");
    expect(preview.verificationStatus).toBe("preview-only");
    expect(preview.input.fileCount).toBe(3);
    expect(preview.suggestions).toEqual([
      expect.objectContaining({
        filePath: "README.md",
        verificationReceipt:
          "Preview only: no tests ran in the web demo. Verified cleanup receipt: run patchdiet shrink --test \"npm test\"; only removals that still pass checks should be treated as verified."
      }),
      expect.objectContaining({
        filePath: "src/generated.generated.ts",
        verificationReceipt:
          "Preview only: no tests ran in the web demo. Verified cleanup receipt: run patchdiet shrink --test \"npm test\"; only removals that still pass checks should be treated as verified."
      })
    ]);
    expect(preview.output.fileCount).toBe(1);
    expect(preview.metrics.changedLineReductionPercent).toBeGreaterThan(50);
    expect(preview.disclaimer).toContain("preview");
    expect(preview.judgeMode).toEqual({
      headline: "Live PR Liposuction",
      hook: "AI wrote more. Humans review less.",
      verificationStatus: "preview-only",
      verificationReceipt:
        "Preview only: no tests ran in the web demo. Verified cleanup receipt: run patchdiet shrink --test \"npm test\"; only removals that still pass checks should be treated as verified.",
      reviewNoiseRemovedPercent: preview.metrics.changedLineReductionPercent,
      humanAttentionSavedMinutes:
        preview.metrics.reviewMinutesBefore - preview.metrics.reviewMinutesAfter,
      cliProofCommand: "patchdiet shrink --test \"npm test\""
    });
    expect(preview.judgeMode.verificationReceipt).not.toMatch(
      /web demo (?:is|was|has been).*verified/i
    );
  });

  it("keeps the static demo insight mirror aligned with the core preview receipt", async () => {
    // @ts-expect-error Static demo module is intentionally shipped without declarations.
    const { analyzeDiffPreview: analyzeDemoDiffPreview } = await import("../../demo/insights.mjs");

    const corePreview = analyzeDiffPreview(sampleDiff, { projectName: "sample-pr" });
    const demoPreview = analyzeDemoDiffPreview(sampleDiff, { projectName: "sample-pr" });

    expect(demoPreview).toEqual(corePreview);
  });
});
