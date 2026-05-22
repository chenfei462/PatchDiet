import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import YAML from "yaml";

export interface PatchDietConfig {
  base: string;
  language: string;
  commands: {
    required: string[];
    optional: string[];
  };
  reduction: {
    strategy: "conservative";
    atomGranularity: "hunk";
    maxRuntimeMinutes: number;
    retryFlakyTests: number;
  };
  scope: {
    ignorePaths: string[];
    allowFormatOnlyRemoval: boolean;
    flagDependencyBumps: boolean;
  };
  report: {
    html: boolean;
    markdown: boolean;
    githubComment: boolean;
  };
}

export interface ConfigFlags {
  base?: string;
  test?: string[];
  lint?: string[];
  typecheck?: string[];
}

export interface ResolvedCommands {
  required: string[];
  optional: string[];
}

export function loadPatchDietConfig(cwd: string): PatchDietConfig {
  const defaults = defaultConfig();
  const configPath = join(cwd, "patchdiet.yaml");

  if (!existsSync(configPath)) {
    return defaults;
  }

  const raw = YAML.parse(readFileSync(configPath, "utf8")) as Record<string, unknown> | null;
  if (!raw) {
    return defaults;
  }

  return {
    base: asString(raw.base) ?? defaults.base,
    language: asString(raw.language) ?? defaults.language,
    commands: {
      required: asStringArray(raw.commands, "required") ?? defaults.commands.required,
      optional: asStringArray(raw.commands, "optional") ?? defaults.commands.optional
    },
    reduction: {
      strategy: "conservative",
      atomGranularity: "hunk",
      maxRuntimeMinutes: asNumber(raw.reduction, "max_runtime_minutes") ?? defaults.reduction.maxRuntimeMinutes,
      retryFlakyTests: asNumber(raw.reduction, "retry_flaky_tests") ?? defaults.reduction.retryFlakyTests
    },
    scope: {
      ignorePaths: asStringArray(raw.scope, "ignore_paths") ?? defaults.scope.ignorePaths,
      allowFormatOnlyRemoval: asBoolean(raw.scope, "allow_format_only_removal") ?? defaults.scope.allowFormatOnlyRemoval,
      flagDependencyBumps: asBoolean(raw.scope, "flag_dependency_bumps") ?? defaults.scope.flagDependencyBumps
    },
    report: {
      html: asBoolean(raw.report, "html") ?? defaults.report.html,
      markdown: asBoolean(raw.report, "markdown") ?? defaults.report.markdown,
      githubComment: asBoolean(raw.report, "github_comment") ?? defaults.report.githubComment
    }
  };
}

export function mergeConfigWithFlags(
  config: PatchDietConfig,
  flags: ConfigFlags,
  detectedCommands?: ResolvedCommands
): PatchDietConfig {
  const explicitOptional = nonEmptyCommands([...(flags.lint ?? []), ...(flags.typecheck ?? [])]);

  return {
    ...config,
    base: flags.base ?? config.base,
    commands: {
      ...config.commands,
      required: resolveCommandList(
        flags.test,
        config.commands.required,
        detectedCommands?.required
      ),
      optional: resolveCommandList(
        explicitOptional,
        config.commands.optional,
        detectedCommands?.optional
      )
    }
  };
}

function defaultConfig(): PatchDietConfig {
  return {
    base: "origin/main",
    language: "generic",
    commands: {
      required: [],
      optional: []
    },
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
  };
}

function resolveCommandList(...candidates: Array<string[] | undefined>): string[] {
  for (const candidate of candidates) {
    const commands = nonEmptyCommands(candidate);
    if (commands) {
      return commands;
    }
  }

  return [];
}

function nonEmptyCommands(commands: string[] | undefined): string[] | undefined {
  return Array.isArray(commands) && commands.length > 0 ? commands : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(parent: unknown, key: string): string[] | undefined {
  if (!parent || typeof parent !== "object") {
    return undefined;
  }

  const value = (parent as Record<string, unknown>)[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function asNumber(parent: unknown, key: string): number | undefined {
  if (!parent || typeof parent !== "object") {
    return undefined;
  }

  const value = (parent as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(parent: unknown, key: string): boolean | undefined {
  if (!parent || typeof parent !== "object") {
    return undefined;
  }

  const value = (parent as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}
