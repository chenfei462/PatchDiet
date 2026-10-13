import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { getDiff } from "../../packages/core/src/git.js";
import { clearInProcessCachesForTests, runShrink } from "../../packages/core/src/shrink.js";

const execFileAsync = promisify(execFile);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Leftover temp dir is not a test failure (Windows EPERM after git runs).
    }
  }
  clearInProcessCachesForTests();
});

function makeDir(): string {
  const dir = join(tmpdir(), `patchdiet-p02-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function initGitRepo(dir: string): Promise<void> {
  await git(["init", "-b", "main"], dir);
  // Pin the repo config so global core.autocrlf / core.filemode defaults on
  // Windows cannot silently rewrite content or hide mode changes.
  await git(["config", "core.autocrlf", "false"], dir);
  await git(["config", "core.fileMode", "false"], dir);
  await git(["config", "user.email", "patchdiet@example.com"], dir);
  await git(["config", "user.name", "PatchDiet"], dir);
}

async function writeAndCommit(
  dir: string,
  filePath: string,
  content: string | Buffer,
  message: string,
  mode?: "100755" | "100644"
): Promise<void> {
  const abs = join(dir, filePath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  await git(["add", "."], dir);
  if (mode) {
    await git(["update-index", "--chmod", mode === "100755" ? "+x" : "-x", filePath], dir);
  }
  await git(["commit", "-m", message], dir);
}

async function runShrinkIn(dir: string, requiredCommands: string[]) {
  const report = await runShrink({
    cwd: dir,
    baseRef: "main",
    headRef: "agent/bloated",
    requiredCommands,
    allowTestFileRemoval: false
  });
  const cleanupDiffPath = join(dir, ".patchdiet", "cleanup.diff");
  // cleanup.diff is written byte-faithfully in the diff's own encoding; tests
  // must compare bytes, never a utf8-decoded view of a latin1 patch.
  const cleanupDiffBytes = readFileSync(cleanupDiffPath);
  return {
    report,
    cleanupDiffPath,
    cleanupDiffBytes,
    cleanupDiff: cleanupDiffBytes.toString("utf8")
  };
}

/**
 * Applies `cleanup.diff` to a fresh worktree checked out at `baseRef` with
 * `git apply --index` and returns the resulting tree SHA (`git write-tree`).
 */
async function treeAfterApplyOnBase(repoDir: string, cleanupDiffPath: string): Promise<string> {
  const worktree = join(repoDir, "p02-apply-base");
  await git(["worktree", "add", "--detach", worktree, "main"], repoDir);
  try {
    await execFileAsync("git", ["apply", "--index", cleanupDiffPath], { cwd: worktree });
    return (await git(["write-tree"], worktree)).trim();
  } finally {
    await git(["worktree", "remove", worktree, "--force"], repoDir).catch(() => undefined);
  }
}

interface TreeEntry {
  mode: string;
  type: string;
  object: string;
  path: string;
}

async function lsTree(repoDir: string, treeSha: string, paths: string[]): Promise<Map<string, TreeEntry>> {
  const out = await git(["ls-tree", treeSha, ...paths], repoDir);
  const entries = new Map<string, TreeEntry>();
  for (const line of out.split("\n")) {
    const match = /^(\d+) (\w+) (\S+)\t(.+)$/.exec(line.trim());
    if (match?.[1] && match[2] && match[3] && match[4]) {
      entries.set(match[4], { mode: match[1], type: match[2], object: match[3], path: match[4] });
    }
  }
  return entries;
}

const PASS_ALL = 'node -e "process.exit(0)"';

/**
 * The discriminator oracle for new-file whole-file removal: a reverting patch
 * that leaves `src/unused.ts` behind as an EMPTY file must fail, while a patch
 * that truly deletes the file (or where the file is still fully present, e.g.
 * the baseline on HEAD) must pass.
 */
const UNUSED_FILE_REALLY_GONE_ORACLE =
  'node -e "const fs=require(\'fs\');if(fs.existsSync(\'src/unused.ts\')){if(fs.statSync(\'src/unused.ts\').size===0)process.exit(1)}"';

// ── P0-2 scenario A: new-file whole-file removal deletes the file for real ──

describe("P0-2 shrink patch fidelity (real git repos)", () => {
  it("removes a new text file whole so reverse apply truly deletes it (no empty-file leftover)", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const app = 1;\n", "base");
    await writeAndCommit(dir, "README.md", "# docs\n", "base docs");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "export const dead = true;\n", "add unused");
    await writeAndCommit(dir, "tests/kept.test.ts", "it('keeps', () => {});\n", "add test");
    await writeAndCommit(dir, "README.md", "# docs\n# more docs\n", "edit docs");

    const { report, cleanupDiff } = await runShrinkIn(dir, [UNUSED_FILE_REALLY_GONE_ORACLE]);

    expect(report.removals.map((item) => item.filePath)).toContain("src/unused.ts");
    expect(report.removals.map((item) => item.filePath)).toContain("README.md");
    expect(report.partial).toBe(false);

    // The kept patch must still carry the protected test file…
    expect(cleanupDiff).toContain("tests/kept.test.ts");
    // …and must not carry the removed files at all (whole-file removal).
    expect(cleanupDiff).not.toContain("unused.ts");
    expect(cleanupDiff).not.toContain("README.md");

    const tree = await treeAfterApplyOnBase(
      dir,
      join(dir, ".patchdiet", "cleanup.diff")
    );
    const headTree = (await git(["rev-parse", "agent/bloated^{tree}"], dir)).trim();
    expect(tree).not.toBe(headTree);

    const appEntry = await lsTree(dir, tree, ["src/app.ts", "src/unused.ts", "tests/kept.test.ts"]);
    const baseBlob = (await git(["rev-parse", "main:src/app.ts"], dir)).trim();
    const testBlob = (await git(["rev-parse", "agent/bloated:tests/kept.test.ts"], dir)).trim();
    expect(appEntry.has("src/unused.ts")).toBe(false);
    expect(appEntry.get("src/app.ts")?.object).toBe(baseBlob);
    expect(appEntry.get("tests/kept.test.ts")?.object).toBe(testBlob);
  }, 120_000);

  // ── P0-2 scenario B: every kept section round-trips byte-exact and applies ──

  it("round-trips non-UTF8 text, binary/rename/delete/CRLF/no-newline/unicode-space paths byte-exact and applies on base", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    // Base: text files that HEAD will rename / delete / turn binary.
    await writeAndCommit(dir, "tests/old name.txt", "rename me\n", "base rename");
    await writeAndCommit(dir, "tests/deleted.txt", "delete me\n", "base delete");
    await writeAndCommit(dir, "tests/logo.bin", Buffer.from([0x00, 0x01, 0x02, 0x03]), "base bin");
    await writeAndCommit(dir, "tests/crlf.txt", "line one\r\nline two\r\n", "base crlf");
    await writeAndCommit(dir, "tests/nonl.txt", "x", "base nonl");
    await writeAndCommit(dir, "tests/app.ts", "export const a = 1;\n", "base ts");
    await git(["checkout", "-b", "agent/bloated"], dir);

    // Rename with a space + unicode in the target name (git quotes it).
    await git(["mv", "tests/old name.txt", "tests/改名 后.txt"], dir);
    await git(["commit", "-m", "rename"], dir);
    // Textual delete.
    rmSync(join(dir, "tests/deleted.txt"));
    await git(["add", "."], dir);
    await git(["commit", "-m", "delete"], dir);
    // Binary modify and binary add (getDiff must carry --binary payloads).
    writeFileSync(join(dir, "tests/logo.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]));
    // Deliberately NO NUL byte: git treats this as a TEXT diff, and the raw
    // 0x89 lead byte makes the stream non-UTF-8 — exercising the latin1
    // byte-faithful fallback, not the GIT-binary-patch path.
    writeFileSync(join(dir, "tests/asset.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a]));
    await git(["add", "."], dir);
    await git(["commit", "-m", "binary changes"], dir);
    // CRLF content change and no-newline content change.
    writeFileSync(join(dir, "tests/crlf.txt"), "line one\r\nline three\r\n");
    writeFileSync(join(dir, "tests/nonl.txt"), "xy");
    // New test file (default-protected).
    writeFileSync(join(dir, "tests/kept.test.ts"), "it('new test', () => {});\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "text changes"], dir);

    const { report, cleanupDiff, cleanupDiffBytes } = await runShrinkIn(dir, [PASS_ALL]);

    // The non-UTF-8 stream routes the whole diff to human review — nothing
    // is removed automatically.
    expect(report.removals).toHaveLength(0);
    expect(report.partial).toBe(false);
    expect(report.needsHumanReview.map((item) => item.filePath)).toContain("tests/asset.bin");

    // Byte-exact fidelity: the kept patch equals the raw git diff output
    // byte-for-byte (compared as Buffers, not utf8-decoded strings).
    const { diff: rawDiff, encoding } = await getDiff(dir, "main", "agent/bloated");
    expect(encoding).toBe("latin1");
    expect(cleanupDiffBytes.equals(Buffer.from(rawDiff, "latin1"))).toBe(true);
    // ASCII-level view still shows the real binary payload of the NUL-bearing file.
    expect(cleanupDiff).toContain("GIT binary patch");

    // Applying the kept patch on BASE with --index must reproduce the HEAD tree.
    const tree = await treeAfterApplyOnBase(dir, join(dir, ".patchdiet", "cleanup.diff"));
    const headTree = (await git(["rev-parse", "agent/bloated^{tree}"], dir)).trim();
    expect(tree).toBe(headTree);
  }, 120_000);

  // ── P0-2 scenario C: zero-hunk mode-only files stay in the cleanup patch ──

  it("routes mode-only and mode+content changes to human review and keeps both files whole", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "run.sh", "#!/bin/sh\necho mode-only\n", "base", "100644");
    await writeAndCommit(dir, "script.sh", "#!/bin/sh\necho v1\n", "base", "100644");
    await git(["checkout", "-b", "agent/bloated"], dir);

    // run.sh: mode change only (no content hunks).
    await git(["update-index", "--chmod", "+x", "run.sh"], dir);
    await git(["commit", "-m", "chmod run.sh"], dir);
    // script.sh: mode change AND content change in one commit.
    writeFileSync(join(dir, "script.sh"), "#!/bin/sh\necho v2\n");
    await git(["add", "."], dir);
    await git(["update-index", "--chmod", "+x", "script.sh"], dir);
    await git(["commit", "-m", "chmod + edit script.sh"], dir);

    const { report, cleanupDiff } = await runShrinkIn(dir, [PASS_ALL]);

    // Mode changes (incl. symlink/submodule bits) are never auto-removed —
    // both files stay whole and go to human review.
    expect(report.removals).toHaveLength(0);
    expect(report.needsHumanReview.map((item) => item.filePath).sort())
      .toEqual(["run.sh", "script.sh"]);
    expect(report.partial).toBe(false);

    expect(cleanupDiff).toContain("old mode 100644");
    expect(cleanupDiff).toContain("new mode 100755");
    expect(cleanupDiff).toContain("run.sh");
    expect(cleanupDiff).toContain("script.sh");

    // Keeping everything means applying the kept patch on BASE reproduces HEAD.
    const tree = await treeAfterApplyOnBase(dir, join(dir, ".patchdiet", "cleanup.diff"));
    const headTree = (await git(["rev-parse", "agent/bloated^{tree}"], dir)).trim();
    expect(tree).toBe(headTree);

    const entries = await lsTree(dir, tree, ["run.sh", "script.sh"]);
    const headRunSh = (await git(["rev-parse", "agent/bloated:run.sh"], dir)).trim();
    const headScript = (await git(["rev-parse", "agent/bloated:script.sh"], dir)).trim();
    expect(entries.get("run.sh")).toMatchObject({ mode: "100755", object: headRunSh });
    expect(entries.get("script.sh")).toMatchObject({ mode: "100755", object: headScript });
  }, 120_000);

  it("keeps new symlink (120000) and gitlink (160000) entries for human review and applies on base", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    // Index-level fixtures need no admin symlink rights on Windows: the
    // entries are staged straight into the index with --cacheinfo.
    await git(["config", "core.symlinks", "false"], dir);
    await writeAndCommit(dir, "tests/app.ts", "export const a = 1;\n", "base");
    await git(["checkout", "-b", "agent/bloated"], dir);

    const appBlob = (await git(["rev-parse", "HEAD:tests/app.ts"], dir)).trim();
    const headCommit = (await git(["rev-parse", "HEAD"], dir)).trim();
    await git(["update-index", "--add", "--cacheinfo", `120000,${appBlob},tests/link`], dir);
    await git(["update-index", "--add", "--cacheinfo", `160000,${headCommit},tests/gitsub`], dir);
    await git(["commit", "-m", "add symlink and gitlink entries"], dir);

    const { report, cleanupDiff } = await runShrinkIn(dir, [PASS_ALL]);

    // Special identity entries must never be auto-removed: a reversed text
    // patch does not restore a symlink/submodule, and they carry no old/new
    // mode headers to trigger on.
    expect(report.removals).toHaveLength(0);
    expect(report.needsHumanReview.map((item) => item.filePath).sort())
      .toEqual(["tests/gitsub", "tests/link"]);
    expect(report.partial).toBe(false);

    expect(cleanupDiff).toContain("new file mode 120000");
    expect(cleanupDiff).toContain("new file mode 160000");

    const tree = await treeAfterApplyOnBase(dir, join(dir, ".patchdiet", "cleanup.diff"));
    const headTree = (await git(["rev-parse", "agent/bloated^{tree}"], dir)).trim();
    expect(tree).toBe(headTree);
  }, 120_000);

  it("does not attempt per-hunk removal for new files when the whole-file candidate fails", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const app = 1;\n", "base");
    await git(["checkout", "-b", "agent/bloated"], dir);
    // A large new file (multiple hunks via a marker line) — the whole-file
    // candidate is blocked by the failing oracle, so no hunk may be removed.
    const lines: string[] = [];
    for (let i = 1; i <= 40; i += 1) {
      lines.push(`export const value${i} = ${i};`);
      if (i === 20) {
        lines.push("// marker: real content the oracle depends on");
      }
    }
    await writeAndCommit(dir, "src/newbig.ts", `${lines.join("\n")}\n`, "add big new file");

    const oracleFailsWhenFileMissing =
      'node -e "const fs=require(\'fs\');if(!fs.existsSync(\'src/newbig.ts\'))process.exit(1)"';
    const { report, cleanupDiff } = await runShrinkIn(dir, [oracleFailsWhenFileMissing]);

    expect(report.removals).toHaveLength(0);
    expect(cleanupDiff).toContain("src/newbig.ts");
    expect(cleanupDiff).toContain("new file mode");
    // All hunks survive.
    for (let i = 1; i <= 40; i += 1) {
      expect(cleanupDiff).toContain(`export const value${i} = ${i};`);
    }
  }, 120_000);
});
