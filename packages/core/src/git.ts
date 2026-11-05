import { execFile } from "node:child_process";
import { isUtf8 } from "node:buffer";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DiffResult {
  diff: string;
  /**
   * How `diff` was decoded from git's raw output. "utf8" when the stream was
   * valid UTF-8; "latin1" when it contained non-UTF-8 bytes, decoded
   * byte-reversibly so patch bytes survive round-trips. Callers must check
   * this: a latin1 diff must be treated as opaque bytes (human review, no
   * text-based removal evidence), and any patch written back must use the
   * same encoding (`Buffer.from(patch, encoding)` / writeFileSync encoding).
   */
  encoding?: "utf8" | "latin1";
}

export async function getDiff(
  cwd: string,
  baseRef: string,
  headRef: string
): Promise<DiffResult> {
  // 32 MiB cap: the Node default (1 MiB) makes mid-size diffs fail with a
  // confusing spawn error, and an unbounded capture would let a pathological
  // diff exhaust memory. Beyond the cap getDiff fails closed — the caller
  // reports the error instead of trimming a patch that would no longer apply.
  const MAX_DIFF_BYTES = 32 * 1024 * 1024;
  // --binary keeps the full GIT binary patch payload in the stream so the
  // parser can round-trip it byte-exact; without it binary sections degrade
  // to "Binary files … differ" placeholders that can never be re-applied.
  // core.quotepath=true forces octal-escaped (pure-ASCII) paths so the quoted
  // header lines survive any decoding; --no-ext-diff/--no-textconv keep the
  // output deterministic and machine-applyable.
  const { stdout } = await execFileAsync(
    "git",
    [
      "-c", "core.quotepath=true",
      "diff",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      `${baseRef}...${headRef}`
    ],
    { cwd, encoding: "buffer", maxBuffer: MAX_DIFF_BYTES }
  );

  // Byte-faithful capture: a raw text diff can contain invalid UTF-8 (e.g. a
  // source file in latin-1 that git considers text because it has no NUL
  // byte). Decoding such a stream as utf8 rewrites every bad byte to U+FFFD
  // and silently corrupts the patch; latin1 maps bytes 1:1 to code points and
  // is fully reversible on write.
  if (isUtf8(stdout)) {
    return { diff: stdout.toString("utf8"), encoding: "utf8" };
  }
  return { diff: stdout.toString("latin1"), encoding: "latin1" };
}

export async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    args,
    { cwd }
  );

  return stdout;
}
