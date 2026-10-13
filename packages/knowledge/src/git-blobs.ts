import { execFile, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Canonical repository root (realpath of `git rev-parse --show-toplevel`). */
export async function resolveRepoRoot(cwd: string): Promise<string> {
  const toplevel = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!toplevel) {
    throw new Error(`ERROR: '${cwd}' is not inside a git repository.`);
  }
  return realpathSync(toplevel);
}

/** Resolve a ref to a full 40-hex commit SHA (pinned; never a working-tree read). */
export async function resolveCommit(cwd: string, ref: string): Promise<string> {
  const commit = (await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`ERROR: ref '${ref}' did not resolve to a commit in '${cwd}'.`);
  }
  return commit;
}

export interface TreeEntry {
  path: string;
  blobSha: string;
  mode: string;
}

/** Full recursive listing of a commit's tree, NUL-delimited. */
export async function listTree(cwd: string, commit: string): Promise<TreeEntry[]> {
  const out = await git(cwd, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  const entries: TreeEntry[] = [];
  for (const record of out.split("\u0000")) {
    if (!record) {
      continue;
    }
    const metaTab = record.indexOf("\t");
    if (metaTab < 0) {
      continue;
    }
    const [mode, type, sha] = record.slice(0, metaTab).split(/\s+/);
    const path = record.slice(metaTab + 1);
    if (type === "blob" && mode && sha && path) {
      entries.push({ path, blobSha: sha, mode });
    }
  }
  return entries;
}

/** Default bounds: one blob ≤ 16 MiB, one batch ≤ 512 MiB of blob payload. */
export const DEFAULT_MAX_BLOB_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

export interface ReadBlobsOptions {
  /** Per-blob payload bound; exceeding it kills the stream and rejects. */
  maxBlobBytes?: number;
  /** Aggregate payload bound across the whole batch. */
  maxTotalBytes?: number;
  /** Fail closed when a blob is not valid UTF-8 (never replacement-decode). */
  requireValidUtf8?: boolean;
}

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Strict, byte-faithful UTF-8 decode for indexed source and rule blobs.
 *
 * - `ignoreBOM: true` keeps a leading U+FEFF in the decoded string so that
 *   parser byte offsets and content hashes remain aligned with the raw blob
 *   bytes (the default TextDecoder would silently strip it and shift every
 *   subsequent byte).
 * - `fatal: true` never fabricates U+FFFD: invalid bytes fail closed and the
 *   caller records an explicit incomplete/refusal outcome instead of indexing
 *   replacement text.
 */
export function decodeUtf8Strict(bytes: Buffer): { ok: true; text: string } | { ok: false; reason: string } {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    return { ok: true, text: decoder.decode(bytes) };
  } catch (error) {
    return { ok: false, reason: `invalid UTF-8 byte sequence (${(error as Error).message})` };
  }
}

/**
 * Read blob contents via `git cat-file --batch` (single process, framed
 * output). Content comes from the object database only — never the working
 * tree — so dirty/untracked files cannot leak into the index.
 *
 * Guarantees:
 * - byte-faithful extraction: exactly `size` payload bytes per frame; the
 *   framing LF after the payload is consumed separately and never included;
 * - strict UTF-8 validation when requireValidUtf8 is set — invalid bytes
 *   fail closed with an encoding error instead of silently becoming U+FFFD;
 * - bounded memory: consumed frames are compacted out of the buffer and both
 *   per-blob and aggregate payload limits kill the stream and reject;
 * - stderr is capped and the child's exit status is validated.
 */
export async function readBlobs(cwd: string, shas: string[], options: ReadBlobsOptions = {}): Promise<Map<string, Buffer>> {
  const maxBlobBytes = options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const result = new Map<string, Buffer>();
  if (shas.length === 0) {
    return result;
  }
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], { cwd, windowsHide: true });
    // Buffer.concat returns Buffer<ArrayBufferLike>; annotate explicitly so the
    // accumulator is not pinned to the narrower Buffer<ArrayBuffer> that
    // Buffer.alloc infers (chunk data events are typed separately).
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let cursor = 0;
    let stderr = Buffer.alloc(0);
    let stderrTruncated = false;
    let totalBytes = 0;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(error);
    };

    const compact = (): void => {
      if (cursor > 1024 * 1024) {
        buffer = Buffer.from(buffer.subarray(cursor));
        cursor = 0;
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      // Parse framed responses: "<sha> blob <size>\n<payload>\n"
      for (;;) {
        const headerEnd = buffer.indexOf(0x0a, cursor);
        if (headerEnd < 0) {
          compact();
          return;
        }
        const header = buffer.subarray(cursor, headerEnd).toString("utf8");
        const match = /^([0-9a-f]{40})\s+blob\s+(\d+)$/.exec(header);
        if (!match) {
          fail(new Error(`ERROR: unexpected 'git cat-file --batch' header: '${header.slice(0, 120)}'.`));
          return;
        }
        const sha = match[1];
        const size = Number(match[2]);
        if (size > maxBlobBytes) {
          fail(
            new Error(
              `ERROR: blob ${sha} is ${size} bytes and exceeds the ${maxBlobBytes}-byte per-blob bound; refusing unbounded input.`,
            ),
          );
          return;
        }
        const payloadStart = headerEnd + 1;
        const payloadEnd = payloadStart + size; // EXACT payload bytes
        const frameEnd = payloadEnd + 1; // framing LF, consumed separately
        if (buffer.length < frameEnd) {
          compact();
          return;
        }
        const payload = buffer.subarray(payloadStart, payloadEnd);
        if (options.requireValidUtf8) {
          try {
            fatalUtf8Decoder.decode(payload);
          } catch {
            fail(
              new Error(
                `ERROR: blob ${sha} is not valid UTF-8; refusing to index fabricated text (encoding error).`,
              ),
            );
            return;
          }
        }
        totalBytes += size;
        if (totalBytes > maxTotalBytes) {
          fail(
            new Error(
              `ERROR: batch blob payload exceeds the ${maxTotalBytes}-byte aggregate bound; refusing unbounded input.`,
            ),
          );
          return;
        }
        result.set(sha, Buffer.from(payload)); // copy: buffer gets compacted
        cursor = frameEnd; // skip the framing LF only now
        compact();
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        const room = MAX_STDERR_BYTES - stderr.length;
        stderr = Buffer.concat([stderr, chunk.subarray(0, room)]);
        if (chunk.length > room) {
          stderrTruncated = true;
        }
      } else {
        stderrTruncated = true;
      }
    });

    child.on("error", (error) => fail(new Error(`ERROR: could not run 'git cat-file --batch': ${error.message}`)));

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code !== 0) {
        reject(
          new Error(
            `ERROR: 'git cat-file --batch' exited with code ${code}: ${stderr.toString("utf8")}` +
              (stderrTruncated ? " (stderr truncated)" : ""),
          ),
        );
        return;
      }
      if (stderr.length > 0) {
        reject(
          new Error(
            `ERROR: 'git cat-file --batch' wrote to stderr: ${stderr.toString("utf8")}` +
              (stderrTruncated ? " (stderr truncated)" : ""),
          ),
        );
        return;
      }
      const missing = shas.filter((sha) => !result.has(sha));
      if (missing.length > 0) {
        reject(new Error(`ERROR: blobs missing from object database: ${missing.join(", ")}.`));
        return;
      }
      resolve(result);
    });

    child.stdin.on("error", (error) => fail(new Error(`ERROR: writing to 'git cat-file --batch' failed: ${error.message}`)));
    child.stdin.write(shas.map((sha) => `${sha}\n`).join(""));
    child.stdin.end();
  });
}
