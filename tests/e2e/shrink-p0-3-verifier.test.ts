import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { clearInProcessCachesForTests, runShrink } from "../../packages/core/src/shrink.js";

const execFileAsync = promisify(execFile);

const tempDirs: string[] = [];

// NOTE (P0-3 contract): baseline and final stages run the oracle in different
// worktrees, so an oracle whose retry marker lives in the current directory is
// no longer deterministic across stages — a retry-rescued pass in the FINAL
// artifact stage is INCONCLUSIVE by contract. Tests that pin baseline retry
// semantics therefore use an absolute, shared marker so a retried pass holds
// for every later stage.

// Windows Node 24 rmSync does not actually retry transient permission_denied
// handles; fs/promises rm does. Single bounded await — a persistent failure
// THROWS (no swallowing loop): a leaked fixture must fail the suite loudly.
afterEach(async () => {
  const fsp = await import("node:fs/promises");
  for (const dir of tempDirs.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  clearInProcessCachesForTests();
});

function makeDir(): string {
  const dir = join(tmpdir(), `p03-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/** Forward-slash, single-quoted path safe to embed inside a double-quoted `node -e`. */
function shellSafePath(p: string): string {
  return p.replaceAll("\\", "/");
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

/**
 * Standard bloated-PR fixture: src/unused.ts is auto-removable while the
 * committed tests/protected.js is a real required check that survives every
 * removal, so the final artifact always keeps a non-empty staged diff.
 */
async function initBloatedRepo(dir: string): Promise<void> {
  await initGitRepo(dir);
  await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");
  await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n", "base check");
  await git(["checkout", "-b", "agent/bloated"], dir);
  await writeAndCommit(dir, "src/unused.ts", "dead\n", "add unused");
}

function protectedCheckCommand(): string {
  return "node tests/protected.js";
}

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

async function worktreeListContains(dir: string, fragment: string): Promise<boolean> {
  const out = await git(["worktree", "list", "--porcelain"], dir);
  return out.includes(fragment);
}

/**
 * Counter oracle: passes every time, records invocation count at an absolute
 * path (single-quoted, forward slashes so it survives the double-quoted
 * `node -e` shell layer on Windows).
 */
function countingOracle(counterPath: string, sleepMsOnCall = 0): string {
  const p = shellSafePath(counterPath);
  return [
    "node -e \"const fs=require('fs');",
    `const p='${p}';`,
    "let n=0;try{n=JSON.parse(fs.readFileSync(p,'utf8')).n}catch{};",
    "n++;fs.writeFileSync(p,JSON.stringify({n}));",
    sleepMsOnCall > 0 ? `if(n===2){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${sleepMsOnCall})}` : "",
    "process.exit(0)\""
  ].join("");
}

// ── Preconditions: pinning, merge-base, refusals (before any mutation) ──

describe("P0-3 pinned verification pipeline", () => {
  it("throws on an unresolvable base ref before creating .patchdiet and never executes the oracle", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "export const a = 1;\n", "base");

    const counterPath = join(tmpdir(), `p03-c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(counterPath);

    await expect(
      runShrink({
        cwd: dir,
        baseRef: "nope/no-such-ref",
        headRef: "main",
        requiredCommands: [countingOracle(counterPath)]
      })
    ).rejects.toThrow(/could not (be )?resolve|resolve.*ref/i);

    expect(existsSync(join(dir, ".patchdiet"))).toBe(false);
    // The invalid ref must be detected before any oracle execution.
    expect(existsSync(counterPath)).toBe(false);
  });

  it("fails closed when BASE is not the merge-base (diverged refs)", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "v1\n", "A");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/agent.ts", "agent\n", "D");
    await git(["checkout", "main"], dir);
    await writeAndCommit(dir, "src/main-only.ts", "main\n", "C2");

    await expect(runShrinkIn(dir)).rejects.toThrow(/merge-base|rebase/i);
    expect(existsSync(join(dir, ".patchdiet"))).toBe(false);
  });

  it("runs the baseline in a clean pinned HEAD worktree: a broken committed HEAD cannot be rescued by dirty user files", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "flag.txt", "ok\n", "base");
    await git(["checkout", "-b", "agent/bloated"], dir);
    // Broken committed HEAD.
    await writeAndCommit(dir, "flag.txt", "broken\n", "break head");
    // Dirty "rescue" in the live working tree — must be ignored for attestation.
    writeFileSync(join(dir, "flag.txt"), "ok\n", "utf8");

    const oracle =
      'node -e "const fs=require(\'fs\');if(fs.readFileSync(\'flag.txt\',\'utf8\').trim()!==\'ok\')process.exit(1)"';
    await expect(runShrinkIn(dir, {}, [oracle])).rejects.toThrow(/required command failed/);
    expect(existsSync(join(dir, ".patchdiet", "report.md"))).toBe(false);
    // User's dirty file is untouched.
    expect(readFileSync(join(dir, "flag.txt"), "utf8")).toBe("ok\n");
  });

  it("attests the pinned HEAD SHA even when the oracle moves the agent ref mid-run", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "v1\n", "base");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/feature.ts", "feature\n", "feature");
    const originalHeadSha = (await git(["rev-parse", "agent/bloated"], dir)).trim();
    const baseSha = (await git(["rev-parse", "main"], dir)).trim();

    // update-ref works even though the branch is checked out in the live tree.
    const refMover = [
      "node -e \"require('child_process').execFileSync('git',",
      "['update-ref','refs/heads/agent/bloated','" + baseSha + "'],{stdio:'ignore'})\""
    ].join("");
    const report = await runShrinkIn(dir, {}, [refMover]);

    expect(report.headCommitSha).toBe(originalHeadSha);
    expect(report.verification?.baseline.headCommitSha).toBe(originalHeadSha);
  });

  it("cleans all run-owned worktrees when the baseline fails, leaving user work alone", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "v1\n", "base");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "src/feature.ts", "feature\n", "feature");

    await expect(runShrinkIn(dir, {}, ['node -e "process.exit(1)"'])).rejects.toThrow(
      /required command failed/
    );
    expect(await worktreeListContains(dir, ".patchdiet/eval")).toBe(false);
    expect(existsSync(join(dir, ".patchdiet", "report.md"))).toBe(false);
  });

  it("rejects with an explicit budget error when the deadline is exhausted before the baseline", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);

    await expect(runShrinkIn(dir, { maxRuntimeMs: 1 })).rejects.toThrow(/budget/i);
    expect(await worktreeListContains(dir, ".patchdiet/eval")).toBe(false);
  });

  // ── Combined / final verification semantics ──

  it("downgrades all removals when the budget is exhausted after candidates pass (combined verification is mandatory)", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);
    const counterPath = join(tmpdir(), `p03-c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(counterPath);

    // Leave enough time for baseline setup even on a loaded Windows runner;
    // the second invocation deliberately outlasts the remaining budget.
    const report = await runShrinkIn(dir, { maxRuntimeMs: 15000 }, [countingOracle(counterPath, 30000)]);

    expect(report.removals).toHaveLength(0);
    expect(report.partial).toBe(true);
    expect(report.mode).toBe("unverified");
    expect(report.verification?.final.status).toBe("not-run");
    expect(report.testCommand.status).toBe("not-run");
  }, 60000);

  it("downgrades all removals when the final BASE artifact fails an oracle that only passes on HEAD", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);
    const headSha = (await git(["rev-parse", "agent/bloated"], dir)).trim();

    const headOnlyOracle =
      "node -e \"const cp=require('child_process');" +
      "const h=cp.execSync('git rev-parse HEAD').toString().trim();" +
      "if(h!=='" + headSha + "')process.exit(1)\"";
    const report = await runShrinkIn(dir, {}, [headOnlyOracle]);

    expect(report.removals).toHaveLength(0);
    expect(report.needsHumanReview.map((item) => item.filePath)).toContain("src/unused.ts");
    expect(report.partial).toBe(true);
    expect(report.mode).toBe("unverified");
    expect(report.verification?.final.status).toBe("failed");
    expect(report.testCommand.status).toBe("failed");
    // The diagnostic report must visibly expose the failure, never claim all checks passed.
    const markdown = readFileSync(join(dir, ".patchdiet", "report.md"), "utf8");
    expect(markdown).toContain("unverified");
    expect(markdown).toContain("Final artifact");
  });

  it("fails closed when required commands alter tracked source in the BASE artifact worktree", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "tests/app.ts", "export const a = 1;\n", "base");
    await git(["checkout", "-b", "agent/bloated"], dir);
    await writeAndCommit(dir, "tests/unused.ts", "dead\n", "add unused test");
    const baseSha = (await git(["rev-parse", "main"], dir)).trim();

    // The mutator only acts in the BASE artifact worktree (HEAD === base), so
    // the baseline on pinned HEAD legitimately passes and the failure is the
    // final artifact's tracked-source mutation — exactly what must not attest.
    const baseOnlyMutator =
      "node -e \"const cp=require('child_process');const fs=require('fs');" +
      "const h=cp.execSync('git rev-parse HEAD').toString().trim();" +
      "if(h==='" + baseSha + "'){fs.appendFileSync('tests/app.ts','x\\n')}\"";
    const report = await runShrinkIn(dir, { allowTestFileRemoval: true }, [baseOnlyMutator]);

    expect(report.removals).toHaveLength(0);
    expect(report.partial).toBe(true);
    expect(report.mode).toBe("unverified");
    expect(report.verification?.final.status).toBe("failed");
  });

  it("verifies zero-removal runs against the exact BASE artifact with the full oracle", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "v1\n", "base");
    await git(["checkout", "-b", "agent/bloated"], dir);
    // Only a protected test file changes: zero removals are possible.
    await writeAndCommit(dir, "tests/kept.test.ts", "it('x', () => {});\n", "add test");

    const counterPath = join(tmpdir(), `p03-c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(counterPath);

    const report = await runShrinkIn(dir, {}, [countingOracle(counterPath)]);

    const invocations = JSON.parse(readFileSync(counterPath, "utf8")).n as number;
    // Baseline + final artifact oracle: a zero-removal run still proves the
    // exact BASE artifact with the full required commands.
    expect(invocations).toBeGreaterThanOrEqual(2);
    expect(report.mode).toBe("verified");
    expect(report.removals).toHaveLength(0);
    expect(report.verification?.final.status).toBe("passed");
    expect(report.verification?.final.treesMatch).toBe(true);
    expect(report.verification?.final.expectedTreeSha)
      .toBe(report.verification?.final.artifactTreeSha);
  });

  it("records matching expected/artifact tree SHAs on a verified run with removals", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);

    const report = await runShrinkIn(dir);

    expect(report.mode).toBe("verified");
    expect(report.removals.map((item) => item.filePath)).toContain("src/unused.ts");
    const final = report.verification?.final;
    expect(final?.status).toBe("passed");
    expect(final?.treesMatch).toBe(true);
    expect(final?.expectedTreeSha).toBe(final?.artifactTreeSha);
    expect(final?.baseCommitSha).toBe((await git(["rev-parse", "main"], dir)).trim());
    expect(final?.headCommitSha).toBe((await git(["rev-parse", "agent/bloated"], dir)).trim());
  });

  it("never attests a verified result from an oscillating final oracle (first FAIL then retry PASS)", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);
    const counterPath = join(tmpdir(), `p03-c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(counterPath);

    // The final stage alone fails then passes. Stage identity is more stable
    // than a global call number now that every configured attempt is observed.
    const flakyFinalOracle = [
      "node -e \"const fs=require('fs');",
      `const p='${shellSafePath(counterPath)}';`,
      "if(process.cwd().includes('final-artifact')){",
      "let n=0;try{n=JSON.parse(fs.readFileSync(p,'utf8')).n}catch{};",
      "n++;fs.writeFileSync(p,JSON.stringify({n}));",
      "if(n===1){process.exit(1)}}",
      "process.exit(0)\""
    ].join("");

    const report = await runShrinkIn(
      dir,
      { createBranch: true, retryFlakyTests: 1 },
      [flakyFinalOracle]
    );

    expect(report.mode).toBe("unverified");
    expect(report.partial).toBe(true);
    expect(report.verification?.final.status).toBe("failed");
    expect(report.verification?.final.detail).toMatch(/inconclusive|oscillat|retry/i);
    expect(report.cleanupBranch).toBeUndefined();
    expect(await worktreeListContains(dir, "patchdiet/cleanup")).toBe(false);
  });

  // ── Delivery: --apply and --create-branch ──

  it("applies the verified cleanup bytes to a clean live BASE checkout and proves the tree", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);
    const baseSha = (await git(["rev-parse", "main"], dir)).trim();

    const report = await runShrinkIn(dir, {}, [protectedCheckCommand()]);
    expect(report.mode).toBe("verified");

    // Delivery requires the caller to be on a clean pinned BASE checkout; the
    // engine must never switch the user's checkout itself.
    await git(["checkout", "main"], dir);
    const applied = await runShrinkIn(dir, { apply: true }, [protectedCheckCommand()]);
    expect(applied.mode).toBe("verified");

    const liveHead = (await git(["rev-parse", "HEAD"], dir)).trim();
    expect(liveHead).toBe(baseSha);
    const liveTree = (await git(["write-tree"], dir)).trim();
    expect(liveTree).toBe(applied.verification?.final.artifactTreeSha);
    expect(existsSync(join(dir, "src/unused.ts"))).toBe(false);
  });

  it("rejects --apply on a dirty live tree and preserves user changes", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);
    // User dirt: modified tracked file + untracked file, neither ours.
    writeFileSync(join(dir, "src/app.ts"), "export const a = 1;\nuser edit\n", "utf8");
    writeFileSync(join(dir, "user-notes.txt"), "mine\n", "utf8");

    await expect(runShrinkIn(dir, { apply: true }, [protectedCheckCommand()])).rejects.toThrow(
      /dirty|clean/i
    );
    expect(readFileSync(join(dir, "src/app.ts"), "utf8")).toBe("export const a = 1;\nuser edit\n");
    expect(readFileSync(join(dir, "user-notes.txt"), "utf8")).toBe("mine\n");
    expect(existsSync(join(dir, ".patchdiet"))).toBe(false);
  });

  it("rejects --apply when live HEAD is not the pinned BASE, before writing outputs", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);
    // Live checkout stays on agent/bloated — apply must be refused up front.
    await expect(runShrinkIn(dir, { apply: true }, [protectedCheckCommand()])).rejects.toThrow(
      /HEAD.*BASE|BASE.*HEAD|pinned/i
    );
    expect(existsSync(join(dir, ".patchdiet", "report.md"))).toBe(false);
  });

  it("lets --apply proceed on a clean BASE checkout even when .patchdiet is not gitignored", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);
    await git(["checkout", "main"], dir);

    // First run produces .patchdiet artifacts that are NOT ignored.
    await runShrinkIn(dir, {}, [protectedCheckCommand()]);
    expect(existsSync(join(dir, ".patchdiet", "report.md"))).toBe(true);

    // Second run with --apply: only our own .patchdiet output may be "dirty".
    const report = await runShrinkIn(dir, { apply: true }, [protectedCheckCommand()]);
    expect(report.mode).toBe("verified");
  });

  it("surfaces commit hook failures from --create-branch and removes the branch and worktree it just created", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);
    // A kept (protected) change so the artifact has an actual staged diff to
    // commit — otherwise no commit is made and no hook can fire.
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n// head edit\n", "edit protected");

    // Real shared .git/hooks/pre-commit hook, independently proven to exit 1.
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\nexit 1\n", "utf8");
    chmodSync(hookPath, 0o755);
    const hookProof = await execFileAsync("sh", [hookPath], { cwd: dir }).then(
      () => false,
      () => true
    );
    expect(hookProof).toBe(true);

    const refsBefore = (await git(["for-each-ref", "--format=%(refname)"], dir)).trim();

    await expect(runShrinkIn(dir, { createBranch: true }, [protectedCheckCommand()])).rejects.toThrow();

    const refsAfter = (await git(["for-each-ref", "--format=%(refname)"], dir)).trim();
    expect(refsAfter).toBe(refsBefore);
    expect(await worktreeListContains(dir, "patchdiet")).toBe(false);
  });

  it("creates the cleanup branch from the pinned BASE after verified final artifact", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);
    // A kept (protected) change so the branch commit carries the artifact.
    await writeAndCommit(dir, "tests/protected.js", "process.exit(0);\n// head edit\n", "edit protected");
    const baseSha = (await git(["rev-parse", "main"], dir)).trim();

    const report = await runShrinkIn(dir, { createBranch: true }, [protectedCheckCommand()]);
    expect(report.cleanupBranch).toBeTruthy();
    const branchSha = (await git(["rev-parse", report.cleanupBranch!], dir)).trim();
    // Branch must point at a NEW commit on top of the pinned BASE...
    expect(branchSha).not.toBe(baseSha);
    const branchParent = (await git(["rev-parse", `${report.cleanupBranch}^`], dir)).trim();
    expect(branchParent).toBe(baseSha);
    // ...whose tree equals the verified artifact tree.
    const branchTree = (await git(["rev-parse", `${report.cleanupBranch}^{tree}`], dir)).trim();
    expect(branchTree).toBe(report.verification?.final.artifactTreeSha);
  });

  // ── Run-owned hygiene ──

  it("cleans only its own run directory, preserving sibling eval runs", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);
    const sentinel = join(dir, ".patchdiet", "eval", "unrelated-run", "sentinel.txt");
    mkdirSync(dirname(sentinel), { recursive: true });
    writeFileSync(sentinel, "keep", "utf8");

    await runShrinkIn(dir);

    expect(readFileSync(sentinel, "utf8")).toBe("keep");
  });

  it("never prunes a user worktree just because its path looks like a PatchDiet eval path", async () => {
    const dir = makeDir();
    await initGitRepo(dir);
    await writeAndCommit(dir, "src/app.ts", "v1\n", "base");
    // A USER worktree whose path merely looks like ours; mtime is long past
    // any staleness heuristic. Ownership by path pattern must not delete it.
    const userWorktree = join(dir, ".patchdiet", "eval", "my-experiment");
    mkdirSync(dirname(userWorktree), { recursive: true });
    await git(["worktree", "add", "--detach", userWorktree, "main"], dir);

    const { pruneStaleEvalWorktrees } = await import("../../packages/core/src/shrink.js");
    await pruneStaleEvalWorktrees(dir);

    const list = await git(["worktree", "list", "--porcelain"], dir);
    expect(list).toContain(userWorktree.replaceAll("\\", "/"));
    expect(existsSync(join(userWorktree, "src", "app.ts"))).toBe(true);
  });

  it("refuses a junction/symlink .patchdiet/eval pointing outside the repo and preserves the external target", async (ctx) => {
    const dir = makeDir();
    await initBloatedRepo(dir);

    const external = makeDir();
    writeFileSync(join(external, "sentinel.txt"), "keep", "utf8");
    mkdirSync(join(dir, ".patchdiet"), { recursive: true });
    // mklink /J needs no admin rights; cmd.exe must be resolved by absolute
    // path because the test environment's PATH may not include System32.
    const cmd = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    // Probe reparse-point support with a clean EPERM signal first (cmd's GBK
    // "access denied" output is not reliably matchable).
    const fsp = await import("node:fs/promises");
    const probeLink = join(dir, ".patchdiet", "probe-link");
    try {
      await fsp.symlink(join(external, "probe"), probeLink, "junction");
      await fsp.rm(probeLink, { force: true });
    } catch (error) {
      // This sandboxed environment denies ALL reparse-point creation, so the
      // fixture cannot even be built here. Skip explicitly instead of
      // weakening the assertion; the reviewer environment creates junctions.
      ctx.skip(true, `environment denies reparse-point creation: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`);
    }
    try {
      await execFileAsync(cmd, ["/d", "/c", "mklink", "/J", join(dir, ".patchdiet", "eval"), external]);
    } catch (error) {
      // Some sandboxed environments deny ALL reparse-point creation (EPERM).
      // The fixture itself cannot be built there; skip explicitly instead of
      // weakening the assertion. The reviewer environment creates junctions.
      const message = error instanceof Error ? `${error.message}` : String(error);
      if (/EPERM|denied|拒绝/.test(message)) {
        ctx.skip(true, `environment denies reparse-point creation: ${message.split("\n")[0]}`);
      }
      throw error;
    }

    await expect(runShrinkIn(dir)).rejects.toThrow(/junction|symlink/i);
    expect(readFileSync(join(external, "sentinel.txt"), "utf8")).toBe("keep");
  });

  it("dry-run still fully verifies (mode verified) but never overwrites pre-existing artifact bytes", async () => {
    const dir = makeDir();
    await initBloatedRepo(dir);

    mkdirSync(join(dir, ".patchdiet"), { recursive: true });
    writeFileSync(join(dir, ".patchdiet", "report.md"), "SENTINEL-REPORT", "utf8");
    writeFileSync(join(dir, ".patchdiet", "cleanup.diff"), "SENTINEL-PATCH", "utf8");

    const report = await runShrinkIn(dir, { dryRun: true });

    expect(report.mode).toBe("verified");
    expect(readFileSync(join(dir, ".patchdiet", "report.md"), "utf8")).toBe("SENTINEL-REPORT");
    expect(readFileSync(join(dir, ".patchdiet", "cleanup.diff"), "utf8")).toBe("SENTINEL-PATCH");
    expect(report.patchPath).toBeUndefined();
  });
});
