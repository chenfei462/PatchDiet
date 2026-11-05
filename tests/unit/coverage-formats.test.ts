import { describe, expect, it } from "vitest";

import {
  mergeLineIntervals,
  normalizeCoveredPath,
  parseCoverageInputAny,
} from "../../packages/knowledge/src/coverage.js";

describe("coverage format parsers", () => {
  it("parses schemaVersion:1 per-test input with optional caller-declared line intervals", () => {
    const parsed = parseCoverageInputAny(
      JSON.stringify({
        schemaVersion: 1,
        source: "reviewer-declared-per-test",
        tests: [{ name: "tests/a.test.js", files: ["src/a.js"], lines: { "src/a.js": [[1, 3]] } }],
      }),
      "/repo",
    );
    expect(parsed.format).toBe("schema1");
    expect(parsed.tests).toHaveLength(1);
    expect(parsed.tests[0]!.intervals["src/a.js"]).toEqual([[1, 3]]);
    expect(parsed.aggregate).toEqual({});
  });

  it("parses LCOV tracefiles; TN present is per-test, absent is aggregate", () => {
    const perTest = parseCoverageInputAny(
      ["TN:run-a", "SF:src/a.js", "DA:1,1", "DA:2,1", "DA:5,0", "end_of_record"].join("\n"),
      "/repo",
    );
    expect(perTest.format).toBe("lcov");
    expect(perTest.tests).toHaveLength(1);
    expect(perTest.tests[0]!.intervals["src/a.js"]).toEqual([[1, 2]]);
    expect(perTest.aggregate).toEqual({});

    const aggregate = parseCoverageInputAny(
      ["SF:src/a.js", "DA:1,1", "DA:2,1", "DA:3,1", "end_of_record"].join("\n"),
      "/repo",
    );
    expect(aggregate.tests).toHaveLength(0);
    expect(aggregate.aggregate["src/a.js"]).toEqual([[1, 3]]);
  });

  it("parses Istanbul JSON as aggregate line intervals", () => {
    const parsed = parseCoverageInputAny(
      JSON.stringify({
        "/repo/src/a.js": {
          statementMap: { "0": { start: { line: 1, column: 0 }, end: { line: 2, column: 5 } } },
          s: { "0": 2 },
        },
      }),
      "/repo",
    );
    expect(parsed.format).toBe("istanbul");
    expect(parsed.tests).toHaveLength(0);
    expect(parsed.aggregate["src/a.js"]).toEqual([[1, 2]]);
  });

  it("parses coverage.py JSON as aggregate line intervals", () => {
    const parsed = parseCoverageInputAny(
      JSON.stringify({ meta: {}, files: { "src/a.py": { executed_lines: [1, 2, 5], missing_lines: [3] } } }),
      "/repo",
    );
    expect(parsed.format).toBe("coverage-py");
    expect(parsed.aggregate["src/a.py"]).toEqual([[1, 2], [5, 5]]);
  });

  it("rejects malformed input with an explicit error naming the supported formats", () => {
    expect(() => parseCoverageInputAny("not json at all", "/repo")).toThrow(/supported formats/);
    expect(() => parseCoverageInputAny(JSON.stringify({ unknown: true }), "/repo")).toThrow(/supported formats/);
  });

  it("never maps outside-repository or traversal paths", () => {
    expect(normalizeCoveredPath("/elsewhere/src/a.js", "/repo")).toBeUndefined();
    expect(normalizeCoveredPath("../outside/a.js", "/repo")).toBeUndefined();
    expect(normalizeCoveredPath("src/a.js", "/repo")).toBe("src/a.js");
    expect(normalizeCoveredPath("file:///C:/repo/src/a.js", "C:/repo")).toBe("src/a.js");
  });

  it("merges line runs into closed intervals and drops invalid lines", () => {
    expect(mergeLineIntervals([5, 1, 2, 3, 0, -1, 2.5])).toEqual([[1, 3], [5, 5]]);
  });
});

// ── Probe-derived edge cases (coverage-parser-independent review) ──

describe("coverage parser edge cases", () => {
  it("rejects a DA record without an execution count instead of inventing one", () => {
    expect(() => parseCoverageInputAny("SF:src/a.js\nDA:2\nend_of_record\n", "/repo"))
      .toThrow(/count|malformed/i);
    expect(() => parseCoverageInputAny("SF:src/a.js\nDA:not-a-number,1\nend_of_record\n", "/repo"))
      .toThrow(/malformed/i);
    expect(() => parseCoverageInputAny("DA:2,1\n", "/repo")).toThrow(/outside an SF section/i);
  });

  it("merges repeated SF sections for the same file instead of overwriting", () => {
    const parsed = parseCoverageInputAny(
      ["SF:src/a.js", "DA:2,1", "end_of_record", "SF:src/a.js", "DA:6,1", "end_of_record"].join("\n"),
      "/repo",
    );
    expect(parsed.aggregate["src/a.js"]).toEqual([[2, 2], [6, 6]]);
    expect(parsed.tests).toHaveLength(0);
  });

  it("keeps LCOV zero-count lines out of measured intervals", () => {
    const parsed = parseCoverageInputAny("TN:test_a\nSF:src/a.js\nDA:2,1\nDA:6,0\nend_of_record\n", "/repo");
    expect(parsed.tests[0]!.intervals["src/a.js"]).toEqual([[2, 2]]);
  });

  it("retains explicit coverage.py contexts per test and keeps empty contexts aggregate", () => {
    const parsed = parseCoverageInputAny(
      JSON.stringify({
        meta: { format: 3, show_contexts: true },
        files: {
          "src/a.py": {
            executed_lines: [2, 6],
            contexts: { "2": ["tests/test_a.py::test_first|run"], "6": [""] },
          },
        },
      }),
      "/repo",
    );
    expect(parsed.tests.some((test) => test.name === "tests/test_a.py::test_first|run")).toBe(true);
    const test = parsed.tests.find((entry) => entry.name === "tests/test_a.py::test_first|run")!;
    expect(test.intervals["src/a.py"]).toEqual([[2, 2]]);
    // The empty-context line stays aggregate, never promoted to a test.
    expect(parsed.aggregate["src/a.py"]).toEqual([[6, 6]]);
  });

  it("uses interval arithmetic for Istanbul statements without silent truncation and rejects absurd spans", () => {
    const parsed = parseCoverageInputAny(
      JSON.stringify({
        "src/a.js": {
          statementMap: {
            "0": { start: { line: 2, column: 0 }, end: { line: 3, column: 1 } },
            "1": { start: { line: 6, column: 0 }, end: { line: 6, column: 5 } },
          },
          s: { "0": 1, "1": 0 },
        },
      }),
      "/repo",
    );
    expect(parsed.tests).toHaveLength(0);
    expect(parsed.aggregate["src/a.js"]).toEqual([[2, 3]]);
    expect(() =>
      parseCoverageInputAny(
        JSON.stringify({
          "src/huge.js": {
            statementMap: { "0": { start: { line: 1, column: 0 }, end: { line: 200000, column: 0 } } },
            s: { "0": 1 },
          },
        }),
        "/repo",
      ),
    ).toThrow(/malformed|spans/i);
  });
});

// ── Interior-line preservation + symbol review edge cases ──────────

describe("coverage interior lines and contexts", () => {
  it("coverage.py aggregate keeps interior lines of 5+ consecutive executions", () => {
    const parsed = parseCoverageInputAny(
      JSON.stringify({ meta: {}, files: { "src/a.py": { executed_lines: [1, 2, 3, 4, 5] } } }),
      "/repo",
    );
    expect(parsed.aggregate["src/a.py"]).toEqual([[1, 5]]);
  });

  it("coverage.py explicit contexts keep interior lines across 5+ consecutive executions", () => {
    const parsed = parseCoverageInputAny(
      JSON.stringify({
        meta: { show_contexts: true },
        files: {
          "src/a.py": {
            executed_lines: [1, 2, 3, 4, 5],
            contexts: {
              "1": ["t"], "2": ["t"], "3": ["t"], "4": ["t"], "5": ["t"],
            },
          },
        },
      }),
      "/repo",
    );
    expect(parsed.tests.some((test) => test.name === "t")).toBe(true);
    expect(parsed.tests.find((test) => test.name === "t")!.intervals["src/a.py"]).toEqual([[1, 5]]);
    expect(parsed.aggregate).toEqual({});
  });

  it("schema1 closed intervals keep interior lines without endpoint flattening", () => {
    const parsed = parseCoverageInputAny(
      JSON.stringify({
        schemaVersion: 1,
        source: "s",
        tests: [{ name: "t", files: ["src/a.js"], lines: { "src/a.js": [[2, 4]] } }],
      }),
      "/repo",
    );
    expect(parsed.tests[0]!.intervals["src/a.js"]).toEqual([[2, 4]]);
  });
});
