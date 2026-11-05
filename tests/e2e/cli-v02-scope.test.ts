import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";

import { createExampleRepo } from "./helpers/create-example-repo.js";

const execFileAsync = promisify(execFile);
const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0)) {
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

it("verify and explain expose sourced diff atoms without writing or running checks", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-cli-scope-"));
  owned.push(cwd);
  await createExampleRepo("ts-bloated-pr", cwd);
  const taskFile = join(cwd, "task.txt");
  writeFileSync(taskFile, "Add multiply in src/math.ts\n");
  const cli = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
  const env = { ...process.env, PATCHDIET_TARGET_CWD: cwd };
  const args = ["--base", "main", "--head", "agent/bloated", "--task-file", "task.txt"];

  const before = (await execFileAsync("git", ["status", "--porcelain"], { cwd })).stdout;
  const { stdout } = await execFileAsync("node", [cli, "verify", ...args, "--json"], { cwd: process.cwd(), env });
  const report = JSON.parse(stdout) as {
    readOnly: boolean; oracleExecuted: boolean; atoms: { atomId: string; filePath: string; state: string }[];
    summary: { required: number; uncertain: number; candidate: number };
  };
  expect(report.readOnly).toBe(true);
  expect(report.oracleExecuted).toBe(false);
  expect(report.atoms.find((atom) => atom.filePath === "src/math.ts")?.state).toBe("required");
  expect(report.atoms.find((atom) => atom.filePath === "src/unused.ts")?.state).toBe("uncertain");
  expect(report.summary.candidate).toBe(0);

  const id = report.atoms.find((atom) => atom.filePath === "src/math.ts")?.atomId;
  expect(id).toBeTruthy();
  const explained = await execFileAsync("node", [cli, "explain", ...args, "--atom", id!, "--json"], { cwd: process.cwd(), env });
  const explanations = JSON.parse(explained.stdout) as { found: boolean; evidence: { category: string }[] }[];
  expect(explanations).toHaveLength(1);
  expect(explanations[0]?.found).toBe(true);
  expect(explanations[0]?.evidence.some((record) => record.category === "intent")).toBe(true);
  expect((await execFileAsync("git", ["status", "--porcelain"], { cwd })).stdout).toBe(before);
  expect(existsSync(join(cwd, ".patchdiet"))).toBe(false);
  expect(readFileSync(taskFile, "utf8")).toBe("Add multiply in src/math.ts\n");
});

it("verify uses a matching pinned semantic index to name a changed symbol", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-cli-symbol-"));
  owned.push(cwd);
  await createExampleRepo("ts-bloated-pr", cwd);
  const cli = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
  const env = { ...process.env, PATCHDIET_TARGET_CWD: cwd };
  await execFileAsync("node", [cli, "index", "--ref", "agent/bloated"], { cwd: process.cwd(), env });
  const before = (await execFileAsync("git", ["status", "--porcelain"], { cwd })).stdout;
  const { stdout } = await execFileAsync("node", [cli, "verify", "--base", "main", "--head", "agent/bloated", "--task", "Add multiply", "--json"], { cwd: process.cwd(), env });
  const report = JSON.parse(stdout) as { atoms: { filePath: string; symbolPath?: string; state: string }[] };
  const math = report.atoms.find((atom) => atom.filePath === "src/math.ts");
  expect(math?.symbolPath).toBe("multiply");
  expect(math?.state).toBe("required");
  expect((await execFileAsync("git", ["status", "--porcelain"], { cwd })).stdout).toBe(before);
});

it("verify applies repository protection rules from pinned HEAD, not dirty instruction text", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-cli-rules-"));
  owned.push(cwd);
  await createExampleRepo("ts-bloated-pr", cwd);
  const rulePath = join(cwd, "AGENTS.md");
  writeFileSync(rulePath, "protect: src/unused.ts\n");
  await execFileAsync("git", ["add", "AGENTS.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "protect unused source"], { cwd });
  writeFileSync(rulePath, "protect: README.md\n");
  const cli = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
  const env = { ...process.env, PATCHDIET_TARGET_CWD: cwd };
  const { stdout } = await execFileAsync("node", [cli, "verify", "--base", "main", "--head", "agent/bloated", "--task", "Add multiply", "--json"], { cwd: process.cwd(), env });
  const report = JSON.parse(stdout) as { atoms: { filePath: string; state: string }[] };
  expect(report.atoms.find((atom) => atom.filePath === "src/unused.ts")?.state).toBe("protected");
  expect(report.atoms.find((atom) => atom.filePath === "README.md")?.state).not.toBe("protected");
  expect(readFileSync(rulePath, "utf8")).toBe("protect: README.md\n");
});
