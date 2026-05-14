import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DiffResult {
  diff: string;
}

export async function getDiff(
  cwd: string,
  baseRef: string,
  headRef: string
): Promise<DiffResult> {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", `${baseRef}...${headRef}`],
    { cwd }
  );

  return { diff: stdout };
}

export async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    args,
    { cwd }
  );

  return stdout;
}
