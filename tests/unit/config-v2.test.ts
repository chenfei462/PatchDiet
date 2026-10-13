import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPresetConfig,
  loadPatchDietConfig,
  mergeConfigWithFlags,
  type PatchDietConfig,
} from "../../packages/core/src/config.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-v2-"));
  tempDirs.push(dir);
  return dir;
}

function loadYaml(yaml: string): PatchDietConfig {
  const dir = makeDir();
  writeFileSync(join(dir, "patchdiet.yaml"), yaml, "utf8");
  return loadPatchDietConfig(dir);
}

function expectYamlError(yaml: string, messagePart?: string): void {
  const dir = makeDir();
  writeFileSync(join(dir, "patchdiet.yaml"), yaml, "utf8");
  expect(() => loadPatchDietConfig(dir)).toThrow("Invalid patchdiet.yaml");
  if (messagePart) {
    expect(() => loadPatchDietConfig(dir)).toThrow(messagePart);
  }
}

// The complete v2 example from the plan
// (docs/superpowers/plans/2026-10-03-ai-change-scope-verification-plan.md lines 287-349).
const FULL_V2_YAML = [
  "version: 2",
  "base: origin/main",
  "",
  "commands:",
  "  required:",
  "    - pnpm test",
  "    - pnpm typecheck",
  "  optional:",
  "    - pnpm lint",
  "",
  "intent:",
  "  sources:",
  "    - cli",
  "    - github_pr",
  "    - linked_issue",
  "    - commits",
  "  llm: auto",
  "",
  "knowledge:",
  "  database: .patchdiet/knowledge.sqlite",
  "  languages:",
  "    - typescript",
  "    - javascript",
  "    - python",
  "",
  "  rules:",
  "    auto_discover:",
  "      - AGENTS.md",
  "      - CLAUDE.md",
  "      - GEMINI.md",
  "      - .github/copilot-instructions.md",
  "      - CONTRIBUTING.md",
  "",
  "  history:",
  "    git: true",
  "    merged_prs: false",
  "",
  "reduction:",
  "  strategy: ddmin",
  "  atom_granularity: ast",
  "  dependency_grouping: true",
  "  final_verification: true",
  "  retry_flaky_tests: 2",
  "  max_runtime_minutes: 20",
  "",
  "verification:",
  "  targeted_first: true",
  "  full_required_at_end: true",
  "",
  "safety:",
  "  protect:",
  "    - '**/migrations/**'",
  "    - '**/generated/**'",
  "    - '**/vendor/**'",
  "  dependency_manifests: human-review",
  "  unsupported_diff: human-review",
  "",
  "report:",
  "  evidence: true",
  "  json: true",
  "  markdown: true",
  "  github_check: true"
].join("\n");

describe("v2 config - complete example", () => {
  it("accepts the full plan example and resolves every section to camelCase", () => {
    const config = loadYaml(FULL_V2_YAML);

    expect(config.version).toBe(2);
    expect(config.base).toBe("origin/main");
    expect(config.language).toBe("generic");
    expect(config.commands).toEqual({
      required: ["pnpm test", "pnpm typecheck"],
      optional: ["pnpm lint"],
    });

    expect(config.intent).toEqual({
      sources: ["cli", "github_pr", "linked_issue", "commits"],
      llm: "auto",
    });

    expect(config.knowledge).toEqual({
      database: ".patchdiet/knowledge.sqlite",
      languages: ["typescript", "javascript", "python"],
      rules: {
        autoDiscover: [
          "AGENTS.md",
          "CLAUDE.md",
          "GEMINI.md",
          ".github/copilot-instructions.md",
          "CONTRIBUTING.md",
        ],
      },
      history: { git: true, mergedPrs: false },
    });

    expect(config.reduction).toEqual({
      strategy: "ddmin",
      atomGranularity: "ast",
      dependencyGrouping: true,
      finalVerification: true,
      maxRuntimeMinutes: 20,
      retryFlakyTests: 2,
    });

    expect(config.verification).toEqual({
      targetedFirst: true,
      fullRequiredAtEnd: true,
    });

    expect(config.safety).toEqual({
      mode: "local",
      allow_upload: false,
      protect: ["**/migrations/**", "**/generated/**", "**/vendor/**"],
      dependencyManifests: "human-review",
      unsupportedDiff: "human-review",
    });

    expect(config.report).toEqual({
      html: true,
      markdown: true,
      githubComment: true,
      evidence: true,
      json: true,
      githubCheck: true,
    });
  });

  it("accepts a v2 config that omits language and fills all v2 defaults", () => {
    const config = loadYaml(["version: 2", "base: origin/main"].join("\n"));

    expect(config.version).toBe(2);
    expect(config.language).toBe("generic");
    expect(config.commands).toEqual({ required: [], optional: [] });
    expect(config.intent).toEqual({
      sources: ["cli", "github_pr", "linked_issue", "commits"],
      llm: "auto",
    });
    expect(config.knowledge).toEqual({
      database: ".patchdiet/knowledge.sqlite",
      languages: ["typescript", "javascript", "python"],
      rules: {
        autoDiscover: [
          "AGENTS.md",
          "CLAUDE.md",
          "GEMINI.md",
          ".github/copilot-instructions.md",
          "CONTRIBUTING.md",
        ],
      },
      history: { git: true, mergedPrs: false },
    });
    // v2 defaults differ from v1 per the plan: ddmin / ast.
    expect(config.reduction).toEqual({
      strategy: "ddmin",
      atomGranularity: "ast",
      dependencyGrouping: true,
      finalVerification: true,
      maxRuntimeMinutes: 20,
      retryFlakyTests: 2,
    });
    expect(config.verification).toEqual({
      targetedFirst: true,
      fullRequiredAtEnd: true,
    });
    expect(config.safety).toEqual({
      mode: "local",
      allow_upload: false,
      protect: ["**/migrations/**", "**/generated/**", "**/vendor/**"],
      dependencyManifests: "human-review",
      unsupportedDiff: "human-review",
    });
    expect(config.report).toEqual({
      html: true,
      markdown: true,
      githubComment: true,
      evidence: true,
      json: true,
      githubCheck: true,
    });
  });

  it("accepts agent_plan as an intent source and llm: off", () => {
    const config = loadYaml(
      [
        "version: 2",
        "base: origin/main",
        "intent:",
        "  sources:",
        "    - agent_plan",
        "  llm: off",
      ].join("\n")
    );

    expect(config.intent).toEqual({ sources: ["agent_plan"], llm: "off" });
  });

  it("preserves v1 sections (scope, intelligence, performance) alongside v2 sections", () => {
    const config = loadYaml(
      [
        "version: 2",
        "base: origin/main",
        "scope:",
        "  ignore_paths:",
        "    - dist/**",
        "  allow_format_only_removal: false",
        "  flag_dependency_bumps: false",
        "intelligence:",
        "  mode: local-only",
        "performance:",
        "  max_parallel_worktrees: 2",
        "  cache_tests: true",
      ].join("\n")
    );

    expect(config.scope).toEqual({
      ignorePaths: ["dist/**"],
      allowFormatOnlyRemoval: false,
      flagDependencyBumps: false,
    });
    expect(config.intelligence).toEqual({ mode: "local-only" });
    expect(config.performance).toEqual({
      max_parallel_worktrees: 2,
      cache_tests: true,
    });
  });
});

describe("v2 config - version validation", () => {
  it.each([
    { name: "future version 3", yaml: "version: 3\nbase: origin/main" },
    { name: "version 0", yaml: "version: 0\nbase: origin/main" },
    { name: "negative version", yaml: "version: -1\nbase: origin/main" },
    { name: "non-integer version", yaml: "version: 1.5\nbase: origin/main" },
    { name: "string version", yaml: "version: '2'\nbase: origin/main" },
  ])("rejects $name", ({ yaml }) => {
    expectYamlError(yaml, "version");
  });
});

describe("v2 config - strictness", () => {
  it("rejects unknown top-level keys in a v2 config", () => {
    expectYamlError(`${FULL_V2_YAML}\nevil_key: injected`, "evil_key");
  });

  it("rejects unknown nested keys inside intent", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "intent:",
        "  sources:",
        "    - cli",
        "  evil_key: 1",
      ].join("\n")
    );
  });

  it("rejects unknown nested keys inside knowledge", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "knowledge:",
        "  evil_key: 1",
      ].join("\n")
    );
  });

  it("rejects unknown nested keys inside verification", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "verification:",
        "  targeted_first: true",
        "  evil_key: 1",
      ].join("\n")
    );
  });

  it("rejects unknown nested keys inside v2 safety", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "safety:",
        "  protect: []",
        "  evil_key: 1",
      ].join("\n")
    );
  });

  it("rejects unknown nested keys inside v2 report", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "report:",
        "  json: true",
        "  evil_key: 1",
      ].join("\n")
    );
  });

  it("rejects unknown nested keys inside v2 reduction", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "reduction:",
        "  strategy: ddmin",
        "  evil_key: 1",
      ].join("\n")
    );
  });

  it("rejects an invalid intent source value", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "intent:",
        "  sources:",
        "    - telepathy",
      ].join("\n")
    );
  });

  it("rejects an invalid intent llm value", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "intent:",
        "  llm: always",
      ].join("\n")
    );
  });

  it("rejects an invalid v2 reduction strategy", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "reduction:",
        "  strategy: aggressive",
      ].join("\n")
    );
  });

  it("rejects an invalid v2 atom_granularity", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "reduction:",
        "  atom_granularity: line",
      ].join("\n")
    );
  });

  it("rejects blank (whitespace-only) commands", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "commands:",
        "  required:",
        "    - '   '",
      ].join("\n"),
      "commands.required"
    );
  });

  it("rejects blank commands in v1 configs too", () => {
    expectYamlError(
      [
        "version: 1",
        "base: origin/main",
        "language: generic",
        "commands:",
        "  optional:",
        "    - '\t'",
      ].join("\n")
    );
  });

  it("rejects v2 runtime/retry out of bounds", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "reduction:",
        "  max_runtime_minutes: 1441",
      ].join("\n"),
      "must be <= 1440"
    );
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "reduction:",
        "  retry_flaky_tests: 11",
      ].join("\n"),
      "must be <= 10"
    );
  });

  it("rejects an empty protect entry", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "safety:",
        "  protect:",
        "    - ''",
      ].join("\n")
    );
  });

  it("rejects a blank knowledge.database", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "knowledge:",
        "  database: '   '",
      ].join("\n")
    );
  });

  it.each([
    { name: "absolute path", database: "C:/tmp/knowledge.sqlite" },
    { name: "parent traversal", database: "../knowledge.sqlite" },
    { name: "embedded parent traversal", database: ".patchdiet/../evil.sqlite" }
  ])("rejects a knowledge.database that escapes the repo: $name", ({ database }) => {
    expectYamlError(
      ["version: 2", "base: origin/main", "knowledge:", `  database: ${JSON.stringify(database)}`].join("\n"),
      "knowledge.database"
    );
  });

  it("resolves every v2-only field to camelCase", () => {
    const config = loadYaml(FULL_V2_YAML);

    expect(config.report).not.toHaveProperty("github_check");
    expect(config.safety).not.toHaveProperty("dependency_manifests");
    expect(config.safety).not.toHaveProperty("unsupported_diff");
    expect(Object.keys(config.report)).toEqual([
      "html",
      "markdown",
      "githubComment",
      "evidence",
      "json",
      "githubCheck",
    ]);
    expect(Object.keys(config.safety)).toEqual([
      "mode",
      "allow_upload",
      "protect",
      "dependencyManifests",
      "unsupportedDiff",
    ]);
    expect(Object.keys(config.knowledge?.rules ?? {})).toEqual(["autoDiscover"]);
    expect(Object.keys(config.knowledge?.history ?? {})).toEqual(["git", "mergedPrs"]);
    expect(Object.keys(config.verification ?? {})).toEqual([
      "targetedFirst",
      "fullRequiredAtEnd",
    ]);
  });

  it("defaults protect to the plan's protected globs and languages to the plan's language list", () => {
    const config = loadYaml(["version: 2", "base: origin/main"].join("\n"));

    expect(config.safety.protect).toEqual([
      "**/migrations/**",
      "**/generated/**",
      "**/vendor/**",
    ]);
    expect(config.knowledge?.languages).toEqual(["typescript", "javascript", "python"]);
  });
});

describe("v2 config - safety hard rules", () => {
  it("rejects reduction.final_verification: false", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "reduction:",
        "  final_verification: false",
      ].join("\n"),
      "final_verification"
    );
  });

  it("rejects verification.full_required_at_end: false", () => {
    expectYamlError(
      [
        "version: 2",
        "base: origin/main",
        "verification:",
        "  targeted_first: true",
        "  full_required_at_end: false",
      ].join("\n"),
      "full_required_at_end"
    );
  });
});

describe("v2 config - load preserves resolved fields", () => {
  it("loadPatchDietConfig returns a complete resolved object, not partial data", () => {
    const config = loadYaml(
      ["version: 2", "base: origin/main", "reduction:", "  max_runtime_minutes: 5"].join("\n")
    );

    // Everything the runtime consumes must be present with explicit defaults.
    expect(config.reduction.maxRuntimeMinutes).toBe(5);
    expect(config.reduction.strategy).toBe("ddmin");
    expect(config.reduction.atomGranularity).toBe("ast");
    expect(config.reduction.dependencyGrouping).toBe(true);
    expect(config.reduction.finalVerification).toBe(true);
    expect(config.reduction.retryFlakyTests).toBe(2);
    expect(config.verification).toBeDefined();
    expect(config.intent).toBeDefined();
    expect(config.knowledge).toBeDefined();
  });
});

describe("mergeConfigWithFlags - v2 field preservation", () => {
  it("preserves v2 resolved fields while applying flags", () => {
    const config = loadYaml(FULL_V2_YAML);

    const merged = mergeConfigWithFlags(config, { base: "upstream/main", test: ["pnpm test"] });

    expect(merged.base).toBe("upstream/main");
    expect(merged.commands.required).toEqual(["pnpm test"]);
    expect(merged.intent).toEqual(config.intent);
    expect(merged.knowledge).toEqual(config.knowledge);
    expect(merged.verification).toEqual(config.verification);
    expect(merged.reduction).toEqual(config.reduction);
    expect(merged.safety).toEqual(config.safety);
    expect(merged.report).toEqual(config.report);
  });

  it("does not let an empty --test array override configured required commands", () => {
    const config = loadYaml(FULL_V2_YAML);

    const merged = mergeConfigWithFlags(config, { test: [] });

    expect(merged.commands.required).toEqual(["pnpm test", "pnpm typecheck"]);
  });
});

describe("v1 compatibility is unchanged", () => {
  it("createPresetConfig still returns v1 semantics", () => {
    const preset = createPresetConfig();

    expect(preset.version).toBe(1);
    expect(preset.reduction.strategy).toBe("conservative");
    expect(preset.reduction.atomGranularity).toBe("hunk");
    expect(preset.reduction.maxRuntimeMinutes).toBe(20);
    expect(preset.reduction.retryFlakyTests).toBe(2);
  });

  it("a v1 config still loads with v1 semantics", () => {
    const config = loadYaml(
      [
        "version: 1",
        "base: origin/main",
        "language: generic",
        "reduction:",
        "  strategy: conservative",
        "  atom_granularity: hunk",
        "  max_runtime_minutes: 10",
        "  retry_flaky_tests: 1",
      ].join("\n")
    );

    expect(config.version).toBe(1);
    expect(config.reduction.strategy).toBe("conservative");
    expect(config.reduction.atomGranularity).toBe("hunk");
    expect(config.reduction.maxRuntimeMinutes).toBe(10);
    expect(config.reduction.retryFlakyTests).toBe(1);
    expect(config.intent).toBeUndefined();
    expect(config.verification).toBeUndefined();
  });
});
