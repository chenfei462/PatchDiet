import { rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createExampleRepo } from "./helpers/create-example-repo.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const cliEntry = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("failure recovery", () => {
  it("surfaces a readable error and leaves the workspace intact when required checks fail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-failure-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    await expect(
      execFileAsync(
        "node",
        [
          cliEntry,
          "shrink",
          "--base",
          "main",
          "--head",
          "agent/bloated",
          "--test",
          "node --test missing.test.js"
        ],
        { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
      )
    ).rejects.toThrow(/required command failed/);

    const branch = await execFileAsync("git", ["branch", "--show-current"], { cwd: dir });
    expect(branch.stdout.trim()).toBe("agent/bloated");
    const worktrees = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd: dir });
    expect(worktrees.stdout).not.toContain(".patchdiet\\worktrees\\");
  }, 15000);
});
