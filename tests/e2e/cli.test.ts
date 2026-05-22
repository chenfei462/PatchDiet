import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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
    expect(stdout).toContain("npx patchdiet shrink --base origin/main --head HEAD");
    expect(stdout).toContain("Zero config works for root JS repos");
    expect(stdout).toContain("patchdiet init");
    expect(stdout).toContain("will not guess workspace, package-directory, or non-JS commands");
    expect(stdout).toContain("check");
    expect(stdout).toContain("shrink");
  });

  it("shows shrink help that explains support boundaries and recovery", async () => {
    const { stdout } = await execFileAsync(
      "node",
      [cliEntry, "shrink", "--help"],
      { cwd: process.cwd() }
    );

    expect(stdout).toContain("Zero config: root JS repos with npm, pnpm, or yarn and a package.json test script.");
    expect(stdout).toContain("PatchDiet will not guess workspace, monorepo, package-directory, or non-JS commands.");
    expect(stdout).toContain("If detection fails, pass --test or run patchdiet init and edit commands.required.");
    expect(stdout).toContain("patchdiet shrink --base origin/main --head HEAD --test \"pnpm --filter app test\"");
  });

  it("creates config via init", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-init-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@9.0.0",
        scripts: {
          test: "vitest run",
          lint: "eslint .",
          typecheck: "tsc --noEmit"
        }
      }, null, 2)
    );

    const init = await execFileAsync("node", [cliEntry, "init"], {
      cwd: dir
    });

    expect(readFileSync(join(dir, "patchdiet.yaml"), "utf8")).toContain("base: origin/main");
    expect(readFileSync(join(dir, "patchdiet.yaml"), "utf8")).toContain("- pnpm test");
    expect(readFileSync(join(dir, "patchdiet.yaml"), "utf8")).toContain("- pnpm lint");
    expect(readFileSync(join(dir, "patchdiet.yaml"), "utf8")).toContain("- pnpm typecheck");
    expect(init.stdout).toContain("Created patchdiet.yaml");
    expect(init.stdout).toContain("Detected root JS commands");
    expect(init.stdout).toContain("Next: npx patchdiet shrink --base origin/main --head HEAD");
    expect(init.stdout).toContain("Edit commands.required");
  });

  it("tells init users to edit commands.required before shrink when no root JS test is detected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-init-empty-"));
    tempDirs.push(dir);

    const init = await execFileAsync("node", [cliEntry, "init"], {
      cwd: dir
    });

    expect(readFileSync(join(dir, "patchdiet.yaml"), "utf8")).toContain("required: []");
    expect(init.stdout).toContain("No root JS test script was detected.");
    expect(init.stdout).toContain("Edit commands.required before running shrink.");
    expect(init.stdout).toContain("Then: npx patchdiet shrink --base origin/main --head HEAD");
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
        "node --test",
        "--lint",
        "node -e \"process.exit(0)\"",
        "--typecheck",
        "node -e \"process.exit(0)\"",
        "--dry-run"
      ],
      { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
    );

    expect(readFileSync(join(dir, ".patchdiet", "report.md"), "utf8")).toContain("PatchDiet Report");
    expect(readFileSync(join(dir, ".patchdiet", "report.html"), "utf8")).toContain("Evidence summary");
    expect(readFileSync(join(dir, ".patchdiet", "run.json"), "utf8")).toContain("\"baseRef\": \"main\"");
  });

  it("auto-detects package manager commands when shrink flags are omitted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-auto-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);
    installStubPackageManager(dir, "npm");

    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "ts-bloated-pr",
        private: true,
        type: "module",
        packageManager: "npm@10.0.0",
        scripts: {
          test: "node --test",
          lint: "eslint .",
          typecheck: "tsc --noEmit"
        }
      }, null, 2)
    );

    await execFileAsync(
      "node",
      [
        cliEntry,
        "shrink",
        "--base",
        "main",
        "--head",
        "agent/bloated",
        "--dry-run"
      ],
      {
        cwd: process.cwd(),
        env: buildStubEnv(dir, { ...process.env, PATCHDIET_TARGET_CWD: dir })
      }
    );

    const invocations = readFileSync(join(dir, ".stub-bin", "npm.log"), "utf8");
    expect(invocations).toContain("test");
    expect(invocations).toContain("run lint");
    expect(invocations).toContain("run typecheck");
  });

  it("guides non-JS repos toward explicit verification commands", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-non-js-"));
    tempDirs.push(dir);
    await createExampleRepo("python-agent-refactor", dir);

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
          "--dry-run"
        ],
        { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Supported zero-config path: root JS repos with npm, pnpm, or yarn and a package.json test script.")
    });
  });

  it("guides JS repos without root scripts toward explicit workspace commands", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-cli-no-root-script-"));
    tempDirs.push(dir);
    await createExampleRepo("monorepo-scope-creep", dir);

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
          "--dry-run"
        ],
        { cwd: process.cwd(), env: { ...process.env, PATCHDIET_TARGET_CWD: dir } }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("PatchDiet found package.json, but no root test script.")
    });
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

function installStubPackageManager(dir: string, commandName: "npm" | "pnpm" | "yarn"): void {
  const binDir = join(dir, ".stub-bin");
  mkdirSync(binDir, { recursive: true });
  const logPath = join(binDir, `${commandName}.log`).replaceAll("\\", "/");
  const shellScriptPath = join(binDir, commandName);
  const windowsScriptPath = join(binDir, `${commandName}.cmd`);
  writeFileSync(
    shellScriptPath,
    [
      "#!/usr/bin/env sh",
      `printf '%s\\n' "$*" >> "${logPath}"`,
      "exit 0"
    ].join("\n"),
    "utf8"
  );
  chmodSync(shellScriptPath, 0o755);
  writeFileSync(
    windowsScriptPath,
    [
      "@echo off",
      "setlocal",
      `echo %*>>\"${logPath}\"`,
      "exit /b 0"
    ].join("\r\n"),
    "utf8"
  );
}

function buildStubEnv(dir: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: `${join(dir, ".stub-bin")}${delimiter}${env.PATH ?? ""}`
  };
}
