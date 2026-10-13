#!/usr/bin/env node
import { lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, closeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[a-f0-9]{40}$/u;
const LABELS = new Set(["necessary", "unnecessary", "uncertain"]);
function requireObject(value, name, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`invalid ${name} object or unknown field`);
}
function short(value, max = 200) { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function integer(value, max = Number.MAX_SAFE_INTEGER) { return Number.isSafeInteger(value) && value >= 0 && value <= max; }

export function validateCorpus(raw) {
  requireObject(raw, "corpus", ["schemaVersion", "cases"]);
  if (raw.schemaVersion !== "patchdiet-natural-pr-corpus/1" || !Array.isArray(raw.cases) || raw.cases.length < 1 || raw.cases.length > 100) throw new Error("invalid corpus version or case count");
  const ids = new Set();
  const prs = new Set();
  for (const item of raw.cases) {
    requireObject(item, "case", ["id", "consent", "source", "labeler", "labeledAt", "labels", "pilot"]);
    if (!short(item.id, 100) || item.consent !== true || !short(item.labeler, 100) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(item.labeledAt ?? "") ||
        Number.isNaN(Date.parse(item.labeledAt))) throw new Error("case requires id, upload consent, labeler and date");
    requireObject(item.source, "source", ["repoUrl", "pullNumber", "baseSha", "headSha"]);
    let url;
    try { url = new URL(item.source.repoUrl); } catch { throw new Error("invalid PR repository URL"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/u.test(url.pathname) ||
        !integer(item.source.pullNumber) || item.source.pullNumber < 1 || !SHA.test(item.source.baseSha ?? "") || !SHA.test(item.source.headSha ?? "")) throw new Error("invalid natural PR source identity");
    const prKey = `${url.origin}${url.pathname.toLowerCase()}#${item.source.pullNumber}@${item.source.headSha}`;
    if (ids.has(item.id) || prs.has(prKey)) throw new Error("duplicate corpus case or PR head");
    ids.add(item.id); prs.add(prKey);
    if (!Array.isArray(item.labels) || item.labels.length < 1 || item.labels.length > 500) throw new Error("invalid label count");
    const atomIds = new Set();
    for (const label of item.labels) {
      requireObject(label, "label", ["candidateId", "verdict", "rationale"]);
      if (!short(label.candidateId, 200) || !LABELS.has(label.verdict) || !short(label.rationale, 2000)) throw new Error("label requires candidate identity, verdict and rationale");
      if (atomIds.has(label.candidateId)) throw new Error("duplicate candidate label");
      atomIds.add(label.candidateId);
    }
    if (item.pilot !== undefined) {
      requireObject(item.pilot, "pilot", ["reviewMinutesBefore", "reviewMinutesAfter", "suggestions", "acceptedSuggestions", "regressions"]);
      const p = item.pilot;
      if (![p.reviewMinutesBefore, p.reviewMinutesAfter].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10000) ||
          !integer(p.suggestions, 10000) || !integer(p.acceptedSuggestions, 10000) || !integer(p.regressions, 10000) || p.acceptedSuggestions > p.suggestions) throw new Error("invalid pilot metrics or accepted suggestion count");
    }
  }
  return raw.cases;
}

export function aggregatePilot(cases) {
  const pilots = cases.filter((item) => item.pilot !== undefined).map((item) => item.pilot);
  return {
    provenance: "caller-supplied-unverified",
    claimedNaturalCases: cases.length,
    independentlyVerifiedNaturalCases: 0,
    labelledCandidates: cases.reduce((sum, item) => sum + item.labels.length, 0),
    pilotCases: pilots.length,
    totalReviewMinutesSaved: pilots.reduce((sum, item) => sum + item.reviewMinutesBefore - item.reviewMinutesAfter, 0),
    suggestions: pilots.reduce((sum, item) => sum + item.suggestions, 0),
    acceptedSuggestions: pilots.reduce((sum, item) => sum + item.acceptedSuggestions, 0),
    regressions: pilots.reduce((sum, item) => sum + item.regressions, 0)
  };
}

function safeDirectory(path) {
  try { if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error(`redirected output directory: ${path}`); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    mkdirSync(path);
  }
}

function importCorpus(inputPath, dryRun) {
  const root = realpathSync(process.cwd());
  const inputRealPath = realpathSync(inputPath);
  if (!inputRealPath.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("corpus input must be repository-local");
  const inputStat = lstatSync(inputPath);
  if (!inputStat.isFile() || inputStat.isSymbolicLink() || inputStat.nlink !== 1 || inputStat.size > 1024 * 1024) throw new Error("input must be a regular unlinked JSON file up to 1 MiB");
  const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(inputPath)));
  const cases = validateCorpus(data);
  const metrics = aggregatePilot(cases);
  if (dryRun) return { imported: false, metrics };
  const outDir = join(root, ".patchdiet");
  safeDirectory(outDir);
  const pilotDir = join(outDir, "pilot");
  safeDirectory(pilotDir);
  const output = join(pilotDir, "natural-pr-corpus.json");
  try { const stat = lstatSync(output); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("redirected or hardlinked corpus output"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const lock = `${output}.lock`;
  const descriptor = openSync(lock, "wx", 0o600);
  const temp = `${output}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temp, output);
  } finally {
    closeSync(descriptor);
    rmSync(lock, { force: true });
    rmSync(temp, { force: true });
  }
  return { imported: true, output, metrics };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length < 2 || args[0] !== "--input" || args.length > 3 || (args.length === 3 && args[2] !== "--dry-run")) throw new Error("Usage: node scripts/import-natural-pr-corpus.mjs --input <file> [--dry-run]");
    console.log(JSON.stringify(importCorpus(resolve(args[1]), args.includes("--dry-run")), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
