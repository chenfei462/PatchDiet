import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_RULE_FILES,
  discoverRules,
  findDependencyPath,
  globMatches,
  graphIsComplete,
  makeEvidence,
  pathIsProtected,
  type GraphFacts
} from "../../packages/evidence/src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("globMatches / pathIsProtected", () => {
  it("matches ** across directories and * within a segment", () => {
    expect(globMatches("**/migrations/**", "db/migrations/001_init.sql")).toBe(true);
    expect(globMatches("**/migrations/**", "migrations/001_init.sql")).toBe(true);
    expect(globMatches("*.ts", "index.ts")).toBe(true);
    expect(globMatches("*.ts", "src/index.ts")).toBe(false);
    expect(globMatches("src/*.ts", "src/index.ts")).toBe(true);
    expect(globMatches("src/*.ts", "src/nested/index.ts")).toBe(false);
  });

  it("reports protection only for matching paths", () => {
    const patterns = ["**/generated/**", "**/migrations/**"];
    expect(pathIsProtected(patterns, "pkg/generated/api.ts")).toBe(true);
    expect(pathIsProtected(patterns, "pkg/src/api.ts")).toBe(false);
  });
});

describe("discoverRules", () => {
  it("reads conventional instruction files and extracts path-protection rules", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-rules-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "AGENTS.md"),
      [
        "# Agent instructions",
        "Do not modify `src/generated/**`.",
        "The public `Session` API must remain stable."
      ].join("\n")
    );

    const result = discoverRules({ root: dir });
    const protect = result.rules.find((rule) => rule.kind === "path-protect");
    expect(protect?.scopePattern).toBe("src/generated/**");
    expect(protect?.path).toBe("AGENTS.md");
    // Provenance: rule ids are stable and prefixed.
    expect(protect?.id).toMatch(/^rule-[0-9a-f]{10}$/);
    expect(result.sources.find((source) => source.path === "AGENTS.md")?.present).toBe(true);
  });

  it("records absent rule files without failing", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-rules-"));
    tempDirs.push(dir);
    const result = discoverRules({ root: dir });
    expect(result.rules).toHaveLength(0);
    expect(result.sources).toHaveLength(DEFAULT_RULE_FILES.length);
    expect(result.sources.every((source) => !source.present)).toBe(true);
  });

  it("carries explicit config-protected patterns with strong reliability", () => {
    const result = discoverRules({ protectedPatterns: ["**/vendor/**"] });
    const rule = result.rules.find((r) => r.scopePattern === "**/vendor/**");
    expect(rule?.kind).toBe("path-protect");
    expect(rule?.reliability).toBe("strong");
    expect(rule?.sourceId).toContain("patchdiet.yaml");
  });

  it("does not treat arbitrary prose as an executable path rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-rules-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "CLAUDE.md"), "This project uses TypeScript and pnpm. Be careful.");
    const result = discoverRules({ root: dir });
    expect(result.rules.filter((rule) => rule.kind === "path-protect")).toHaveLength(0);
  });
});

describe("evidence records", () => {
  it("produces stable ids for identical evidence and distinct ids for distinct detail", () => {
    const a = makeEvidence({
      category: "intent",
      polarity: "supports-required",
      confidence: 0.9,
      sourceId: "cli",
      detail: "explicit task names path src/session.ts"
    });
    const b = makeEvidence({
      category: "intent",
      polarity: "supports-required",
      confidence: 0.9,
      sourceId: "cli",
      detail: "explicit task names path src/session.ts"
    });
    const c = makeEvidence({
      category: "intent",
      polarity: "supports-required",
      confidence: 0.9,
      sourceId: "cli",
      detail: "explicit task names path src/other.ts"
    });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(a.id).toMatch(/^ev-[0-9a-f]{10}$/);
  });

  it("retains explicit limits on a record", () => {
    const record = makeEvidence({
      category: "history",
      polarity: "supports-candidate",
      confidence: 0.3,
      sourceId: "history",
      detail: "similarity 0.8",
      limits: ["historical similarity alone never authorises removal"]
    });
    expect(record.limits).toHaveLength(1);
  });
});

describe("graph helpers", () => {
  const completeGraph: GraphFacts = {
    edges: [
      { fromId: "a", toId: "b", edgeType: "call", reliability: "strong", sourceId: "parser" },
      { fromId: "b", toId: "c", edgeType: "call", reliability: "strong", sourceId: "parser" },
      { fromId: "x", toId: "y", edgeType: "reference", reliability: "weak", sourceId: "parser" }
    ],
    incompleteReasons: []
  };

  it("treats a graph with no incompleteness reasons as complete", () => {
    expect(graphIsComplete(completeGraph)).toBe(true);
    expect(graphIsComplete({ edges: [], incompleteReasons: ["parse failure"] })).toBe(false);
    expect(graphIsComplete(undefined)).toBe(false);
  });

  it("finds a dependency path to a target following strong edges", () => {
    const path = findDependencyPath(completeGraph, "a", new Set(["c"]));
    expect(path).toEqual(["a", "b", "c"]);
  });

  it("does not traverse weak edges by default, so similarity is never a support claim", () => {
    const path = findDependencyPath(completeGraph, "x", new Set(["y"]));
    expect(path).toBeUndefined();
    expect(findDependencyPath(completeGraph, "x", new Set(["y"]), { includeWeak: true })).toEqual(["x", "y"]);
  });

  it("returns undefined for an unreachable target", () => {
    expect(findDependencyPath(completeGraph, "a", new Set(["y"]))).toBeUndefined();
  });
});
