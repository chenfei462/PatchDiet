import { describe, expect, it } from "vitest";

import type { ShrinkReport } from "../../packages/core/src/types.js";
import {
  buildDietCardModel,
  renderDietBadgeMarkdown,
  renderDietCardHtml,
  renderDietCardPng,
  renderDietCardSvg
} from "../../packages/report/src/index.js";

const report: ShrinkReport = {
  baseRef: "origin/main",
  headRef: "HEAD",
  input: {
    fileCount: 5,
    hunkCount: 8,
    addedLineCount: 80,
    removedLineCount: 20,
    changedLineCount: 100
  },
  output: {
    fileCount: 2,
    hunkCount: 3,
    addedLineCount: 32,
    removedLineCount: 8,
    changedLineCount: 40
  },
  testCommand: {
    command: "npm test",
    status: "passed",
    durationMs: 1500,
    attempts: 1
  },
  candidates: [],
  removals: [
    {
      filePath: "docs/notes.md",
      hunkHeader: "@@ -0,0 +1,5 @@",
      category: "docs-only",
      reason: "removed because checks still passed",
      confidence: "high-confidence removal"
    }
  ],
  kept: [],
  needsHumanReview: [],
  artifacts: []
};

describe("Diet Card", () => {
  it("builds a shareable card model from a shrink report", () => {
    const model = buildDietCardModel(report, { projectName: "PatchDiet" });

    expect(model.projectName).toBe("PatchDiet");
    expect(model.savedReviewTimePercent).toBeGreaterThan(40);
    expect(model.changedLineReductionPercent).toBe(60);
    expect(model.before.files).toBe(5);
    expect(model.after.files).toBe(2);
  });

  it("renders HTML, SVG, and badge markdown", () => {
    const model = buildDietCardModel(report, { projectName: "PatchDiet" });
    const html = renderDietCardHtml(model);
    const svg = renderDietCardSvg(model);
    const badge = renderDietBadgeMarkdown(model, "https://example.com/patchdiet.svg");

    expect(html).toContain("60% review noise removed");
    expect(html).toContain("Estimated attention saved");
    expect(html).toContain("PatchDiet");
    expect(svg).toContain("<svg");
    expect(svg).toContain("60%");
    expect(svg).toContain("review noise removed");
    expect(svg).toContain("PR Auto-Cleaner");
    expect(badge).toBe("![PatchDiet -60%](https://example.com/patchdiet.svg)");
  });

  it("escapes badge markdown image URLs", () => {
    const model = buildDietCardModel(report, { projectName: "PatchDiet" });

    expect(renderDietBadgeMarkdown(model, "https://example.com/a card).svg\nmalicious")).toBe(
      "![PatchDiet -60%](https://example.com/a%20card%29.svgmalicious)"
    );
  });

  it("renders a deterministic local PNG card", () => {
    const model = buildDietCardModel(report, { projectName: "PatchDiet" });
    const png = renderDietCardPng(model);

    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(readPngUInt32(png, 16)).toBe(1200);
    expect(readPngUInt32(png, 20)).toBe(628);
    expect(png.byteLength).toBeGreaterThan(1000);
  });
});

function readPngUInt32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}
