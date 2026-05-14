import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createExampleRepo } from "./helpers/create-example-repo.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createExampleRepo", () => {
  it("materializes the ts-bloated-pr example into a git repo with a bloated branch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-example-"));
    tempDirs.push(dir);

    const repo = await createExampleRepo("ts-bloated-pr", dir);

    expect(repo.repoPath).toBe(dir);
    expect(existsSync(join(dir, "src", "math.ts"))).toBe(true);
    expect(readFileSync(join(dir, "src", "math.ts"), "utf8")).toContain("add");
    expect(repo.baseRef).toBe("main");
    expect(repo.headRef).toBe("agent/bloated");
  });

  it("materializes the python and monorepo examples", async () => {
    const pythonDir = mkdtempSync(join(tmpdir(), "patchdiet-example-python-"));
    const monoDir = mkdtempSync(join(tmpdir(), "patchdiet-example-mono-"));
    tempDirs.push(pythonDir, monoDir);

    const pythonRepo = await createExampleRepo("python-agent-refactor", pythonDir);
    const monoRepo = await createExampleRepo("monorepo-scope-creep", monoDir);

    expect(readFileSync(join(pythonDir, "src", "math.py"), "utf8")).toContain("add");
    expect(readFileSync(join(monoDir, "packages", "app", "src", "math.js"), "utf8")).toContain("add");
    expect(pythonRepo.headRef).toBe("agent/bloated");
    expect(monoRepo.baseRef).toBe("main");
  });
});
