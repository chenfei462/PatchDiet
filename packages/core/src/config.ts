import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import YAML from "yaml";
import { z } from "zod";

// ── Zod schemas ───────────────────────────────────────────────────
// Uses strictObject to reject unknown fields, and semantic bounds on
// security-critical numeric fields (max runtime, retry count).
//
// Two raw schemas exist:
//  - v1 (ConfigRawV1Schema): the historical patchdiet.yaml surface.
//  - v2 (ConfigRawV2Schema): the plan's AI-change-scope-verification
//    surface (intent / knowledge / verification, ddmin+ast defaults,
//    hard safety rules).
// Both resolve to the same camelCase PatchDietConfig shape; the v2-only
// resolved sections are optional on the type so hand-written config
// objects (existing tests) still typecheck, while load/preset always
// return them fully populated for their version.

const nonBlank = (message: string) => z.string().min(1, message).regex(/\S/, "must not be blank");

const V1_COMMANDS = {
  required: z.array(nonBlank("command must not be empty")).default([]),
  optional: z.array(nonBlank("command must not be empty")).default([]),
};

const SCOPE_RAW = {
  ignore_paths: z.array(nonBlank("path must not be empty")).default([]),
  allow_format_only_removal: z.boolean().optional(),
  flag_dependency_bumps: z.boolean().optional(),
};

const INTELLIGENCE_RAW = {
  mode: z.string().optional(),
};

const PERFORMANCE_RAW = {
  max_parallel_worktrees: z.number().int().min(1).optional(),
  cache_tests: z.boolean().optional(),
};

// Hard safety rules: these fields exist precisely so the runtime cannot
// skip final verification; disabling them is a config error, not a flag.
const mustBeTrue = z.boolean().refine((v) => v === true, "must be true (cannot be disabled)");

const ConfigRawV1Schema = z.strictObject({
  version: z.literal(1).optional(),
  base: nonBlank("must not be empty"),
  language: nonBlank("must not be empty"),
  commands: z.strictObject(V1_COMMANDS).optional(),
  reduction: z
    .strictObject({
      strategy: z.literal("conservative").optional(),
      atom_granularity: z.literal("hunk").optional(),
      max_runtime_minutes: z.number().int().min(1).max(1440, "must be <= 1440 (24h)"),
      retry_flaky_tests: z.number().int().min(0).max(10, "must be <= 10"),
    })
    .optional(),
  scope: z.strictObject(SCOPE_RAW).optional(),
  report: z
    .strictObject({
      html: z.boolean().optional(),
      markdown: z.boolean().optional(),
      github_comment: z.boolean().optional(),
    })
    .optional(),
  safety: z
    .strictObject({
      mode: z.literal("local").optional(),
      allow_upload: z.boolean().optional(),
    })
    .optional(),
  intelligence: z.strictObject(INTELLIGENCE_RAW).optional(),
  performance: z.strictObject(PERFORMANCE_RAW).optional(),
});

const ConfigRawV2Schema = z.strictObject({
  version: z.literal(2),
  base: nonBlank("must not be empty"),
  language: nonBlank("must not be empty").optional(),
  commands: z.strictObject(V1_COMMANDS).optional(),
  intent: z
    .strictObject({
      sources: z
        .array(z.enum(["cli", "github_pr", "linked_issue", "commits", "agent_plan"]))
        .optional(),
      llm: z.enum(["auto", "off"]).optional(),
    })
    .optional(),
  knowledge: z
    .strictObject({
      database: nonBlank("must not be empty").optional(),
      languages: z.array(nonBlank("language must not be empty")).optional(),
      rules: z
        .strictObject({
          auto_discover: z.array(nonBlank("path must not be empty")).optional(),
        })
        .optional(),
      history: z
        .strictObject({
          git: z.boolean().optional(),
          merged_prs: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  reduction: z
    .strictObject({
      strategy: z.enum(["conservative", "ddmin"]).optional(),
      atom_granularity: z.enum(["hunk", "ast"]).optional(),
      dependency_grouping: z.boolean().optional(),
      final_verification: mustBeTrue.optional(),
      max_runtime_minutes: z.number().int().min(1).max(1440, "must be <= 1440 (24h)").optional(),
      retry_flaky_tests: z.number().int().min(0).max(10, "must be <= 10").optional(),
    })
    .optional(),
  verification: z
    .strictObject({
      targeted_first: z.boolean().optional(),
      full_required_at_end: mustBeTrue.optional(),
    })
    .optional(),
  safety: z
    .strictObject({
      mode: z.literal("local").optional(),
      allow_upload: z.boolean().optional(),
      protect: z.array(nonBlank("protect path must not be empty")).optional(),
      dependency_manifests: z.literal("human-review").optional(),
      unsupported_diff: z.literal("human-review").optional(),
    })
    .optional(),
  report: z
    .strictObject({
      html: z.boolean().optional(),
      markdown: z.boolean().optional(),
      github_comment: z.boolean().optional(),
      evidence: z.boolean().optional(),
      json: z.boolean().optional(),
      github_check: z.boolean().optional(),
    })
    .optional(),
  scope: z.strictObject(SCOPE_RAW).optional(),
  intelligence: z.strictObject(INTELLIGENCE_RAW).optional(),
  performance: z.strictObject(PERFORMANCE_RAW).optional(),
});

// ── Resolved shape ────────────────────────────────────────────────

const PatchDietConfigSchema = z.strictObject({
  version: z.number().int().min(1),
  base: z.string().min(1, "must not be empty"),
  language: z.string().min(1, "must not be empty"),
  commands: z.strictObject(V1_COMMANDS),
  reduction: z.strictObject({
    strategy: z.enum(["conservative", "ddmin"]),
    atomGranularity: z.enum(["hunk", "ast"]),
    maxRuntimeMinutes: z.number().int().min(1).max(1440, "must be <= 1440 (24h)"),
    retryFlakyTests: z.number().int().min(0).max(10, "must be <= 10"),
    dependencyGrouping: z.boolean().optional(),
    finalVerification: z.boolean().optional(),
  }),
  scope: z.strictObject({
    ignorePaths: z.array(z.string().min(1, "path must not be empty")).default([]),
    allowFormatOnlyRemoval: z.boolean(),
    flagDependencyBumps: z.boolean(),
  }),
  report: z.strictObject({
    html: z.boolean(),
    markdown: z.boolean(),
    githubComment: z.boolean(),
    evidence: z.boolean().optional(),
    json: z.boolean().optional(),
    githubCheck: z.boolean().optional(),
  }),
  safety: z.strictObject({
    mode: z.literal("local").optional(),
    allow_upload: z.boolean().optional(),
    protect: z.array(z.string().min(1, "protect path must not be empty")).optional(),
    dependencyManifests: z.literal("human-review").optional(),
    unsupportedDiff: z.literal("human-review").optional(),
  }),
  intelligence: z.strictObject({
    mode: z.string().optional(),
  }),
  performance: z.strictObject({
    max_parallel_worktrees: z.number().int().min(1).optional(),
    cache_tests: z.boolean().optional(),
  }),
  intent: z
    .strictObject({
      sources: z.array(z.enum(["cli", "github_pr", "linked_issue", "commits", "agent_plan"])),
      llm: z.enum(["auto", "off"]),
    })
    .optional(),
  knowledge: z
    .strictObject({
      database: z.string().min(1),
      languages: z.array(z.string().min(1)),
      rules: z.strictObject({
        autoDiscover: z.array(z.string().min(1)),
      }),
      history: z.strictObject({
        git: z.boolean(),
        mergedPrs: z.boolean(),
      }),
    })
    .optional(),
  verification: z
    .strictObject({
      targetedFirst: z.boolean(),
      // The raw schema rejects `false`; the resolved type stays boolean so
      // consumers can branch on it, but every load path yields true.
      fullRequiredAtEnd: z.boolean(),
    })
    .optional(),
});

export type PatchDietConfig = z.infer<typeof PatchDietConfigSchema>;

// ── Public helpers ────────────────────────────────────────────────

/** Returns a fully-populated v1 config with default values. */
export function createPresetConfig(): PatchDietConfig {
  return defaultConfig();
}

/** Load and validate a patchdiet.yaml from the given working directory.
 * Returns defaults when the file is absent or empty, throws on validation
 * failure (unknown fields, out-of-bounds values, empty strings, etc.).
 * Version 2 configs resolve to the same camelCase shape plus the v2-only
 * sections (intent / knowledge / verification, expanded safety and report). */
export function loadPatchDietConfig(cwd: string): PatchDietConfig {
  const defaults = defaultConfig();
  const configPath = join(cwd, "patchdiet.yaml");

  if (!existsSync(configPath)) {
    return defaults;
  }

  const raw = YAML.parse(readFileSync(configPath, "utf8")) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const requestedVersion = raw.version ?? 1;
  if (requestedVersion !== 1 && requestedVersion !== 2) {
    throw new Error(
      `Invalid patchdiet.yaml:\n${configPath}: version: only 1 or 2 is supported (got ${JSON.stringify(requestedVersion)})`
    );
  }

  const schema = requestedVersion === 2 ? ConfigRawV2Schema : ConfigRawV1Schema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => {
      const path = i.path.map((p) => String(p)).join(".");
      return `${configPath}: ${path}: ${i.message}`;
    });
    throw new Error(`Invalid patchdiet.yaml:\n${messages.join("\n")}`);
  }

  const p = parsed.data;

  // Shared v1-compatible sections (both versions fill these from defaults).
  const shared = {
    base: p.base ?? defaults.base,
    language: p.language ?? defaults.language,
    commands: {
      required: p.commands?.required ?? defaults.commands.required,
      optional: p.commands?.optional ?? defaults.commands.optional,
    },
    scope: {
      ignorePaths: p.scope?.ignore_paths ?? defaults.scope.ignorePaths,
      allowFormatOnlyRemoval:
        p.scope?.allow_format_only_removal ?? defaults.scope.allowFormatOnlyRemoval,
      flagDependencyBumps: p.scope?.flag_dependency_bumps ?? defaults.scope.flagDependencyBumps,
    },
    intelligence: {
      mode: p.intelligence?.mode ?? defaults.intelligence.mode,
    },
    performance: {
      max_parallel_worktrees:
        p.performance?.max_parallel_worktrees ?? defaults.performance.max_parallel_worktrees,
      cache_tests: p.performance?.cache_tests ?? defaults.performance.cache_tests,
    },
  };

  if (requestedVersion === 2) {
    const v2 = p as z.infer<typeof ConfigRawV2Schema>;

    // knowledge.database must stay inside the repository: reject absolute
    // paths and any ".." segment. The CLI additionally resolves the value
    // and re-checks containment before opening the database.
    const database = v2.knowledge?.database;
    if (
      database !== undefined &&
      (isAbsolute(database) || database.split(/[\\/]/).includes(".."))
    ) {
      throw new Error(
        `Invalid patchdiet.yaml:\n${configPath}: knowledge.database: must be a repo-local relative path (no absolute paths or "..")`
      );
    }

    return {
      version: 2,
      ...shared,
      reduction: {
        strategy: v2.reduction?.strategy ?? "ddmin",
        atomGranularity: v2.reduction?.atom_granularity ?? "ast",
        dependencyGrouping: v2.reduction?.dependency_grouping ?? true,
        // Hard safety rule: enforced true by the schema when present.
        finalVerification: v2.reduction?.final_verification ?? true,
        maxRuntimeMinutes: v2.reduction?.max_runtime_minutes ?? defaults.reduction.maxRuntimeMinutes,
        retryFlakyTests: v2.reduction?.retry_flaky_tests ?? defaults.reduction.retryFlakyTests,
      },
      verification: {
        targetedFirst: v2.verification?.targeted_first ?? true,
        fullRequiredAtEnd: v2.verification?.full_required_at_end ?? true,
      },
      report: {
        html: v2.report?.html ?? true,
        markdown: v2.report?.markdown ?? true,
        githubComment: v2.report?.github_comment ?? true,
        evidence: v2.report?.evidence ?? true,
        json: v2.report?.json ?? true,
        githubCheck: v2.report?.github_check ?? true,
      },
      safety: {
        mode: v2.safety?.mode ?? defaults.safety.mode,
        allow_upload: v2.safety?.allow_upload ?? defaults.safety.allow_upload,
        protect:
          v2.safety?.protect ?? ["**/migrations/**", "**/generated/**", "**/vendor/**"],
        dependencyManifests: v2.safety?.dependency_manifests ?? "human-review",
        unsupportedDiff: v2.safety?.unsupported_diff ?? "human-review",
      },
      intent: {
        sources: v2.intent?.sources ?? ["cli", "github_pr", "linked_issue", "commits"],
        llm: v2.intent?.llm ?? "auto",
      },
      knowledge: {
        database: v2.knowledge?.database ?? ".patchdiet/knowledge.sqlite",
        languages: v2.knowledge?.languages ?? ["typescript", "javascript", "python"],
        rules: {
          autoDiscover:
            v2.knowledge?.rules?.auto_discover ?? [
              "AGENTS.md",
              "CLAUDE.md",
              "GEMINI.md",
              ".github/copilot-instructions.md",
              "CONTRIBUTING.md",
            ],
        },
        history: {
          git: v2.knowledge?.history?.git ?? true,
          mergedPrs: v2.knowledge?.history?.merged_prs ?? false,
        },
      },
    };
  }

  const v1 = p as z.infer<typeof ConfigRawV1Schema>;
  return {
    version: 1,
    ...shared,
    reduction: {
      strategy: v1.reduction?.strategy ?? defaults.reduction.strategy,
      atomGranularity: v1.reduction?.atom_granularity ?? defaults.reduction.atomGranularity,
      maxRuntimeMinutes: v1.reduction?.max_runtime_minutes ?? defaults.reduction.maxRuntimeMinutes,
      retryFlakyTests: v1.reduction?.retry_flaky_tests ?? defaults.reduction.retryFlakyTests,
    },
    report: {
      html: v1.report?.html ?? defaults.report.html,
      markdown: v1.report?.markdown ?? defaults.report.markdown,
      githubComment: v1.report?.github_comment ?? defaults.report.githubComment,
    },
    safety: {
      mode: v1.safety?.mode ?? defaults.safety.mode,
      allow_upload: v1.safety?.allow_upload ?? defaults.safety.allow_upload,
    },
  };
}

/** Merge CLI flags over an already-resolved config. */
export function mergeConfigWithFlags(
  config: PatchDietConfig,
  flags: { base?: string; test?: string[] }
): PatchDietConfig {
  return {
    ...config,
    base: flags.base ?? config.base,
    commands: {
      ...config.commands,
      // P0-1: only a non-empty explicit --test list may override the config; an
      // empty array (e.g. an omitted Commander flag defaulting to []) must never
      // shadow commands.required from patchdiet.yaml.
      required:
        flags.test !== undefined && flags.test.length > 0 ? flags.test : config.commands.required,
    },
  };
}

// ── Defaults ──────────────────────────────────────────────────────

function defaultConfig(): PatchDietConfig {
  return {
    version: 1,
    base: "origin/main",
    language: "generic",
    commands: { required: [], optional: [] },
    reduction: {
      strategy: "conservative",
      atomGranularity: "hunk",
      maxRuntimeMinutes: 20,
      retryFlakyTests: 2,
    },
    scope: {
      ignorePaths: [],
      allowFormatOnlyRemoval: true,
      flagDependencyBumps: true,
    },
    report: { html: true, markdown: true, githubComment: true },
    safety: { mode: "local", allow_upload: false },
    intelligence: { mode: "local-only" },
    performance: { max_parallel_worktrees: 1, cache_tests: false },
  };
}
