import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assertRunOwnedPath, writeOutputFileAtomic } from "./safe-output.js";

const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const VERDICTS = new Set(["accepted", "rejected", "wrong_scope", "uncertain"]);
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_PATCH_BYTES = 20 * 1024 * 1024;
const MAX_FEEDBACK_BYTES = 4 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface FeedbackEntry {
  candidateOrdinal: number;
  candidateSha256: string;
  contentSha256: string;
  path: string;
  verdict: "accepted" | "rejected" | "wrong_scope" | "uncertain";
  note?: string;
  reviewedAt: string;
}

export interface FeedbackFile {
  schemaVersion: 2;
  runRef: {
    repositoryRootSha256: string;
    baseCommitSha: string;
    headCommitSha: string;
    reportSha256: string;
    cleanupDiffSha256: string;
  };
  feedback: FeedbackEntry[];
}

interface RunContext {
  root: string;
  storePath: string;
  runRef: FeedbackFile["runRef"];
  candidates: Record<string, unknown>[];
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function candidateContentSha256(filePath: string, hunk: { header: string; lines: unknown[] }): string {
  return sha256(JSON.stringify(["hunk-v1", filePath, hunk.header, hunk.lines]));
}

/** Advisory ordering only: two distinct runs must agree, and a rejection vetoes priority. */
export function computeFeedbackPriorities(files: FeedbackFile[], repositoryRootSha256: string): Record<string, number> {
  const byContent = new Map<string, Map<string, "accepted" | "rejected">>();
  for (const file of files) {
    if (file.schemaVersion !== 2 || file.runRef.repositoryRootSha256 !== repositoryRootSha256 ||
        !HASH.test(file.runRef.reportSha256)) continue;
    for (const entry of file.feedback) {
      if (!HASH.test(entry.contentSha256) || (entry.verdict !== "accepted" && entry.verdict !== "rejected")) continue;
      let byRun = byContent.get(entry.contentSha256);
      if (!byRun) { byRun = new Map(); byContent.set(entry.contentSha256, byRun); }
      const previous = byRun.get(file.runRef.reportSha256);
      byRun.set(file.runRef.reportSha256, entry.verdict === "rejected" || previous === "rejected" ? "rejected" : "accepted");
    }
  }
  const priorities: Record<string, number> = {};
  for (const [content, byRun] of byContent) {
    const decisions = [...byRun.values()];
    const accepted = decisions.filter((decision) => decision === "accepted").length;
    if (accepted >= 2 && !decisions.includes("rejected")) priorities[content] = accepted;
  }
  return priorities;
}

export interface FeedbackRankingMemory {
  priorities: Record<string, number>;
  diagnostics: string[];
  recordsScanned: number;
}

function historicalFile(raw: unknown, fileName: string): FeedbackFile {
  const file = object(raw, "historical feedback file");
  onlyKeys(file, ["schemaVersion", "runRef", "feedback"], "historical feedback file");
  if (file.schemaVersion !== 2) throw new Error("unsupported historical feedback schema");
  const ref = object(file.runRef, "historical runRef");
  onlyKeys(ref, ["repositoryRootSha256", "baseCommitSha", "headCommitSha", "reportSha256", "cleanupDiffSha256"], "historical runRef");
  if (!HASH.test(String(ref.repositoryRootSha256 ?? "")) ||
      !COMMIT.test(String(ref.baseCommitSha ?? "")) || !COMMIT.test(String(ref.headCommitSha ?? "")) ||
      !HASH.test(String(ref.reportSha256 ?? "")) || !HASH.test(String(ref.cleanupDiffSha256 ?? "")) ||
      `${ref.reportSha256}.json` !== fileName) throw new Error("historical run identity or filename is invalid");
  if (!Array.isArray(file.feedback) || file.feedback.length > 10000) throw new Error("historical feedback entries exceed bounds");
  const seen = new Set<number>();
  for (const rawEntry of file.feedback) {
    const entry = object(rawEntry, "historical feedback entry");
    onlyKeys(entry, ["candidateOrdinal", "candidateSha256", "contentSha256", "path", "verdict", "note", "reviewedAt"], "historical feedback entry");
    if (!Number.isSafeInteger(entry.candidateOrdinal) || (entry.candidateOrdinal as number) < 0 ||
        seen.has(entry.candidateOrdinal as number) || !HASH.test(String(entry.candidateSha256 ?? "")) ||
        !HASH.test(String(entry.contentSha256 ?? "")) || !safeRepoPath(entry.path) ||
        !VERDICTS.has(String(entry.verdict ?? "")) ||
        (entry.note !== undefined && (typeof entry.note !== "string" || entry.note.length > 2000)) ||
        typeof entry.reviewedAt !== "string" || !Number.isFinite(Date.parse(entry.reviewedAt))) {
      throw new Error("historical feedback entry is invalid");
    }
    seen.add(entry.candidateOrdinal as number);
  }
  return file as unknown as FeedbackFile;
}

/** Read-only, bounded history. Any malformed file disables all ranking for this run. */
export function loadFeedbackPriorities(cwd: string): FeedbackRankingMemory {
  const disabled = (message: string): FeedbackRankingMemory => ({ priorities: {}, diagnostics: [message], recordsScanned: 0 });
  let root: string;
  try { root = realpathSync(resolve(cwd)); }
  catch { return disabled("feedback ranking unavailable: repository root could not be resolved"); }
  const repositoryRootSha256 = sha256(process.platform === "win32" ? root.toLowerCase() : root);
  const storeDir = join(root, ".patchdiet", "feedback");
  try {
    assertRunOwnedPath(root, storeDir, "feedback directory");
    const stats = lstatSync(storeDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("feedback directory is redirected or not a directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { priorities: {}, diagnostics: [], recordsScanned: 0 };
    return disabled(`feedback ranking unavailable: ${(error as Error).message}`);
  }
  try {
    const names = readdirSync(storeDir).filter((name) => name !== ".lock");
    if (names.length > 1000) throw new Error("too many feedback files");
    const files: FeedbackFile[] = [];
    let totalBytes = 0;
    for (const name of names) {
      if (!/^[0-9a-f]{64}\.json$/.test(name)) throw new Error(`unexpected feedback store entry '${name}'`);
      const path = join(storeDir, name);
      const bytes = safeFile(root, path, "historical feedback file", MAX_FEEDBACK_BYTES);
      totalBytes += bytes.length;
      if (totalBytes > 16 * 1024 * 1024) throw new Error("historical feedback exceeds 16 MiB read budget");
      const file = historicalFile(JSON.parse(decoder.decode(bytes)), name);
      if (file.runRef.repositoryRootSha256 === repositoryRootSha256) files.push(file);
    }
    return { priorities: computeFeedbackPriorities(files, repositoryRootSha256), diagnostics: [], recordsScanned: files.length };
  } catch (error) {
    return disabled(`feedback ranking unavailable: invalid historical feedback (${(error as Error).message})`);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ERROR: ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`ERROR: ${label} contains unknown field '${key}'.`);
  }
}

function safeRepoPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 1024 &&
    !isAbsolute(path) && !path.startsWith("/") && !path.includes("\\") &&
    !/[\u0000-\u001f:*?"<>|]/.test(path) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function safeFile(root: string, path: string, label: string, maxBytes: number): Buffer {
  assertRunOwnedPath(root, path, label);
  let stats;
  try { stats = lstatSync(path); }
  catch (error) { throw new Error(`ERROR: ${label} is missing or unreadable: ${(error as Error).message}`); }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`ERROR: ${label} must be a regular, non-symlink, non-hardlinked file.`);
  }
  if (stats.size > maxBytes) throw new Error(`ERROR: ${label} exceeds ${maxBytes} bytes.`);
  return readFileSync(path);
}

function git(root: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 128 * 1024 }).trim();
  } catch {
    throw new Error(`ERROR: could not verify Git identity for ${args[args.length - 1] ?? "repository"}.`);
  }
}

function runContext(cwd: string): RunContext {
  const root = realpathSync(resolve(cwd));
  if (realpathSync(git(root, "rev-parse", "--show-toplevel")) !== root) {
    throw new Error("ERROR: feedback must run at the Git repository root.");
  }
  const patchDir = join(root, ".patchdiet");
  const reportBytes = safeFile(root, join(patchDir, "run.json"), "run report", MAX_REPORT_BYTES);
  let report: Record<string, unknown>;
  try { report = object(JSON.parse(decoder.decode(reportBytes)), "run report"); }
  catch (error) { throw new Error(`ERROR: invalid run report: ${(error as Error).message}`); }
  if (!HASH.test(String(report.cleanupDiffSha256 ?? ""))) {
    throw new Error("ERROR: run report has no valid emission-time cleanupDiffSha256; old reports require a fresh shrink run before feedback.");
  }
  const patchBytes = safeFile(root, join(patchDir, "cleanup.diff"), "cleanup patch", MAX_PATCH_BYTES);
  if (sha256(patchBytes) !== report.cleanupDiffSha256) {
    throw new Error("ERROR: cleanup patch hash differs from the emission-time hash in run.json; patch was changed or replaced.");
  }
  if (typeof report.baseRef !== "string" || typeof report.headRef !== "string" ||
      report.baseRef.length < 1 || report.baseRef.length > 200 ||
      report.headRef.length < 1 || report.headRef.length > 200 ||
      !COMMIT.test(String(report.baseCommitSha ?? "")) || !COMMIT.test(String(report.headCommitSha ?? ""))) {
    throw new Error("ERROR: run report lacks bounded pinned base/head Git identities.");
  }
  const verification = object(report.verification, "run verification");
  const baseline = object(verification.baseline, "baseline verification");
  const final = object(verification.final, "final verification");
  if (baseline.stage !== "baseline" || final.stage !== "final" ||
      baseline.baseCommitSha !== report.baseCommitSha || baseline.headCommitSha !== report.headCommitSha ||
      final.baseCommitSha !== report.baseCommitSha || final.headCommitSha !== report.headCommitSha ||
      (report.mode === "verified" && (baseline.status !== "passed" || final.status !== "passed" || final.treesMatch !== true))) {
    throw new Error("ERROR: verification identity or status contradicts pinned run identity.");
  }
  for (const [ref, sha, label] of [
    [report.baseRef, report.baseCommitSha, "base"],
    [report.headRef, report.headCommitSha, "head"],
  ] as [string, string, string][]) {
    const current = git(root, "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`);
    if (current !== sha) throw new Error(`ERROR: ${label} ref moved since run.json was emitted; refusing stale feedback.`);
  }
  const candidates = report.candidates;
  if (!Array.isArray(candidates) || candidates.length > 10000 || candidates.some((candidate) => {
    try { return !safeRepoPath(object(candidate, "candidate").filePath); } catch { return true; }
  })) throw new Error("ERROR: run report has invalid or excessive candidates.");
  const runRef: FeedbackFile["runRef"] = {
    repositoryRootSha256: sha256(process.platform === "win32" ? root.toLowerCase() : root),
    baseCommitSha: report.baseCommitSha as string,
    headCommitSha: report.headCommitSha as string,
    reportSha256: sha256(reportBytes),
    cleanupDiffSha256: report.cleanupDiffSha256 as string,
  };
  return { root, runRef, candidates: candidates as Record<string, unknown>[], storePath: join(patchDir, "feedback", `${runRef.reportSha256}.json`) };
}

function validateFile(raw: unknown, context: RunContext): FeedbackFile {
  const { runRef } = context;
  const file = object(raw, "feedback file");
  onlyKeys(file, ["schemaVersion", "runRef", "feedback"], "feedback file");
  if (file.schemaVersion !== 2) throw new Error("ERROR: feedback file schemaVersion must be 2.");
  const ref = object(file.runRef, "feedback runRef");
  onlyKeys(ref, Object.keys(runRef), "feedback runRef");
  if (Object.keys(runRef).some((key) => ref[key] !== runRef[key as keyof typeof runRef])) {
    throw new Error("ERROR: feedback run identity differs from current report, patch or repository.");
  }
  if (!Array.isArray(file.feedback) || file.feedback.length > 10000) {
    throw new Error("ERROR: feedback entries must be a bounded array.");
  }
  const seen = new Set<number>();
  const entries = file.feedback.map((rawEntry) => {
    const entry = object(rawEntry, "feedback entry");
    onlyKeys(entry, ["candidateOrdinal", "candidateSha256", "contentSha256", "path", "verdict", "note", "reviewedAt"], "feedback entry");
    if (!Number.isSafeInteger(entry.candidateOrdinal) || (entry.candidateOrdinal as number) < 0 ||
        seen.has(entry.candidateOrdinal as number) || !HASH.test(String(entry.candidateSha256 ?? "")) ||
        !HASH.test(String(entry.contentSha256 ?? "")) ||
        !safeRepoPath(entry.path) || !VERDICTS.has(String(entry.verdict ?? "")) ||
        (entry.note !== undefined && (typeof entry.note !== "string" || entry.note.length > 2000)) ||
        typeof entry.reviewedAt !== "string" || entry.reviewedAt.length > 64 ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(entry.reviewedAt) ||
        !Number.isFinite(Date.parse(entry.reviewedAt))) {
      throw new Error("ERROR: feedback entry is invalid, duplicated, or out of bounds.");
    }
    const candidate = context.candidates[entry.candidateOrdinal as number];
    if (!candidate || candidate.filePath !== entry.path || candidate.contentSha256 !== entry.contentSha256 ||
        sha256(JSON.stringify(candidate)) !== entry.candidateSha256) {
      throw new Error("ERROR: stored candidate identity differs from the current run report.");
    }
    seen.add(entry.candidateOrdinal as number);
    return entry as unknown as FeedbackEntry;
  });
  return { schemaVersion: 2, runRef, feedback: entries };
}

function readCurrent(context: RunContext): FeedbackFile {
  let bytes: Buffer;
  try { bytes = safeFile(context.root, context.storePath, "feedback file", MAX_FEEDBACK_BYTES); }
  catch (error) {
    if ((error as Error).message.includes("missing or unreadable") &&
        (error as Error).message.includes("ENOENT")) return { schemaVersion: 2, runRef: context.runRef, feedback: [] };
    throw error;
  }
  try { return validateFile(JSON.parse(decoder.decode(bytes)), context); }
  catch (error) { throw new Error(`ERROR: invalid feedback file: ${(error as Error).message}`); }
}

export function showFeedback(cwd: string): FeedbackFile {
  return readCurrent(runContext(cwd));
}

export async function recordFeedback(cwd: string, input: { candidate: string; path: string; verdict: string; note?: string }): Promise<FeedbackFile> {
  const ordinal = Number(input.candidate);
  if (!/^(0|[1-9][0-9]*)$/.test(input.candidate) || !Number.isSafeInteger(ordinal)) {
    throw new Error("ERROR: --candidate must be a nonnegative integer report ordinal.");
  }
  if (!safeRepoPath(input.path)) throw new Error("ERROR: --path must be a safe repository-relative path.");
  if (!VERDICTS.has(input.verdict)) throw new Error("ERROR: --verdict must be accepted, rejected, wrong_scope or uncertain.");
  if (input.note !== undefined && input.note.length > 2000) throw new Error("ERROR: --note exceeds 2000 characters.");
  const context = runContext(cwd);
  const candidate = context.candidates[ordinal];
  if (!candidate) throw new Error(`ERROR: candidate ordinal ${ordinal} is not in run.json.`);
  if (candidate.filePath !== input.path) throw new Error("ERROR: --path does not match the selected report candidate path.");
  if (!HASH.test(String(candidate.contentSha256 ?? ""))) {
    throw new Error("ERROR: candidate has no pinned content digest; rerun shrink before recording feedback.");
  }
  const storeDir = join(context.root, ".patchdiet", "feedback");
  assertRunOwnedPath(context.root, storeDir, "feedback directory");
  mkdirSync(storeDir, { recursive: true });
  assertRunOwnedPath(context.root, storeDir, "feedback directory");
  const lock = join(storeDir, ".lock");
  let fd: number | undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { fd = openSync(lock, "wx", 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt === 79) {
        throw new Error("ERROR: feedback store is locked or unsafe; no event was recorded.");
      }
      await delay(25);
    }
  }
  try {
    const current = readCurrent(context);
    const candidateSha256 = sha256(JSON.stringify(candidate));
    const existing = current.feedback.find((entry) => entry.candidateOrdinal === ordinal);
    if (existing) {
      if (existing.candidateSha256 === candidateSha256 && existing.path === input.path &&
          existing.verdict === input.verdict && existing.note === input.note) return current;
      throw new Error("ERROR: conflicting feedback already recorded for this candidate and run.");
    }
    const entry: FeedbackEntry = {
      candidateOrdinal: ordinal,
      candidateSha256,
      contentSha256: candidate.contentSha256 as string,
      path: input.path,
      verdict: input.verdict as FeedbackEntry["verdict"],
      ...(input.note !== undefined ? { note: input.note } : {}),
      reviewedAt: new Date().toISOString(),
    };
    current.feedback.push(entry);
    const bytes = JSON.stringify(current, null, 2) + "\n";
    if (Buffer.byteLength(bytes) > MAX_FEEDBACK_BYTES) throw new Error("ERROR: feedback file would exceed 4 MiB.");
    writeOutputFileAtomic(context.root, context.storePath, bytes);
    return current;
  } finally {
    if (fd !== undefined) { closeSync(fd); unlinkSync(lock); }
  }
}
