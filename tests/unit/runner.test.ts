import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCommand } from "../../packages/core/src/runner.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runCommand", () => {
  it("retries a flaky command until it succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-runner-"));
    tempDirs.push(dir);
    const node = JSON.stringify(process.execPath);
    const command = [
      node,
      "-e",
      "\"const fs=require('fs');const p='attempt.txt';const n=fs.existsSync(p)?Number(fs.readFileSync(p,'utf8')):0;fs.writeFileSync(p,String(n+1));process.exit(n>=1?0:1);\""
    ].join(" ");

    const result = await runCommand(command, dir, { retries: 1 });

    expect(result.exitCode).toBe(0);
    expect(result.attempts).toBe(2);
  });

  it("marks timed out commands and truncates captured output", async () => {
    const node = JSON.stringify(process.execPath);
    const result = await runCommand(
      `${node} -e "console.log('x'.repeat(200)); setTimeout(()=>{}, 1000)"`,
      process.cwd(),
      { timeoutMs: 50, maxOutputBytes: 40 }
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.timedOut).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(80);
  });
});
