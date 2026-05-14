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
    expect(result.output.fileCount).toBe(1);
    expect(result.removals.length).toBeGreaterThanOrEqual(2);
    expect(result.kept.length).toBeGreaterThanOrEqual(1);
    expect(result.patchPath).toBeTruthy();
    expect(readFileSync(result.patchPath!, "utf8")).toContain("multiply");
    expect(readFileSync(result.patchPath!, "utf8")).not.toContain("unused.ts");
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
