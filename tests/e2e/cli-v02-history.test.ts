import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";

import { createExampleRepo } from "./helpers/create-example-repo.js";

const execFileAsync = promisify(execFile);
const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0)) {
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const CLI = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");

function writeV2Config(cwd: string, mergedPrs: boolean, git = true): void {
  writeFileSync(
    join(cwd, "patchdiet.yaml"),
    [
      "version: 2",
      "base: main",
      "commands:",
      "  required: []",
      "reduction:",
      "  strategy: ddmin",
      "  atom_granularity: ast",
      "  dependency_grouping: true",
      "  final_verification: true",
      "  max_runtime_minutes: 20",
      "  retry_flaky_tests: 2",
      "verification:",
      "  targeted_first: false",
      "  full_required_at_end: true",
      "knowledge:",
      "  database: .patchdiet/semantic-index.db",
      "  languages: [typescript, javascript, python]",
      "  history:",
      `    git: ${git ? "true" : "false"}`,
      `    merged_prs: ${mergedPrs ? "true" : "false"}`,
      "scope:",
      "  ignore_paths: []",
      "report:",
      "  html: false",
      "  markdown: true",
      "  github_comment: false",
      "  json: true",
      "  evidence: true",
      "safety:",
      "  mode: local",
      "  allow_upload: false",
    ].join("\n"),
    "utf8",
  );
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFileAsync("git", ["-c", "user.email=patchdiet@example.com", "-c", "user.name=PatchDiet", ...args], { cwd })).stdout;
}

it("index ingests pinned history and verify reports it truthfully without writing", { timeout: 180000 }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-cli-history-"));
  owned.push(cwd);
  await createExampleRepo("ts-bloated-pr", cwd);
  writeV2Config(cwd, false);
  const env = { ...process.env, PATCHDIET_TARGET_CWD: cwd };

  const indexed = await execFileAsync("node", [CLI, "index", "--ref", "agent/bloated", "--json"], { cwd: process.cwd(), env });
  const indexResult = JSON.parse(indexed.stdout) as {
    history: { enabled: boolean; collected: boolean; commits: number; truncated: boolean; shallow: boolean };
  };
  expect(indexResult.history.enabled).toBe(true);
  expect(indexResult.history.collected).toBe(true);
  expect(indexResult.history.commits).toBe(2);
  expect(indexResult.history.truncated).toBe(false);
  expect(indexResult.history.shallow).toBe(false);

  const before = (await execFileAsync("git", ["status", "--porcelain"], { cwd })).stdout;

  const verified = await execFileAsync(
    "node",
    [CLI, "verify", "--base", "main", "--head", "agent/bloated", "--json"],
    { cwd: process.cwd(), env },
  );
  const report = JSON.parse(verified.stdout) as { graphDiagnostics: string[]; readOnly: boolean; oracleExecuted: boolean };
  expect(report.readOnly).toBe(true);
  expect(report.oracleExecuted).toBe(false);
  // Truthful: the old "history facts are not computed by this runtime" claim is
  // gone; with a current snapshot there is no unavailable diagnostic either.
  for (const diagnostic of report.graphDiagnostics) {
    expect(diagnostic).not.toMatch(/history facts are not computed by this runtime/);
    expect(diagnostic).not.toMatch(/no CURRENT pinned history snapshot/);
  }
  // No artifacts written, no working-tree mutation by verify.
  expect((await execFileAsync("git", ["status", "--porcelain"], { cwd })).stdout).toBe(before);
  expect(existsSync(join(cwd, ".patchdiet"))).toBe(true); // index database only (created by `index`)
});

it("merged-PR evidence enabled without a snapshot reports unavailable, never fabricated", { timeout: 180000 }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-cli-history-mpr-"));
  owned.push(cwd);
  await createExampleRepo("ts-bloated-pr", cwd);
  writeV2Config(cwd, true);
  const env = { ...process.env, PATCHDIET_TARGET_CWD: cwd };

  const indexed = await execFileAsync("node", [CLI, "index", "--ref", "agent/bloated", "--json"], { cwd: process.cwd(), env });
  const indexResult = JSON.parse(indexed.stdout) as {
    history: { mergedPrs: { enabled: boolean; available: boolean; ingested: number; diagnostics: string[] } };
  };
  expect(indexResult.history.mergedPrs.enabled).toBe(true);
  expect(indexResult.history.mergedPrs.available).toBe(false);
  expect(indexResult.history.mergedPrs.ingested).toBe(0);
  expect(indexResult.history.mergedPrs.diagnostics.join(" ")).toMatch(/unavailable/i);

  const verified = await execFileAsync(
    "node",
    [CLI, "verify", "--base", "main", "--head", "agent/bloated", "--json"],
    { cwd: process.cwd(), env },
  );
  const report = JSON.parse(verified.stdout) as { graphDiagnostics: string[] };
  expect(report.graphDiagnostics.join("\n")).toMatch(/merged_prs: enabled but unavailable/);
});

it("ingests a reachable caller-asserted merged-PR snapshot end to end", { timeout: 180000 }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-cli-history-mpr-ok-"));
  owned.push(cwd);
  await createExampleRepo("ts-bloated-pr", cwd);
  writeV2Config(cwd, true);
  // Create a genuine merge commit reachable from the new HEAD.
  await git(cwd, "checkout", "main");
  await git(cwd, "merge", "--no-ff", "-m", "Merge pull request #7 from agent/bloated", "agent/bloated");
  const mergeCommit = (await git(cwd, "rev-parse", "HEAD")).trim();
  mkdirSync(join(cwd, "docs"), { recursive: true });
  writeFileSync(
    join(cwd, "docs", "merged-prs.json"),
    JSON.stringify({
      schemaVersion: "patchdiet-merged-prs/1",
      records: [{ pr: "#7", mergeCommit, snapshotPath: "docs/pr-7.patch", labels: ["local-snapshot"] }],
    }),
    "utf8",
  );
  const env = { ...process.env, PATCHDIET_TARGET_CWD: cwd };

  const indexed = await execFileAsync("node", [CLI, "index", "--merged-prs", "docs/merged-prs.json", "--json"], { cwd: process.cwd(), env });
  const indexResult = JSON.parse(indexed.stdout) as {
    history: { mergedPrs: { available: boolean; ingested: number } };
  };
  expect(indexResult.history.mergedPrs.available).toBe(true);
  expect(indexResult.history.mergedPrs.ingested).toBe(1);

  const verified = await execFileAsync("node", [CLI, "verify", "--base", mergeCommit, "--head", mergeCommit, "--json"], {
    cwd: process.cwd(),
    env,
  });
  const report = JSON.parse(verified.stdout) as {
    graphDiagnostics: string[];
    evidence: { sourceId: string; polarity: string; detail: string; atomId?: string }[];
  };
  expect(report.graphDiagnostics.join("\n")).toMatch(/caller-asserted record\(s\)/);
  // The PR is CITABLE in the Scope Map: a global neutral history evidence
  // record carrying the real PR identity, full merge commit and input hash.
  const prRecord = report.evidence.find((record) => record.sourceId === "merged-pr:#7");
  expect(prRecord).toBeDefined();
  expect(prRecord?.polarity).toBe("neutral");
  expect(prRecord?.atomId).toBeUndefined();
  expect(prRecord?.detail).toContain(mergeCommit);
  expect(prRecord?.detail).toMatch(/sha256:[0-9a-f]{64}/);
  expect(prRecord?.detail).toContain("docs/merged-prs.json");
});

it("reports merged_prs enabled with history.git disabled explicitly in JSON and text", { timeout: 180000 }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-cli-history-flags-"));
  owned.push(cwd);
  await createExampleRepo("ts-bloated-pr", cwd);
  writeV2Config(cwd, true, false);
  const env = { ...process.env, PATCHDIET_TARGET_CWD: cwd };

  const indexed = await execFileAsync("node", [CLI, "index", "--json"], { cwd: process.cwd(), env });
  const indexResult = JSON.parse(indexed.stdout) as {
    history: { enabled: boolean; mergedPrs: { enabled: boolean; available: boolean; diagnostics: string[] } | null };
  };
  expect(indexResult.history.enabled).toBe(false);
  expect(indexResult.history.mergedPrs?.enabled).toBe(true);
  expect(indexResult.history.mergedPrs?.available).toBe(false);
  expect(indexResult.history.mergedPrs?.diagnostics.join(" ")).toMatch(/requires knowledge\.history\.git/i);

  // The text output keeps the enabled feature visible too (no silent skip).
  const textIndex = await execFileAsync("node", [CLI, "index"], { cwd: process.cwd(), env });
  expect(textIndex.stdout).toMatch(/Merged-PR diagnostic: .*merged_prs/);
  expect(textIndex.stdout).toMatch(/requires knowledge\.history\.git/i);

  const verified = await execFileAsync("node", [CLI, "verify", "--base", "main", "--head", "agent/bloated", "--json"], {
    cwd: process.cwd(),
    env,
  });
  const report = JSON.parse(verified.stdout) as { graphDiagnostics: string[] };
  expect(report.graphDiagnostics.join("\n")).toMatch(/knowledge\.history\.merged_prs: enabled but requires knowledge\.history\.git/);
});

it("refuses --merged-prs while merged-PR evidence is configured off (exit 1)", { timeout: 180000 }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-cli-history-mpr-off-"));
  owned.push(cwd);
  await createExampleRepo("ts-bloated-pr", cwd);
  writeV2Config(cwd, false);
  mkdirSync(join(cwd, "docs"), { recursive: true });
  writeFileSync(join(cwd, "docs", "merged-prs.json"), JSON.stringify({ schemaVersion: "patchdiet-merged-prs/1", records: [] }), "utf8");
  const env = { ...process.env, PATCHDIET_TARGET_CWD: cwd };

  let failed = false;
  try {
    await execFileAsync("node", [CLI, "index", "--merged-prs", "docs/merged-prs.json", "--json"], { cwd: process.cwd(), env });
  } catch (error) {
    failed = true;
    const err = error as { code?: number; stderr?: string };
    expect(err.code).toBe(1);
    expect(err.stderr ?? "").toMatch(/--merged-prs/);
    expect(err.stderr ?? "").toMatch(/^ERROR:/m);
  }
  expect(failed).toBe(true);
});
