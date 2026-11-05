import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type RegistryEntry = { id: string; path: string; status?: string; authority_tier?: string; retrieved_at?: string; source?: string };

const root = process.cwd();
const researchRoot = path.join(root, "knowledge", "research");

async function readYaml(relativePath: string): Promise<Record<string, unknown>> {
  return parse(await readFile(path.join(researchRoot, relativePath), "utf8")) as Record<string, unknown>;
}

async function assertExisting(relativePath: string): Promise<void> {
  await access(path.join(researchRoot, relativePath));
}

describe("authoritative research registry", () => {
  it("indexes verified sources and required algorithm cards", async () => {
    const registry = await readYaml("registry.yaml");
    expect(registry.registry_version).toBe(1);
    expect(registry.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const sources = registry.sources as RegistryEntry[];
    expect(sources.length).toBeGreaterThanOrEqual(20);
    const sourceIds = new Set(sources.map((entry) => entry.id));
    for (const required of [
      "standard:git-diff-format",
      "standard:git-apply",
      "standard:nist-ssdf-1.1",
      "standard:sarif-2.1.0",
      "paper:perses-icse-2018",
      "project:tree-sitter",
      "project:scip",
      "benchmark:swe-bench",
      "paper:rothermel-harrold-1997-safe-regression-test-selection",
      "paper:microsoft-modern-code-review-2013",
      "paper:google-modern-code-review-2018",
    ]) {
      expect(sourceIds.has(required), `missing source ${required}`).toBe(true);
    }

    for (const entry of sources) {
      await assertExisting(entry.path);
      expect(["A", "B", "C", "D"]).toContain(entry.authority_tier);
      expect(["SOURCE_VERIFIED_PRIMARY", "SOURCE_VERIFIED_REPOSITORY", "SOURCE_PARTIALLY_VERIFIED", "SOURCE_UNVERIFIED", "SOURCE_INVALID", "SOURCE_SUPERSEDED"]).toContain(entry.status);
      expect(entry.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const source = await readYaml(entry.path);
      expect(source.id, entry.path).toBe(entry.id);
      if (source.canonical_url !== null) expect(source.canonical_url, entry.id).toMatch(/^https:\/\//);
      const verified = ["SOURCE_VERIFIED_PRIMARY", "SOURCE_VERIFIED_REPOSITORY"].includes(entry.status ?? "");
      expect((source.status as Record<string, unknown>)?.source_verified).toBe(verified);
    }

    const claims = registry.claims as RegistryEntry[];
    expect(claims.length).toBeGreaterThan(0);
    for (const entry of claims) {
      await assertExisting(entry.path);
      const claim = await readYaml(entry.path);
      expect(claim.automatic_removal_authority, entry.id).toBe(false);
      expect(sourceIds.has(entry.source!), `${entry.id} references an unregistered source`).toBe(true);
    }

    const algorithms = registry.algorithms as RegistryEntry[];
    const algorithmIds = new Set(algorithms.map((entry) => entry.id));
    for (const required of [
      "ddmin",
      "hierarchical-delta-debugging",
      "syntax-guided-reduction",
      "weighted-delta-debugging",
      "probabilistic-delta-debugging",
      "counter-based-delta-debugging",
      "program-slicing",
      "change-impact-analysis",
      "regression-test-selection",
      "mutation-testing",
      "ast-differencing",
    ]) {
      expect(algorithmIds.has(required), `missing algorithm ${required}`).toBe(true);
    }
    for (const entry of algorithms) {
      await assertExisting(entry.path);
      const card = await readYaml(entry.path);
      for (const field of ["name", "family", "problem", "input", "output", "algorithm", "pseudocode", "complexity", "oracle_calls", "termination", "correctness_scope", "assumptions", "failure_modes", "patchdiet_current_state", "patchdiet_gap", "recommended_use", "not_recommended_for", "tests_required", "benchmark_metrics"]) {
        expect(card[field], `${entry.id} missing ${field}`).toBeDefined();
      }
    }
  });
});




