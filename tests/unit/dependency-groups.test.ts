import { describe, expect, it } from "vitest";

import { parseSource } from "../../packages/parsers/src/index.js";
import {
  buildDependencyGroups,
  deriveAtomEdges,
  removedIdsForGroups,
  toReductionGroups,
  type AtomDependencyEdge
} from "../../packages/core/src/dependency-groups.js";
import type { AtomEdit } from "../../packages/core/src/ast-atomizer.js";

function edit(partial: Partial<AtomEdit> & { id: string; filePath: string }): AtomEdit {
  return {
    baseStartByte: 0,
    baseEndByte: 0,
    headStartByte: 0,
    headEndByte: 0,
    detail: "test edit",
    ...partial
  };
}

describe("buildDependencyGroups", () => {
  // Refined semantics (review finding 3): sharing a changed symbol is NOT a
  // dependency. Two independent statements inside one function must stay
  // separately removable; only a real local def-use edge (derived from parse
  // facts in deriveAtomEdges) may tie them.
  it("keeps independent edits inside one changed symbol separately removable", () => {
    const edits = [
      edit({ id: "e1", filePath: "src/a.ts", symbolName: "total" }),
      edit({ id: "e2", filePath: "src/a.ts", symbolName: "total" }),
      edit({ id: "e3", filePath: "src/a.ts", symbolName: "other" })
    ];
    const groups = buildDependencyGroups(edits, []);
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.memberIds)).toEqual([["e1"], ["e2"], ["e3"]]);
  });

  it("groups an inserted import with the edits that use it (import-use)", async () => {
    const path = "src/app.ts";
    const head = `import { helper } from "./helper.js";\nexport function main(): number {\n  return helper(1);\n}\n`;
    const parse = await parseSource(path, head);
    expect(parse.complete).toBe(true);
    const edits = [
      edit({
        id: "e-import",
        filePath: path,
        headKind: "import_statement",
        headStartByte: 0,
        headEndByte: head.indexOf("\n") + 1
      }),
      edit({
        id: "e-use",
        filePath: path,
        symbolName: "main",
        headStartByte: head.indexOf("  return helper(1);"),
        headEndByte: head.indexOf("  return helper(1);") + "  return helper(1);".length
      })
    ];
    const edges = deriveAtomEdges(edits, { parses: new Map([[path, parse]]), headTexts: new Map([[path, head]]) });
    expect(edges.some((edge) => edge.reason === "import-use" && edge.fromEditId === "e-import" && edge.toEditId === "e-use")).toBe(true);
    const groups = buildDependencyGroups(edits, edges);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.memberIds).toEqual(["e-import", "e-use"]);
    expect(groups[0]!.reasons).toContain("import-use");
    expect(groups[0]!.details.join(" ")).toContain("uses helper imported by");
  });

  it("links a changed symbol to an edit containing a real call node of it (call-reference)", async () => {
    const callerText = `import { helper } from "./helper.js";\nexport function main() {\n  helper(1);\n}\n`;
    const callerParse = await parseSource("src/app.ts", callerText);
    expect(callerParse.complete).toBe(true);
    const callStart = callerText.indexOf("helper(1);");
    const edits = [
      edit({ id: "e-def", filePath: "src/helper.ts", symbolName: "helper", headStartByte: 0, headEndByte: 10 }),
      edit({
        id: "e-caller",
        filePath: "src/app.ts",
        symbolName: "main",
        headStartByte: callStart,
        headEndByte: callStart + "helper(1);".length
      })
    ];
    const edges = deriveAtomEdges(edits, {
      parses: new Map([["src/app.ts", callerParse]]),
      headTexts: new Map([["src/app.ts", callerText], ["src/helper.ts", "export function helper() {}"]])
    });
    expect(edges.some((edge) => edge.reason === "call-reference")).toBe(true);
    const groups = buildDependencyGroups(edits, edges);
    expect(groups).toHaveLength(1);
  });

  it("does not tie a changed symbol to edits in a file whose parse has no reference to it", async () => {
    const callerText = `export function unrelated() {\n  console.log("nothing here");\n}\n`;
    const callerParse = await parseSource("src/app.ts", callerText);
    const edits = [
      edit({ id: "e-def", filePath: "src/helper.ts", symbolName: "helper", headStartByte: 0, headEndByte: 10 }),
      edit({ id: "e-caller", filePath: "src/app.ts", symbolName: "unrelated", headStartByte: 0, headEndByte: 10 })
    ];
    const edges = deriveAtomEdges(edits, {
      parses: new Map([["src/app.ts", callerParse]]),
      headTexts: new Map([["src/app.ts", callerText], ["src/helper.ts", "export function helper() {}"]])
    });
    expect(edges.filter((edge) => edge.reason === "call-reference")).toHaveLength(0);
    expect(buildDependencyGroups(edits, edges)).toHaveLength(2);
  });

  // Refined semantics (review finding 3): the unrelated test edit contains no
  // reference to `needed`, so filename convention alone must not create a
  // test-fixture edge (independent-review contract parity).
  it("creates no test-fixture edge from filename convention alone", async () => {
    const testText = `export const testOnly = 1;\n`;
    const srcText = `export function needed() {\n  return 2;\n}\n`;
    const testParse = await parseSource("tests/unrelated.test.ts", testText);
    const srcParse = await parseSource("src/required.ts", srcText);
    const edits = [
      edit({
        id: "e-test",
        filePath: "tests/unrelated.test.ts",
        headKind: "lexical_declaration",
        headStartByte: 0,
        headEndByte: Buffer.byteLength(testText)
      }),
      edit({
        id: "e-src",
        filePath: "src/required.ts",
        symbolName: "needed",
        headStartByte: 0,
        headEndByte: Buffer.byteLength(srcText)
      })
    ];
    const edges = deriveAtomEdges(edits, {
      parses: new Map([
        ["tests/unrelated.test.ts", testParse],
        ["src/required.ts", srcParse]
      ]),
      headTexts: new Map([
        ["tests/unrelated.test.ts", testText],
        ["src/required.ts", srcText]
      ])
    });
    expect(edges.filter((edge) => edge.reason === "test-fixture")).toHaveLength(0);
    expect(buildDependencyGroups(edits, edges)).toHaveLength(2);
  });

  it("creates a test-fixture edge only when the test edit actually exercises the source symbol", async () => {
    const testText = `import assert from "node:assert";\nimport { total } from "../src/total.ts";\nassert.strictEqual(total(2), 4);\n`;
    const srcText = `export function total(n: number): number {\n  return n * 2;\n}\n`;
    const testParse = await parseSource("tests/total.test.ts", testText);
    const srcParse = await parseSource("src/total.ts", srcText);
    const useStart = testText.indexOf("assert.strictEqual(total(2), 4);");
    const edits = [
      edit({
        id: "e-test",
        filePath: "tests/total.test.ts",
        headKind: "expression_statement",
        headStartByte: useStart,
        headEndByte: testText.length
      }),
      edit({
        id: "e-src",
        filePath: "src/total.ts",
        symbolName: "total",
        headStartByte: 0,
        headEndByte: Buffer.byteLength(srcText)
      })
    ];
    const edges = deriveAtomEdges(edits, {
      parses: new Map([
        ["tests/total.test.ts", testParse],
        ["src/total.ts", srcParse]
      ]),
      headTexts: new Map([
        ["tests/total.test.ts", testText],
        ["src/total.ts", srcText]
      ])
    });
    expect(edges.some((edge) => edge.reason === "test-fixture")).toBe(true);
    expect(buildDependencyGroups(edits, edges)).toHaveLength(1);
  });

  it("keeps edits from different symbols and files as separate singleton groups without edges", () => {
    const edits = [
      edit({ id: "e1", filePath: "src/a.ts", symbolName: "alpha" }),
      edit({ id: "e2", filePath: "src/b.ts", symbolName: "beta" })
    ];
    const groups = buildDependencyGroups(edits, []);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.memberIds).sort()).toEqual([["e1"], ["e2"]].map((ids) => ids.sort()).sort() as never);
  });

  it("produces deterministic group ids for identical inputs", () => {
    const edits = [edit({ id: "e1", filePath: "src/a.ts", symbolName: "f" })];
    const first = buildDependencyGroups(edits, []);
    const second = buildDependencyGroups(edits, []);
    expect(first.map((group) => group.id)).toEqual(second.map((group) => group.id));
    expect(first[0]!.id).toMatch(/^grp-/);
  });

  it("converts groups to reducer groups with content hashes over member edits", () => {
    const edits = [
      edit({ id: "e1", filePath: "src/a.ts", symbolName: "f", baseStartByte: 1, baseEndByte: 2 }),
      edit({ id: "e2", filePath: "src/a.ts", symbolName: "f" })
    ];
    // Connected by a derived edge (refined semantics: sharing a symbol alone
    // is no longer an edge).
    const edges: AtomDependencyEdge[] = [
      { fromEditId: "e1", toEditId: "e2", reason: "local-def-use", detail: "e2 uses local x declared by e1" }
    ];
    const groups = toReductionGroups(buildDependencyGroups(edits, edges), edits);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.memberIds).toEqual(["e1", "e2"]);
    expect(groups[0]!.contentHash).toMatch(/[0-9a-f]{64}/);
    expect(groups[0]!.id).toMatch(/^grp-/);
  });

  it("ignores edges referencing unknown edits", () => {
    const edits = [edit({ id: "e1", filePath: "src/a.ts" })];
    const edges: AtomDependencyEdge[] = [
      { fromEditId: "e1", toEditId: "ghost", reason: "import-use", detail: "phantom" }
    ];
    const groups = buildDependencyGroups(edits, edges);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.memberIds).toEqual(["e1"]);
    expect(groups[0]!.reasons).toHaveLength(0);
  });
});

// ── Review finding 3: local def-use binding + import aliases ──────

describe("deriveAtomEdges — local def-use and import aliases", () => {
  it("binds a local use to the edit declaring it and leaves independent statements separate", async () => {
    const path = "src/total.js";
    const head = `export function total(n) {\n  const trace = { n };\n  console.error("injected-debug", trace);\n  return n * 2;\n}\n`;
    const parse = await parseSource(path, head);
    expect(parse.complete).toBe(true);
    const declStart = head.indexOf("const trace");
    const callStart = head.indexOf("console.error");
    const returnStart = head.indexOf("return n * 2;");
    const edits = [
      edit({
        id: "e-decl",
        filePath: path,
        symbolName: "total",
        headKind: "lexical_declaration",
        headStartByte: declStart,
        headEndByte: head.indexOf("\n", declStart) + 1
      }),
      edit({
        id: "e-call",
        filePath: path,
        symbolName: "total",
        headKind: "expression_statement",
        headStartByte: callStart,
        headEndByte: head.indexOf("\n", callStart) + 1
      }),
      edit({
        id: "e-return",
        filePath: path,
        symbolName: "total",
        headKind: "return_statement",
        headStartByte: returnStart,
        headEndByte: head.indexOf("\n", returnStart) + 1
      })
    ];
    const edges = deriveAtomEdges(edits, { parses: new Map([[path, parse]]), headTexts: new Map([[path, head]]) });
    // The console call uses the local `trace` declared by the sibling edit.
    expect(edges.some((edge) => edge.reason === "local-def-use" && edge.toEditId === "e-call" && edge.fromEditId === "e-decl")).toBe(true);
    // The required return statement is independent of the debug pair.
    expect(edges.filter((edge) => edge.fromEditId === "e-return" || edge.toEditId === "e-return")).toHaveLength(0);
    const groups = buildDependencyGroups(edits, edges);
    expect(groups).toHaveLength(2);
    const debugGroup = groups.find((group) => group.memberIds.includes("e-decl"))!;
    expect(debugGroup.memberIds.sort()).toEqual(["e-call", "e-decl"]);
    expect(groups.find((group) => group.memberIds.includes("e-return"))!.memberIds).toEqual(["e-return"]);
  });

  it("import-use respects the local alias", async () => {
    const path = "src/app.ts";
    const head = `import { helper as h } from "./helper.js";\nexport function main(): number {\n  return h(1);\n}\n`;
    const parse = await parseSource(path, head);
    expect(parse.complete).toBe(true);
    const edits = [
      edit({
        id: "e-import",
        filePath: path,
        headKind: "import_statement",
        headStartByte: 0,
        headEndByte: head.indexOf("\n") + 1
      }),
      edit({
        id: "e-use",
        filePath: path,
        symbolName: "main",
        headStartByte: head.indexOf("  return h(1);"),
        headEndByte: head.indexOf("  return h(1);") + "  return h(1);".length
      })
    ];
    const edges = deriveAtomEdges(edits, { parses: new Map([[path, parse]]), headTexts: new Map([[path, head]]) });
    expect(edges.some((edge) => edge.reason === "import-use" && edge.fromEditId === "e-import" && edge.toEditId === "e-use")).toBe(true);
  });
});

// ── Review finding 2: fail-closed group-id resolution ─────────────

describe("removedIdsForGroups", () => {
  const groups = [
    { id: "grp-a", memberIds: ["e1", "e2"] },
    { id: "grp-single-e3", memberIds: ["e3"] }
  ];

  it("resolves member ids from the actual group map passed in", () => {
    expect(removedIdsForGroups(["grp-a"], groups)).toEqual(new Set(["e1", "e2"]));
    expect(removedIdsForGroups(["grp-single-e3", "grp-a"], groups)).toEqual(new Set(["e1", "e2", "e3"]));
  });

  it("returns an empty set only for an empty selection", () => {
    expect(removedIdsForGroups([], groups)).toEqual(new Set());
  });

  it("fails closed on an unknown group id", () => {
    expect(() => removedIdsForGroups(["grp-a", "grp-ghost"], groups)).toThrow(/unknown group id/);
  });
});
