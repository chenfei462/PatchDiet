import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface RunCommandOptions {
  timeoutMs?: number;
  retries?: number;
  maxOutputBytes?: number;
}

export async function runCommand(
  command: string,
  cwd: string,
  options: RunCommandOptions = {}
): Promise<{ exitCode: number; stdout: string; stderr: string; attempts: number; timedOut: boolean }> {
  const maxAttempts = Math.max(1, (options.retries ?? 0) + 1);
  let lastResult = {
    exitCode: 1,
    stdout: "",
    stderr: "",
    attempts: 0,
    timedOut: false
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await runOnce(command, cwd, options, attempt);
    if (lastResult.exitCode === 0) {
      return lastResult;
    }
  }

  return lastResult;
}

async function runOnce(
  command: string,
  cwd: string,
  options: RunCommandOptions,
  attempt: number
): Promise<{ exitCode: number; stdout: string; stderr: string; attempts: number; timedOut: boolean }> {
  try {
    const result = await execAsync(command, {
      cwd,
      timeout: options.timeoutMs
    });
    return {
      exitCode: 0,
      stdout: truncate(result.stdout, options.maxOutputBytes),
      stderr: truncate(result.stderr, options.maxOutputBytes),
      attempts: attempt,
      timedOut: false
    };
  } catch (error) {
    const failure = error as { code?: number; signal?: string; killed?: boolean; stdout?: string; stderr?: string };
    const timedOut = failure.signal === "SIGTERM" || failure.killed === true;
    return {
      exitCode: failure.code ?? (timedOut ? 124 : 1),
      stdout: truncate(failure.stdout ?? "", options.maxOutputBytes),
      stderr: truncate(failure.stderr ?? "", options.maxOutputBytes),
      attempts: attempt,
      timedOut
    };
  }
}

function truncate(value: string, maxOutputBytes = 16_384): string {
  if (value.length <= maxOutputBytes) {
    return value;
  }

  return `${value.slice(0, maxOutputBytes)}\n...[truncated]`;
}
