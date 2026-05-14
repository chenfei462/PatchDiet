import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createExampleRepo } from "./helpers/create-example-repo.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const cliEntry = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("patchdiet cli", () => {
  it("shows help output", async () => {
    const { stdout } = await execFileAsync(
      "node",
      [cliEntry, "--help"],
      { cwd: process.cwd() }
    );

    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("check");
    expect(stdout).toContain("shrink");
  });

  it("creates config via init", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-init-"));
    tempDirs.push(dir);

    await execFileAsync("node", [cliEntry, "init"], {
      cwd: dir
    });

    expect(readFileSync(join(dir, "patchdiet.yaml"), "utf8")).toContain("base: origin/main");
  });

  it("runs check and shrink in the example repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-run-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    const check = await execFileAsync(
      "node",
      [cliEntry, "check", "--base", "main", "--head", "agent/bloated"],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );
    expect(check.stdout).toContain("\"fileCount\": 4");
    expect(check.stdout).toContain("\"candidateCount\": 2");

    await execFileAsync(
        "node",
        [
        cliEntry,
        "shrink",
        "--base",
        "main",
        "--head",
        "agent/bloated",
        "--test",
        "node --test"
      ],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    expect(readFileSync(join(dir, ".patchdiet", "report.md"), "utf8")).toContain("PatchDiet Report");
    expect(readFileSync(join(dir, ".patchdiet", "run.json"), "utf8")).toContain("\"baseRef\": \"main\"");
  });

  it("renders a github comment from the stored json artifact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-report-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    await execFileAsync(
      "node",
      [
        cliEntry,
        "shrink",
        "--base",
        "main",
        "--head",
        "agent/bloated",
        "--test",
        "node --test"
      ],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    const report = await execFileAsync(
      "node",
      [cliEntry, "report", "--format", "github"],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    expect(report.stdout).toContain("PatchDiet found a smaller equivalent patch.");
  });

  it("renders a json report from the stored json artifact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-report-json-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    await execFileAsync(
      "node",
      [
        cliEntry,
        "shrink",
        "--base",
        "main",
        "--head",
        "agent/bloated",
        "--test",
        "node --test"
      ],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    const report = await execFileAsync(
      "node",
      [cliEntry, "report", "--format", "json"],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    const parsed = JSON.parse(report.stdout) as {
      baseRef: string;
      output: { fileCount: number };
      removals: Array<{ filePath: string }>;
    };

    expect(parsed.baseRef).toBe("main");
    expect(parsed.output.fileCount).toBe(1);
    expect(parsed.removals.some((item) => item.filePath === "README.md")).toBe(true);
  });

  it("requires an explicit safety flag before branch creation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-safety-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    await execFileAsync(
      "node",
      [
        cliEntry,
        "shrink",
        "--base",
        "main",
        "--head",
        "agent/bloated",
        "--test",
        "node --test"
      ],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    const branchList = await execFileAsync("git", ["branch", "--list", "patchdiet/cleanup-*"], {
      cwd: dir
    });
    expect(branchList.stdout.trim()).toBe("");

    await execFileAsync(
      "node",
      [
        cliEntry,
        "shrink",
        "--base",
        "main",
        "--head",
        "agent/bloated",
        "--test",
        "node --test",
        "--create-branch"
      ],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    const branchCreated = await execFileAsync("git", ["branch", "--list", "patchdiet/cleanup-*"], {
      cwd: dir
    });
    expect(branchCreated.stdout).toContain("patchdiet/cleanup-");
    const worktrees = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
      cwd: dir
    });
    const cleanupWorktree = worktrees.stdout
      .split("\n")
      .find((line) => line.startsWith("worktree ") && line.includes(".patchdiet\\worktrees\\"))
      ?.slice("worktree ".length);
    if (cleanupWorktree) {
      await execFileAsync("git", ["worktree", "remove", cleanupWorktree, "--force"], {
        cwd: dir
      });
    }
  }, 15000);
});
