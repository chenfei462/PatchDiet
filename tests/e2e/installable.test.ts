import { mkdtempSync, readdirSync, rmSync } from "node:fs";
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
  }, 30000);
});
