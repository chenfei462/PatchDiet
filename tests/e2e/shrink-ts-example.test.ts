import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { runShrink } from "../../packages/core/src/shrink.js";
import { createExampleRepo } from "./helpers/create-example-repo.js";

const execFileAsync = promisify(execFile);
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
    expect(result.output.fileCount).toBe(1);
    expect(result.removals.length).toBeGreaterThanOrEqual(2);
    expect(result.kept.length).toBeGreaterThanOrEqual(1);
    expect(result.patchPath).toBeTruthy();
    expect(readFileSync(result.patchPath!, "utf8")).toContain("multiply");
    expect(readFileSync(result.patchPath!, "utf8")).not.toContain("unused.ts");
    expect(result.removals.some((item) => item.category === "docs-comment-only")).toBe(true);
    expect(result.removals.some((item) => item.category === "unrelated-path")).toBe(true);
  });

  it("keeps ignored paths out of reduction attempts", async () => {
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

    expect(result.output.fileCount).toBe(2);
    expect(result.kept.some((item) => item.filePath === "README.md" && item.category === "ignored-path")).toBe(true);
    expect(readFileSync(result.patchPath!, "utf8")).toContain("README");

    await execFileAsync("git", ["checkout", "main"], { cwd: dir });
    await execFileAsync("git", ["apply", result.patchPath!], { cwd: dir });
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("Unrelated docs update");
  });

  it("runs optional commands when they are green at baseline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-shrink-optional-"));
    tempDirs.push(dir);
    await createExampleRepo("ts-bloated-pr", dir);

    const result = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "agent/bloated",
      requiredCommands: ["node --test"],
      optionalCommands: ["node -e \"process.exit(require('fs').readFileSync('README.md','utf8').includes('Unrelated docs update') ? 0 : 1)\""]
    });

    expect(result.kept.some((item) => item.reason.includes("optional check"))).toBe(true);
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
