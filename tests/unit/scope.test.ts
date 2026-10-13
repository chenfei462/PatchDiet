import { describe, expect, it } from "vitest";

import { normalizeIntent, type IntentSourceDocument } from "../../packages/intent/src/index.js";
import {
  analyzeScope,
  explainAtom,
  explainAtoms,
  renderExplanationMarkdown,
  renderScopeJson,
  renderScopeMarkdown,
  RISK_FLAGS,
  SCOPE_STATES
} from "../../packages/scope/src/index.js";
import type { ChangeAtom, GraphFacts, ScopeFacts } from "../../packages/evidence/src/index.js";

// ── Fixtures ──────────────────────────────────────────────────────

function taskIntent(text: string) {
  const doc: IntentSourceDocument = { id: "cli", kind: "cli", text };
  return normalizeIntent([doc]);
}

const completeGraph: GraphFacts = { edges: [], incompleteReasons: [] };

function atom(partial: Partial<ChangeAtom> & { filePath: string }): ChangeAtom {
  return { ...partial };
}

describe("analyzeScope — five states and exact vocabulary", () => {
  it("matches a root-level double-star protection rule without consuming literal stars", () => {
    const report = analyzeScope(taskIntent("Fix src/main.ts"), {
      atoms: [atom({ filePath: "migrations/001.sql" }), atom({ filePath: "src/main.ts" })],
      graph: completeGraph,
      rules: [{ id: "protect-migrations", sourceId: "config", path: "patchdiet.yaml", kind: "path-protect", scopePattern: "**/migrations/**", text: "protect migrations", reliability: "strong" }]
    });
    expect(report.atoms.find((a) => a.filePath === "src/main.ts")?.state).toBe("required");
    expect(report.atoms.find((a) => a.filePath === "migrations/001.sql")?.state).toBe("protected");
  });

  it("changes the analysis ID when evidence facts change", () => {
    const intent = taskIntent("Fix src/main.ts");
    const target = atom({ id: "other", filePath: "src/other.ts" });
    const first = analyzeScope(intent, { atoms: [target], graph: completeGraph });
    const second = analyzeScope(intent, { atoms: [target], graph: completeGraph, tests: { other: { mappedTestIds: ["test-other"], mappingType: "explicit" } } });
    expect(first.atoms[0].state).toBe("candidate");
    expect(second.atoms[0].state).toBe("supporting");
    expect(first.analysisId).not.toBe(second.analysisId);
  });
  it("exposes exactly the required scope states", () => {
    expect([...SCOPE_STATES]).toEqual(["required", "supporting", "candidate", "uncertain", "protected"]);
  });

  it("classifies a directly named explicit path as required with intent evidence", () => {
    const intent = taskIntent("Fix session expiry in src/auth/session.ts");
    const report = analyzeScope(intent, {
      atoms: [atom({ filePath: "src/auth/session.ts", symbolPath: "rotateToken" })],
      graph: completeGraph
    });

    const classification = report.atoms[0];
    expect(classification.state).toBe("required");
    expect(classification.removalEligible).toBe(false);
    expect(classification.evidenceIds.length).toBeGreaterThan(0);
    const intentEvidence = report.evidence.filter((record) => record.category === "intent");
    expect(intentEvidence.some((record) => record.polarity === "supports-required")).toBe(true);
    // Every evidence id cited by the atom resolves to a record in the report.
    for (const id of classification.evidenceIds) {
      expect(report.evidence.some((record) => record.id === id)).toBe(true);
    }
  });

  it("classifies a graph-reachable dependency as supporting, not required", () => {
    const intent = taskIntent("Fix session expiry in src/auth/session.ts");
    const atoms = [
      atom({ id: "atom-session", filePath: "src/auth/session.ts", symbolPath: "rotateToken" }),
      atom({ id: "atom-token", filePath: "src/auth/token.ts", symbolPath: "decodeToken" })
    ];
    const graph: GraphFacts = {
      edges: [{ fromId: "atom-session", toId: "atom-token", edgeType: "call", reliability: "strong", sourceId: "parser" }],
      incompleteReasons: []
    };

    const report = analyzeScope(intent, { atoms, graph });
    const token = report.atoms.find((a) => a.atomId === "atom-token");
    expect(token?.state).toBe("supporting");
    const graphEvidence = report.evidence.find((record) => record.category === "graph" && record.atomId === "atom-token");
    expect(graphEvidence?.detail).toContain("required change depends on this atom");
  });

  it("classifies an explicit protection rule as protected, overriding candidate", () => {
    const intent = taskIntent("Fix session expiry in src/auth/session.ts");
    const report = analyzeScope(intent, {
      atoms: [atom({ filePath: "db/migrations/001_init.sql" })],
      graph: completeGraph,
      rules: [
        {
          id: "rule-x",
          sourceId: "rule-file:AGENTS.md",
          path: "AGENTS.md",
          kind: "path-protect",
          scopePattern: "**/migrations/**",
          text: "Do not modify db/migrations/**",
          reliability: "medium"
        }
      ]
    });
    const classification = report.atoms[0];
    expect(classification.state).toBe("protected");
    expect(classification.removalEligible).toBe(false);
    const ruleEvidence = report.evidence.find((record) => record.category === "repository-rule");
    expect(ruleEvidence?.polarity).toBe("supports-protected");
  });

  it("treats an explicit must-preserve statement naming the symbol as protected", () => {
    const intent = normalizeIntent([
      {
        id: "plan",
        kind: "agent_plan",
        plan: {
          goal: "Add caching",
          must_preserve: ["session.logout must remain unchanged"]
        }
      }
    ]);
    const report = analyzeScope(intent, {
      atoms: [atom({ filePath: "src/auth/session.ts", symbolPath: "session.logout" })],
      graph: completeGraph
    });
    expect(report.atoms[0].state).toBe("protected");
  });
});

describe("analyzeScope — no intent means uncertain", () => {
  it("never yields candidate when no intent is supplied", () => {
    const intent = normalizeIntent([]);
    const report = analyzeScope(intent, {
      atoms: [atom({ filePath: "src/unrelated.ts", symbolPath: "helper" })],
      graph: completeGraph
    });
    expect(report.atoms[0].state).toBe("uncertain");
    expect(report.atoms[0].removalEligible).toBe(false);
    expect(report.atoms[0].missingInputs).toContain("no task intent was supplied");
  });

  it("never yields candidate when only inferred prose intent exists", () => {
    const intent = normalizeIntent([{ id: "pr#1", kind: "pr", title: "Housekeeping", body: "Tidy up." }]);
    const report = analyzeScope(intent, {
      atoms: [atom({ filePath: "src/unrelated.ts" })],
      graph: completeGraph
    });
    expect(report.atoms[0].state).toBe("uncertain");
  });
});

describe("analyzeScope — graph incompleteness propagates", () => {
  it("downgrades to uncertain when the graph reports incompleteness", () => {
    const intent = taskIntent("Fix session expiry in src/auth/session.ts");
    const incomplete: GraphFacts = {
      edges: [],
      incompleteReasons: ["tree-sitter failed to parse src/legacy.js"],
      unsupportedLanguages: ["ruby"]
    };
    const report = analyzeScope(intent, {
      atoms: [atom({ filePath: "src/legacy.js" })],
      graph: incomplete
    });
    expect(report.atoms[0].state).toBe("uncertain");
    expect(report.graphDiagnostics.some((d) => d.includes("tree-sitter"))).toBe(true);
    expect(report.atoms[0].missingInputs.some((m) => m.includes("incomplete"))).toBe(true);
  });

  it("downgrades to uncertain when no graph is supplied at all", () => {
    const intent = taskIntent("Fix session expiry in src/auth/session.ts");
    const report = analyzeScope(intent, { atoms: [atom({ filePath: "src/other.ts" })] });
    expect(report.atoms[0].state).toBe("uncertain");
    expect(report.graphDiagnostics.some((d) => d.includes("no graph facts"))).toBe(true);
  });

  it("a missing caller edge does not prove an atom unused (no positive proof)", () => {
    // Complete graph, explicit task, but the atom is only reachable via a weak
    // similarity edge: it must not be treated as required/supporting.
    const intent = taskIntent("Fix session expiry in src/auth/session.ts");
    const graph: GraphFacts = {
      edges: [
        { fromId: "atom-weak", toId: "atom-session", edgeType: "reference", reliability: "weak", sourceId: "similarity" }
      ],
      incompleteReasons: []
    };
    const report = analyzeScope(intent, {
      atoms: [
        atom({ id: "atom-session", filePath: "src/auth/session.ts" }),
        atom({ id: "atom-weak", filePath: "src/util/date.ts" })
      ],
      graph
    });
    const weak = report.atoms.find((a) => a.atomId === "atom-weak");
    expect(weak?.state).toBe("candidate");
    // The candidate cites positive absence evidence, not just "no match".
    const positive = report.evidence.filter((record) => weak?.evidenceIds.includes(record.id));
    expect(positive.some((record) => record.polarity === "supports-candidate")).toBe(true);
  });
});

describe("analyzeScope — candidate with traceable positive evidence", () => {
  it("classifies an unrelated low-risk atom as candidate with traceable evidence", () => {
    const intent = taskIntent("Fix session expiry in src/auth/session.ts");
    const report = analyzeScope(intent, {
      atoms: [atom({ id: "atom-marketing", filePath: "src/util/date.ts", symbolPath: "formatMarketingDate" })],
      graph: completeGraph,
      history: { "atom-marketing": { similarity: 0.1, changeCount: 3 } }
    });

    const classification = report.atoms[0];
    expect(classification.state).toBe("candidate");
    expect(classification.removalEligible).toBe(true);
    // Still requires the runtime oracle.
    expect(classification.requiresRuntimeOracle).toBe(true);

    const contributing = report.evidence.filter((record) => classification.evidenceIds.includes(record.id));
    expect(contributing.some((record) => record.category === "intent" && record.polarity === "supports-candidate")).toBe(true);
    expect(contributing.some((record) => record.category === "graph" && record.polarity === "supports-candidate")).toBe(true);
    // History is present but explicitly limited to ranking.
    const history = contributing.find((record) => record.category === "history");
    expect(history?.limits).toBeDefined();
  });
});

describe("analyzeScope — risk flags are orthogonal to scope state", () => {
  it("marks a required public API change as required AND risky", () => {
    const intent = taskIntent("Add a new export to src/api/index.ts");
    const report = analyzeScope(intent, {
      atoms: [atom({ filePath: "src/api/index.ts", symbolPath: "newExport" })],
      graph: completeGraph
    });
    const classification = report.atoms[0];
    expect(classification.state).toBe("required");
    expect(classification.risks.map((risk) => risk.flag)).toContain("public-api");
    expect(classification.removalEligible).toBe(false);
  });

  it("detects dependency manifest, lockfile, migration, security and generated risks", () => {
    const intent = taskIntent("Update dependencies in package.json");
    const report = analyzeScope(intent, {
      atoms: [
        atom({ id: "manifest", filePath: "package.json" }),
        atom({ id: "lock", filePath: "package-lock.json" }),
        atom({ id: "mig", filePath: "db/migrations/002_add.sql" }),
        atom({ id: "sec", filePath: "src/auth/guard.ts" }),
        atom({ id: "gen", filePath: "src/generated/api.ts" })
      ],
      graph: completeGraph
    });
    const byId = new Map(report.atoms.map((a) => [a.atomId, a]));
    expect(byId.get("manifest")?.risks.map((r) => r.flag)).toContain("dependency-manifest");
    expect(byId.get("lock")?.risks.map((r) => r.flag)).toContain("lockfile");
    expect(byId.get("mig")?.risks.map((r) => r.flag)).toContain("migration");
    expect(byId.get("sec")?.risks.map((r) => r.flag)).toContain("security");
    expect(byId.get("gen")?.risks.map((r) => r.flag)).toContain("generated");
    expect([...RISK_FLAGS]).toEqual([
      "dependency-manifest",
      "lockfile",
      "migration",
      "security",
      "public-api",
      "generated"
    ]);
  });

  it("does not equate risk with unrelatedness: a risky but unreferenced atom is still candidate", () => {
    const intent = taskIntent("Fix session expiry in src/auth/session.ts");
    const report = analyzeScope(intent, {
      atoms: [atom({ filePath: "db/migrations/legacy.sql" })],
      graph: completeGraph
    });
    const classification = report.atoms[0];
    expect(classification.state).toBe("candidate");
    expect(classification.risks.map((r) => r.flag)).toContain("migration");
  });
});

describe("analyzeScope — protection beats candidate", () => {
  it("never marks a protected atom as a removal candidate", () => {
    const intent = taskIntent("Fix session expiry in src/auth/session.ts");
    const report = analyzeScope(intent, {
      atoms: [atom({ filePath: "src/generated/schema.ts" })],
      graph: completeGraph,
      rules: [
        {
          id: "rule-gen",
          sourceId: "rule-file:CLAUDE.md",
          path: "CLAUDE.md",
          kind: "path-protect",
          scopePattern: "src/generated/**",
          text: "Do not edit src/generated/**",
          reliability: "medium"
        }
      ]
    });
    expect(report.atoms[0].state).toBe("protected");
    expect(report.atoms[0].removalEligible).toBe(false);
  });
});

describe("analyzeScope — ambiguous symbols are not false support", () => {
  it("does not treat a bare symbol name appearing in two modules as a confident match", () => {
    const intent = taskIntent("Fix the `handle` function");
    const report = analyzeScope(intent, {
      atoms: [
        atom({ id: "atom-a", filePath: "src/a.ts", symbolPath: "handle" }),
        atom({ id: "atom-b", filePath: "src/b.ts", symbolPath: "handle" })
      ],
      graph: completeGraph
    });
    for (const classification of report.atoms) {
      expect(classification.state).toBe("uncertain");
      expect(classification.missingInputs.some((m) => m.includes("ambiguous"))).toBe(true);
    }
  });

  it("does treat a qualified symbol as a confident match", () => {
    const intent = taskIntent("Fix src/auth/session.ts::rotateToken");
    const report = analyzeScope(intent, {
      atoms: [
        atom({ id: "atom-a", filePath: "src/auth/session.ts", symbolPath: "rotateToken" }),
        atom({ id: "atom-b", filePath: "src/other.ts", symbolPath: "rotateToken" })
      ],
      graph: completeGraph
    });
    const byId = new Map(report.atoms.map((a) => [a.atomId, a]));
    expect(byId.get("atom-a")?.state).toBe("required");
  });
});

describe("analyzeScope — inconclusive runtime evidence blocks candidate", () => {
  it("downgrades a would-be candidate to uncertain when a prior check was flaky", () => {
    const intent = taskIntent("Fix session expiry in src/auth/session.ts");
    const report = analyzeScope(intent, {
      atoms: [atom({ id: "atom-flaky", filePath: "src/util/date.ts" })],
      graph: completeGraph,
      runtime: {
        "atom-flaky": [{ command: "pnpm test", status: "inconclusive", attempts: 3, cached: false, flaky: true }]
      }
    });
    const classification = report.atoms[0];
    expect(classification.state).toBe("uncertain");
    expect(classification.counterEvidenceIds.length).toBeGreaterThan(0);
  });
});

describe("explainAtom / explainAtoms — safe evidence retrieval", () => {
  const intent = taskIntent("Fix session expiry in src/auth/session.ts");
  const report = analyzeScope(intent, {
    atoms: [
      atom({ id: "atom-session", filePath: "src/auth/session.ts", symbolPath: "rotateToken" }),
      atom({ id: "atom-util", filePath: "src/util/date.ts", symbolPath: "formatMarketingDate" })
    ],
    graph: completeGraph
  });

  it("resolves contributing evidence ids from the report", () => {
    const explanation = explainAtom("atom-session", report);
    expect(explanation.found).toBe(true);
    expect(explanation.evidence.length).toBeGreaterThan(0);
    expect(explanation.evidence.every((record) => record.id.length > 0)).toBe(true);
    expect(explanation.readOnly).toBe(true);
  });

  it("reports a missing atom id safely instead of throwing", () => {
    const explanation = explainAtom("atom-does-not-exist", report);
    expect(explanation.found).toBe(false);
    expect(explanation.evidence).toHaveLength(0);
    expect(explanation.message).toContain("atom-does-not-exist");
  });

  it("filters by file and by symbol", () => {
    expect(explainAtoms({ file: "src/util/date.ts" }, report).map((e) => e.atomId)).toEqual(["atom-util"]);
    expect(explainAtoms({ symbol: "rotateToken" }, report).map((e) => e.atomId)).toEqual(["atom-session"]);
    expect(explainAtoms({}, report)).toHaveLength(2);
    expect(explainAtoms({ file: "nope.ts" }, report)).toHaveLength(0);
  });
});

describe("reports — stable deterministic JSON and Markdown", () => {
  const intent = taskIntent("Fix session expiry in src/auth/session.ts");
  const facts: ScopeFacts = {
    atoms: [
      atom({ id: "atom-session", filePath: "src/auth/session.ts", symbolPath: "rotateToken" }),
      atom({ id: "atom-util", filePath: "src/util/date.ts", symbolPath: "formatMarketingDate" })
    ],
    graph: completeGraph
  };

  it("produces byte-identical JSON for repeated analysis of the same facts", () => {
    const first = renderScopeJson(analyzeScope(intent, facts));
    const second = renderScopeJson(analyzeScope(intent, facts));
    expect(first).toBe(second);
  });

  it("produces byte-identical Markdown for repeated analysis", () => {
    const first = renderScopeMarkdown(analyzeScope(intent, facts));
    const second = renderScopeMarkdown(analyzeScope(intent, facts));
    expect(first).toBe(second);
    expect(first).toContain("# PatchDiet Scope Map");
  });

  it("is independent of atom input order", () => {
    const forward = renderScopeJson(analyzeScope(intent, facts));
    const reversed = renderScopeJson(
      analyzeScope(intent, { ...facts, atoms: [...facts.atoms].reverse() })
    );
    expect(forward).toBe(reversed);
  });

  it("derives a stable analysisId from the same inputs", () => {
    const a = analyzeScope(intent, facts);
    const b = analyzeScope(intent, facts);
    expect(a.analysisId).toBe(b.analysisId);
    expect(a.analysisId).toMatch(/^scope-[0-9a-f]{12}$/);
  });

  it("renders an evidence report with the mandatory limitation", () => {
    const report = analyzeScope(intent, facts);
    const markdown = renderExplanationMarkdown(explainAtom("atom-util", report));
    expect(markdown).toContain("# PatchDiet Evidence Report");
    expect(markdown).toContain("semantic equivalence");
  });
});

describe("analyzeScope — read-only, no oracle", () => {
  it("never reports a runtime oracle execution or filesystem mutation", () => {
    const intent = taskIntent("Fix session expiry in src/auth/session.ts");
    const report = analyzeScope(intent, {
      atoms: [atom({ filePath: "src/auth/session.ts" })],
      graph: completeGraph
    });
    expect(report.readOnly).toBe(true);
    expect(report.oracleExecuted).toBe(false);
    for (const classification of report.atoms) {
      expect(classification.requiresRuntimeOracle).toBe(true);
    }
    // No runtime evidence category is produced by analysis alone.
    expect(report.evidence.some((record) => record.category === "runtime")).toBe(false);
  });
});
