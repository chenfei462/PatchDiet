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

describe("additional example scenarios", () => {
  it("shrinks the python example", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-python-example-"));
    tempDirs.push(dir);
    await createExampleRepo("python-agent-refactor", dir);

    const result = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "agent/bloated",
      requiredCommands: ["python -m unittest discover -s tests -v"]
    });

    expect(result.input.fileCount).toBe(4);
    expect(result.output.fileCount).toBe(1);
    expect(readFileSync(result.patchPath!, "utf8")).toContain("multiply");
    expect(readFileSync(result.patchPath!, "utf8")).not.toContain("notes.py");
  });

  it("shrinks the monorepo example", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-monorepo-example-"));
    tempDirs.push(dir);
    await createExampleRepo("monorepo-scope-creep", dir);

    const result = await runShrink({
      cwd: dir,
      baseRef: "main",
      headRef: "agent/bloated",
      requiredCommands: ["node --test packages/app/test/math.test.js"]
    });

    expect(result.input.fileCount).toBe(4);
    expect(result.output.fileCount).toBe(1);
    expect(readFileSync(result.patchPath!, "utf8")).toContain("multiply");
    expect(readFileSync(result.patchPath!, "utf8")).not.toContain("docs/roadmap.md");
  });
});
