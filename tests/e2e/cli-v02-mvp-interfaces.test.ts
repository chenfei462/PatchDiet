import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { openKnowledgeIndexReadonly } from "../../packages/knowledge/src/index.js";
import { runShrink, clearInProcessCachesForTests } from "../../packages/core/src/shrink.js";

const execFileAsync = promisify(execFile);
const NODE = `"${process.execPath}"`;

const owned: string[] = [];
afterEach(async () => {
  clearInProcessCachesForTests();
  for (const dir of owned.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function gitSync(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

interface Snapshot {
  refs: string;
  status: string;
  worktrees: string;
  trackedBytes: string;
}

function snapshot(cwd: string): Snapshot {
  return {
    refs: gitSync(["for-each-ref"], cwd),
    status: gitSync(["status", "--porcelain"], cwd),
    worktrees: gitSync(["worktree", "list", "--porcelain"], cwd),
    trackedBytes: gitSync(["ls-files", "-s"], cwd) + gitSync(["rev-parse", "HEAD"], cwd),
  };
}

function assertSnapshotUnchanged(cwd: string, before: Snapshot): void {
  const after = snapshot(cwd);
  expect(after.status).toBe(before.status);
  expect(after.refs).toBe(before.refs);
  expect(after.worktrees).toBe(before.worktrees);
  expect(after.trackedBytes).toBe(before.trackedBytes);
}

function makeDebugRepo(label: string): string {
  const cwd = mkdtempSync(join(tmpdir(), `patchdiet-mvp-${label}-`));
  owned.push(cwd);
  gitSync(["init", "-b", "main"], cwd);
  gitSync(["config", "user.email", "test@patchdiet.local"], cwd);
  gitSync(["config", "user.name", "PatchDiet Tests"], cwd);
  gitSync(["config", "core.autocrlf", "false"], cwd);
  writeFileSync(join(cwd, ".gitignore"), ".patchdiet/\ncoverage-input.json\naggregate.lcov\n");
  writeFileSync(join(cwd, "package.json"), '{"type":"module"}\n');
  mkdirSrc(cwd);
  writeFileSync(join(cwd, "src/total.js"), "export function total(n) {\n  return n;\n}\n");
  gitSync(["add", "-A"], cwd);
  gitSync(["commit", "-m", "base"], cwd);
  gitSync(["checkout", "-b", "agent"], cwd);
  writeFileSync(
    join(cwd, "src/total.js"),
    "export function total(n) {\n  const trace = {n};\n  console.error('injected-debug', trace);\n  return n * 2;\n}\n"
  );
  gitSync(["add", "src/total.js"], cwd);
  gitSync(["commit", "-m", "task fix with unrelated debug"], cwd);
  return cwd;
}

function mkdirSrc(cwd: string): void {
  mkdirSync(join(cwd, "src"), { recursive: true });
}

async function runCli(cwd: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  const cli = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
  try {
    const { stdout } = await execFileAsync("node", [cli, ...args], {
      cwd, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const TASK = "Fix total(n) to return twice n. Preserve the public function name. Debug logging and debug-only locals are unrelated to this task.";

// ── Public AST identity through readonly verify/explain ───────────

describe("public AST atom identity", () => {
  it("explain resolves actual selected shrink AST atom ids with provenance, read-only", async () => {
    const cwd = makeDebugRepo("explain-identity");
    const shrink = await runShrink({
      cwd,
      baseRef: "main",
      headRef: "agent",
      requiredCommands: [`${NODE} -e "process.exit(0)"`],
      strategy: "ddmin",
      atomGranularity: "ast",
      taskText: TASK
    });
    expect(shrink.mode).toBe("verified");
    const selected = new Set(shrink.reduction?.selectedGroupIds ?? []);
    const ids = (shrink.reduction?.dependencyGroups ?? [])
      .filter((group) => selected.has(group.id))
      .flatMap((group) => group.memberIds);
    expect(ids.length).toBeGreaterThan(0);

    const before = snapshot(cwd);
    for (const atomId of ids) {
      const { status, stdout, stderr } = await runCli(cwd, [
        "explain", "--base", "main", "--head", "agent", "--task", TASK, "--atom", atomId, "--json"
      ]);
      expect(stderr).toBe("");
      expect(status).toBe(0);
      const explanations = JSON.parse(stdout) as { atomId?: string; found: boolean }[];
      expect(explanations.some((item) => item.atomId === atomId && item.found)).toBe(true);
    }
    assertSnapshotUnchanged(cwd, before);
    // Byte-span provenance is surfaced in the report diagnostics.
    const verify = await runCli(cwd, ["verify", "--base", "main", "--head", "agent", "--task", TASK, "--json"]);
    expect(verify.stdout).toMatch(/AST atom .*base bytes \[/);
    expect(verify.stdout).toMatch(/shared pinned-diff atomizer/);
  });

  it("falls back with an explicit diagnostic when persisted evidence is stale", async () => {
    const cwd = makeDebugRepo("explain-stale");
    await runShrink({
      cwd,
      baseRef: "main",
      headRef: "agent",
      requiredCommands: [`${NODE} -e "process.exit(0)"`],
      strategy: "ddmin",
      atomGranularity: "ast",
      taskText: TASK
    });
    // Move HEAD so the persisted run.json no longer matches the pinned refs.
    writeFileSync(join(cwd, "extra.txt"), "more\n");
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "advance head"], cwd);
    const { stdout } = await runCli(cwd, ["verify", "--base", "main", "--head", "HEAD", "--task", TASK, "--json"]);
    expect(stdout).toMatch(/persisted shrink evidence \(\.patchdiet\/run\.json\) is stale/);
  });

  it("falls back conservatively for unsupported parses", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "patchdiet-mvp-parse-fail-"));
    owned.push(cwd);
    gitSync(["init", "-b", "main"], cwd);
    gitSync(["config", "user.email", "test@patchdiet.local"], cwd);
    gitSync(["config", "user.name", "PatchDiet Tests"], cwd);
    gitSync(["config", "core.autocrlf", "false"], cwd);
    writeFileSync(join(cwd, ".gitignore"), ".patchdiet/\n");
    mkdirSrc(cwd);
    writeFileSync(join(cwd, "src/broken.js"), "export function ok() {\n  return 1;\n}\n");
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "base"], cwd);
    gitSync(["checkout", "-b", "agent"], cwd);
    writeFileSync(join(cwd, "src/broken.js"), "export function ok() {\n  return 1;\n}\n}})\nfunction broken( {\n");
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "broken"], cwd);
    writeFileSync(join(cwd, "patchdiet.yaml"), "version: 2\nbase: main\nreduction:\n  atom_granularity: ast\n");
    const { stdout } = await runCli(cwd, ["verify", "--base", "main", "--head", "agent", "--json"]);
    expect(stdout).toMatch(/AST parse incomplete for src\/broken\.js.*hunk fallback/);
  });
});

// ── Coverage ingestion route ──────────────────────────────────────

describe("coverage ingestion", () => {
  it("ingests per-test schema1 input via the CLI and reports aggregate runs without fake tests", async () => {
    const cwd = makeDebugRepo("coverage");
    // Untracked, gitignored input: ingestion must not dirty the checkout.
    writeFileSync(
      join(cwd, "coverage-input.json"),
      JSON.stringify({
        schemaVersion: 1,
        source: "reviewer-declared-per-test",
        tests: [{ name: "tests/total.test.js", files: ["src/total.js"] }]
      })
    );
    const before = snapshot(cwd);
    const { status, stdout, stderr } = await runCli(cwd, ["index", "--coverage", "coverage-input.json", "--json"]);
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const result = JSON.parse(stdout) as {
      repo: { commit: string };
      coverage: { source: string; format: string; tests: number; diagnostics: string[] };
      databasePath: string;
    };
    expect(result.repo.commit).toBe(gitSync(["rev-parse", "HEAD"], cwd));
    expect(result.coverage.format).toBe("schema1");
    expect(result.coverage.tests).toBe(1);
    const db = openKnowledgeIndexReadonly(result.databasePath);
    try {
      const mappings = db.getTestMappings({ path: "src/total.js" });
      expect(mappings.some((row) => row.testName === "tests/total.test.js" && row.provenance === "coverage-input")).toBe(true);
      // Aggregate LCOV ingestion adds NO per-test mapping rows.
      writeFileSync(join(cwd, "aggregate.lcov"), ["SF:src/total.js", "DA:1,1", "DA:2,1", "end_of_record"].join("\n"));
      const aggregate = await runCli(cwd, ["index", "--coverage", "aggregate.lcov", "--json"]);
      expect(aggregate.status).toBe(0);
      const aggregateResult = JSON.parse(aggregate.stdout) as { coverage: { format: string; tests: number; aggregateFiles: number } };
      expect(aggregateResult.coverage.format).toBe("lcov");
      expect(aggregateResult.coverage.tests).toBe(0);
      expect(aggregateResult.coverage.aggregateFiles).toBe(1);
      const mappingsAfter = db.getTestMappings({ path: "src/total.js" });
      expect(mappingsAfter.filter((row) => row.provenance === "coverage-input")).toHaveLength(1);
      // Aggregate intervals are queryable and explicitly aggregate.
      const intervals = db.getCoverageLineIntervals("src/total.js");
      expect(intervals.every((interval) => interval.testName === null)).toBe(true);
      expect(intervals.length).toBeGreaterThan(0);
      // Symbol association: pinned symbol spans intersect recorded intervals.
      const symbolCoverage = db.getSymbolCoverage("src/total.js");
      const total = symbolCoverage.find((symbol) => symbol.name === "total");
      expect(total).toBeDefined();
      expect(total!.coveredIntervals.length).toBeGreaterThan(0);
      expect(total!.coverageRuns.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
    // The index database is gitignored; the tracked checkout stays clean.
    expect(gitSync(["status", "--porcelain"], cwd)).toBe("");
    void before;
  });

  it("records stale/unmapped coverage paths as explicit diagnostics", async () => {
    const cwd = makeDebugRepo("coverage-stale");
    writeFileSync(
      join(cwd, "coverage-input.json"),
      JSON.stringify({
        schemaVersion: 1,
        source: "stale-run",
        tests: [{ name: "tests/ghost.test.js", files: ["src/deleted-elsewhere.js"] }]
      })
    );
    const { status, stdout } = await runCli(cwd, ["index", "--coverage", "coverage-input.json", "--json"]);
    expect(status).toBe(0);
    const result = JSON.parse(stdout) as { coverage: { diagnostics: string[] } };
    expect(result.coverage.diagnostics.some((line) => line.includes("src/deleted-elsewhere.js") && line.includes("not present in the pinned index"))).toBe(true);
  });

  it("rejects malformed coverage input with a bounded error", async () => {
    const cwd = makeDebugRepo("coverage-malformed");
    writeFileSync(join(cwd, "coverage-input.json"), "this is not coverage");
    const { status, stderr } = await runCli(cwd, ["index", "--coverage", "coverage-input.json", "--json"]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/supported formats|valid JSON/);
  });
});

// ── Runtime field audit: allow_format_only_removal ────────────────

describe("runtime field audit", () => {
  it("scope.allow_format_only_removal=false keeps format-only hunks in human review", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "patchdiet-mvp-format-only-"));
    owned.push(cwd);
    gitSync(["init", "-b", "main"], cwd);
    gitSync(["config", "user.email", "test@patchdiet.local"], cwd);
    gitSync(["config", "user.name", "PatchDiet Tests"], cwd);
    gitSync(["config", "core.autocrlf", "false"], cwd);
    writeFileSync(join(cwd, ".gitignore"), ".patchdiet/\n");
    // Whitespace-only change: base "head" -> head "head  " (trailing spaces).
    // The oracle compares trimmed content so it genuinely passes at HEAD.
    writeFileSync(join(cwd, "value.txt"), "head\n");
    writeFileSync(join(cwd, "check.cjs"), "process.exit(require('fs').readFileSync('value.txt','utf8').trim()==='head'?0:1);\n");
    writeFileSync(
      join(cwd, "patchdiet.yaml"),
      "version: 2\nbase: main\ncommands:\n  required:\n    - node check.cjs\nscope:\n  allow_format_only_removal: false\n"
    );
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "base"], cwd);
    gitSync(["checkout", "-b", "agent"], cwd);
    writeFileSync(join(cwd, "value.txt"), "head  \n");
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "format change (whitespace only)"], cwd);

    const report = await runShrink({
      cwd,
      baseRef: "main",
      headRef: "agent",
      requiredCommands: ["node check.cjs"],
      strategy: "conservative",
      atomGranularity: "hunk",
      allowFormatOnlyRemoval: false
    });
    expect(report.mode).toBe("verified");
    expect(report.removals).toHaveLength(0);
    expect(report.candidates.some((item) => item.reason.includes("format-only change kept for human review"))).toBe(true);
  });

  it("keeps a protected format-only hunk when its file also has an eligible hunk", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "patchdiet-mvp-mixed-format-"));
    owned.push(cwd);
    gitSync(["init", "-b", "main"], cwd);
    gitSync(["config", "user.email", "test@patchdiet.local"], cwd);
    gitSync(["config", "user.name", "PatchDiet Tests"], cwd);
    gitSync(["config", "core.autocrlf", "false"], cwd);
    writeFileSync(join(cwd, ".gitignore"), ".patchdiet/\n");
    const filler = Array.from({ length: 12 }, (_, index) => `stable ${index}`).join("\n");
    writeFileSync(join(cwd, "value.txt"), `head\n${filler}\nextra\n`);
    writeFileSync(join(cwd, "check.cjs"), "process.exit(require('fs').readFileSync('value.txt','utf8').split('\\n')[0].trim()==='head'?0:1);\n");
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "base"], cwd);
    gitSync(["checkout", "-b", "agent"], cwd);
    writeFileSync(join(cwd, "value.txt"), `head  \n${filler}\nextra changed\n`);
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "mixed changes"], cwd);
    const report = await runShrink({ cwd, baseRef: "main", headRef: "agent", requiredCommands: ["node check.cjs"],
      strategy: "conservative", atomGranularity: "hunk", allowFormatOnlyRemoval: false });
    const patch = readFileSync(join(cwd, ".patchdiet", "cleanup.diff"), "utf8");
    expect(report.candidates.some((item) => item.reason.includes("format-only change kept for human review"))).toBe(true);
    expect(patch).toContain("+head  ");
    expect(report.verification?.final.status).toBe("passed");
  }, 60000);

  it("emits truthful unavailable-mode diagnostics for configured history sources", async () => {
    const cwd = makeDebugRepo("history-audit");
    writeFileSync(
      join(cwd, "patchdiet.yaml"),
      "version: 2\nbase: main\nknowledge:\n  history:\n    git: true\n    merged_prs: true\n"
    );
    const { stdout } = await runCli(cwd, ["verify", "--base", "main", "--head", "agent", "--task", TASK, "--json"]);
    // Task 1: history IS computed from a current pinned index. With no index
    // present here, the report must say exactly that — no evidence attached.
    expect(stdout).toMatch(/knowledge\.history\.git: enabled but no CURRENT pinned history snapshot is available/);
    expect(stdout).toMatch(/knowledge\.history\.merged_prs: enabled but unavailable/);
  });
});
