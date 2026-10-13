import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { runShrink, clearInProcessCachesForTests } from "../../packages/core/src/shrink.js";
import type { ShrinkReport } from "../../packages/core/src/types.js";

const execFileAsync = promisify(execFile);

/** Shell-quoted absolute node binary: robust in any environment. */
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

function initRepo(label: string): string {
  const cwd = mkdtempSync(join(tmpdir(), `patchdiet-controls-${label}-`));
  gitSync(["init", "-b", "main"], cwd);
  gitSync(["config", "user.email", "test@patchdiet.local"], cwd);
  gitSync(["config", "user.name", "PatchDiet Tests"], cwd);
  gitSync(["config", "core.autocrlf", "false"], cwd);
  writeFileSync(join(cwd, ".gitignore"), ".patchdiet/\n");
  owned.push(cwd);
  return cwd;
}

const V2_CONFIG = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    version: 2,
    base: "main",
    language: "javascript",
    commands: { required: [`node check.cjs`], optional: [] },
    reduction: {
      strategy: "ddmin",
      atom_granularity: "hunk",
      dependency_grouping: false,
      final_verification: true,
      max_runtime_minutes: 2,
      retry_flaky_tests: 0
    },
    verification: { targeted_first: false, full_required_at_end: true },
    safety: {
      mode: "local",
      allow_upload: false,
      dependency_manifests: "human-review",
      unsupported_diff: "human-review"
    },
    ...overrides
  });

interface SimpleRepoOptions {
  config?: string;
  headValue?: string;
}

function makeSimpleRepo(label: string, options: SimpleRepoOptions = {}): string {
  const cwd = initRepo(label);
  writeFileSync(join(cwd, "value.txt"), "base\n");
  writeFileSync(
    join(cwd, "check.cjs"),
    "process.exit(require('fs').readFileSync('value.txt','utf8')==='head\\n'?0:1);\n"
  );
  writeFileSync(join(cwd, "patchdiet.yaml"), options.config ?? V2_CONFIG());
  gitSync(["add", "-A"], cwd);
  gitSync(["commit", "-m", "base"], cwd);
  gitSync(["checkout", "-b", "agent"], cwd);
  writeFileSync(join(cwd, "value.txt"), options.headValue ?? "head\n");
  gitSync(["add", "value.txt"], cwd);
  gitSync(["commit", "-m", "required fix"], cwd);
  return cwd;
}

async function cliShrink(cwd: string, extraArgs: string[] = []): Promise<{ status: number; stdout: string; stderr: string }> {
  const cli = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
  try {
    const { stdout } = await execFileAsync(
      "node",
      [cli, "shrink", "--base", "main", "--head", "agent", "--json", ...extraArgs],
      { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
    );
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// ── v2 report toggles ─────────────────────────────────────────────

describe("v2 report toggles", () => {
  it("disabled report formats produce no ghost artifacts while cleanup.diff stays mandatory", async () => {
    const cwd = makeSimpleRepo("reports-off", {
      config: V2_CONFIG({ report: { html: false, markdown: false, json: false, evidence: false, github_comment: false, github_check: false } })
    });
    const { status, stdout, stderr } = await cliShrink(cwd);
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const report = JSON.parse(stdout) as ShrinkReport;
    expect(report.mode).toBe("verified");
    // The cleanup patch and its mandatory final verification remain.
    expect(existsSync(join(cwd, ".patchdiet", "cleanup.diff"))).toBe(true);
    expect(report.verification?.final.status).toBe("passed");
    for (const name of ["run.json", "report.md", "report.html", "report.github.md", "scope.md", "evidence.md"]) {
      expect(existsSync(join(cwd, ".patchdiet", name))).toBe(false);
    }
    expect(report.reportPath).toBeUndefined();
    expect(report.reportJsonPath).toBeUndefined();
    for (const artifact of report.artifacts) {
      expect(artifact).not.toMatch(/report|run\.json|scope|evidence/i);
    }
  });

  it("stdout --json works even when the file json toggle is false, and enabled formats are written exactly once", async () => {
    const cwd = makeSimpleRepo("reports-mixed", {
      config: V2_CONFIG({ report: { html: false, markdown: true, json: false, evidence: true, github_comment: true, github_check: true } })
    });
    const { status, stdout } = await cliShrink(cwd);
    expect(status).toBe(0);
    const report = JSON.parse(stdout) as ShrinkReport;
    expect(existsSync(join(cwd, ".patchdiet", "report.md"))).toBe(true);
    expect(existsSync(join(cwd, ".patchdiet", "report.github.md"))).toBe(true);
    expect(existsSync(join(cwd, ".patchdiet", "evidence.md"))).toBe(true);
    expect(existsSync(join(cwd, ".patchdiet", "github-check.draft.md"))).toBe(true);
    expect(existsSync(join(cwd, ".patchdiet", "run.json"))).toBe(false);
    expect(existsSync(join(cwd, ".patchdiet", "report.html"))).toBe(false);
    expect(report.reportPath).toContain("report.md");
    expect(report.reportJsonPath).toBeUndefined();
    expect(report.githubCheckDraftPath).toContain("github-check.draft.md");
    // The github_check draft is an explicit LOCAL draft, never a publication.
    const draft = readFileSync(join(cwd, ".patchdiet", "github-check.draft.md"), "utf8");
    expect(draft).toContain("LOCAL ONLY");
    expect(draft).toContain("outside the PatchDiet CLI's");
  });
});

// ── v2 optional advisory commands ─────────────────────────────────

describe("v2 optional advisory commands", () => {
  it("executes configured optional commands and records a real failure as advisory", async () => {
    const markerDir = mkdtempSync(join(tmpdir(), "patchdiet-optional-marker-"));
    owned.push(markerDir);
    const marker = join(markerDir, "optional-marker.txt");
    const markerPath = marker.replaceAll("\\", "/");
    const cwd = initRepo("optional-advisory");
    writeFileSync(join(cwd, "value.txt"), "base\n");
    writeFileSync(
      join(cwd, "check.cjs"),
      "process.exit(require('fs').readFileSync('value.txt','utf8')==='head\\n'?0:1);\n"
    );
    const optional = `node -e "require('fs').writeFileSync('${markerPath}','ran');process.exit(3)"`;
    writeFileSync(
      join(cwd, "patchdiet.yaml"),
      V2_CONFIG({ commands: { required: ["node check.cjs"], optional: [optional] } })
    );
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "base"], cwd);
    gitSync(["checkout", "-b", "agent"], cwd);
    writeFileSync(join(cwd, "value.txt"), "head\n");
    gitSync(["add", "value.txt"], cwd);
    gitSync(["commit", "-m", "required fix"], cwd);

    const report = await runShrink({
      cwd,
      baseRef: "main",
      headRef: "agent",
      requiredCommands: ["node check.cjs"],
      strategy: "ddmin",
      atomGranularity: "hunk",
      optionalCommands: [optional]
    });
    // The optional command actually executed and its real failure was recorded.
    expect(readFileSync(marker, "utf8")).toBe("ran");
    expect(report.mode).toBe("verified"); // advisory failure never downgrades the required oracle
    const record = report.optionalCommands?.find((item) => item.command === optional);
    expect(record).toBeDefined();
    expect(record!.status).toBe("failed");
    expect(record!.exitCode).toBe(3);
    expect(record!.advisory).toBe(true);
    expect(JSON.stringify(report)).toMatch(/advisory|optional/i);
    expect(JSON.stringify(report)).toMatch(/failed|exitCode.*3/);
  });

  it("a mutating optional command invalidates the artifact fail-closed and preserves the live checkout", async () => {
    const cwd = makeSimpleRepo("optional-mutation");
    const report = await runShrink({
      cwd,
      baseRef: "main",
      headRef: "agent",
      requiredCommands: ["node check.cjs"],
      strategy: "ddmin",
      atomGranularity: "hunk",
      optionalCommands: [`node -e "require('fs').writeFileSync('value.txt','mutated\\n')"`]
    });
    expect(report.mode).not.toBe("verified");
    expect(report.partial).toBe(true);
    expect(report.removals).toHaveLength(0);
    const record = report.optionalCommands?.[0];
    expect(record?.mutatedTrackedSource).toBe(true);
    // The live checkout is untouched: advisories run in an isolated worktree.
    expect(readFileSync(join(cwd, "value.txt"), "utf8")).toBe("head\n");
    expect(gitSync(["status", "--porcelain"], cwd)).toBe("");
    expect(JSON.stringify(report)).toMatch(/mutat/i);
  });
});

// ── v2 targeted-first screening ───────────────────────────────────

describe("v2 targeted-first screening", () => {
  const content = (value: number, debug: number): string =>
    `exports.value = ${value};\n` + "\n".repeat(18) + `const debug = ${debug};\n`;

  function makeTargetedRepo(label: string, snapshotMarker: string): string {
    const cwd = initRepo(label);
    writeFileSync(join(cwd, "source.cjs"), content(1, 0));
    writeFileSync(join(cwd, "check.cjs"), "if(require('./source.cjs').value!==2) process.exit(7);\n");
    writeFileSync(
      join(cwd, "targeted.cjs"),
      `const fs=require('fs'); fs.appendFileSync(${JSON.stringify(snapshotMarker)},JSON.stringify(fs.readFileSync('source.cjs','utf8'))+'\\n'); process.exit(0);\n`
    );
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "base"], cwd);
    gitSync(["checkout", "-b", "agent"], cwd);
    writeFileSync(join(cwd, "source.cjs"), content(2, 1));
    gitSync(["add", "source.cjs"], cwd);
    gitSync(["commit", "-m", "required value fix with unrelated debug"], cwd);
    return cwd;
  }

  it("runs mapped tests on the actual removal state per trial; the full oracle stays authoritative", async () => {
    const marker = mkdtempSync(join(tmpdir(), "patchdiet-targeted-snap-"));
    owned.push(marker);
    const snapshotMarker = join(marker, "snapshots.jsonl");
    const cwd = makeTargetedRepo("targeted-trials", snapshotMarker);

    const report = await runShrink({
      cwd,
      baseRef: "main",
      headRef: "agent",
      requiredCommands: [`${NODE} check.cjs`],
      strategy: "ddmin",
      atomGranularity: "hunk",
      targetedFirst: true,
      testMappings: {
        provenance: "reviewer-labelled-static-mapping",
        mappings: { "source.cjs": [`${NODE} targeted.cjs`] }
      }
    });

    expect(report.mode).toBe("verified");
    expect(report.verification?.final.status).toBe("passed");
    expect(report.removals.length).toBeGreaterThan(0);
    // The targeted command ran on ACTUAL trial states: the rejected value
    // removal (value=1) AND the successful debug removal (value=2, debug=0).
    const snapshots = readFileSync(snapshotMarker, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string);
    expect(snapshots.some((text) => text.includes("exports.value = 1"))).toBe(true);
    expect(snapshots.some((text) => text.includes("exports.value = 2") && text.includes("const debug = 0"))).toBe(true);
    // Targeted PASSED for the value-hunk trial too — the full required oracle
    // (check.cjs exit 7) is what kept it. Full oracle remains the authority.
    expect(report.candidates.some((item) => item.verdict === "kept" && item.reason.includes("kept because '"))).toBe(true);
    expect(report.targetedVerification?.used).toBe(true);
    expect(report.targetedVerification?.commands).toContain(`${NODE} targeted.cjs`);
  });

  it("records an explicit full-oracle fallback when no mapping is available", async () => {
    const cwd = makeSimpleRepo("targeted-fallback");
    const report = await runShrink({
      cwd,
      baseRef: "main",
      headRef: "agent",
      requiredCommands: ["node check.cjs"],
      strategy: "ddmin",
      atomGranularity: "hunk",
      targetedFirst: true
    });
    expect(report.mode).toBe("verified");
    expect(report.targetedVerification).toBeDefined();
    expect(report.targetedVerification?.used).toBe(false);
    expect(report.targetedVerification?.outcome).toBe("skipped-no-mapping");
    expect(report.targetedVerification?.detail).toMatch(/fallback|no.mapping|no.reliable/i);
  });

  it("rejects a candidate whose mapped tests fail after the removal (targeted as screen only)", async () => {
    const cwd = initRepo("targeted-reject");
    // check.cjs is trivially satisfied; the mapped targeted test enforces the
    // value fix. Removing the value-change hunk must be rejected by TARGETED
    // screening (mapped test fails on the removal state).
    writeFileSync(join(cwd, "value.txt"), "base\n");
    writeFileSync(
      join(cwd, "check.cjs"),
      "process.exit(require('fs').readFileSync('value.txt','utf8')==='head\\n'?0:1);\n"
    );
    writeFileSync(
      join(cwd, "targeted.cjs"),
      "process.exit(require('fs').readFileSync('value.txt','utf8').includes('head')?0:1);\n"
    );
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "base"], cwd);
    gitSync(["checkout", "-b", "agent"], cwd);
    writeFileSync(join(cwd, "value.txt"), "head\n");
    gitSync(["add", "value.txt"], cwd);
    gitSync(["commit", "-m", "required fix"], cwd);

    // Both oracles are identical here, so the targeted result mirrors the
    // full oracle; this test pins that a targeted FAIL rejects the candidate
    // with the targeted reason (screen semantics), not a silent pass.
    const report = await runShrink({
      cwd,
      baseRef: "main",
      headRef: "agent",
      requiredCommands: [`${NODE} check.cjs`],
      strategy: "ddmin",
      atomGranularity: "hunk",
      targetedFirst: true,
      testMappings: {
        provenance: "unit-mapping",
        mappings: { "value.txt": [`${NODE} targeted.cjs`] }
      }
    });
    expect(report.removals).toHaveLength(0);
    expect(report.candidates.some((item) => item.reason.includes("targeted mapped tests failed"))).toBe(true);
  });
});

// ── v2 --final-verify switch ──────────────────────────────────────

describe("v2 --final-verify switch", () => {
  it("is accepted and the run records a passed final verification", async () => {
    const cwd = makeSimpleRepo("final-flag");
    const { status, stdout, stderr } = await cliShrink(cwd, ["--final-verify"]);
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const report = JSON.parse(stdout) as ShrinkReport;
    expect(report.mode).toBe("verified");
    expect(report.verification?.final.status).toBe("passed");
  });

  it("rejects an explicit disable attempt", async () => {
    const cwd = makeSimpleRepo("final-disable");
    const { status, stderr } = await cliShrink(cwd, ["--no-final-verify"]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("mandatory");
  });
});

// ── P0: transient oracle mutation cannot be hidden by a later command ──

describe("P0 transient oracle mutation", () => {
  it("fails closed when a required command repairs the source and a later one restores it", async () => {
    const cwd = makeSimpleRepo("transient-mutation");
    const node = `"${process.execPath}"`;
    const requiredCommands = [
      `${node} -e "const f=require('fs');f.writeFileSync('.oracle-backup',f.readFileSync('value.txt'));f.writeFileSync('value.txt','head\\n');process.exit(f.readFileSync('value.txt','utf8')==='head\\n'?0:1)"`,
      `${node} -e "const f=require('fs');f.writeFileSync('value.txt',f.readFileSync('.oracle-backup'));f.unlinkSync('.oracle-backup')"`
    ];
    const report = await runShrink({
      cwd,
      baseRef: "main",
      headRef: "agent",
      requiredCommands,
      dryRun: false
    });
    // The mutating oracle cannot authorize deletion, whatever the tree looked
    // like after the LAST command: the identity check runs after EVERY attempt.
    expect(report.removals).toHaveLength(0);
    expect(JSON.stringify(report)).toMatch(/tracked|mutat|source.identity/i);
    // Live checkout is untouched.
    expect(readFileSync(join(cwd, "value.txt"), "utf8")).toBe("head\n");
    expect(gitSync(["status", "--porcelain"], cwd)).toBe("");
  });
});

// ── P0: identity evidence records ─────────────────────────────────

describe("P0 oracle identity evidence", () => {
  it("records the real mutating attempt and explicit not-run rows for the rest", async () => {
    const { runVerificationStage } = await import("../../packages/core/src/shrink.js");
    const cwd = initRepo("identity-evidence");
    writeFileSync(join(cwd, "value.txt"), "base\n");
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "owned fixture"], cwd);
    const node = `"${process.execPath}"`;
    const commands = [
      `${node} -e "require('fs').writeFileSync('value.txt','head\\n');process.exit(0)"`,
      `${node} -e "require('fs').writeFileSync('value.txt','base\n');process.exit(0)"`
    ];
    const stage = await runVerificationStage(commands, cwd, {
      cwd,
      baseRef: "main",
      headRef: "HEAD",
      requiredCommands: commands,
      dryRun: false,
      retryFlakyTests: 0
    }, undefined);
    expect(stage.status).toBe("failed");
    expect(stage.detail ?? "").toMatch(/tracked|mutat|identity/i);
    expect(stage.commands).toHaveLength(2);
    expect(stage.commands[0]!.command).toBe(commands[0]);
    expect(stage.commands[0]!.attempts).toBe(1);
    expect(stage.commands[0]!.exitCode).toBe(0);
    expect(stage.commands[0]!.attemptRecords).toHaveLength(1);
    expect(stage.commands[0]!.attemptRecords![0]!.exitCode).toBe(0);
    expect(stage.commands[0]!.status).not.toBe("passed");
    expect(stage.commands[1]!.status).toBe("not-run");
    expect(stage.commands[1]!.attempts).toBe(0);
    // The restoring command never ran.
    expect(readFileSync(join(cwd, "value.txt"), "utf8")).toBe("head\n");
  });
});

// ── coarse mixed AST atom + weak oracle ───────────────────────────

describe("coarse mixed AST atom with weak oracle", () => {
  it("a coarse export wrapper covering the required symbol is never trialed on debug-subspan exclusion", async () => {
    const cwd = initRepo("coarse-weak-oracle");
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "package.json"), '{"type":"module"}\n');
    writeFileSync(join(cwd, "src/total.js"), "export function total(n) { return n; }\n");
    gitSync(["add", "-A"], cwd);
    gitSync(["commit", "-m", "base"], cwd);
    gitSync(["checkout", "-b", "agent"], cwd);
    writeFileSync(
      join(cwd, "src/total.js"),
      "export function total(n) {\n  const trace = {n};\n  console.error('injected-debug', trace);\n  return n * 2;\n}\n"
    );
    gitSync(["add", "src/total.js"], cwd);
    gitSync(["commit", "-m", "required task and unrelated debug"], cwd);

    const report = await runShrink({
      cwd,
      baseRef: "main",
      headRef: "agent",
      requiredCommands: [`${NODE} -e "process.exit(0)"`],
      strategy: "ddmin",
      atomGranularity: "ast",
      dependencyGrouping: true,
      taskText: "Fix total(n) to return twice n. Preserve the public function name. Debug logging and debug-only locals are unrelated to this task."
    });
    // The required behavior is retained on the delivered artifact even though
    // the weak oracle passes every trial.
    const cleanup = report.patchPath ? readFileSync(report.patchPath, "utf8") : "";
    const reduced = cleanup
      ? cleanup
      : "";
    void reduced;
    expect(report.removals).toHaveLength(0);
    expect(report.candidates.some((item: { reason: string }) => item.reason.includes("mixed evidence"))).toBe(true);
  });
});
