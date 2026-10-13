import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

import { afterEach, expect, it } from "vitest";

import { runShrink } from "../../packages/core/src/shrink.js";

const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0)) {
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

it("ddmin retains one of two substituting changes and verifies the exact artifact", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-ddmin-"));
  owned.push(cwd);
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "PatchDiet test");
  git(cwd, "config", "user.email", "test@example.invalid");
  writeFileSync(join(cwd, "README.md"), "baseline\n");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "base");
  git(cwd, "checkout", "-b", "agent");
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "src", "a.js"), "export const a = true;\n");
  writeFileSync(join(cwd, "src", "b.js"), "export const b = true;\n");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "add substitutes");

  const report = await runShrink({
    cwd,
    baseRef: "main",
    headRef: "agent",
    strategy: "ddmin",
    dryRun: true,
    requiredCommands: [
      'node -e "const fs=require(\'fs\');process.exit(fs.existsSync(\'src/a.js\')||fs.existsSync(\'src/b.js\')?0:1)"',
    ],
  });

  expect(report.mode).toBe("verified");
  expect(report.removals).toHaveLength(1);
  expect(report.output.fileCount).toBe(1);
  expect(report.verification?.final?.status).toBe("passed");
  expect(report.verification?.final?.treesMatch).toBe(true);
});

it("rejects a baseline whose first retry passes and second attempt fails", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-retry-"));
  const counterDir = mkdtempSync(join(tmpdir(), "patchdiet-retry-counter-"));
  owned.push(cwd, counterDir);
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "PatchDiet test");
  git(cwd, "config", "user.email", "test@example.invalid");
  writeFileSync(join(cwd, "README.md"), "baseline\n");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "base");
  const counter = join(counterDir, "attempts.json").replaceAll("\\", "/");
  const command = `node -e "const fs=require('fs');const p='${counter}';let n=0;try{n=JSON.parse(fs.readFileSync(p)).n}catch{};n++;fs.writeFileSync(p,JSON.stringify({n}));process.exit(n%2===1?0:1)"`;

  await expect(runShrink({
    cwd,
    baseRef: "main",
    headRef: "main",
    requiredCommands: [command],
    retryFlakyTests: 1,
    dryRun: true,
  })).rejects.toThrow(/inconclusive|conflict|oscillat/i);
});

it("does not report selected groups after final artifact verification fails", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-ddmin-final-"));
  owned.push(cwd);
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "PatchDiet test");
  git(cwd, "config", "user.email", "test@example.invalid");
  writeFileSync(join(cwd, "README.md"), "baseline\n");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "base");
  git(cwd, "checkout", "-b", "agent");
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "src", "unused.js"), "export const unused = true;\n");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", "agent change");

  const report = await runShrink({
    cwd,
    baseRef: "main",
    headRef: "agent",
    strategy: "ddmin",
    dryRun: true,
    requiredCommands: [
      'node -e "process.exit(process.cwd().includes(\'final-artifact\')?1:0)"',
    ],
  });

  expect(report.mode).toBe("unverified");
  expect(report.removals).toHaveLength(0);
  expect(report.reduction?.selectedGroupIds).toEqual([]);
});
