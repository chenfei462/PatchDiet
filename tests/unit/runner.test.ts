import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCommand, runCommandDetailed, summarizeOutput } from "../../packages/core/src/runner.js";

const tempDirs: string[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "patchdiet-runner-"));
  tempDirs.push(dir);
  return dir;
}

function nodeCommand(dir: string, body: string): string {
  const scriptPath = join(dir, "script.js");
  writeFileSync(scriptPath, body, "utf8");
  return `"${process.execPath}" "${scriptPath}"`;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmWithRetry(dir);
  }
});

// On Windows a just-terminated child can keep its working directory briefly
// locked (handle release lags TerminateProcess, and AV/indexer scans add
// windows of their own), so give cleanup a bounded retry before failing.
function rmWithRetry(dir: string, attempts = 25, delayMs = 200): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}

describe("runCommand", () => {
  it("treats a passing command with multi-megabyte output as passed", async () => {
    // Regression test: Node's default exec maxBuffer (1 MiB) used to reject a
    // verbose-but-passing command, which surfaced as a false "required command failed".
    const dir = scratchDir();
    const command = nodeCommand(
      dir,
      "process.stdout.write('x'.repeat(3 * 1024 * 1024)); process.exit(0);"
    );

    const result = await runCommandDetailed(command, dir);

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.failureKind).toBe("none");
  });

  it("reports the real exit code for a failing command", async () => {
    const dir = scratchDir();
    const command = nodeCommand(dir, "process.stderr.write('boom'); process.exit(2);");

    const result = await runCommandDetailed(command, dir);

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(2);
    expect(result.failureKind).toBe("test-failure");
  });

  it("flags a timeout and reports it as timed out", async () => {
    const dir = scratchDir();
    const command = nodeCommand(dir, "setTimeout(() => process.exit(0), 60_000);");

    const result = await runCommand(command, dir, { timeoutMs: 250 });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  // Windows-only regression: tree termination must not depend on System32
  // being on PATH. A runner whose PATH contains only the Node directory used
  // to leave the timed-out grandchild alive after the timeout verdict,
  // holding its working directory (cleanup EPERM) and running on.
  const itOnWindows = process.platform === "win32" ? it : it.skip;

  itOnWindows("kills the whole owned descendant tree on timeout when System32 is not on PATH", async () => {
    await expectTimeoutKillsDescendant({ restrictPath: true });
  });

  itOnWindows("kills the whole owned descendant tree on timeout with a normal PATH", async () => {
    await expectTimeoutKillsDescendant({ restrictPath: false });
  });

  async function expectTimeoutKillsDescendant({ restrictPath }: { restrictPath: boolean }): Promise<void> {
    const dir = scratchDir();
    const pidMarker = join(dir, "owned-child.pid");
    const lateMarker = `${pidMarker}.late`;
    // The helper reports its own PID, then writes a late marker at 4s to
    // prove (by absence) that it did not merely survive the kill silently.
    const helperPath = join(dir, "owned-child.mjs");
    writeFileSync(
      helperPath,
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync(process.env.OWNED_PID_FILE, String(process.pid));",
        "setTimeout(() => writeFileSync(process.env.OWNED_PID_FILE + '.late', 'late'), 4000);",
        "setInterval(() => {}, 1000);"
      ].join("\n"),
      "utf8"
    );
    const command = `"${process.execPath}" "${helperPath}"`;

    const savedPath = process.env.PATH;
    try {
      if (restrictPath) {
        // Simulate a restricted runner: Node's directory only, no System32.
        process.env.PATH = join(process.execPath, "..");
      }
      const result = await runCommandDetailed(command, dir, {
        timeoutMs: 500,
        env: { OWNED_PID_FILE: pidMarker }
      });
      expect(result.timedOut).toBe(true);

      // The owned descendant must be dead before the timeout verdict resolves.
      const pid = Number(readFileSync(pidMarker, "utf8"));
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
      let descendantAlive = true;
      try {
        process.kill(pid, 0);
      } catch {
        descendantAlive = false;
      }
      expect(descendantAlive).toBe(false);
    } finally {
      if (restrictPath) {
        process.env.PATH = savedPath;
      }
    }

    // No late write after the kill: the descendant never gets to run its
    // 4-second marker task. (The marker can only exist if the child survived.)
    await new Promise((resolve) => setTimeout(resolve, 4500));
    expect(existsSync(lateMarker)).toBe(false);
  }


  it("scrubs selected environment variables from child processes", async () => {
    const dir = scratchDir();
    const previousInputToken = process.env.INPUT_GITHUB_TOKEN;
    const previousGithubToken = process.env.GITHUB_TOKEN;
    process.env.INPUT_GITHUB_TOKEN = "ghp_input_token_that_must_not_reach_tests";
    process.env.GITHUB_TOKEN = "ghp_github_token_that_must_not_reach_tests";
    const command = nodeCommand(
      dir,
      "process.stdout.write(JSON.stringify({ input: process.env.INPUT_GITHUB_TOKEN ?? null, github: process.env.GITHUB_TOKEN ?? null }));"
    );

    try {
      const result = await runCommand(command, dir, {
        scrubEnv: ["INPUT_GITHUB_TOKEN", "GITHUB_TOKEN"]
      });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ input: null, github: null });
      expect(result.stdout).not.toContain("ghp_input_token_that_must_not_reach_tests");
      expect(result.stdout).not.toContain("ghp_github_token_that_must_not_reach_tests");
    } finally {
      if (previousInputToken === undefined) {
        delete process.env.INPUT_GITHUB_TOKEN;
      } else {
        process.env.INPUT_GITHUB_TOKEN = previousInputToken;
      }
      if (previousGithubToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = previousGithubToken;
      }
    }
  });

  it("applies explicit environment overrides to detailed command runs", async () => {
    const dir = scratchDir();
    const command = nodeCommand(dir, "process.stdout.write(process.env.PATCHDIET_SAFE_VALUE ?? 'missing');");

    const result = await runCommandDetailed(command, dir, {
      env: { PATCHDIET_SAFE_VALUE: "visible-to-test" }
    });

    expect(result.status).toBe("passed");
    expect(result.stdoutSummary).toBe("visible-to-test");
  });
});

describe("summarizeOutput", () => {
  it("keeps only the trailing lines and drops blanks", () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line-${index}`).join("\n");
    const summary = summarizeOutput(`${lines}\n\n`);

    expect(summary.split("\n")).toHaveLength(12);
    expect(summary).toContain("line-49");
    expect(summary).not.toContain("line-0\n");
  });

  it("redacts common tokens from persisted output summaries", () => {
    const summary = summarizeOutput("npm token npm_1234567890abcdef\nGITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456\n");

    expect(summary).not.toContain("npm_1234567890abcdef");
    expect(summary).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(summary).toContain("[redacted]");
  });
});
