import { describe, expect, it } from "vitest";

import { parseUnifiedDiff, serializeUnifiedDiff, summarizeDiff } from "../../packages/core/src/diff.js";
import type { DiffSummary, ParsedDiff } from "../../packages/core/src/types.js";

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

  it("marks binary diffs for human review and captures header + payload verbatim", () => {
    const parsed = parseUnifiedDiff(`diff --git a/asset.bin b/asset.bin
index 1111111..2222222 100644
GIT binary patch
literal 4
LcmZQzU|;|M00aO5
`);

    expect(parsed.files).toEqual([
      {
        path: "asset.bin",
        extendedHeaders: [
          "diff --git a/asset.bin b/asset.bin",
          "index 1111111..2222222 100644"
        ],
        binarySection: [
          "GIT binary patch",
          "literal 4",
          "LcmZQzU|;|M00aO5"
        ],
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

  it("captures Binary-files differ sections with their header block verbatim", () => {
    const parsed = parseUnifiedDiff(`diff --git a/new.bin b/new.bin
new file mode 100644
index 0000000..2222222
Binary files /dev/null and b/new.bin differ
`);

    expect(parsed.files[0]).toEqual({
      path: "new.bin",
      isNew: true,
      extendedHeaders: [
        "diff --git a/new.bin b/new.bin",
        "new file mode 100644",
        "index 0000000..2222222"
      ],
      binarySection: ["Binary files /dev/null and b/new.bin differ"],
      hunks: [{ header: "Binary files /dev/null and b/new.bin differ", lines: [], binary: true }]
    });
  });

  it("keeps typed delete metadata on binary deleted-file sections", () => {
    const parsed = parseUnifiedDiff(`diff --git a/old.bin b/old.bin
deleted file mode 100644
index 1111111..0000000
Binary files a/old.bin and /dev/null differ
`);

    expect(parsed.files[0]).toEqual({
      path: "old.bin",
      // Typed-delete convention mirrors text deletes: oldPath falls back to
      // the surviving path.
      oldPath: "old.bin",
      isDelete: true,
      extendedHeaders: [
        "diff --git a/old.bin b/old.bin",
        "deleted file mode 100644",
        "index 1111111..0000000"
      ],
      binarySection: ["Binary files a/old.bin and /dev/null differ"],
      hunks: [{ header: "Binary files a/old.bin and /dev/null differ", lines: [], binary: true }]
    });
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

// ── H4 boundary cases ──────────────────────────────────────────────────────
// Fixtures mirror real `git diff` output (probed against git on 2026-09-28):
// quoted unicode paths, unquoted space paths with the git tab terminator,
// CRLF content lines, and "\ No newline at end of file" markers.

const deletedFileDiff = `diff --git a/src/dead.ts b/src/dead.ts
deleted file mode 100644
index 1111111..0000000
--- a/src/dead.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const dead = true;
-export const gone = "yes";
`;

const pureRenameDiff = `diff --git a/my file.txt b/renamed file.txt
similarity index 100%
rename from my file.txt
rename to renamed file.txt
`;

const copyDiff = `diff --git a/src/original.ts b/src/copy.ts
similarity index 100%
copy from src/original.ts
copy to src/copy.ts
`;

const renameWithEditDiff = `diff --git a/src/before.ts b/src/after.ts
similarity index 85%
rename from src/before.ts
rename to src/after.ts
index 1111111..2222222 100644
--- a/src/before.ts
+++ b/src/after.ts
@@ -1 +1 @@
-const value = 1;
+const value = 2;
`;

const quotedUnicodeDiff = `diff --git "a/src/\\346\\226\\207\\346\\241\\243.txt" "b/src/\\346\\226\\207\\346\\241\\243.txt"
index ce01362..cc628cc 100644
--- "a/src/\\346\\226\\207\\346\\241\\243.txt"
+++ "b/src/\\346\\226\\207\\346\\241\\243.txt"
@@ -1 +1 @@
-hello
+world
`;

const quotedDeletedDiff = `diff --git "a/src/\\346\\226\\207\\346\\241\\243.txt" "b/src/\\346\\226\\207\\346\\241\\243.txt"
deleted file mode 100644
index ce01362..0000000
--- "a/src/\\346\\226\\207\\346\\241\\243.txt"
+++ /dev/null
@@ -1 +0,0 @@
-hello
`;

const spacePathDiff = `diff --git a/my file.txt b/my file.txt
index ce01362..cc628cc 100644
--- a/my file.txt\t
+++ b/my file.txt\t
@@ -1 +1 @@
-hello
+world
`;

const hunkContentLookingLikeHeadersDiff = `diff --git a/notes.md b/notes.md
index 1111111..2222222 100644
--- a/notes.md
+++ b/notes.md
@@ -1,2 +1,3 @@
 context line
--- a/notes.md
+++ b/notes.md
+tail line
`;

const crlfContentDiff = [
  "diff --git a/crlf.txt b/crlf.txt",
  "index 242d545..f80c15b 100644",
  "--- a/crlf.txt",
  "+++ b/crlf.txt",
  "@@ -1,2 +1,2 @@",
  "-old line\r",
  "+new line\r",
  " second\r"
].join("\n") + "\n";

const noNewlineDiff = `diff --git a/nonl.txt b/nonl.txt
index c1b0730..1b32298 100644
--- a/nonl.txt
+++ b/nonl.txt
@@ -1 +1,2 @@
-x
\\ No newline at end of file
+x
+y
\\ No newline at end of file
`;

const modeChangeOnlyDiff = `diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`;

const gitBinaryPatchDiff = `diff --git a/asset.bin b/asset.bin
index 1111111..2222222 100644
GIT binary patch
literal 4
LcmZQzU|;|M00aO5

`;

const binaryFilesDifferDiff = `diff --git a/new.bin b/new.bin
new file mode 100644
index 0000000..2222222
Binary files /dev/null and b/new.bin differ
`;

const emptyNewFileDiff = `diff --git a/empty.txt b/empty.txt
new file mode 100644
index 0000000..e69de29
`;

interface EdgeCase {
  name: string;
  diff: string;
  verify: (parsed: ParsedDiff, summary: DiffSummary) => void;
}

const edgeCases: EdgeCase[] = [
  {
    name: "H4-1: keeps deleted files (--- a/x + +++ /dev/null) in the report",
    diff: deletedFileDiff,
    verify: (parsed, summary) => {
      expect(parsed.files).toHaveLength(1);
      const file = parsed.files[0]!;
      expect(file.path).toBe("src/dead.ts");
      expect(file.isDelete).toBe(true);
      expect(file.hunks).toHaveLength(1);
      expect(file.hunks[0]!.header).toBe("@@ -1,2 +0,0 @@");
      expect(file.hunks[0]!.lines.map((line) => line.kind)).toEqual(["remove", "remove"]);
      expect(summary.fileCount).toBe(1);
      expect(summary.hunkCount).toBe(1);
      expect(summary.removedLineCount).toBe(2);
      expect(summary.changedLineCount).toBe(2);
    }
  },
  {
    name: "H4-2: keeps pure renames (no content change) in the report",
    diff: pureRenameDiff,
    verify: (parsed, summary) => {
      expect(parsed.files).toHaveLength(1);
      const file = parsed.files[0]!;
      expect(file.path).toBe("renamed file.txt");
      expect(file.oldPath).toBe("my file.txt");
      expect(file.isRename).toBe(true);
      expect(file.hunks).toHaveLength(1);
      expect(summary.fileCount).toBe(1);
    }
  },
  {
    name: "H4-2b: keeps pure copies in the report",
    diff: copyDiff,
    verify: (parsed) => {
      const file = parsed.files[0]!;
      expect(file.path).toBe("src/copy.ts");
      expect(file.oldPath).toBe("src/original.ts");
      expect(file.isRename).toBe(true);
      expect(file.hunks[0]!.header).toBe("copy src/original.ts -> src/copy.ts");
    }
  },
  {
    name: "H4-2c: keeps renames with content changes as one file with real hunks",
    diff: renameWithEditDiff,
    verify: (parsed, summary) => {
      expect(parsed.files).toHaveLength(1);
      const file = parsed.files[0]!;
      expect(file.path).toBe("src/after.ts");
      expect(file.oldPath).toBe("src/before.ts");
      expect(file.isRename).toBe(true);
      expect(file.hunks).toHaveLength(1);
      expect(file.hunks[0]!.lines.map((line) => line.kind)).toEqual(["remove", "add"]);
      expect(summary.addedLineCount).toBe(1);
      expect(summary.removedLineCount).toBe(1);
    }
  },
  {
    name: "H4-3: decodes quoted unicode paths (git core.quotepath)",
    diff: quotedUnicodeDiff,
    verify: (parsed, summary) => {
      expect(parsed.files.map((file) => file.path)).toEqual(["src/文档.txt"]);
      expect(summary.addedLineCount).toBe(1);
      expect(summary.removedLineCount).toBe(1);
    }
  },
  {
    name: "H4-3b: decodes quoted unicode paths for deleted files",
    diff: quotedDeletedDiff,
    verify: (parsed) => {
      const file = parsed.files[0]!;
      expect(file.path).toBe("src/文档.txt");
      expect(file.isDelete).toBe(true);
      expect(file.hunks[0]!.lines).toHaveLength(1);
    }
  },
  {
    name: "H4-3c: parses unquoted space paths and strips the git tab terminator",
    diff: spacePathDiff,
    verify: (parsed) => {
      const file = parsed.files[0]!;
      expect(file.path).toBe("my file.txt");
      expect(file.path).not.toContain("\t");
      expect(file.hunks[0]!.lines.map((line) => line.text)).toEqual(["hello", "world"]);
    }
  },
  {
    name: "H4-4: keeps CRLF content on parsed lines instead of stripping \\r",
    diff: crlfContentDiff,
    verify: (parsed) => {
      const lines = parsed.files[0]!.hunks[0]!.lines;
      expect(lines.map((line) => line.kind)).toEqual(["remove", "add", "context"]);
      expect(lines[0]!.text).toBe("old line\r");
      expect(lines[1]!.text).toBe("new line\r");
      expect(lines[2]!.text).toBe("second\r");
    }
  },
  {
    name: "H4-5: records no-newline markers on the preceding line, not as context",
    diff: noNewlineDiff,
    verify: (parsed) => {
      const lines = parsed.files[0]!.hunks[0]!.lines;
      expect(lines).toHaveLength(3);
      expect(lines.every((line) => !line.text.includes("No newline"))).toBe(true);
      expect(lines[0]).toEqual({ kind: "remove", text: "x", noNewlineAfter: true });
      expect(lines[1]!.noNewlineAfter).toBeUndefined();
      expect(lines[2]).toEqual({ kind: "add", text: "y", noNewlineAfter: true });
    }
  },
  {
    name: "H4-6: does not truncate hunks when content looks like ---/+++ headers",
    diff: hunkContentLookingLikeHeadersDiff,
    verify: (parsed, summary) => {
      expect(parsed.files).toHaveLength(1);
      const hunks = parsed.files[0]!.hunks;
      expect(hunks).toHaveLength(1);
      // The diff lines "--- a/notes.md" / "+++ b/notes.md" are a removed line
      // "-- a/notes.md" and an added line "++ b/notes.md" (prefix + content).
      expect(hunks[0]!.lines.map((line) => `${line.kind}:${line.text}`)).toEqual([
        "context:context line",
        "remove:-- a/notes.md",
        "add:++ b/notes.md",
        "add:tail line"
      ]);
      expect(summary.addedLineCount).toBe(2);
      expect(summary.removedLineCount).toBe(1);
    }
  },
  {
    name: "H4-2d: keeps mode-change-only sections visible",
    diff: modeChangeOnlyDiff,
    verify: (parsed, summary) => {
      expect(parsed.files).toHaveLength(1);
      expect(parsed.files[0]!.path).toBe("run.sh");
      expect(parsed.files[0]!.hunks).toHaveLength(0);
      expect(summary.fileCount).toBe(1);
    }
  },
  {
    name: "H4-1b: keeps empty new files (headers only, no hunks) visible",
    diff: emptyNewFileDiff,
    verify: (parsed) => {
      const file = parsed.files[0]!;
      expect(file.path).toBe("empty.txt");
      expect(file.isNew).toBe(true);
      expect(file.hunks).toHaveLength(0);
    }
  }
];

describe("diff edge cases (H4)", () => {
  it.each(edgeCases)("$name", ({ diff, verify }) => {
    const parsed = parseUnifiedDiff(diff);
    const summary = summarizeDiff(parsed);
    verify(parsed, summary);
  });
});

// ── parse ↔ serialize round-trip parity ────────────────────────────────────

const newQuotedFileDiff = `diff --git "a/new \\344\\270\\255\\346\\226\\207.txt" "b/new \\344\\270\\255\\346\\226\\207.txt"
new file mode 100644
index 0000000..e626596
--- /dev/null
+++ "b/new \\344\\270\\255\\346\\226\\207.txt"\t
@@ -0,0 +1 @@
+fresh content
`;

const multiFileDiff = [
  sampleDiff,
  newQuotedFileDiff,
  deletedFileDiff,
  pureRenameDiff,
  renameWithEditDiff,
  modeChangeOnlyDiff,
  crlfContentDiff,
  noNewlineDiff
].join("");

const roundTripCases: { name: string; diff: string }[] = [
  { name: "modified files with index header", diff: sampleDiff },
  { name: "new file with quoted unicode path and tab terminator", diff: newQuotedFileDiff },
  { name: "deleted file", diff: deletedFileDiff },
  { name: "pure rename", diff: pureRenameDiff },
  { name: "pure copy", diff: copyDiff },
  { name: "rename with content change", diff: renameWithEditDiff },
  { name: "quoted unicode paths", diff: quotedUnicodeDiff },
  { name: "quoted unicode deleted file", diff: quotedDeletedDiff },
  { name: "unquoted space paths with tab terminator", diff: spacePathDiff },
  { name: "CRLF content lines", diff: crlfContentDiff },
  { name: "no-newline-at-eof markers", diff: noNewlineDiff },
  { name: "mode change only", diff: modeChangeOnlyDiff },
  { name: "empty new file", diff: emptyNewFileDiff },
  { name: "GIT binary patch payload", diff: gitBinaryPatchDiff },
  { name: "Binary files differ section", diff: binaryFilesDifferDiff },
  { name: "multi-file diff combining all metadata kinds", diff: multiFileDiff }
];

describe("serializeUnifiedDiff round-trip parity", () => {
  it.each(roundTripCases)("$name", ({ diff }) => {
    const parsed = parseUnifiedDiff(diff);
    expect(serializeUnifiedDiff(parsed)).toBe(diff);
  });

  it("re-serializing a parsed diff parses to the same structure", () => {
    const parsed = parseUnifiedDiff(multiFileDiff);
    const reparsed = parseUnifiedDiff(serializeUnifiedDiff(parsed));
    expect(reparsed.files.map((file) => file.path)).toEqual(parsed.files.map((file) => file.path));
    expect(summarizeDiff(reparsed)).toEqual(summarizeDiff(parsed));
  });

  it("keeps no-newline metadata on round-trip", () => {
    const parsed = parseUnifiedDiff(noNewlineDiff);
    const lines = parsed.files[0]!.hunks[0]!.lines;
    expect(lines[0]!.noNewlineAfter).toBe(true);
    expect(lines[2]!.noNewlineAfter).toBe(true);
    expect(serializeUnifiedDiff(parsed)).toContain("\\ No newline at end of file");
  });

  it("reconstructs headers for programmatically built files without captured metadata", () => {
    const serialized = serializeUnifiedDiff({
      files: [
        {
          path: "src/plain.ts",
          hunks: [
            {
              header: "@@ -1,1 +1,1 @@",
              lines: [
                { kind: "remove", text: "old", noNewlineAfter: true },
                { kind: "add", text: "new" }
              ]
            }
          ]
        }
      ]
    });

    expect(serialized).toBe(
      [
        "diff --git a/src/plain.ts b/src/plain.ts",
        "--- a/src/plain.ts",
        "+++ b/src/plain.ts",
        "@@ -1,1 +1,1 @@",
        "-old",
        "\\ No newline at end of file",
        "+new",
        ""
      ].join("\n")
    );
  });
});
