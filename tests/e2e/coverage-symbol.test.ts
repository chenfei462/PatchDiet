import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { openKnowledgeIndexReadonly } from "../../packages/knowledge/src/index.js";

const execFileAsync = promisify(execFile);

const owned: string[] = [];
afterEach(async () => {
  for (const dir of owned.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function gitSync(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function makeSymbolRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-symbol-cov-"));
  owned.push(cwd);
  gitSync(["init", "-b", "main"], cwd);
  gitSync(["config", "user.email", "test@patchdiet.local"], cwd);
  gitSync(["config", "user.name", "PatchDiet Tests"], cwd);
  gitSync(["config", "core.autocrlf", "false"], cwd);
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src/a.js"), "export function first(n) {\n  return n+1;\n}\n");
  writeFileSync(join(cwd, "src/b.js"), "export function second(n) {\n  return n+2;\n}\n");
  writeFileSync(
    join(cwd, "patchdiet.yaml"),
    JSON.stringify({ version: 2, base: "main", knowledge: { languages: ["javascript"] } })
  );
  writeFileSync(join(cwd, ".gitignore"), ".patchdiet/\n*.lcov\ncoverage-input.json\n");
  gitSync(["add", "-A"], cwd);
  gitSync(["commit", "-m", "coverage symbol fixture"], cwd);
  return cwd;
}

async function indexRepo(cwd: string, coverageFile?: string): Promise<{ databasePath: string; coverage: unknown }> {
  const cli = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
  const args = ["index", ...(coverageFile ? ["--coverage", coverageFile] : []), "--json"];
  const { stdout } = await execFileAsync("node", [cli, ...args], {
    cwd, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

function withDb<T>(databasePath: string, fn: (db: ReturnType<typeof openKnowledgeIndexReadonly>) => T): T {
  const db = openKnowledgeIndexReadonly(databasePath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

// 6-line function so lines 1..6 are all inside the symbol span.
function makeLongRepo(): string {
  const cwd = makeSymbolRepo();
  writeFileSync(
    join(cwd, "src/a.js"),
    "export function first(n) {\n  const one = n+1;\n  const two = one+1;\n  const three = two+1;\n  return three;\n}\n"
  );
  gitSync(["add", "src/a.js"], cwd);
  gitSync(["commit", "-m", "longer function"], cwd);
  return cwd;
}

describe("coverage symbol association semantics", () => {
  it("per-test intervals are included and clipped to the symbol span in a 1-based line basis", async () => {
    const cwd = makeSymbolRepo();
    writeFileSync(
      join(cwd, "coverage-input.json"),
      JSON.stringify({
        schemaVersion: 1,
        source: "explicit-test",
        tests: [{ name: "tests/a.test.js", files: ["src/a.js"], lines: { "src/a.js": [[2, 2]] } }],
      })
    );
    const out = await indexRepo(cwd, "coverage-input.json");
    withDb(out.databasePath, (db) => {
      const symbol = db.getSymbolCoverage("src/a.js").find((entry) => entry.name === "first");
      expect(symbol).toBeDefined();
      // Explicit per-test coverage participates in symbol evidence...
      expect(symbol!.coveredIntervals.some((interval) => interval.startLine <= 2 && interval.endLine >= 2)).toBe(true);
      // ...with its context retained per interval.
      expect(symbol!.coveredIntervals.some((interval) => interval.testName === "tests/a.test.js")).toBe(true);
    });

    // LCOV covering lines 1..4 (1-based); the symbol spans lines 1..3.
    writeFileSync(join(cwd, "a.lcov"), "SF:src/a.js\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,1\nend_of_record\n");
    const out2 = await indexRepo(cwd, "a.lcov");
    withDb(out2.databasePath, (db) => {
      for (const symbol of db.getSymbolCoverage("src/a.js")) {
        // 1-based basis: no fabricated line 0, no leak past the span end.
        for (const interval of symbol.coveredIntervals) {
          expect(interval.startLine).toBeGreaterThanOrEqual(symbol.startLine);
          expect(interval.endLine).toBeLessThanOrEqual(symbol.endLine);
        }
        expect(symbol.startLine).toBeGreaterThanOrEqual(1);
        const first = db.getSymbolCoverage("src/a.js").find((entry) => entry.name === "first")!;
        expect(first.coveredIntervals.some((interval) => interval.endLine > first.endLine)).toBe(false);
      }
    });
  });

  it("symbol provenance excludes coverage runs that measured a different file", async () => {
    const cwd = makeSymbolRepo();
    writeFileSync(join(cwd, "a.lcov"), "SF:src/a.js\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,1\nend_of_record\n");
    await indexRepo(cwd, "a.lcov");
    writeFileSync(join(cwd, "b.lcov"), "SF:src/b.js\nDA:2,1\nend_of_record\n");
    const out = await indexRepo(cwd, "b.lcov");
    withDb(out.databasePath, (db) => {
      const unrelated = db.getCoverageRuns().find((run) => run.sourcePath === "b.lcov");
      expect(unrelated).toBeDefined();
      const symbol = db.getSymbolCoverage("src/a.js").find((entry) => entry.name === "first");
      expect(symbol).toBeDefined();
      expect(symbol!.coverageRuns.some((run) => run.id === unrelated!.id)).toBe(false);
      // The b.js symbol DOES carry its own run.
      const second = db.getSymbolCoverage("src/b.js").find((entry) => entry.name === "second");
      expect(second!.coverageRuns.some((run) => run.id === unrelated!.id)).toBe(true);
    });
  });

  it("stale coverage runs do not authorize evidence after the measured blob changes", async () => {
    const cwd = makeSymbolRepo();
    writeFileSync(join(cwd, "a.lcov"), "SF:src/a.js\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,1\nend_of_record\n");
    await indexRepo(cwd, "a.lcov");
    writeFileSync(
      join(cwd, "src/a.js"),
      "export function first(n) {\n  const changed = n*100;\n  return changed;\n}\n"
    );
    gitSync(["add", "src/a.js"], cwd);
    gitSync(["commit", "-m", "change measured blob"], cwd);
    const out = await indexRepo(cwd);
    withDb(out.databasePath, (db) => {
      const symbol = db.getSymbolCoverage("src/a.js").find((entry) => entry.name === "first");
      expect(symbol).toBeDefined();
      expect(symbol!.coveredIntervals).toHaveLength(0);
      // The stale run remains LISTED with its commit provenance (queryable),
      // but carries no current evidence.
      expect(db.getCoverageRuns().length).toBeGreaterThan(0);
    });
  });

  it("repeated identical coverage input replaces rows deterministically (no cross-run duplication)", async () => {
    const cwd = makeSymbolRepo();
    writeFileSync(
      join(cwd, "coverage-input.json"),
      JSON.stringify({
        schemaVersion: 1,
        source: "repeat",
        tests: [{ name: "tests/a.test.js", files: ["src/a.js"], lines: { "src/a.js": [[2, 2]] } }],
      })
    );
    const first = await indexRepo(cwd, "coverage-input.json");
    // Query AFTER the FIRST ingestion: symbols must exist immediately, and a
    // repeated ingestion must not hit "duplicate column name" or lose rows.
    withDb(first.databasePath, (db) => {
      const symbol = db.getSymbolCoverage("src/a.js").find((entry) => entry.name === "first");
      expect(symbol).toBeDefined();
      expect(symbol!.coveredIntervals.some((interval) => interval.startLine === 2)).toBe(true);
      expect(db.getCoverageRuns().filter((run) => run.source === "repeat")).toHaveLength(1);
    });
    const out = await indexRepo(cwd, "coverage-input.json");
    withDb(out.databasePath, (db) => {
      const runs = db.getCoverageRuns().filter((run) => run.source === "repeat");
      expect(runs).toHaveLength(1);
      const intervals = db.getCoverageLineIntervals("src/a.js", "tests/a.test.js");
      expect(intervals).toHaveLength(1);
      expect(intervals[0]!.testName).toBe("tests/a.test.js");
      expect(intervals[0]!.startLine).toBe(2);
      expect(intervals[0]!.endLine).toBe(2);
      // Truthful provenance on raw interval rows: run id, commit and
      // current/stale classification.
      expect(intervals[0]!.runId).toBeGreaterThan(0);
      expect(intervals[0]!.indexedCommit).toBe(gitSync(["rev-parse", "HEAD"], cwd));
      expect(intervals[0]!.current).toBe(true);
    });
  });

  it("multiple runs measuring different files never cross-associate symbol provenance", async () => {
    const cwd = makeSymbolRepo();
    writeFileSync(join(cwd, "a.lcov"), "SF:src/a.js\nDA:2,1\nend_of_record\n");
    await indexRepo(cwd, "a.lcov");
    writeFileSync(join(cwd, "b.lcov"), "SF:src/b.js\nDA:2,1\nend_of_record\n");
    await indexRepo(cwd, "b.lcov");
    writeFileSync(join(cwd, "c.lcov"), "SF:src/a.js\nDA:3,1\nend_of_record\n");
    const out = await indexRepo(cwd, "c.lcov");
    withDb(out.databasePath, (db) => {
      const first = db.getSymbolCoverage("src/a.js").find((entry) => entry.name === "first")!;
      // Adjacent same-context intervals normalize to one covered range [2,3];
      // provenance must still prove BOTH a.lcov and c.lcov contributed, and
      // that b.lcov (a different file) did not.
      const covered = first.coveredIntervals.map((interval) => [interval.startLine, interval.endLine] as const);
      expect(covered).toEqual([[2, 3]]);
      const aRun = db.getCoverageRuns().find((run) => run.sourcePath === "a.lcov")!;
      const bRun = db.getCoverageRuns().find((run) => run.sourcePath === "b.lcov")!;
      const cRun = db.getCoverageRuns().find((run) => run.sourcePath === "c.lcov")!;
      const firstRunIds = new Set(first.coveredIntervals.flatMap((interval) => interval.runIds));
      expect(firstRunIds.has(aRun.id)).toBe(true);
      expect(firstRunIds.has(cRun.id)).toBe(true);
      expect(firstRunIds.has(bRun.id)).toBe(false);
    });
  });

  it("coverage queries on a schema1 database without ingestion return empty instead of throwing", async () => {
    const cwd = makeSymbolRepo();
    const out = await indexRepo(cwd);
    withDb(out.databasePath, (db) => {
      expect(db.getCoverageRuns()).toEqual([]);
      expect(db.getCoverageLineIntervals("src/a.js")).toEqual([]);
      expect(db.getCoverageLineIntervals("src/a.js", "tests/a.test.js")).toEqual([]);
      expect(db.getSymbolCoverage("src/a.js")).toEqual([]);
      // Existing schema1 queries keep working on the same readonly handle.
      expect(db.getTestMappings({ path: "src/a.js" })).toEqual([]);
    });
    // The readonly database file is unchanged (no mutation on open).
    const before = readFileSync(out.databasePath).byteLength;
    withDb(out.databasePath, (db) => {
      void db.getSymbolCoverage("src/a.js");
    });
    expect(readFileSync(out.databasePath).byteLength).toBe(before);
  });
});

describe("coverage staleness in test mappings", () => {
  it("getTestMappings excludes coverage-input rows from stale runs after the measured blob changes", async () => {
    const cwd = makeSymbolRepo();
    writeFileSync(
      join(cwd, "coverage-input.json"),
      JSON.stringify({
        schemaVersion: 1,
        source: "explicit-test",
        tests: [{ name: "tests/a.test.js", files: ["src/a.js"], lines: { "src/a.js": [[2, 2]] } }],
      })
    );
    const before = await indexRepo(cwd, "coverage-input.json");
    withDb(before.databasePath, (db) => {
      const current = db.getTestMappings({ path: "src/a.js" }).filter((row) => row.provenance === "coverage-input");
      expect(current.some((row) => row.testName === "tests/a.test.js" && row.indexed)).toBe(true);
    });

    // The measured blob changes and the repo is reindexed WITHOUT coverage:
    // the old run is history and must not feed current test mappings.
    writeFileSync(
      join(cwd, "src/a.js"),
      "export function first(n) {\n  const changed = n*100;\n  return changed;\n}\n"
    );
    gitSync(["add", "src/a.js"], cwd);
    gitSync(["commit", "-m", "change measured blob"], cwd);
    const after = await indexRepo(cwd);
    withDb(after.databasePath, (db) => {
      const mappings = db.getTestMappings({ path: "src/a.js" }).filter((row) => row.provenance === "coverage-input");
      expect(mappings).toHaveLength(0);
      // History remains queryable through the run list with its commit.
      const runs = db.getCoverageRuns().filter((run) => run.source === "explicit-test");
      expect(runs).toHaveLength(1);
      expect(runs[0]!.indexedCommit).not.toBe(gitSync(["rev-parse", "HEAD"], cwd));
      // Raw intervals remain queryable and are marked NOT current.
      const intervals = db.getCoverageLineIntervals("src/a.js", "tests/a.test.js");
      expect(intervals.length).toBeGreaterThan(0);
      expect(intervals.every((interval) => interval.current === false)).toBe(true);
    });

    // Re-ingesting coverage at the NEW commit restores current mappings.
    const renewed = await indexRepo(cwd, "coverage-input.json");
    withDb(renewed.databasePath, (db) => {
      const mappings = db.getTestMappings({ path: "src/a.js" }).filter((row) => row.provenance === "coverage-input");
      expect(mappings.some((row) => row.testName === "tests/a.test.js" && row.indexed)).toBe(true);
    });
  });
});

describe("coverage ingestion order independence", () => {


  it("reverse-order runs keep every contributing interval (no lost starts)", async () => {
    const cwd = makeLongRepo();
    writeFileSync(join(cwd, "high.lcov"), "SF:src/a.js\nDA:5,1\nend_of_record\n");
    await indexRepo(cwd, "high.lcov");
    writeFileSync(join(cwd, "low.lcov"), "SF:src/a.js\nDA:2,1\nend_of_record\n");
    const out = await indexRepo(cwd, "low.lcov");
    withDb(out.databasePath, (db) => {
      const symbol = db.getSymbolCoverage("src/a.js").find((entry) => entry.name === "first")!;
      const covered = symbol.coveredIntervals.map((interval) => [interval.startLine, interval.endLine] as const);
      expect(covered).toEqual([[2, 2], [5, 5]]);
      const highRun = db.getCoverageRuns().find((run) => run.sourcePath === "high.lcov")!;
      const lowRun = db.getCoverageRuns().find((run) => run.sourcePath === "low.lcov")!;
      const runIds = new Set(symbol.coveredIntervals.flatMap((interval) => interval.runIds));
      expect(runIds.has(highRun.id)).toBe(true);
      expect(runIds.has(lowRun.id)).toBe(true);
    });
  });

  it("overlapping same-context cross-run intervals merge with both runIds; contexts stay separate", async () => {
    const cwd = makeLongRepo();
    writeFileSync(join(cwd, "r1.lcov"), "SF:src/a.js\nDA:2,1\nDA:3,1\nDA:4,1\nend_of_record\n");
    await indexRepo(cwd, "r1.lcov");
    writeFileSync(join(cwd, "r2.lcov"), "SF:src/a.js\nDA:3,1\nDA:4,1\nDA:5,1\nDA:6,1\nend_of_record\n");
    await indexRepo(cwd, "r2.lcov");
    writeFileSync(
      join(cwd, "coverage-input.json"),
      JSON.stringify({
        schemaVersion: 1,
        source: "ctx",
        tests: [{ name: "tests/a.test.js", files: ["src/a.js"], lines: { "src/a.js": [[2, 2]] } }],
      })
    );
    const out = await indexRepo(cwd, "coverage-input.json");
    withDb(out.databasePath, (db) => {
      const symbol = db.getSymbolCoverage("src/a.js").find((entry) => entry.name === "first")!;
      const aggregate = symbol.coveredIntervals.filter((interval) => interval.testName === null);
      expect(aggregate.map((interval) => [interval.startLine, interval.endLine] as const)).toEqual([[2, 6]]);
      const r1 = db.getCoverageRuns().find((run) => run.sourcePath === "r1.lcov")!;
      const r2 = db.getCoverageRuns().find((run) => run.sourcePath === "r2.lcov")!;
      const aggregateRunIds = new Set(aggregate.flatMap((interval) => interval.runIds));
      expect(aggregateRunIds.has(r1.id)).toBe(true);
      expect(aggregateRunIds.has(r2.id)).toBe(true);
      const perTest = symbol.coveredIntervals.filter((interval) => interval.testName === "tests/a.test.js");
      expect(perTest.map((interval) => [interval.startLine, interval.endLine] as const)).toEqual([[2, 2]]);
      const ctxRun = db.getCoverageRuns().find((run) => run.sourcePath === "coverage-input.json")!;
      expect(ctxRun.tests).toBe(1);
      expect(ctxRun.perTestRows).toBe(1);
    });
  });
});

describe("coverage evidence reporting", () => {
  it("mixed aggregate/per-test union reports no fabricated symbol gaps", async () => {
    // 6-line function; aggregate covers 1,3,4 and the explicit per-test
    // context covers 2 and 5: union 1..5, gap only at 6? No — line 6 is
    // covered by the aggregate context too. Fixture mirrors the root review:
    // TN run covers 1,3,4,6; schema1 per-test covers 2; aggregate context
    // covers 5; the union must be 1..6 with NO fabricated gaps.
    const cwd = makeLongRepo();
    writeFileSync(join(cwd, "context.lcov"), "TN:test-all\nSF:src/a.js\nDA:1,1\nDA:3,1\nDA:4,1\nDA:6,1\nend_of_record\n");
    await indexRepo(cwd, "context.lcov");
    // A separate aggregate run covers line 5.
    writeFileSync(join(cwd, "plain.lcov"), "SF:src/a.js\nDA:5,1\nend_of_record\n");
    await indexRepo(cwd, "plain.lcov");
    writeFileSync(
      join(cwd, "coverage-input.json"),
      JSON.stringify({
        schemaVersion: 1,
        source: "mixed-ctx",
        tests: [{ name: "tests/b.test.js", files: ["src/a.js"], lines: { "src/a.js": [[2, 2]] } }],
      })
    );
    const out = await indexRepo(cwd, "coverage-input.json");
    withDb(out.databasePath, (db) => {
      const symbol = db.getSymbolCoverage("src/a.js").find((entry) => entry.name === "first")!;
      for (const line of [1, 2, 3, 4, 5, 6]) {
        expect(
          symbol.coveredIntervals.some((interval) => interval.startLine <= line && interval.endLine >= line),
          `missing covered line ${line}`
        ).toBe(true);
      }
      expect(symbol.uncoveredWithinSpan).toEqual([]);
      // Context provenance stays distinct: per-test interval intact.
      expect(symbol.coveredIntervals.some((interval) => interval.testName === "tests/b.test.js")).toBe(true);
    });
  });

  it("file-only schema1 mappings count as one distinct test identity", async () => {
    const cwd = makeSymbolRepo();
    writeFileSync(
      join(cwd, "coverage-input.json"),
      JSON.stringify({
        schemaVersion: 1,
        source: "file-only-count-review",
        tests: [{ name: "test-file-only", files: ["src/a.js"] }],
      })
    );
    const out = await indexRepo(cwd, "coverage-input.json");
    withDb(out.databasePath, (db) => {
      const run = db.getCoverageRuns().find((entry) => entry.source === "file-only-count-review");
      expect(run).toBeDefined();
      expect(run!.tests).toBe(1);
      expect(run!.perTestRows).toBe(0);
      // File-only mapping is still retrievable from the readonly index.
      expect(db.getTestMappings({ path: "src/a.js" }).some((row) => row.testName === "test-file-only")).toBe(true);
    });
  });
});
