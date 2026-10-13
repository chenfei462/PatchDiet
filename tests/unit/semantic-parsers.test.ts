import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { detectLanguage, invalidEncodingResult, parseSource, supportedLanguages } from "../../packages/parsers/src/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "semantic");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

/**
 * Byte-slice oracle: every reported range must satisfy
 * sourceBytes.slice(startByte, endByte) === expected text, and the line/column
 * byte units must round-trip. This is the single source of truth for the
 * documented units: bytes = UTF-8 byte offsets into the UTF-8 encoding of the
 * whole source; lines = 0-based; columns = 0-based UTF-8 byte columns within
 * the line (the line terminator itself is not part of the column).
 */
function expectRangeText(source: string, range: { startByte: number; endByte: number }, expected: string): void {
  expect(sourceBytesSlice(source, range)).toBe(expected);
}

function sourceBytesSlice(source: string, range: { startByte: number; endByte: number }): string {
  const bytes = Buffer.from(source, "utf8");
  return bytes.subarray(range.startByte, range.endByte).toString("utf8");
}

describe("language detection", () => {
  it("maps extensions to supported grammars", () => {
    expect(detectLanguage("a.ts")).toBe("typescript");
    expect(detectLanguage("a.mts")).toBe("typescript");
    expect(detectLanguage("a.tsx")).toBe("tsx");
    expect(detectLanguage("a.js")).toBe("javascript");
    expect(detectLanguage("a.mjs")).toBe("javascript");
    expect(detectLanguage("a.jsx")).toBe("jsx");
    expect(detectLanguage("a.py")).toBe("python");
    expect(detectLanguage("a.go")).toBe(null);
    expect(supportedLanguages().sort()).toEqual(["javascript", "jsx", "python", "tsx", "typescript"]);
  });
});

describe("parseSource: TypeScript", () => {
  it("reports UTF-8 byte offsets, not tree-sitter UTF-16 startIndex", async () => {
    // After the comment "// 中文😀" the UTF-16 index of the export statement is 8
    // (reviewer probe evidence) but the true UTF-8 byte offset is 14.
    const source = readFixture("ts-unicode.ts");
    const result = await parseSource("src/ts-unicode.ts", source);

    expect(result.complete).toBe(true);
    expect(result.language).toBe("typescript");
    const calc = result.symbols.find((s) => s.name === "calc");
    expect(calc).toBeDefined();
    expect(calc!.exported).toBe(true);
    // 3 bytes for 中, 4 for 文, 4 for the emoji = 14 bytes after "// " (3).
    // Line 0 ("// 中文😀\n") is 3+3+3+4+1 = 14 UTF-8 bytes; "export " is 7 more,
    // so the function node itself starts at byte 21, column 7, while its safe
    // span (including the export keyword) starts at byte 14, column 0.
    expect(calc!.range.startByte).toBe(21);
    expect(calc!.range.startLine).toBe(1);
    expect(calc!.range.startColumn).toBe(7);
    expectRangeText(source, calc!.range, "function calc() { return 1; }");
    // The span preserves the export keyword.
    expectRangeText(source, calc!.span, "export function calc() { return 1; }");
    expect(calc!.span.startByte).toBe(14);
    expect(calc!.span.startLine).toBe(1);
    expect(calc!.span.startColumn).toBe(0);
    expect(calc!.range.endByte).toBe(Buffer.byteLength(source, "utf8") - 1);

    // Serializable safe AST atoms must carry correct byte ranges for the same
    // Unicode source: the export statement atom starts at byte 14 (NOT the
    // UTF-16 index 8 the raw tree-sitter binding would report).
    const exportAtom = result.atoms.find((a) => a.kind === "export_statement");
    expect(exportAtom).toBeDefined();
    expect(exportAtom!.range.startByte).toBe(14);
    expectRangeText(source, exportAtom!.range, "export function calc() { return 1; }");
  });

  it("handles CRLF sources with byte-exact ranges", async () => {
    const source = readFixture("ts-crlf.ts");
    const result = await parseSource("src/ts-crlf.ts", source);
    expect(result.complete).toBe(true);
    const alpha = result.symbols.find((s) => s.name === "alpha");
    expect(alpha).toBeDefined();
    expectRangeText(source, alpha!.range, "function alpha() { return 1; }");
    expect(alpha!.range.startLine).toBe(1);
    const beta = result.symbols.find((s) => s.name === "beta");
    expect(beta).toBeDefined();
    expectRangeText(source, beta!.span, "export const beta = () => 2;");
    // CRLF bytes are counted: line 0 is "const x = 0;\r\n" = 14 bytes.
    expect(beta!.range.startLine).toBe(2);
  });

  it("extracts nested methods and classes with parent links", async () => {
    const source = readFixture("ts-nested.ts");
    const result = await parseSource("src/ts-nested.ts", source);
    expect(result.complete).toBe(true);

    const klass = result.symbols.find((s) => s.name === "Greeter" && s.kind === "class");
    const method = result.symbols.find((s) => s.name === "greet" && s.kind === "method");
    const inner = result.symbols.find((s) => s.name === "shout" && s.kind === "function");
    expect(klass).toBeDefined();
    expect(method).toBeDefined();
    expect(inner).toBeDefined();
    expect(method!.parentId).toBe(klass!.id);
    expect(inner!.parentId).not.toBe(null);
    expect(inner!.parentId).not.toBe(klass!.id);

    // The class span must include its decorator and export keyword.
    expectRangeText(
      source,
      klass!.span,
      '@component()\nexport class Greeter {\n  greet() {\n    const shout = function shout() { return "!"; };\n    return helper(shout());\n  }\n}',
    );
    // Method ranges stay inside the class range.
    expect(method!.range.startByte).toBeGreaterThan(klass!.range.startByte);
    expect(method!.range.endByte).toBeLessThan(klass!.range.endByte);
  });

  it("captures imports with aliases and call sites", async () => {
    const source = readFixture("ts-imports.ts");
    const result = await parseSource("src/ts-imports.ts", source);
    expect(result.complete).toBe(true);

    const aliased = result.imports.find((i) => i.moduleSpecifier === "./helpers" && i.alias === "renamed");
    expect(aliased).toBeDefined();
    expect(aliased!.importedName).toBe("original");
    const sideEffect = result.imports.find((i) => i.moduleSpecifier === "./side-effect");
    expect(sideEffect).toBeDefined();

    const call = result.calls.find((c) => c.calleeName === "renamed");
    expect(call).toBeDefined();
    expectRangeText(source, call!.range, 'renamed("x")');
  });

  it("reports incomplete parse with diagnostics for malformed syntax", async () => {
    const source = readFixture("ts-malformed.ts");
    const result = await parseSource("src/ts-malformed.ts", source);
    expect(result.complete).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.code === "parse-error")).toBe(true);
    // Partial structure is still extracted, but never advertised as complete.
    expect(result.symbols.length).toBeGreaterThan(0);
    expect(result.metadata).toMatchObject({ parser: "tree-sitter" });
  });

  it("refuses unsupported languages with a diagnostic fallback", async () => {
    const result = await parseSource("src/main.go", "package main\n");
    expect(result.complete).toBe(false);
    expect(result.language).toBe(null);
    expect(result.symbols).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "unsupported-language", message: expect.stringContaining("go") }),
    ]);
  });

  it("returns deterministic JSON-serializable results with stable ids", async () => {
    const source = readFixture("ts-unicode.ts");
    const a = await parseSource("src/ts-unicode.ts", source);
    const b = await parseSource("src/ts-unicode.ts", source);
    const jsonA = JSON.stringify(a);
    const jsonB = JSON.stringify(b);
    expect(jsonA).toBe(jsonB);
    // Round-trip proves no live WASM node objects leaked into the result.
    expect(JSON.parse(jsonA)).toEqual(a);
    const changed = await parseSource("src/ts-unicode.ts", source.replace("return 1", "return 2"));
    const calcA = a.symbols.find((s) => s.name === "calc")!;
    const calcChanged = changed.symbols.find((s) => s.name === "calc")!;
    expect(calcA.id).not.toBe(calcChanged.id);
  });

  it("marks non-exported top-level symbols and type declarations", async () => {
    const source = readFixture("ts-kinds.ts");
    const result = await parseSource("src/ts-kinds.ts", source);
    expect(result.complete).toBe(true);
    expect(result.symbols.find((s) => s.name === "internal" && s.kind === "function")!.exported).toBe(false);
    expect(result.symbols.find((s) => s.name === "Config" && s.kind === "interface")).toBeDefined();
    expect(result.symbols.find((s) => s.name === "Id" && s.kind === "type")).toBeDefined();
    expect(result.symbols.find((s) => s.name === "Mode" && s.kind === "enum")).toBeDefined();
    expect(result.symbols.find((s) => s.name === "DEFAULT" && s.kind === "variable")).toBeDefined();
  });
});

describe("parseSource: TSX / JSX", () => {
  it("parses JSX components", async () => {
    const source = readFixture("tsx-component.tsx");
    const result = await parseSource("src/Component.tsx", source);
    expect(result.complete).toBe(true);
    expect(result.language).toBe("tsx");
    expect(result.symbols.find((s) => s.name === "Badge" && s.kind === "function")).toBeDefined();
  });
});

describe("parseSource: Python", () => {
  it("keeps decorators in the safe span and links methods to classes", async () => {
    const source = readFixture("py-decorators.py");
    const result = await parseSource("src/models.py", source);
    expect(result.complete).toBe(true);
    expect(result.language).toBe("python");

    const klass = result.symbols.find((s) => s.name === "Model" && s.kind === "class");
    const save = result.symbols.find((s) => s.name === "save" && s.kind === "method");
    expect(klass).toBeDefined();
    expect(save).toBeDefined();
    expect(save!.parentId).toBe(klass!.id);
    // Decorator must be part of the span so slicing the span keeps valid syntax.
    // The class span covers the whole class body including the nested
    // decorated method, so slicing it keeps valid syntax.
    expectRangeText(source, klass!.span, "@dataclass\nclass Model:\n    name: str\n\n    @staticmethod\n    def save(self):\n        return self.name");
    expectRangeText(source, save!.span, "@staticmethod\n    def save(self):\n        return self.name");

    const top = result.symbols.find((s) => s.name === "build" && s.kind === "function");
    expect(top).toBeDefined();
    expectRangeText(source, top!.span, '@functools.cache\ndef build(config):\n    return (\n        config,\n        True,\n    )');
  });

  it("captures python imports and calls across multiline statements", async () => {
    const source = readFixture("py-imports.py");
    const result = await parseSource("src/entry.py", source);
    expect(result.complete).toBe(true);
    const fromImport = result.imports.find((i) => i.moduleSpecifier === "os.path" && i.importedName === "join");
    expect(fromImport).toBeDefined();
    const plain = result.imports.find((i) => i.moduleSpecifier === "sys");
    expect(plain).toBeDefined();
    expect(result.calls.some((c) => c.calleeName === "join")).toBe(true);
  });

  it("falls back with diagnostics for malformed python", async () => {
    const source = readFixture("py-malformed.py");
    const result = await parseSource("src/broken.py", source);
    expect(result.complete).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "parse-error")).toBe(true);
  });
});

describe("parseSource: safe AST atoms", () => {
  it("exposes complete statement atoms with parent links in TS", async () => {
    const source = readFixture("ts-nested.ts");
    const result = await parseSource("src/ts-nested.ts", source);
    expect(result.complete).toBe(true);

    const exportAtom = result.atoms.find((a) => a.kind === "export_statement");
    expect(exportAtom).toBeDefined();
    expectRangeText(
      source,
      exportAtom!.range,
      '@component()\nexport class Greeter {\n  greet() {\n    const shout = function shout() { return "!"; };\n    return helper(shout());\n  }\n}',
    );

    // Nested statement atoms point at their enclosing statement atom.
    const lexical = result.atoms.find((a) => a.kind === "lexical_declaration");
    const methodAtom = result.atoms.find((a) => a.kind === "method_definition");
    expect(lexical).toBeDefined();
    expect(methodAtom).toBeDefined();
    expectRangeText(source, lexical!.range, 'const shout = function shout() { return "!"; };');
    const outerReturn = result.atoms
      .filter((a) => a.kind === "return_statement")
      .find((a) => sourceBytesSlice(source, a.range) === "return helper(shout());");
    expect(outerReturn).toBeDefined();
    expect(outerReturn!.parentId).toBe(methodAtom!.id);
    // The return nested inside the function expression attaches to the
    // nearest enclosing atom (the lexical declaration).
    const innerReturn = result.atoms
      .filter((a) => a.kind === "return_statement")
      .find((a) => sourceBytesSlice(source, a.range) === 'return "!";');
    expect(innerReturn).toBeDefined();
    expect(innerReturn!.parentId).toBe(lexical!.id);
    // Atom ids are deterministic.
    expect(lexical!.id).not.toBe(outerReturn!.id);
  });

  it("reports byte-exact atoms for CRLF and Unicode sources", async () => {
    const crlf = readFixture("ts-crlf.ts");
    const crlfResult = await parseSource("src/ts-crlf.ts", crlf);
    const importLike = crlfResult.atoms.find((a) => a.kind === "lexical_declaration");
    expect(importLike).toBeDefined();
    expectRangeText(crlf, importLike!.range, "const x = 0;");

    const unicode = readFixture("ts-unicode.ts");
    const unicodeResult = await parseSource("src/ts-unicode.ts", unicode);
    const exportAtom = unicodeResult.atoms.find((a) => a.kind === "export_statement");
    expect(exportAtom).toBeDefined();
    expect(exportAtom!.range.startByte).toBe(14); // UTF-8 bytes, not UTF-16 index 8
    expectRangeText(unicode, exportAtom!.range, "export function calc() { return 1; }");
  });

  it("exposes python decorated definitions as atoms including decorators", async () => {
    const source = readFixture("py-decorators.py");
    const result = await parseSource("src/models.py", source);
    const decorated = result.atoms.filter((a) => a.kind === "decorated_definition");
    expect(decorated).toHaveLength(2);
    expectRangeText(source, decorated[0]!.range, "@dataclass\nclass Model:\n    name: str\n\n    @staticmethod\n    def save(self):\n        return self.name");
    expectRangeText(source, decorated[1]!.range, "@functools.cache\ndef build(config):\n    return (\n        config,\n        True,\n    )");
  });
});

describe("parseSource: references", () => {
  it("collects identifier references with enclosing symbol links", async () => {
    const source = "function g(x) { return x + x + x; }\n";
    const result = await parseSource("src/refs.ts", source);
    expect(result.complete).toBe(true);
    const g = result.symbols.find((s) => s.name === "g")!;
    const xRefs = result.references.filter((r) => r.name === "x");
    expect(xRefs).toHaveLength(3);
    for (const ref of xRefs) {
      expect(ref.withinSymbolId).toBe(g.id);
      expectRangeText(source, ref.range, "x");
    }
    // The parameter declaration name itself is not a reference.
    expect(result.references.some((r) => sourceBytesSlice(source, r.range) === "g")).toBe(false);
  });

  it("collects module-level references and filters declaration names", async () => {
    const source = "const x = 1;\nconst values = [x, x, x];\n";
    const result = await parseSource("src/modrefs.ts", source);
    expect(result.complete).toBe(true);
    const values = result.symbols.find((s) => s.name === "values")!;
    const xRefs = result.references.filter((r) => r.name === "x");
    expect(xRefs).toHaveLength(3);
    for (const ref of xRefs) {
      expect(ref.withinSymbolId).toBe(values.id);
      expectRangeText(source, ref.range, "x");
    }
    // Declaration names (`x = 1` and `values`) are not references.
    expect(result.references.filter((r) => r.name === "values")).toHaveLength(0);
  });

  it("marks the result incomplete with a truncation diagnostic past the reference cap", async () => {
    // 10,001 distinct identifiers as expression statements exceeds the cap.
    const statements = Array.from({ length: 10_001 }, (_, i) => `x${i};`).join("\n");
    const source = `function g() {\n${statements}\n}\n`;
    const result = await parseSource("src/cap.ts", source);
    expect(result.complete).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "extraction-truncated")).toBe(true);
    expect(result.limitations.some((l) => /reference extraction truncated/i.test(l))).toBe(true);
    expect(result.references.length).toBeLessThanOrEqual(10_000);
  });
});

describe("parseSource: resilience", () => {
  it("reports grammar load failure as incomplete rather than throwing", async () => {
    // parseSource with a language whose grammar cannot load must fall back.
    // simulate via internal hook: use a path extension we support but force
    // the loader to fail through the exported test seam.
    const { _setGrammarLoaderForTests } = await import("../../packages/parsers/src/index.js");
    _setGrammarLoaderForTests(async () => {
      throw new Error("wasm unavailable");
    });
    try {
      const result = await parseSource("src/x.ts", "export const a = 1;\n");
      expect(result.complete).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: "grammar-load-failed" }),
      ]);
      expect(result.symbols).toEqual([]);
    } finally {
      _setGrammarLoaderForTests(undefined);
    }
  });

  it("handles empty sources", async () => {
    const result = await parseSource("src/empty.ts", "");
    expect(result.complete).toBe(true);
    expect(result.symbols).toEqual([]);
  });

  it("preserves a UTF-8 BOM in byte offsets and safe spans", async () => {
    // A leading U+FEFF is 3 UTF-8 bytes and is part of line 0's content, so it
    // shifts both the byte offset AND the byte column of everything after it.
    // Function node starts after BOM (3 bytes) + "export " (7) = byte 10,
    // column 10; its span starts at the export keyword, byte 3, column 0.
    const source = "\uFEFFexport function calc() { return 1; }\n";
    const result = await parseSource("src/bom.ts", source);
    expect(result.complete).toBe(true);
    const calc = result.symbols.find((s) => s.name === "calc")!;
    expect(calc.range.startByte).toBe(10);
    expect(calc.range.startColumn).toBe(10);
    expect(calc.span.startByte).toBe(3);
    expect(calc.span.startColumn).toBe(3);
    expectRangeText(source, calc.range, "function calc() { return 1; }");
    expectRangeText(source, calc.span, "export function calc() { return 1; }");
    const exportAtom = result.atoms.find((a) => a.kind === "export_statement")!;
    expect(exportAtom.range.startByte).toBe(3);
    expectRangeText(source, exportAtom.range, "export function calc() { return 1; }");
  });

  it("returns an explicit incomplete result for invalid-encoding bytes", () => {
    // The knowledge caller routes undecodable blobs here: no symbols, an
    // invalid-encoding diagnostic, and byte length preserved — never
    // replacement-decoded text.
    const result = invalidEncodingResult("src/bad.js", "invalid UTF-8 byte sequence", 14);
    expect(result.complete).toBe(false);
    expect(result.symbols).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "invalid-encoding" }),
    ]);
    expect(result.metadata.textLengthBytes).toBe(14);
  });
});
