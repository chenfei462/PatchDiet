import { cpSync, linkSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExampleRepo } from "./helpers/create-example-repo.js";

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
const owned: string[] = [];
let source: string;

async function call(cwd: string, ...args: string[]) {
  return execFileAsync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, PATCHDIET_TARGET_CWD: cwd },
    windowsHide: true,
  });
}

function copyRun(): string {
  const dir = mkdtempSync(join(tmpdir(), "patchdiet-feedback-v2-case-"));
  owned.push(dir);
  cpSync(source, dir, { recursive: true });
  return dir;
}

async function rejected(cwd: string, args: string[], phrase: RegExp) {
  await expect(call(cwd, ...args)).rejects.toMatchObject({ stderr: expect.stringMatching(phrase) });
}

describe("feedback bound to genuine shrink artifacts", () => {
  beforeAll(async () => {
    source = mkdtempSync(join(tmpdir(), "patchdiet-feedback-v2-source-"));
    owned.push(source);
    await createExampleRepo("ts-bloated-pr", source);
    await call(source, "shrink", "--base", "main", "--head", "agent/bloated", "--test", "node --test");
  }, 90000);

  afterAll(async () => {
    for (const dir of owned) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("emits the exact cleanup.diff byte hash with the report", () => {
    const report = JSON.parse(readFileSync(join(source, ".patchdiet", "run.json"), "utf8"));
    const patch = readFileSync(join(source, ".patchdiet", "cleanup.diff"));
    expect(report.cleanupDiffSha256).toBe(createHash("sha256").update(patch).digest("hex"));
    expect(report.candidates[0].contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("creates a signed runner receipt only from a genuine verified report and exact patch bytes", async () => {
    // @ts-expect-error Runtime .mjs module is intentionally tested without declarations.
    const { buildSignedRunnerReceipt } = await import("../../packages/github-app/src/runner-receipt.mjs");
    const cwd = copyRun();
    const report = JSON.parse(readFileSync(join(cwd, ".patchdiet", "run.json"), "utf8"));
    const context = { jobId: "preview-1", owner: "octocat", repo: "demo", repositoryId: 77, installationId: 9,
      pullNumber: 6, baseSha: report.baseCommitSha, headSha: report.headCommitSha };
    const result = buildSignedRunnerReceipt({ cwd, context, secret: "runner-secret" });
    expect(result.receipt.verification).toEqual({ exactArtifact: true, finalOraclePassed: true });
    expect(result.receipt.cleanupDiffSha256).toBe(report.cleanupDiffSha256);
    expect(result.signature).toBe(`sha256=${createHmac("sha256", "runner-secret").update(result.body).digest("hex")}`);
    writeFileSync(join(cwd, ".patchdiet", "cleanup.diff"), "tampered");
    expect(() => buildSignedRunnerReceipt({ cwd, context, secret: "runner-secret" })).toThrow(/patch|hash/i);
  });

  it("records and shows one explicit decision without changing Git refs or source", async () => {
    const cwd = copyRun();
    const report = JSON.parse(readFileSync(join(cwd, ".patchdiet", "run.json"), "utf8"));
    const before = await execFileAsync("git", ["for-each-ref", "--format=%(refname) %(objectname)"], { cwd });
    const sourcePath = join(cwd, report.candidates[0].filePath);
    const sourceBytes = readFileSync(sourcePath);
    const recorded = await call(cwd, "feedback", "record", "--candidate", "0", "--path", report.candidates[0].filePath, "--verdict", "accepted", "--note", "reviewed", "--json");
    const result = JSON.parse(recorded.stdout);
    expect(result.schemaVersion).toBe(2);
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0].candidateOrdinal).toBe(0);
    expect(result.feedback[0].verdict).toBe("accepted");
    expect(result.feedback[0].contentSha256).toBe(report.candidates[0].contentSha256);
    const shown = JSON.parse((await call(cwd, "feedback", "show", "--json")).stdout);
    expect(shown.feedback).toEqual(result.feedback);
    expect((await execFileAsync("git", ["for-each-ref", "--format=%(refname) %(objectname)"], { cwd })).stdout).toBe(before.stdout);
    expect(readFileSync(sourcePath)).toEqual(sourceBytes);
  });

  it("is idempotent for an identical event and refuses a conflicting verdict", async () => {
    const cwd = copyRun();
    const report = JSON.parse(readFileSync(join(cwd, ".patchdiet", "run.json"), "utf8"));
    const args = ["feedback", "record", "--candidate", "0", "--path", report.candidates[0].filePath, "--verdict", "accepted", "--json"];
    const first = JSON.parse((await call(cwd, ...args)).stdout);
    const second = JSON.parse((await call(cwd, ...args)).stdout);
    expect(second.feedback).toEqual(first.feedback);
    await rejected(cwd, ["feedback", "record", "--candidate", "0", "--path", report.candidates[0].filePath, "--verdict", "rejected"], /conflict|already recorded/i);
  });

  it("rejects unknown candidates, path mismatches, verdicts and oversized notes", async () => {
    const cwd = copyRun();
    const path = JSON.parse(readFileSync(join(cwd, ".patchdiet", "run.json"), "utf8")).candidates[0].filePath;
    await rejected(cwd, ["feedback", "record", "--candidate", "99999", "--path", path, "--verdict", "accepted"], /candidate/i);
    await rejected(cwd, ["feedback", "record", "--candidate", "0", "--path", "src/wrong.ts", "--verdict", "accepted"], /path/i);
    await rejected(cwd, ["feedback", "record", "--candidate", "0", "--path", path, "--verdict", "magic"], /verdict/i);
    await rejected(cwd, ["feedback", "record", "--candidate", "0", "--path", path, "--verdict", "accepted", "--note", "x".repeat(2001)], /note/i);
  });

  it("rejects a patch changed before the very first feedback decision", async () => {
    const cwd = copyRun();
    const path = JSON.parse(readFileSync(join(cwd, ".patchdiet", "run.json"), "utf8")).candidates[0].filePath;
    const patch = join(cwd, ".patchdiet", "cleanup.diff");
    writeFileSync(patch, Buffer.concat([readFileSync(patch), Buffer.from("tampered\n")]));
    await rejected(cwd, ["feedback", "record", "--candidate", "0", "--path", path, "--verdict", "accepted"], /hash|tamper|patch/i);
  });

  it("rejects old reports, missing reports, and hardlinked patch inputs", async () => {
    const old = copyRun();
    const reportPath = join(old, ".patchdiet", "run.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const path = report.candidates[0].filePath;
    delete report.cleanupDiffSha256;
    writeFileSync(reportPath, JSON.stringify(report));
    await rejected(old, ["feedback", "record", "--candidate", "0", "--path", path, "--verdict", "accepted"], /old|hash|emission/i);

    const missing = copyRun();
    const missingReport = join(missing, ".patchdiet", "run.json");
    await rm(missingReport);
    await rejected(missing, ["feedback", "show"], /report|run\.json/i);

    const linked = copyRun();
    const patch = join(linked, ".patchdiet", "cleanup.diff");
    linkSync(patch, join(linked, ".patchdiet", "second-link.diff"));
    await rejected(linked, ["feedback", "record", "--candidate", "0", "--path", path, "--verdict", "accepted"], /hardlink|link/i);
  });

  it("rejects a moved head ref while preserving the pinned report", async () => {
    const cwd = copyRun();
    const report = JSON.parse(readFileSync(join(cwd, ".patchdiet", "run.json"), "utf8"));
    await execFileAsync("git", ["update-ref", "refs/heads/agent/bloated", report.baseCommitSha], { cwd });
    await rejected(cwd, ["feedback", "record", "--candidate", "0", "--path", report.candidates[0].filePath, "--verdict", "accepted"], /head ref moved|stale/i);
  });

  it("rejects a report whose final verification identity contradicts the pinned run", async () => {
    const cwd = copyRun();
    const reportPath = join(cwd, ".patchdiet", "run.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    report.verification.final.baseCommitSha = report.headCommitSha;
    writeFileSync(reportPath, JSON.stringify(report));
    await rejected(cwd, ["feedback", "record", "--candidate", "0", "--path", report.candidates[0].filePath, "--verdict", "accepted"], /verification|base|identity/i);
  });

  it("serializes concurrent records without losing either candidate", async () => {
    const cwd = copyRun();
    const report = JSON.parse(readFileSync(join(cwd, ".patchdiet", "run.json"), "utf8"));
    expect(report.candidates.length).toBeGreaterThanOrEqual(2);
    await Promise.all([0, 1].map((ordinal) => call(cwd, "feedback", "record", "--candidate", String(ordinal),
      "--path", report.candidates[ordinal].filePath, "--verdict", "accepted")));
    const shown = JSON.parse((await call(cwd, "feedback", "show", "--json")).stdout);
    expect(shown.feedback.map((entry: { candidateOrdinal: number }) => entry.candidateOrdinal).sort()).toEqual([0, 1]);
  });

  it("rejects a redirected feedback store when the platform permits links", async () => {
    const cwd = copyRun();
    const elsewhere = mkdtempSync(join(tmpdir(), "patchdiet-feedback-v2-outside-"));
    owned.push(elsewhere);
    try { symlinkSync(elsewhere, join(cwd, ".patchdiet", "feedback"), process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      throw error;
    }
    const path = JSON.parse(readFileSync(join(cwd, ".patchdiet", "run.json"), "utf8")).candidates[0].filePath;
    await rejected(cwd, ["feedback", "record", "--candidate", "0", "--path", path, "--verdict", "accepted"], /symlink|junction|link/i);
  });

  it("rejects a stored decision whose candidate digest no longer matches the report", async () => {
    const cwd = copyRun();
    const path = JSON.parse(readFileSync(join(cwd, ".patchdiet", "run.json"), "utf8")).candidates[0].filePath;
    const result = JSON.parse((await call(cwd, "feedback", "record", "--candidate", "0", "--path", path, "--verdict", "accepted", "--json")).stdout);
    const storedPath = join(cwd, ".patchdiet", "feedback", `${result.runRef.reportSha256}.json`);
    const stored = JSON.parse(readFileSync(storedPath, "utf8"));
    stored.feedback[0].candidateSha256 = "0".repeat(64);
    writeFileSync(storedPath, JSON.stringify(stored));
    await rejected(cwd, ["feedback", "show"], /candidate|identity|digest/i);
  });

  it("uses two independently recorded runs only to prioritize eligible candidates", async () => {
    const cwd = copyRun();
    for (let run = 0; run < 2; run += 1) {
      if (run > 0) await call(cwd, "shrink", "--base", "main", "--head", "agent/bloated", "--test", "node --test");
      const report = JSON.parse(readFileSync(join(cwd, ".patchdiet", "run.json"), "utf8"));
      await call(cwd, "feedback", "record", "--candidate", "0", "--path", report.candidates[0].filePath, "--verdict", "accepted");
    }
    const ranked = JSON.parse((await call(cwd, "shrink", "--base", "main", "--head", "agent/bloated", "--test", "node --test", "--feedback-ranking", "--json")).stdout);
    expect(ranked.feedbackRanking.enabled).toBe(true);
    expect(ranked.feedbackRanking.supportThreshold).toBe(2);
    expect(ranked.feedbackRanking.prioritizedCandidates).toBeGreaterThan(0);
    expect(ranked.verification.final.status).toBe("passed");
    expect(ranked.verification.final.treesMatch).toBe(true);
  }, 150000);
});
