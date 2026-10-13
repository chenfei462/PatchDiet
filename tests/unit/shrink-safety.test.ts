import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  areWorktreeCleanupHandlersInstalledForTests,
  cleanupActiveWorktreesSync,
  clearInProcessCachesForTests,
  getConservativeSkipEvaluation,
  matchesPattern,
  pruneStaleEvalWorktrees,
  registerActiveWorktreeForTests,
  runShrink
} from "../../packages/core/src/shrink.js";
import type { DiffFile, DiffHunk } from "../../packages/core/src/types.js";
import type { RunShrinkOptions } from "../../packages/core/src/shrink.js";

const execFileAsync = promisify(execFile);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    // Windows can still hold handles on git objects right after a run (EPERM/EBUSY).
    // Retrying is the documented workaround; a stubborn directory must not fail the
    // suite, so the last failure is swallowed and the next run gets a fresh temp dir.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // ignored: leftover temp directory, not a test result
    }
  }
  clearInProcessCachesForTests();
});

function makeDir(base: string) {
  mkdirSync(base, { recursive: true });
  tempDirs.push(base);
}

// git init must finish before git config runs: concurrent execution races on a
// fresh directory ("fatal: not in a git directory") and made every test in this
// file fail before reaching its assertions.
async function initGitRepo(dir: string, branch = "main") {
  await execFileAsync("git", ["init", "-b", branch], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "patchdiet@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "PatchDiet"], { cwd: dir });
}

function commitFile(dir: string, filePath: string, content: string, message: string) {
  // Nested paths (e.g. "scripts/test_runner.js") need their parent directory.
  mkdirSync(join(dir, dirname(filePath)), { recursive: true });
  writeFileSync(join(dir, filePath), content, "utf8");
  return execFileAsync("git", ["add", "."], { cwd: dir })
    .then(() => execFileAsync("git", ["commit", "-m", message], { cwd: dir }));
}

function runShrinkIn(dir: string, opts: Record<string, unknown> = {}) {
  return runShrink({
    cwd: dir,
    baseRef: "main",
    headRef: "agent/bloated",
    requiredCommands: ["node -e \"process.exit(0)\""],
    ...opts
  });
}

// ── Binary diff (state 1: needs-human-review) ──────────────────────────

describe("shrink safety branches", () => {
  it("marks binary diffs as needs-human-review with blocked risk", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-binary-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "app.js"), "export const app = true;\n", "utf8");
    writeFileSync(join(dir, "asset.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "asset.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "change binary"], { cwd: dir });

    const result = await runShrinkIn(dir);
    expect(result.needsHumanReview.some((item) => item.filePath === "asset.bin")).toBe(true);
  });

  it("keeps paths matching ignorePaths config", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-ignore-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "noise.md"), "noise\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "docs", "noise.md"), "updated noise\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "change docs"], { cwd: dir });

    const result = await runShrinkIn(dir, { ignorePaths: ["docs/**"] });
    expect(result.kept.some((item) => item.filePath === "docs/noise.md" && item.reason.includes("ignored by config"))).toBe(true);
  });

  it("marks rename/copy/delete hunks as needs-human-review", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-rename-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "old.js"), "export const x = 1;\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "src", "new.js"), "export const x = 1;\n", "utf8");
    rmSync(join(dir, "src", "old.js"));
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "rename"], { cwd: dir });

    const result = await runShrinkIn(dir);
    expect(result.needsHumanReview.some((item) => item.filePath === "src/new.js")).toBe(true);
  });

  // ── Test file protection (state 3: kept) ─────────────────────────────

  it("blocks test file removal when allowTestFileRemoval is false", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-testblock-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(join(dir, "test", "math.test.js"), "import test from 'node:test'; test('x', () => {});\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "test", "math.test.js"), "import test from 'node:test'; test('x', () => { assert.equal(1,1); });\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "change test"], { cwd: dir });

    const result = await runShrinkIn(dir, { allowTestFileRemoval: false });
    expect(result.kept.some((item) => item.filePath === "test/math.test.js" && item.reason.includes("human review"))).toBe(true);
    expect(result.removals.some((item) => item.filePath === "test/math.test.js")).toBe(false);
  });

  it("allows test file removal when allowTestFileRemoval is true", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-testallow-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(join(dir, "test", "math.test.js"), "import test from 'node:test'; test('x', () => {});\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "test", "math.test.js"), "import test from 'node:test'; test('x', () => { assert.equal(1,1); });\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "change test"], { cwd: dir });

    const result = await runShrinkIn(dir, { allowTestFileRemoval: true });
    expect(result.removals.some((item) => item.filePath === "test/math.test.js")).toBe(true);
  });

  it("classifies docs-only paths correctly", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-docs-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "guide.md"), "guide\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "docs", "guide.md"), "updated guide\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "update docs"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const docsCandidate = result.candidates.find((item) => item.filePath === "docs/guide.md");
    expect(docsCandidate).toBeDefined();
    expect(docsCandidate!.category).toBe("docs-only");
  });

  it("classifies dependency paths correctly", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-deps-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n', "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "package.json"), '{"type":"module","deps":true}\n', "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "change deps"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const depCandidate = result.candidates.find((item) => item.filePath === "package.json");
    expect(depCandidate).toBeDefined();
    expect(depCandidate!.category).toBe("dependency-related");
  });

  it("classifies generated-like paths correctly", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-generated-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "dist", "bundle.js"), "console.log(1);\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "dist", "bundle.js"), "console.log(2);\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "change dist"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const genCandidate = result.candidates.find((item) => item.filePath === "dist/bundle.js");
    expect(genCandidate).toBeDefined();
    expect(genCandidate!.category).toBe("generated-like");
  });

  it("detects formatting-only changes as formatting-only category", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-format-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "app.js"), "const x=1;\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "src", "app.js"), "const x = 1;\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "format"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const formatCandidate = result.candidates.find((item) => item.filePath === "src/app.js");
    expect(formatCandidate).toBeDefined();
    expect(formatCandidate!.category).toBe("formatting-only");
  });

  // ── getConservativeSkipEvaluation: three-state behavior ──────────────

  it("getConservativeSkipEvaluation: returns undefined verdict path for non-binary, non-test, non-ignored, non-rename changes", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-threestate-proceed-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    await commitFile(dir, "src/main.js", "export const x = 1;\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "src/main.js", "export const x = 2;\n", "change");

    const result = await runShrinkIn(dir);
    const candidate = result.candidates.find((item) => item.filePath === "src/main.js");
    expect(candidate).toBeDefined();
    expect(candidate!.verdict).toBe("removed");
    expect(result.kept.some((item) => item.filePath === "src/main.js")).toBe(false);
    expect(result.needsHumanReview.some((item) => item.filePath === "src/main.js")).toBe(false);
  });

  it("getConservativeSkipEvaluation: three-state - needs-human-review for binary diff", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-threestate-binary-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x00]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "change binary"], { cwd: dir });

    const result = await runShrinkIn(dir);
    expect(result.needsHumanReview.some((item) => item.filePath === "image.png")).toBe(true);
    expect(result.kept.some((item) => item.filePath === "image.png")).toBe(false);
  });

  it("getConservativeSkipEvaluation: three-state - kept verdict for test file when allowTestFileRemoval is undefined", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-threestate-test-undefined-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    await commitFile(dir, "src/math.test.js", "test('x', () => { expect(1).toBe(1); });\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "src/math.test.js", "test('x', () => { expect(1).toBe(2); });\n", "change test");

    const result = await runShrinkIn(dir);
    expect(result.kept.some((item) => item.filePath === "src/math.test.js")).toBe(true);
    expect(result.removals.some((item) => item.filePath === "src/math.test.js")).toBe(false);
  });

  // ── ignorePaths: multiple pattern variations ─────────────────────────

  it("getConservativeSkipEvaluation: ignorePaths matches exact path", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-ignore-exact-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    await commitFile(dir, "config.json", "{}\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "config.json", '{"key":true}\n', "change config");

    const result = await runShrinkIn(dir, { ignorePaths: ["config.json"] });
    expect(result.kept.some((item) => item.filePath === "config.json" && item.reason.includes("ignored by config"))).toBe(true);
  });

  it("getConservativeSkipEvaluation: ignorePaths with glob pattern matches nested files", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-ignore-glob-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "assets", "icons"), { recursive: true });
    await commitFile(dir, "assets/icons/logo.svg", "<svg></svg>\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "assets/icons/logo.svg", "<svg><rect/></svg>\n", "change icon");

    const result = await runShrinkIn(dir, { ignorePaths: ["assets/**"] });
    expect(result.kept.some((item) => item.filePath === "assets/icons/logo.svg" && item.reason.includes("ignored by config"))).toBe(true);
  });

  it("getConservativeSkipEvaluation: ignorePaths with multiple patterns", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-ignore-multi-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    await commitFile(dir, "src/util.js", "util\n", "base");
    await commitFile(dir, "src/types.ts", "type T = any;\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "src/util.js", "util updated\n", "change util");
    await commitFile(dir, "src/types.ts", "type T = string;\n", "change types");

    const result = await runShrinkIn(dir, { ignorePaths: ["src/util.js", "src/types.ts"] });
    expect(result.kept.some((item) => item.filePath === "src/util.js")).toBe(true);
    expect(result.kept.some((item) => item.filePath === "src/types.ts")).toBe(true);
  });

  // ── Binary diff detection priority ───────────────────────────────────

  it("getConservativeSkipEvaluation: binary diff takes priority over test file check", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-binary-test-priority-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "test", "fixtures"), { recursive: true });
    writeFileSync(join(dir, "test", "fixtures", "data.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "test", "fixtures", "data.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "change binary fixture"], { cwd: dir });

    const result = await runShrinkIn(dir);
    expect(result.needsHumanReview.some((item) => item.filePath === "test/fixtures/data.bin")).toBe(true);
    expect(result.kept.some((item) => item.filePath === "test/fixtures/data.bin")).toBe(false);
  });

  it("getConservativeSkipEvaluation: binary diff in file deletion is also detected", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-binary-delete-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "binary.dat"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    rmSync(join(dir, "binary.dat"));
    await execFileAsync("git", ["rm", "binary.dat"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "remove binary"], { cwd: dir });

    const result = await runShrinkIn(dir);
    expect(result.needsHumanReview.some((item) => item.filePath === "binary.dat")).toBe(true);
  });

  // ── Test file detection variants ─────────────────────────────────────

  it("getConservativeSkipEvaluation: test file with .spec.ts suffix is kept by default", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-test-spec-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    await commitFile(dir, "src/math.spec.ts", "describe('math', () => { it('x', () => {}); });\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "src/math.spec.ts", "describe('math', () => { it('x', () => { expect(1).toBe(2); }); });\n", "change spec");

    const result = await runShrinkIn(dir, { allowTestFileRemoval: false });
    expect(result.kept.some((item) => item.filePath === "src/math.spec.ts" && item.reason.includes("human review"))).toBe(true);
  });

  it("getConservativeSkipEvaluation: test file in __tests__ directory is kept by default", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-test-dir-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "src", "__tests__"), { recursive: true });
    await commitFile(dir, "src/__tests__/helper.test.ts", "test('x', () => {});\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "src/__tests__/helper.test.ts", "test('x', () => { expect(true).toBe(true); });\n", "change helper test");

    const result = await runShrinkIn(dir, { allowTestFileRemoval: false });
    expect(result.kept.some((item) => item.filePath === "src/__tests__/helper.test.ts")).toBe(true);
  });

  it("getConservativeSkipEvaluation: test file is removed when allowTestFileRemoval is true regardless of test naming", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-test-allowed-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    await commitFile(dir, "test_math.ts", "test('x', () => {});\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "test_math.ts", "test('x', () => { expect(true).toBe(true); });\n", "change test_math");

    const result = await runShrinkIn(dir, { allowTestFileRemoval: true });
    expect(result.removals.some((item) => item.filePath === "test_math.ts")).toBe(true);
  });

  it("getConservativeSkipEvaluation: ignorePaths takes priority over test file protection", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-ignore-test-priority-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "test"), { recursive: true });
    await commitFile(dir, "test/app.test.js", "test('x', () => {});\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "test/app.test.js", "test('x', () => { expect(true).toBe(true); });\n", "change test file");

    const result = await runShrinkIn(dir, { ignorePaths: ["test/app.test.js"], allowTestFileRemoval: false });
    const keptItem = result.kept.find((item) => item.filePath === "test/app.test.js");
    expect(keptItem).toBeDefined();
    expect(keptItem!.reason).toContain("ignored by config");
    expect(keptItem!.reason).not.toContain("human review");
  });

  it("marks unknown hunks with low risk when no safety flag triggered", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-unknown-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    await commitFile(dir, "src/main.js", "export const x = 1;\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "src/main.js", "export const x = 2;\n", "change");

    const result = await runShrinkIn(dir);
    const unknownCandidate = result.candidates.find((item) => item.filePath === "src/main.js");
    expect(unknownCandidate).toBeDefined();
    expect(unknownCandidate!.category).toBe("unknown");
  });

  // ── Additional three-state coverage ──────────────────────────────────

  it("getConservativeSkipEvaluation: returns undefined for non-test source file (proceeds to evaluation)", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-threestate-default-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    await commitFile(dir, "src/index.js", "export const y = 1;\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "src/index.js", "export const y = 2;\n", "change");

    const result = await runShrinkIn(dir);
    const candidate = result.candidates.find((item) => item.filePath === "src/index.js");
    expect(candidate).toBeDefined();
    expect(candidate!.verdict).toBe("removed");
  });

  it("getConservativeSkipEvaluation: ignorePaths with glob '**' matches nested paths", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-ignore-glob2-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "generated", "nested"), { recursive: true });
    await commitFile(dir, "generated/nested/output.ts", "const x = 1;\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "generated/nested/output.ts", "const x = 2;\n", "change");

    const result = await runShrinkIn(dir, { ignorePaths: ["generated/**"] });
    const keptItem = result.kept.find((item) => item.filePath === "generated/nested/output.ts");
    expect(keptItem).toBeDefined();
    expect(keptItem!.reason).toContain("ignored by config");
  });

  it("getConservativeSkipEvaluation: ignorePaths with wildcard pattern matches filename", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-ignore-wildcard-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    await commitFile(dir, "config.prod.js", "module.exports = {};\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "config.prod.js", "module.exports = {prod: true};\n", "change");

    const result = await runShrinkIn(dir, { ignorePaths: ["config.*.js"] });
    const keptItem = result.kept.find((item) => item.filePath === "config.prod.js");
    expect(keptItem).toBeDefined();
    expect(keptItem!.reason).toContain("ignored by config");
  });

  it("getConservativeSkipEvaluation: empty ignorePaths does not skip any file", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-ignore-empty-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    await commitFile(dir, "src/main.js", "const a = 1;\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "src/main.js", "const a = 2;\n", "change");

    const result = await runShrinkIn(dir, { ignorePaths: [] });
    const candidate = result.candidates.find((item) => item.filePath === "src/main.js");
    expect(candidate).toBeDefined();
    expect(candidate!.verdict).toBe("removed");
  });

  // ── Binary diff coverage ─────────────────────────────────────────────

  it("getConservativeSkipEvaluation: binary file in dist/ is flagged for human review", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-binary-dist-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "dist", "bundle.js"), "console.log('v1');\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "dist", "bundle.js"), "console.log('v2');\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "update dist"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const distCandidate = result.candidates.find((item) => item.filePath === "dist/bundle.js");
    expect(distCandidate).toBeDefined();
    expect(distCandidate!.category).toBe("generated-like");
  });

  it("getConservativeSkipEvaluation: binary test fixture bypasses test protection", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-binary-test-fix-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "test", "fixtures"), { recursive: true });
    writeFileSync(join(dir, "test", "fixtures", "sample.bin"), Buffer.from([0x00, 0x01, 0x02]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "test", "fixtures", "sample.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "update fixture"], { cwd: dir });

    const result = await runShrinkIn(dir);
    expect(result.needsHumanReview.some((item) => item.filePath === "test/fixtures/sample.bin")).toBe(true);
    expect(result.kept.some((item) => item.filePath === "test/fixtures/sample.bin")).toBe(false);
  });

  it("getConservativeSkipEvaluation: binary file with all zero bytes is detected", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-binary-zeros-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "data.bin"), Buffer.alloc(8, 0x00), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "data.bin"), Buffer.alloc(8, 0x01), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "change zeros"], { cwd: dir });

    const result = await runShrinkIn(dir);
    expect(result.needsHumanReview.some((item) => item.filePath === "data.bin")).toBe(true);
  });

  // ── Test file coverage ────────────────────────────────────────────────

  it("getConservativeSkipEvaluation: test file with test_ prefix is protected", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-test-prefix-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    await commitFile(dir, "test_helper.js", "module.exports = {};\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "test_helper.js", "module.exports = {updated: true};\n", "change");

    const result = await runShrinkIn(dir);
    expect(result.kept.some((item) => item.filePath === "test_helper.js")).toBe(true);
  });

  it("getConservativeSkipEvaluation: test file in path with /test_ segment is protected", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-test-segment-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    await commitFile(dir, "scripts/test_runner.js", "module.exports = {};\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "scripts/test_runner.js", "module.exports = {v2: true};\n", "change");

    const result = await runShrinkIn(dir);
    expect(result.kept.some((item) => item.filePath === "scripts/test_runner.js")).toBe(true);
  });

  it("getConservativeSkipEvaluation: test file in tests/ directory is protected", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-tests-dir-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "tests"), { recursive: true });
    await commitFile(dir, "tests/unit.spec.ts", "describe('unit', () => {});\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "tests/unit.spec.ts", "describe('unit', () => { it('x', () => {}); });\n", "change");

    const result = await runShrinkIn(dir);
    expect(result.kept.some((item) => item.filePath === "tests/unit.spec.ts")).toBe(true);
  });

  it("getConservativeSkipEvaluation: .spec.js file in root is protected", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-spec-root-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    await commitFile(dir, "app.spec.js", "it('works', () => {});\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "app.spec.js", "it('works', () => { expect(true).toBe(true); });\n", "change");

    const result = await runShrinkIn(dir);
    expect(result.kept.some((item) => item.filePath === "app.spec.js")).toBe(true);
  });

  it("getConservativeSkipEvaluation: test file removed when allowTestFileRemoval explicitly true", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-test-true-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    await commitFile(dir, "e2e/flows.spec.ts", "describe('flows', () => {});\n", "base");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "e2e/flows.spec.ts", "describe('flows', () => { it('run', () => {}); });\n", "change");

    const result = await runShrinkIn(dir, { allowTestFileRemoval: true });
    expect(result.removals.some((item) => item.filePath === "e2e/flows.spec.ts")).toBe(true);
  });

  // ── Priority ordering ────────────────────────────────────────────────

  it("getConservativeSkipEvaluation: binary check takes priority over ignorePaths", async () => {
    // The direct unit test "prioritizes binary review over ignorePaths and test
    // protection" pins binary review above ignorePaths; a binary diff can never
    // be validated by reverting, so it must always be escalated.
    const dir = join(tmpdir(), `patchdiet-safety-priority-ignore-binary-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "change"], { cwd: dir });

    const result = await runShrinkIn(dir, { ignorePaths: ["image.png"] });
    const reviewItem = result.needsHumanReview.find((item) => item.filePath === "image.png");
    expect(reviewItem).toBeDefined();
    expect(reviewItem!.reason).toBe("binary diff requires human review");
    expect(result.kept.some((item) => item.filePath === "image.png")).toBe(false);
  });

  it("getConservativeSkipEvaluation: binary check takes priority over test file protection", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-priority-binary-test-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(join(dir, "test", "fixture.dat"), Buffer.from([0x00, 0x01]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "test", "fixture.dat"), Buffer.from([0x00, 0x01, 0x02]), "binary");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "change"], { cwd: dir });

    const result = await runShrinkIn(dir, { allowTestFileRemoval: true });
    expect(result.needsHumanReview.some((item) => item.filePath === "test/fixture.dat")).toBe(true);
    expect(result.removals.some((item) => item.filePath === "test/fixture.dat")).toBe(false);
  });
});

describe("getConservativeSkipEvaluation direct unit coverage", () => {
  function createFile(path = "src/main.js", binary = false): DiffFile {
    const hunk: DiffHunk = {
      header: "@@ -1 +1 @@",
      lines: [{ kind: "add", text: "export const value = 1;\n" }]
    };
    if (binary) hunk.binary = true;
    return { path, hunks: [hunk] };
  }

  function createOptions(overrides: Partial<RunShrinkOptions> = {}): RunShrinkOptions {
    return {
      cwd: tmpdir(),
      baseRef: "main",
      headRef: "main",
      requiredCommands: [],
      ...overrides
    };
  }

  it("sends protected paths to human review even when tests would pass", () => {
    const result = getConservativeSkipEvaluation(
      createFile("db/migrations/001.sql"),
      createOptions({ protectPaths: ["**/migrations/**"] })
    );
    expect(result?.verdict).toBe("needs-human-review");
    expect(result?.reason).toContain("protected path");
  });

  it("sends nested dependency manifests to human review under v2 policy", () => {
    const result = getConservativeSkipEvaluation(
      createFile("packages/api/package.json"),
      createOptions({ dependencyManifestsHumanReview: true })
    );
    expect(result?.category).toBe("dependency-related");
    expect(result?.verdict).toBe("needs-human-review");
  });

  it("returns undefined when no conservative skip condition applies", () => {
    const result = getConservativeSkipEvaluation(
      createFile(),
      createOptions({ allowTestFileRemoval: true })
    );
    expect(result).toBeUndefined();
  });

  it("returns needs-human-review for a binary diff", () => {
    const result = getConservativeSkipEvaluation(
      createFile("asset.bin", true),
      createOptions({ allowTestFileRemoval: true })
    );

    expect(result).toEqual({
      filePath: "asset.bin",
      verdict: "needs-human-review",
      reason: "binary diff requires human review",
      category: "unknown"
    });
  });

  it("returns kept for an exact ignorePaths match", () => {
    const result = getConservativeSkipEvaluation(
      createFile("config.json"),
      createOptions({ ignorePaths: ["config.json"] })
    );

    expect(result).toEqual({
      filePath: "config.json",
      verdict: "kept",
      reason: "kept because path is ignored by config",
      category: "unknown"
    });
  });

  it("returns kept for a nested ignorePaths glob", () => {
    const result = getConservativeSkipEvaluation(
      createFile("generated/output.ts"),
      createOptions({ ignorePaths: ["generated/**"] })
    );

    expect(result?.filePath).toBe("generated/output.ts");
    expect(result?.verdict).toBe("kept");
    expect(result?.reason).toContain("ignored by config");
  });

  it("returns kept for a default-protected test file", () => {
    const result = getConservativeSkipEvaluation(
      createFile("src/math.test.ts"),
      createOptions()
    );

    expect(result?.filePath).toBe("src/math.test.ts");
    expect(result?.verdict).toBe("kept");
    expect(result?.reason).toContain("human review by default");
  });

  it("returns undefined when test-file removal is explicitly allowed", () => {
    const result = getConservativeSkipEvaluation(
      createFile("src/math.test.ts"),
      createOptions({ allowTestFileRemoval: true })
    );
    expect(result).toBeUndefined();
  });

  it("prioritizes binary review over ignorePaths and test protection", () => {
    const result = getConservativeSkipEvaluation(
      createFile("test/fixtures/data.bin", true),
      createOptions({ ignorePaths: ["test/**"], allowTestFileRemoval: true })
    );

    expect(result?.filePath).toBe("test/fixtures/data.bin");
    expect(result?.verdict).toBe("needs-human-review");
    expect(result?.reason).toBe("binary diff requires human review");
  });

  it("prioritizes ignorePaths over test-file protection", () => {
    const result = getConservativeSkipEvaluation(
      createFile("test/app.test.js"),
      createOptions({ ignorePaths: ["test/app.test.js"] })
    );

    expect(result?.filePath).toBe("test/app.test.js");
    expect(result?.verdict).toBe("kept");
    expect(result?.reason).toContain("ignored by config");
  });

  // ── Additional path classification edge cases ─────────────────────────────────

  it("classifies README.md as docs-only", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-readme-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "README.md"), "# Test\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "README.md"), "# Updated\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "update readme"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const candidate = result.candidates.find((item) => item.filePath === "README.md");
    expect(candidate).toBeDefined();
    expect(candidate!.category).toBe("docs-only");
  });

  it("classifies .txt file as docs-only", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-txt-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "notes.txt"), "notes\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "notes.txt"), "updated notes\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "update notes"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const candidate = result.candidates.find((item) => item.filePath === "notes.txt");
    expect(candidate).toBeDefined();
    expect(candidate!.category).toBe("docs-only");
  });

  it("classifies .mdx files as docs-only", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-mdx-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "page.mdx"), "---\ntitle: Test\n---\nContent\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "page.mdx"), "---\ntitle: Updated\n---\nMore\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "update page"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const candidate = result.candidates.find((item) => item.filePath === "page.mdx");
    expect(candidate).toBeDefined();
    expect(candidate!.category).toBe("docs-only");
  });

  it("classifies go.mod files as dependency-related", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-go-mod-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "go.mod"), "module example\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "go.mod"), "module example/v2\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "update go mod"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const candidate = result.candidates.find((item) => item.filePath === "go.mod");
    expect(candidate).toBeDefined();
    expect(candidate!.category).toBe("dependency-related");
  });

  it("classifies cargo.toml files as dependency-related", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-cargo-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "Cargo.toml"), "[package]\nname = 'test'\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "Cargo.toml"), "[package]\nname = 'test'\nversion = '2.0'\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "update cargo"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const candidate = result.candidates.find((item) => item.filePath === "Cargo.toml");
    expect(candidate).toBeDefined();
    expect(candidate!.category).toBe("dependency-related");
  });

  it("classifies .snap files as generated-like", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-snap-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "test.snap"), "snapshot content\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "test.snap"), "updated snapshot\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "update snapshot"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const candidate = result.candidates.find((item) => item.filePath === "test.snap");
    expect(candidate).toBeDefined();
    expect(candidate!.category).toBe("generated-like");
  });

  it("classifies .min.js files as generated-like", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-minjs-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    writeFileSync(join(dir, "app.min.js"), "console.log('v1');", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    writeFileSync(join(dir, "app.min.js"), "console.log('v2');", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "update minify"], { cwd: dir });

    const result = await runShrinkIn(dir);
    const candidate = result.candidates.find((item) => item.filePath === "app.min.js");
    expect(candidate).toBeDefined();
    expect(candidate!.category).toBe("generated-like");
  });
});

describe("matchesPattern function coverage", () => {
  it("matchesPattern: exact path match", () => {
    expect(matchesPattern("src/main.js", "src/main.js")).toBe(true);
    expect(matchesPattern("src/main.js", "src/other.js")).toBe(false);
  });

  it("matchesPattern: glob pattern with single wildcard", () => {
    expect(matchesPattern("src/app.js", "src/*.js")).toBe(true);
    expect(matchesPattern("src/app.ts", "src/*.js")).toBe(false);
  });

  it("matchesPattern: glob pattern with double wildcard for directory", () => {
    expect(matchesPattern("src/utils/helper.js", "src/**/*.js")).toBe(true);
    expect(matchesPattern("scripts/build.js", "scripts/**/*.js")).toBe(true);
  });

  it("matchesPattern: backslash normalization on Windows style paths", () => {
    expect(matchesPattern("src\\main.js", "src/main.js")).toBe(true);
  });

  // ── L1: glob "?" semantics ────────────────────────────────────────────

  it("matchesPattern: question mark matches exactly one non-slash character", () => {
    expect(matchesPattern("src/a1.js", "src/a?.js")).toBe(true);
    // A "?" must never act as a regex quantifier for the preceding character.
    expect(matchesPattern("src/a.js", "src/a?.js")).toBe(false);
    expect(matchesPattern("src/a12.js", "src/a?.js")).toBe(false);
    expect(matchesPattern("src/a/b.js", "src/?.js")).toBe(false);
    expect(matchesPattern("confi.js", "config?.js")).toBe(false);
    expect(matchesPattern("config1.js", "config?.js")).toBe(true);
  });

  it("matchesPattern: mid-segment ** matches zero or more directories", () => {
    expect(matchesPattern("a/c.js", "a/**/c.js")).toBe(true);
    expect(matchesPattern("a/b/c.js", "a/**/c.js")).toBe(true);
    expect(matchesPattern("a/x/y/c.js", "a/**/c.js")).toBe(true);
    expect(matchesPattern("a/x/y/c.js", "a/**/d.js")).toBe(false);
    expect(matchesPattern("p/q/r.js", "p/**")).toBe(true);
    expect(matchesPattern("q/r.js", "p/**")).toBe(false);
  });
});

// ── H5/M3/H8/L4/M2 engine reliability suites ───────────────────────────

const PADDING_LINES = Array.from({ length: 12 }, (_value, index) => `// padding ${index + 3}`);

function buildG2G3Base(): string {
  return ["function g(){return 1;}", "module.exports={g};", ...PADDING_LINES].join("\n") + "\n";
}

function buildG2G3Head(): string {
  return [
    "function g(){return 1;}",
    "module.exports={g};",
    "function g2(){return 1;}",
    "module.exports.g2=g2;",
    ...PADDING_LINES,
    "function g3(){return 1;}",
    "module.exports.g3=g3;"
  ].join("\n") + "\n";
}

// Passes when at least one of g2/g3 survived — so reverting either hunk alone
// keeps checks green, but reverting both at once (the combined removal set)
// breaks them.
const G2G3_CHECK_COMMAND =
  "node -e \"const m=require('./f.js');process.exit(((m.g2?m.g2():9)===1||(m.g3?m.g3():9)===1)?0:1)\"";

/** Commits baseFiles on main, then headFiles on a new agent/bloated branch. */
async function makeChangeRepo(
  dir: string,
  baseFiles: Record<string, string>,
  headFiles: Record<string, string>
): Promise<void> {
  await initGitRepo(dir);
  for (const [filePath, content] of Object.entries(baseFiles)) {
    await commitFile(dir, filePath, content, `base ${filePath}`);
  }
  await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
  for (const [filePath, content] of Object.entries(headFiles)) {
    await commitFile(dir, filePath, content, `head ${filePath}`);
  }
}

function captureStderr(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const writeSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(((...args: unknown[]) => {
      writes.push(String(args[0]));
      return true;
    }) as typeof process.stderr.write);
  return { writes, restore: () => writeSpy.mockRestore() };
}

describe("H5 worktree lifecycle fault tolerance", () => {
  it("P0-3: a leftover directory that looks like an old eval worktree cannot block or pollute a new run", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-h5-retry-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(
      dir,
      { "src/main.js": "export const x = 1;\n" },
      { "src/main.js": "export const x = 2;\n" }
    );

    // P0-3 contract update: run scratch now lives under a unique
    // .patchdiet/eval/<runId>/ path, so a crashed earlier run can never
    // collide with a new run's worktree paths. Leftover directories that
    // merely look like eval paths are USER content as far as cleanup is
    // concerned — they must be preserved, not deleted.
    const staleEvalWorktree = join(dir, ".patchdiet", "eval", "src-main.js-file");
    mkdirSync(staleEvalWorktree, { recursive: true });
    writeFileSync(join(staleEvalWorktree, "junk.txt"), "leftover from a crashed run", "utf8");

    const result = await runShrinkIn(dir);

    expect(result.removals.some((item) => item.filePath === "src/main.js")).toBe(true);
    // The leftover is untouched and the run's own scratch is gone.
    expect(existsSync(join(staleEvalWorktree, "junk.txt"))).toBe(true);
    expect(readdirSync(join(dir, ".patchdiet", "eval"))).toEqual(["src-main.js-file"]);
  });

  it("P0-3: stale pruning never deletes directories by path pattern — only git metadata is pruned", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-h5-stale-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    await commitFile(dir, "src/main.js", "export const x = 1;\n", "base");

    mkdirSync(join(dir, ".patchdiet", "eval"), { recursive: true });
    const staleWt = join(dir, ".patchdiet", "eval", "stale-one");
    const freshWt = join(dir, ".patchdiet", "eval", "fresh-one");
    const userWt = join(dir, "user-worktree");
    await execFileAsync("git", ["worktree", "add", "--detach", staleWt, "main"], { cwd: dir });
    await execFileAsync("git", ["worktree", "add", "--detach", freshWt, "main"], { cwd: dir });
    await execFileAsync("git", ["worktree", "add", "--detach", userWt, "main"], { cwd: dir });

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(staleWt, eightDaysAgo, eightDaysAgo);

    // P0-3 contract update: deleting an 8-day-old directory whose path merely
    // looks like an eval worktree could destroy live user work. Ownership by
    // path pattern is gone — every worktree survives; only stale git
    // registration metadata is pruned (which never removes directories).
    const removed = await pruneStaleEvalWorktrees(dir);

    expect(removed).toBe(0);
    expect(existsSync(staleWt)).toBe(true);
    expect(existsSync(freshWt)).toBe(true);
    expect(existsSync(userWt)).toBe(true);
    const list = (await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd: dir })).stdout;
    expect(list).toContain("stale-one");
    expect(list).toContain("fresh-one");
    expect(list).toContain("user-worktree");
  });

  it("signal-path cleanup removes tracked eval worktrees and prunes metadata", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-h5-signal-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    await commitFile(dir, "src/main.js", "export const x = 1;\n", "base");

    mkdirSync(join(dir, ".patchdiet", "eval"), { recursive: true });
    const wt = join(dir, ".patchdiet", "eval", "manual");
    await execFileAsync("git", ["worktree", "add", "--detach", wt, "main"], { cwd: dir });
    registerActiveWorktreeForTests(wt, dir);

    cleanupActiveWorktreesSync();

    expect(existsSync(wt)).toBe(false);
    const list = (await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd: dir })).stdout;
    expect(list).not.toContain("eval/manual");
  });

  it("installs SIGINT/SIGTERM/beforeExit cleanup handlers once and never duplicates them", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-h5-handlers-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(
      dir,
      { "src/main.js": "export const x = 1;\n" },
      { "src/main.js": "export const x = 2;\n" }
    );

    await runShrinkIn(dir);
    expect(areWorktreeCleanupHandlersInstalledForTests()).toBe(true);

    const sigint = process.listenerCount("SIGINT");
    const sigterm = process.listenerCount("SIGTERM");
    const beforeExit = process.listenerCount("beforeExit");
    await runShrinkIn(dir);
    expect(process.listenerCount("SIGINT")).toBe(sigint);
    expect(process.listenerCount("SIGTERM")).toBe(sigterm);
    expect(process.listenerCount("beforeExit")).toBe(beforeExit);
  });

  it("removes eval *.diff artifacts at run end while keeping cleanup.diff", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-h5-evaldiff-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(
      dir,
      {
        "src/main.js": "export const x = 1;\n",
        "test/math.test.js": "test('x', () => { expect(1).toBe(1); });\n"
      },
      {
        "src/main.js": "export const x = 2;\n",
        "test/math.test.js": "test('x', () => { expect(1).toBe(2); });\n"
      }
    );

    const result = await runShrinkIn(dir);

    // src/main.js is removed; the protected test-file change is kept, so
    // cleanup.diff (the kept patch) must survive the eval-tree cleanup.
    expect(result.removals.some((item) => item.filePath === "src/main.js")).toBe(true);
    expect(result.patchPath).toBeTruthy();
    const keptPatch = readFileSync(result.patchPath!, "utf8");
    expect(keptPatch).toContain("test/math.test.js");
    expect(keptPatch).not.toContain("src/main.js");
    expect(existsSync(join(dir, ".patchdiet", "eval"))).toBe(false);
  });
});

describe("M3 combined removal verification", () => {
  it("keeps removals when the combined removal set passes full checks", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-m3-pass-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(
      dir,
      { "src/a.js": "export const a = 1;\n", "src/b.js": "export const b = 1;\n" },
      { "src/a.js": "export const a = 2;\n", "src/b.js": "export const b = 2;\n" }
    );

    const result = await runShrinkIn(dir);

    expect(result.removals).toHaveLength(2);
    expect(result.partial ?? false).toBe(false);
  });

  it("downgrades to kept-only and marks the report partial when the combined set fails", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-m3-downgrade-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(dir, { "f.js": buildG2G3Base() }, { "f.js": buildG2G3Head() });

    const result = await runShrinkIn(dir, { requiredCommands: [G2G3_CHECK_COMMAND] });

    // Both hunks pass individually (each hunk was about to be removed) ...
    expect(result.candidates.filter((item) => item.filePath === "f.js")).toHaveLength(2);
    // ... but the combined removal set fails, so nothing may be removed.
    expect(result.removals).toHaveLength(0);
    const downgraded = result.needsHumanReview.filter((item) => item.filePath === "f.js");
    expect(downgraded).toHaveLength(2);
    for (const item of downgraded) {
      expect(item.reason).toContain("downgraded to keep-only");
      expect(item.reason).toContain("combined removal verification");
    }
    expect(result.partial).toBe(true);
    expect(result.partialReason).toContain("combined removal verification failed");

    // kept-only: cleanup.diff must contain every hunk again.
    const patch = readFileSync(join(dir, ".patchdiet", "cleanup.diff"), "utf8");
    expect(patch).toContain("g2");
    expect(patch).toContain("g3");
  });
});

describe("H8 global runtime budget", () => {
  it("fails closed with an explicit budget error when the deadline is exhausted before the baseline (P0-3 contract)", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-h8-budget-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(
      dir,
      { "src/main.js": "export const x = 1;\n" },
      { "src/main.js": "export const x = 2;\n" }
    );

    // P0-3 contract update: with a 1ms budget nothing has been attested — no
    // baseline ran — so the engine fails closed with a budget error and
    // cleans up instead of emitting a diagnostic report. Mid-run exhaustion
    // (after candidates passed) is covered by the combined-verification
    // downgrade tests in tests/e2e/shrink-p0-3-verifier.test.ts.
    await expect(runShrinkIn(dir, { maxRuntimeMs: 1 })).rejects.toThrow(/budget/i);
    const list = (await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd: dir })).stdout;
    expect(list).not.toContain(".patchdiet/eval");
  });
});

describe("L4 run.json audit fields", () => {
  it("records timestamps, patchdiet version, commit SHAs and the original command line", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-l4-audit-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(
      dir,
      { "src/main.js": "export const x = 1;\n" },
      { "src/main.js": "export const x = 2;\n" }
    );

    const result = await runShrinkIn(dir, { commandLineArgs: ["shrink", "--base", "main"] });

    const runJson = JSON.parse(
      readFileSync(join(dir, ".patchdiet", "run.json"), "utf8")
    ) as Record<string, unknown>;
    expect(Number.isNaN(Date.parse(runJson["startedAt"] as string))).toBe(false);
    expect(Number.isNaN(Date.parse(runJson["finishedAt"] as string))).toBe(false);
    expect(runJson["startedAt"]).toBe(result.startedAt);
    expect(typeof runJson["durationMs"]).toBe("number");
    expect(typeof runJson["patchdietVersion"]).toBe("string");
    expect((runJson["patchdietVersion"] as string).length).toBeGreaterThan(0);
    const baseSha = (await execFileAsync("git", ["rev-parse", "main"], { cwd: dir })).stdout.trim();
    const headSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
    expect(runJson["baseCommitSha"]).toBe(baseSha);
    expect(runJson["headCommitSha"]).toBe(headSha);
    expect(runJson["commandLineArgs"]).toEqual(["shrink", "--base", "main"]);
  });

  it("falls back to process argv when no explicit command line is provided", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-l4-argv-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(
      dir,
      { "src/main.js": "export const x = 1;\n" },
      { "src/main.js": "export const x = 2;\n" }
    );

    const result = await runShrinkIn(dir);

    // Without an explicit override the audit trail mirrors this process's argv
    // (a vitest worker may legitimately have no extra arguments at all).
    expect(result.commandLineArgs).toEqual(process.argv.slice(2));
  });
});

describe("M2 dry-run consistency and dirty-tree warning", () => {
  it("evaluates dry-run candidates inside the target cwd so project node_modules resolves", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-m2-dryrun-${Date.now()}`);
    makeDir(dir);
    await initGitRepo(dir);
    await commitFile(dir, ".gitignore", "node_modules/\n", "ignore deps");
    await commitFile(dir, "src/main.js", "export const x = 1;\n", "base");
    mkdirSync(join(dir, "node_modules", "mydep"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules", "mydep", "package.json"),
      '{"name":"mydep","main":"index.js"}\n',
      "utf8"
    );
    writeFileSync(join(dir, "node_modules", "mydep", "index.js"), "module.exports = 42;\n", "utf8");
    await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
    await commitFile(dir, "src/main.js", "export const x = 2;\n", "head change");

    // The required command can only pass where node_modules is resolvable. Eval
    // worktrees must therefore live inside the target cwd — in the old tmpdir
    // location every candidate would have been misjudged as "kept".
    const result = await runShrinkIn(dir, {
      dryRun: true,
      requiredCommands: ["node -e \"require('mydep');process.exit(0)\""]
    });

    expect(result.removals.some((item) => item.filePath === "src/main.js")).toBe(true);
    // Dry run leaves the repository exactly as it found it.
    expect(existsSync(join(dir, ".patchdiet"))).toBe(false);
  });

  it("warns on stderr when the working tree is dirty", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-m2-dirty-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(
      dir,
      { "src/main.js": "export const x = 1;\n" },
      { "src/main.js": "export const x = 2;\n" }
    );
    writeFileSync(join(dir, "untracked.txt"), "uncommitted work\n", "utf8");

    const { writes, restore } = captureStderr();
    try {
      await runShrinkIn(dir);
    } finally {
      restore();
    }

    expect(writes.join("")).toContain("working tree is dirty");
  });

  it("does not warn when the working tree is clean", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-m2-clean-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(
      dir,
      { "src/main.js": "export const x = 1;\n" },
      { "src/main.js": "export const x = 2;\n" }
    );

    const { writes, restore } = captureStderr();
    try {
      await runShrinkIn(dir);
    } finally {
      restore();
    }

    expect(writes.join("")).not.toContain("working tree is dirty");
  });
});

describe("H8 eval worktree pool", () => {
  const twoFileBase = { "src/a.js": "export const a = 1;\n", "src/b.js": "export const b = 1;\n" };
  const twoFileHead = { "src/a.js": "export const a = 2;\n", "src/b.js": "export const b = 2;\n" };

  it("evaluates candidates through a pool of 2 worktrees with identical verdicts", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-h8-pool2-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(dir, twoFileBase, twoFileHead);

    const result = await runShrinkIn(dir, { maxParallelWorktrees: 2 });

    expect(result.removals).toHaveLength(2);
    expect(result.partial ?? false).toBe(false);
  });

  it("clamps values below 1 back to serial evaluation", async () => {
    const dir = join(tmpdir(), `patchdiet-safety-h8-pool0-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(dir, twoFileBase, twoFileHead);

    const result = await runShrinkIn(dir, { maxParallelWorktrees: 0 });

    expect(result.removals).toHaveLength(2);
    expect(result.partial ?? false).toBe(false);
  });
});

// ── P0-1: fail-closed oracle guard at the engine boundary ─────────────

describe("P0-1 runShrink rejects an empty or blank oracle before any mutation", () => {
  const oneFileBase = { "src/a.js": "export const a = 1;\n" };
  const oneFileHead = { "src/a.js": "export const a = 2;\n" };

  async function expectFailClosed(
    requiredCommands: string[],
    matchMessage: RegExp
  ): Promise<void> {
    const dir = join(tmpdir(), `patchdiet-safety-p01-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    makeDir(dir);
    await makeChangeRepo(dir, oneFileBase, oneFileHead);
    const patchDirExistedBefore = existsSync(join(dir, ".patchdiet"));

    await expect(runShrinkIn(dir, { requiredCommands })).rejects.toThrow(matchMessage);

    // Fail closed means fail BEFORE any repo mutation: no .patchdiet dir, no
    // eval artifacts, no report — the run must have rejected up front.
    expect(existsSync(join(dir, ".patchdiet"))).toBe(patchDirExistedBefore);
  }

  it("rejects requiredCommands: [] with the fail-closed oracle message", async () => {
    await expectFailClosed([], /no required verification oracle configured/i);
  });

  it("rejects a whitespace-only command", async () => {
    await expectFailClosed(["   "], /empty or blank/i);
  });

  it("rejects a list that contains one blank command among valid ones", async () => {
    await expectFailClosed(
      ["node -e \"process.exit(0)\"", " \t "],
      /empty or blank/i
    );
  });

  it("rejects an empty-string command", async () => {
    await expectFailClosed([""], /empty or blank/i);
  });
});
