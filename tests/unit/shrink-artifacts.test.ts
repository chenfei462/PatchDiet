import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { clearInProcessCachesForTests, runShrink } from "../../packages/core/src/shrink.js";

const execFileAsync = promisify(execFile);

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    // Await bounded Windows handle retries; cleanup errors remain failures.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  clearInProcessCachesForTests();
});

function makeDir(base: string) {
  mkdirSync(base, { recursive: true });
  tempDirs.push(base);
}

async function initGitRepo(dir: string, branch = "main") {
  await execFileAsync("git", ["init", "-b", branch], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "patchdiet@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "PatchDiet"], { cwd: dir });
}

async function commitFile(dir: string, filePath: string, content: string, message: string) {
  // Nested paths (e.g. "src/main.js") need their parent directory.
  mkdirSync(join(dir, dirname(filePath)), { recursive: true });
  writeFileSync(join(dir, filePath), content, "utf8");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", message], { cwd: dir });
}

/** main with the given extra file, then agent/bloated changing src/main.js. */
async function makeChangeRepo(
  dir: string,
  options: { gitignore?: string } = {}
): Promise<void> {
  await initGitRepo(dir);
  if (options.gitignore !== undefined) {
    await commitFile(dir, ".gitignore", options.gitignore, "ignore artifacts");
  }
  await commitFile(dir, "src/main.js", "export const x = 1;\n", "base");
  await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
  await commitFile(dir, "src/main.js", "export const x = 2;\n", "head change");
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

async function gitStatusPorcelain(dir: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: dir });
  return stdout;
}

// ── Shrink artifacts vs. git tracking (review M8) ─────────────────────

describe("shrink artifacts and git tracking", () => {
  it("keeps .patchdiet out of git status --porcelain when the repository ignores it", async () => {
    const dir = join(tmpdir(), `patchdiet-artifacts-ignored-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(dir, { gitignore: ".patchdiet/\n" });

    const result = await runShrinkIn(dir);

    // Sanity: a real shrink happened and artifacts were written.
    expect(result.removals.some((item) => item.filePath === "src/main.js")).toBe(true);
    expect(existsSync(join(dir, ".patchdiet", "run.json"))).toBe(true);

    const status = await gitStatusPorcelain(dir);
    expect(status).not.toContain(".patchdiet");
    expect(status.trim()).toBe(""); // no other pollution either
  });

  it("keeps .patchdiet out of the commit-to-commit diff even without a .gitignore", async () => {
    const dir = join(tmpdir(), `patchdiet-artifacts-untracked-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(dir); // no .gitignore in this repository

    const result = await runShrinkIn(dir);
    expect(result.removals.some((item) => item.filePath === "src/main.js")).toBe(true);

    // Untracked artifacts can never leak into the diff a future run inspects.
    const { stdout: diff } = await execFileAsync("git", ["diff", "main...agent/bloated"], { cwd: dir });
    expect(diff).toContain("src/main.js");
    expect(diff).not.toContain(".patchdiet");
  });

  it("leaves an ignore-free repository with an empty git status after a dry run", async () => {
    const dir = join(tmpdir(), `patchdiet-artifacts-dryrun-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(dir); // no .gitignore in this repository

    const result = await runShrinkIn(dir, { dryRun: true });

    expect(result.patchPath).toBeUndefined();
    expect(existsSync(join(dir, ".patchdiet"))).toBe(false);
    const status = await gitStatusPorcelain(dir);
    expect(status.trim()).toBe("");
  });
});

// ── retry_flaky_tests semantics (review M8) ───────────────────────────
// Pins the current engine behavior directly: every failure is retried (not
// just flaky ones), attempts are counted per invocation, and a final timeout
// throws a dedicated error. Note the ENGINE default (runShrink without the
// option) is zero retries; the documented default of 2 comes from
// patchdiet.yaml via the CLI, which the e2e suite covers.

/** Fails the first invocation, passes on every later one (counter file based). */
function flakyCommand(counterPath: string): string {
  const p = counterPath.replaceAll("\\", "/");
  return (
    `node -e "const fs=require('fs');const n=Number(fs.readFileSync('${p}','utf8'))+1;` +
    `fs.writeFileSync('${p}',String(n));process.exit(n-1?0:1)"`
  );
}

/** Always fails, but records every invocation in the counter file. */
function alwaysFailingCommand(counterPath: string): string {
  const p = counterPath.replaceAll("\\", "/");
  return (
    `node -e "const fs=require('fs');const n=Number(fs.readFileSync('${p}','utf8'))+1;` +
    `fs.writeFileSync('${p}',String(n));process.exit(1)"`
  );
}

describe("retry_flaky_tests semantics", () => {
  it("rejects conflicting baseline outcomes after executing every configured retry", async () => {
    const dir = join(tmpdir(), `patchdiet-retry-pass-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(dir);
    const counterPath = join(dir, "flaky-count.txt");
    writeFileSync(counterPath, "0", "utf8");

    await expect(runShrinkIn(dir, {
      requiredCommands: [flakyCommand(counterPath)],
      retryFlakyTests: 2
    })).rejects.toThrow(/INCONCLUSIVE baseline/);

    expect(readFileSync(counterPath, "utf8")).toBe("3");
    expect(existsSync(join(dir, ".patchdiet", "cleanup.diff"))).toBe(false);
    expect(existsSync(join(dir, ".patchdiet", "run.json"))).toBe(false);
    const { stdout: worktrees } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd: dir });
    expect(worktrees).not.toContain(".patchdiet/eval");
  });

  it("retries every failure — not only flaky ones — for exactly 1 + retry attempts", async () => {
    const dir = join(tmpdir(), `patchdiet-retry-alwaysfail-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(dir);
    const counterPath = join(dir, "flaky-count.txt");
    writeFileSync(counterPath, "0", "utf8");

    await expect(
      runShrinkIn(dir, {
        requiredCommands: [alwaysFailingCommand(counterPath)],
        retryFlakyTests: 2
      })
    ).rejects.toThrow(/required command failed: node -e/);

    // 1 initial attempt + 2 retries = 3 invocations of the failing command.
    expect(readFileSync(counterPath, "utf8")).toBe("3");
  });

  it("retryFlakyTests: 0 runs a failing command exactly once", async () => {
    const dir = join(tmpdir(), `patchdiet-retry-zero-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(dir);
    const counterPath = join(dir, "flaky-count.txt");
    writeFileSync(counterPath, "0", "utf8");

    await expect(
      runShrinkIn(dir, {
        requiredCommands: [alwaysFailingCommand(counterPath)],
        retryFlakyTests: 0
      })
    ).rejects.toThrow(/required command failed/);

    expect(readFileSync(counterPath, "utf8")).toBe("1");
  });

  it("throws a timeout error naming the budget when a required command hangs", async () => {
    const dir = join(tmpdir(), `patchdiet-retry-timeout-${Date.now()}`);
    makeDir(dir);
    await makeChangeRepo(dir);

    await expect(
      runShrinkIn(dir, {
        requiredCommands: ["node -e \"setTimeout(function(){},60000)\""],
        commandTimeoutMs: 400,
        retryFlakyTests: 0
      })
    ).rejects.toThrow(/required command timed out after 400ms/);
  }, 20000);
});
