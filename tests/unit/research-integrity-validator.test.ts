import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

function validate(mutate: (registry: any, records: Record<string, any>) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), "patchdiet-integrity-"));
  const gates = { D1_SOURCE_VERIFIED: "PASS", D2_CLAIMS_EXTRACTED: "PASS", D3_LIMITATIONS_CAPTURED: "PASS", D4_PATCHDIET_MAPPED: "PASS", D5_DECISION_RECORDED: "PASS", D6_TICKET_CREATED_IF_REQUIRED: "D6_NOT_APPLICABLE", D7_VALIDATED_IF_IMPLEMENTED: "D7_NOT_APPLICABLE" };
  const registry: any = { registry_version: 1, sources: [{ id: "paper:test", path: "source.yaml", status: "SOURCE_VERIFIED_PRIMARY", authority_tier: "A" }], claims: [{ id: "claim:test", path: "claim.yaml", source: "paper:test" }], algorithms: [], projects: [], tickets: [], adrs: [], benchmarks: [] };
  const records: Record<string, any> = {
    "source.yaml": { id: "paper:test", title: "Test publication", authors: ["Author"], year: 2026, venue: "Test venue", canonical_url: "https://example.org/paper", paper_version_used: "v1", source_type: "peer-reviewed-paper", inspection: { url: "https://example.org/paper", locators: ["section 1"] }, verification_status: "SOURCE_VERIFIED_PRIMARY", status: { source_verified: true, decision: "RESEARCH_ONLY" }, claims: ["claim:test"], limitations: ["Test study only"], patchdiet_mapping: "Research only", distillation_gates: { ...gates }, gate_justifications: { D6: "No implementation authorized", D7: "No implementation performed" } },
    "claim.yaml": { id: "claim:test", source: { id: "paper:test" }, statement: "Bounded finding", limitations: ["Limited study"], patchdiet_mapping: { mapping: "Research only" }, automatic_removal_authority: false }
  };
  try {
    mutate(registry, records);
    mkdirSync(path.join(root, "reports"));
    writeFileSync(path.join(root, "registry.yaml"), stringify(registry));
    for (const [file, record] of Object.entries(records)) writeFileSync(path.join(root, file), typeof record === "string" ? record : stringify(record));
    const result = spawnSync(process.execPath, [path.resolve("scripts/validate-research-integrity.mjs"), "--root", root], { encoding: "utf8", windowsHide: true });
    const reportPath = path.join(root, "reports/RESEARCH_INTEGRITY_VALIDATION.json");
    return { exit: result.status, report: JSON.parse(readFileSync(reportPath, "utf8")) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("research integrity rejection boundaries", () => {
  it("accepts a complete bounded record without granting experiment authority", () => {
    const result = validate(() => {});
    expect(result.exit).toBe(0);
    expect(result.report.errors).toEqual([]);
    expect(result.report.experiments_authorized).toBe(false);
  });

  it.each(["authors", "venue", "canonical_url", "paper_version_used"])("rejects verified primary evidence missing %s", field => {
    const result = validate((_, records) => { delete records["source.yaml"][field]; });
    expect(result.exit).toBe(2);
    expect(result.report.errors.join("\n")).toContain(field);
  });

  it("rejects hidden registry/card source disagreement", () => {
    const result = validate((_, records) => { records["claim.yaml"].source.id = "paper:missing"; });
    expect(result.report.errors.join("\n")).toContain("paper:missing");
  });

  it("rejects empty limitations and mappings", () => {
    const result = validate((_, records) => { records["claim.yaml"].limitations = []; records["claim.yaml"].patchdiet_mapping = {}; });
    expect(result.report.errors.join("\n")).toContain("limitations");
    expect(result.report.errors.join("\n")).toContain("patchdiet_mapping");
  });

  it("rejects unresolved algorithm, project, ticket and ADR references", () => {
    const result = validate((registry, records) => {
      registry.algorithms = [{ id: "test-algorithm", path: "algorithm.yaml" }];
      records["algorithm.yaml"] = { name: "test-algorithm", original_sources: ["paper:missing"], project_refs: ["project:missing"] };
      registry.tickets = [{ id: "PD-R999", path: "ticket.yaml" }];
      records["ticket.yaml"] = { id: "PD-R999", research_basis: { algorithms: ["missing-algorithm"], projects: ["project:missing"] } };
      registry.adrs = [{ id: "ADR-TEST", path: "adr.md" }];
      records["adr.md"] = "Source: `paper:missing`";
    });
    expect(result.report.errors.join("\n")).toContain("paper:missing");
    expect(result.report.errors.join("\n")).toContain("project:missing");
    expect(result.report.errors.join("\n")).toContain("missing-algorithm");
    expect(result.report.warnings).toEqual([]);
  });

  it("rejects duplicate IDs and D1/status contradictions", () => {
    const result = validate((registry, records) => {
      registry.sources.push({ ...registry.sources[0] });
      records["source.yaml"].distillation_gates.D1_SOURCE_VERIFIED = "FAIL";
    });
    expect(result.report.errors.join("\n")).toContain("duplicate");
    expect(result.report.errors.join("\n")).toContain("D1_SOURCE_VERIFIED");
  });

  it("rejects repository verification with unknown license or absent snapshot metadata", () => {
    const result = validate((registry, records) => {
      registry.sources[0].status = "SOURCE_VERIFIED_REPOSITORY";
      Object.assign(records["source.yaml"], { verification_status: "SOURCE_VERIFIED_REPOSITORY", repository: "https://github.com/example/test", license: "NOT_VERIFIED", inspected_commit: "main", retrieved_at: "2026-10-27" });
    });
    expect(result.report.errors.join("\n")).toContain("license");
    expect(result.report.errors.join("\n")).toContain("inspected_commit");
    expect(result.report.errors.join("\n")).toContain("commit_date");
  });

  it("rejects unregistered source cards instead of silently omitting them", () => {
    const result = validate((_, records) => {
      records["orphan.yaml"] = { id: "paper:orphan", verification_status: "SOURCE_UNVERIFIED" };
    });
    expect(result.report.errors.join("\n")).toContain("paper:orphan");
  });

  it("rejects a claimed ticket gate with no linked ticket", () => {
    const result = validate((_, records) => {
      records["source.yaml"].distillation_gates.D6_TICKET_CREATED_IF_REQUIRED = "PASS";
    });
    expect(result.report.errors.join("\n")).toContain("D6_TICKET_CREATED_IF_REQUIRED");
  });

  it("rejects a project that passes D1 using an unverified source", () => {
    const result = validate((registry, records) => {
      registry.sources[0].status = "SOURCE_UNVERIFIED";
      records["source.yaml"].verification_status = "SOURCE_UNVERIFIED";
      records["source.yaml"].status.source_verified = false;
      records["source.yaml"].distillation_gates.D1_SOURCE_VERIFIED = "FAIL";
      registry.projects = [{ id: "project:test", path: "project.yaml" }];
      records["project.yaml"] = { ...records["source.yaml"], id: "project:test", source_refs: ["paper:test"], distillation_gates: { ...records["source.yaml"].distillation_gates, D1_SOURCE_VERIFIED: "PASS" } };
    });
    expect(result.report.errors.join("\n")).toContain("D1_SOURCE_VERIFIED");
  });

  it("rejects dataset verification based only on paper metadata", () => {
    const result = validate((_, records) => {
      records["source.yaml"].source_type = "benchmark-dataset";
    });
    expect(result.report.errors.join("\n")).toContain("dataset_version");
    expect(result.report.errors.join("\n")).toContain("data_use_constraints");
    expect(result.report.errors.join("\n")).toContain("privacy_constraints");
  });
});

