import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  encodeSelectivePatch,
  mapHunkCoordinates,
} from "../../packages/core/src/patch-encoder.js";

const tempDirs: string[] = [];

// Windows Node rmSync can hit EPERM on transient short-lived file handles
// and does not retry; async rm retries EPERM/EBUSY and still throws when the
// directories stay locked.
afterEach(async () => {
  const dirs = tempDirs.splice(0);
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ── helpers ───────────────────────────────────────────────────────

const GIT_ARGS = ["-c", "core.autocrlf=false"];

function byteOf(text: string, substring: string): number {
  const idx = text.indexOf(substring);
  if (idx < 0) throw new Error(`test bug: ${JSON.stringify(substring)} not found`);
  return Buffer.byteLength(text.slice(0, idx), "utf8");
}

function byteEnd(text: string, substring: string): number {
  return byteOf(text, substring) + Buffer.byteLength(substring, "utf8");
}

/** Create a temp git repo with `path` added to the index at baseText. */
function initRepo(baseText: string, path: string): { repo: string; absPath: string } {
  const repo = mkdtempSync(join(tmpdir(), "patch-encoder-repo-"));
  tempDirs.push(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const absPath = join(repo, path);
  mkdirSync(join(absPath, ".."), { recursive: true });
  writeFileSync(absPath, baseText, "utf8");
  execFileSync("git", [...GIT_ARGS, "add", "--", path], { cwd: repo });
  return { repo, absPath };
}

/** Apply a patch with --index, return the working-tree file content. */
function applyPatch(repo: string, path: string, patch: string, reverse = false): string {
  const patchFile = join(repo, "..patchencoder-test.patch");
  writeFileSync(patchFile, patch, "utf8");
  const args = ["apply", "--index", "--whitespace=nowarn", ...(reverse ? ["-R"] : []), patchFile];
  const res = spawnSync("git", [...GIT_ARGS, ...args], { cwd: repo, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git apply failed (status ${res.status}):\n${res.stdout}\n${res.stderr}`);
  }
  return readFileSync(join(repo, path), "utf8");
}

interface ApplyResult {
  forward: string;
  reverse: string;
}

/** Full acceptance: apply forward == expected, reverse-apply restores baseText. */
function applyAndReverse(
  baseText: string,
  path: string,
  patch: string,
  expected: string
): ApplyResult {
  const { repo } = initRepo(baseText, path);
  const forward = applyPatch(repo, path, patch);
  const reverse = applyPatch(repo, path, patch, true);
  expect(forward).toBe(expected);
  expect(reverse).toBe(baseText);
  return { forward, reverse };
}

// ── fixtures ──────────────────────────────────────────────────────

const TWO_FUNCTIONS_BASE = [
  "import { log } from './log';",
  "",
  "function alpha() {",
  "  log('alpha');",
  "  return 1;",
  "}",
  "",
  "function beta() {",
  "  log('beta');",
  "  return 2;",
  "}",
  "",
].join("\n");

const TWO_FUNCTIONS_HEAD = [
  "import { log } from './log';",
  "",
  "function alpha() {",
  "  log('alpha-v2');",
  "  return 1;",
  "}",
  "",
  "function beta() {",
  "  log('beta-v2');",
  "  return 2;",
  "}",
  "",
].join("\n");

const FOUR_STATEMENTS_BASE = [
  "function main() {",
  "  debug('enter main');",
  "  const x = compute();",
  "  debug('x=' + x);",
  "  trace(x);",
  "  assert(x > 0);",
  "  return x;",
  "}",
].join("\n");

const FOUR_STATEMENTS_HEAD = [
  "function main() {",
  "  const x = compute();",
  "  console.log(x);",
  "  return x;",
  "}",
].join("\n");

// ── encodeSelectivePatch ─────────────────────────────────────────

describe("encodeSelectivePatch", () => {
  it("drops one of two edits inside the same hunk and produces a valid patch", () => {
    const edits = [
      {
        id: "alpha",
        baseStartByte: byteOf(TWO_FUNCTIONS_BASE, "log('alpha');"),
        baseEndByte: byteEnd(TWO_FUNCTIONS_BASE, "log('alpha');"),
        headStartByte: byteOf(TWO_FUNCTIONS_HEAD, "log('alpha-v2');"),
        headEndByte: byteEnd(TWO_FUNCTIONS_HEAD, "log('alpha-v2');"),
      },
      {
        id: "beta",
        baseStartByte: byteOf(TWO_FUNCTIONS_BASE, "log('beta');"),
        baseEndByte: byteEnd(TWO_FUNCTIONS_BASE, "log('beta');"),
        headStartByte: byteOf(TWO_FUNCTIONS_HEAD, "log('beta-v2');"),
        headEndByte: byteEnd(TWO_FUNCTIONS_HEAD, "log('beta-v2');"),
      },
    ];

    const result = encodeSelectivePatch({
      path: "src/app.ts",
      baseText: TWO_FUNCTIONS_BASE,
      headText: TWO_FUNCTIONS_HEAD,
      edits,
      keepEditIds: ["beta"],
    });

    // keepEditIds are the edits RETAINED in the reduced patch: keeping only
    // "beta" means alpha stays at its base content.
    expect(result.reducedText).toBe(TWO_FUNCTIONS_BASE.replace("log('beta');", "log('beta-v2');"));
    applyAndReverse(TWO_FUNCTIONS_BASE, "src/app.ts", result.patch, result.reducedText);
    // The reduced patch must carry the kept edit and no trace of the dropped one.
    expect(result.patch).toContain("+  log('beta-v2');");
    expect(result.patch).not.toContain("alpha-v2");
  });

  it("removes four debug statements while retaining the business change in one hunk", () => {
    // Deletion edits carry an empty head range at the corresponding head
    // offset; the replacement edit carries both sides' real ranges.
    const edits = [
      {
        id: "dbg1",
        baseStartByte: byteOf(FOUR_STATEMENTS_BASE, "  debug('enter main');\n"),
        baseEndByte: byteEnd(FOUR_STATEMENTS_BASE, "  debug('enter main');\n"),
        headStartByte: byteOf(FOUR_STATEMENTS_HEAD, "  const x = compute();"),
        headEndByte: byteOf(FOUR_STATEMENTS_HEAD, "  const x = compute();"),
      },
      {
        id: "dbg2",
        baseStartByte: byteOf(FOUR_STATEMENTS_BASE, "  debug('x=' + x);\n"),
        baseEndByte: byteEnd(FOUR_STATEMENTS_BASE, "  debug('x=' + x);\n"),
        headStartByte: byteOf(FOUR_STATEMENTS_HEAD, "  console.log(x);"),
        headEndByte: byteOf(FOUR_STATEMENTS_HEAD, "  console.log(x);"),
      },
      {
        id: "dbg3",
        baseStartByte: byteOf(FOUR_STATEMENTS_BASE, "  trace(x);\n"),
        baseEndByte: byteEnd(FOUR_STATEMENTS_BASE, "  trace(x);\n"),
        headStartByte: byteOf(FOUR_STATEMENTS_HEAD, "  return x;"),
        headEndByte: byteOf(FOUR_STATEMENTS_HEAD, "  return x;"),
      },
      {
        id: "assert-to-log",
        baseStartByte: byteOf(FOUR_STATEMENTS_BASE, "  assert(x > 0);"),
        baseEndByte: byteEnd(FOUR_STATEMENTS_BASE, "  assert(x > 0);"),
        headStartByte: byteOf(FOUR_STATEMENTS_HEAD, "  console.log(x);"),
        headEndByte: byteEnd(FOUR_STATEMENTS_HEAD, "  console.log(x);"),
      },
    ];

    const result = encodeSelectivePatch({
      path: "src/main.ts",
      baseText: FOUR_STATEMENTS_BASE,
      headText: FOUR_STATEMENTS_HEAD,
      edits,
      // Keep only the business change: all four debug statements stay removed.
      keepEditIds: ["dbg1", "dbg2", "dbg3", "assert-to-log"],
    });
    expect(result.reducedText).toBe(FOUR_STATEMENTS_HEAD);
    applyAndReverse(FOUR_STATEMENTS_BASE, "src/main.ts", result.patch, FOUR_STATEMENTS_HEAD);

    const partial = encodeSelectivePatch({
      path: "src/main.ts",
      baseText: FOUR_STATEMENTS_BASE,
      headText: FOUR_STATEMENTS_HEAD,
      edits,
      keepEditIds: ["assert-to-log"],
    });
    const expectedPartial = [
      "function main() {",
      "  debug('enter main');",
      "  const x = compute();",
      "  debug('x=' + x);",
      "  trace(x);",
      "  console.log(x);",
      "  return x;",
      "}",
    ].join("\n");
    expect(partial.reducedText).toBe(expectedPartial);
    applyAndReverse(FOUR_STATEMENTS_BASE, "src/main.ts", partial.patch, expectedPartial);
  });

  it("regenerates later hunk offsets after an earlier deletion", () => {
    const baseText = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "", "b1", "b2", "b3", ""].join("\n");
    const headText = [
      "a1",
      // a2/a3 deleted
      "a4",
      "a5",
      "a6",
      "a7",
      "a8",
      "a9",
      "a10",
      "",
      "b1-changed",
      "b2",
      "b3",
      "",
    ].join("\n");

    const e1 = {
      id: "del-early",
      baseStartByte: byteOf(baseText, "a2\n"),
      baseEndByte: byteEnd(baseText, "a2\na3\n"),
      headStartByte: 0,
      headEndByte: 0,
    };
    const e2 = {
      id: "b-change",
      baseStartByte: byteOf(baseText, "b1\n"),
      baseEndByte: byteEnd(baseText, "b1\n"),
      headStartByte: byteOf(headText, "b1-changed\n"),
      headEndByte: byteEnd(headText, "b1-changed\n"),
    };

    const result = encodeSelectivePatch({
      path: "list.txt",
      baseText,
      headText,
      edits: [e1, e2],
      keepEditIds: ["del-early", "b-change"],
    });

    applyAndReverse(baseText, "list.txt", result.patch, headText);
    const hunks = mapHunkCoordinates(result.patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.oldStart).toBeLessThan(hunks[1]!.oldStart);
  });

  it("encodes a top insertion and a far-apart deletion as separate hunks", () => {
    const baseText = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10", ""].join("\n");
    const headText = ["zero", "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", ""].join("\n");

    const ins = {
      id: "insert-top",
      baseStartByte: 0,
      baseEndByte: 0,
      headStartByte: 0,
      headEndByte: byteEnd(headText, "zero\n"),
    };
    const del = {
      id: "delete-l10",
      baseStartByte: byteOf(baseText, "l10\n"),
      baseEndByte: byteEnd(baseText, "l10\n"),
      headStartByte: Buffer.byteLength(headText, "utf8"),
      headEndByte: Buffer.byteLength(headText, "utf8"),
    };

    const result = encodeSelectivePatch({
      path: "nums.txt",
      baseText,
      headText,
      edits: [ins, del],
      keepEditIds: ["insert-top", "delete-l10"],
    });

    expect(result.patch.length).toBeGreaterThan(0);
    // Real acceptance is git apply/reverse below.
    applyAndReverse(baseText, "nums.txt", result.patch, headText);
    const hunks = mapHunkCoordinates(result.patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.lines.some((l) => l.kind === "add")).toBe(true);
    expect(hunks[1]!.lines.some((l) => l.kind === "delete")).toBe(true);
  });

  it("preserves CRLF line endings byte-for-byte", () => {
    const baseText = "function a() {\r\n  return 1;\r\n}\r\n";
    const headText = "function a() {\r\n  return 2;\r\n}\r\n";

    const result = encodeSelectivePatch({
      path: "win.ts",
      baseText,
      headText,
      edits: [
        {
          id: "ret",
          baseStartByte: byteOf(baseText, "return 1;"),
          baseEndByte: byteEnd(baseText, "return 1;"),
          headStartByte: byteOf(headText, "return 2;"),
          headEndByte: byteEnd(headText, "return 2;"),
        },
      ],
      keepEditIds: ["ret"],
    });

    applyAndReverse(baseText, "win.ts", result.patch, headText);
    expect(result.reducedText).toContain("\r\n");
    expect(result.reducedText).not.toContain("\n\n");
  });

  it("preserves missing trailing newline (\\ No newline at end of file)", () => {
    const baseText = "alpha\nbeta";
    const headText = "alpha\ngamma";

    const result = encodeSelectivePatch({
      path: "nonl.txt",
      baseText,
      headText,
      edits: [
        {
          id: "swap",
          baseStartByte: byteOf(baseText, "beta"),
          baseEndByte: byteEnd(baseText, "beta"),
          headStartByte: byteOf(headText, "gamma"),
          headEndByte: byteEnd(headText, "gamma"),
        },
      ],
      keepEditIds: ["swap"],
    });

    expect(result.patch).toContain("\\ No newline at end of file");
    applyAndReverse(baseText, "nonl.txt", result.patch, headText);
    expect(result.reducedText).toBe("alpha\ngamma");
  });

  it("supports unicode content and paths with spaces", () => {
    const baseText = "const greeting = 'hello world';\nconst emoji = 'a';\n";
    const headText = "const greeting = 'héllo wörld';\nconst emoji = '🚀';\n";

    const result = encodeSelectivePatch({
      path: "docs/ünicødé file.txt",
      baseText,
      headText,
      edits: [
        {
          id: "greeting",
          baseStartByte: byteOf(baseText, "hello world"),
          baseEndByte: byteEnd(baseText, "hello world"),
          headStartByte: byteOf(headText, "héllo wörld"),
          headEndByte: byteEnd(headText, "héllo wörld"),
        },
        {
          id: "emoji",
          baseStartByte: byteOf(baseText, "'a'"),
          baseEndByte: byteEnd(baseText, "'a'"),
          headStartByte: byteOf(headText, "'🚀'"),
          headEndByte: byteEnd(headText, "'🚀'"),
        },
      ],
      keepEditIds: ["greeting", "emoji"],
    });

    // Non-ASCII is octal-escaped inside the quoted header, like git does;
    // the real git apply/reverse below is the acceptance check.
    expect(result.patch).toMatch(
      /^diff --git "a\/docs\/\\303\\274nic\\303\\270d\\303\\251 file\.txt" "b\//m
    );
    applyAndReverse(baseText, "docs/ünicødé file.txt", result.patch, headText);
  });

  it("returns an empty patch when no edits are kept", () => {
    const result = encodeSelectivePatch({
      path: "src/a.ts",
      baseText: TWO_FUNCTIONS_BASE,
      headText: TWO_FUNCTIONS_HEAD,
      edits: [
        {
          id: "alpha",
          baseStartByte: byteOf(TWO_FUNCTIONS_BASE, "log('alpha');"),
          baseEndByte: byteEnd(TWO_FUNCTIONS_BASE, "log('alpha');"),
          headStartByte: byteOf(TWO_FUNCTIONS_HEAD, "log('alpha-v2');"),
          headEndByte: byteEnd(TWO_FUNCTIONS_HEAD, "log('alpha-v2');"),
        },
        {
          id: "beta",
          baseStartByte: byteOf(TWO_FUNCTIONS_BASE, "log('beta');"),
          baseEndByte: byteEnd(TWO_FUNCTIONS_BASE, "log('beta');"),
          headStartByte: byteOf(TWO_FUNCTIONS_HEAD, "log('beta-v2');"),
          headEndByte: byteEnd(TWO_FUNCTIONS_HEAD, "log('beta-v2');"),
        },
      ],
      keepEditIds: [],
    });

    expect(result.patch).toBe("");
    expect(result.reducedText).toBe(TWO_FUNCTIONS_BASE);
  });

  it("encodes additions to an existing empty file as a normal modification", () => {
    const result = encodeSelectivePatch({
      path: "placeholder.txt",
      baseText: "",
      headText: "content added later\n",
      edits: [
        {
          id: "fill",
          baseStartByte: 0,
          baseEndByte: 0,
          headStartByte: 0,
          headEndByte: Buffer.byteLength("content added later\n", "utf8"),
        },
      ],
      keepEditIds: ["fill"],
    });

    applyAndReverse("", "placeholder.txt", result.patch, "content added later\n");
  });
});

describe("encodeSelectivePatch - validation rejections", () => {
  const BASE = TWO_FUNCTIONS_BASE;
  const HEAD = TWO_FUNCTIONS_HEAD;
  const validEdit = () => ({
    id: "alpha",
    baseStartByte: byteOf(BASE, "log('alpha');"),
    baseEndByte: byteEnd(BASE, "log('alpha');"),
    headStartByte: byteOf(HEAD, "log('alpha-v2');"),
    headEndByte: byteEnd(HEAD, "log('alpha-v2');"),
  });

  it("rejects edits that do not fully explain base -> head", () => {
    expect(() =>
      encodeSelectivePatch({
        path: "src/app.ts",
        baseText: BASE,
        headText: HEAD,
        edits: [], // head differs from base but no edits explain it
      })
    ).toThrow(/explain/i);
  });

  it("rejects byte ranges that split a UTF-8 codepoint", () => {
    const base = "const s = 'héllo';\n";
    const head = "const s = 'héllo!';\n";
    // "é" is 2 bytes; cut in the middle of it.
    const éStart = byteOf(base, "é");
    expect(() =>
      encodeSelectivePatch({
        path: "u.ts",
        baseText: base,
        headText: head,
        edits: [
          {
            id: "split",
            baseStartByte: éStart + 1,
            baseEndByte: byteEnd(base, "éllo"),
            headStartByte: byteOf(head, "éllo"),
            headEndByte: byteEnd(head, "éllo"),
          },
        ],
      })
    ).toThrow(/utf-8|utf8|codepoint|boundary/i);
  });

  it("rejects overlapping edits", () => {
    expect(() =>
      encodeSelectivePatch({
        path: "src/app.ts",
        baseText: BASE,
        headText: HEAD,
        edits: [validEdit(), { ...validEdit(), id: "overlap" }],
      })
    ).toThrow(/overlap/i);
  });

  it("rejects binary-looking content", () => {
    expect(() =>
      encodeSelectivePatch({
        path: "blob.bin",
        baseText: "abc\u0000def",
        headText: "abc\u0000xyz",
        edits: [
          {
            id: "x",
            baseStartByte: 4,
            baseEndByte: 7,
            headStartByte: 4,
            headEndByte: 7,
          },
        ],
      })
    ).toThrow(/binary/i);
  });

  it("rejects symlink and explicit binary inputs (caller owns those)", () => {
    expect(() =>
      encodeSelectivePatch({
        path: "link",
        baseText: "a",
        headText: "b",
        edits: [{ id: "x", baseStartByte: 0, baseEndByte: 1, headStartByte: 0, headEndByte: 1 }],
        isSymlink: true,
      })
    ).toThrow(/symlink/i);
  });

  it("rejects flagged whole-file creation and deletion (caller owns newfile metadata)", () => {
    expect(() =>
      encodeSelectivePatch({
        path: "new.ts",
        baseText: "",
        headText: "brand new file\n",
        edits: [{ id: "x", baseStartByte: 0, baseEndByte: 0, headStartByte: 0, headEndByte: 15 }],
        isNewFile: true,
      })
    ).toThrow(/new file|whole-file/i);
    expect(() =>
      encodeSelectivePatch({
        path: "old.ts",
        baseText: "gone\n",
        headText: "",
        edits: [{ id: "x", baseStartByte: 0, baseEndByte: 5, headStartByte: 0, headEndByte: 0 }],
        isDeletedFile: true,
      })
    ).toThrow(/deletion|whole-file/i);
  });

  it("rejects absolute, traversal, drive-relative and .git paths", () => {
    const base = BASE;
    const head = HEAD;
    const edits = [validEdit()];
    expect(() =>
      encodeSelectivePatch({ path: "C:/evil.ts", baseText: base, headText: head, edits })
    ).toThrow(/path/i);
    expect(() =>
      encodeSelectivePatch({ path: "../evil.ts", baseText: base, headText: head, edits })
    ).toThrow(/path/i);
    expect(() =>
      encodeSelectivePatch({ path: "src\\..\\..\\evil.ts", baseText: base, headText: head, edits })
    ).toThrow(/path/i);
    expect(() =>
      encodeSelectivePatch({ path: "C:evil.ts", baseText: base, headText: head, edits })
    ).toThrow(/path/i);
    expect(() =>
      encodeSelectivePatch({ path: ".git/config", baseText: base, headText: head, edits })
    ).toThrow(/path/i);
  });

  it("quotes header paths containing quotes, backslashes or control characters (header-only: Windows cannot apply such names)", () => {
    const edits = [validEdit(), { ...validEdit(), id: "beta", baseStartByte: byteOf(BASE, "log('beta');"), baseEndByte: byteEnd(BASE, "log('beta');"), headStartByte: byteOf(HEAD, "log('beta-v2');"), headEndByte: byteEnd(HEAD, "log('beta-v2');") }];

    const quoted = encodeSelectivePatch({
      path: 'src/a"b.ts',
      baseText: BASE,
      headText: HEAD,
      edits,
      keepEditIds: ["alpha", "beta"],
    });
    expect(quoted.patch).toContain('"a/src/a\\"b.ts"');

    const tabbed = encodeSelectivePatch({
      path: "src/ta\tb.ts",
      baseText: BASE,
      headText: HEAD,
      edits,
      keepEditIds: ["alpha", "beta"],
    });
    expect(tabbed.patch).toContain('"a/src/ta\\tb.ts"');
  });
});

// ── mapHunkCoordinates ───────────────────────────────────────────

describe("mapHunkCoordinates", () => {
  it("maps context, delete and add lines to base/head line numbers", () => {
    const patch = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,4 +1,3 @@",
      " keep1",
      "-gone1",
      "-gone2",
      "+added",
      " keep2",
      "",
    ].join("\n");

    const hunks = mapHunkCoordinates(patch);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(4);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(3);

    expect(hunk.lines).toEqual([
      { kind: "context", baseLine: 1, headLine: 1, text: " keep1" },
      { kind: "delete", baseLine: 2, text: "-gone1" },
      { kind: "delete", baseLine: 3, text: "-gone2" },
      { kind: "add", headLine: 2, text: "+added" },
      { kind: "context", baseLine: 4, headLine: 3, text: " keep2" },
    ]);
  });

  it("applies zero-count start semantics strictly", () => {
    // Insertion at the very start: old side has zero lines, oldStart 0.
    const insertPatch = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -0,0 +1 @@",
      "+first",
      "",
    ].join("\n");

    const [insHunk] = mapHunkCoordinates(insertPatch);
    expect(insHunk!.oldCount).toBe(0);
    expect(insHunk!.newCount).toBe(1);
    expect(insHunk!.lines).toEqual([{ kind: "add", headLine: 1, text: "+first" }]);
    expect(insHunk!.lines.every((l) => l.baseLine === undefined)).toBe(true);

    // Deletion to empty: new side has zero lines, newStart 0.
    const deletePatch = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1 +0,0 @@",
      "-only",
      "",
    ].join("\n");

    const [delHunk] = mapHunkCoordinates(deletePatch);
    expect(delHunk!.oldCount).toBe(1);
    expect(delHunk!.newCount).toBe(0);
    expect(delHunk!.lines).toEqual([{ kind: "delete", baseLine: 1, text: "-only" }]);
    expect(delHunk!.lines.every((l) => l.headLine === undefined)).toBe(true);
  });

  it("tracks offsets across multiple hunks and \\ No newline markers", () => {
    const patch = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,3 +1,2 @@",
      " a1",
      "-a2",
      "-a3",
      "+A2",
      "@@ -10 +9 @@",
      " tail",
      "\\ No newline at end of file",
      "",
    ].join("\n");

    const hunks = mapHunkCoordinates(patch);
    expect(hunks).toHaveLength(2);

    const [first, second] = hunks;
    expect(first!.lines[0]).toEqual({ kind: "context", baseLine: 1, headLine: 1, text: " a1" });
    expect(first!.lines[1]!.baseLine).toBe(2);
    expect(first!.lines[3]!.headLine).toBe(2);

    expect(second!.oldStart).toBe(10);
    expect(second!.newStart).toBe(9);
    expect(second!.lines).toEqual([
      { kind: "context", baseLine: 10, headLine: 9, text: " tail" },
    ]);
    // A context line without a trailing newline ends BOTH sides' content.
    expect(second!.oldNoNewline).toBe(true);
    expect(second!.newNoNewline).toBe(true);
  });

  it("throws on malformed hunk headers", () => {
    expect(() => mapHunkCoordinates("@@ -x,y +1,2 @@\n")).toThrow();
    expect(() => mapHunkCoordinates("@@ -1,2 1,2 @@\n")).toThrow();
  });

  it("parses multi-file multi-hunk patches with strict count consumption", () => {
    const patch = [
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,2 +1,2 @@",
      " a1",
      "-a2",
      "+a2b",
      "--- a/b.txt",
      "+++ b/b.txt",
      "@@ -1 +1 @@",
      "-x1",
      "+x1b",
      "",
    ].join("\n");

    const hunks = mapHunkCoordinates(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.lines).toEqual([
      { kind: "context", baseLine: 1, headLine: 1, text: " a1" },
      { kind: "delete", baseLine: 2, text: "-a2" },
      { kind: "add", headLine: 2, text: "+a2b" },
    ]);
    expect(hunks[1]!.oldStart).toBe(1);
    expect(hunks[1]!.lines).toEqual([
      { kind: "delete", baseLine: 1, text: "-x1" },
      { kind: "add", headLine: 1, text: "+x1b" },
    ]);
  });

  it("treats header-looking lines as content while hunk counts are pending", () => {
    const patch = [
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,2 +1,2 @@",
      " keep",
      "--- this is deleted content, not a header",
      "+plus",
      "",
    ].join("\n");

    const hunks = mapHunkCoordinates(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toHaveLength(3);
    expect(hunks[0]!.oldCount).toBe(2);
    expect(hunks[0]!.newCount).toBe(2);
    expect(hunks[0]!.lines[1]).toEqual({
      kind: "delete",
      baseLine: 2,
      text: "--- this is deleted content, not a header",
    });
  });

  it("rejects hunks with fewer or more lines than declared", () => {
    const fewer = ["--- a/f.txt", "+++ b/f.txt", "@@ -1,3 +1,3 @@", " a1", " a2", ""].join("\n");
    expect(() => mapHunkCoordinates(fewer)).toThrow(/declared/);

    const extra = ["--- a/f.txt", "+++ b/f.txt", "@@ -1,1 +1,1 @@", " a1", " a2", ""].join("\n");
    expect(() => mapHunkCoordinates(extra)).toThrow(/declared/);
  });

  it("marks both sides missing newline when the marker follows a context line", () => {
    const patch = [
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1 +1 @@",
      " same",
      "\\ No newline at end of file",
      "",
    ].join("\n");

    const [hunk] = mapHunkCoordinates(patch);
    expect(hunk!.oldNoNewline).toBe(true);
    expect(hunk!.newNoNewline).toBe(true);
  });
});
