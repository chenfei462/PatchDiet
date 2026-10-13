import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { listTree, readBlobs, resolveCommit } from "../../packages/knowledge/src/git-blobs.js";

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
  // core.autocrlf=false is pinned per-command so the committed blob bytes are
  // the bytes written: a global autocrlf=true would normalize CRLF→LF on
  // commit and make the "exact bytes" assertions test git's normalization
  // instead of readBlobs' framing.
  const { stdout } = await execFileAsync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "core.autocrlf=false", ...args],
    { cwd, windowsHide: true },
  );
  return stdout;
}

async function initRepoWithBytes(files: Record<string, Buffer>): Promise<string> {
  const dir = makeTempDir("patchdiet-blob-repo");
  await mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  await git(dir, "init", "-b", "main");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", "init");
  return dir;
}

describe("readBlobs: byte-faithful extraction", () => {
  it("returns EXACT blob bytes with no trailing separator and no newline injection", async () => {
    const noNewline = Buffer.from("export const x = 1;", "utf8"); // NO trailing LF
    const withNewline = Buffer.from("def f():\n    return 1\n", "utf8"); // trailing LF
    const crlf = Buffer.from("const a = 1;\r\nconst b = 2;\r\n", "utf8"); // CRLF
    const repo = await initRepoWithBytes({
      "src/no-newline.ts": noNewline,
      "src/newline.py": withNewline,
      "src/crlf.ts": crlf,
    });
    const commit = await resolveCommit(repo, "HEAD");
    const tree = await listTree(repo, commit);
    const byPath = new Map(tree.map((e) => [e.path, e.blobSha]));

    const blobs = await readBlobs(repo, [...byPath.values()]);
    expect(blobs.get(byPath.get("src/no-newline.ts")!)!.equals(noNewline)).toBe(true);
    expect(blobs.get(byPath.get("src/newline.py")!)!.equals(withNewline)).toBe(true);
    expect(blobs.get(byPath.get("src/crlf.ts")!)!.equals(crlf)).toBe(true);
  });

  it("fails closed on invalid UTF-8 instead of replacement-decoding", async () => {
    // "# " + 0xFF 0xFE + "\n": invalid UTF-8 comment bytes.
    const invalid = Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]);
    const repo = await initRepoWithBytes({ "src/nonutf8.js": invalid });
    const commit = await resolveCommit(repo, "HEAD");
    const tree = await listTree(repo, commit);
    const sha = tree.find((e) => e.path === "src/nonutf8.js")!.blobSha;

    const blobs = await readBlobs(repo, [sha]);
    const raw = blobs.get(sha)!;
    expect(raw.equals(invalid)).toBe(true);
    // Strict decoding must reject rather than fabricate U+FFFD text.
    expect(() => raw.toString("utf-8")).not.toThrow(); // lenient Buffer API exists…
    let fatalRejected = false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      fatalRejected = true;
    }
    expect(fatalRejected).toBe(true);
    // The index caller-level helper must fail closed.
    await expect(readBlobs(repo, [sha], { requireValidUtf8: true })).rejects.toThrow(/utf-8|encoding/i);
  });

  it("rejects blobs over the per-blob bound and kills the stream cleanly", async () => {
    const big = Buffer.alloc(64 * 1024, 0x61); // 64 KiB of 'a'
    const repo = await initRepoWithBytes({ "src/big.ts": big, "src/ok.ts": Buffer.from("const ok = 1;\n", "utf8") });
    const commit = await resolveCommit(repo, "HEAD");
    const tree = await listTree(repo, commit);
    const byPath = new Map(tree.map((e) => [e.path, e.blobSha]));

    await expect(
      readBlobs(repo, [byPath.get("src/big.ts")!, byPath.get("src/ok.ts")!], { maxBlobBytes: 1024 }),
    ).rejects.toThrow(/exceed|too large|bound/i);
  });
});
