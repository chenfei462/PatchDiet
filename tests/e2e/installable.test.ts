import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, exec } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createExampleRepo } from "./helpers/create-example-repo.js";

const execAsync = promisify(exec);
const tempDirs: string[] = [];
const npmCommand = resolveNpmCommand();

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(!npmCommand)("installable package", () => {
  it("packs only runtime artifacts and excludes compiled test files", async () => {
    const packDir = mkdtempSync(join(tmpdir(), "patchdiet-pack-dry-run-"));
    tempDirs.push(packDir);

    await runNpm(["run", "build"], process.cwd());
    const { stdout } = await runNpm(["pack", "--json", "--dry-run"], process.cwd());
    const packResult = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const paths = packResult[0]?.files.map((file) => file.path) ?? [];

    expect(paths).toContain("dist/packages/cli/src/index.js");
    expect(paths).not.toContain("dist/tests/e2e/cli.test.js");
    expect(paths.every((path) => !path.startsWith("dist/tests/"))).toBe(true);
  }, 30000);

  it("can be packed, installed, and executed via npm exec", async () => {
    const packDir = mkdtempSync(join(tmpdir(), "patchdiet-pack-"));
    const installDir = mkdtempSync(join(tmpdir(), "patchdiet-install-"));
    tempDirs.push(packDir, installDir);

    await runNpm(["run", "build"], process.cwd());
    await runNpm(["pack", "--pack-destination", packDir], process.cwd());

    const tarball = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
    expect(tarball).toBeTruthy();

    await runNpm(["init", "-y"], installDir);
    await runNpm(["install", join(packDir, tarball!)], installDir);
    const { stdout, stderr } = await runNpm(["exec", "--", "patchdiet", "--help"], installDir);
    expect(`${stdout}${stderr}`).toContain("Shrink AI-generated pull requests into smaller reviewable patches.");
    const installedPackageJson = JSON.parse(
      readFileSync(join(installDir, "node_modules", "patchdiet", "package.json"), "utf8")
    ) as {
      repository?: { type?: string; url?: string };
      homepage?: string;
      bugs?: { url?: string };
    };
    expect(installedPackageJson.repository?.url).toBe("git+https://github.com/chenfei462/PatchDiet.git");
    expect(installedPackageJson.homepage).toBe("https://github.com/chenfei462/PatchDiet");
    expect(installedPackageJson.bugs?.url).toBe("https://github.com/chenfei462/PatchDiet/issues");
  }, 30000);

  it("can run shrink end-to-end from the installed package", async () => {
    const packDir = mkdtempSync(join(tmpdir(), "patchdiet-pack-shrink-"));
    const repoDir = mkdtempSync(join(tmpdir(), "patchdiet-installed-repo-"));
    tempDirs.push(packDir, repoDir);

    await runNpm(["run", "build"], process.cwd());
    await runNpm(["pack", "--pack-destination", packDir], process.cwd());

    const tarball = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
    expect(tarball).toBeTruthy();

    await createExampleRepo("ts-bloated-pr", repoDir);
    await runNpm(["install", join(packDir, tarball!)], repoDir);
    await runNpm(
      [
        "exec",
        "--",
        "patchdiet",
        "shrink",
        "--base",
        "main",
        "--head",
        "agent/bloated",
        "--dry-run"
      ],
      repoDir
    );

    expect(readFileSync(join(repoDir, ".patchdiet", "run.json"), "utf8")).toContain("\"output\"");
    expect(readFileSync(join(repoDir, ".patchdiet", "cleanup.diff"), "utf8")).toContain("multiply");
    expect(readFileSync(join(repoDir, ".patchdiet", "cleanup.diff"), "utf8")).not.toContain("unused.ts");
  }, 30000);
});

interface NpmCommand {
  command: string;
  argsPrefix: string[];
}

async function runNpm(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  if (!npmCommand) {
    throw new Error("npm is not available");
  }

  return execAsync(
    [quote(npmCommand.command), ...npmCommand.argsPrefix.map(quote), ...args.map(quote)].join(" "),
    { cwd }
  );
}

function resolveNpmCommand(): NpmCommand | undefined {
  const envNpm = process.env.npm_execpath;
  if (envNpm) {
    return { command: process.execPath, argsPrefix: [envNpm] };
  }

  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return { command, argsPrefix: [] };
  } catch {
    return undefined;
  }
}

function quote(value: string): string {
  return `"${value.replaceAll("\"", "\\\"")}"`;
}
