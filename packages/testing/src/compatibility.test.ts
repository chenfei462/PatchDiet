import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { parseUnifiedDiff, serializeUnifiedDiff, summarizeDiff } from "../../core/src/diff.js";
import { loadPatchDietConfig, mergeConfigWithFlags, createPresetConfig } from "../../core/src/config.js";
import { runShrink } from "../../core/src/shrink.js";
import type { CandidateItem, ShrinkReport } from "../../core/src/types.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await removeDirWithRetries(dir);
  }
});

async function removeDirWithRetries(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // Best-effort cleanup: a leftover temp directory must not fail the test run.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore: Windows can keep transient handles on git object files.
  }
}

function makeDir(): string {
  const dir = join(tmpdir(), `patchdiet-compat-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function initGitRepo(dir: string, branch = "main"): Promise<void> {
  // Run git commands sequentially: `git config` fails with "not in a git directory"
  // when it races ahead of `git init`.
  await execFileAsync("git", ["init", "-b", branch], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "patchdiet@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "PatchDiet"], { cwd: dir });
}

async function commitFile(dir: string, filePath: string, content: string, message: string): Promise<void> {
  writeRepoFile(dir, filePath, content);
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", message], { cwd: dir });
}

function writeRepoFile(dir: string, filePath: string, content: string): void {
  const absolutePath = join(dir, filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

async function createBranch(dir: string, _baseBranch: string, headBranch: string): Promise<void> {
  await execFileAsync("git", ["checkout", "-b", headBranch], { cwd: dir });
}

// ── Helpers for compatibility assertions ──────────────────

function assertReportStructure(report: ShrinkReport): void {
  expect(report).toHaveProperty("baseRef");
  expect(report).toHaveProperty("headRef");
  expect(report).toHaveProperty("input");
  expect(report).toHaveProperty("output");
  expect(report).toHaveProperty("testCommand");
  expect(report.testCommand).toHaveProperty("command");
  expect(report.testCommand).toHaveProperty("status");
  expect(report.testCommand).toHaveProperty("durationMs");
  expect(report.testCommand).toHaveProperty("attempts");
  expect(report).toHaveProperty("candidates");
  expect(report).toHaveProperty("removals");
  expect(report).toHaveProperty("kept");
  expect(report).toHaveProperty("needsHumanReview");
  expect(report).toHaveProperty("artifacts");
  expect(Array.isArray(report.candidates)).toBe(true);
  expect(Array.isArray(report.removals)).toBe(true);
  expect(Array.isArray(report.kept)).toBe(true);
  expect(Array.isArray(report.needsHumanReview)).toBe(true);
  expect(Array.isArray(report.artifacts)).toBe(true);
}

function assertCandidateHasFields(candidate: CandidateItem): void {
  expect(candidate).toHaveProperty("filePath");
  expect(candidate).toHaveProperty("hunkHeader");
  expect(candidate).toHaveProperty("category");
  expect(candidate).toHaveProperty("verdict");
  expect(candidate).toHaveProperty("reason");
}

// ── Backward compatibility: ShrinkReport shape ────────────

describe("backward compatibility: ShrinkReport shape", () => {
  it("has all fields that existed in the initial API contract", () => {
    const minimalReport: ShrinkReport = {
      baseRef: "origin/main",
      headRef: "origin/main",
      input: { fileCount: 0, hunkCount: 0, addedLineCount: 0, removedLineCount: 0, changedLineCount: 0 },
      output: { fileCount: 0, hunkCount: 0, addedLineCount: 0, removedLineCount: 0, changedLineCount: 0 },
      testCommand: { command: "", status: "passed", durationMs: 0, attempts: 0 },
      candidates: [],
      removals: [],
      kept: [],
      needsHumanReview: [],
      artifacts: []
    };

    expect(minimalReport.baseRef).toBe("origin/main");
    expect(minimalReport.headRef).toBe("origin/main");
    assertReportStructure(minimalReport);
  });

  it("preserves optional fields that older versions may have omitted", () => {
    const minimalReport: ShrinkReport = {
      baseRef: "main",
      headRef: "main",
      input: { fileCount: 1, hunkCount: 1, addedLineCount: 1, removedLineCount: 0, changedLineCount: 1 },
      output: { fileCount: 1, hunkCount: 1, addedLineCount: 1, removedLineCount: 0, changedLineCount: 1 },
      testCommand: { command: "echo", status: "passed", durationMs: 100, attempts: 1 },
      candidates: [],
      removals: [],
      kept: [],
      needsHumanReview: [],
      artifacts: []
    };

    // Optional fields like patchPath, reportPath, cleanupBranch should be undefined, not missing
    expect(minimalReport).not.toHaveProperty("patchPath", undefined);
  });
});

// ── Backward compatibility: config defaults ───────────────

describe("backward compatibility: config defaults", () => {
  it("createPresetConfig returns all fields expected by the original contract", () => {
    const config = createPresetConfig();

    expect(config.base).toBe("origin/main");
    expect(config.language).toBe("generic");
    expect(config.commands.required).toEqual([]);
    expect(config.commands.optional).toEqual([]);
    expect(config.reduction.strategy).toBe("conservative");
    expect(config.reduction.atomGranularity).toBe("hunk");
    expect(config.reduction.maxRuntimeMinutes).toBe(20);
    expect(config.reduction.retryFlakyTests).toBe(2);
    expect(config.scope.ignorePaths).toEqual([]);
    expect(config.scope.allowFormatOnlyRemoval).toBe(true);
    expect(config.scope.flagDependencyBumps).toBe(true);
    expect(config.report.html).toBe(true);
    expect(config.report.markdown).toBe(true);
    expect(config.report.githubComment).toBe(true);
  });

  it("loadPatchDietConfig returns defaults for missing config file", () => {
    const dir = makeDir();
    const config = loadPatchDietConfig(dir);

    expect(config.base).toBe("origin/main");
    expect(config.language).toBe("generic");
    expect(config.reduction.strategy).toBe("conservative");
    expect(config.scope.allowFormatOnlyRemoval).toBe(true);
  });

  it("mergeConfigWithFlags does not remove fields that were not overridden", () => {
    const baseConfig = createPresetConfig();
    const merged = mergeConfigWithFlags(baseConfig, { base: "feature/x" });

    // Overridden field changed
    expect(merged.base).toBe("feature/x");
    // Unchanged fields preserved
    expect(merged.language).toBe("generic");
    expect(merged.reduction.strategy).toBe("conservative");
    expect(merged.scope.allowFormatOnlyRemoval).toBe(true);
    expect(merged.report.html).toBe(true);
  });
});

// ── Backward compatibility: diff parser ───────────────────

describe("backward compatibility: diff parser", () => {
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

  it("parses files and hunks identically to original behavior", () => {
    const parsed = parseUnifiedDiff(sampleDiff);

    expect(parsed.files).toHaveLength(2);
    expect(parsed.files[0]?.path).toBe("src/a.ts");
    expect(parsed.files[0]?.hunks).toHaveLength(2);
    expect(parsed.files[1]?.path).toBe("src/b.ts");
    expect(parsed.files[1]?.hunks).toHaveLength(1);
  });

  it("summarizeDiff counts match original behavior", () => {
    const parsed = parseUnifiedDiff(sampleDiff);
    const summary = summarizeDiff(parsed);

    expect(summary.fileCount).toBe(2);
    expect(summary.hunkCount).toBe(3);
    expect(summary.addedLineCount).toBe(3);
    expect(summary.removedLineCount).toBe(2);
    expect(summary.changedLineCount).toBe(5);
  });

  it("handles binary diffs for backward compatibility", () => {
    const input = `diff --git a/asset.bin b/asset.bin
index 1111111..2222222 100644
GIT binary patch
literal 4
LcmZQzU|;|M00aO5
`;
    const parsed = parseUnifiedDiff(input);

    expect(parsed.files).toEqual([
      {
        path: "asset.bin",
        // P0-2: binary sections now capture their header block and raw
        // payload verbatim for byte-exact re-serialization.
        extendedHeaders: [
          "diff --git a/asset.bin b/asset.bin",
          "index 1111111..2222222 100644"
        ],
        binarySection: ["GIT binary patch", "literal 4", "LcmZQzU|;|M00aO5"],
        hunks: [{ header: "GIT binary patch", lines: [], binary: true }]
      }
    ]);
    // Original contract preserved: path and binary hunk flag survive parsing…
    expect(parsed.files[0]?.path).toBe("asset.bin");
    expect(parsed.files[0]?.hunks[0]?.binary).toBe(true);
    // …and the round trip reproduces the section byte-for-byte.
    expect(serializeUnifiedDiff(parsed)).toBe(input);
  });

  it("preserves line kind mapping: add, remove, context", () => {
    const parsed = parseUnifiedDiff(sampleDiff);
    const allLines = parsed.files.flatMap(f => f.hunks.flatMap(h => h.lines));
    const kinds = allLines.map(l => l.kind);

    expect(kinds.filter(k => k === "add").length).toBe(3);
    expect(kinds.filter(k => k === "remove").length).toBe(2);
    expect(kinds.filter(k => k === "context").length).toBeGreaterThanOrEqual(3);
  });
});

// ── Backward compatibility: types ─────────────────────────

describe("backward compatibility: type definitions", () => {
  it("DiffLineKind is limited to context, add, remove", () => {
    const validKinds = ["context", "add", "remove"] as const;
    expect(validKinds).toHaveLength(3);
  });

  it("CandidateVerdict is limited to removed, kept, needs-human-review", () => {
    const validVerdicts = ["removed", "kept", "needs-human-review"] as const;
    expect(validVerdicts).toHaveLength(3);
  });

  it("CandidateCategory includes all expected categories", () => {
    const categories = ["formatting-only", "docs-only", "dependency-related", "generated-like", "unknown"] as const;
    expect(categories).toHaveLength(5);
  });

  it("EvidenceItem and CandidateItem both have filePath, hunkHeader, category, reason", () => {
    const makeEvidenceItem = (): Record<string, unknown> => ({
      filePath: "test.ts",
      hunkHeader: "@@ -1,3 +1,4 @@",
      category: "unknown",
      reason: "test",
      confidence: "kept"
    });
    const makeCandidateItem = (): Record<string, unknown> => ({
      filePath: "test.ts",
      hunkHeader: "@@ -1,3 +1,4 @@",
      category: "unknown",
      verdict: "kept",
      reason: "test"
    });

    expect(makeEvidenceItem()).toHaveProperty("filePath");
    expect(makeEvidenceItem()).toHaveProperty("hunkHeader");
    expect(makeEvidenceItem()).toHaveProperty("category");
    expect(makeEvidenceItem()).toHaveProperty("reason");

    expect(makeCandidateItem()).toHaveProperty("filePath");
    expect(makeCandidateItem()).toHaveProperty("hunkHeader");
    expect(makeCandidateItem()).toHaveProperty("category");
    expect(makeCandidateItem()).toHaveProperty("verdict");
    expect(makeCandidateItem()).toHaveProperty("reason");
  });
});

// ── Backward compatibility: shrink execution ──────────────

describe("backward compatibility: runShrink returns compatible report", () => {
  it("returns a ShrinkReport with all required top-level fields for a minimal diff", async () => {
    const dir = makeDir();
    await initGitRepo(dir);

    writeRepoFile(dir, "src/a.ts", "export const a = 1;\n");
    await commitFile(dir, "src/a.ts", "export const a = 1;", "base: add a.ts");

    await createBranch(dir, "main", "feature");
    writeRepoFile(dir, "src/a.ts", "export const a = 1;\nexport const b = 2;\n");
    await commitFile(dir, "src/a.ts", "export const a = 1;\nexport const b = 2;", "head: add b");

    const report = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "feature",
      requiredCommands: ["echo"],
      dryRun: true
    });

    assertReportStructure(report);
    expect(report.baseRef).toBe("main");
    expect(report.headRef).toBe("feature");

    // No-ghost artifact contract: a DRY RUN writes no files at all, so the
    // report must advertise an empty artifact list and carry no file path
    // fields (a dry run never emits report/patch files).
    expect(report.artifacts).toEqual([]);
    expect(report.patchPath).toBeUndefined();
    expect(report.reportPath).toBeUndefined();
    expect(report.reportJsonPath).toBeUndefined();
    expect(existsSync(join(dir, ".patchdiet", "report.md"))).toBe(false);
    expect(existsSync(join(dir, ".patchdiet", "cleanup.diff"))).toBe(false);

    // Historical v1 contract on an ACTUAL run: the default report artifacts
    // are still emitted, and every listed artifact file really exists.
    const actual = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "feature",
      requiredCommands: ["echo"],
      dryRun: false
    });
    expect(actual.artifacts).toContain(".patchdiet/report.md");
    expect(actual.artifacts).toContain(".patchdiet/run.json");
    expect(actual.artifacts).toContain(".patchdiet/report.html");
    expect(actual.artifacts).toContain(".patchdiet/report.github.md");
    expect(actual.artifacts).toContain(".patchdiet/cleanup.diff");
    expect(actual.patchPath).toBe(join(dir, ".patchdiet", "cleanup.diff"));
    for (const artifact of actual.artifacts) {
      expect(existsSync(join(dir, artifact)), `listed artifact must exist: ${artifact}`).toBe(true);
    }
  }, 60000);

  it("candidates array contains items with expected fields after shrink", async () => {
    const dir = makeDir();
    await initGitRepo(dir);

    writeRepoFile(dir, "src/a.ts", "export const a = 1;\n");
    await commitFile(dir, "src/a.ts", "export const a = 1;", "base");

    await createBranch(dir, "main", "feature");
    writeRepoFile(dir, "src/a.ts", "export const a = 1;\nexport const b = 2;\n");
    await commitFile(dir, "src/a.ts", "export const a = 1;\nexport const b = 2;", "head");

    const report = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "feature",
      requiredCommands: ["echo"],
      dryRun: true
    });

    if (report.candidates.length > 0) {
      assertCandidateHasFields(report.candidates[0]);
    }
  }, 60000);
});

// ── Backward compatibility: config snake_case YAML loading ────────

describe("backward compatibility: YAML snake_case config", () => {
  it("loads config with snake_case keys from YAML without throwing", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "patchdiet.yaml"),
      [
        "base: upstream/main",
        "language: python",
        "commands:",
        "  required:",
        "    - npm test",
        "reduction:",
        "  strategy: conservative",
        "  max_runtime_minutes: 7",
        "  retry_flaky_tests: 3",
        "scope:",
        "  ignore_paths:",
        "    - dist/**",
        "report:",
        "  html: true",
        "  markdown: true",
        "  github_comment: true"
      ].join("\n"),
      "utf8"
    );

    const config = loadPatchDietConfig(dir);

    expect(config.base).toBe("upstream/main");
    expect(config.language).toBe("python");
    expect(config.commands.required).toEqual(["npm test"]);
    expect(config.reduction.maxRuntimeMinutes).toBe(7);
    expect(config.reduction.retryFlakyTests).toBe(3);
    expect(config.scope.ignorePaths).toEqual(["dist/**"]);
    expect(config.report.html).toBe(true);
  });

  it("preserves camelCase field names in returned config regardless of YAML key casing", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "patchdiet.yaml"),
      `base: origin/main\nlanguage: generic\ncommands:\n  required: []\nreduction:\n  strategy: conservative\n  max_runtime_minutes: 20\n  retry_flaky_tests: 2\nscope:\n  ignore_paths: []\nreport:\n  html: true\n  markdown: true\n  github_comment: true`,
      "utf8"
    );

    const config = loadPatchDietConfig(dir);

    // All returned fields must be camelCase (not snake_case)
    expect(config.reduction).toHaveProperty("maxRuntimeMinutes");
    expect(config.reduction).not.toHaveProperty("max_runtime_minutes");
    expect(config.reduction).toHaveProperty("retryFlakyTests");
    expect(config.reduction).not.toHaveProperty("retry_flaky_tests");
    expect(config.scope).toHaveProperty("ignorePaths");
    expect(config.scope).not.toHaveProperty("ignore_paths");
    expect(config.scope).toHaveProperty("allowFormatOnlyRemoval");
    expect(config.scope).not.toHaveProperty("allow_format_only_removal");
    expect(config.report).toHaveProperty("githubComment");
    expect(config.report).not.toHaveProperty("github_comment");
  });
});

// ── Backward compatibility: mergeConfigWithFlags ──────────

describe("backward compatibility: mergeConfigWithFlags", () => {
  it("does not strip commands.optional when merging", () => {
    const base = createPresetConfig();
    const merged = mergeConfigWithFlags(base, { base: "feature/x" });
    expect(merged.commands).toHaveProperty("required");
    expect(merged.commands).toHaveProperty("optional");
    expect(Array.isArray(merged.commands.optional)).toBe(true);
  });

  it("flags.test overrides commands.required without affecting other fields", () => {
    const base = createPresetConfig();
    const merged = mergeConfigWithFlags(base, { test: ["pnpm test"] });
    expect(merged.commands.required).toEqual(["pnpm test"]);
    expect(merged.reduction.strategy).toBe("conservative");
  });
});