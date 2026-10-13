import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { ruleId } from "./ids.js";
import type { RepositoryRule, RuleDiscoveryResult, RuleSource } from "./types.js";

/**
 * Files that commonly carry agent/project instructions. Discovery is
 * conservative: only these names are read, and only for provenance/rule
 * extraction — the text is never executed or treated as an instruction to any
 * automated agent.
 */
export const DEFAULT_RULE_FILES: readonly string[] = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".github/copilot-instructions.md",
  "CONTRIBUTING.md"
];

export interface DiscoverRulesOptions {
  /** Absolute repo root to read from. When omitted, no filesystem read happens. */
  root?: string;
  /** Additional glob-shaped protected paths from config (safety.protect / scope). */
  protectedPatterns?: string[];
  /** Overrides the default instruction-file list. */
  files?: readonly string[];
}

/** A glob matcher supporting `**`, `*` and `?`, anchored to the whole path. */
export function globMatches(pattern: string, path: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const normalizedPath = path.replaceAll("\\", "/");

  let out = "";
  let i = 0;
  while (i < normalizedPattern.length) {
    const char = normalizedPattern[i];
    if (char === "*") {
      if (normalizedPattern[i + 1] === "*") {
        if (normalizedPattern[i + 2] === "/") {
          // `**/` matches zero or more leading path segments.
          out += "(?:.*/)?";
          i += 3;
          continue;
        }
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }

  return new RegExp(`^${out}$`).test(normalizedPath);
}

/** True when any protected pattern matches the given path. */
export function pathIsProtected(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => globMatches(pattern, path));
}

/** Extract path-scoped protection rules from repository rule prose. */
export function extractRulesFromText(sourceId: string, path: string, text: string): RepositoryRule[] {
  const rules: RepositoryRule[] = [];
  const lines = text.split(/\r?\n/);

  // 1. Explicit `protect:` / `do not modify` style glob bullets.
  const protectedGlob = /(?:^|\s)(?:protect|protected|do not (?:modify|change|delete)|must not (?:modify|change|delete))[:\s]+`?([^\s`]+)`?/i;
  for (const line of lines) {
    const match = line.match(protectedGlob);
    if (match?.[1]) {
      const pattern = match[1];
      rules.push({
        id: ruleId(path, "path-protect", `${line.trim()}`),
        sourceId,
        path,
        kind: "path-protect",
        scopePattern: pattern,
        text: line.trim(),
        reliability: "medium"
      });
    }
  }

  // 2. Invariant / must-preserve statements. These are informational: they can
  //    raise an atom to `protected` only via a traceable path rule, never by
  //    prose alone silently deleting anything.
  const invariantPattern = /\b(must preserve|must remain|invariant|never remove|always keep)\b/i;
  for (const line of lines) {
    if (invariantPattern.test(line)) {
      rules.push({
        id: ruleId(path, "invariant", line.trim()),
        sourceId,
        path,
        kind: "invariant",
        text: line.trim(),
        reliability: "medium"
      });
    }
  }

  return rules;
}

/**
 * Discover repository rules from the conventional instruction files plus any
 * explicitly configured protected patterns. Read-only: it never writes and
 * never executes anything it reads.
 */
export function discoverRules(options: DiscoverRulesOptions = {}): RuleDiscoveryResult {
  const rules: RepositoryRule[] = [];
  const sources: RuleSource[] = [];
  const diagnostics: string[] = [];

  const files = options.files ?? DEFAULT_RULE_FILES;

  if (options.root) {
    for (const relative of files) {
      const absolute = join(options.root, relative);
      const sourceId = `rule-file:${relative}`;
      if (!existsSync(absolute)) {
        sources.push({ sourceId, path: relative, present: false });
        continue;
      }
      let content: string;
      try {
        if (!statSync(absolute).isFile()) {
          continue;
        }
        content = readFileSync(absolute, "utf8");
      } catch (error) {
        diagnostics.push(`could not read rule file ${relative}: ${(error as Error).message}`);
        sources.push({ sourceId, path: relative, present: false });
        continue;
      }
      sources.push({ sourceId, path: relative, present: true, byteLength: Buffer.byteLength(content, "utf8") });
      rules.push(...extractRulesFromText(sourceId, relative, content));
    }
  }

  for (const pattern of options.protectedPatterns ?? []) {
    rules.push({
      id: ruleId("patchdiet.yaml", "path-protect", pattern),
      sourceId: "patchdiet.yaml:safety.protect",
      path: "patchdiet.yaml",
      kind: "path-protect",
      scopePattern: pattern,
      text: `protected path pattern: ${pattern}`,
      reliability: "strong"
    });
  }

  return { rules, sources, diagnostics };
}
