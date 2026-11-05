import { execFile } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { runShrink } from "../../packages/core/src/shrink.js";

const execFileAsync = promisify(execFile);

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function makeDir(): string {
  const dir = join(tmpdir(), `p03c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  await git(["config", "core.autocrlf", "false"], dir);
  await git(["config", "core.fileMode", "false"], dir);
  await git(["config", "user.email", "patchdiet@example.com"], dir);
  await git(["config", "user.name", "PatchDiet"], dir);
}

async function writeAndCommit(dir: string, filePath: string, content: string, message: string): Promise<void> {
  const abs = join(dir, filePath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  await git(["add", "."], dir);
  await git(["commit", "-m", message], dir);
}

const PASS_ALL = 'node -e "process.exit(0)"';

async function runShrinkIn(
  dir: string,
  opts: Record<string, unknown> = {},
  requiredCommands: string[] = [PASS_ALL]
) {
  return runShrink({
    cwd: dir,
    baseRef: "main",
    headRef: "agent/bloated",
    requiredCommands,
    ...opts
  });
}

const EXTERNAL_SENTINEL = "EXTERNAL-SENTINEL\n" + "x".repeat(512) + "\n";

// ── F1: .patchdiet leaf writes must never follow links out of the repo ──

describe("P0-3 corrections: safe leaf output writes", () => {
  it("never truncates an external file hardlinked to .patchdiet/report.md", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");

    const external = join(makeDir(), "outside-report.md");
    writeFileSync(external, EXTERNAL_SENTINEL, "utf8");
    mkdirSync(join(dir, ".patchdiet"), { recursive: true });
    // linkSync(existing, new): .patchdiet/report.md becomes a second name for
    // the EXTERNAL file's inode.
    linkSync(external, join(dir, ".patchdiet", "report.md"));

    const report = await runShrinkIn(dir);
    expect(report.mode).toBe("verified");

    // The external file must keep its original bytes: the report write may
    // replace the repository-side path, never write through the link.
    expect(readFileSync(external, "utf8")).toBe(EXTERNAL_SENTINEL);
  });

  it("never truncates an external file hardlinked to .patchdiet/cleanup.diff", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");

    const external = join(makeDir(), "outside-cleanup.diff");
    writeFileSync(external, EXTERNAL_SENTINEL, "utf8");
    mkdirSync(join(dir, ".patchdiet"), { recursive: true });
    linkSync(external, join(dir, ".patchdiet", "cleanup.diff"));

    const report = await runShrinkIn(dir);
    expect(report.mode).toBe("verified");
    expect(readFileSync(external, "utf8")).toBe(EXTERNAL_SENTINEL);
  });

  it("refuses to write through a dangling symlink .patchdiet/report.md and creates no external target", async (ctx) => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");

    const danglingTarget = join(makeDir(), "never-created.md");
    mkdirSync(join(dir, ".patchdiet"), { recursive: true });
    try {
      await fsp.symlink(danglingTarget, join(dir, ".patchdiet", "report.md"), "file");
    } catch (error) {
      const message = error instanceof Error ? `${error.message}` : String(error);
      if (/EPERM|denied|拒绝/.test(message)) {
        ctx.skip(true, `environment denies symlink creation: ${message.split("\n")[0]}`);
      }
      throw error;
    }

    // Dangling symlinks are invisible to existsSync; the run must still refuse.
    await expect(runShrinkIn(dir)).rejects.toThrow(/symlink|refus/i);
    expect(existsSync(danglingTarget)).toBe(false);
  });
});

// ── F2: the whole scratch lifecycle must be covered by cleanup ──

describe("P0-3 corrections: scratch lifecycle", () => {
  it("removes its eval scratch when a dryRun baseline fails, leaving no .patchdiet at all", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");

    await expect(runShrinkIn(dir, { dryRun: true }, ['node -e "process.exit(1)"'])).rejects.toThrow(
      /required command failed/
    );
    expect(existsSync(join(dir, ".patchdiet"))).toBe(false);
  });

  it("removes its eval scratch when a non-dryRun baseline fails", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");

    await expect(runShrinkIn(dir, {}, ['node -e "process.exit(1)"'])).rejects.toThrow(
      /required command failed/
    );
    // No run-owned UUID scratch may survive the failure.
    const evalDir = join(dir, ".patchdiet", "eval");
    if (existsSync(evalDir)) {
      expect(await fsp.readdir(evalDir)).toEqual([]);
    }
    expect(existsSync(join(dir, ".patchdiet", "report.md"))).toBe(false);
  });

  it("keeps content a concurrent writer placed in a dry-run-created shared .patchdiet", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");

    const run = runShrinkIn(dir, { dryRun: true });
    // Simulate a concurrent writer: as soon as the run creates .patchdiet,
    // drop a user file into the shared directory.
    const sentinel = join(dir, ".patchdiet", "concurrent-user.txt");
    const deadline = Date.now() + 15_000;
    for (;;) {
      if (existsSync(join(dir, ".patchdiet"))) {
        writeFileSync(sentinel, "mine", "utf8");
        break;
      }
      if (Date.now() > deadline) {
        throw new Error("fixture: .patchdiet was never created by the dry run");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await run;

    // The shared directory was created by this run, but cleanup may only
    // remove what it owns: rmdir of a non-empty directory must fail silently,
    // never recursively destroy concurrent content.
    expect(readFileSync(sentinel, "utf8")).toBe("mine");
  });
});

// ── F3: --apply precondition must reject TRACKED dirt anywhere ──

describe("P0-3 corrections: apply preconditions", () => {
  it("rejects --apply when a TRACKED file under .patchdiet is dirty", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    // The user's tracked file under .patchdiet is committed on MAIN so it
    // exists in both branches' history.
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await writeAndCommit(dir, ".patchdiet/user-source.js", "user source\n", "track user file");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");
    await git(["checkout", "main"], dir);
    writeFileSync(join(dir, ".patchdiet", "user-source.js"), "user source\nmodified\n", "utf8");

    await expect(runShrinkIn(dir, { apply: true })).rejects.toThrow(/clean|dirty/i);
    expect(readFileSync(join(dir, ".patchdiet", "user-source.js"), "utf8")).toBe(
      "user source\nmodified\n"
    );
  });

  it("rejects --apply for a dirty user path that git quotes (robust -z status parsing)", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    // Unicode + space: git quotes this path in porcelain v1 output.
    const weird = "src/weird 名字 file.ts";
    await writeAndCommit(dir, weird, "v1\n", "weird name base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");
    await git(["checkout", "main"], dir);
    writeFileSync(join(dir, weird), "v1\ndirty\n", "utf8");

    await expect(runShrinkIn(dir, { apply: true })).rejects.toThrow(/clean|dirty/i);
  });

  it("rejects --apply when UNTRACKED user content exists under .patchdiet (no blanket prefix exemption)", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");
    await git(["checkout", "main"], dir);
    // A user file placed under .patchdiet must block --apply even though it
    // is untracked and inside our output directory.
    const userNote = join(dir, ".patchdiet", "user-note.txt");
    mkdirSync(dirname(userNote), { recursive: true });
    writeFileSync(userNote, "mine\n", "utf8");

    await expect(runShrinkIn(dir, { apply: true })).rejects.toThrow(/clean|dirty/i);
    expect(readFileSync(userNote, "utf8")).toBe("mine\n");
  });
});

// ── F4: baseline commands must not rewrite tracked committed source ──

describe("P0-3 corrections: baseline source guard", () => {
  it("fails closed when the baseline oracle rewrites a tracked HEAD file and still exits 0", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");

    const mutator =
      "node -e \"const fs=require('fs');" +
      "fs.appendFileSync('src/app.ts','mutated\\n');process.exit(0)\"";

    await expect(runShrinkIn(dir, {}, [mutator])).rejects.toThrow(
      /altered tracked (committed )?source/i
    );
    // The live checkout's committed file is untouched (the mutation happened
    // in the run-owned baseline worktree).
    expect(readFileSync(join(dir, "src/app.ts"), "utf8")).toBe("export const a = 1;\n");
  });
});

// ── F6: no repository-metadata mutation before refs are pinned ──

describe("P0-3 corrections: prune ordering", () => {
  it("does not run `git worktree prune` when a ref fails to resolve", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "v1\n", "base");
    // Stale registration: the directory is gone but git metadata remains.
    const staleDir = join(dir, ".patchdiet", "eval", "stale-user");
    mkdirSync(dirname(staleDir), { recursive: true });
    await git(["worktree", "add", "--detach", staleDir, "main"], dir);
    await fsp.rm(staleDir, { recursive: true, force: true });

    await expect(
      runShrink({
        cwd: dir,
        baseRef: "nope/no-such-ref",
        headRef: "main",
        requiredCommands: [PASS_ALL]
      })
    ).rejects.toThrow(/could not (be )?resolve|resolve.*ref/i);

    // The stale registration must still be present: an invalid ref must never
    // mutate repository metadata (prune runs only after pinning succeeds).
    const list = await git(["worktree", "list", "--porcelain"], dir);
    expect(list).toContain(staleDir.replaceAll("\\", "/"));
  });
});

// ── F8: the branch check must compare the DELIVERED HEAD^{tree} ──

describe("P0-3 corrections: cleanup branch delivered tree", () => {
  it("fails closed and cleans up when a commit hook amends the commit and restores the index", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await writeAndCommit(dir, "value.txt", "value\n", "add value");
    await git(["checkout", "-b", "agent/bloated"], dir);
    // A kept change so the artifact has an actual staged diff to commit.
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n// head edit\n", "edit protected");

    // Post-commit hook: capture the artifact tree from the freshly committed
    // index, mutate a tracked file, amend the commit with hooks suppressed
    // (bounded, no recursive hook re-entry) so the DELIVERED HEAD^{tree}
    // differs from the artifact, then restore index AND working tree to the
    // artifact tree — the exact spoof an index-only check falls for.
    const hookPath = join(dir, ".git", "hooks", "post-commit");
    writeFileSync(
      hookPath,
      [
        "#!/bin/sh",
        "T=$(git write-tree)",
        "echo hacked >> value.txt",
        "git add value.txt",
        "git -c core.hooksPath=/dev/null commit --amend --no-edit >/dev/null 2>&1",
        "git read-tree \"$T\"",
        "git checkout-index -f -a",
        "exit 0"
      ].join("\n"),
      "utf8"
    );
    chmodSync(hookPath, 0o755);

    const refsBefore = (await git(["for-each-ref", "--format=%(refname)"], dir)).trim();
    await expect(runShrinkIn(dir, { createBranch: true })).rejects.toThrow(
      /delivered tree|does not match/i
    );
    const refsAfter = (await git(["for-each-ref", "--format=%(refname)"], dir)).trim();
    expect(refsAfter).toBe(refsBefore);
    const list = await git(["worktree", "list", "--porcelain"], dir);
    expect(list).not.toContain("patchdiet/cleanup");
  });
});

// ── F7: rollback failure must be reported truthfully ──

describe("P0-3 corrections: truthful rollback", () => {
  it("reports rollback failure when the reverse application cannot restore the tree", async () => {
    const { rollbackAppliedCleanupPatch } = await import("../../packages/core/src/shrink.js");
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "v1\n", "base");

    const initialTree = (await git(["write-tree"], dir)).trim();
    // A patch file that does not exist cannot be reverse-applied.
    const result = await rollbackAppliedCleanupPatch(dir, join(dir, "missing.patch"), initialTree);
    expect(result.rolledBack).toBe(false);
    expect(result.detail).toBeTruthy();
  });

  it("reports success only after verifying the index tree and tracked status are restored", async () => {
    const { rollbackAppliedCleanupPatch } = await import("../../packages/core/src/shrink.js");
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    // The fixture patch lives OUTSIDE the fixture repository so the rollback
    // verifier does not count it as a leftover user path.
    const patchPath = join(makeDir(), "apply.patch");
    writeFileSync(
      patchPath,
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1 +1,2 @@",
        " export const a = 1;",
        "+export const b = 2;",
        ""
      ].join("\n"),
      "utf8"
    );
    const initialTree = (await git(["write-tree"], dir)).trim();
    await execFileAsync("git", ["apply", "--index", patchPath], { cwd: dir });
    const appliedTree = (await git(["write-tree"], dir)).trim();
    expect(appliedTree).not.toBe(initialTree);

    const result = await rollbackAppliedCleanupPatch(dir, patchPath, initialTree);
    expect(result.rolledBack).toBe(true);
    // The index tree and the tracked file must both be restored to their
    // original state (HEAD never moved — rollback is index/worktree only).
    expect((await git(["write-tree"], dir)).trim()).toBe(initialTree);
    expect(readFileSync(join(dir, "src/app.ts"), "utf8")).toBe("export const a = 1;\n");
  });
});

// ── F9: the CLI supplemental reports must use the same safe writer ──

describe("P0-3 corrections: CLI supplemental report writes", () => {
  it("never truncates an external file hardlinked to .patchdiet/report.html written by the CLI", async () => {
    const cliEntry = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");

    // First CLI run creates .patchdiet/report.html.
    await execFileAsync(
      "node",
      [cliEntry, "shrink", "--base", "main", "--head", "agent/bloated", "--test", PASS_ALL],
      { cwd: dir }
    );
    expect(existsSync(join(dir, ".patchdiet", "report.html"))).toBe(true);

    // Replace the fixture-owned report.html with a hardlink to the external
    // file before the second run.
    unlinkSync(join(dir, ".patchdiet", "report.html"));
    const external = join(makeDir(), "outside-report.html");
    writeFileSync(external, EXTERNAL_SENTINEL, "utf8");
    linkSync(external, join(dir, ".patchdiet", "report.html"));

    await execFileAsync(
      "node",
      [cliEntry, "shrink", "--base", "main", "--head", "agent/bloated", "--test", PASS_ALL],
      { cwd: dir }
    );

    expect(readFileSync(external, "utf8")).toBe(EXTERNAL_SENTINEL);
  });
});
