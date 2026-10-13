import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { runShrink, clearInProcessCachesForTests } from "../../packages/core/src/shrink.js";
import type { ShrinkReport } from "../../packages/core/src/types.js";

const execFileAsync = promisify(execFile);

/** Shell-quoted absolute node binary: robust in any environment. */
const NODE = `"${process.execPath}"`;

const tempDirs: string[] = [];
const tempFiles: string[] = [];

afterEach(async () => {
  clearInProcessCachesForTests();
  for (const file of tempFiles.splice(0)) {
    await rm(file, { force: true, maxRetries: 5, retryDelay: 100 });
  }
  for (const dir of tempDirs.splice(0)) {
    // Bounded async cleanup: no unawaited recursive delete, no guessed paths.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

interface RepoFile {
  path: string;
  content: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}

/**
 * Creates a real Git repository: commit `baseFiles` on main, then commit
 * `headFiles` on agent/branch. Returns the repo directory.
 */
async function createRepo(
  label: string,
  baseFiles: RepoFile[],
  headFiles: RepoFile[],
  options: { testCommandScript?: string } = {}
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), `patchdiet-ast-${label}-`));
  tempDirs.push(dir);
  await git(dir, ["init", "-b", "main"]);
  await git(dir, ["config", "user.email", "test@patchdiet.local"]);
  await git(dir, ["config", "user.name", "PatchDiet Tests"]);
  // Deterministic byte offsets: no CRLF translation inside fixture repos.
  await git(dir, ["config", "core.autocrlf", "false"]);
  for (const file of baseFiles) {
    mkdirSync(dirname(join(dir, file.path)), { recursive: true });
    writeFileSync(join(dir, file.path), file.content, "utf8");
  }
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "base"]);
  await git(dir, ["checkout", "-b", "agent/feature"]);
  for (const file of headFiles) {
    mkdirSync(dirname(join(dir, file.path)), { recursive: true });
    writeFileSync(join(dir, file.path), file.content, "utf8");
  }
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "agent change"]);
  return dir;
}

const TOTAL_BASE = `// 中文😀 scope fixture\nexport function total(n) {\n  return n;\n}\n`;
const TOTAL_HEAD_DEBUG = `// 中文😀 scope fixture\nexport function total(n) {\n  const trace = { n };\n  console.error("injected-debug", trace);\n  return n * 2;\n}\n`;
const TOTAL_TEST = `import assert from "node:assert";\nimport { total } from "../src/total.mjs";\nassert.strictEqual(total(4), 8);\nassert.strictEqual(total(0), 0);\nconsole.log("ok");\n`;
const TASK = "Fix total(n) to return twice n. Debug logging and debug-only locals are unrelated to this task.";

async function shrink(dir: string, overrides: Partial<Parameters<typeof runShrink>[0]> = {}): Promise<ShrinkReport> {
  return runShrink({
    cwd: dir,
    baseRef: "main",
    headRef: "agent/feature",
    requiredCommands: [`${NODE} test/total.test.mjs`],
    strategy: "ddmin",
    atomGranularity: "ast",
    dryRun: false,
    ...overrides
  });
}

describe("runShrink — AST granularity, task-aware runtime", () => {
  it("applies feedback ordering only to eligible AST edits under a weak oracle", async () => {
    const dir = await createRepo("ranked-weak-oracle", [
      { path: "src/total.mjs", content: TOTAL_BASE },
      { path: "test/total.test.mjs", content: TOTAL_TEST }
    ], [
      { path: "src/total.mjs", content: TOTAL_HEAD_DEBUG },
      { path: "test/total.test.mjs", content: TOTAL_TEST }
    ]);
    const weak = [`${NODE} -e "process.exit(0)"`];
    const first = await shrink(dir, { taskText: TASK, requiredCommands: weak });
    const removable = first.candidates.find((candidate) => candidate.verdict === "removed");
    expect(removable?.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    const ranked = await shrink(dir, { taskText: TASK, requiredCommands: weak,
      feedbackRanking: { priorities: { [removable!.contentSha256!]: 2 }, recordsScanned: 2, diagnostics: [] } });
    expect(ranked.feedbackRanking?.prioritizedCandidates).toBeGreaterThan(0);
    expect(ranked.verification?.final.status).toBe("passed");
    const cleanup = readFileSync(ranked.patchPath!, "utf8");
    expect(cleanup).toContain("return n * 2");
    expect(cleanup).not.toContain("injected-debug");
  }, 90000);

  it("removes unrelated debug statements and keeps the required fix (task + scope gate)", async () => {
    const dir = await createRepo(
      "task-debug",
      [
        { path: "src/total.mjs", content: TOTAL_BASE },
        { path: "test/total.test.mjs", content: TOTAL_TEST }
      ],
      [
        { path: "src/total.mjs", content: TOTAL_HEAD_DEBUG },
        { path: "test/total.test.mjs", content: TOTAL_TEST }
      ]
    );

    const report = await shrink(dir, { taskText: TASK });

    expect(report.mode).toBe("verified");
    expect(report.reduction?.atomGranularity).toBe("ast");
    expect(report.reduction?.selectedGroupIds.length).toBeGreaterThan(0);

    const removalTargets = report.removals.map((item) => item.filePath);
    expect(removalTargets).toContain("src/total.mjs");
    // The delivered artifact keeps the fix and drops the debug statements.
    const cleanup = report.patchPath ? readFileSync(report.patchPath, "utf8") : "";
    expect(cleanup).not.toContain("injected-debug");
    expect(cleanup).toContain("return n * 2");
    // The reduced source is not fully reverted: the debug console call is gone.
    expect(cleanup).not.toContain("console.error");
  });

  it("retains task-required edits even when the user oracle is weak (always passes)", async () => {
    const dir = await createRepo(
      "weak-oracle",
      [
        { path: "src/total.mjs", content: TOTAL_BASE },
        { path: "test/total.test.mjs", content: TOTAL_TEST }
      ],
      [
        { path: "src/total.mjs", content: TOTAL_HEAD_DEBUG },
        { path: "test/total.test.mjs", content: TOTAL_TEST }
      ]
    );

    const report = await shrink(dir, {
      taskText: TASK,
      requiredCommands: [`${NODE} -e "process.exit(0)"`]
    });

    // The weak oracle passes every removal trial, but the task marks the fix
    // required: only the debug statements may be removed.
    const cleanup = report.patchPath ? readFileSync(report.patchPath, "utf8") : "";
    expect(cleanup).toContain("return n * 2");
    expect(cleanup).not.toContain("injected-debug");
    // The fix was retained: no "replace" edit is among the removals, and the
    // debug console call is gone from the delivered artifact.
    expect(report.removals.length).toBeGreaterThanOrEqual(1);
    expect(report.removals.map((item) => item.hunkHeader).join(" ")).not.toContain("replace");
    expect(cleanup).toContain("return n * 2");
  });

  it("keeps dependency-manifest and protected-path edits human review even when the oracle passes", async () => {
    const dir = await createRepo(
      "protected",
      [
        { path: "src/total.mjs", content: TOTAL_BASE },
        { path: "test/total.test.mjs", content: TOTAL_TEST },
        { path: "package.json", content: "{\n  \"name\": \"fixture\",\n  \"version\": \"1.0.0\"\n}\n" },
        { path: "db/migrations/001_init.sql", content: "CREATE TABLE t (id INTEGER);\n" }
      ],
      [
        { path: "src/total.mjs", content: TOTAL_HEAD_DEBUG },
        { path: "test/total.test.mjs", content: TOTAL_TEST },
        { path: "package.json", content: "{\n  \"name\": \"fixture\",\n  \"version\": \"1.0.0\",\n  \"debug\": true\n}\n" },
        { path: "db/migrations/002_add.sql", content: "ALTER TABLE t ADD COLUMN name TEXT;\n" }
      ]
    );

    const report = await shrink(dir, {
      taskText: TASK,
      protectPaths: ["db/migrations/**"],
      dependencyManifestsHumanReview: true
    });

    const cleanup = report.patchPath ? readFileSync(report.patchPath, "utf8") : "";
    // Manifest and migration changes are never auto-removed.
    expect(cleanup).toContain("package.json");
    expect(cleanup).toContain("002_add.sql");
    // The debug statements in the source file are still removable.
    expect(report.removals.some((item) => item.filePath === "src/total.mjs")).toBe(true);
  });

  it("retains one of two mutually redundant candidates (A/B)", async () => {
    // A and B are individually removable (the oracle falls back to the other
    // module) but removing BOTH breaks the oracle: the ddmin result must
    // retain one of them and still deliver a verified artifact.
    const baseUtil = `export const tag = "util";\n`;
    const doubleFn = `export function double(n) { return n * 2; }\n`;
    const test = `import assert from "node:assert";\nimport * as u1 from "../src/util1.mjs";\nimport * as u2 from "../src/util2.mjs";\nconst d = u1.double ?? u2.double;\nassert.strictEqual(d(4), 8);\nconsole.log("ok");\n`;
    const dir = await createRepo(
      "ab-redundant",
      [
        { path: "src/util1.mjs", content: baseUtil },
        { path: "src/util2.mjs", content: baseUtil },
        { path: "test/dup.test.mjs", content: test }
      ],
      [
        { path: "src/util1.mjs", content: baseUtil + doubleFn },
        { path: "src/util2.mjs", content: baseUtil + doubleFn },
        { path: "test/dup.test.mjs", content: test }
      ]
    );

    const report = await shrink(dir, {
      requiredCommands: [`${NODE} test/dup.test.mjs`]
    });

    expect(report.mode).toBe("verified");
    // Exactly one of the two redundant candidates survives.
    expect(report.removals).toHaveLength(1);
    const cleanup = report.patchPath ? readFileSync(report.patchPath, "utf8") : "";
    expect(cleanup).toContain("double");
  });

  it("keeps dependent edits when removing them alone or together breaks the oracle", async () => {
    const baseUtil = `export function helper(n) {\n  return n;\n}\n`;
    const headUtil = `export function helper(n) {\n  return n * 3;\n}\n`;
    const baseApp = `import { helper } from "./util.mjs";\nexport function main(n) {\n  return helper(n);\n}\n`;
    const headApp = `import { helper } from "./util.mjs";\nexport function main(n) {\n  console.error("debug-main", n);\n  return helper(n);\n}\n`;
    const test = `import assert from "node:assert";\nimport { main } from "../src/app.mjs";\nassert.strictEqual(main(2), 6);\nconsole.log("ok");\n`;
    const dir = await createRepo(
      "dependent",
      [
        { path: "src/util.mjs", content: baseUtil },
        { path: "src/app.mjs", content: baseApp },
        { path: "test/app.test.mjs", content: test }
      ],
      [
        { path: "src/util.mjs", content: headUtil },
        { path: "src/app.mjs", content: headApp },
        { path: "test/app.test.mjs", content: test }
      ]
    );

    const report = await shrink(dir, {
      taskText: "Make main double its input via helper. Debug logging is unrelated.",
      requiredCommands: [`${NODE} test/app.test.mjs`]
    });

    // The helper fix is required behavior (scope: requirement mentions it
    // indirectly via the oracle only — but debug logging is named unrelated).
    const cleanup = report.patchPath ? readFileSync(report.patchPath, "utf8") : "";
    expect(cleanup).toContain("n * 3");
    expect(cleanup).not.toContain("debug-main");
  });

  it("falls back to the hunk path with an explicit reason when AST parsing fails", async () => {
    const base = `export function ok() {\n  return 1;\n}\n`;
    const head = `export function ok() {\n  return 1;\n}\n}})\nfunction broken( {\n`;
    const dir = await createRepo(
      "syntax-fail",
      [
        { path: "src/broken.mjs", content: base },
        { path: "test/broken.test.mjs", content: `console.log("ok");\n` }
      ],
      [
        { path: "src/broken.mjs", content: head },
        { path: "test/broken.test.mjs", content: `console.log("ok");\n` }
      ]
    );

    const report = await shrink(dir, {
      requiredCommands: [`${NODE} test/broken.test.mjs`]
    });

    expect(report.partial).toBe(true);
    expect(report.partialReason).toContain("hunk fallback");
    // The broken file is preserved verbatim (human review), not auto-removed.
    const cleanup = report.patchPath ? readFileSync(report.patchPath, "utf8") : "";
    expect(cleanup).toContain("broken.mjs");
  });

  it("retains uncertain atoms when the task supplies no positive evidence (weak oracle)", async () => {
    const dir = await createRepo(
      "uncertain",
      [
        { path: "src/total.mjs", content: TOTAL_BASE },
        { path: "test/total.test.mjs", content: TOTAL_TEST }
      ],
      [{ path: "src/total.mjs", content: TOTAL_HEAD_DEBUG }]
    );

    const report = await shrink(dir, {
      taskText: "Improve reliability",
      requiredCommands: [`${NODE} -e "process.exit(0)"`]
    });

    // Vague task + weak oracle: no positive evidence, so nothing may be
    // removed with high confidence (independent-review contract parity).
    expect(report.removals).toHaveLength(0);
    expect(report.output.changedLineCount).toBe(report.input.changedLineCount);
  });

  it("retains all candidates when any changed file fell back to the hunk path", async () => {
    // A new file cannot go through AST paired edits (P0 whole-file policy);
    // its fallback makes the run partial, so unverified removals must be
    // retained everywhere (review finding 4).
    const dir = await createRepo(
      "fallback-blocks",
      [
        { path: "src/total.mjs", content: TOTAL_BASE },
        { path: "test/total.test.mjs", content: TOTAL_TEST }
      ],
      [
        { path: "src/total.mjs", content: TOTAL_HEAD_DEBUG },
        { path: "src/new-helper.mjs", content: `export const helper = () => 1;\n` }
      ]
    );

    const report = await shrink(dir, { taskText: TASK });

    expect(report.partial).toBe(true);
    expect(report.partialReason).toContain("whole-file/hunk policy");
    expect(report.removals).toHaveLength(0);
    const cleanup = report.patchPath ? readFileSync(report.patchPath, "utf8") : "";
    expect(cleanup).toContain("injected-debug");
    expect(cleanup).toContain("return n * 2");
  });

  it("delivers nothing when the final BASE artifact verification fails", async () => {
    const dir = await createRepo(
      "final-fail",
      [
        { path: "src/total.mjs", content: TOTAL_BASE },
        { path: "test/total.test.mjs", content: TOTAL_TEST }
      ],
      [
        { path: "src/total.mjs", content: TOTAL_HEAD_DEBUG },
        { path: "test/total.test.mjs", content: TOTAL_TEST }
      ],
    );
    // Oracle: passes in every worktree checked out at the pinned HEAD
    // (baseline, trials, combined) but FAILS in the final artifact worktree,
    // which is checked out at the pinned BASE. The gate is a real script file
    // (no nested `node -e` quoting) placed NEXT TO the fixture repo so it is
    // not part of the diff under test.
    const headSha = (await git(dir, ["rev-parse", "HEAD"])).trim();
    const gatePath = join(dirname(dir), `head-gate-final-fail.mjs`);
    writeFileSync(
      gatePath,
      [
        `import { execFileSync } from "node:child_process";`,
        `const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();`,
        `process.exit(sha === process.argv[2] ? 0 : 1);`,
        ``
      ].join("\n"),
      "utf8"
    );
    const headGate = `${NODE} "${gatePath}" ${headSha}`;
    tempFiles.push(gatePath);

    const report = await shrink(dir, {
      taskText: TASK,
      requiredCommands: [`${NODE} test/total.test.mjs`, headGate]
    });

    expect(report.mode).toBe("unverified");
    expect(report.verification?.final.status).toBe("failed");
    expect(report.removals).toHaveLength(0);
    expect(report.partial).toBe(true);
    const cleanup = report.patchPath ? readFileSync(report.patchPath, "utf8") : "";
    // Nothing was removed: the delivered patch retains ALL original changes.
    expect(cleanup).toContain("injected-debug");
    expect(cleanup).toContain("return n * 2");
  });

  it("records raw ddmin attempts with stable content keys and real verdicts", async () => {
    const dir = await createRepo(
      "attempts",
      [
        { path: "src/total.mjs", content: TOTAL_BASE },
        { path: "test/total.test.mjs", content: TOTAL_TEST }
      ],
      [
        { path: "src/total.mjs", content: TOTAL_HEAD_DEBUG },
        { path: "test/total.test.mjs", content: TOTAL_TEST }
      ]
    );

    const report = await shrink(dir, { taskText: TASK });

    expect(report.reduction?.attempts.length).toBeGreaterThan(0);
    for (const attempt of report.reduction?.attempts ?? []) {
      expect(attempt.key).toMatch(/[0-9a-f]{64}/);
      expect(["PASS", "FAIL", "INCONCLUSIVE"]).toContain(attempt.verdict);
      expect(attempt.ids.length).toBeGreaterThan(0);
    }
    // The selected groups match the removed report entries.
    const selectedMembers = (report.reduction?.dependencyGroups ?? [])
      .filter((group) => report.reduction?.selectedGroupIds.includes(group.id))
      .flatMap((group) => group.memberIds) ?? [];
    expect(selectedMembers.length).toBe(report.removals.length);
  });
});

describe("candidateSetKey — context+content keyed cache", () => {
  it("changes when the verification context changes", async () => {
    const { candidateSetKey } = await import("../../packages/core/src/reducer.js");
    const context = {
      baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      requiredCommands: ["node test"],
      environment: "env",
      toolVersion: "0.2.0"
    };
    const groups = [{ id: "grp-1", contentHash: "h1", memberIds: ["e1"] }];
    const same = candidateSetKey(context, groups);
    expect(candidateSetKey({ ...context }, groups)).toBe(same);
    expect(candidateSetKey({ ...context, requiredCommands: ["node other-test"] }, groups)).not.toBe(same);
    expect(candidateSetKey({ ...context, headSha: "cccccccccccccccccccccccccccccccccccccccc" }, groups)).not.toBe(same);
    expect(
      candidateSetKey(context, [{ id: "grp-1", contentHash: "h2", memberIds: ["e1"] }])
    ).not.toBe(same);
  });
});
