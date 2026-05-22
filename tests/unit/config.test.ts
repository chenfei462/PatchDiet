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
        "  optional:",
        "    - npm run lint",
        "reduction:",
        "  strategy: conservative",
        "  max_runtime_minutes: 7",
        "  retry_flaky_tests: 3",
        "scope:",
        "  ignore_paths:",
        "    - dist/**",
        "  allow_format_only_removal: false",
        "  flag_dependency_bumps: false",
        "report:",
        "  html: false",
        "  markdown: true",
        "  github_comment: false"
      ].join("\n")
    );

    const config = loadPatchDietConfig(dir);

    expect(config.base).toBe("upstream/main");
    expect(config.language).toBe("python");
    expect(config.commands.required).toEqual(["npm test"]);
    expect(config.commands.optional).toEqual(["npm run lint"]);
    expect(config.reduction.maxRuntimeMinutes).toBe(7);
    expect(config.reduction.retryFlakyTests).toBe(3);
    expect(config.scope.ignorePaths).toEqual(["dist/**"]);
    expect(config.scope.allowFormatOnlyRemoval).toBe(false);
    expect(config.scope.flagDependencyBumps).toBe(false);
    expect(config.report.html).toBe(false);
    expect(config.report.githubComment).toBe(false);
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
        test: ["pnpm test"],
        lint: ["pnpm lint"],
        typecheck: ["pnpm typecheck"]
      }
    );

    expect(merged.base).toBe("feature/base");
    expect(merged.commands.required).toEqual(["pnpm test"]);
    expect(merged.commands.optional).toEqual(["pnpm lint", "pnpm typecheck"]);
  });

  it("uses detected commands when flags and config are empty", () => {
    const merged = mergeConfigWithFlags(
      {
        base: "origin/main",
        language: "generic",
        commands: { required: [], optional: [] },
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
      {},
      {
        required: ["yarn test"],
        optional: ["yarn lint"]
      }
    );

    expect(merged.commands.required).toEqual(["yarn test"]);
    expect(merged.commands.optional).toEqual(["yarn lint"]);
  });

  it("treats empty flag arrays as unresolved and keeps config commands first", () => {
    const merged = mergeConfigWithFlags(
      {
        base: "origin/main",
        language: "generic",
        commands: { required: ["npm test"], optional: ["npm run lint"] },
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
        test: [],
        lint: [],
        typecheck: []
      },
      {
        required: ["pnpm test"],
        optional: ["pnpm lint", "pnpm typecheck"]
      }
    );

    expect(merged.commands.required).toEqual(["npm test"]);
    expect(merged.commands.optional).toEqual(["npm run lint"]);
  });

  it("leaves required commands unresolved when flags, config, and detection are empty", () => {
    const merged = mergeConfigWithFlags(
      {
        base: "origin/main",
        language: "generic",
        commands: { required: [], optional: [] },
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
      {}
    );

    expect(merged.commands.required).toEqual([]);
    expect(merged.commands.optional).toEqual([]);
  });
});
