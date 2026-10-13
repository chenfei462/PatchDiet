import { describe, expect, it } from "vitest";

import {
  IntentValidationError,
  normalizeIntent,
  spanOf,
  utf8Length,
  type IntentSourceDocument
} from "../../packages/intent/src/index.js";

function cliTask(text: string): IntentSourceDocument {
  return { id: "cli", kind: "cli", text };
}

describe("normalizeIntent — precedence", () => {
  it("lets an explicit CLI task outrank a contradictory commit message and records the conflict", () => {
    const intent = normalizeIntent([
      cliTask("Fix session expiry after refresh-token rotation"),
      {
        id: "commit:abc123",
        kind: "commit",
        text: "Unrelated cleanup: reformat marketing date helpers and bump lodash"
      }
    ]);

    expect(intent.goal).toBe("Fix session expiry after refresh-token rotation");
    expect(intent.confidence).toBe("explicit");

    // The lower-priority goal is retained as provenance, not silently dropped.
    const shadowed = intent.conflicts.find((conflict) => conflict.type === "shadowed-fallback");
    expect(shadowed).toBeDefined();
    expect(shadowed?.sourceIds).toContain("commit:abc123");

    // The commit source is still present in the source list.
    expect(intent.sources.map((source) => source.id)).toContain("commit:abc123");
  });

  it("adopts the structured agent plan goal over PR prose when no explicit task is given", () => {
    const intent = normalizeIntent([
      {
        id: "pr#184",
        kind: "pr",
        title: "Bump dependencies and refactor utils",
        body: "Housekeeping PR."
      },
      {
        id: "plan",
        kind: "agent_plan",
        plan: {
          goal: "Rotate refresh tokens on session refresh",
          requirements: ["A rotated refresh token must extend the active session"],
          must_preserve: ["Existing logout behaviour"]
        }
      }
    ]);

    expect(intent.goal).toBe("Rotate refresh tokens on session refresh");
    expect(intent.confidence).toBe("structured");
    expect(
      intent.requirements.some((r) => r.text === "A rotated refresh token must extend the active session")
    ).toBe(true);
    expect(intent.mustPreserve).toHaveLength(1);
    // PR prose goal is retained but shadowed.
    expect(intent.conflicts.some((c) => c.type === "shadowed-fallback" && c.sourceIds.includes("pr#184"))).toBe(true);
  });
});

describe("normalizeIntent — missing intent", () => {
  it("yields uncertain (never a confident candidate) when no task-bearing source exists", () => {
    const intent = normalizeIntent([]);
    expect(intent.confidence).toBe("uncertain");
    expect(intent.goal).toBe("");
    expect(intent.diagnostics.some((d) => d.code === "no-intent-source")).toBe(true);
  });

  it("treats an empty commit-only source as inferred/uncertain, not explicit", () => {
    const intent = normalizeIntent([{ id: "commit:deadbeef", kind: "commit", text: "" }]);
    expect(intent.confidence).toBe("uncertain");
    expect(intent.diagnostics.some((d) => d.code === "missing-explicit-task")).toBe(true);
  });

  it("marks prose-only intent as inferred and never explicit", () => {
    const intent = normalizeIntent([
      { id: "pr#7", kind: "pr", title: "Add caching layer", body: "Speeds up repeated lookups." }
    ]);
    expect(intent.confidence).toBe("inferred");
    expect(intent.requirements.length).toBeGreaterThan(0);
  });
});

describe("normalizeIntent — malformed input rejected", () => {
  it("rejects a source document with an unknown kind", () => {
    expect(() =>
      normalizeIntent([{ id: "x", kind: "email" as never, text: "hello" }])
    ).toThrow(IntentValidationError);
  });

  it("rejects a malformed structured plan rather than downgrading it", () => {
    expect(() =>
      normalizeIntent([
        { id: "plan", kind: "agent_plan", plan: { requirements: [42] } }
      ])
    ).toThrow(IntentValidationError);
  });

  it("rejects a plan with unknown keys (strict schema)", () => {
    expect(() =>
      normalizeIntent([
        { id: "plan", kind: "agent_plan", plan: { goal: "x", surprise: true } }
      ])
    ).toThrow(/invalid agent plan/);
  });
});

describe("normalizeIntent — UTF-8 multilingual source spans", () => {
  it("computes byte-accurate spans for CJK requirements", () => {
    const requirement = "刷新令牌轮换后必须延长当前会话";
    const intent = normalizeIntent([
      {
        id: "task_file:docs/task.md",
        kind: "task_file",
        path: "docs/task.md",
        text: `目标：修复会话过期\n- ${requirement}`
      }
    ]);

    const statement = intent.requirements.find((item) => item.text.includes("刷新令牌"));
    expect(statement).toBeDefined();
    // The excerpt is verbatim from the source.
    expect(statement?.excerpt).toBe(requirement);
    // Byte offsets reflect the multi-byte encoding, not character counts.
    expect(statement?.span.startByte).toBeGreaterThan(0);
    expect(statement!.span.endByte - statement!.span.startByte).toBe(utf8Length(requirement));
    // Line numbers are 1-based.
    expect(statement?.span.startLine).toBe(2);
  });

  it("keeps character-index spans distinct from byte-index spans", () => {
    const text = "café ☕ test";
    const span = spanOf(text, 0, text.length);
    expect(span.endByte).toBe(utf8Length(text));
    expect(span.endByte).toBeGreaterThan(text.length);
  });
});

describe("normalizeIntent — determinism and stable IDs", () => {
  it("produces identical ids for identical inputs across repeated calls", () => {
    const docs: IntentSourceDocument[] = [
      cliTask("Fix login redirect"),
      { id: "pr#9", kind: "pr", title: "Login fix", body: "Redirect after login." }
    ];
    const first = normalizeIntent(docs);
    const second = normalizeIntent(docs);
    expect(first.requirements.map((r) => r.id)).toEqual(second.requirements.map((r) => r.id));
    expect(first.requirements.map((r) => r.id)).toEqual([...first.requirements.map((r) => r.id)].sort());
    expect(first.requirements.length).toBeGreaterThan(0);
    expect(first.requirements[0].id).toMatch(/^req-[0-9a-f]{10}$/);
  });

  it("is independent of source array order for the adopted goal", () => {
    const a: IntentSourceDocument = cliTask("Fix session expiry");
    const b: IntentSourceDocument = { id: "pr#1", kind: "pr", title: "Something else", body: "Body." };
    const forward = normalizeIntent([a, b]);
    const reverse = normalizeIntent([b, a]);
    expect(forward.goal).toBe(reverse.goal);
    expect(forward.confidence).toBe(reverse.confidence);
  });
});

describe("normalizeIntent — LLM is optional and non-authoritative", () => {
  it("performs no LLM work and records that it was requested", () => {
    const intent = normalizeIntent([cliTask("Fix bug")], { llm: "auto" });
    expect(intent.llmUsed).toBe(false);
    expect(intent.llmRequested).toBe(true);
    expect(intent.diagnostics.some((d) => d.code === "llm-not-authoritative")).toBe(true);
  });

  it("needs no credentials or network when llm is off (the default)", () => {
    const intent = normalizeIntent([cliTask("Fix bug")]);
    expect(intent.llmRequested).toBe(false);
    expect(intent.llmUsed).toBe(false);
  });
});
