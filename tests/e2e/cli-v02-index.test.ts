import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";

import { openKnowledgeIndexReadonly } from "../../packages/knowledge/src/index.js";
import { createExampleRepo } from "./helpers/create-example-repo.js";

const execFileAsync = promisify(execFile);
const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0)) {
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

it("index CLI stores the pinned commit rather than dirty working-tree source", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "patchdiet-cli-index-"));
  owned.push(cwd);
  await createExampleRepo("ts-bloated-pr", cwd);
  writeFileSync(join(cwd, "src", "unused.ts"), "export const forged = true;\n");
  const cli = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
  const { stdout } = await execFileAsync("node", [cli, "index", "--ref", "agent/bloated", "--json"], {
    cwd: process.cwd(),
    env: { ...process.env, PATCHDIET_TARGET_CWD: cwd },
  });
  const result = JSON.parse(stdout) as { repo: { commit: string }; databasePath: string };
  const expected = (await execFileAsync("git", ["rev-parse", "agent/bloated"], { cwd })).stdout.trim();
  expect(result.repo.commit).toBe(expected);
  const db = openKnowledgeIndexReadonly(result.databasePath);
  try {
    expect(db.querySymbols({ name: "multiply" })).toHaveLength(1);
    expect(db.querySymbols({ name: "forged" })).toHaveLength(0);
    expect(db.getFileGraph("src/unused.ts").file.path).toBe("src/unused.ts");
  } finally {
    db.close();
  }
  expect(readFileSync(join(cwd, "src", "unused.ts"), "utf8")).toContain("forged");
});
