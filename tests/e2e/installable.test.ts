import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { exec } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execAsync = promisify(exec);
const tempDirs: string[] = [];
const npmExec = process.platform === "win32" ? "npm.cmd" : "npm";

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("installable package", () => {
  it("packs only runtime artifacts and excludes compiled test files", async () => {
    const packDir = mkdtempSync(join(tmpdir(), "patchdiet-pack-dry-run-"));
    tempDirs.push(packDir);

    await execAsync(`${npmExec} run build`, { cwd: process.cwd() });
    const { stdout } = await execAsync(`${npmExec} pack --json --dry-run`, { cwd: process.cwd() });
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

    await execAsync(`${npmExec} run build`, { cwd: process.cwd() });
    await execAsync(`${npmExec} pack --pack-destination "${packDir}"`, { cwd: process.cwd() });

    const tarball = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
    expect(tarball).toBeTruthy();

    await execAsync(`${npmExec} init -y`, { cwd: installDir });
    await execAsync(`${npmExec} install "${join(packDir, tarball!)}"`, { cwd: installDir });
    const { stdout, stderr } = await execAsync(`${npmExec} exec -- patchdiet --help`, { cwd: installDir });
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
});
