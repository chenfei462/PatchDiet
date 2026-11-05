import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const packDir = mkdtempSync(join(tmpdir(), "patchdiet-release-pack-"));
const installDir = mkdtempSync(join(tmpdir(), "patchdiet-release-install-"));
try {
  runNpm(["pack", "--pack-destination", packDir], root);
  const tarball = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("npm pack did not create a .tgz tarball");
  }

  runNpm(["init", "-y"], installDir, "ignore");
  runNpm(["install", join(packDir, tarball)], installDir);
  runNpm(["exec", "--", "patchdiet", "--help"], installDir);
  runNpm(["exec", "--", "patchdiet", "init", "--preset", "node"], installDir);
  console.log("PatchDiet release smoke passed");
} finally {
  rmSync(packDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  rmSync(installDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}

function runNpm(args, cwd, stdio = "inherit") {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...args], { cwd, stdio });
    return;
  }

  execFileSync("npm", args, { cwd, stdio });
}
