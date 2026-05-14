import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadPatchDietConfig, mergeConfigWithFlags } from "../../packages/core/src/config.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadPatchDietConfig", () => {
  it("returns defaults when config file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-"));
    tempDirs.push(dir);

    const config = loadPatchDietConfig(dir);

    expect(config.base).toBe("origin/main");
    expect(config.language).toBe("generic");
    expect(config.commands.required).toEqual([]);
    expect(config.reduction.atomGranularity).toBe("hunk");
    expect(config.report.html).toBe(true);
  });

  it("loads patchdiet.yaml when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "patchdiet.yaml"),
      [
        "base: upstream/main",
        "language: python",
        "commands:",
        "  required:",
        "    - npm test",
        "reduction:",
        "  strategy: conservative",
        "scope:",
        "  ignore_paths:",
        "    - dist/**"
      ].join("\n")
    );

    const config = loadPatchDietConfig(dir);

    expect(config.base).toBe("upstream/main");
    expect(config.language).toBe("python");
    expect(config.commands.required).toEqual(["npm test"]);
    expect(config.scope.ignorePaths).toEqual(["dist/**"]);
  });
});

describe("mergeConfigWithFlags", () => {
  it("prefers flags over file config", () => {
    const merged = mergeConfigWithFlags(
      {
        base: "origin/main",
        language: "generic",
        commands: { required: ["npm test"], optional: [] },
        reduction: {
          strategy: "conservative",
          atomGranularity: "hunk",
          maxRuntimeMinutes: 20,
          retryFlakyTests: 2
        },
        scope: {
          ignorePaths: [],
          allowFormatOnlyRemoval: true,
          flagDependencyBumps: true
        },
        report: {
          html: true,
          markdown: true,
          githubComment: true
        }
      },
      {
        base: "feature/base",
        test: ["pnpm test", "pnpm lint"]
      }
    );

    expect(merged.base).toBe("feature/base");
    expect(merged.commands.required).toEqual(["pnpm test", "pnpm lint"]);
  });
});
