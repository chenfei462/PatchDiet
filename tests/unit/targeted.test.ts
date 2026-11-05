import { describe, expect, it } from "vitest";

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildTargetedPlan, supportedRunnerCommand } from "../../packages/core/src/targeted.js";
import { indexRepository } from "../../packages/knowledge/src/index.js";

function gitSync(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function initRepo(label: string): string {
  const cwd = mkdtempSync(join(tmpdir(), `patchdiet-targeted-${label}-`));
  mkdirSync(join(cwd, "src"), { recursive: true });
  mkdirSync(join(cwd, "test"), { recursive: true });
  gitSync(["init", "-b", "main"], cwd);
  gitSync(["config", "user.email", "test@patchdiet.local"], cwd);
  gitSync(["config", "user.name", "PatchDiet Tests"], cwd);
  gitSync(["config", "core.autocrlf", "false"], cwd);
  return cwd;
}

describe("supportedRunnerCommand", () => {
  it("maps node-runnable test files to the node built-in runner", () => {
    expect(supportedRunnerCommand("test/total.test.js", false)).toBe("node --test test/total.test.js");
    expect(supportedRunnerCommand("tests/app.spec.mjs", false)).toBe("node --test tests/app.spec.mjs");
  });

  it("maps python test files to pytest only when pytest is configured", () => {
    expect(supportedRunnerCommand("tests/test_total.py", true)).toBe("python -m pytest tests/test_total.py -q");
    expect(supportedRunnerCommand("tests/test_total.py", false)).toBeUndefined();
  });

  it("rejects shell-unsafe filenames instead of interpolating them", () => {
    expect(supportedRunnerCommand("tests/my test.test.js", false)).toBeUndefined();
    expect(supportedRunnerCommand('tests/evil";rm -rf;.test.js', false)).toBeUndefined();
    expect(supportedRunnerCommand("tests/-flag.test.js", false)).toBe("node --test tests/-flag.test.js");
  });

  it("rejects TypeScript test files (no guessed TS runner)", () => {
    expect(supportedRunnerCommand("tests/total.test.ts", true)).toBeUndefined();
  });
});

describe("buildTargetedPlan", () => {
  it("falls back explicitly when the index database is missing", () => {
    const cwd = initRepo("missing-db");
    writeFileSync(join(cwd, "src.ts"), "export const a = 1;\n");
    const plan = buildTargetedPlan({
      cwd,
      changedPaths: ["src.ts"],
      hasPytest: false,
      pinnedHeadSha: "0".repeat(40)
    });
    expect(plan.available).toBe(false);
    expect(plan.diagnostic).toContain("not found");
    expect(plan.diagnostic).toContain("FULL required oracle");
  });

  it("falls back when the index identity does not match the pinned HEAD", async () => {
    const cwd = initRepo("stale-index");
    writeFileSync(join(cwd, ".gitignore"), ".patchdiet/\n");
    writeFileSync(join(cwd, "src/util.js"), "export const a = 1;\n");
    writeFileSync(join(cwd, "test/util.test.js"), "import { a } from '../src/util.js';\n");
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "base"], cwd);
    await indexRepository({ cwd, ref: "HEAD", databasePath: ".patchdiet/knowledge.sqlite" });
    const headSha = gitSync(["rev-parse", "HEAD"], cwd);
    const stale = buildTargetedPlan({
      cwd,
      changedPaths: ["src/util.js"],
      hasPytest: false,
      pinnedHeadSha: "1".repeat(40)
    });
    expect(stale.available).toBe(false);
    expect(stale.diagnostic).toContain("stale");

    const fresh = buildTargetedPlan({
      cwd,
      changedPaths: ["src/util.js"],
      hasPytest: false,
      pinnedHeadSha: headSha,
      expectedRepoRoot: gitSync(["rev-parse", "--show-toplevel"], cwd)
    });
    expect(fresh.available).toBe(true);
    expect(fresh.mappings["src/util.js"]).toEqual(["node --test test/util.test.js"]);
    expect(fresh.provenance).toContain("import-graph");
  });

  it("reports an explicit unsupported-runner fallback instead of an empty available plan", async () => {
    const cwd = initRepo("unsupported-recipes");
    writeFileSync(join(cwd, ".gitignore"), ".patchdiet/\n");
    writeFileSync(join(cwd, "src/util.js"), "export const a = 1;\n");
    writeFileSync(join(cwd, "test/util.test.ts"), "import { a } from '../src/util.js';\n");
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "base"], cwd);
    await indexRepository({ cwd, ref: "HEAD", databasePath: ".patchdiet/knowledge.sqlite", languages: ["javascript", "typescript"] });
    const plan = buildTargetedPlan({
      cwd,
      changedPaths: ["src/util.js"],
      hasPytest: false,
      pinnedHeadSha: gitSync(["rev-parse", "HEAD"], cwd)
    });
    expect(plan.available).toBe(false);
    expect(plan.unsupportedRecipes).toContain("test/util.test.ts");
    expect(plan.diagnostic).toContain("supported runner recipe");
    expect(Object.keys(plan.mappings)).toHaveLength(0);
  });

  it("falls back when the index has no mapping for the changed files", async () => {
    const cwd = initRepo("no-mapping");
    writeFileSync(join(cwd, ".gitignore"), ".patchdiet/\n");
    writeFileSync(join(cwd, "src/lonely.js"), "export const a = 1;\n");
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "base"], cwd);
    await indexRepository({ cwd, ref: "HEAD", databasePath: ".patchdiet/knowledge.sqlite" });
    const plan = buildTargetedPlan({
      cwd,
      changedPaths: ["src/lonely.js"],
      hasPytest: false,
      pinnedHeadSha: gitSync(["rev-parse", "HEAD"], cwd)
    });
    expect(plan.available).toBe(false);
    expect(plan.diagnostic).toContain("no test mapping for the changed files");
  });

  it("detects the index database from the configured repo-relative path", async () => {
    const cwd = initRepo("db-path");
    writeFileSync(join(cwd, "src/util.js"), "export const a = 1;\n");
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "base"], cwd);
    expect(existsSync(join(cwd, ".patchdiet/knowledge.sqlite"))).toBe(false);
    await indexRepository({ cwd, ref: "HEAD", databasePath: ".patchdiet/knowledge.sqlite" });
    expect(existsSync(join(cwd, ".patchdiet/knowledge.sqlite"))).toBe(true);
  });
});
