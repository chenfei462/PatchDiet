import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadPatchDietConfig, createPresetConfig, mergeConfigWithFlags } from "../../packages/core/src/config.js";

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
        "  max_runtime_minutes: 7",
        "  retry_flaky_tests: 3",
        "scope:",
        "  ignore_paths:",
        "    - dist/**"
      ].join("\n")
    );

    const config = loadPatchDietConfig(dir);

    expect(config.base).toBe("upstream/main");
    expect(config.language).toBe("python");
    expect(config.commands.required).toEqual(["npm test"]);
    expect(config.reduction.maxRuntimeMinutes).toBe(7);
    expect(config.reduction.retryFlakyTests).toBe(3);
    expect(config.scope.ignorePaths).toEqual(["dist/**"]);
  });
});

describe("schema validation - security boundaries", () => {
  it("throws when max_runtime_minutes exceeds 1440", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "patchdiet.yaml"),
      [
        "base: origin/main",
        "language: generic",
        "reduction:",
        "  strategy: conservative",
        "  max_runtime_minutes: 99999",
        "  retry_flaky_tests: 0"
      ].join("\n")
    );

    expect(() => loadPatchDietConfig(dir)).toThrow("must be <= 1440");
  });

  it("throws when max_runtime_minutes is zero", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "patchdiet.yaml"),
      [
        "base: origin/main",
        "language: generic",
        "reduction:",
        "  strategy: conservative",
        "  max_runtime_minutes: 0",
        "  retry_flaky_tests: 0"
      ].join("\n")
    );

    expect(() => loadPatchDietConfig(dir)).toThrow();
  });

  it("throws when retry_flaky_tests exceeds 10", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "patchdiet.yaml"),
      [
        "base: origin/main",
        "language: generic",
        "reduction:",
        "  strategy: conservative",
        "  max_runtime_minutes: 10",
        "  retry_flaky_tests: 99"
      ].join("\n")
    );

    expect(() => loadPatchDietConfig(dir)).toThrow("must be <= 10");
  });

  it("throws when a required command is empty string", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "patchdiet.yaml"),
      [
        "base: origin/main",
        "language: generic",
        "commands:",
        "  required:",
        "    - ''",
        "    - npm test"
      ].join("\n")
    );

    expect(() => loadPatchDietConfig(dir)).toThrow("command must not be empty");
  });

  it("throws on unknown top-level key", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "patchdiet.yaml"),
      [
        "base: origin/main",
        "language: generic",
        "evil_key: injected"
      ].join("\n")
    );

    expect(() => loadPatchDietConfig(dir)).toThrow();
  });

  it("throws on unknown reduction key", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "patchdiet.yaml"),
      [
        "base: origin/main",
        "language: generic",
        "reduction:",
        "  strategy: conservative",
        "  max_runtime_minutes: 10",
        "  retry_flaky_tests: 0",
        "  evil_key: injected"
      ].join("\n")
    );

    expect(() => loadPatchDietConfig(dir)).toThrow();
  });
});

describe("createPresetConfig", () => {
  it("returns valid default config", () => {
    const config = createPresetConfig();
    expect(config.base).toBe("origin/main");
    expect(config.reduction.maxRuntimeMinutes).toBe(20);
    expect(config.reduction.retryFlakyTests).toBe(2);
    expect(config.scope.allowFormatOnlyRemoval).toBe(true);
    expect(config.scope.flagDependencyBumps).toBe(true);
  });
});

// ── Table-driven validation matrix (review M8) ───────────────────────
// Every branch of the zod schemas in config.ts: required fields, numeric
// bounds (including exact boundaries), empty strings, and unknown keys at
// every nesting level. All cases must throw with the "Invalid patchdiet.yaml"
// header and name the offending field path.

function writeConfigFile(dir: string, yaml: string): void {
  writeFileSync(join(dir, "patchdiet.yaml"), yaml, "utf8");
}

/** Valid snake_case yaml; cases below override or append fields. */
const VALID_YAML = [
  "version: 1",
  "base: origin/main",
  "language: generic",
  "commands:",
  "  required:",
  "    - npm test",
  "  optional:",
  "    - npm run lint",
  "reduction:",
  "  strategy: conservative",
  "  atom_granularity: hunk",
  "  max_runtime_minutes: 20",
  "  retry_flaky_tests: 2",
  "scope:",
  "  ignore_paths: []",
  "  allow_format_only_removal: true",
  "  flag_dependency_bumps: true",
  "report:",
  "  html: true",
  "  markdown: true",
  "  github_comment: true",
  "safety:",
  "  mode: local",
  "  allow_upload: false",
  "intelligence:",
  "  mode: local-only",
  "performance:",
  "  max_parallel_worktrees: 1",
  "  cache_tests: false"
].join("\n");

function yamlWithPatch(search: string, replacement: string): string {
  if (!VALID_YAML.includes(search)) {
    throw new Error(`test bug: snippet not found in VALID_YAML: ${search}`);
  }
  return VALID_YAML.replace(search, replacement);
}

interface InvalidConfigCase {
  name: string;
  yaml: string;
  /** Field path that must appear in the thrown validation error. */
  errorPath?: string;
}

const INVALID_CONFIG_CASES: InvalidConfigCase[] = [
  // Required fields missing entirely.
  { name: "missing base", yaml: yamlWithPatch("base: origin/main\n", ""), errorPath: "base" },
  { name: "missing language", yaml: yamlWithPatch("language: generic\n", ""), errorPath: "language" },
  {
    name: "reduction present but max_runtime_minutes missing",
    yaml: yamlWithPatch("  max_runtime_minutes: 20\n", ""),
    errorPath: "reduction.max_runtime_minutes"
  },
  {
    name: "reduction present but retry_flaky_tests missing",
    yaml: yamlWithPatch("  retry_flaky_tests: 2\n", ""),
    errorPath: "reduction.retry_flaky_tests"
  },

  // Numeric out-of-range (outside the bounds).
  { name: "version below 1", yaml: yamlWithPatch("version: 1", "version: 0"), errorPath: "version" },
  { name: "version non-integer", yaml: yamlWithPatch("version: 1", "version: 1.5"), errorPath: "version" },
  { name: "version negative", yaml: yamlWithPatch("version: 1", "version: -3"), errorPath: "version" },
  {
    name: "max_runtime_minutes zero",
    yaml: yamlWithPatch("max_runtime_minutes: 20", "max_runtime_minutes: 0"),
    errorPath: "reduction.max_runtime_minutes"
  },
  {
    name: "max_runtime_minutes above 1440",
    yaml: yamlWithPatch("max_runtime_minutes: 20", "max_runtime_minutes: 1441"),
    errorPath: "reduction.max_runtime_minutes"
  },
  {
    name: "retry_flaky_tests negative",
    yaml: yamlWithPatch("retry_flaky_tests: 2", "retry_flaky_tests: -1"),
    errorPath: "reduction.retry_flaky_tests"
  },
  {
    name: "retry_flaky_tests above 10",
    yaml: yamlWithPatch("retry_flaky_tests: 2", "retry_flaky_tests: 11"),
    errorPath: "reduction.retry_flaky_tests"
  },
  {
    name: "max_parallel_worktrees zero",
    yaml: yamlWithPatch("max_parallel_worktrees: 1", "max_parallel_worktrees: 0"),
    errorPath: "performance.max_parallel_worktrees"
  },
  {
    name: "max_parallel_worktrees non-integer",
    yaml: yamlWithPatch("max_parallel_worktrees: 1", "max_parallel_worktrees: 1.5"),
    errorPath: "performance.max_parallel_worktrees"
  },

  // Empty-string values.
  { name: "empty base", yaml: yamlWithPatch("base: origin/main", 'base: ""'), errorPath: "base" },
  { name: "empty language", yaml: yamlWithPatch("language: generic", 'language: ""'), errorPath: "language" },
  {
    name: "empty required command",
    yaml: yamlWithPatch("    - npm test", "    - ''"),
    errorPath: "commands.required"
  },
  {
    name: "empty optional command",
    yaml: yamlWithPatch("    - npm run lint", "    - ''"),
    errorPath: "commands.optional"
  },
  {
    name: "empty ignore_paths entry",
    yaml: yamlWithPatch("  ignore_paths: []", "  ignore_paths:\n    - ''"),
    errorPath: "scope.ignore_paths"
  },

  // Unknown keys at every nesting level (strictObject).
  { name: "unknown top-level key", yaml: `${VALID_YAML}\nevil_key: injected`, errorPath: "evil_key" },
  {
    name: "unknown commands key",
    yaml: yamlWithPatch("  optional:\n    - npm run lint", "  optional:\n    - npm run lint\n  evil_key: 1"),
    errorPath: 'commands: Unrecognized key'
  },
  {
    name: "unknown reduction key",
    yaml: yamlWithPatch("  retry_flaky_tests: 2", "  retry_flaky_tests: 2\n  evil_key: 1"),
    errorPath: 'reduction: Unrecognized key'
  },
  {
    name: "unknown scope key",
    yaml: yamlWithPatch("  flag_dependency_bumps: true", "  flag_dependency_bumps: true\n  evil_key: 1"),
    errorPath: 'scope: Unrecognized key'
  },
  {
    name: "unknown report key",
    yaml: yamlWithPatch("  github_comment: true", "  github_comment: true\n  evil_key: 1"),
    errorPath: 'report: Unrecognized key'
  },
  {
    name: "unknown safety key",
    yaml: yamlWithPatch("  allow_upload: false", "  allow_upload: false\n  evil_key: 1"),
    errorPath: 'safety: Unrecognized key'
  },
  {
    name: "unknown intelligence key",
    yaml: yamlWithPatch("  mode: local-only", "  mode: local-only\n  evil_key: 1"),
    errorPath: 'intelligence: Unrecognized key'
  },
  {
    name: "unknown performance key",
    yaml: yamlWithPatch("  cache_tests: false", "  cache_tests: false\n  evil_key: 1"),
    errorPath: 'performance: Unrecognized key'
  },

  // Wrong types.
  { name: "base not a string", yaml: yamlWithPatch("base: origin/main", "base: 123"), errorPath: "base" },
  {
    name: "max_runtime_minutes not a number",
    yaml: yamlWithPatch("max_runtime_minutes: 20", 'max_runtime_minutes: "20"'),
    errorPath: "reduction.max_runtime_minutes"
  },
  {
    name: "commands not an object",
    yaml: yamlWithPatch(
      "commands:\n  required:\n    - npm test\n  optional:\n    - npm run lint",
      "commands: npm test"
    ),
    errorPath: "commands"
  },

  // A yaml array is an object but not a valid mapping.
  { name: "yaml array instead of mapping", yaml: "- just\n- an\n- array\n", errorPath: undefined }
];

describe("patchdiet.yaml validation matrix", () => {
  it.each(INVALID_CONFIG_CASES)("rejects: $name", (testCase: InvalidConfigCase) => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-invalid-"));
    tempDirs.push(dir);
    writeConfigFile(dir, testCase.yaml);

    expect(() => loadPatchDietConfig(dir)).toThrow("Invalid patchdiet.yaml");
    if (testCase.errorPath) {
      expect(() => loadPatchDietConfig(dir)).toThrow(testCase.errorPath);
    }
  });

  it.each([
    { name: "min max_runtime_minutes 1", yaml: yamlWithPatch("max_runtime_minutes: 20", "max_runtime_minutes: 1") },
    { name: "max max_runtime_minutes 1440", yaml: yamlWithPatch("max_runtime_minutes: 20", "max_runtime_minutes: 1440") },
    { name: "min retry_flaky_tests 0", yaml: yamlWithPatch("retry_flaky_tests: 2", "retry_flaky_tests: 0") },
    { name: "max retry_flaky_tests 10", yaml: yamlWithPatch("retry_flaky_tests: 2", "retry_flaky_tests: 10") },
    { name: "version 1", yaml: VALID_YAML }
  ])("accepts boundary value: $name", (testCase: { name: string; yaml: string }) => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-valid-"));
    tempDirs.push(dir);
    writeConfigFile(dir, testCase.yaml);

    expect(() => loadPatchDietConfig(dir)).not.toThrow();
  });
});

describe("patchdiet.yaml round-trip and defaulting", () => {
  it("returns exactly the values written to a fully-specified patchdiet.yaml", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-roundtrip-"));
    tempDirs.push(dir);
    writeConfigFile(dir, VALID_YAML);

    const config = loadPatchDietConfig(dir);

    // One assertion over every field: what comes back must match what was
    // written (with the documented snake_case → camelCase translation).
    expect(config).toEqual({
      version: 1,
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
      report: { html: true, markdown: true, githubComment: true },
      safety: { mode: "local", allow_upload: false },
      intelligence: { mode: "local-only" },
      performance: { max_parallel_worktrees: 1, cache_tests: false }
    });
  });

  it("fills unspecified sections with defaults when only a few fields are set", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-partial-"));
    tempDirs.push(dir);
    writeConfigFile(
      dir,
      ["base: upstream/main", "language: python", "reduction:", "  max_runtime_minutes: 5", "  retry_flaky_tests: 1"].join("\n")
    );

    const config = loadPatchDietConfig(dir);
    const defaults = createPresetConfig();

    expect(config.version).toBe(defaults.version);
    expect(config.base).toBe("upstream/main");
    expect(config.language).toBe("python");
    expect(config.reduction.maxRuntimeMinutes).toBe(5);
    expect(config.reduction.retryFlakyTests).toBe(1);
    expect(config.reduction.strategy).toBe(defaults.reduction.strategy);
    expect(config.reduction.atomGranularity).toBe(defaults.reduction.atomGranularity);
    expect(config.commands).toEqual(defaults.commands);
    expect(config.scope).toEqual(defaults.scope);
    expect(config.report).toEqual(defaults.report);
    expect(config.safety).toEqual(defaults.safety);
    expect(config.intelligence).toEqual(defaults.intelligence);
    expect(config.performance).toEqual(defaults.performance);
  });

  it.each([
    { name: "empty file", yaml: "" },
    { name: "file with only whitespace", yaml: "\n  \n" },
    { name: "scalar document", yaml: "just-a-string\n" },
    { name: "numeric document", yaml: "42\n" }
  ])("falls back to defaults for a degenerate yaml document: $name", (testCase: { name: string; yaml: string }) => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-config-degenerate-"));
    tempDirs.push(dir);
    writeConfigFile(dir, testCase.yaml);

    expect(loadPatchDietConfig(dir)).toEqual(createPresetConfig());
  });
});
// ── P0-1: an explicitly passed empty --test list must not shadow YAML ──

describe("P0-1 mergeConfigWithFlags empty-array precedence", () => {
  it("does not let an empty test array shadow config.commands.required", () => {
    const base = createPresetConfig();
    base.commands.required = ["pnpm test"];

    const merged = mergeConfigWithFlags(base, { test: [] });

    expect(merged.commands.required).toEqual(["pnpm test"]);
  });

  it("still applies a non-empty test override", () => {
    const base = createPresetConfig();
    base.commands.required = ["pnpm test"];

    const merged = mergeConfigWithFlags(base, { test: ["npm test"] });

    expect(merged.commands.required).toEqual(["npm test"]);
  });

  it("keeps config.commands.required when no test flag is provided", () => {
    const base = createPresetConfig();
    base.commands.required = ["pnpm test"];

    const merged = mergeConfigWithFlags(base, {});

    expect(merged.commands.required).toEqual(["pnpm test"]);
  });
});
