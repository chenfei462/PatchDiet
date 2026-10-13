import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";

export type CommandFailureKind = "none" | "test-failure" | "timeout" | "spawn-error";

export type CommandStatus = "passed" | "failed";

export interface CommandRunOptions {
  /** Kill the command (and its process tree) after this many milliseconds. */
  timeoutMs?: number;
  /** Explicit environment variables for the child process, merged over the parent env. */
  env?: Record<string, string | undefined>;
  /** Environment variable names that must never reach the child process. */
  scrubEnv?: string[];
  /** Bytes kept per stream before the capture buffer starts dropping old output. */
  maxCaptureBytes?: number;
}

export interface CommandRunResult {
  command: string;
  status: CommandStatus;
  exitCode: number;
  failureKind: CommandFailureKind;
  stdout: string;
  stderr: string;
  stdoutSummary: string;
  stderrSummary: string;
  timedOut: boolean;
  outputTruncated: boolean;
  durationMs: number;
}

// Verbose-but-passing commands (large `node --test` runs, multi-megabyte diffs)
// used to hit Node's default 1 MiB `exec` maxBuffer and be reported as failures.
const DEFAULT_MAX_CAPTURE_BYTES = 32 * 1024 * 1024;
const SUMMARY_LINE_LIMIT = 12;
const KILL_GRACE_MS = 2_000;

const SECRET_PATTERNS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bnpm_[A-Za-z0-9]{8,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g
];

/** Replaces credential-shaped substrings with `[redacted]` before persisting output. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted;
}

/**
 * Keeps the trailing, non-blank lines of captured output (the part that carries
 * test failures and summaries) and redacts credentials from them.
 */
export function summarizeOutput(output: string): string {
  return redactSecrets(output)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-SUMMARY_LINE_LIMIT)
    .join("\n");
}

function buildChildEnv(options: CommandRunOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(options.env ?? {}) };
  const caseInsensitive = process.platform === "win32";

  for (const name of options.scrubEnv ?? []) {
    delete env[name];
    if (!caseInsensitive) {
      continue;
    }
    const lowered = name.toLowerCase();
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === lowered) {
        delete env[key];
      }
    }
  }

  return env;
}

function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    try {
      // `child.kill()` alone leaves `npm`/`vitest` grandchildren running, so the
      // tree walk is delegated to `taskkill /T`. Killing the shell here first
      // would race that enumeration: taskkill then finds no tree to walk, the
      // grandchild survives holding the inherited stdio pipes (`close` never
      // fires) and its working directory (cleanup `rmSync` hits EPERM).
      // taskkill.exe is resolved from the absolute Windows directory, not from
      // PATH: a runner whose PATH lacks System32 (CI, service, restricted
      // shell) must still be able to terminate the whole timed-out tree.
      const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
      const taskkillPath = join(systemRoot, "System32", "taskkill.exe");
      const taskkill = spawn(taskkillPath, ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      // Only if taskkill could not even start, fall back to a direct kill of
      // the shell (best effort — grandchildren may survive in that case).
      taskkill.on("error", () => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process already exited.
        }
      });
      return;
    } catch {
      // Fall through to the direct kill below.
    }
  } else {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // The child was not a process-group leader; fall through.
    }
  }

  try {
    child.kill("SIGKILL");
  } catch {
    // The process already exited.
  }
}

/**
 * Runs a shell command and reports a detailed, non-throwing result.
 *
 * Output is captured with a rolling tail buffer instead of `exec`'s fixed
 * `maxBuffer`, so a verbose command that passes is not reported as a failure.
 */
export async function runCommandDetailed(
  command: string,
  cwd: string,
  options: CommandRunOptions = {}
): Promise<CommandRunResult> {
  const startedAt = Date.now();
  const childEnv = buildChildEnv(options);
  const maxCaptureBytes = options.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE_BYTES;

  return await new Promise<CommandRunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let timedOut = false;
    let spawnError: Error | undefined;
    let settled = false;
    const timers: NodeJS.Timeout[] = [];

    const child = spawn(command, {
      cwd,
      env: childEnv,
      shell: true,
      windowsHide: true,
      // A dedicated process group lets the timeout kill the whole tree on POSIX.
      detached: process.platform !== "win32"
    });

    const clearTimers = () => {
      for (const timer of timers.splice(0)) {
        clearTimeout(timer);
      }
    };

    const finish = (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();

      const exitCode = timedOut
        ? typeof code === "number" && code !== 0
          ? code
          : 124
        : typeof code === "number"
          ? code
          : spawnError
            ? 1
            : 0;

      resolve({
        command,
        status: exitCode === 0 ? "passed" : "failed",
        exitCode,
        failureKind: timedOut
          ? "timeout"
          : exitCode === 0
            ? "none"
            : spawnError
              ? "spawn-error"
              : "test-failure",
        stdout,
        stderr,
        stdoutSummary: summarizeOutput(stdout),
        stderrSummary: summarizeOutput(stderr),
        timedOut,
        outputTruncated,
        durationMs: Date.now() - startedAt
      });
    };

    const append = (chunk: string, stream: "stdout" | "stderr") => {
      if (stream === "stdout") {
        stdout += chunk;
        if (stdout.length > maxCaptureBytes) {
          stdout = stdout.slice(-maxCaptureBytes);
          outputTruncated = true;
        }
        return;
      }

      stderr += chunk;
      if (stderr.length > maxCaptureBytes) {
        stderr = stderr.slice(-maxCaptureBytes);
        outputTruncated = true;
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => append(chunk, "stdout"));
    child.stderr?.on("data", (chunk: string) => append(chunk, "stderr"));

    child.on("error", (error: Error) => {
      spawnError = error;
      finish(null);
    });

    // `close` (unlike `exit`) also waits for the stdio pipes, so no output is lost.
    child.on("close", (code: number | null) => {
      finish(code);
    });

    if (options.timeoutMs && options.timeoutMs > 0) {
      timers.push(
        setTimeout(() => {
          timedOut = true;
          terminateProcessTree(child);
          timers.push(setTimeout(() => finish(null), KILL_GRACE_MS));
        }, options.timeoutMs)
      );
    }
  });
}

/** Backwards-compatible wrapper around {@link runCommandDetailed}. */
export async function runCommand(
  command: string,
  cwd: string,
  options: CommandRunOptions = {}
): Promise<CommandRunResult> {
  return await runCommandDetailed(command, cwd, options);
}
