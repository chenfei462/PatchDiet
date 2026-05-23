import { describe, expect, it } from "vitest";

import { parseUnifiedDiff, summarizeDiff } from "../../packages/core/src/diff.js";

const sampleDiff = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 export const a = 1;
+export const b = 2;
 export function keep() {
   return a;
@@ -9,2 +10,0 @@
-export const dead = true;
-export const oldValue = "x";
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,0 +1,2 @@
+export const added = true;
+export const extra = "value";
`;

describe("parseUnifiedDiff", () => {
  it("parses files and hunks from a unified diff", () => {
    const parsed = parseUnifiedDiff(sampleDiff);

    expect(parsed.files).toHaveLength(2);
    expect(parsed.files[0]?.path).toBe("src/a.ts");
    expect(parsed.files[0]?.hunks).toHaveLength(2);
    expect(parsed.files[1]?.path).toBe("src/b.ts");
    expect(parsed.files[1]?.hunks).toHaveLength(1);
  });

  it("marks binary diffs for human review", () => {
    const parsed = parseUnifiedDiff(`diff --git a/asset.bin b/asset.bin
index 1111111..2222222 100644
GIT binary patch
literal 4
LcmZQzU|;|M00aO5
`);

    expect(parsed.files).toEqual([
      {
        path: "asset.bin",
        hunks: [
          {
            header: "GIT binary patch",
            lines: [],
            binary: true
          }
        ]
      }
    ]);
  });

  it("keeps binary file paths when git reports /dev/null endpoints", () => {
    const parsed = parseUnifiedDiff(`diff --git a/new.bin b/new.bin
new file mode 100644
index 0000000..2222222
Binary files /dev/null and b/new.bin differ
diff --git a/old.bin b/old.bin
deleted file mode 100644
index 1111111..0000000
Binary files a/old.bin and /dev/null differ
`);

    expect(parsed.files.map((file) => file.path)).toEqual(["new.bin", "old.bin"]);
    expect(parsed.files.every((file) => file.hunks[0]?.binary)).toBe(true);
  });
});

describe("summarizeDiff", () => {
  it("counts files, hunks, added lines and removed lines", () => {
    const parsed = parseUnifiedDiff(sampleDiff);
    const summary = summarizeDiff(parsed);

    expect(summary.fileCount).toBe(2);
    expect(summary.hunkCount).toBe(3);
    expect(summary.addedLineCount).toBe(3);
    expect(summary.removedLineCount).toBe(2);
    expect(summary.changedLineCount).toBe(5);
  });
});
