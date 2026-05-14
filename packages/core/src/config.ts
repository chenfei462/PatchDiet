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
      maxRuntimeMinutes: defaults.reduction.maxRuntimeMinutes,
      retryFlakyTests: defaults.reduction.retryFlakyTests
    },
    scope: {
      ignorePaths: asStringArray(raw.scope, "ignore_paths") ?? defaults.scope.ignorePaths,
      allowFormatOnlyRemoval: defaults.scope.allowFormatOnlyRemoval,
      flagDependencyBumps: defaults.scope.flagDependencyBumps
    },
    report: {
      html: defaults.report.html,
      markdown: defaults.report.markdown,
      githubComment: defaults.report.githubComment
    }
  };
}

export function mergeConfigWithFlags(
  config: PatchDietConfig,
  flags: ConfigFlags
): PatchDietConfig {
  return {
    ...config,
    base: flags.base ?? config.base,
    commands: {
      ...config.commands,
      required: flags.test ?? config.commands.required
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
