import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  KnowledgeIndex,
  indexRepository,
  openKnowledgeIndexReadonly,
} from "../../packages/knowledge/src/index.js";
import { MAX_HISTORY_COMMITS } from "../../packages/knowledge/src/history.js";

const execFileAsync = promisify(execFile);

const tempDirs: string[] = [];

async function removeBounded(target: string, attempts = 10): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1)));
    }
  }
  throw new Error(`bounded cleanup failed for '${target}' after ${attempts} attempts`, { cause: lastError });
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await removeBounded(dir);
  }
});

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tempDirs.push(dir);
  return dir;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "core.autocrlf=false", ...args],
    { cwd, windowsHide: true },
  );
  return result.stdout;
}

async function initRepo(files: Record<string, string>, commitMessage = "init"): Promise<string> {
  const dir = makeTempDir("patchdiet-history-repo");
  await mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await git(dir, "init", "-b", "main");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", commitMessage);
  return dir;
}

async function commitFiles(cwd: string, files: Record<string, string>, message: string): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(cwd, rel);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await git(cwd, "add", "-A");
  await git(cwd, "commit", "-m", message);
}

async function headCommit(cwd: string): Promise<string> {
  return (await git(cwd, "rev-parse", "HEAD")).trim();
}

function dbTables(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
  } finally {
    db.close();
  }
}

function withReadonly<T>(dbPath: string, fn: (index: KnowledgeIndex) => T): T {
  const index = openKnowledgeIndexReadonly(dbPath);
  try {
    return fn(index);
  } finally {
    index.close();
  }
}

const DB_RELATIVE = join(".patchdiet", "semantic-index.db");

describe("pinned git history ingestion", () => {
  it("collects multi-commit multi-file history with real commit identities and file-level co-change", async () => {
    const repo = await initRepo({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" }, "c1: add a and b");
    await commitFiles(repo, { "src/a.ts": "export const a = 2;\n", "src/b.ts": "export const b = 2;\n" }, "c2: change a and b");
    await commitFiles(repo, { "src/a.ts": "export const a = 3;\n" }, "c3: change a only");
    const pinned = await headCommit(repo);

    const result = await indexRepository({ cwd: repo, history: { git: true } });
    expect(result.repo.commit).toBe(pinned);
    expect(result.history).not.toBeNull();
    expect(result.history?.collected).toBe(true);
    expect(result.history?.commits).toBe(3);
    expect(result.history?.truncated).toBe(false);
    expect(result.history?.shallow).toBe(false);
    expect(result.history?.cochangePairs).toBeGreaterThanOrEqual(1);

    withReadonly(join(repo, DB_RELATIVE), (index) => {
      const snapshot = index.getHistorySnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot?.pinnedCommit).toBe(pinned);
      expect(snapshot?.current).toBe(true);
      expect(snapshot?.commitCount).toBe(3);
      const facts = index.getHistoryFactsForPaths(["src/a.ts", "src/b.ts", "src/c.ts"]);
      // c.ts never existed in this history: no fabricated facts.
      expect(facts["src/c.ts"]).toBeUndefined();
      const a = facts["src/a.ts"];
      expect(a?.changeCount).toBe(3);
      expect(a?.sourceCommits).toHaveLength(3);
      for (const sha of a?.sourceCommits ?? []) {
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      }
      expect(a?.sourceCommits).toContain(pinned);
      expect(a?.snapshotCommit).toBe(pinned);
      // File-level co-change: a and b were changed together in the init commit
      // AND in c2 (the fixture touches both files in both commits).
      expect(a?.coChangedWith).toEqual([{ path: "src/b.ts", count: 2 }]);
      expect(facts["src/b.ts"]?.changeCount).toBe(2);
    });
  });

  it("history comes from the pinned commit only: a dirty working tree never leaks in", async () => {
    const repo = await initRepo({ "src/a.ts": "export const a = 1;\n" }, "c1");
    await commitFiles(repo, { "src/a.ts": "export const a = 2;\n" }, "c2");
    const pinned = await headCommit(repo);
    // Dirty, UNCOMMITTED marker content that must never appear in history.
    await writeFile(join(repo, "src/a.ts"), "export const a = DIRTY_MARKER;\n", "utf8");

    const result = await indexRepository({ cwd: repo, history: { git: true } });
    expect(result.repo.commit).toBe(pinned);
    expect(result.history?.commits).toBe(2);
    withReadonly(join(repo, DB_RELATIVE), (index) => {
      const facts = index.getHistoryFactsForPaths(["src/a.ts"]);
      expect(facts["src/a.ts"]?.changeCount).toBe(2);
      // No fabricated third commit for the dirty edit.
      const snapshot = index.getHistorySnapshot();
      expect(snapshot?.commitCount).toBe(2);
    });
  });

  it("a moved ref / stale snapshot degrades explicitly with no facts attributed", async () => {
    const repo = await initRepo({ "src/a.ts": "export const a = 1;\n" }, "c1");
    await indexRepository({ cwd: repo, history: { git: true } });
    const dbPath = join(repo, DB_RELATIVE);
    // Simulate a moved ref: the index's pinned meta moves ahead of the stored
    // history snapshot. Consumers must report staleness and attach NOTHING.
    const db = new Database(dbPath);
    try {
      db.prepare("UPDATE meta SET value = '0".padEnd(41, "0") + "' WHERE key = 'last_commit'").run();
    } finally {
      db.close();
    }
    withReadonly(dbPath, (index) => {
      const snapshot = index.getHistorySnapshot();
      expect(snapshot?.current).toBe(false);
      expect(index.getHistoryFactsForPaths(["src/a.ts"])).toEqual({});
    });
  });

  it("configured-off history truly disables ingestion (no tables, no facts)", async () => {
    const repo = await initRepo({ "src/a.ts": "export const a = 1;\n" }, "c1");
    const result = await indexRepository({ cwd: repo, history: { git: false } });
    expect(result.history?.collected).toBe(false);
    const tables = dbTables(join(repo, DB_RELATIVE));
    for (const table of tables) {
      expect(table.startsWith("history_")).toBe(false);
    }
    withReadonly(join(repo, DB_RELATIVE), (index) => {
      expect(index.getHistorySnapshot()).toBeNull();
      expect(index.getHistoryFactsForPaths(["src/a.ts"])).toEqual({});
    });
  });

  it("bounds git work to the commit cap and reports truncation explicitly", async () => {
    const repo = makeTempDir("patchdiet-history-cap");
    await mkdir(repo, { recursive: true });
    await git(repo, "init", "-b", "main");
    // Bounded fixture: 105 commits generated through one fast-import stream
    // (plumbing, not 210 separate git invocations). Data lengths are BYTE
    // counts and committer timestamps need a timezone.
    const startEpoch = 1700000000;
    let stream = "";
    for (let i = 1; i <= MAX_HISTORY_COMMITS + 5; i += 1) {
      const subject = `c${i}\n`;
      const content = `export const a = ${i};\n`;
      stream +=
        `commit refs/heads/main\nmark :${i}\n` +
        `committer T <t@t> ${startEpoch + i} +0000\n` +
        `data ${Buffer.byteLength(subject, "utf8")}\n${subject}` +
        `M 100644 inline src/a.ts\ndata ${Buffer.byteLength(content, "utf8")}\n${content}`;
    }
    await writeFile(join(repo, "import.stream"), stream, "utf8");
    const streamBytes = await readFile(join(repo, "import.stream"));
    await new Promise<void>((resolve, reject) => {
      const child = spawn("git", ["fast-import", "--quiet"], { cwd: repo, windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
      child.stdin!.write(streamBytes);
      child.stdin!.end();
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`fast-import exited ${code}`))));
    });
    const result = await indexRepository({ cwd: repo, history: { git: true } });
    expect(result.history?.commits).toBe(MAX_HISTORY_COMMITS);
    expect(result.history?.truncated).toBe(true);
    expect(result.history?.diagnostics.some((d) => d.toLowerCase().includes("truncat"))).toBe(true);
    withReadonly(join(repo, DB_RELATIVE), (index) => {
      expect(index.getHistorySnapshot()?.truncated).toBe(true);
      expect(index.getHistoryFactsForPaths(["src/a.ts"])["src/a.ts"]?.changeCount).toBe(MAX_HISTORY_COMMITS);
    });
  });

  it("preserves unusual git path bytes (LF/TAB) exactly instead of dropping or corrupting them", async () => {
    const repo = makeTempDir("patchdiet-history-framing");
    await mkdir(repo, { recursive: true });
    await git(repo, "init", "-b", "main");
    // Build the commit entirely from git OBJECTS (no working-tree filenames,
    // which Windows cannot represent): a tree with a TAB-prefixed name, a
    // leading-LF name and an internal-LF name.
    const blob = async (content: string) => {
      const proc = spawn("git", ["hash-object", "-w", "--stdin"], { cwd: repo, windowsHide: true, stdio: ["pipe", "pipe", "inherit"] });
      let out = "";
      // Attach stdout listeners BEFORE waiting for close: the "end" event can
      // already have fired once the process is gone, and a late listener would
      // never resolve.
      proc.stdout!.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
      proc.stdin!.write(content);
      proc.stdin!.end();
      await new Promise<void>((resolve) => proc.on("close", resolve));
      return out.trim();
    };
    const sha1 = await blob("one\n");
    const sha2 = await blob("two\n");
    const sha3 = await blob("three\n");
    const sha4 = await blob("four\n");
    const treeBinary = Buffer.concat(
      [
        ["100644", "\nnewline-second.js", sha2],
        ["100644", "a\nnewline\nb.js", sha3],
        ["100644", "plain.js", sha4],
        ["100644", "tab\tfirst.js", sha1],
      ].map(([mode, name, hexSha]) =>
        Buffer.concat([Buffer.from(`${mode} `), Buffer.from(name, "utf8"), Buffer.from([0]), Buffer.from(hexSha, "hex")]),
      ),
    );
    const run = (args: string[], input?: Buffer): Promise<string> =>
      new Promise((resolve, reject) => {
        const child = spawn("git", args, { cwd: repo, windowsHide: true, stdio: [input ? "pipe" : "ignore", "pipe", "inherit"] });
        if (input && child.stdin) {
          child.stdin.write(input);
          child.stdin.end();
        }
        let out = "";
        child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
        child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`git ${args[0]} exited ${code}`))));
      });
    const treePath = join(repo, "weird.tree");
    await writeFile(treePath, treeBinary);
    const treeSha = await run(["hash-object", "-w", "-t", "tree", "--", "weird.tree"]);
    const commitSha = await run(["commit-tree", treeSha, "-m", "weird paths"]);
    await git(repo, "update-ref", "refs/heads/main", commitSha);

    const result = await indexRepository({ cwd: repo, ref: commitSha, history: { git: true } });
    expect(result.history?.commits).toBe(1);
    expect(result.history?.truncated).toBe(false);
    withReadonly(join(repo, DB_RELATIVE), (index) => {
      // Every recorded path byte is real: leading LF, internal LFs and the TAB
      // are preserved, nothing silently dropped or "plainified".
      const facts = index.getHistoryFactsForPaths([
        "tab\tfirst.js",
        "\nnewline-second.js",
        "a\nnewline\nb.js",
        "plain.js",
      ]);
      expect(Object.keys(facts).sort()).toEqual(
        ["\nnewline-second.js", "a\nnewline\nb.js", "plain.js", "tab\tfirst.js"].sort(),
      );
      for (const factsForPath of Object.values(facts)) {
        expect(factsForPath.changeCount).toBe(1);
      }
    });
  });

  // Shared plumbing helpers for object-only fixtures: real Git objects, no
  // working-tree filenames (which Windows cannot represent). stdout listeners
  // are attached BEFORE awaiting child close and non-zero exits reject.
  const plumbingBlob = (repo: string) => async (content: string): Promise<string> => {
    const proc = spawn("git", ["hash-object", "-w", "--stdin"], { cwd: repo, windowsHide: true, stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    proc.stdout!.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    proc.stdin!.write(content);
    proc.stdin!.end();
    await new Promise<void>((resolve, reject) =>
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git hash-object exited ${code}`)))),
    );
    return out.trim();
  };
  const plumbingRun = (repo: string) => (args: string[], input?: Buffer): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = spawn("git", args, { cwd: repo, windowsHide: true, stdio: [input ? "pipe" : "ignore", "pipe", "inherit"] });
      if (input && child.stdin) {
        child.stdin.write(input);
        child.stdin.end();
      }
      let out = "";
      child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
      child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`git ${args[0]} exited ${code}`))));
    });

  it("preserves a path containing the field separator byte (U+0001) as a real filename", async () => {
    // A tree entry whose name CONTAINS U+0001 — the very byte the log format
    // uses as its field separator — plus LF and TAB names. Header recognition
    // must use the commit-SHA header grammar (<40-hex><US> prefix), never a
    // bare "record contains the separator" test, or this path is misread as a
    // commit header and collection throws 'malformed git log record'.
    const repo = makeTempDir("patchdiet-history-fieldsep");
    await mkdir(repo, { recursive: true });
    await git(repo, "init", "-b", "main");
    const blob = plumbingBlob(repo);
    const sha = await blob("fieldsep\n");
    const treeBinary = Buffer.concat(
      [
        ["100644", "\u0001field-sep.js"],
        ["100644", "\tfirst.js"],
        ["100644", "\nsecond.js"],
        ["100644", "a\nb.js"],
      ]
        .sort((x, y) => (x[1]! < y[1]! ? -1 : x[1]! > y[1]! ? 1 : 0))
        .flatMap(([mode, name]) => [Buffer.from(`${mode} `), Buffer.from(name, "utf8"), Buffer.from([0]), Buffer.from(sha, "hex")]),
    );
    const run = plumbingRun(repo);
    const treeSha = await run(["hash-object", "--literally", "-w", "-t", "tree", "--stdin"], treeBinary);
    const commitSha = await run(["commit-tree", treeSha, "-m", "field separator path"]);
    await git(repo, "update-ref", "refs/heads/main", commitSha);

    const result = await indexRepository({ cwd: repo, ref: commitSha, history: { git: true } });
    expect(result.history?.commits).toBe(1);
    expect(result.history?.diagnostics).toEqual([]);
    withReadonly(join(repo, DB_RELATIVE), (index) => {
      const expected = ["\u0001field-sep.js", "\tfirst.js", "\nsecond.js", "a\nb.js"];
      const facts = index.getHistoryFactsForPaths(expected);
      expect(Object.keys(facts).sort()).toEqual([...expected].sort());
      for (const factsForPath of Object.values(facts)) {
        expect(factsForPath.changeCount).toBe(1);
      }
    });
  });

  it("fails history ingestion explicitly on invalid-UTF-8 git output instead of fabricating a path", async () => {
    // A tree entry named with the raw bytes 78 ff 2e 6a 73 ('x' + 0xFF +
    // '.js' — invalid UTF-8). Replacement-decoding the log stdout would store
    // 'x<U+FFFD>.js' as an exact Git fact: fabrication. The ingestion must
    // refuse explicitly instead of claiming a path git never reported.
    const repo = makeTempDir("patchdiet-history-utf8");
    await mkdir(repo, { recursive: true });
    await git(repo, "init", "-b", "main");
    const blob = plumbingBlob(repo);
    const sha = await blob("x\n");
    const badPath = Buffer.from([0x78, 0xff, 0x2e, 0x6a, 0x73]);
    const treeBinary = Buffer.concat([Buffer.from("100644 "), badPath, Buffer.from([0]), Buffer.from(sha, "hex")]);
    const run = plumbingRun(repo);
    const treeSha = await run(["hash-object", "--literally", "-w", "-t", "tree", "--stdin"], treeBinary);
    const commitSha = await run(["commit-tree", treeSha, "-m", "invalid utf8 path"]);
    await git(repo, "update-ref", "refs/heads/main", commitSha);

    await expect(indexRepository({ cwd: repo, ref: commitSha, history: { git: true } })).rejects.toThrow(
      /not valid UTF-8/i,
    );
  });

  it("keeps a header-shaped filename as a path: header recognition is positional, not syntactic", async () => {
    // A filename mimicking ALL SIX header fields (40hex US 40hex US name US
    // email US epoch US subject.js) is a legal Git tree entry — root's
    // independent spoof fixture. Syntax alone is ambiguous, so recognition
    // must be positional: the %x00 format prefix NUL-sentinel-frames every
    // real commit header, and a path record can never produce the empty
    // sentinel. Real Git objects, no working-tree filenames.
    const repo = makeTempDir("patchdiet-history-headerspoof");
    await mkdir(repo, { recursive: true });
    await git(repo, "init", "-b", "main");
    const blob = plumbingBlob(repo);
    const sha = await blob("spoof\n");
    const spoof =
      "a".repeat(40) +
      "\u0001" +
      "b".repeat(40) +
      "\u0001" +
      "name" +
      "\u0001" +
      "email" +
      "\u0001" +
      "1700000000" +
      "\u0001" +
      "subject.js";
    const expected = ["!first.js", spoof];
    const treeBinary = Buffer.concat(
      [...expected]
        .sort()
        .flatMap((name) => [Buffer.from("100644 "), Buffer.from(name, "utf8"), Buffer.from([0]), Buffer.from(sha, "hex")]),
    );
    const run = plumbingRun(repo);
    const treeSha = await run(["hash-object", "--literally", "-w", "-t", "tree", "--stdin"], treeBinary);
    const commitSha = await run(["commit-tree", treeSha, "-m", "header spoof path"]);
    await git(repo, "update-ref", "refs/heads/main", commitSha);

    const result = await indexRepository({ cwd: repo, ref: commitSha, history: { git: true } });
    expect(result.history?.commits).toBe(1);
    expect(result.history?.diagnostics).toEqual([]);
    withReadonly(join(repo, DB_RELATIVE), (index) => {
      const facts = index.getHistoryFactsForPaths(expected);
      expect(Object.keys(facts).sort()).toEqual([...expected].sort());
      for (const factsForPath of Object.values(facts)) {
        expect(factsForPath.changeCount).toBe(1);
      }
    });
  });

  it("reports a shallow repository honestly instead of presenting a shallow log as full history", async () => {
    const src = await initRepo({ "src/a.ts": "export const a = 1;\n" }, "c1");
    await commitFiles(src, { "src/a.ts": "export const a = 2;\n" }, "c2");
    await commitFiles(src, { "src/a.ts": "export const a = 3;\n" }, "c3");
    const shallow = makeTempDir("patchdiet-history-shallow");
    await git(tmpdir(), "clone", "--depth", "1", `file://${src.replace(/\\/g, "/")}`, shallow.replace(/\\/g, "/"));
    const result = await indexRepository({ cwd: shallow, history: { git: true } });
    expect(result.history?.shallow).toBe(true);
    expect(result.history?.commits).toBe(1);
    expect(result.history?.diagnostics.some((d) => d.toLowerCase().includes("shallow"))).toBe(true);
  });

  it("old original-schema indexes stay readonly-compatible: no history tables, empty facts, no writes", async () => {
    const repo = await initRepo({ "src/a.ts": "export const a = 1;\n" }, "c1");
    await indexRepository({ cwd: repo }); // no history option: original behavior
    const dbPath = join(repo, DB_RELATIVE);
    expect(dbTables(dbPath).some((t) => t.startsWith("history_"))).toBe(false);
    withReadonly(dbPath, (index) => {
      expect(index.getHistorySnapshot()).toBeNull();
      expect(index.getHistoryFactsForPaths(["src/a.ts"])).toEqual({});
      expect(index.getMergedPrs()).toEqual([]);
    });
    // The readonly session must not have created extension tables.
    expect(dbTables(dbPath).some((t) => t.startsWith("history_"))).toBe(false);
  });

  it("records merge and root commits honestly without fabricating merge file co-change", async () => {
    const repo = await initRepo({ "src/base.ts": "export const base = 1;\n" }, "root commit");
    await git(repo, "checkout", "-b", "feature");
    await commitFiles(repo, { "src/feature.ts": "export const feature = 1;\n" }, "feature work");
    await git(repo, "checkout", "main");
    await commitFiles(repo, { "src/base.ts": "export const base = 2;\n" }, "main work");
    await git(repo, "merge", "--no-ff", "-m", "merge feature", "feature");
    const pinned = await headCommit(repo);

    const result = await indexRepository({ cwd: repo, history: { git: true } });
    expect(result.history?.commits).toBe(4);
    withReadonly(join(repo, DB_RELATIVE), (index) => {
      const snapshot = index.getHistorySnapshot();
      expect(snapshot?.current).toBe(true);
      // The merge commit is recorded as a merge, not as a fake file list.
      const facts = index.getHistoryFactsForPaths(["src/feature.ts"]);
      expect(facts["src/feature.ts"]?.changeCount).toBe(1);
      expect(facts["src/feature.ts"]?.sourceCommits).toHaveLength(1);
      void pinned;
    });
  });
  it("reports merged-PR evidence explicitly unavailable when history ingestion is configured off", async () => {
    const repo = await initRepo({ "src/a.ts": "export const a = 1;\n" }, "c1");
    // Flag independence: merged_prs=true with git=false is never silently
    // ignored — the requirement is stated and the feature reports unavailable.
    const result = await indexRepository({ cwd: repo, history: { git: false, mergedPrsEnabled: true } });
    expect(result.history?.enabled).toBe(false);
    expect(result.history?.mergedPrs?.enabled).toBe(true);
    expect(result.history?.mergedPrs?.available).toBe(false);
    expect(result.history?.mergedPrs?.ingested).toBe(0);
    expect(result.history?.mergedPrs?.diagnostics.join(" ")).toMatch(/requires? knowledge\.history\.git/i);
  });
});

describe("caller-supplied merged-PR snapshots", () => {
  async function repoWithMerge(): Promise<{ repo: string; mergeCommit: string }> {
    const repo = await initRepo({ "src/a.ts": "export const a = 1;\n" }, "base");
    await git(repo, "checkout", "-b", "feature");
    await commitFiles(repo, { "src/feature.ts": "export const feature = 1;\n" }, "feature work");
    await git(repo, "checkout", "main");
    await git(repo, "merge", "--no-ff", "-m", "Merge pull request #7 from feature", "feature");
    const mergeCommit = await headCommit(repo);
    return { repo, mergeCommit };
  }

  function snapshotJson(records: unknown): string {
    return JSON.stringify({ schemaVersion: "patchdiet-merged-prs/1", records });
  }

  it("ingests a strict bounded caller-asserted snapshot with provenance, no network", async () => {
    const { repo, mergeCommit } = await repoWithMerge();
    const snapshotPath = "docs/merged-prs.json";
    await mkdir(join(repo, "docs"), { recursive: true });
    await writeFile(
      join(repo, snapshotPath),
      snapshotJson([{ pr: "#7", mergeCommit, snapshotPath: "docs/pr-7.patch", labels: ["local-run"] }]),
      "utf8",
    );
    const result = await indexRepository({
      cwd: repo,
      history: { git: true, mergedPrsEnabled: true, mergedPrsPath: snapshotPath },
    });
    expect(result.history?.mergedPrs?.ingested).toBe(1);
    withReadonly(join(repo, DB_RELATIVE), (index) => {
      const records = index.getMergedPrs();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        pr: "#7",
        mergeCommit,
        snapshotPath: "docs/pr-7.patch",
        provenance: "caller-asserted",
      });
      expect(records[0]?.labels).toEqual(["local-run"]);
      expect(records[0]?.indexedCommit).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  it("reports unavailable when merged-PR evidence is enabled but no snapshot exists", async () => {
    const repo = await initRepo({ "src/a.ts": "export const a = 1;\n" }, "base");
    const result = await indexRepository({ cwd: repo, history: { git: true, mergedPrsEnabled: true } });
    expect(result.history?.mergedPrs?.enabled).toBe(true);
    expect(result.history?.mergedPrs?.available).toBe(false);
    expect(result.history?.mergedPrs?.ingested).toBe(0);
    expect(result.history?.mergedPrs?.diagnostics.join(" ")).toMatch(/unavailable/i);
  });

  it("rejects malformed snapshots before any history_merged_prs write", async () => {
    const { repo, mergeCommit } = await repoWithMerge();
    const cases: { name: string; content: string }[] = [
      { name: "invalid json", content: "{not json" },
      { name: "unknown top-level field", content: JSON.stringify({ schemaVersion: "patchdiet-merged-prs/1", records: [], extra: 1 }) },
      {
        name: "unknown record field",
        content: snapshotJson([{ pr: "#1", mergeCommit, snapshotPath: "x.patch", extra: true }]),
      },
      { name: "missing snapshot provenance", content: snapshotJson([{ pr: "#1", mergeCommit }]) },
      { name: "missing pr identity", content: snapshotJson([{ mergeCommit, snapshotPath: "x.patch" }]) },
      { name: "duplicate pr identity", content: snapshotJson([
          { pr: "#1", mergeCommit, snapshotPath: "x.patch" },
          { pr: "#1", mergeCommit, snapshotPath: "y.patch" },
        ]) },
      { name: "unreachable merge commit", content: snapshotJson([{ pr: "#1", mergeCommit: "1".repeat(40), snapshotPath: "x.patch" }]) },
      { name: "non-commit sha", content: snapshotJson([{ pr: "#1", mergeCommit: "zzzz", snapshotPath: "x.patch" }]) },
      { name: "dot-dot traversal forward slashes", content: snapshotJson([{ pr: "#1", mergeCommit, snapshotPath: "src/../../outside.patch" }]) },
      { name: "dot-dot traversal backslashes", content: snapshotJson([{ pr: "#1", mergeCommit, snapshotPath: "src\\..\\outside.patch" }]) },
      { name: "embedded NUL in provenance", content: snapshotJson([{ pr: "#1", mergeCommit, snapshotPath: "pr\u0000.patch" }]) },
      { name: "absolute posix provenance", content: snapshotJson([{ pr: "#1", mergeCommit, snapshotPath: "/abs/pr.patch" }]) },
      { name: "drive-qualified provenance", content: snapshotJson([{ pr: "#1", mergeCommit, snapshotPath: "C:/abs/pr.patch" }]) },
      { name: "empty segment provenance", content: snapshotJson([{ pr: "#1", mergeCommit, snapshotPath: "docs//pr.patch" }]) },
      { name: "dot segment provenance", content: snapshotJson([{ pr: "#1", mergeCommit, snapshotPath: "docs/./pr.patch" }]) },
      { name: "control character provenance", content: snapshotJson([{ pr: "#1", mergeCommit, snapshotPath: "docs/pr\u0007.patch" }]) },
    ];
    for (const testCase of cases) {
      const snapshotPath = "docs/merged-prs.json";
    await mkdir(join(repo, "docs"), { recursive: true });
      await writeFile(join(repo, snapshotPath), testCase.content, "utf8");
      let errored = false;
      try {
        await indexRepository({
          cwd: repo,
          history: { git: true, mergedPrsEnabled: true, mergedPrsPath: snapshotPath },
        });
      } catch (error) {
        errored = true;
        expect((error as Error).message).toMatch(/^ERROR:/);
      }
      expect(errored, `expected rejection for case: ${testCase.name}`).toBe(true);
      if (dbTables(join(repo, DB_RELATIVE)).includes("history_merged_prs")) {
        const db = new Database(join(repo, DB_RELATIVE), { readonly: true, fileMustExist: true });
        try {
          const n = (db.prepare("SELECT COUNT(*) AS n FROM history_merged_prs").get() as { n: number }).n;
          expect(n, `expected no rows for case: ${testCase.name}`).toBe(0);
        } finally {
          db.close();
        }
      }
    }
  });

  it("hashes the actual input bytes and accepts legitimate dotted/space/Unicode provenance paths", async () => {
    const { repo, mergeCommit } = await repoWithMerge();
    const snapshotPath = "docs/pr 7.final.日本語.patch";
    await mkdir(join(repo, "docs"), { recursive: true });
    await writeFile(
      join(repo, snapshotPath),
      snapshotJson([{ pr: "#7", mergeCommit, snapshotPath, labels: ["日本語 ラベル"] }]),
      "utf8",
    );
    const result = await indexRepository({
      cwd: repo,
      history: { git: true, mergedPrsEnabled: true, mergedPrsPath: snapshotPath },
    });
    expect(result.history?.mergedPrs?.ingested).toBe(1);
    // The stored hash is the SHA-256 of the ACTUAL file bytes on disk.
    const actualBytes = await readFile(join(repo, snapshotPath));
    const expectedSha = createHash("sha256").update(actualBytes).digest("hex");
    withReadonly(join(repo, DB_RELATIVE), (index) => {
      const records = index.getMergedPrs();
      expect(records).toHaveLength(1);
      expect(records[0]?.inputContentSha).toBe(expectedSha);
      expect(records[0]?.inputPath).toBe(snapshotPath);
      expect(records[0]?.labels).toEqual(["日本語 ラベル"]);
    });
  });

  it("rejects invalid UTF-8 snapshot input instead of replacement-decoding it", async () => {
    const { repo, mergeCommit } = await repoWithMerge();
    await mkdir(join(repo, "docs"), { recursive: true });
    const snapshotPath = "docs/merged-prs.json";
    // Valid JSON shape prefix, then an invalid UTF-8 byte (0xFF).
    await writeFile(join(repo, snapshotPath), Buffer.concat([Buffer.from('{"schemaVersion":"patchdiet-merged-prs/1","records":[]', "utf8"), Buffer.from([0xff, 0x7d, 0x7d])]));
    let errored = false;
    try {
      await indexRepository({ cwd: repo, history: { git: true, mergedPrsEnabled: true, mergedPrsPath: snapshotPath } });
    } catch (error) {
      errored = true;
      expect((error as Error).message).toMatch(/not valid UTF-8/);
    }
    expect(errored).toBe(true);
  });

  it("replacing history is idempotent: reindexing the same commit does not duplicate rows", async () => {
    const { repo, mergeCommit } = await repoWithMerge();
    const snapshotPath = "docs/merged-prs.json";
    await mkdir(join(repo, "docs"), { recursive: true });
    await writeFile(
      join(repo, snapshotPath),
      snapshotJson([{ pr: "#7", mergeCommit, snapshotPath: "docs/pr-7.patch" }]),
      "utf8",
    );
    const options = { cwd: repo, history: { git: true, mergedPrsEnabled: true, mergedPrsPath: snapshotPath } };
    await indexRepository(options);
    await indexRepository(options);
    withReadonly(join(repo, DB_RELATIVE), (index) => {
      expect(index.getMergedPrs()).toHaveLength(1);
      expect(index.getHistorySnapshot()?.commitCount).toBe(3);
    });
  });

  it("reindexing with merged-PR evidence disabled removes stale caller-asserted rows", async () => {
    const { repo, mergeCommit } = await repoWithMerge();
    const snapshotPath = "docs/merged-prs.json";
    await mkdir(join(repo, "docs"), { recursive: true });
    await writeFile(join(repo, snapshotPath), snapshotJson([{ pr: "#7", mergeCommit, snapshotPath: "docs/pr-7.patch" }]), "utf8");
    await indexRepository({ cwd: repo, history: { git: true, mergedPrsEnabled: true, mergedPrsPath: snapshotPath } });
    await indexRepository({ cwd: repo, history: { git: true, mergedPrsEnabled: false } });
    withReadonly(join(repo, DB_RELATIVE), (index) => {
      expect(index.getMergedPrs()).toEqual([]);
    });
  });
});

describe("history evidence stays weak, neutral and classification-neutral", () => {
  it("attaches a neutral weak history record with real commit identity and never changes scope state", async () => {
    const { analyzeScope } = await import("../../packages/scope/src/index.js");
    const { normalizeIntent } = await import("../../packages/intent/src/index.js");
    const atoms = [{ filePath: "src/a.ts", symbolPath: "a", hunkHeader: "@@ -1,1 +1,1 @@", index: 0 }];
    const intent = normalizeIntent([{ id: "cli:task", kind: "cli", text: "unrelated maintenance", order: 0 }], { llm: "off" });
    const base = analyzeScope(intent, { atoms });
    const withHistory = analyzeScope(intent, {
      atoms,
      history: {
        [base.atoms[0]!.atomId]: {
          changeCount: 3,
          sourceCommits: ["a".repeat(40), "b".repeat(40)],
          snapshotCommit: "c".repeat(40),
          coChangedWith: [{ path: "src/b.ts", count: 2 }],
        },
      },
    });
    // Classification state, eligibility and risks are identical: history never
    // changes a classification on its own.
    expect(withHistory.atoms[0]?.state).toBe(base.atoms[0]?.state);
    expect(withHistory.atoms[0]?.removalEligible).toBe(base.atoms[0]?.removalEligible);
    expect(withHistory.atoms[0]?.risks).toEqual(base.atoms[0]?.risks);
    // The evidence carries the real identities, weak and neutral.
    const record = withHistory.evidence.find(
      (e) => e.category === "history" && e.atomId === withHistory.atoms[0]?.atomId,
    );
    expect(record).toBeDefined();
    expect(record?.polarity).toBe("neutral");
    expect(record?.reliability).toBe("weak");
    expect(record?.detail).toContain("a".repeat(40));
    expect(record?.detail).toContain("c".repeat(40));
    expect((record?.limits ?? []).join(" ")).toMatch(/never authorises removal/i);
  });

  it("exposes caller-asserted merged-PR records as citable GLOBAL neutral evidence with real identities and hashes", async () => {
    const { analyzeScope } = await import("../../packages/scope/src/index.js");
    const { normalizeIntent } = await import("../../packages/intent/src/index.js");
    const mergeCommit = "a".repeat(40);
    const record = {
      pr: "#7",
      mergeCommit,
      snapshotPath: "docs/pr-7.patch",
      labels: ["local-snapshot"],
      inputPath: "docs/merged-prs.json",
      inputContentSha: "b".repeat(64),
      indexedCommit: "c".repeat(40),
    };
    const atoms = [{ filePath: "src/a.ts", symbolPath: "a", hunkHeader: "@@ -1,1 +1,1 @@", index: 0 }];
    const intent = normalizeIntent([{ id: "cli:task", kind: "cli", text: "unrelated maintenance", order: 0 }], { llm: "off" });
    const base = analyzeScope(intent, { atoms });
    const withPr = analyzeScope(intent, { atoms, mergedPrs: [record] });

    // The record is citable: real PR identity, full merge commit, input source
    // and byte hash appear in a weak NEUTRAL global history evidence record.
    const evidenceRecord = withPr.evidence.find((entry) => entry.sourceId === "merged-pr:#7");
    expect(evidenceRecord).toBeDefined();
    expect(evidenceRecord?.category).toBe("history");
    expect(evidenceRecord?.polarity).toBe("neutral");
    expect(evidenceRecord?.reliability).toBe("weak");
    expect(evidenceRecord?.atomId).toBeUndefined();
    expect(evidenceRecord?.detail).toContain(mergeCommit);
    expect(evidenceRecord?.detail).toContain("sha256:".concat("b".repeat(64)));
    expect(evidenceRecord?.detail).toContain("docs/merged-prs.json");
    expect((evidenceRecord?.limits ?? []).join(" ")).toMatch(/caller assertion/i);
    expect((evidenceRecord?.limits ?? []).join(" ")).toMatch(/never authorises? removal/i);

    // Nothing about the classifications changed, and the analysis identity IS
    // sensitive to the input provenance (a different byte hash = a different
    // analysisId).
    expect(withPr.summary).toEqual(base.summary);
    expect(withPr.atoms.map((atom) => [atom.state, atom.removalEligible])).toEqual(
      base.atoms.map((atom) => [atom.state, atom.removalEligible]),
    );
    expect(withPr.analysisId).not.toBe(base.analysisId);
    const otherHash = analyzeScope(intent, { atoms, mergedPrs: [{ ...record, inputContentSha: "d".repeat(64) }] });
    expect(otherHash.analysisId).not.toBe(withPr.analysisId);
  });
});
