import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ExampleRepo {
  repoPath: string;
  baseRef: string;
  headRef: string;
}

export async function createExampleRepo(
  exampleName: string,
  targetDir: string
): Promise<ExampleRepo> {
  const scenarioPath = resolve(
    "examples",
    exampleName,
    "scenario.json"
  );
  const scenario = JSON.parse(readFileSync(scenarioPath, "utf8")) as Scenario;

  await runGit(["init", "-b", scenario.baseBranch], targetDir);
  await runGit(["config", "user.email", "patchdiet@example.com"], targetDir);
  await runGit(["config", "user.name", "PatchDiet"], targetDir);

  writeFiles(targetDir, scenario.baseFiles ?? {});
  await runGit(["add", "."], targetDir);
  await runGit(["commit", "-m", "base example"], targetDir);

  await runGit(["checkout", "-b", scenario.headBranch], targetDir);
  writeFiles(targetDir, scenario.headFiles ?? {});
  await runGit(["add", "."], targetDir);
  await runGit(["commit", "-m", "bloated agent patch"], targetDir);

  return {
    repoPath: targetDir,
    baseRef: scenario.baseBranch,
    headRef: scenario.headBranch
  };
}

interface Scenario {
  name: string;
  baseBranch: string;
  headBranch: string;
  baseFiles?: Record<string, string>;
  headFiles?: Record<string, string>;
}

function writeFiles(targetDir: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(targetDir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
}

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}
