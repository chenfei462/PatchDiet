import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runShrink } from "../../packages/core/src/shrink.js";
import { createExampleRepo } from "./helpers/create-example-repo.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runShrink", () => {
  it("removes unrelated hunks while preserving required checks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-shrink-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    const result = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "agent/bloated",
      requiredCommands: ["node --test"]
    });

    expect(result.input.fileCount).toBe(4);
    expect(result.output.fileCount).toBe(2);
    expect(result.removals.length).toBeGreaterThanOrEqual(2);
    expect(result.kept.length).toBeGreaterThanOrEqual(1);
    expect(result.headRef).toBe("agent/bloated");
    expect(result.testCommand.command).toBe("node --test");
    expect(result.testCommand.status).toBe("passed");
    expect(result.testCommand.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.candidates.some((item) => item.filePath === "README.md" && item.category === "docs-only")).toBe(true);
    expect(result.candidates.some((item) => item.filePath === "src/unused.ts" && item.category === "unknown")).toBe(true);
    expect(result.candidates.every((item) => item.reason.length > 0)).toBe(true);
    expect(result.patchPath).toBeTruthy();
    expect(readFileSync(result.patchPath!, "utf8")).toContain("multiply");
    expect(readFileSync(result.patchPath!, "utf8")).not.toContain("unused.ts");
  });

  it("keeps changed test files unless explicitly allowed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-shrink-keep-tests-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    const result = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "agent/bloated",
      requiredCommands: ["node --test"]
    });

    expect(result.kept.some((item) => item.filePath === "test/math.test.js")).toBe(true);
    expect(result.removals.some((item) => item.filePath === "test/math.test.js")).toBe(false);
    expect(readFileSync(result.patchPath!, "utf8")).toContain("test('multiply multiplies two numbers'");
  });

  it("skips ignored paths from config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-shrink-ignore-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    const result = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "agent/bloated",
      requiredCommands: ["node --test"],
      ignorePaths: ["README.md"]
    });

    expect(result.kept.some((item) => item.filePath === "README.md" && item.reason.includes("ignored by config"))).toBe(true);
    expect(result.removals.some((item) => item.filePath === "README.md")).toBe(false);
    expect(readFileSync(result.patchPath!, "utf8")).toContain("Unrelated docs update");
  });

  it("retries flaky checks during baseline verification", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-shrink-retry-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    const flakyScript = "node -e \"const fs=require('fs'); const p='.flaky'; if(!fs.existsSync(p)){fs.writeFileSync(p,'1'); process.exit(1)}\"";
    const result = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "agent/bloated",
      requiredCommands: [flakyScript],
      retryFlakyTests: 1
    });

    expect(result.testCommand.attempts).toBe(2);
    expect(result.testCommand.status).toBe("passed");
  });

  it("fails with a readable timeout message when checks exceed the budget", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-shrink-timeout-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    await expect(
      runShrink({
        cwd: dir,
        baseRef: "main",
        headRef: "agent/bloated",
        requiredCommands: ["node -e \"setTimeout(() => {}, 1000)\""],
        commandTimeoutMs: 50
      })
    ).rejects.toThrow(/required command timed out after 50ms/);
  });

  it("marks candidates as needing human review when reverse apply fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-shrink-human-review-"));
    tempDirs.push(dir);
    await createExampleRepo("reverse-apply-conflict", dir);

    const result = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "agent/bloated",
      requiredCommands: ["node --test"]
    });

    expect(result.needsHumanReview.some((item) => item.filePath === "asset.bin")).toBe(true);
    expect(result.candidates.some((item) => item.filePath === "asset.bin" && item.verdict === "needs-human-review")).toBe(true);
  });

  it("creates a cleanup branch in a separate worktree when requested", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-shrink-branch-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    const result = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "agent/bloated",
      requiredCommands: ["node --test"],
      createBranch: true
    });

    expect(result.cleanupBranch).toContain("patchdiet/cleanup-");
    expect(result.cleanupWorktreePath).toBeTruthy();
    expect(readFileSync(join(result.cleanupWorktreePath!, "src", "math.ts"), "utf8")).toContain("multiply");
  });
});
