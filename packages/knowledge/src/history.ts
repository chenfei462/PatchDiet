import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

import type Database from "better-sqlite3";

import { assertOwnedPath, assertSafeDatabaseLeaf } from "./ownership.js";
import { decodeUtf8Strict } from "./git-blobs.js";
import { isAbsolute, join } from "node:path";

/**
 * Bounded, pinned-commit Git history for the knowledge index.
 *
 * Safety properties (Task 1 of the post-MVP plan):
 * - history is collected ONLY from the exact pinned commit (`git log <commit>`),
 *   never from the working tree: dirty files cannot leak in;
 * - bounded: at most MAX_HISTORY_COMMITS commits, per-command wall-clock and
 *   output caps, and bounded path counts; every bound overrun is reported as
 *   an explicit diagnostic, never silently dropped;
 * - co-change is a FILE-level heuristic (two paths touched by the same
 *   commit). It is NOT a symbol dependency, NOT task similarity and never
 *   proves anything removable;
 * - merge commits are recorded honestly (parent count); by default `git log
 *   --name-only` shows no file list for merges, so merges contribute NO
 *   co-change paths — no fabricated diffs;
 * - merged-PR evidence is caller-supplied, strict, bounded repo-local JSON.
 *   Labels are unverified caller assertions, NOT GitHub authentication. There
 *   are no network requests; merged status is never inferred from a commit
 *   subject. Every claimed merge commit must be reachable from the pinned
 *   indexed commit, and ALL records are validated before any row is written.
 */

export const MAX_HISTORY_COMMITS = 100;
export const MAX_MERGED_PR_INPUT_BYTES = 1024 * 1024;
export const MAX_MERGED_PR_RECORDS = 100;
export const MAX_MERGED_PR_LABELS = 16;
export const MAX_MERGED_PR_FIELD_CHARS = 200;
/** Paths recorded per commit; a commit touching more reports an explicit diagnostic. */
export const MAX_PATHS_PER_COMMIT = 200;
/** Total persisted (commit, path) rows; further paths are dropped with a diagnostic. */
export const MAX_TOTAL_PATH_ROWS = 20000;
/** Distinct co-change pairs persisted; beyond this, new pairs are not added (existing keep counting). */
export const MAX_COCHANGE_PAIRS = 20000;
export const MAX_SUBJECT_CHARS = 200;
const MAX_COMMAND_MS = 30000;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;

const FIELD_SEP = "\u0001";

export interface HistoryCommit {
  sha: string;
  parentShas: string[];
  authorName: string;
  authorEmail: string;
  /** Author epoch seconds (from %at; deterministic, no locale). */
  authorEpoch: number;
  subject: string;
  isMerge: boolean;
  isRoot: boolean;
  paths: string[];
}

export interface GitHistorySnapshot {
  pinnedCommit: string;
  shallow: boolean;
  truncated: boolean;
  commits: HistoryCommit[];
  /** Canonical pair key `a\u0000b` (a < b) → commit count. */
  cochange: Map<string, number>;
  diagnostics: string[];
  /** Real command-bound accounting: time/output/path counts, per the plan. */
  stats: { gitCommands: number; elapsedMs: number; outputBytes: number; pathRows: number };
}

/** One git command: wall-clock bounded, output bounded, stderr capped, exit checked. Returns raw stdout bytes. */
async function boundedGitRaw(
  cwd: string,
  args: string[],
  stats: GitHistorySnapshot["stats"],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`ERROR: git ${args[0]} exceeded the ${MAX_COMMAND_MS}ms command bound; refusing unbounded history work.`));
      }
    }, MAX_COMMAND_MS);
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stats.outputBytes += chunk.length;
      if (stats.outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        fail(new Error(`ERROR: git ${args[0]} output exceeded the aggregate bound; refusing unbounded history work.`));
        return;
      }
      stdout = stdout.length === 0 ? chunk : Buffer.concat([stdout, chunk]);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr = Buffer.concat([stderr, chunk.subarray(0, MAX_STDERR_BYTES - stderr.length)]);
      }
    });
    child.on("error", (error) => fail(new Error(`ERROR: could not run 'git ${args[0]}': ${error.message}`)));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stats.gitCommands += 1;
      stats.elapsedMs += Date.now() - startedAt;
      if (code !== 0) {
        reject(new Error(`ERROR: 'git ${args[0]}' exited with code ${code}: ${stderr.toString("utf8").slice(0, 400)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Decoded stdout for commands whose output is ASCII-controlled and
 * grammar-validated by the caller (rev-parse booleans, exit-code-only
 * merge-base). The history LOG must NOT use this: replacement-decoding an
 * invalid byte would fabricate a path git never reported. collectGitHistory
 * decodes the log strictly per record from boundedGitRaw bytes instead.
 */
async function boundedGit(
  cwd: string,
  args: string[],
  stats: GitHistorySnapshot["stats"],
): Promise<string> {
  return (await boundedGitRaw(cwd, args, stats)).toString("utf8");
}

/**
 * The header GRAMMAR gate, applied only at NUL-sentinel positions (see the
 * positional classification in collectGitHistory): the log format is
 * %H<US>%P<US>%an<US>%ae<US>%at<US>%s — a real header record STARTS with a
 * full 40-hex commit SHA followed by the field separator and carries all six
 * fields. Syntax alone cannot classify a record (a filename may mimic all six
 * fields); this gate only confirms what the sentinel position already implies,
 * and any sentinel-position record failing it is a reported framing anomaly.
 */
function isCommitHeaderRecord(record: string): boolean {
  return (
    record.length >= 41 &&
    record.charCodeAt(40) === FIELD_SEP.charCodeAt(0) &&
    /^[0-9a-f]{40}/.test(record) &&
    record.split(FIELD_SEP).length >= 6
  );
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Collect bounded git history at an exact commit. All data comes from the
 * object database via git log at the PINNED commit; the working tree is never
 * read. Truncation/shallow state is explicit, never silent.
 */
export async function collectGitHistory(repoRoot: string, pinnedCommit: string): Promise<GitHistorySnapshot> {
  const stats: GitHistorySnapshot["stats"] = { gitCommands: 0, elapsedMs: 0, outputBytes: 0, pathRows: 0 };
  const diagnostics: string[] = [];

  // Shallow check BEFORE the log: a shallow clone must not present its short
  // log as complete history.
  const shallowRaw = (await boundedGit(repoRoot, ["rev-parse", "--is-shallow-repository"], stats)).trim();
  if (shallowRaw !== "true" && shallowRaw !== "false") {
    throw new Error(`ERROR: unexpected 'git rev-parse --is-shallow-repository' output: '${shallowRaw.slice(0, 80)}'.`);
  }
  const shallow = shallowRaw === "true";
  if (shallow) {
    diagnostics.push("repository is shallow: history is a lower bound of the true history, not a complete log");
  }

  // Ask for one MORE than the cap purely to detect truncation; at most the cap
  // is persisted. The %x00 prefix NUL-sentinel-frames every commit header: the
  // format line of each commit BEGINS with a NUL byte, so after NUL-splitting
  // an EMPTY record sits immediately before every header — and a path record
  // can never be empty nor contain NUL. Header recognition is therefore
  // POSITIONAL (sentinel-delimited), not syntactic: a filename may mimic all
  // six header fields, but it can never occupy a sentinel position.
  const log = await boundedGitRaw(
    repoRoot,
    [
      "log",
      "-z",
      "--no-color",
      `--max-count=${MAX_HISTORY_COMMITS + 1}`,
      `--format=%x00%H${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%at${FIELD_SEP}%s`,
      "--name-only",
      pinnedCommit,
    ],
    stats,
  );

  const commits: HistoryCommit[] = [];
  const cochange = new Map<string, number>();
  let truncated = false;
  let commitsOverPathBound = 0;
  let pathRowsDropped = false;
  let cochangePairsDropped = false;

  // Framing: with -z each commit block is `<sentinel><format line>\0\n<path>\0
  // <path>...\0`. Records are split at the BYTE level: "" entries are the NUL
  // sentinels that frame every commit header (kept — they are meaningful),
  // non-empty records are strict-decoded as UTF-8. Git path bytes are
  // arbitrary non-NUL bytes, and replacement-decoding an invalid byte would
  // store a fabricated path (0xFF becoming U+FFFD) as an exact Git fact: any
  // invalid record fails the ingestion explicitly.
  const records: string[] = [];
  {
    let start = 0;
    let recordIndex = -1;
    for (let i = 0; i <= log.length; i += 1) {
      if (i === log.length || log[i] === 0) {
        const recordBytes = log.subarray(start, i);
        start = i + 1;
        recordIndex += 1;
        if (recordBytes.length === 0) {
          records.push("");
          continue;
        }
        const decoded = decodeUtf8Strict(recordBytes);
        if (!decoded.ok) {
          throw new Error(
            `ERROR: git log record ${recordIndex} is not valid UTF-8 (bytes '${recordBytes.subarray(0, 24).toString("hex")}'...); ` +
              "refusing to fabricate history facts from replacement-decoded bytes. " +
              "Rename the offending path/author bytes or set knowledge.history.git: false.",
          );
        }
        records.push(decoded.text);
      }
    }
  }

  // Positional header classification, shared by both passes below. A commit
  // header is a record at a SENTINEL position (immediately after an empty
  // record) that also matches the header grammar. A header-shaped record
  // anywhere else is a PATH — a filename can mimic every header field, but it
  // cannot produce the empty sentinel. A non-header record AT a sentinel
  // position is a git framing anomaly: it is counted and reported, never
  // attached as a path and never silently dropped.
  const isHeader: boolean[] = [];
  const atSentinel: boolean[] = [];
  let scanningAfterSentinel = true; // the stream itself opens with the leading sentinel
  for (const record of records) {
    const sentinel = scanningAfterSentinel;
    scanningAfterSentinel = record === "";
    atSentinel.push(sentinel);
    isHeader.push(sentinel && record !== "" && isCommitHeaderRecord(record));
  }

  for (const [index, record] of records.entries()) {
    if (!isHeader[index]) {
      continue; // path, sentinel or anomaly record: consumed by the path pass below
    }
    const fields = record.split(FIELD_SEP);
    const sha = fields[0]!;
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error(`ERROR: git log returned a non-commit identity: '${sha.slice(0, 80)}'.`);
    }
    if (commits.length >= MAX_HISTORY_COMMITS) {
      truncated = true;
      break;
    }
    const parentShas = fields[1]!.length > 0 ? fields[1]!.split(" ") : [];
    const authorName = clip(fields[2] ?? "", MAX_MERGED_PR_FIELD_CHARS);
    const authorEmail = clip(fields[3] ?? "", MAX_MERGED_PR_FIELD_CHARS);
    const authorEpoch = Number.parseInt(fields[4] ?? "0", 10) || 0;
    // The subject is the LAST format field: rejoin any further segments so a
    // subject containing U+0001 keeps its real bytes instead of being split.
    const subject = clip(fields.slice(5).join(FIELD_SEP), MAX_SUBJECT_CHARS);
    const isMerge = parentShas.length > 1;
    const isRoot = parentShas.length === 0;
    const paths: string[] = [];
    // Consume following path records until the next grammar-recognized header
    // record. Implemented by the second pass below, in stream order.
    commits.push({ sha, parentShas, authorName, authorEmail, authorEpoch, subject, isMerge, isRoot, paths });
  }

  // Second pass over the same record stream to attach paths to their header:
  // POSITIONALLY recognized headers (sentinel + grammar, see the shared
  // classification above) open a commit; every other non-sentinel record is a
  // path of the current commit, in stream order — including records that LOOK
  // like a commit header, which are legal filenames.
  //
  // Framing (verified against git object fixtures with LF/TAB/U+0001 and
  // header-shaped filenames): the %x00 format prefix emits one NUL sentinel
  // immediately before EVERY commit header, and git emits exactly ONE newline
  // — the format line terminator — before the FIRST path record only (pathless
  // commits, e.g. merges, emit no newline record at all). That one format
  // newline is stripped at the first-path position; all other bytes are the
  // real path: leading and internal LF, TAB and U+0001 are legal git path
  // bytes and are PRESERVED. Nothing is dropped for its bytes; records that
  // cannot be attributed to a commit header (including a non-header at a
  // sentinel position) are counted into an explicit lower-bound diagnostic,
  // never silently ignored.
  {
    let current: HistoryCommit | null = null;
    let firstPathOfCommit = false;
    let unattributedPathRecords = 0;
    for (const [index, record] of records.entries()) {
      if (record === "") {
        continue; // NUL sentinel framing record
      }
      if (isHeader[index]) {
        current = commits.find((c) => c.sha === record.slice(0, 40)) ?? null;
        firstPathOfCommit = true;
        continue;
      }
      if (current === null || atSentinel[index]) {
        // A path record before any header, or a non-header record at a
        // sentinel position (git framing anomaly): counted, reported, never
        // attached as a path and never silently dropped.
        unattributedPathRecords += 1;
        continue;
      }
      let path = record;
      if (firstPathOfCommit) {
        if (path.startsWith("\n")) {
          path = path.slice(1);
        }
        firstPathOfCommit = false;
      }
      if (path.length === 0) {
        // Empty after format-newline strip: a commit with an empty path
        // section (merge commits have none by default).
        continue;
      }
      if (current.isMerge && current.paths.length === 0) {
        // Merge commits contribute no co-change paths: `git log --name-only`
        // shows no file list for merges. Recorded honestly, never fabricated.
        continue;
      }
      if (current.paths.length >= MAX_PATHS_PER_COMMIT) {
        commitsOverPathBound += 1;
        continue;
      }
      if (stats.pathRows >= MAX_TOTAL_PATH_ROWS) {
        pathRowsDropped = true;
        continue;
      }
      current.paths.push(path);
      stats.pathRows += 1;
    }
    if (unattributedPathRecords > 0) {
      diagnostics.push(
        `${unattributedPathRecords} history path record(s) could not be attributed to a commit header; ` +
          "recorded paths are a lower bound (git framing anomaly)",
      );
    }
  }

  if (truncated) {
    diagnostics.push(
      `history truncated at the ${MAX_HISTORY_COMMITS}-commit bound: counts are a lower bound of the true history`,
    );
  }
  if (commitsOverPathBound > 0) {
    diagnostics.push(
      `${commitsOverPathBound} commit(s) exceeded the ${MAX_PATHS_PER_COMMIT}-path-per-commit bound; extra paths were not recorded`,
    );
  }
  if (pathRowsDropped) {
    diagnostics.push(`total (commit, path) rows exceeded the ${MAX_TOTAL_PATH_ROWS}-row bound; further paths were not recorded`);
  }

  // File-level co-change heuristic over the RECORDED paths only.
  for (const commit of commits) {
    const list = [...commit.paths].sort();
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]!;
        const b = list[j]!;
        if (cochange.size >= MAX_COCHANGE_PAIRS && !cochange.has(`${a}\u0000${b}`)) {
          cochangePairsDropped = true;
          continue;
        }
        const key = `${a}\u0000${b}`;
        cochange.set(key, (cochange.get(key) ?? 0) + 1);
      }
    }
  }
  if (cochangePairsDropped) {
    diagnostics.push(`distinct co-change pairs exceeded the ${MAX_COCHANGE_PAIRS}-pair bound; further pairs were not recorded`);
  }

  return { pinnedCommit, shallow, truncated, commits, cochange, diagnostics, stats };
}

// ---------------------------------------------------------------------------
// Caller-supplied merged-PR snapshots (strict, bounded, no network)
// ---------------------------------------------------------------------------

export const MERGED_PRS_SCHEMA_VERSION = "patchdiet-merged-prs/1";

export interface MergedPrRecord {
  pr: string;
  mergeCommit: string;
  snapshotPath: string;
  labels: string[];
}

export interface ValidatedMergedPrInput {
  records: MergedPrRecord[];
  contentSha: string;
  inputPath: string;
}

interface RawMergedPrRecord {
  pr: unknown;
  mergeCommit: unknown;
  snapshotPath: unknown;
  labels?: unknown;
}

/**
 * Strict repository-relative provenance path: POSIX-style segments only.
 * Rejects absolute paths (leading "/" or drive letters), ANY backslash
 * (Windows separators and "src\..\outside.patch" traversals alike), "." or
 * ".." segments, empty segments ("//"), embedded NUL and every other control
 * character. Dots, spaces and Unicode are legitimate path bytes and allowed.
 */
function assertRepoRelativeProvenancePath(value: string, index: number): void {
  if (value.length === 0) {
    throw new Error(`ERROR: merged-PR record ${index} 'snapshotPath' must not be empty.`);
  }
  if (value.includes("\\")) {
    throw new Error(
      `ERROR: merged-PR record ${index} 'snapshotPath' must not contain backslashes; use repository-relative POSIX-style paths.`,
    );
  }
  if (value.startsWith("/")) {
    throw new Error(`ERROR: merged-PR record ${index} 'snapshotPath' must be repository-relative, not absolute.`);
  }
  if (/^[A-Za-z]:/.test(value)) {
    throw new Error(`ERROR: merged-PR record ${index} 'snapshotPath' must be repository-relative (drive-qualified paths are absolute).`);
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(
        `ERROR: merged-PR record ${index} 'snapshotPath' contains a control character (code ${code}); refusing ambiguous provenance.`,
      );
    }
  }
  for (const segment of value.split("/")) {
    if (segment.length === 0) {
      throw new Error(`ERROR: merged-PR record ${index} 'snapshotPath' contains an empty path segment.`);
    }
    if (segment === "." || segment === "..") {
      throw new Error(`ERROR: merged-PR record ${index} 'snapshotPath' must stay inside the repository (no '.' or '..' segments).`);
    }
  }
}

/**
 * Parse + fully validate a merged-PR snapshot file BEFORE any database write.
 * Strict: unknown top-level or record fields are rejected; bounds are enforced;
 * PR identity, merge commit and local snapshot provenance are REQUIRED; labels
 * are optional unverified caller assertions. The file is read as raw BYTES,
 * strict-decoded as UTF-8 (invalid bytes fail closed — never replacement
 * decoding) and hashed over the ORIGINAL bytes, so input_content_sha always
 * matches the actual file. No record is inferred from any commit subject and
 * no network request is made.
 */
export function validateMergedPrSnapshot(repoRoot: string, inputPath: string, pinnedCommit: string): Promise<ValidatedMergedPrInput> {
  return (async () => {
    const abs = isAbsolute(inputPath) ? inputPath : join(repoRoot, inputPath);
    assertOwnedPath(repoRoot, abs, "merged-PR snapshot input");
    assertSafeDatabaseLeaf(abs, "merged-PR snapshot input");
    const stats = statSync(abs);
    if (!stats.isFile()) {
      throw new Error(`ERROR: merged-PR snapshot input '${inputPath}' is not a regular file.`);
    }
    if (stats.size > MAX_MERGED_PR_INPUT_BYTES) {
      throw new Error(
        `ERROR: merged-PR snapshot input '${inputPath}' exceeds the ${MAX_MERGED_PR_INPUT_BYTES}-byte bound; refusing unbounded input.`,
      );
    }
    const rawBytes = readFileSync(abs);
    // Enforce the bound on the bytes ACTUALLY read as well as the stat: the two
    // can disagree under concurrent mutation, and the hash covers these bytes.
    if (rawBytes.length > MAX_MERGED_PR_INPUT_BYTES) {
      throw new Error(
        `ERROR: merged-PR snapshot input '${inputPath}' read ${rawBytes.length} bytes, exceeding the ${MAX_MERGED_PR_INPUT_BYTES}-byte bound.`,
      );
    }
    const contentSha = createHash("sha256").update(rawBytes).digest("hex");
    const decoded = decodeUtf8Strict(rawBytes);
    if (!decoded.ok) {
      throw new Error(
        `ERROR: merged-PR snapshot input '${inputPath}' is not valid UTF-8 (${decoded.reason}); refusing to parse fabricated text.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded.text);
    } catch (error) {
      throw new Error(`ERROR: merged-PR snapshot '${inputPath}' is not valid JSON (${(error as Error).message}).`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("ERROR: merged-PR snapshot must be a JSON object.");
    }
    const top = parsed as Record<string, unknown>;
    const allowedTop = new Set(["schemaVersion", "records"]);
    for (const key of Object.keys(top)) {
      if (!allowedTop.has(key)) {
        throw new Error(`ERROR: merged-PR snapshot has unknown top-level field '${key}'; strict validation refuses unknown fields.`);
      }
    }
    if (top.schemaVersion !== MERGED_PRS_SCHEMA_VERSION) {
      throw new Error(
        `ERROR: merged-PR snapshot schemaVersion must be '${MERGED_PRS_SCHEMA_VERSION}' (got ${JSON.stringify(top.schemaVersion)}).`,
      );
    }
    if (!Array.isArray(top.records)) {
      throw new Error("ERROR: merged-PR snapshot 'records' must be an array.");
    }
    if (top.records.length > MAX_MERGED_PR_RECORDS) {
      throw new Error(
        `ERROR: merged-PR snapshot has ${top.records.length} records, exceeding the ${MAX_MERGED_PR_RECORDS}-record bound; refusing unbounded input.`,
      );
    }
    const records: MergedPrRecord[] = [];
    const seenPr = new Set<string>();
    const seenMerge = new Set<string>();
    for (const [index, entryRaw] of top.records.entries()) {
      if (entryRaw === null || typeof entryRaw !== "object" || Array.isArray(entryRaw)) {
        throw new Error(`ERROR: merged-PR record ${index} must be a JSON object.`);
      }
      const entry = entryRaw as Record<string, unknown>;
      const allowedRecord = new Set(["pr", "mergeCommit", "snapshotPath", "labels"]);
      for (const key of Object.keys(entry)) {
        if (!allowedRecord.has(key)) {
          throw new Error(`ERROR: merged-PR record ${index} has unknown field '${key}'; strict validation refuses unknown fields.`);
        }
      }
      const pr = entry.pr;
      if (typeof pr !== "string" || pr.length === 0 || pr.length > MAX_MERGED_PR_FIELD_CHARS) {
        throw new Error(`ERROR: merged-PR record ${index} 'pr' must be a non-empty string of at most ${MAX_MERGED_PR_FIELD_CHARS} characters.`);
      }
      const mergeCommit = entry.mergeCommit;
      if (typeof mergeCommit !== "string" || !/^[0-9a-f]{40}$/.test(mergeCommit)) {
        throw new Error(`ERROR: merged-PR record ${index} 'mergeCommit' must be a full 40-hex commit SHA.`);
      }
      const snapshot = entry.snapshotPath;
      if (typeof snapshot !== "string") {
        throw new Error(`ERROR: merged-PR record ${index} 'snapshotPath' must be a string.`);
      }
      assertRepoRelativeProvenancePath(snapshot, index);
      if (snapshot.length > MAX_MERGED_PR_FIELD_CHARS) {
        throw new Error(`ERROR: merged-PR record ${index} 'snapshotPath' must be at most ${MAX_MERGED_PR_FIELD_CHARS} characters.`);
      }
      let labels: string[] = [];
      if (entry.labels !== undefined) {
        if (!Array.isArray(entry.labels) || entry.labels.length > MAX_MERGED_PR_LABELS) {
          throw new Error(`ERROR: merged-PR record ${index} 'labels' must be an array of at most ${MAX_MERGED_PR_LABELS} strings.`);
        }
        labels = entry.labels.map((label) => {
          if (typeof label !== "string" || label.length === 0 || label.length > MAX_MERGED_PR_FIELD_CHARS) {
            throw new Error(`ERROR: merged-PR record ${index} has a non-string or oversized label.`);
          }
          return label;
        });
      }
      if (seenPr.has(pr)) {
        throw new Error(`ERROR: merged-PR snapshot contains a duplicate PR identity '${pr}'.`);
      }
      if (seenMerge.has(mergeCommit)) {
        throw new Error(`ERROR: merged-PR snapshot contains a duplicate merge commit ${mergeCommit}.`);
      }
      seenPr.add(pr);
      seenMerge.add(mergeCommit);
      records.push({ pr, mergeCommit, snapshotPath: snapshot, labels });
    }
    // Reachability: every claimed merge commit must be a commit reachable from
    // the pinned indexed commit. Validated here, BEFORE any write.
    for (const record of records) {
      let reachable = false;
      try {
        await boundedGit(
          repoRoot,
          ["merge-base", "--is-ancestor", record.mergeCommit, pinnedCommit],
          { gitCommands: 0, elapsedMs: 0, outputBytes: 0, pathRows: 0 },
        );
        reachable = true;
      } catch {
        reachable = false;
      }
      if (!reachable) {
        throw new Error(
          `ERROR: merged-PR record '${record.pr}' claims merge commit ${record.mergeCommit} which is NOT reachable from the indexed commit ${pinnedCommit}; refusing to ingest unanchored claims.`,
        );
      }
    }
    return { records, contentSha, inputPath: inputPath.replaceAll("\\", "/") };
  })();
}

// ---------------------------------------------------------------------------
// Persistence: additive extension tables (transactional, idempotent)
// ---------------------------------------------------------------------------

/**
 * Additive extension schema, mirroring the coverage extension pattern: created
 * with IF NOT EXISTS on the WRITE connection only. Readonly connections never
 * create or migrate anything; original-schema (schema v1) indexes stay valid
 * and readable with empty history results.
 */
export function ensureHistorySchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec(
      "CREATE TABLE IF NOT EXISTS history_snapshots (" +
        "id INTEGER PRIMARY KEY," +
        "pinned_commit TEXT NOT NULL UNIQUE," +
        "collected_at TEXT NOT NULL," +
        "shallow INTEGER NOT NULL," +
        "truncated INTEGER NOT NULL," +
        "commit_count INTEGER NOT NULL," +
        "path_rows INTEGER NOT NULL," +
        "cochange_pairs INTEGER NOT NULL," +
        "git_commands INTEGER NOT NULL," +
        "elapsed_ms INTEGER NOT NULL," +
        "output_bytes INTEGER NOT NULL," +
        "diagnostics_json TEXT NOT NULL)",
    );
    // Column 'sha' etc.: avoid reserved words (see prior 'commit' column bug).
    db.exec(
      "CREATE TABLE IF NOT EXISTS history_commits (" +
        "id INTEGER PRIMARY KEY," +
        "snapshot_id INTEGER NOT NULL REFERENCES history_snapshots(id) ON DELETE CASCADE," +
        "sha TEXT NOT NULL," +
        "parent_shas TEXT NOT NULL," +
        "author_name TEXT NOT NULL," +
        "author_email TEXT NOT NULL," +
        "author_epoch INTEGER NOT NULL," +
        "subject TEXT NOT NULL," +
        "is_merge INTEGER NOT NULL," +
        "is_root INTEGER NOT NULL," +
        "UNIQUE (snapshot_id, sha))",
    );
    db.exec("CREATE INDEX IF NOT EXISTS idx_history_commits_snapshot ON history_commits(snapshot_id)");
    db.exec(
      "CREATE TABLE IF NOT EXISTS history_commit_paths (" +
        "id INTEGER PRIMARY KEY," +
        "snapshot_id INTEGER NOT NULL REFERENCES history_snapshots(id) ON DELETE CASCADE," +
        "commit_sha TEXT NOT NULL," +
        "path TEXT NOT NULL)",
    );
    db.exec("CREATE INDEX IF NOT EXISTS idx_history_paths_snapshot_path ON history_commit_paths(snapshot_id, path)");
    db.exec(
      "CREATE TABLE IF NOT EXISTS history_cochange (" +
        "id INTEGER PRIMARY KEY," +
        "snapshot_id INTEGER NOT NULL REFERENCES history_snapshots(id) ON DELETE CASCADE," +
        "path_a TEXT NOT NULL," +
        "path_b TEXT NOT NULL," +
        "commit_count INTEGER NOT NULL," +
        "UNIQUE (snapshot_id, path_a, path_b))",
    );
    db.exec("CREATE INDEX IF NOT EXISTS idx_history_cochange_a ON history_cochange(snapshot_id, path_a)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_history_cochange_b ON history_cochange(snapshot_id, path_b)");
    db.exec(
      "CREATE TABLE IF NOT EXISTS history_merged_prs (" +
        "id INTEGER PRIMARY KEY," +
        "snapshot_id INTEGER NOT NULL REFERENCES history_snapshots(id) ON DELETE CASCADE," +
        "pr TEXT NOT NULL," +
        "merge_commit TEXT NOT NULL," +
        "snapshot_path TEXT NOT NULL," +
        "labels_json TEXT NOT NULL," +
        "provenance TEXT NOT NULL CHECK (provenance = 'caller-asserted')," +
        "input_path TEXT NOT NULL," +
        "input_content_sha TEXT NOT NULL," +
        "indexed_commit TEXT NOT NULL," +
        "asserted_at TEXT NOT NULL," +
        "UNIQUE (snapshot_id, pr))",
    );
  })();
}

/**
 * Transactional, idempotent history replacement: exactly ONE snapshot per
 * database. All previous rows are deleted and the new snapshot inserted inside
 * one transaction. When merged-PR ingestion is disabled, any stale
 * caller-asserted rows are removed — a disabled option never leaves live data.
 */
export function writeHistorySnapshot(
  db: Database.Database,
  snapshot: GitHistorySnapshot,
  mergedPrs: { input: ValidatedMergedPrInput } | null,
): void {
  ensureHistorySchema(db);
  db.transaction(() => {
    // One snapshot per database: replacing history removes the previous one.
    db.prepare("DELETE FROM history_merged_prs").run();
    db.prepare("DELETE FROM history_cochange").run();
    db.prepare("DELETE FROM history_commit_paths").run();
    db.prepare("DELETE FROM history_commits").run();
    db.prepare("DELETE FROM history_snapshots").run();
    const info = db
      .prepare(
        "INSERT INTO history_snapshots (pinned_commit, collected_at, shallow, truncated, commit_count, path_rows, cochange_pairs, git_commands, elapsed_ms, output_bytes, diagnostics_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        snapshot.pinnedCommit,
        new Date().toISOString(),
        snapshot.shallow ? 1 : 0,
        snapshot.truncated ? 1 : 0,
        snapshot.commits.length,
        snapshot.stats.pathRows,
        snapshot.cochange.size,
        snapshot.stats.gitCommands,
        snapshot.stats.elapsedMs,
        snapshot.stats.outputBytes,
        JSON.stringify(snapshot.diagnostics),
      );
    const snapshotId = Number(info.lastInsertRowid);
    const insertCommit = db.prepare(
      "INSERT INTO history_commits (snapshot_id, sha, parent_shas, author_name, author_email, author_epoch, subject, is_merge, is_root) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertPath = db.prepare(
      "INSERT INTO history_commit_paths (snapshot_id, commit_sha, path) VALUES (?, ?, ?)",
    );
    for (const commit of snapshot.commits) {
      insertCommit.run(
        snapshotId,
        commit.sha,
        JSON.stringify(commit.parentShas),
        commit.authorName,
        commit.authorEmail,
        commit.authorEpoch,
        commit.subject,
        commit.isMerge ? 1 : 0,
        commit.isRoot ? 1 : 0,
      );
      for (const path of commit.paths) {
        insertPath.run(snapshotId, commit.sha, path);
      }
    }
    const insertCochange = db.prepare(
      "INSERT INTO history_cochange (snapshot_id, path_a, path_b, commit_count) VALUES (?, ?, ?, ?)",
    );
    for (const [key, count] of snapshot.cochange) {
      const sep = key.indexOf("\u0000");
      insertCochange.run(snapshotId, key.slice(0, sep), key.slice(sep + 1), count);
    }
    if (mergedPrs !== null) {
      const insertPr = db.prepare(
        "INSERT INTO history_merged_prs (snapshot_id, pr, merge_commit, snapshot_path, labels_json, provenance, input_path, input_content_sha, indexed_commit, asserted_at) VALUES (?, ?, ?, ?, ?, 'caller-asserted', ?, ?, ?, ?)",
      );
      for (const record of mergedPrs.input.records) {
        insertPr.run(
          snapshotId,
          record.pr,
          record.mergeCommit,
          record.snapshotPath,
          JSON.stringify(record.labels),
          mergedPrs.input.inputPath,
          mergedPrs.input.contentSha,
          snapshot.pinnedCommit,
          new Date().toISOString(),
        );
      }
    }
  })();
}

/** Remove all history data (used when the feature is configured off). */
export function deleteHistoryData(db: Database.Database): void {
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'history_snapshots'").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
  if (tables.length === 0) {
    return; // extension schema never created: nothing to remove
  }
  db.transaction(() => {
    db.prepare("DELETE FROM history_merged_prs").run();
    db.prepare("DELETE FROM history_cochange").run();
    db.prepare("DELETE FROM history_commit_paths").run();
    db.prepare("DELETE FROM history_commits").run();
    db.prepare("DELETE FROM history_snapshots").run();
  })();
}
