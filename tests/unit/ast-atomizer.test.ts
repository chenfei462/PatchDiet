import { describe, expect, it } from "vitest";

import { parseSource } from "../../packages/parsers/src/index.js";
import { encodeSelectivePatch, mapHunkCoordinates } from "../../packages/core/src/patch-encoder.js";
import { atomizeFileEdits, changeUnitsFromHunks } from "../../packages/core/src/ast-atomizer.js";

/**
 * Same-hunk "needed fix + unrelated debug" fixture: the required change is the
 * return expression; the debug local and logging statement are unrelated.
 * Language-parameterized so TypeScript, JavaScript and Python all prove real
 * statement-level splitting.
 */
const LANGUAGE_FIXTURES = {
  typescript: {
    path: "src/total.ts",
    base: `// 中文😀 scope fixture\nexport function total(n: number): number {\n  return n;\n}\n`,
    head: `// 中文😀 scope fixture\nexport function total(n: number): number {\n  const trace: { n: number } = { n };\n  console.error("injected-debug", trace);\n  return n * 2;\n}\n`,
    debugFragments: ["const trace", "console.error"],
    requiredFragment: "return n * 2"
  },
  javascript: {
    path: "src/total.js",
    base: `// 中文😀 scope fixture\nexport function total(n) {\n  return n;\n}\n`,
    head: `// 中文😀 scope fixture\nexport function total(n) {\n  const trace = { n };\n  console.error("injected-debug", trace);\n  return n * 2;\n}\n`,
    debugFragments: ["const trace", "console.error"],
    requiredFragment: "return n * 2"
  },
  python: {
    path: "src/total.py",
    base: `# 中文😀 scope fixture\ndef total(n):\n    return n\n`,
    head: `# 中文😀 scope fixture\ndef total(n):\n    trace = {"n": n}\n    print("injected-debug", trace)\n    return n * 2\n`,
    debugFragments: ["trace =", "print("],
    requiredFragment: "return n * 2"
  }
} as const;

/** Minimal unified patch between two texts, computed here via a line LCS. */
function buildPatch(base: string, head: string, path: string): string {
  const a = base.split("\n");
  const b = head.split("\n");
  // Simple LCS table (files are tiny).
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  let baseLine = 1;
  let headLine = 1;
  const context = (text: string) => {
    lines.push(` ${text}`);
    baseLine += 1;
    headLine += 1;
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      context(a[i]!);
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      lines.push(`-${a[i]!}`);
      baseLine += 1;
      i += 1;
    } else {
      lines.push(`+${b[j]!}`);
      headLine += 1;
      j += 1;
    }
  }
  while (i < n) {
    lines.push(`-${a[i]!}`);
    i += 1;
  }
  while (j < m) {
    lines.push(`+${b[j]!}`);
    j += 1;
  }
  const header = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
  // One whole-file hunk: valid for mapHunkCoordinates (strict count consumption).
  const hunk = `@@ -1,${n} +1,${m} @@\n`;
  return header + hunk + lines.join("\n") + "\n";
}

describe("changeUnitsFromHunks", () => {
  it("splits delete-run + insert-run pairs and handles pure insertions", () => {
    const patch = [
      "diff --git a/a.js b/a.js",
      "--- a/a.js",
      "+++ b/a.js",
      "@@ -1,5 +1,5 @@",
      " keep1",
      "-del1",
      "-del2",
      "+ins1",
      " keep2",
      "+ins2",
      " keep3"
    ].join("\n");
    const units = changeUnitsFromHunks(mapHunkCoordinates(patch));
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({ baseStartLine: 1, baseEndLine: 3, headStartLine: 1, headEndLine: 2 });
    expect(units[1]).toMatchObject({ baseStartLine: 4, baseEndLine: 4, headStartLine: 3, headEndLine: 4 });
  });
});

describe("atomizeFileEdits — same-hunk fix + unrelated debug", () => {
  for (const [language, fixture] of Object.entries(LANGUAGE_FIXTURES)) {
    it(`splits the debug statements from the required fix (${language})`, async () => {
      const filePatch = buildPatch(fixture.base, fixture.head, fixture.path);
      const [baseParse, headParse] = await Promise.all([
        parseSource(fixture.path, fixture.base),
        parseSource(fixture.path, fixture.head)
      ]);
      expect(baseParse.complete).toBe(true);
      expect(headParse.complete).toBe(true);

      const result = await atomizeFileEdits({
        path: fixture.path,
        baseText: fixture.base,
        headText: fixture.head,
        baseParse,
        headParse,
        filePatch
      });

      expect(result.edits.length).toBeGreaterThanOrEqual(3);
      // The full edit set must explain base -> head exactly (the encoder validates).
      const full = encodeSelectivePatch({
        path: fixture.path,
        baseText: fixture.base,
        headText: fixture.head,
        edits: result.edits,
        keepEditIds: result.edits.map((edit) => edit.id)
      });
      expect(full.reducedText).toBe(fixture.head);

      // Removing ONLY the debug edits keeps the required fix.
      const debugEdits = result.edits.filter((edit) =>
        fixture.debugFragments.some((fragment) => {
          const headBytes = Buffer.from(fixture.head, "utf8");
          const headText = headBytes.subarray(edit.headStartByte, edit.headEndByte).toString("utf8");
          return headText.includes(fragment);
        })
      );
      expect(debugEdits.length).toBe(fixture.debugFragments.length);
      const reduced = encodeSelectivePatch({
        path: fixture.path,
        baseText: fixture.base,
        headText: fixture.head,
        edits: result.edits,
        keepEditIds: result.edits.filter((edit) => !debugEdits.includes(edit)).map((edit) => edit.id)
      });
      expect(reduced.reducedText).toContain(fixture.requiredFragment);
      for (const fragment of fixture.debugFragments) {
        expect(reduced.reducedText).not.toContain(fragment);
      }
      // And the reduced source still parses.
      const reparsed = await parseSource(fixture.path, reduced.reducedText);
      expect(reparsed.complete).toBe(true);

      // Reversed side: HEAD minus removed debug edits is the removal patch base.
      const inverted = result.edits.map((edit) => ({
        id: edit.id,
        baseStartByte: edit.headStartByte,
        baseEndByte: edit.headEndByte,
        headStartByte: edit.baseStartByte,
        headEndByte: edit.baseEndByte
      }));
      const removal = encodeSelectivePatch({
        path: fixture.path,
        baseText: fixture.head,
        headText: fixture.base,
        edits: inverted,
        keepEditIds: debugEdits.map((edit) => edit.id)
      });
      expect(removal.patch).toContain(`+++ b/${fixture.path}`);
    });
  }

  it("preserves Unicode, CRLF, BOM and no-trailing-newline bytes exactly", async () => {
    const path = "src/crlf.ts";
    const base = "\uFEFF// BOM+CRLF 中文😀\r\nexport function a(): number {\r\n  return 1;\r\n}";
    const head = "\uFEFF// BOM+CRLF 中文😀\r\nexport function a(): number {\r\n  const dbg = 1;\r\n  return 2;\r\n}";
    const filePatch = buildPatch(base, head, path);
    const [baseParse, headParse] = await Promise.all([
      parseSource(path, base),
      parseSource(path, head)
    ]);
    const result = await atomizeFileEdits({
      path,
      baseText: base,
      headText: head,
      baseParse,
      headParse,
      filePatch
    });
    // Full apply reproduces head byte-for-byte (incl. BOM, CRLF, no newline).
    const full = encodeSelectivePatch({
      path,
      baseText: base,
      headText: head,
      edits: result.edits,
      keepEditIds: result.edits.map((edit) => edit.id)
    });
    expect(Buffer.from(full.reducedText, "utf8").equals(Buffer.from(head, "utf8"))).toBe(true);
    // Dropping all edits returns the base bytes exactly.
    const none = encodeSelectivePatch({ path, baseText: base, headText: head, edits: result.edits, keepEditIds: [] });
    expect(Buffer.from(none.reducedText, "utf8").equals(Buffer.from(base, "utf8"))).toBe(true);
    // The untouched BOM + comment bytes appear in the patch context, unmodified.
    expect(full.patch).toContain("中文");
  });

  it("falls back explicitly when either side fails to parse", async () => {
    const path = "src/broken.js";
    const base = "function ok() {\n  return 1;\n}\n";
    const head = "function ok() {\n  return 1;\n}})\n// syntax error below\nfunction ( {";
    const filePatch = buildPatch(base, head, path);
    const [baseParse, headParse] = await Promise.all([
      parseSource(path, base),
      parseSource(path, head)
    ]);
    expect(headParse.complete).toBe(false);
    const result = await atomizeFileEdits({
      path,
      baseText: base,
      headText: head,
      baseParse,
      headParse,
      filePatch
    });
    expect(result.edits).toHaveLength(0);
    expect(result.fallback).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("produces deterministic edit ids across repeated runs", async () => {
    const fixture = LANGUAGE_FIXTURES.typescript;
    const filePatch = buildPatch(fixture.base, fixture.head, fixture.path);
    const run = async () => {
      const [baseParse, headParse] = await Promise.all([
        parseSource(fixture.path, fixture.base),
        parseSource(fixture.path, fixture.head)
      ]);
      const result = await atomizeFileEdits({
        path: fixture.path,
        baseText: fixture.base,
        headText: fixture.head,
        baseParse,
        headParse,
        filePatch
      });
      return result.edits.map((edit) => edit.id);
    };
    expect(await run()).toEqual(await run());
  });
});
