import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      [cliEntry, "check", "--base", "main", "--head", "agent/bloated", "--json"],
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

  it("runs check with detected refs and human-friendly output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-check-zero-config-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);
    await execFileAsync("git", ["update-ref", "refs/remotes/origin/main", "main"], { cwd: dir });

    const check = await execFileAsync(
      "node",
      [cliEntry, "check"],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    expect(check.stdout).toContain("PatchDiet check");
    expect(check.stdout).toContain("Base: origin/main");
    expect(check.stdout).toContain("Head: HEAD");
    expect(check.stdout).toContain("Files: 4");
    expect(check.stdout).toContain("Candidate paths:");
  });

  it("keeps json output available for check and shrink", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-json-modes-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    const check = await execFileAsync(
      "node",
      [cliEntry, "check", "--base", "main", "--head", "agent/bloated", "--json"],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );
    const checkJson = JSON.parse(check.stdout) as { fileCount: number; candidateCount: number };
    expect(checkJson.fileCount).toBe(4);
    expect(checkJson.candidateCount).toBe(2);

    const shrink = await execFileAsync(
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
        "--json"
      ],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );
    const shrinkJson = JSON.parse(shrink.stdout) as { baseRef: string; removals: unknown[] };
    expect(shrinkJson.baseRef).toBe("main");
    expect(shrinkJson.removals.length).toBeGreaterThan(0);
  }, 45000);

  it("runs shrink with detected base, head, and test command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-zero-config-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);
    await execFileAsync("git", ["update-ref", "refs/remotes/origin/main", "main"], { cwd: dir });

    const result = await execFileAsync(
      "node",
      [cliEntry, "shrink"],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    expect(result.stdout).toContain("PatchDiet shrink complete");
    expect(result.stdout).toContain("Base: origin/main");
    expect(result.stdout).toContain("Head: HEAD");
    expect(result.stdout).toContain("Test: npm test");
    expect(result.stdout).toContain("Cleanup patch:");
    expect(result.stdout).toContain("Review:");
    expect(result.stdout).toContain("Safety:");
    const report = JSON.parse(readFileSync(join(dir, ".patchdiet", "run.json"), "utf8")) as {
      baseRef: string;
      headRef: string;
      testCommand: { command: string; status: string };
      candidates: Array<{ filePath: string; category: string; verdict: string }>;
    };
    expect(report.baseRef).toBe("origin/main");
    expect(report.headRef).toBe("HEAD");
    expect(report.testCommand.command).toBe("npm test");
    expect(report.testCommand.status).toBe("passed");
    expect(report.candidates.some((item) => item.filePath === "README.md" && item.category === "docs-only")).toBe(true);
  }, 45000);

  it("explains how to provide a test command when none can be detected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-no-test-"));
    tempDirs.push(dir);
    await createMinimalDiffRepo(dir);
    await execFileAsync("git", ["update-ref", "refs/remotes/origin/main", "main"], { cwd: dir });

    await expect(
      execFileAsync(
        "node",
        [cliEntry, "shrink"],
        { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
      )
    ).rejects.toThrow(/No test command detected[\s\S]*patchdiet shrink --test "npm test"/);
  });

  it("supports dry-run without writing PatchDiet artifacts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-dry-run-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    const result = await execFileAsync(
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
        "--dry-run"
      ],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    expect(result.stdout).toContain("Dry run: no artifacts written");
    expect(existsSync(join(dir, ".patchdiet"))).toBe(false);
  }, 20000);

  it("runs doctor and reports repository readiness", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-doctor-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);
    await execFileAsync("git", ["update-ref", "refs/remotes/origin/main", "main"], { cwd: dir });

    const result = await execFileAsync(
      "node",
      [cliEntry, "doctor"],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    expect(result.stdout).toContain("PatchDiet doctor");
    expect(result.stdout).toContain("git: ok");
    expect(result.stdout).toContain("repository: ok");
    expect(result.stdout).toContain("base: origin/main");
    expect(result.stdout).toContain("head: HEAD");
    expect(result.stdout).toContain("test: npm test");
    expect(result.stdout).toContain(".patchdiet: writable");
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

    expect(report.stdout).toContain("## PatchDiet");
    expect(report.stdout).toContain("| Before | After |");
  }, 45000);

  it("renders markdown and html reports from the stored json artifact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-report-formats-"));
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

    const markdown = await execFileAsync(
      "node",
      [cliEntry, "report", "--format", "markdown"],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );
    const html = await execFileAsync(
      "node",
      [cliEntry, "report", "--format", "html"],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    expect(markdown.stdout).toContain("# PatchDiet Report");
    expect(markdown.stdout).toContain("## Artifacts");
    expect(html.stdout).toContain("<title>PatchDiet Report</title>");
    expect(html.stdout).toContain("Before");
  });

  it("allows changed test files to be removed only with an explicit flag", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-allow-test-removal-"));
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
        "node --test",
        "--allow-test-file-removal"
      ],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    const parsed = JSON.parse(readFileSync(join(dir, ".patchdiet", "run.json"), "utf8")) as {
      output: { fileCount: number };
      removals: Array<{ filePath: string }>;
    };
    expect(parsed.output.fileCount).toBe(1);
    expect(parsed.removals.some((item) => item.filePath === "test/math.test.js")).toBe(true);
  }, 45000);

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
    expect(parsed.output.fileCount).toBe(2);
    expect(parsed.removals.some((item) => item.filePath === "README.md")).toBe(true);
  });

  it("requires an explicit safety flag before branch creation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-safety-"));
    tempDirs.push(dir);
    await createMinimalDiffRepo(dir);

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
        "node -e \"process.exit(0)\""
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
        "node -e \"process.exit(0)\"",
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
      .find((line) => line.startsWith("worktree ") && line.replaceAll("/", "\\").includes(".patchdiet\\worktrees\\"))
      ?.slice("worktree ".length);
    if (cleanupWorktree) {
      await execFileAsync("git", ["worktree", "remove", cleanupWorktree, "--force"], {
        cwd: dir
      });
    }
  }, 60000);
});

async function createMinimalDiffRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "patchdiet@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "PatchDiet"], { cwd: dir });
  writeFileSync(join(dir, "app.txt"), "base\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "base"], { cwd: dir });
  await execFileAsync("git", ["checkout", "-b", "agent/bloated"], { cwd: dir });
  writeFileSync(join(dir, "app.txt"), "base\nhead\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "head"], { cwd: dir });
}
