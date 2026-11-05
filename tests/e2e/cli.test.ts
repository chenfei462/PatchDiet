import { rm } from "node:fs/promises";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createExampleRepo } from "./helpers/create-example-repo.js";
import { loadPatchDietConfig } from "../../packages/core/src/config.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const cliEntry = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

  it("creates a loadable v2 template with supported hunk reduction and safety policy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-init-v2-"));
    tempDirs.push(dir);
    await execFileAsync("node", [cliEntry, "init", "--v2"], { cwd: dir });
    const config = loadPatchDietConfig(dir);
    expect(config.version).toBe(2);
    expect(config.reduction.strategy).toBe("ddmin");
    // The v2 template defaults to AST granularity: the AST runtime is proven
    // (real three-language gates) and integrated in this version.
    expect(config.reduction.atomGranularity).toBe("ast");
    expect(config.safety.protect).toContain("**/migrations/**");
    expect(config.verification?.fullRequiredAtEnd).toBe(true);
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
  }, 60000);

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

// ── CLI error paths (review M8) ──────────────────────────────────────
// Every failure path must exit with code 1 and print a human-readable
// message — thrown errors go to stderr; `doctor` reports diagnostics on
// stdout and signals failure through the exit code alone.

interface CliFailure {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCliExpectingFailure(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<CliFailure> {
  try {
    await execFileAsync("node", [cliEntry, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env }
    });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      code: Number(failure.code),
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    };
  }
  throw new Error(`expected the CLI to fail, but it exited 0: patchdiet ${args.join(" ")}`);
}

describe("patchdiet cli error paths", () => {
  it("check fails with exit code 1 and a readable stderr when the base ref does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-err-badref-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    const failure = await runCliExpectingFailure(
      ["check", "--base", "no-such-base-ref", "--head", "agent/bloated"],
      { PATCHDIET_TARGET_CWD: dir }
    );

    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain("Git ref not found: no-such-base-ref");
  });

  it("check fails with exit code 1 and a readable stderr for an invalid patchdiet.yaml", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-err-badcfg-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "patchdiet.yaml"), "base: origin/main\nlanguage: generic\nevil_key: injected\n", "utf8");

    const failure = await runCliExpectingFailure(["check"], { PATCHDIET_TARGET_CWD: dir });

    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain("Invalid patchdiet.yaml");
    expect(failure.stderr).toContain("evil_key");
  });

  it("doctor fails with exit code 1 and a readable stderr for an invalid patchdiet.yaml", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-err-doctor-cfg-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "patchdiet.yaml"), "base: origin/main\nreduction:\n  max_runtime_minutes: 99999\n", "utf8");

    const failure = await runCliExpectingFailure(["doctor"], { PATCHDIET_TARGET_CWD: dir });

    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain("Invalid patchdiet.yaml");
    expect(failure.stderr).toContain("max_runtime_minutes");
  });

  it("doctor fails with exit code 1 and readable diagnostics outside a git repository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-err-doctor-nogit-"));
    tempDirs.push(dir);

    const failure = await runCliExpectingFailure(["doctor"], { PATCHDIET_TARGET_CWD: dir });

    expect(failure.code).toBe(1);
    // doctor reports on stdout (not by throwing), so the readable message
    // lives there while the exit code alone signals the failure.
    expect(failure.stdout).toContain("PatchDiet doctor");
    expect(failure.stdout).toContain("repository: failed");
    expect(failure.stdout).toContain("test: not detected");
    expect(failure.stdout).toContain("test hint:");
  });

  it.each([
    { flag: "--timeout-ms", value: "zero", message: "Expected a positive integer, got: zero" },
    { flag: "--timeout-ms", value: "-5", message: "Expected a positive integer, got: -5" },
    { flag: "--retry-flaky-tests", value: "-1", message: "Expected a non-negative integer, got: -1" }
  ])("shrink rejects $flag $value with exit code 1 and a readable stderr", async (testCase: { flag: string; value: string; message: string }) => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-err-badflag-"));
    tempDirs.push(dir);

    const failure = await runCliExpectingFailure(
      ["shrink", testCase.flag, testCase.value, "--test", "node -e \"process.exit(0)\""],
      { PATCHDIET_TARGET_CWD: dir }
    );

    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain(testCase.message);
  });

  it("report fails with exit code 1 and a readable stderr when no shrink has run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-err-report-"));
    tempDirs.push(dir);

    const failure = await runCliExpectingFailure(["report"], { PATCHDIET_TARGET_CWD: dir });

    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain("ENOENT");
    expect(failure.stderr).toContain("run.json");
  });

  it("retries per --retry-flaky-tests but refuses conflicting baseline outcomes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-retry-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);
    const counterPath = join(dir, "flaky-count.txt");
    // Fails the first invocation, passes afterwards (counter-based flake).
    const flakyCommand =
      `node -e "const fs=require('fs');const p='${counterPath.replaceAll("\\", "/")}';` +
      `const n=Number(fs.readFileSync(p,'utf8'))+1;fs.writeFileSync(p,String(n));process.exit(n-1?0:1)"`;
    const targetEnv = { PATCHDIET_TARGET_CWD: dir };

    // Retries disabled: the single flaky failure aborts the run with exit 1.
    writeFileSync(counterPath, "0", "utf8");
    const failure = await runCliExpectingFailure(
      ["shrink", "--base", "main", "--head", "agent/bloated", "--test", flakyCommand, "--retry-flaky-tests", "0"],
      targetEnv
    );
    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain("required command failed");
    expect(readFileSync(counterPath, "utf8")).toBe("1");

    // v0.2: a later retry pass does not erase the observed baseline failure.
    // The initial attempt and both configured retries execute; conflicting outcomes prohibit attestation.
    writeFileSync(counterPath, "0", "utf8");
    const inconclusive = await runCliExpectingFailure(
      ["shrink", "--base", "main", "--head", "agent/bloated", "--test", flakyCommand],
      targetEnv
    );
    expect(inconclusive.code).toBe(1);
    expect(inconclusive.stderr).toContain("INCONCLUSIVE baseline");
    expect(readFileSync(counterPath, "utf8")).toBe("3");
    expect(existsSync(join(dir, ".patchdiet", "run.json"))).toBe(false);
    expect(existsSync(join(dir, ".patchdiet", "cleanup.diff"))).toBe(false);
    const { stdout: worktrees } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd: dir });
    expect(worktrees).not.toContain(".patchdiet/eval");
  }, 45000);
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
